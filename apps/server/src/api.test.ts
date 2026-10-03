import { DEFAULT_TABLE_SIZE, LIMITS } from "@spreadsheet-app/shared";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Change, PageRecord, SpreadsheetSummary, TableRecord } from "./app";
import { spreadsheets, workspaceMembers } from "./db/schema";
import {
  addTable,
  cellsBody,
  changedCells,
  createSpreadsheet,
  readSnapshot,
  rowIds,
  startTestServer,
  storedInputs,
  type TestServer,
  type TestSnapshot,
  type TestUser,
} from "./testing";

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp();
});
afterAll(() => server.close());

/** The first page and table of a new spreadsheet. */
function first(snapshot: TestSnapshot): {
  page: PageRecord;
  table: TestSnapshot["tables"][number];
} {
  return { page: snapshot.pages[0]!, table: snapshot.tables[0]! };
}

describe("spreadsheets", () => {
  it("creates a spreadsheet with one page holding one empty table", async () => {
    const snapshot = await createSpreadsheet(user, "  Budget  ");
    expect(snapshot).toMatchObject({ name: "Budget", role: "owner", cells: [] });
    expect(snapshot.pages).toEqual([{ id: expect.any(String), name: "Page 1", position: 0 }]);
    expect(snapshot.tables).toEqual([
      {
        id: expect.any(String),
        pageId: snapshot.pages[0]!.id,
        name: "Table 1",
        position: 0,
        ...DEFAULT_TABLE_SIZE,
        colIds: expect.any(Array),
        columns: null,
        formats: [],
        display: { sort: [] },
        conditionalFormats: [],
        names: [],
      },
    ]);
    expect(snapshot.tables[0]?.colIds).toHaveLength(DEFAULT_TABLE_SIZE.colCount);
    expect(rowIds(snapshot, first(snapshot).table.id)).toHaveLength(DEFAULT_TABLE_SIZE.rowCount);
    expect(snapshot.revision).toBe(1);
  });

  it("lists the user's spreadsheets, most recently changed first", async () => {
    const lister = await server.signUp();
    const older = await createSpreadsheet(lister, "Older");
    const newer = await createSpreadsheet(lister, "Newer");
    const names = async (): Promise<string[]> =>
      (await lister.json<SpreadsheetSummary[]>("GET", "/spreadsheets")).map((item) => item.name);

    expect(await names()).toEqual(["Newer", "Older"]);
    await lister.json("PUT", `/tables/${first(older).table.id}/cells`, cellsBody({ A1: "1" }), 200);
    expect(await names()).toEqual(["Older", "Newer"]);
    expect(newer.id).not.toBe(older.id);
  });

  it("puts all of a user's spreadsheets in one workspace, even when created at once", async () => {
    const creator = await server.signUp();
    const created = await Promise.all([
      createSpreadsheet(creator, "One"),
      createSpreadsheet(creator, "Two"),
      createSpreadsheet(creator, "Three"),
    ]);
    const rows = await server.db
      .select({ workspaceId: spreadsheets.workspaceId })
      .from(spreadsheets)
      .where(
        inArray(
          spreadsheets.id,
          created.map((snapshot) => snapshot.id),
        ),
      );
    expect(new Set(rows.map((row) => row.workspaceId)).size).toBe(1);
    const memberships = await server.db
      .select()
      .from(workspaceMembers)
      .where(inArray(workspaceMembers.userId, [creator.userId]));
    expect(memberships).toMatchObject([{ role: "owner" }]);
  });

  it("renames a spreadsheet", async () => {
    const { id } = await createSpreadsheet(user);
    await user.json("PATCH", `/spreadsheets/${id}`, { name: "Renamed" }, 204);
    expect(await user.json("GET", `/spreadsheets/${id}`)).toMatchObject({ name: "Renamed" });
  });

  it("deletes a spreadsheet", async () => {
    const { id } = await createSpreadsheet(user);
    await user.json("DELETE", `/spreadsheets/${id}`, undefined, 204);
    await user.json("GET", `/spreadsheets/${id}`, undefined, 404);
  });

  it.each([{ name: "" }, { name: "   " }, { name: "x".repeat(LIMITS.nameLength + 1) }, {}])(
    "rejects the name in %j",
    async (body) => {
      const response = await user.json("POST", "/spreadsheets", body, 400);
      expect(response).toMatchObject({ error: { code: "invalid_request" } });
    },
  );

  it("answers 400 for an id that is not a UUID and 404 for one that does not exist", async () => {
    await user.json("GET", "/spreadsheets/not-a-uuid", undefined, 400);
    expect(await user.json("GET", `/spreadsheets/${UNKNOWN_ID}`, undefined, 404)).toEqual({
      error: { code: "not_found", message: "Spreadsheet not found" },
    });
    await user.json("PATCH", `/pages/${UNKNOWN_ID}`, { name: "x" }, 404);
    await user.json("DELETE", `/tables/${UNKNOWN_ID}`, undefined, 404);
  });
});

