import { randomUUID } from "node:crypto";
import { isFormulaInput, parseAddress } from "@spreadsheet-app/engine";
import { CLIENT_ID_HEADER } from "@spreadsheet-app/shared";
import type { RepositoryOptions } from "./repo/spreadsheets";
import pg from "pg";
import { asc, eq } from "drizzle-orm";
import { pages, spreadsheets, tables, tableRows, views } from "./db/schema";
import { expect } from "vitest";
import type { CellInput } from "@spreadsheet-app/shared";
import {
  createApp,
  type Change,
  type Created,
  type SnapshotWithHistory,
  type SpreadsheetSummary,
  type TableRecord,
  type ViewRecord,
} from "./app";
import { Contents, type SizedTable } from "./repo/contents";
import { createAuth } from "./auth";
import { IN_MEMORY, openDatabase, type Database, type DatabaseHandle } from "./db/client";
import type { EmailMessage, Mailer } from "./mail/mailer";

const BASE_URL = "http://localhost:5173";

export interface TestServer {
  db: Database;
  /**
   * Every route the app registers behind a session, written as
   * `METHOD /path/:param` without the `/api` prefix. A test that must cover
   * every route compares what it covers with this list.
   */
  routes: readonly string[];
  /** Opens another connection to the test database when it uses PostgreSQL. */
  openConnection?: () => Promise<DatabaseHandle>;
  /** Messages the app asked to send, oldest first. */
  sent: EmailMessage[];
  /** Makes the next sends fail, to exercise the failure path. An address fails only the messages sent to it. */
  failSending(fail: boolean | string): void;
  /** Creates an account and returns a client that sends requests as that user. */
  signUp(name?: string): Promise<TestUser>;
  /** Sends a request with no session. */
  anonymous: TestClient;
  close(): Promise<void>;
}

export interface TestClient {
  request(
    method: string,
    path: string,
    body?: unknown,
    headers?: Record<string, string>,
    /** Ends the request, which is how a test stops reading a stream. */
    signal?: AbortSignal,
  ): Promise<Response>;
  /** Sends a request, asserts the status, and returns the parsed JSON body. */
  json<T>(method: string, path: string, body?: unknown, status?: number): Promise<T>;
}

/** Gives a test client a stable identity for its undo and redo stack. */
export function withClientId(client: TestClient, clientId = randomUUID()): TestClient {
  const request: TestClient["request"] = (method, path, body, headers = {}, signal) =>
    client.request(method, path, body, { ...headers, [CLIENT_ID_HEADER]: clientId }, signal);
  return {
    request,
    async json<T>(method: string, path: string, body?: unknown, status = 200) {
      const response = await request(method, path, body);
      const text = await response.text();
      expect(response.status, text).toBe(status);
      return (text === "" ? undefined : JSON.parse(text)) as T;
    },
  };
}

export interface TestUser extends TestClient {
  userId: string;
  email: string;
}

let accounts = 0;

interface TestDatabaseHandle extends DatabaseHandle {
  openConnection?: () => Promise<DatabaseHandle>;
}

/**
 * Opens an empty database for one test file. By default it is in memory.
 * When TEST_DATABASE_URL names a Postgres server, it is a database created on
 * that server and dropped on close, which checks that the code behaves the
 * same on real Postgres as on PGlite.
 */
async function openTestDatabase(): Promise<TestDatabaseHandle> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (serverUrl === undefined) return openDatabase(IN_MEMORY);

  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();
  const handle = await openDatabase(databaseUrl);
  return {
    db: handle.db,
    openConnection: () => openDatabase(databaseUrl),
    async close() {
      await handle.close();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    },
  };
}

const API_PREFIX = "/api";

/** The routes of the app that need a session. Middleware and the routes of the sign-in library are left out. */
function sessionRoutes(app: ReturnType<typeof createApp>): string[] {
  const routes = app.routes
    .filter(({ method, path }) => method !== "ALL" && !path.startsWith(`${API_PREFIX}/auth/`))
    .map(({ method, path }) => `${method} ${path.slice(API_PREFIX.length)}`);
  // A route is registered once for each validator in front of its handler.
  return [...new Set(routes)].sort();
}

/**
 * The registered route a request goes to, as `routes` writes it, or
 * `undefined` when no route takes the request.
 */
