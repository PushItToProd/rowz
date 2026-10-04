import { randomUUID } from "node:crypto";
import { columnLabel } from "@spreadsheet-app/engine";
import { asc, desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LIMITS,
  STEP_ID_HEADER,
  UNDOABLE_HEADER,
  type JournalLimits,
} from "@spreadsheet-app/shared";
import type { UndoResult } from "./app";
import { cells as cellRecords, journal, spreadsheets, tableRows } from "./db/schema";
import {
  addTable,
  addView,
  cellsBody,
  createSpreadsheet,
  readSnapshot,
  routeOf,
  rowIds,
  storedInputs,
  startTestServer,
  withClientId,
  type TestClient,
  type TestServer,
  type TestSnapshot,
  type TestUser,
} from "./testing";

let server: TestServer;
let owner: TestUser;

beforeAll(async () => {
  server = await startTestServer();
  owner = await server.signUp("Undo owner");
});

afterAll(async () => server.close());

interface Fixture {
  id: string;
  pageId: string;
  tableId: string;
}

async function fresh(user: TestClient = owner): Promise<Fixture> {
  const snapshot = await createSpreadsheet(user);
  return {
    id: snapshot.id,
    pageId: snapshot.pages[0]!.id,
    tableId: snapshot.tables[0]!.id,
  };
}

function snapshot(client: TestClient, id: string): Promise<TestSnapshot> {
  return readSnapshot(client, id);
}

async function versionState(id: string) {
  const [row] = await server.db
    .select({ updatedAt: spreadsheets.updatedAt })
    .from(spreadsheets)
    .where(eq(spreadsheets.id, id));
  const versions = await owner.json<unknown[]>("GET", `/spreadsheets/${id}/versions`);
  return { updatedAt: row?.updatedAt, versions };
}

async function expectNoChangeEvent(id: string, operation: () => Promise<unknown>): Promise<void> {
  const observerId = randomUUID();
  const controller = new AbortController();
  const response = await owner.request(
    "GET",
    `/spreadsheets/${id}/events?client=${observerId}`,
    undefined,
    {},
    controller.signal,
  );
  expect(response.status).toBe(200);
  const reader = response.body!.getReader();
  const ready = await reader.read();
  const readyValue: unknown = ready.value;
  if (!(readyValue instanceof Uint8Array)) throw new Error("Expected an SSE byte chunk");
  expect(new TextDecoder().decode(readyValue)).toContain("ready");
  const next = reader.read().then(
    () => true,
    () => false,
  );
  try {
    await operation();
    const event = await Promise.race([
      next,
      new Promise<boolean>((resolve) =>
        setTimeout(() => {
          resolve(false);
        }, 50),
      ),
    ]);
    expect(event).toBe(false);
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }
}

async function createPage(client: TestClient, spreadsheetId: string, name = "Data") {
  return client.json<{ page: { id: string }; table: { id: string } }>(
    "POST",
    `/spreadsheets/${spreadsheetId}/pages`,
    { name },
    201,
  );
}