describe("pages", () => {
  it("creates a page with the next free name and one table", async () => {
    const { id } = await createSpreadsheet(user);
    const created = await user.json<{ page: PageRecord; table: TableRecord }>(
      "POST",
      `/spreadsheets/${id}/pages`,
      {},
      201,
    );
    expect(created.page).toMatchObject({ name: "Page 2", position: 1 });
    expect(created.table).toMatchObject({ name: "Table 1", pageId: created.page.id });

    const snapshot = await readSnapshot(user, id);
    expect(snapshot.pages.map((page) => page.name)).toEqual(["Page 1", "Page 2"]);
    expect(snapshot.tables).toHaveLength(2);
  });

  it("skips default names that are taken", async () => {
    const { id } = await createSpreadsheet(user);
    await user.json("POST", `/spreadsheets/${id}/pages`, { name: "page 2" }, 201);
    const created = await user.json<{ page: PageRecord }>(
      "POST",
      `/spreadsheets/${id}/pages`,
      {},
      201,
    );
    expect(created.page.name).toBe("Page 3");
  });

  it("refuses a page name already used in the spreadsheet, ignoring case", async () => {
    const { id } = await createSpreadsheet(user);
    expect(await user.json("POST", `/spreadsheets/${id}/pages`, { name: "PAGE 1" }, 409)).toEqual({
      error: { code: "conflict", message: "A page named PAGE 1 already exists" },
    });
    const snapshot = await readSnapshot(user, id);
    expect(snapshot.pages).toHaveLength(1);
  });

  it("renames a page, and refuses a name another page has", async () => {
    const snapshot = await createSpreadsheet(user);
    const { page } = await user.json<{ page: PageRecord }>(
      "POST",
      `/spreadsheets/${snapshot.id}/pages`,
      { name: "Data" },
      201,
    );
    expect(await user.json("PATCH", `/pages/${page.id}`, { name: "Archive" })).toEqual({
      revision: expect.any(Number),
      changed: {
        pages: [{ id: page.id, page: { ...page, name: "Archive" } }],
        tables: [],
        views: [],
        rows: [],
        cells: [],
      },
    });
    await user.json("PATCH", `/pages/${page.id}`, { name: "page 1" }, 409);
    const after = await readSnapshot(user, snapshot.id);
    expect(after.pages.map((item) => item.name)).toEqual(["Page 1", "Archive"]);
  });

  it("deletes a page with its tables and cells", async () => {
    const snapshot = await createSpreadsheet(user);
    const created = await user.json<{ page: PageRecord; table: TableRecord }>(
      "POST",
      `/spreadsheets/${snapshot.id}/pages`,
      {},
      201,
    );
    await user.json("PUT", `/tables/${created.table.id}/cells`, cellsBody({ A1: "gone" }), 200);

    await user.json("DELETE", `/pages/${created.page.id}`, undefined, 200);
    const after = await readSnapshot(user, snapshot.id);
    expect(after.pages).toHaveLength(1);
    expect(after.tables).toHaveLength(1);
    expect(after.cells).toEqual([]);
  });

  it("refuses to delete the last page", async () => {
    const snapshot = await createSpreadsheet(user);
    expect(await user.json("DELETE", `/pages/${first(snapshot).page.id}`, undefined, 409)).toEqual({
      error: { code: "conflict", message: "A spreadsheet needs at least one page" },
    });
  });
});