export function routeOf(
  routes: readonly string[],
  method: string,
  path: string,
): string | undefined {
  const segments = (path.split("?")[0] ?? "").split("/");
  const literals = (route: string): number =>
    route.split("/").filter((segment) => !segment.startsWith(":")).length;
  return (
    routes
      .filter((route) => {
        const [routeMethod = "", pattern = ""] = route.split(" ");
        const parts = pattern.split("/");
        return (
          routeMethod === method &&
          parts.length === segments.length &&
          parts.every((part, index) =>
            part.startsWith(":") ? segments[index] !== "" : part === segments[index],
          )
        );
      })
      // `/spreadsheets/import` is the import route and not a spreadsheet named "import".
      .sort((left, right) => literals(right) - literals(left))[0]
  );
}

/**
 * A snapshot as a test reads it: tables with their sizes and cells by
 * position, which is how fixtures are written. `rows` and each table's
 * `colIds` hold the ids the wire names them by.
 */
export interface TestSnapshot extends Omit<SnapshotWithHistory, "tables" | "cells"> {
  tables: SizedTable[];
  cells: (CellInput & { tableId: string })[];
}

/** Reads a spreadsheet through the API, and gives its tables and cells by position. */
export async function readSnapshot(user: TestClient, spreadsheetId: string): Promise<TestSnapshot> {
  const snapshot = await user.json<SnapshotWithHistory>("GET", `/spreadsheets/${spreadsheetId}`);
  const { tables, cells } = new Contents(snapshot).data;
  return { ...snapshot, tables, cells: [...cells] };
}

/** Adds a table to a page and returns it. */
export async function addTable(
  user: TestClient,
  pageId: string,
  body: { name?: string } = {},
): Promise<TableRecord> {
  const created = await user.json<Created<{ table: TableRecord }>>(
    "POST",
    `/pages/${pageId}/tables`,
    body,
    201,
  );
  return created.table;
}

/** Adds a chart or text view to a page and returns it. */
export async function addView(
  user: TestClient,
  pageId: string,
  kind: "chart" | "text" = "text",
): Promise<ViewRecord> {
  const created = await user.json<Created<{ view: ViewRecord }>>(
    "POST",
    `/pages/${pageId}/views`,
    { kind },
    201,
  );
  return created.view;
}

/**
 * The cells a change wrote, by the positions they have in the spreadsheet
 * now. A cell whose row or column the change deleted is not among them.
 */
export async function changedCells(
  user: TestClient,
  spreadsheetId: string,
  change: Change,
): Promise<(CellInput & { tableId: string })[]> {
  const snapshot = await user.json<SnapshotWithHistory>("GET", `/spreadsheets/${spreadsheetId}`);
  const contents = new Contents(snapshot);
  return (change.changed?.cells ?? []).map(({ input, ...cell }) => ({
    ...contents.position(cell),
    input,
  }));
}

/** The ids of a table's rows, first to last. */
export function rowIds(snapshot: TestSnapshot, tableId: string): string[] {
  return snapshot.rows.filter((row) => row.tableId === tableId).map((row) => row.id);
}

/** Creates a spreadsheet and returns its snapshot: one page holding one empty table. */
export async function createSpreadsheet(user: TestClient, name = "Budget"): Promise<TestSnapshot> {
  const created = await user.json<SpreadsheetSummary>("POST", "/spreadsheets", { name }, 201);
  return readSnapshot(user, created.id);
}

/** Turns `{ A1: "1" }` into the request body for storing cells. */
export function cellsBody(inputs: Record<string, string>): { cells: object[] } {
  return {
    cells: Object.entries(inputs).map(([address, input]) => {
      const parsed = parseAddress(address);
      if (!parsed) throw new Error(`Bad test address ${address}`);
      return { ...parsed, input };
    }),
  };
}

/** The stored inputs of one table, keyed by position as `row:col`, read back through the API. */
export async function storedInputs(
  user: TestClient,
  spreadsheetId: string,
  tableId: string,
): Promise<Record<string, string>> {
  const snapshot = await readSnapshot(user, spreadsheetId);
  return Object.fromEntries(
    snapshot.cells
      .filter((cell) => cell.tableId === tableId)
      .map((cell) => [`${String(cell.row)}:${String(cell.col)}`, cell.input]),
  );
}

