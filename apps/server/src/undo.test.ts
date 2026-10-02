import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LIMITS,
  STEP_ID_HEADER,
  UNDOABLE_HEADER,
  type JournalLimits,
} from "@spreadsheet-app/shared";
import type { SnapshotWithHistory, UndoResult } from "./app";
import { journal, spreadsheets } from "./db/schema";
import {
  cellsBody,
  createSpreadsheet,
  startTestServer,
  withClientId,
  type TestClient,
  type TestServer,
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

async function snapshot(client: TestClient, id: string): Promise<SnapshotWithHistory> {
  return client.json<SnapshotWithHistory>("GET", `/spreadsheets/${id}`);
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

async function createView(client: TestClient, pageId: string, kind: "chart" | "text" = "text") {
  return client.json<{ id: string }>("POST", `/pages/${pageId}/views`, { kind }, 201);
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
      await owner.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A1: "1" }), 204);
      await owner.json(
        "PUT",
        `/tables/${table.id}/cells`,
        cellsBody({ A1: "='Page 1'!'Table 1'!A1" }),
        204,
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
        status: 204,
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
        status: 204,
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
        status: 204,
      };
    },
  },
  {
    name: "insert rows",
    async prepare({ tableId }) {
      await owner.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A1: "one", A2: "two" }), 204);
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
        204,
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
      await owner.json("POST", `/tables/${tableId}/columns`, { headerRow: false });
      await owner.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A1: "1", B1: "2" }), 204);
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
        204,
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
        204,
      );
      await owner.json("PATCH", `/tables/${tableId}`, { rowCount: 2 });
      return { method: "POST", path: `/tables/${tableId}/cells/0/3/click`, status: 200 };
    },
  },
  {
    name: "store a checkbox choice",
    async prepare({ tableId }) {
      await owner.json("PUT", `/tables/${tableId}/cells`, cellsBody({ A2: "=CHECKBOX(B2)" }), 204);
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
        204,
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
      return { method: "DELETE", path: `/views/${view.id}`, status: 204 };
    },
  },
  {
    name: "delete a table",
    prepare({ tableId }) {
      return { method: "DELETE", path: `/tables/${tableId}`, status: 204 };
    },
  },
  {
    name: "delete a page",
    async prepare({ id }) {
      const { page } = await createPage(owner, id);
      return { method: "DELETE", path: `/pages/${page.id}`, status: 204 };
    },
  },
];

function content(snapshot: SnapshotWithHistory) {
  return {
    id: snapshot.id,
    name: snapshot.name,
    role: snapshot.role,
    pages: [...snapshot.pages].sort((left, right) => left.id.localeCompare(right.id)),
    tables: [...snapshot.tables].sort((left, right) => left.id.localeCompare(right.id)),
    views: [...snapshot.views].sort((left, right) => left.id.localeCompare(right.id)),
    cells: [...snapshot.cells].sort(
      (left, right) =>
        left.tableId.localeCompare(right.tableId) || left.row - right.row || left.col - right.col,
    ),
  };
}