describe("tables", () => {
  it("creates a table with the next free name", async () => {
    const snapshot = await createSpreadsheet(user);
    const table = await addTable(user, first(snapshot).page.id);
    expect(table).toMatchObject({ name: "Table 2", position: 1 });
    const after = await readSnapshot(user, snapshot.id);
    expect(after.tables.find(({ id }) => id === table.id)).toMatchObject(DEFAULT_TABLE_SIZE);
  });

  it("refuses a table name already used on the page, and allows it on another page", async () => {
    const snapshot = await createSpreadsheet(user);
    const pageId = first(snapshot).page.id;
    await user.json("POST", `/pages/${pageId}/tables`, { name: "table 1" }, 409);

    const other = await user.json<{ page: PageRecord }>(
      "POST",
      `/spreadsheets/${snapshot.id}/pages`,
      {},
      201,
    );
    await user.json("POST", `/pages/${other.page.id}/tables`, { name: "Sales" }, 201);
    await user.json("POST", `/pages/${pageId}/tables`, { name: "Sales" }, 201);
  });

  it("renames a table, and refuses a name another table on the page has", async () => {
    const snapshot = await createSpreadsheet(user);
    const { page, table } = first(snapshot);
    await user.json("POST", `/pages/${page.id}/tables`, { name: "Sales" }, 201);

    expect(await user.json("PATCH", `/tables/${table.id}`, { name: "Costs" })).toMatchObject({
      changed: { tables: [{ id: table.id, table: { name: "Costs" } }], rows: [], cells: [] },
    });
    expect(await user.json("PATCH", `/tables/${table.id}`, { name: "SALES" }, 409)).toEqual({
      error: { code: "conflict", message: "A table named SALES already exists" },
    });
  });

  it("resizes a table and deletes the cells that no longer fit", async () => {
    const snapshot = await createSpreadsheet(user);
    const { table } = first(snapshot);
    await user.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A1: "keep", C1: "col gone", A5: "row gone", B2: "keep too" }),
      200,
    );

    const kept = rowIds(snapshot, table.id).slice(0, 4);
    const resized = await user.json<Change>("PATCH", `/tables/${table.id}`, {
      rowCount: 4,
      colCount: 2,
    });
    // The rows and columns past the new size are named, and the cells that went with them are not.
    expect(resized.changed).toMatchObject({
      tables: [{ id: table.id, table: { name: "Table 1", colIds: table.colIds.slice(0, 2) } }],
      cells: [],
    });
    expect(resized.changed?.rows).toHaveLength(DEFAULT_TABLE_SIZE.rowCount - 4);
    expect(resized.changed?.rows.every((row) => row.orderKey === null)).toBe(true);
    const smaller = await readSnapshot(user, snapshot.id);
    expect(smaller.tables[0]).toMatchObject({ rowCount: 4, colCount: 2 });
    expect(rowIds(smaller, table.id)).toEqual(kept);
    expect(await storedInputs(user, snapshot.id, table.id)).toEqual({
      "0:0": "keep",
      "1:1": "keep too",
    });

    await user.json("PATCH", `/tables/${table.id}`, { rowCount: 30 });
    expect(await storedInputs(user, snapshot.id, table.id)).toHaveProperty("0:0", "keep");
  });

  it("refuses to leave a plain table with no rows", async () => {
    const snapshot = await createSpreadsheet(user);
    expect(
      await user.json("PATCH", `/tables/${first(snapshot).table.id}`, { rowCount: 0 }, 422),
    ).toEqual({ error: { code: "last_one", message: "A table needs at least one row" } });
  });

  it.each([
    {},
    { rowCount: -1 },
    { rowCount: 1.5 },
    { rowCount: LIMITS.tableRows + 1 },
    { colCount: LIMITS.tableCols + 1 },
    { name: "" },
  ])("rejects the table change %j", async (body) => {
    const snapshot = await createSpreadsheet(user);
    await user.json("PATCH", `/tables/${first(snapshot).table.id}`, body, 400);
  });

  it("deletes a table with its cells", async () => {
    const snapshot = await createSpreadsheet(user);
    const { table } = first(snapshot);
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "gone" }), 200);
    await user.json("DELETE", `/tables/${table.id}`, undefined, 200);
    const after = await readSnapshot(user, snapshot.id);
    expect(after.tables).toEqual([]);
    expect(after.cells).toEqual([]);
  });
});