/** Starts the app on a fresh database. Call `close` when the test file is done. */
export async function startTestServer(
  options: {
    emailsPerHour?: number;
    verifyEmail?: boolean;
    shutdown?: AbortSignal;
    repositoryOptions?: RepositoryOptions;
  } = {},
): Promise<TestServer> {
  const database = await openTestDatabase();
  const sent: EmailMessage[] = [];
  let failing: boolean | string = false;
  const mailer: Mailer = {
    send(message) {
      const fails = typeof failing === "string" ? message.to.includes(failing) : failing;
      if (fails) return Promise.reject(new Error("mail server unreachable"));
      sent.push(message);
      return Promise.resolve();
    },
  };
  const app = createApp({
    db: database.db,
    auth: createAuth(database.db, {
      secret: "test-secret-test-secret-test-secret",
      baseUrl: BASE_URL,
      trustedOrigins: [BASE_URL],
      ...(options.verifyEmail ? { verifyEmailWith: mailer } : {}),
    }),
    mailer,
    emailsPerHour: options.emailsPerHour ?? 20,
    trustedOrigins: [BASE_URL],
    requireEmailVerification: options.verifyEmail ?? false,
    ...(options.repositoryOptions ? { repositoryOptions: options.repositoryOptions } : {}),
    ...(options.shutdown ? { shutdown: options.shutdown } : {}),
  });

  const client = (cookie: string | undefined): TestClient => {
    const request: TestClient["request"] = async (method, path, body, headers = {}, signal) => {
      // Positional fixtures stay readable; translate their addresses to the wire's stable IDs.
      // Tests that send IDs pass through unchanged and can hold them across intervening edits.
      const named = /^\/tables\/([0-9a-f-]{36})\/(edits|formats|columns\/(\d+))$/.exec(path);
      if (named?.[1]) {
        const [table] = await database.db.select().from(tables).where(eq(tables.id, named[1]));
        const rows = await database.db
          .select()
          .from(tableRows)
          .where(eq(tableRows.tableId, named[1]))
          .orderBy(asc(tableRows.orderKey));
        const missing = "00000000-0000-4000-8000-000000000000";
        if (named[3])
          path = `/tables/${named[1]}/columns/${table?.colIds[Number(named[3])] ?? missing}`;
        if (body && typeof body === "object") {
          const object = body as Record<string, unknown>;
          if (
            named[2] === "edits" &&
            (object.axis === "row" || object.axis === "col") &&
            (object.kind === "insert" || object.kind === "delete") &&
            typeof object.index === "number" &&
            Number.isInteger(object.index) &&
            object.index >= 0 &&
            (object.count === undefined ||
              (typeof object.count === "number" &&
                Number.isInteger(object.count) &&
                object.count > 0 &&
                object.count <= 1000))
          ) {
            const ids = object.axis === "row" ? rows.map((row) => row.id) : (table?.colIds ?? []);
            const count = typeof object.count === "number" ? object.count : 1;
            body =
              object.kind === "insert"
                ? {
                    axis: object.axis,
                    kind: object.kind,
                    beforeId: object.index === ids.length ? null : (ids[object.index] ?? missing),
                    ids: Array.from({ length: count }, () => randomUUID()),
                  }
                : {
                    axis: object.axis,
                    kind: object.kind,
                    ids: Array.from(
                      { length: count },
                      (_, i) => ids[(object.index as number) + i] ?? missing,
                    ),
                  };
          }
          if (named[2] === "formats" && object.range && typeof object.range === "object") {
            const range = object.range as Record<string, unknown>;
            if (typeof range.startRow === "number" && typeof range.startCol === "number")
              body = {
                ...object,
                range: {
                  startRowId: rows[range.startRow]?.id ?? missing,
                  endRowId:
                    range.endRow === null
                      ? null
                      : typeof range.endRow === "number"
                        ? (rows[range.endRow]?.id ?? missing)
                        : undefined,
                  startColId: table?.colIds[range.startCol] ?? missing,
                  endColId:
                    range.endCol === null
                      ? null
                      : typeof range.endCol === "number"
                        ? (table?.colIds[range.endCol] ?? missing)
                        : undefined,
                },
              };
          }
        }
      }
      const match = /^\/tables\/([0-9a-f-]{36})\/cells(?:\/(\d+)\/(\d+)\/(click|input))?$/.exec(
        path,
      );
      if (match?.[1]) {
        const [table] = await database.db.select().from(tables).where(eq(tables.id, match[1]));
        const rows = await database.db
          .select()
          .from(tableRows)
          .where(eq(tableRows.tableId, match[1]))
          .orderBy(asc(tableRows.orderKey));
        const missing = "00000000-0000-4000-8000-000000000000";
        if (match[2] && match[3])
          path = `/tables/${match[1]}/cells/${rows[Number(match[2])]?.id ?? missing}/${table?.colIds[Number(match[3])] ?? missing}/${match[4] ?? "click"}`;
        if (body && typeof body === "object" && "cells" in body && Array.isArray(body.cells)) {
          body = {
            ...body,
            cells: body.cells.map((cell: unknown) => {
              if (
                cell &&
                typeof cell === "object" &&
                "row" in cell &&
                "col" in cell &&
                typeof cell.row === "number" &&
                typeof cell.col === "number" &&
                Number.isInteger(cell.row) &&
                cell.row >= 0 &&
                Number.isInteger(cell.col) &&
                cell.col >= 0
              ) {
                return {
                  ...cell,
                  rowId: rows[cell.row]?.id ?? missing,
                  colId: table?.colIds[cell.col] ?? missing,
                };
              }
              return cell;
            }),
          };
        }
      }
      // These helpers model a client that has the current spreadsheet open.
      // Preserve an explicit `revision: undefined` so tests can exercise the
      // request schema's missing-revision rejection.
      if (
        body &&
        typeof body === "object" &&
        !Object.hasOwn(body, "revision") &&
        ((method === "PUT" &&
          /\/tables\/[0-9a-f-]{36}\/cells$/.test(path) &&
          "cells" in body &&
          Array.isArray(body.cells) &&
          body.cells.some(
            (cell: unknown) =>
              cell &&
              typeof cell === "object" &&
              "input" in cell &&
              typeof cell.input === "string" &&
              isFormulaInput(cell.input),
          )) ||
          (method === "PATCH" &&
            /\/tables\/[0-9a-f-]{36}\/columns\//.test(path) &&
            "formula" in body) ||
          (method === "PATCH" && /\/views\/[0-9a-f-]{36}$/.test(path) && "source" in body))
      ) {
        const tableId = /^\/tables\/([0-9a-f-]{36})\//.exec(path)?.[1];
        const viewId = /^\/views\/([0-9a-f-]{36})$/.exec(path)?.[1];
        const [target] = tableId
          ? await database.db
              .select({ spreadsheetId: pages.spreadsheetId })
              .from(tables)
              .innerJoin(pages, eq(pages.id, tables.pageId))
              .where(eq(tables.id, tableId))
          : viewId
            ? await database.db
                .select({ spreadsheetId: pages.spreadsheetId })
                .from(views)
                .innerJoin(pages, eq(pages.id, views.pageId))
                .where(eq(views.id, viewId))
            : [];
        if (target) {
          const [current] = await database.db
            .select({ revision: spreadsheets.revision })
            .from(spreadsheets)
            .where(eq(spreadsheets.id, target.spreadsheetId));
          if (current) body = { ...body, revision: current.revision };
        }
      }
      return app.request(`/api${path}`, {
        method,
        ...(signal ? { signal } : {}),
        headers: {
          origin: BASE_URL,
          ...(cookie === undefined ? {} : { cookie }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    };
    return {
      request,
      async json<T>(method: string, path: string, body?: unknown, status = 200) {
        const response = await request(method, path, body);
        const text = await response.text();
        expect(response.status, text).toBe(status);
        return (text === "" ? undefined : JSON.parse(text)) as T;
      },
    };
  };
  const anonymous = client(undefined);

  return {
    db: database.db,
    routes: sessionRoutes(app),
    openConnection: database.openConnection,
    sent,
    failSending(fail) {
      failing = fail;
    },
    anonymous,
    async signUp(name = "Ada") {
      accounts += 1;
      const email = `user${String(accounts)}@example.com`;
      const response = await anonymous.request("POST", "/auth/sign-up/email", {
        name,
        email,
        password: "correct horse battery staple",
      });
      expect(response.status, await response.clone().text()).toBe(200);
      const { user } = (await response.json()) as { user: { id: string } };
      const cookie = response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; ");
      return { ...client(cookie), userId: user.id, email };
    },
    close: () => database.close(),
  };
}