function createView(client: TestClient, pageId: string, kind: "chart" | "text" = "text") {
  return addView(client, pageId, kind);
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function repeatedFormula(reference: string, count: number): string {
  return `=SUM(${Array.from({ length: count }, () => reference).join(",")})`;
}

interface Route {
  name: string;
  prepare(fixture: Fixture):
    | { method: string; path: string; body?: unknown; status: number }
    | Promise<{
        method: string;
        path: string;
        body?: unknown;
        status: number;
      }>;
}

const routeCases: Route[] = [
  {
    name: "create page",
    prepare({ id }) {
      return {
        method: "POST",
        path: `/spreadsheets/${id}/pages`,
        body: { name: "Data" },
        status: 201,
      };
    },
  },
  {
    name: "rename page",
    prepare({ pageId }) {
      return { method: "PATCH", path: `/pages/${pageId}`, body: { name: "Summary" }, status: 200 };
    },
  },
  {
    name: "rename a page that a formula and a chart on another page name",
    async prepare({ id, pageId, tableId }) {
      const { page, table } = await createPage(owner, id);
      await owner.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A1: "1" }), 200);
      await owner.json(
        "PUT",
        `/tables/${table.id}/cells`,
        cellsBody({ A1: "='Page 1'!'Table 1'!A1" }),
        200,
      );
      const view = await createView(owner, page.id, "chart");
      await owner.json("PATCH", `/views/${view.id}`, { source: "'Page 1'!'Table 1'!A1:B2" });
      return { method: "PATCH", path: `/pages/${pageId}`, body: { name: "Renamed" }, status: 200 };
    },
  },
  {
    name: "reorder blocks",
    async prepare({ pageId, tableId }) {
      const view = await createView(owner, pageId);
      return {
        method: "PUT",
        path: `/pages/${pageId}/order`,
        body: { blocks: [view.id, tableId] },
        status: 200,
      };
    },
  },
  {
    name: "reorder pages",
    async prepare({ id, pageId }) {
      const { page } = await createPage(owner, id);
      return {
        method: "PUT",
        path: `/spreadsheets/${id}/pages/order`,
        body: { pages: [page.id, pageId] },
        status: 200,
      };
    },
  },
  {
    name: "move table",
    async prepare({ id, tableId }) {
      const { page, table } = await createPage(owner, id);
      await owner.json("PATCH", `/tables/${table.id}`, { name: "Other" });
      return {
        method: "PUT",
        path: `/tables/${tableId}/page`,
        body: { pageId: page.id },
        status: 200,
      };
    },
  },
  {
    name: "move view",
    async prepare({ id, pageId }) {
      const { page } = await createPage(owner, id);
      const view = await createView(owner, pageId);
      return {
        method: "PUT",
        path: `/views/${view.id}/page`,
        body: { pageId: page.id },
        status: 200,
      };
    },
  },
  {
    name: "create table",
    prepare({ pageId }) {
      return { method: "POST", path: `/pages/${pageId}/tables`, body: {}, status: 201 };
    },
  },
  {
    name: "rename table",
    prepare({ tableId }) {
      return { method: "PATCH", path: `/tables/${tableId}`, body: { name: "Sales" }, status: 200 };
    },
  },
  {
    name: "write cells",
    prepare({ tableId }) {
      return {
        method: "PUT",
        path: `/tables/${tableId}/cells`,
        body: cellsBody({ C3: "value" }),
        status: 200,
      };
    },
  },
  {
    name: "insert rows",
    async prepare({ tableId }) {
      await owner.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A1: "one", A2: "two" }), 200);
      return {
        method: "POST",
        path: `/tables/${tableId}/edits`,
        body: { axis: "row", kind: "insert", index: 1 },
        status: 200,
      };
    },
  },
  {
    name: "delete a row that formulas and formats cover",
    async prepare({ tableId }) {
      await owner.json(
        "PUT",
        `/tables/${tableId}/cells`,
        cellsBody({ A1: "1", A2: "2", A3: "3", B1: "=A2+A3", B4: "=SUM(A1:A3)" }),
        200,
      );
      await owner.json("POST", `/tables/${tableId}/formats`, {
        range: { startRow: 1, endRow: 2, startCol: 0, endCol: 0 },
        format: { bold: true },
      });
      return {
        method: "POST",
        path: `/tables/${tableId}/edits`,
        body: { axis: "row", kind: "delete", index: 1 },
        status: 200,
      };
    },
  },
  {
    name: "delete a column that a formula column reads",
    async prepare({ tableId }) {
      await owner.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A1: "1", B1: "2" }), 200);
      await owner.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
      await owner.json("PATCH", `/tables/${tableId}/columns/2`, {
        type: "formula",
        formula: "=[Column 1]+[Column 2]",
      });
      return {
        method: "POST",
        path: `/tables/${tableId}/edits`,
        body: { axis: "col", kind: "delete", index: 1 },
        status: 200,
      };
    },
  },
  {
    name: "shrink a table that holds cells and formulas",
    async prepare({ tableId }) {
      await owner.json(
        "PUT",
        `/tables/${tableId}/cells`,
        cellsBody({ A1: "1", A5: "5", B1: "=SUM(A1:A5)", C3: "c" }),
        200,
      );
      return {
        method: "PATCH",
        path: `/tables/${tableId}`,
        body: { rowCount: 3, colCount: 2 },
        status: 200,
      };
    },
  },
  {
    name: "run button action and group its table growth with its cell write",
    async prepare({ tableId }) {
      await owner.json(
        "PUT",
        `/tables/${tableId}/cells`,
        cellsBody({
          A1: "first",
          A2: "last",
          D1: '=BUTTON("Append", APPEND_ROW(A:A, "next"))',
        }),
      );
      await owner.json("PATCH", `/tables/${tableId}`, { rowCount: 2 });
      return { method: "POST", path: `/tables/${tableId}/cells/0/3/click`, status: 200 };
    },
  },
  {
    name: "write a cell into a new row",
    async prepare({ id, tableId }) {
      await owner.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A1: "first" }));
      await owner.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
      const [colId] = (await readSnapshot(owner, id)).tables[0]!.colIds;
      const rowId = randomUUID();
      return {
        method: "PUT",
        path: `/tables/${tableId}/cells`,
        body: { appendRows: [rowId], cells: [{ rowId, colId, input: "second" }] },
        status: 200,
      };
    },
  },
  {
    name: "paste past the end of a table",
    async prepare({ id, tableId }) {
      await owner.json("PATCH", `/tables/${tableId}`, { rowCount: 2 });
      const before = await readSnapshot(owner, id);
      const [colId] = before.tables[0]!.colIds;
      const added = [randomUUID(), randomUUID()];
      const rows = [rowIds(before, tableId)[1]!, ...added];
      return {
        method: "PUT",
        path: `/tables/${tableId}/cells`,
        body: {
          appendRows: added,
          cells: rows.map((rowId, index) => ({ rowId, colId, input: `pasted ${String(index)}` })),
        },
        status: 200,
      };
    },
  },
  {
    name: "run an action that overwrites a data table and deletes the rows it empties",
    async prepare({ pageId, tableId }) {
      await owner.json(
        "PUT",
        `/tables/${tableId}/cells`,
        cellsBody({ A1: "one", B1: "1", A2: "two", B2: "2", A3: "three", B3: "=SUM(B1:B2)" }),
      );
      await owner.json("PATCH", `/tables/${tableId}`, { colCount: 2 });
      await owner.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
      const { table } = await owner.json<{ table: { id: string } }>(
        "POST",
        `/pages/${pageId}/tables`,
        {},
        201,
      );
      await owner.json(
        "PUT",
        `/tables/${table.id}/cells`,
        cellsBody({
          A1: "kept",
          B1: "9",
          C1: `=BUTTON("Replace", OVERWRITE(A1:B1, 'Table 1'!A:B))`,
          D1: "=SUM('Table 1'!B1:B3)",
        }),
      );
      return { method: "POST", path: `/tables/${table.id}/cells/0/2/click`, status: 200 };
    },
  },
  {
    name: "store a checkbox choice",
    async prepare({ tableId }) {
      await owner.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A2: "=CHECKBOX(B2)" }), 200);
      return {
        method: "POST",
        path: `/tables/${tableId}/cells/1/0/input`,
        body: { value: true },
        status: 200,
      };
    },
  },
  {
    name: "format cells",
    prepare({ tableId }) {
      return {
        method: "POST",
        path: `/tables/${tableId}/formats`,
        body: { range: { startRow: 0, endRow: 0, startCol: 0, endCol: 0 }, format: { bold: true } },
        status: 200,
      };
    },
  },
  {
    name: "set a table's conditional formats",
    async prepare({ id, tableId }) {
      const read = await readSnapshot(owner, id);
      const [colId] = read.tables[0]!.colIds;
      const [rowId] = rowIds(read, tableId);
      return {
        method: "PUT",
        path: `/tables/${tableId}/conditional-formats`,
        body: {
          rules: [
            {
              range: { startRowId: rowId, endRowId: null, startColId: colId, endColId: colId },
              kind: "criterion",
              criterion: ">3",
              format: { fill: "green" },
            },
          ],
        },
        status: 200,
      };
    },
  },
  {
    name: "set a table's names",
    prepare({ tableId }) {
      return {
        method: "PUT",
        path: `/tables/${tableId}/names`,
        body: { names: [{ name: "Corner", formula: "A1" }] },
        status: 200,
      };
    },
  },
  {
    name: "resize a table's columns",
    async prepare({ id, tableId }) {
      const read = await readSnapshot(owner, id);
      return {
        method: "PUT",
        path: `/tables/${tableId}/grid-sizes`,
        body: { axis: "col", ids: [read.tables[0]!.colIds[0]], size: 180 },
        status: 200,
      };
    },
  },
  {
    name: "resize a table's rows",
    async prepare({ id, tableId }) {
      const read = await readSnapshot(owner, id);
      return {
        method: "PUT",
        path: `/tables/${tableId}/grid-sizes`,
        body: { axis: "row", ids: rowIds(read, tableId).slice(0, 2), size: 60 },
        status: 200,
      };
    },
  },
  {
    name: "name columns",
    prepare({ tableId }) {
      return {
        method: "POST",
        path: `/tables/${tableId}/columns`,
        body: { headerRow: false },
        status: 200,
      };
    },
  },
  {
    name: "name columns from the first row",
    async prepare({ tableId }) {
      await owner.json(
        "PUT",
        `/tables/${tableId}/cells`,
        cellsBody({ A1: "Name", B1: "Amount", A2: "x", B2: "=A2" }),
        200,
      );
      return {
        method: "POST",
        path: `/tables/${tableId}/columns`,
        body: { headerRow: true },
        status: 200,
      };
    },
  },
  {
    name: "update a named column",
    async prepare({ tableId }) {
      await owner.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
      return {
        method: "PATCH",
        path: `/tables/${tableId}/columns/0`,
        body: { name: "Revenue" },
        status: 200,
      };
    },
  },
  {
    name: "sort and filter a data table",
    async prepare({ id, tableId }) {
      await owner.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
      const [colId] = (await readSnapshot(owner, id)).tables[0]!.colIds;
      const revision = (await readSnapshot(owner, id)).revision;
      return {
        method: "PUT",
        path: `/tables/${tableId}/display`,
        body: { sort: [{ colId, descending: true }], filter: "=[Column 1] <> 1", revision },
        status: 200,
      };
    },
  },
  {
    name: "give a column choices",
    async prepare({ tableId }) {
      await owner.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
      return {
        method: "PATCH",
        path: `/tables/${tableId}/columns/0`,
        body: { type: "choice", choices: ["Trial", "Sprint"] },
        status: 200,
      };
    },
  },
  {
    name: "drop named columns",
    async prepare({ tableId }) {
      await owner.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
      return { method: "DELETE", path: `/tables/${tableId}/columns`, status: 200 };
    },
  },
  {
    name: "create a text view",
    prepare({ pageId }) {
      return {
        method: "POST",
        path: `/pages/${pageId}/views`,
        body: { kind: "text" },
        status: 201,
      };
    },
  },
  {
    name: "update a chart",
    async prepare({ pageId }) {
      const view = await createView(owner, pageId, "chart");
      return {
        method: "PATCH",
        path: `/views/${view.id}`,
        body: { source: "A1:B2", chartType: "pie" },
        status: 200,
      };
    },
  },
  {
    name: "delete a view",
    async prepare({ pageId }) {
      const view = await createView(owner, pageId);
      return { method: "DELETE", path: `/views/${view.id}`, status: 200 };
    },
  },
  {
    name: "delete a table",
    prepare({ tableId }) {
      return { method: "DELETE", path: `/tables/${tableId}`, status: 200 };
    },
  },
  {
    name: "delete a page",
    async prepare({ id }) {
      const { page } = await createPage(owner, id);
      return { method: "DELETE", path: `/pages/${page.id}`, status: 200 };
    },
  },
];