describe("renaming rewrites formulas", () => {
  it("writes a table's new name into the formulas that name it, on every page", async () => {
    const snapshot = await createSpreadsheet(user);
    const { page, table } = first(snapshot);
    const sales = await addTable(user, page.id);
    const other = await user.json<{ page: PageRecord; table: TableRecord }>(
      "POST",
      `/spreadsheets/${snapshot.id}/pages`,
      {},
      201,
    );
    await user.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A1: "=SUM('Table 2'!A1:A3) + 1", A2: "=A1", A3: "Table 2" }),
      200,
    );
    await user.json(
      "PUT",
      `/tables/${other.table.id}/cells`,
      cellsBody({ B2: "='page 1'!'table 2'!A1", B3: "='Table 2'!A1" }),
      200,
    );

    const renamed = await user.json<Change>("PATCH", `/tables/${sales.id}`, { name: "Sales" });
    expect(renamed.changed?.tables).toMatchObject([{ id: sales.id, table: { name: "Sales" } }]);
    expect(await changedCells(user, snapshot.id, renamed)).toEqual([
      { tableId: table.id, row: 0, col: 0, input: "=SUM(Sales!A1:A3) + 1" },
      { tableId: other.table.id, row: 1, col: 1, input: "='page 1'!Sales!A1" },
    ]);
    expect(await storedInputs(user, snapshot.id, table.id)).toEqual({
      "0:0": "=SUM(Sales!A1:A3) + 1",
      "1:0": "=A1",
      "2:0": "Table 2",
    });
    // Page 2 has no table named "Table 2", so its unqualified reference never pointed here.
    expect(await storedInputs(user, snapshot.id, other.table.id)).toEqual({
      "1:1": "='page 1'!Sales!A1",
      "2:1": "='Table 2'!A1",
    });
  });

  it("writes a page's new name into the formulas that name it", async () => {
    const snapshot = await createSpreadsheet(user);
    const { page, table } = first(snapshot);
    await user.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ A1: "='Page 1'!'Table 1'!B1" }),
      200,
    );

    const renamed = await user.json<Change>("PATCH", `/pages/${page.id}`, { name: "Summary" });
    expect(await changedCells(user, snapshot.id, renamed)).toEqual([
      { tableId: table.id, row: 0, col: 0, input: "=Summary!'Table 1'!B1" },
    ]);
    expect(await storedInputs(user, snapshot.id, table.id)).toEqual({
      "0:0": "=Summary!'Table 1'!B1",
    });
  });

  it("leaves formulas alone when the rename is refused", async () => {
    const snapshot = await createSpreadsheet(user);
    const { page, table } = first(snapshot);
    const second = await addTable(user, page.id);
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "='Table 2'!A1" }), 200);

    await user.json("PATCH", `/tables/${second.id}`, { name: "table 1" }, 409);
    expect(await storedInputs(user, snapshot.id, table.id)).toEqual({ "0:0": "='Table 2'!A1" });
  });

  it("does not rewrite formulas when a table is only resized", async () => {
    const snapshot = await createSpreadsheet(user);
    const { table } = first(snapshot);
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "='Table 1'!B1" }), 200);
    expect(await user.json("PATCH", `/tables/${table.id}`, { rowCount: 25 })).toMatchObject({
      changed: { tables: [], cells: [] },
    });
  });
});

