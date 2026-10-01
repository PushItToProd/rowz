import { randomUUID } from "node:crypto";
import { parseAddress } from "@spreadsheet-app/engine";
import pg from "pg";
import { expect } from "vitest";
import { createApp, type Snapshot, type SpreadsheetSummary } from "./app";
import { createAuth } from "./auth";
import { IN_MEMORY, openDatabase, type Database, type DatabaseHandle } from "./db/client";
import type { EmailMessage, Mailer } from "./mail/mailer";

const BASE_URL = "http://localhost:5173";

export interface TestServer {
  db: Database;
  /** Messages the app asked to send, oldest first. */
  sent: EmailMessage[];
  /** Makes the next sends fail, to exercise the failure path. */
  failSending(fail: boolean): void;
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

export interface TestUser extends TestClient {
  userId: string;
  email: string;
}

let accounts = 0;

/**
 * Opens an empty database for one test file. By default it is in memory.
 * When TEST_DATABASE_URL names a Postgres server, it is a database created on
 * that server and dropped on close, which checks that the code behaves the
 * same on real Postgres as on PGlite.
 */
async function openTestDatabase(): Promise<DatabaseHandle> {
  const serverUrl = process.env.TEST_DATABASE_URL;
  if (serverUrl === undefined) return openDatabase(IN_MEMORY);

  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Client({ connectionString: serverUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(serverUrl);
  url.pathname = `/${name}`;
  const handle = await openDatabase(url.toString());
  return {
    db: handle.db,
    async close() {
      await handle.close();
      await admin.query(`DROP DATABASE ${name}`);
      await admin.end();
    },
  };
}

/** Creates a spreadsheet and returns its snapshot: one page holding one empty table. */
export async function createSpreadsheet(user: TestClient, name = "Budget"): Promise<Snapshot> {
  const created = await user.json<SpreadsheetSummary>("POST", "/spreadsheets", { name }, 201);
  return user.json<Snapshot>("GET", `/spreadsheets/${created.id}`);
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

/** The stored inputs of one table, keyed by address-like `row:col`, read back through the API. */
export async function storedInputs(
  user: TestClient,
  spreadsheetId: string,
  tableId: string,
): Promise<Record<string, string>> {
  const snapshot = await user.json<Snapshot>("GET", `/spreadsheets/${spreadsheetId}`);
  return Object.fromEntries(
    snapshot.cells
      .filter((cell) => cell.tableId === tableId)
      .map((cell) => [`${String(cell.row)}:${String(cell.col)}`, cell.input]),
  );
}

/** Starts the app on a fresh database. Call `close` when the test file is done. */
export async function startTestServer(
  options: { emailRunsPerHour?: number } = {},
): Promise<TestServer> {
  const database = await openTestDatabase();
  const sent: EmailMessage[] = [];
  let failing = false;
  const mailer: Mailer = {
    send(message) {
      if (failing) return Promise.reject(new Error("mail server unreachable"));
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
    }),
    mailer,
    emailRunsPerHour: options.emailRunsPerHour ?? 20,
  });

  const client = (cookie: string | undefined): TestClient => {
    const request: TestClient["request"] = async (method, path, body, headers = {}, signal) =>
      app.request(`/api${path}`, {
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