function content(snapshot: TestSnapshot) {
  return {
    id: snapshot.id,
    name: snapshot.name,
    role: snapshot.role,
    rows: [...snapshot.rows].sort((left, right) => left.id.localeCompare(right.id)),
    pages: [...snapshot.pages].sort((left, right) => left.id.localeCompare(right.id)),
    tables: [...snapshot.tables].sort((left, right) => left.id.localeCompare(right.id)),
    views: [...snapshot.views].sort((left, right) => left.id.localeCompare(right.id)),
    cells: [...snapshot.cells].sort(
      (left, right) =>
        left.tableId.localeCompare(right.tableId) || left.row - right.row || left.col - right.col,
    ),
  };
}

/**
 * The routes that change something and are not undone with Ctrl+Z: they
 * change the spreadsheet as a whole or who may open it, or they are undo and
 * redo themselves. Every other route that changes something needs a case in
 * `routeCases`.
 */
const NOT_JOURNALED = [
  "POST /spreadsheets",
  "POST /spreadsheets/import",
  "POST /spreadsheets/:spreadsheetId/copy",
  "PATCH /spreadsheets/:spreadsheetId",
  "DELETE /spreadsheets/:spreadsheetId",
  "PUT /spreadsheets/:spreadsheetId/members",
  "DELETE /spreadsheets/:spreadsheetId/members/:userId",
  "POST /spreadsheets/:spreadsheetId/versions/:versionId/restore",
  "POST /spreadsheets/:spreadsheetId/versions/:versionId/copy",
  "POST /spreadsheets/:spreadsheetId/undo",
  "POST /spreadsheets/:spreadsheetId/redo",
];