describe("inserting and deleting rows and columns", () => {
  async function tableWith(inputs: Record<string, string>) {
    const snapshot = await createSpreadsheet(user);
    const { page, table } = first(snapshot);
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody(inputs), 200);
    const edit = (body: object, status = 200) =>
      user.json<Change>("POST", `/tables/${table.id}/edits`, body, status);
    const stored = () => storedInputs(user, snapshot.id, table.id);
    /** The table as it is now, with its size. */
    const sized = async () =>
      (await readSnapshot(user, snapshot.id)).tables.find(({ id }) => id === table.id);
    return { snapshot, page, table, edit, stored, sized };
  }

  it("deletes a row: the rows below move up, formulas are rewritten, and no cell is rewritten to move it", async () => {
    const { snapshot, table, edit, stored, sized } = await tableWith({
      A1: "1",
      A2: "gone",
      A3: "3",
      B1: "=SUM(A1:A3)",
      B4: "=A3*2",
      C1: "=A2",
    });

    const [, deleted] = rowIds(snapshot, table.id);
    const result = await edit({ axis: "row", kind: "delete", index: 1 });
    expect(await sized()).toMatchObject({ rowCount: DEFAULT_TABLE_SIZE.rowCount - 1 });
    expect(result.changed?.rows).toEqual([{ id: deleted, tableId: table.id, orderKey: null }]);
    // Only the formulas whose text changed are written. The cells below the row keep their ids.
    const written = await changedCells(user, snapshot.id, result);
    expect(written).toHaveLength(3);
    expect(written).toEqual(
      expect.arrayContaining([
        { tableId: table.id, row: 0, col: 1, input: "=SUM(A1:A2)" },
        { tableId: table.id, row: 2, col: 1, input: "=A2*2" },
        { tableId: table.id, row: 0, col: 2, input: "=#REF!" },
      ]),
    );
    expect(await stored()).toEqual({
      "0:0": "1",
      "1:0": "3",
      "0:1": "=SUM(A1:A2)",
      "2:1": "=A2*2",
      "0:2": "=#REF!",
    });
  });

  it("inserts a column: moves the columns from there right and grows the table", async () => {
    const { edit, stored, sized } = await tableWith({ A1: "a", B1: "b", C1: "=A1&B1" });
    await edit({ axis: "col", kind: "insert", index: 1 });
    expect(await sized()).toMatchObject({ colCount: DEFAULT_TABLE_SIZE.colCount + 1 });
    expect(await stored()).toEqual({ "0:0": "a", "0:2": "b", "0:3": "=A1&C1" });
  });

  it("deletes several rows at once, and inserts several columns at once", async () => {
    const { edit, stored, sized } = await tableWith({
      A1: "1",
      A2: "gone",
      A3: "gone too",
      A4: "4",
      B1: "=SUM(A1:A4)",
      B5: "=A4+A3",
    });
    await edit({ axis: "row", kind: "delete", index: 1, count: 2 });
    expect(await sized()).toMatchObject({ rowCount: DEFAULT_TABLE_SIZE.rowCount - 2 });
    expect(await stored()).toEqual({
      "0:0": "1",
      "1:0": "4",
      "0:1": "=SUM(A1:A2)",
      "2:1": "=A2+#REF!",
    });

    await edit({ axis: "col", kind: "insert", index: 1, count: 3 });
    expect(await sized()).toMatchObject({ colCount: DEFAULT_TABLE_SIZE.colCount + 3 });
    expect(await stored()).toEqual({
      "0:0": "1",
      "1:0": "4",
      "0:4": "=SUM(A1:A2)",
      "2:4": "=A2+#REF!",
    });
  });

  it("refuses to delete every row, rows past the end, or to insert past the size limit", async () => {
    const { table, edit, stored, sized } = await tableWith({ A1: "kept" });
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: 3 });
    expect(await edit({ axis: "row", kind: "delete", index: 0, count: 3 }, 422)).toEqual({
      error: { code: "last_one", message: "A table needs at least one row" },
    });
    expect(await edit({ axis: "row", kind: "delete", index: 1, count: 3 }, 409)).toEqual({
      error: { code: "row_deleted", message: "This row no longer exists" },
    });
    const room = LIMITS.tableRows - 3;
    expect(await edit({ axis: "row", kind: "insert", index: 0, count: room + 1 }, 422)).toEqual({
      error: {
        code: "table_full",
        message: `A table can have at most ${String(LIMITS.tableRows)} rows`,
      },
    });
    expect(await stored()).toEqual({ "0:0": "kept" });
    await edit({ axis: "row", kind: "insert", index: 3, count: room });
    expect(await sized()).toMatchObject({ rowCount: LIMITS.tableRows });
  });

  it("makes a table smaller by deleting the rows and columns past its new size", async () => {
    const { snapshot, table, stored, sized } = await tableWith({
      A1: "1",
      A2: "2",
      A3: "gone",
      B1: "=SUM(A1:A3)",
      B2: "=A3",
      C1: "gone",
      C3: "gone",
      A4: "gone",
    });
    await user.json("POST", `/tables/${table.id}/formats`, {
      range: { startRow: 0, endRow: 5, startCol: 0, endCol: 4 },
      format: { bold: true },
    });
    const result = await user.json<Change>("PATCH", `/tables/${table.id}`, {
      rowCount: 2,
      colCount: 2,
    });
    expect(await sized()).toMatchObject({
      rowCount: 2,
      colCount: 2,
      formats: [{ startRow: 0, endRow: 1, startCol: 0, endCol: 1, format: { bold: true } }],
    });
    expect(await stored()).toEqual({
      "0:0": "1",
      "1:0": "2",
      "0:1": "=SUM(A1:A2)",
      "1:1": "=#REF!",
    });
    // The client is told of every formula that changed. The cells that went are in the rows
    // and columns it is told are gone.
    const written = await changedCells(user, snapshot.id, result);
    expect(written).toHaveLength(2);
    expect(written).toEqual(
      expect.arrayContaining([
        { tableId: table.id, row: 0, col: 1, input: "=SUM(A1:A2)" },
        { tableId: table.id, row: 1, col: 1, input: "=#REF!" },
      ]),
    );
    expect(result.changed?.rows).toHaveLength(DEFAULT_TABLE_SIZE.rowCount - 2);
  });

  it("renames, shrinks one way, and grows the other in one request", async () => {
    const { snapshot, page, table, stored, sized } = await tableWith({ A1: "1", A3: "gone" });
    const sibling = await addTable(user, page.id);
    await user.json(
      "PUT",
      `/tables/${sibling.id}/cells`,
      cellsBody({ A1: "=SUM('Table 1'!A1:A5)" }),
      200,
    );
    await user.json("PATCH", `/tables/${table.id}`, { name: "Small", rowCount: 2, colCount: 30 });
    expect(await sized()).toMatchObject({ name: "Small", rowCount: 2, colCount: 30 });
    expect(await stored()).toEqual({ "0:0": "1" });
    expect(await storedInputs(user, snapshot.id, sibling.id)).toEqual({
      "0:0": "=SUM(Small!A1:A2)",
    });
  });

  it("rewrites formulas in other tables and on other pages", async () => {
    const { snapshot, page, edit } = await tableWith({ A5: "5" });
    const sibling = await addTable(user, page.id);
    const other = await user.json<{ table: TableRecord }>(
      "POST",
      `/spreadsheets/${snapshot.id}/pages`,
      {},
      201,
    );
    await user.json("PUT", `/tables/${sibling.id}/cells`, cellsBody({ A1: "='Table 1'!A5" }), 200);
    await user.json(
      "PUT",
      `/tables/${other.table.id}/cells`,
      cellsBody({
        A1: "=SUM('Page 1'!'Table 1'!A:A) + 'Page 1'!'Table 1'!A5",
        A2: "='Table 1'!A5",
      }),
      200,
    );

    await edit({ axis: "row", kind: "insert", index: 0 });
    expect(await storedInputs(user, snapshot.id, sibling.id)).toEqual({ "0:0": "='Table 1'!A6" });
    // On page 2, an unqualified 'Table 1' is page 2's own table, which was not edited.
    expect(await storedInputs(user, snapshot.id, other.table.id)).toEqual({
      "0:0": "=SUM('Page 1'!'Table 1'!A:A) + 'Page 1'!'Table 1'!A6",
      "1:0": "='Table 1'!A5",
    });
  });

  it("refuses to delete the last row or column, or one the table does not have", async () => {
    const { table, edit, stored } = await tableWith({ A1: "kept" });
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: 1, colCount: 1 });

    expect(await edit({ axis: "row", kind: "delete", index: 0 }, 422)).toEqual({
      error: { code: "last_one", message: "A table needs at least one row" },
    });
    expect(await edit({ axis: "col", kind: "delete", index: 0 }, 422)).toEqual({
      error: { code: "last_one", message: "A table needs at least one column" },
    });
    expect(await edit({ axis: "row", kind: "delete", index: 1 }, 409)).toEqual({
      error: { code: "row_deleted", message: "This row no longer exists" },
    });
    expect(await edit({ axis: "col", kind: "delete", index: 3 }, 409)).toEqual({
      error: { code: "column_deleted", message: "This column no longer exists" },
    });
    expect(await edit({ axis: "row", kind: "insert", index: 2 }, 409)).toEqual({
      error: { code: "row_deleted", message: "This row no longer exists" },
    });
    expect(await stored()).toEqual({ "0:0": "kept" });
  });

  it("refuses to insert into a table that is already at the size limit", async () => {
    const { table, edit } = await tableWith({ A1: "x" });
    await user.json("PATCH", `/tables/${table.id}`, { colCount: LIMITS.tableCols });
    expect(await edit({ axis: "col", kind: "insert", index: 0 }, 422)).toEqual({
      error: {
        code: "table_full",
        message: `A table can have at most ${String(LIMITS.tableCols)} columns`,
      },
    });
  });

  it.each([
    {},
    { axis: "diagonal", kind: "insert", index: 0 },
    { axis: "row", kind: "insert", index: -1 },
    { axis: "row", kind: "insert", index: 0, count: 0 },
    { axis: "row", kind: "delete", index: 0, count: 1.5 },
  ])("rejects the malformed edit %j", async (body) => {
    const { edit } = await tableWith({ A1: "x" });
    await edit(body, 400);
  });

  it("inserting at the end adds an empty row", async () => {
    const { table, edit, stored, sized } = await tableWith({ A1: "x" });
    const result = await edit({ axis: "row", kind: "insert", index: DEFAULT_TABLE_SIZE.rowCount });
    expect(await sized()).toMatchObject({ rowCount: DEFAULT_TABLE_SIZE.rowCount + 1 });
    expect(result.changed).toMatchObject({
      rows: [{ id: expect.any(String), tableId: table.id, orderKey: expect.any(String) }],
      cells: [],
    });
    expect(await stored()).toEqual({ "0:0": "x" });
  });
});