describe("undo round trips", () => {
  for (const route of routeCases) {
    it(`restores and reapplies ${route.name}`, async () => {
      const fixture = await fresh();
      const client = withClientId(owner);
      const request = await route.prepare(fixture);
      const before = await snapshot(client, fixture.id);
      const response = await client.request(request.method, request.path, request.body);
      expect(response.status, await response.clone().text()).toBe(request.status);
      expect(response.headers.get(UNDOABLE_HEADER)).toBe("1");
      const after = await snapshot(client, fixture.id);
      expect(content(after)).not.toEqual(content(before));

      const undone = await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`);
      expect(undone.error).toBeNull();
      expect(undone).toMatchObject({ outcome: "done", undoable: false, redoable: true });
      expect(content(await snapshot(client, fixture.id))).toEqual(content(before));

      const redone = await client.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/redo`);
      expect(redone.error).toBeNull();
      expect(redone).toMatchObject({ outcome: "done", undoable: true, redoable: false });
      expect(content(await snapshot(client, fixture.id))).toEqual(content(after));
    });
  }
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
      204,
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

  it("refuses an older cell edit after a later reference rewrite", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "before" }));
    await second.request("POST", `/tables/${fixture.tableId}/edits`, {
      axis: "row",
      kind: "insert",
      index: 0,
    });
    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      undoable: false,
    });
  });

  it("refuses a step when a reference rewrite came between its requests", async () => {
    const fixture = await fresh();
    const first = withClientId(owner);
    const second = withClientId(owner);
    const step = { [STEP_ID_HEADER]: randomUUID() };
    const cells = `/tables/${fixture.tableId}/cells`;
    await first.request("PUT", cells, cellsBody({ A1: "one" }), step);
    // Below the cells of the step, so every one of them still holds what the step wrote.
    await second.request("POST", `/tables/${fixture.tableId}/edits`, {
      axis: "row",
      kind: "insert",
      index: 5,
    });
    await first.request("PUT", cells, cellsBody({ B1: "two" }), step);

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      error: "A later structural change prevents undoing this change",
      undoable: false,
    });
    expect((await snapshot(owner, fixture.id)).cells.map((cell) => cell.input)).toEqual([
      "one",
      "two",
    ]);
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

  it("refuses a cell whose table another tab deleted, then exposes the previous step", async () => {
    const fixture = await fresh();
    const added = await owner.json<{ id: string }>(
      "POST",
      `/pages/${fixture.pageId}/tables`,
      {},
      201,
    );
    await owner.json("PUT", `/tables/${added.id}/cells`, cellsBody({ A1: "typed" }), 204);
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ A1: "older" }));
    // The cell is empty before and after the table goes, so only the missing table stops the undo.
    await first.request("PUT", `/tables/${added.id}/cells`, cellsBody({ A1: "" }));
    await second.json("DELETE", `/tables/${added.id}`, undefined, 204);

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
    await owner.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "typed" }), 204);
    const first = withClientId(owner);
    const second = withClientId(owner);
    await first.request("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "" }));
    await second.json("DELETE", `/pages/${page.id}`, undefined, 204);

    expect(await first.json<UndoResult>("POST", `/spreadsheets/${fixture.id}/undo`)).toMatchObject({
      outcome: "refused",
      undoable: false,
    });
  });

  it("refuses a cell that another tab's formula column now computes", async () => {
    const fixture = await fresh();
    await owner.json("POST", `/tables/${fixture.tableId}/columns`, { headerRow: false });
    await owner.json("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ B1: "typed" }), 204);
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
      204,
    );
    await owner.json("PATCH", `/tables/${fixture.tableId}`, { rowCount: 2 });

    await expectNoChangeEvent(fixture.id, async () => {
      const response = await client.request("POST", `/tables/${fixture.tableId}/cells/0/3/click`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ status: "failed", tables: [] });
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
      expect(
        entries.find((entry) =>
          entry.input?.cells.some((group) =>
            group.changes.some(([row, col]) => row === 0 && col === 1),
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

  it("prunes by total bytes and by age", async () => {
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
      const [sum] = await limited.app.db
        .select({ bytes: sql<number>`sum(${journal.bytes})`.mapWith(Number) })
        .from(journal)
        .where(eq(journal.spreadsheetId, fixture.id));
      expect(sum?.bytes ?? 0).toBeLessThanOrEqual(400);

      const [oldest] = await limited.app.db
        .select({ seq: journal.seq })
        .from(journal)
        .where(eq(journal.spreadsheetId, fixture.id))
        .orderBy(journal.seq)
        .limit(1);
      if (oldest) {
        await limited.app.db
          .update(journal)
          .set({ createdAt: new Date(Date.now() - 60_000) })
          .where(and(eq(journal.spreadsheetId, fixture.id), eq(journal.seq, oldest.seq)));
      }
      await client.request("PUT", `/tables/${fixture.tableId}/cells`, cellsBody({ D1: "d" }));
      const afterAge = await limited.app.db
        .select({ seq: journal.seq })
        .from(journal)
        .where(eq(journal.spreadsheetId, fixture.id));
      expect(afterAge.every((entry) => entry.seq !== oldest?.seq)).toBe(true);
    } finally {
      await limited.close();
    }
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
      expect(response.status).toBe(204);
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