describe("undo round trips", () => {
  it.each(["table", "chart", "text"])("restores block order after inserting a %s", async (kind) => {
    const fixture = await fresh();
    await addView(owner, fixture.pageId, "chart");
    await addTable(owner, fixture.pageId);
    const client = withClientId(owner);
    const before = content(await snapshot(client, fixture.id));
    await client.json(
      "POST",
      `/pages/${fixture.pageId}/${kind === "table" ? "tables" : "views"}`,
      { position: 1, ...(kind === "table" ? {} : { kind }) },
      201,
    );
    const after = content(await snapshot(client, fixture.id));
    expect(after).not.toEqual(before);
    expect(
      (await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).outcome,
    ).toBe("done");
    expect(content(await snapshot(client, fixture.id))).toEqual(before);
    expect(
      (await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/redo`)).outcome,
    ).toBe("done");
    expect(content(await snapshot(client, fixture.id))).toEqual(after);
  });

  /** The routes the cases sent their requests to. */
  const roundTripped = new Set<string>();

  for (const route of routeCases) {
    it(`restores and reapplies ${route.name}`, async () => {
      const fixture = await fresh();
      const client = withClientId(owner);
      const request = await route.prepare(fixture);
      roundTripped.add(
        routeOf(server.routes, request.method, request.path) ??
          `${request.method} ${request.path}: no such route`,
      );
      const identities = async () => server.db.select().from(tableRows).orderBy(asc(tableRows.id));
      const rowsBefore = await identities();
      const before = await snapshot(client, fixture.id);
      const response = await client.request(request.method, request.path, request.body);
      expect(response.status, await response.clone().text()).toBe(request.status);
      expect(response.headers.get(UNDOABLE_HEADER)).toBe("1");
      const after = await snapshot(client, fixture.id);
      const rowsAfter = await identities();
      expect(content(after)).not.toEqual(content(before));

      const undone = await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`);
      expect(undone.error).toBeNull();
      expect(undone).toMatchObject({ outcome: "done", undoable: false, redoable: true });
      expect(content(await snapshot(client, fixture.id))).toEqual(content(before));
      expect(await identities()).toEqual(rowsBefore);

      const redone = await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/redo`);
      expect(redone.error).toBeNull();
      expect(redone).toMatchObject({ outcome: "done", undoable: true, redoable: false });
      expect(content(await snapshot(client, fixture.id))).toEqual(content(after));
      expect(await identities()).toEqual(rowsAfter);
    });
  }

  // Runs after the cases, which is the order tests in a file run in. A new
  // route that changes something fails here until it has a case above or a
  // line in NOT_JOURNALED.
  it("cover every route that changes content", () => {
    const changing = server.routes.filter((route) => !route.startsWith("GET "));
    expect([...roundTripped, ...NOT_JOURNALED].sort()).toEqual(changing);
  });
});

describe("journal identity and grouping", () => {
  it("groups requests with the same step id", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    const stepId = randomUUID();
    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "a" }), {
      [STEP_ID_HEADER]: stepId,
    });
    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "b" }), {
      [STEP_ID_HEADER]: stepId,
    });
    const undone = await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`);
    expect(undone.outcome).toBe("done");
    expect((await snapshot(client, fixture.id)).cells).toEqual([]);
  });

  it("keeps the stacks of two tabs separate", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "a" }));
    await second.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "b" }));
    expect(await snapshot(first, fixture.id)).toMatchObject({ undoable: true, redoable: false });
    expect(await snapshot(second, fixture.id)).toMatchObject({ undoable: true, redoable: false });

    expect((await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).outcome).toBe(
      "done",
    );
    expect(await snapshot(second, fixture.id)).toMatchObject({ undoable: true, redoable: false });
    expect(
      (await second.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).outcome,
    ).toBe("done");
    expect((await snapshot(owner, fixture.id)).cells).toEqual([]);
  });

  it("scopes a reused step id to its user", async () => {
    const fixture = await fresh();
    const editor = await server.signUp("Undo editor");
    await owner.json("PUT", `/spreadsheets/${fixture.id}/members`, {
      email: editor.email,
      role: "editor",
    });
    const stepId = randomUUID();
    const ownerClient = withClientId(owner, "00000000-0000-4000-8000-000000000001");
    const editorClient = withClientId(editor, "00000000-0000-4000-8000-000000000001");
    await ownerClient.request(
      "PUT",
      `/tables/${fixture.tableId}/cells`,
      cellsBody({ A1: "owner" }),
      {
        [STEP_ID_HEADER]: stepId,
      },
    );
    await editorClient.request(
      "PUT",
      `/tables/${fixture.tableId}/cells`,
      cellsBody({ B1: "editor" }),
      {
        [STEP_ID_HEADER]: stepId,
      },
    );
    expect(
      (await ownerClient.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).outcome,
    ).toBe("done");
    expect(
      (await editorClient.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).outcome,
    ).toBe("done");
    expect((await snapshot(owner, fixture.id)).cells).toEqual([]);
  });

  it("does not put requests without a client id on an undo stack", async () => {
    const fixture = await fresh();
    await owner.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "saved" }));
    const [entry] = await server.db
      .select({ clientId: journal.clientId, data: journal.data })
      .from(journal)
      .where(eq(journal.spreadsheetId, fixture.id));
    expect(entry?.clientId).toBeNull();
    expect(entry?.data?.cells).toHaveLength(1);
    expect(await snapshot(owner, fixture.id)).toMatchObject({ undoable: false, redoable: false });
    expect(await owner.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "nothing",
      undoable: false,
      redoable: false,
    });
    expect((await snapshot(owner, fixture.id)).cells).toHaveLength(1);
  });

  it("rejects a malformed step id without changing content", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    const response = await client.request(
      "PUT",
      `/tables/${fixture.tableId}/cells`,
      cellsBody({ A1: "saved" }),
      { [STEP_ID_HEADER]: "not-a-uuid" },
    );
    expect(response.status).toBe(400);
    expect((await snapshot(client, fixture.id)).cells).toEqual([]);
  });

  it("clears redo after a new change and clears the journal after restore", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "one" }));
    const versions = await owner.json<{ id: string }[]>(
      "GET",
      `/spreadsheets/${fixture.id}/versions`,
    );
    await client.json("POST", `/spreadsheets/${fixture.id}/undo`);
    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "two" }));
    expect(await snapshot(client, fixture.id)).toMatchObject({ undoable: true, redoable: false });

    await owner.json(
      "POST",
      `/spreadsheets/${fixture.id}/versions/${versions[0]!.id}/restore`,
      undefined,
      200,
    );
    expect(await snapshot(client, fixture.id)).toMatchObject({ undoable: false, redoable: false });
  });

  it("creates a spreadsheet without an undo step", async () => {
    const client = withClientId(owner);
    const response = await client.request("POST", "/spreadsheets", { name: "No first step" });
    const created = (await response.json()) as { id: string };
    expect(response.status).toBe(201);
    expect(response.headers.get(UNDOABLE_HEADER)).toBeNull();
    expect(await snapshot(client, created.id)).toMatchObject({ undoable: false, redoable: false });
    expect(await client.json<UndoResult>("POST", `/spreadsheets/${created.id}/undo`)).toMatchObject(
      {
        outcome: "nothing",
        undoable: false,
        redoable: false,
      },
    );
  });
});