describe("cells", () => {
  it("stores, overwrites, and clears cell inputs", async () => {
    const snapshot = await createSpreadsheet(user);
    const { table } = first(snapshot);
    const path = `/tables/${table.id}/cells`;

    await user.json("PUT", path, cellsBody({ A1: "1", B1: "=A1+1", C1: "text" }));
    expect(await storedInputs(user, snapshot.id, table.id)).toEqual({
      "0:0": "1",
      "0:1": "=A1+1",
      "0:2": "text",
    });

    const cleared = await user.json<Change>("PUT", path, cellsBody({ A1: "2", C1: "", D1: "" }));
    // D1 held nothing and still holds nothing, so it is not among what changed.
    expect(await changedCells(user, snapshot.id, cleared)).toEqual([
      { tableId: table.id, row: 0, col: 0, input: "2" },
      { tableId: table.id, row: 0, col: 2, input: "" },
    ]);
    expect(await storedInputs(user, snapshot.id, table.id)).toEqual({ "0:0": "2", "0:1": "=A1+1" });
  });

  it("keeps the last entry when a request names a cell more than once", async () => {
    const snapshot = await createSpreadsheet(user);
    const { table } = first(snapshot);
    const cells = [
      { row: 0, col: 0, input: "first" },
      { row: 0, col: 0, input: "second" },
      { row: 1, col: 0, input: "kept" },
      { row: 1, col: 0, input: "" },
    ];
    await user.json("PUT", `/tables/${table.id}/cells`, { cells }, 200);
    expect(await storedInputs(user, snapshot.id, table.id)).toEqual({ "0:0": "second" });
  });

  it("refuses a cell outside the table and stores none of the request", async () => {
    const snapshot = await createSpreadsheet(user);
    const { table } = first(snapshot);
    const body = cellsBody({ A1: "inside", I1: "outside" });
    expect(await user.json("PUT", `/tables/${table.id}/cells`, body, 409)).toEqual({
      error: { code: "column_deleted", message: "This column no longer exists" },
    });
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A21: "outside" }), 409);
    expect(await storedInputs(user, snapshot.id, table.id)).toEqual({});
  });

  it.each([
    { cells: [] },
    { cells: [{ row: -1, col: 0, input: "x" }] },
    { cells: [{ row: 0.5, col: 0, input: "x" }] },
    { cells: [{ row: 0, col: 0 }] },
    { cells: [{ row: 0, col: 0, input: "x".repeat(LIMITS.inputLength + 1) }] },
    {
      cells: Array.from({ length: LIMITS.cellsPerRequest + 1 }, () => ({
        row: 0,
        col: 0,
        input: "x",
      })),
    },
  ])("rejects a malformed cell request", async (body) => {
    const snapshot = await createSpreadsheet(user);
    await user.json("PUT", `/tables/${first(snapshot).table.id}/cells`, body, 400);
  });
});