describe("refused history operations", () => {
  it("refuses a cell changed by another tab, then exposes the previous step", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "older" }));
    await first.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "first" }));
    await second.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "second" }));

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      undoable: true,
      redoable: false,
    });
    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "done",
      undoable: false,
    });
    const current = await snapshot(owner, fixture.id);
    expect(current.cells.map((cell) => cell.input)).toEqual(["second"]);
  });

  it("undoes a step of typed values when a row insert came between its requests", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    const step = { [STEP_ID_HEADER]: randomUUID() };
    const cells = `/tables/${fixture.tableId}/cells`;
    await first.request("PUT", cells, cellsBody({ A1: "one" }), step);
    await second.request("POST", `/tables/${fixture.tableId}/edits`, {
      axis: "row",
      kind: "insert",
      index: 0,
    });
    await first.request("PUT", cells, cellsBody({ B2: "two" }), step);

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "done",
      undoable: false,
    });
    expect((await snapshot(owner, fixture.id)).cells).toEqual([]);
  });

  it("refuses undo of a structural change after a later active write", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    await createPage(first, fixture.id);
    await second.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "later" }));
    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      undoable: false,
      redoable: false,
    });
  });

  it("refuses redo when another tab changed the cell", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "first" }));
    await first.json("POST", `/spreadsheets/${fixture.id}/undo`);
    await second.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "second" }));
    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/redo`)).toMatchObject({
      outcome: "refused",
      undoable: false,
      redoable: false,
    });
  });

  it("refuses undo when another tab typed over the cell and then typed the same value", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    const cells = `/tables/${fixture.tableId}/cells`;
    await first.request("PUT", cells, cellsBody({ A1: "same" }));
    await second.request("PUT", cells, cellsBody({ A1: "other" }));
    // The cell holds what the first tab's step left, and the second tab is who put it there.
    await second.request("PUT", cells, cellsBody({ A1: "same" }));

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      error: "A later change to the same content prevents undoing this change",
      undoable: false,
    });
    expect((await snapshot(owner, fixture.id)).cells.map((cell) => cell.input)).toEqual(["same"]);
  });

  it("undoes once the other tab has undone its changes to the cell", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    const cells = `/tables/${fixture.tableId}/cells`;
    await first.request("PUT", cells, cellsBody({ A1: "same" }));
    await second.request("PUT", cells, cellsBody({ A1: "other" }));
    await second.json("POST", `/spreadsheets/${fixture.id}/undo`);

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "done",
    });
    expect((await snapshot(owner, fixture.id)).cells).toEqual([]);
  });

  it("refuses redo when another tab filled the cell and then emptied it", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    const cells = `/tables/${fixture.tableId}/cells`;
    await first.request("PUT", cells, cellsBody({ A1: "first" }));
    await first.json("POST", `/spreadsheets/${fixture.id}/undo`);
    await second.request("PUT", cells, cellsBody({ A1: "second" }));
    await second.request("PUT", cells, cellsBody({ A1: "" }));

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/redo`)).toMatchObject({
      outcome: "refused",
      error: "A later change to the same content prevents redoing this change",
      redoable: false,
    });
    expect((await snapshot(owner, fixture.id)).cells).toEqual([]);
  });

  it("refuses undo when another tab changed the view and then changed it back", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    const view = await createView(owner, fixture.pageId);
    await first.request("PATCH", `/views/${view.id}`, { source: "same" });
    await second.request("PATCH", `/views/${view.id}`, { source: "other" });
    await second.request("PATCH", `/views/${view.id}`, { source: "same" });

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      error: "A later change to the same content prevents undoing this change",
    });
    expect((await snapshot(owner, fixture.id)).views[0]?.source).toBe("same");
  });

  it("refuses a cell whose table another tab deleted, then exposes the previous step", async () => {
    const fixture = await fresh();
    const added = await addTable(owner, fixture.pageId);
    await owner.json("PUT", `/tables/${added.id}/cells`, cellsBody({ A1: "typed" }), 200);
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "older" }));
    // The cell is empty before and after the table goes, so only the missing table stops the undo.
    await first.request("PUT", `/tables/${added.id}/cells`, cellsBody({ A1: "" }));
    await second.json("DELETE", `/tables/${added.id}`, undefined, 200);

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      error: "This change belongs to a page or table that has since been deleted",
      undoable: true,
    });
    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "done",
      undoable: false,
    });
  });

  it("refuses a cell whose page another tab deleted", async () => {
    const fixture = await fresh();
    const { page, table } = await createPage(owner, fixture.id);
    await owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "typed" }), 200);
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "" }));
    await second.json("DELETE", `/pages/${page.id}`, undefined, 200);

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      undoable: false,
    });
  });

  it("refuses a cell that another tab's formula column now computes", async () => {
    const fixture = await fresh();
    await owner.json("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "typed" }), 200);
    await owner.json("POST", `/tables/${fixture.tableId}/columns`, { headerRow: false });
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "" }));
    await second.json("PATCH", `/tables/${fixture.tableId}/columns/1`, {
      type: "formula",
      formula: "=[Column 1]",
    });

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      error: "This change would store a value in a formula column",
    });
    expect((await snapshot(owner, fixture.id)).cells).toEqual([]);
  });

  it("reports no undoable step and publishes no change for a click whose writes were rolled back", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    await owner.json(
      "PUT",
      `/tables/${fixture.tableId}/cells`,
      cellsBody({
        A1: "first",
        A2: "last",
        // The row is added, and then the second write is refused as too long.
        D1: `=BUTTON("Append", DO(APPEND_ROW(A:A, "next"), EXECUTE(REPT("x", ${String(LIMITS.inputLength + 1)}), C1)))`,
      }),
    );
    await owner.json("PATCH", `/tables/${fixture.tableId}`, { rowCount: 2 });

    await expectNoChangeEvent(fixture.id, async () => {
      const response = await client.request("POST", `/tables/${fixture.tableId}/cells/0/3/click`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "failed", change: null });
      expect(response.headers.get(UNDOABLE_HEADER)).toBeNull();
    });
    expect(await snapshot(client, fixture.id)).toMatchObject({ undoable: false });
  });

  it("does not touch a spreadsheet or publish a change for a refused undo", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "first" }));
    await second.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "second" }));
    const before = await versionState(fixture.id);

    await expectNoChangeEvent(fixture.id, async () => {
      expect(
        await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`),
      ).toMatchObject({ outcome: "refused" });
    });
    expect(await versionState(fixture.id)).toEqual(before);
  });

  it("does not touch a spreadsheet or publish a change when undo has nothing to do", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    const before = await versionState(fixture.id);

    await expectNoChangeEvent(fixture.id, async () => {
      expect(
        await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`),
      ).toMatchObject({
        outcome: "nothing",
      });
    });
    expect(await versionState(fixture.id)).toEqual(before);
  });
});

describe("undo beside changes to rows and columns", () => {
  /** A spreadsheet that Ada and Grace both have open. */
  async function shared() {
    const fixture = await fresh();
    const cells = `/tables/${fixture.tableId}/cells`;
    const edits = `/tables/${fixture.tableId}/edits`;
    const undo = (client: TestClient) =>
      client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`);
    const redo = (client: TestClient) =>
      client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/redo`);
    const stored = () => storedInputs(owner, fixture.id, fixture.tableId);
    const rows = async () => rowIds(await snapshot(owner, fixture.id), fixture.tableId);
    const [ada, grace] = [withClientId(owner), withClientId(owner)];
    return { ...fixture, ada, grace, cells, edits, undo, redo, stored, rows };
  }
  const insertRow = (index: number) => ({ axis: "row", kind: "insert", index });
  const deleteRow = (index: number) => ({ axis: "row", kind: "delete", index });

  it("undoes and redoes a typed value after a row is inserted above it", async () => {
    const { ada, grace, cells, edits, undo, redo, stored } = await shared();
    await ada.json("PUT", cells, cellsBody({ A3: "typed" }));
    await grace.json("POST", edits, insertRow(0));
    expect(await stored()).toEqual({ "3:0": "typed" });

    expect(await undo(ada)).toMatchObject({ outcome: "done" });
    expect(await stored()).toEqual({});
    expect(await redo(ada)).toMatchObject({ outcome: "done" });
    expect(await stored()).toEqual({ "3:0": "typed" });
  });

  it("undoes a row insert after a value is typed elsewhere", async () => {
    const { ada, grace, cells, edits, undo, stored } = await shared();
    await grace.json("POST", edits, insertRow(0));
    await ada.json("PUT", cells, cellsBody({ A5: "typed" }));
    expect(await undo(grace)).toMatchObject({ outcome: "done" });
    expect(await stored()).toEqual({ "3:0": "typed" });
  });

  it("refuses to undo a row insert once someone typed into the new row", async () => {
    const { ada, grace, cells, edits, undo, stored } = await shared();
    await grace.json("POST", edits, insertRow(0));
    await ada.json("PUT", cells, cellsBody({ A1: "in the new row" }));
    expect(await undo(grace)).toMatchObject({
      outcome: "refused",
      error: "A row this step added now holds something typed since",
    });
    expect(await stored()).toEqual({ "0:0": "in the new row" });
  });

  it("undoes a row insert together with what the same step wrote into the row", async () => {
    const { id, tableId, ada, cells, undo, rows, stored } = await shared();
    const [colId] = (await snapshot(owner, id)).tables[0]!.colIds;
    const before = await rows();
    const rowId = randomUUID();
    await ada.json("PUT", cells, { appendRows: [rowId], cells: [{ rowId, colId, input: "new" }] });
    expect(await rows()).toEqual([...before, rowId]);
    expect(await undo(ada)).toMatchObject({ outcome: "done" });
    expect(await rows()).toEqual(before);
    expect(await stored()).toEqual({});
    expect(tableId).toBeDefined();
  });

  it("refuses to put a formula back after a row was inserted, because its references are stale", async () => {
    const { ada, grace, cells, edits, undo, stored } = await shared();
    await owner.json("PUT", cells, cellsBody({ A5: "5", B1: "=A5" }));
    await ada.json("PUT", cells, cellsBody({ B1: "7" }));
    await grace.json("POST", edits, insertRow(0));
    expect(await undo(ada)).toMatchObject({
      outcome: "refused",
      error: "A later change to rows, columns, or names prevents undoing this change to a formula",
    });
    expect(await stored()).toEqual({ "5:0": "5", "1:1": "7" });
  });

  it("refuses to undo a row insert after a formula was written, even in a table that held none", async () => {
    const { ada, grace, cells, edits, undo, stored } = await shared();
    await grace.json("POST", edits, insertRow(0));
    await ada.json("PUT", cells, cellsBody({ D1: "=A6" }));
    expect(await undo(grace)).toMatchObject({
      outcome: "refused",
      error: "A formula written since prevents undoing this change to rows, columns, or names",
    });
    expect(await stored()).toEqual({ "0:3": "=A6" });
  });

  it.each([
    ["the first insert first", ["grace", "ada"]],
    ["the second insert first", ["ada", "grace"]],
  ] as const)("lets two people each undo a row insert, %s", async (_, order) => {
    const session = await shared();
    const before = await session.rows();
    await session.grace.json("POST", session.edits, insertRow(0));
    await session.ada.json("POST", session.edits, insertRow(5));
    expect(await session.rows()).toHaveLength(before.length + 2);
    for (const who of order) {
      expect(await session.undo(session[who])).toMatchObject({ outcome: "done" });
    }
    expect(await session.rows()).toEqual(before);
  });

  it("refuses to undo a row delete that rewrote a formula once a row is inserted above", async () => {
    const { ada, grace, cells, edits, undo, stored } = await shared();
    await owner.json("PUT", cells, cellsBody({ A5: "5", B1: "=A5" }));
    await grace.json("POST", edits, deleteRow(4));
    expect(await stored()).toEqual({ "0:1": "=#REF!" });
    await ada.json("POST", edits, insertRow(0));
    expect(await undo(grace)).toMatchObject({ outcome: "refused" });
    expect(await stored()).toEqual({ "1:1": "=#REF!" });
  });

  it("puts a deleted row back beside the row that has taken its key since", async () => {
    const { ada, grace, cells, edits, undo, redo, rows, stored } = await shared();
    await owner.json("PUT", cells, cellsBody({ A2: "deleted and restored" }));
    const before = await rows();
    await grace.json("POST", edits, deleteRow(1));
    await ada.json("POST", edits, insertRow(1));
    const [inserted] = (await rows()).filter((id) => !before.includes(id));
    // The new row sits where the deleted one did, and was given the same key.
    expect((await rows())[1]).toBe(inserted);

    expect(await undo(grace)).toMatchObject({ outcome: "done" });
    expect(await rows()).toEqual([before[0], inserted, before[1], ...before.slice(2)]);
    expect(await stored()).toEqual({ "2:0": "deleted and restored" });

    expect(await redo(grace)).toMatchObject({ outcome: "done" });
    expect(await rows()).toEqual([before[0], inserted, ...before.slice(2)]);
    expect(await undo(grace)).toMatchObject({ outcome: "done" });
    expect(await rows()).toHaveLength(before.length + 1);
    expect(await rows()).toEqual(expect.arrayContaining([inserted, before[1]]));
  });

  it("refuses to undo a cleared cell once its column is deleted, and stores no cell for the column", async () => {
    const { id, ada, grace, cells, edits, undo } = await shared();
    await owner.json("PUT", cells, cellsBody({ B1: "typed" }));
    await ada.json("PUT", cells, cellsBody({ B1: "" }));
    await grace.json("POST", edits, { axis: "col", kind: "delete", index: 1 });
    expect(await undo(ada)).toMatchObject({
      outcome: "refused",
      error: "This change would leave a cell in a column its table no longer has",
    });
    expect((await snapshot(owner, id)).cells).toEqual([]);
  });

  it("writes one row record and no cell to insert a row above a full table of cells", async () => {
    const { id, tableId, grace, cells, edits } = await shared();
    await owner.json("PATCH", `/tables/${tableId}`, { rowCount: 50, colCount: 100 });
    const filled = Object.fromEntries(
      Array.from({ length: 5000 }, (_, index) => {
        const [row, col] = [Math.floor(index / 100), index % 100];
        return [`${columnLabel(col)}${String(row + 1)}`, String(index)];
      }),
    );
    for (const batch of chunks(Object.entries(filled), LIMITS.cellsPerRequest)) {
      await owner.json("PUT", cells, cellsBody(Object.fromEntries(batch)));
    }
    const stamps = async () =>
      server.db
        .select({ rowId: cellRecords.rowId, colId: cellRecords.colId, at: cellRecords.updatedAt })
        .from(cellRecords)
        .where(eq(cellRecords.tableId, tableId))
        .orderBy(asc(cellRecords.rowId), asc(cellRecords.colId));
    const before = await stamps();
    expect(before).toHaveLength(5000);

    await grace.json("POST", edits, insertRow(0));
    expect(await stamps()).toEqual(before);
    const [entry] = await server.db
      .select({ bytes: journal.bytes, data: journal.data })
      .from(journal)
      .where(eq(journal.spreadsheetId, id))
      .orderBy(desc(journal.seq))
      .limit(1);
    expect(entry?.data).toMatchObject({ cells: [], tables: [] });
    expect(entry?.data?.rows[0]?.changes).toHaveLength(1);
    expect(entry?.bytes).toBeLessThan(500);
  });
});

describe("a sequence of structural, naming, and formatting changes", () => {
  it("undoes and redoes all four steps in order", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    const before = await snapshot(client, fixture.id);

    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "value" }));
    await client.request("POST", `/tables/${fixture.tableId}/edits`, {
      axis: "row",
      kind: "insert",
      index: 0,
    });
    await client.request("PATCH", `/tables/${fixture.tableId}`, { name: "Sales" });
    await client.request("POST", `/tables/${fixture.tableId}/formats`, {
      range: { startRow: 1, endRow: 1, startCol: 0, endCol: 0 },
      format: { bold: true },
    });
    const after = await snapshot(client, fixture.id);

    for (let step = 0; step < 4; step += 1) {
      expect(
        await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`),
      ).toMatchObject({ outcome: "done" });
    }
    expect(content(await snapshot(client, fixture.id))).toEqual(content(before));

    for (let step = 0; step < 4; step += 1) {
      expect(
        await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/redo`),
      ).toMatchObject({ outcome: "done" });
    }
    expect(content(await snapshot(client, fixture.id))).toEqual(content(after));
  });
});

describe("pruning limits", () => {
  async function limitedServer(journalLimits: Partial<JournalLimits>) {
    const app = await startTestServer({ repositoryOptions: { journalLimits } });
    const user = await app.signUp("Limited history");
    return { app, user, close: () => app.close() };
  }

  it("keeps the newest entries and takes a partly pruned step off the stack", async () => {
    const limited = await limitedServer({ journalEntries: 2, journalBytes: 1_000_000 });
    try {
      const fixture = await fresh(limited.user);
      const client = withClientId(limited.user);
      const stepId = randomUUID();
      await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "a" }), {
        [STEP_ID_HEADER]: stepId,
      });
      await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "b" }), {
        [STEP_ID_HEADER]: stepId,
      });
      await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ C1: "c" }));
      const entries = await limited.app.db
        .select({ clientId: journal.clientId, input: journal.data })
        .from(journal)
        .where(eq(journal.spreadsheetId, fixture.id));
      expect(entries).toHaveLength(2);
      const { colIds } = (await snapshot(client, fixture.id)).tables[0]!;
      expect(
        entries.find((entry) =>
          entry.input?.cells.some((group) =>
            group.changes.some(([, colId]) => colId === colIds[1]),
          ),
        )?.clientId,
      ).toBeNull();
      expect(
        await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`),
      ).toMatchObject({ outcome: "done" });
      expect(
        await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`),
      ).toMatchObject({ outcome: "nothing" });
      expect((await snapshot(client, fixture.id)).cells.map((cell) => cell.input)).toEqual([
        "a",
        "b",
      ]);
    } finally {
      await limited.close();
    }
  });

  it("prunes the oldest entries when the journal is over its size", async () => {
    const limited = await limitedServer({
      journalBytes: 400,
      journalEntryBytes: 1000,
      journalEntries: 200,
    });
    try {
      const fixture = await fresh(limited.user);
      const client = withClientId(limited.user);
      const columns = ["A", "B", "C", "D", "E", "F", "G", "H"];
      for (const [index, col] of columns.entries()) {
        await client.request(
          "PUT",
          `/tables/${fixture.tableId}/cells`,
          cellsBody({ [`${col}1`]: String(index) }),
        );
      }
      const kept = await limited.app.db
        .select({ bytes: journal.bytes, data: journal.data })
        .from(journal)
        .where(eq(journal.spreadsheetId, fixture.id))
        .orderBy(journal.seq);
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.length).toBeLessThan(columns.length);
      expect(kept.reduce((sum, entry) => sum + entry.bytes, 0)).toBeLessThanOrEqual(400);
      // The newest change is among the kept ones: H1 is in the first row and the last column.
      const after = await snapshot(client, fixture.id);
      expect(kept.at(-1)?.data?.cells[0]?.changes[0]?.slice(0, 2)).toEqual([
        rowIds(after, fixture.tableId)[0],
        after.tables[0]?.colIds[7],
      ]);
    } finally {
      await limited.close();
    }
  });

  it("prunes an entry older than the age limit when a later change is recorded", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "old" }));
    await server.db
      .update(journal)
      .set({ createdAt: new Date(Date.now() - LIMITS.journalAgeMs - 60_000) })
      .where(eq(journal.spreadsheetId, fixture.id));
    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "new" }));

    expect(
      await server.db.select().from(journal).where(eq(journal.spreadsheetId, fixture.id)),
    ).toHaveLength(1);
    expect(await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject(
      { outcome: "done", undoable: false },
    );
    expect((await snapshot(client, fixture.id)).cells.map((cell) => cell.input)).toEqual(["old"]);
  });

  it("does not undo a step older than the age limit in a spreadsheet nobody has changed since", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "kept" }));
    await server.db
      .update(journal)
      .set({ createdAt: new Date(Date.now() - LIMITS.journalAgeMs - 60_000) })
      .where(eq(journal.spreadsheetId, fixture.id));

    expect(await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject(
      { outcome: "nothing", undoable: false },
    );
    expect((await snapshot(client, fixture.id)).cells.map((cell) => cell.input)).toEqual(["kept"]);
    expect(
      await server.db.select().from(journal).where(eq(journal.spreadsheetId, fixture.id)),
    ).toEqual([]);
  });

  it("keeps an oversized change but refuses to undo it", async () => {
    const limited = await limitedServer({ journalEntryBytes: 1 });
    try {
      const fixture = await fresh(limited.user);
      const client = withClientId(limited.user);
      const response = await client.request(
        "PUT",
        `/tables/${fixture.tableId}/cells`,
        cellsBody({ A1: "large enough" }),
      );
      expect(response.status).toBe(200);
      const [entry] = await limited.app.db
        .select({ data: journal.data, bytes: journal.bytes })
        .from(journal)
        .where(eq(journal.spreadsheetId, fixture.id));
      expect(entry).toEqual({ data: null, bytes: 0 });
      expect(
        await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`),
      ).toMatchObject({
        outcome: "refused",
        error: expect.stringContaining("too large"),
      });
      expect((await snapshot(client, fixture.id)).cells).toHaveLength(1);
    } finally {
      await limited.close();
    }
  });
});

describe("content checks during undo", () => {
  it("restores a typed value when a formula column is made and then undone", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "value" }));
    await client.json("POST", `/tables/${fixture.tableId}/columns`, { headerRow: false });
    await client.json("PATCH", `/tables/${fixture.tableId}/columns/0`, {
      type: "formula",
      formula: "=1",
    });
    const undo = await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`);
    expect(undo.error).toBeNull();
    expect(undo.outcome).toBe("done");
    expect((await snapshot(client, fixture.id)).cells[0]?.input).toBe("value");
  });

  it("rejects a page rename that would make a cell formula too long", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    const page = await client.json<{ page: { id: string } }>(
      "POST",
      `/spreadsheets/${fixture.id}/pages`,
      {
        name: "P",
      },
      201,
    );
    const reference = "'P'!'Table 1'!B1";
    const formula = repeatedFormula(reference, 300);
    const longName = "L".repeat(LIMITS.nameLength);
    expect(formula.length).toBeLessThanOrEqual(LIMITS.inputLength);
    expect(repeatedFormula(`'${longName}'!'Table 1'!B1`, 300).length).toBeGreaterThan(
      LIMITS.inputLength,
    );
    await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: formula }));

    const response = await client.request("PATCH", `/pages/${page.page.id}`, { name: longName });
    expect(response.status).toBe(422);
    const current = await snapshot(client, fixture.id);
    expect(current.pages.find(({ id }) => id === page.page.id)?.name).toBe("P");
    expect(current.cells.find(({ row, col }) => row === 0 && col === 0)?.input).toBe(formula);
  });

  it("rejects a column rename that would make a formula column too long", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    await client.request("POST", `/tables/${fixture.tableId}/columns`, { headerRow: false });
    const formula = `=${Array.from({ length: 300 }, () => "[Column 1]").join("+")}`;
    const longName = "L".repeat(LIMITS.nameLength);
    const rewritten = `=${Array.from({ length: 300 }, () => `[${longName}]`).join("+")}`;
    expect(formula.length).toBeLessThanOrEqual(LIMITS.inputLength);
    expect(rewritten.length).toBeGreaterThan(LIMITS.inputLength);
    await client.request("PATCH", `/tables/${fixture.tableId}/columns/1`, {
      type: "formula",
      formula,
    });

    const response = await client.request("PATCH", `/tables/${fixture.tableId}/columns/0`, {
      name: longName,
    });
    expect(response.status).toBe(422);
    expect((await snapshot(client, fixture.id)).tables[0]?.columns?.[0]?.name).toBe("Column 1");
    expect((await snapshot(client, fixture.id)).tables[0]?.columns?.[1]?.formula).toBe(formula);
  });

  it("rejects a page rename that would make a view source too long", async () => {
    const fixture = await fresh();
    const client = withClientId(owner);
    const page = await client.json<{ page: { id: string } }>(
      "POST",
      `/spreadsheets/${fixture.id}/pages`,
      {
        name: "P",
      },
      201,
    );
    const view = await createView(client, page.page.id, "chart");
    const reference = "'P'!'Table 1'!A1";
    const source = repeatedFormula(reference, 600);
    const longName = "L".repeat(LIMITS.nameLength);
    expect(source.length).toBeLessThanOrEqual(LIMITS.viewSourceLength);
    expect(repeatedFormula(`'${longName}'!'Table 1'!A1`, 600).length).toBeGreaterThan(
      LIMITS.viewSourceLength,
    );
    await client.request("PATCH", `/views/${view.id}`, { source });

    const response = await client.request("PATCH", `/pages/${page.page.id}`, { name: longName });
    expect(response.status).toBe(422);
    const current = await snapshot(client, fixture.id);
    expect(current.pages.find(({ id }) => id === page.page.id)?.name).toBe("P");
    expect(current.views.find(({ id }) => id === view.id)?.source).toBe(source);
  });
});
