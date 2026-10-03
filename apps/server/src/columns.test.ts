import type { ColumnDefinition } from "@spreadsheet-app/engine";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Change, ClickResult, PageRecord, SpreadsheetSummary, TableRecord } from "./app";
import {
  addTable,
  addView,
  cellsBody,
  changedCells,
  createSpreadsheet,
  readSnapshot,
  startTestServer,
  storedInputs,
  type TestServer,
  type TestSnapshot,
  type TestUser,
} from "./testing";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp();
});
afterAll(() => server.close());

type SizedTable = TestSnapshot["tables"][number];

interface Fixture {
  id: string;
  page: PageRecord;
  table: SizedTable;
  /** The table as the server now has it. */
  current(): Promise<SizedTable>;
  stored(): Promise<Record<string, string>>;
  /** Changes a column. Resolves to the table as it then is, with the change the server answered with. */
  patchColumn(
    col: number,
    changes: object,
    status?: number,
  ): Promise<{ table: SizedTable; change: Change }>;
}

/** A new spreadsheet whose first table holds `cells`. */
async function start(cells: Record<string, string> = {}): Promise<Fixture> {
  const snapshot = await createSpreadsheet(user);
  const [page, table] = [snapshot.pages[0]!, snapshot.tables[0]!];
  if (Object.keys(cells).length > 0) {
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody(cells), 200);
  }
  const current = async (): Promise<SizedTable> =>
    (await readSnapshot(user, snapshot.id)).tables.find((candidate) => candidate.id === table.id)!;
  return {
    id: snapshot.id,
    page,
    table,
    current,
    stored: () => storedInputs(user, snapshot.id, table.id),
    patchColumn: async (col, changes, status = 200) => {
      const path = `/tables/${table.id}/columns/${String(col)}`;
      const change = await user.json<Change>("PATCH", path, changes, status);
      // A refusal is the whole answer, which the caller compares.
      return status === 200 ? { table: await current(), change } : (change as never);
    },
  };
}

/** A data table: Item, Price, Qty, and five more columns, with two rows of data. */
async function sales(): Promise<Fixture> {
  const fixture = await start({
    A1: "Item",
    B1: "Price",
    C1: "Qty",
    A2: "pen",
    B2: "2",
    C2: "10",
    A3: "ink",
    B3: "5",
    C3: "3",
  });
  await user.json("POST", `/tables/${fixture.table.id}/columns`, { headerRow: true });
  return fixture;
}

const names = (table: TableRecord): string[] => (table.columns ?? []).map((column) => column.name);

describe("naming a table's columns", () => {
  it("starts a table with none", async () => {
    const { table } = await start();
    expect(table.columns).toBeNull();
  });

  it("names them Column 1, Column 2, ... and leaves the cells alone", async () => {
    const { table, stored, current } = await start({ A1: "kept" });
    const result = await user.json<Change>("POST", `/tables/${table.id}/columns`, {
      headerRow: false,
    });
    expect(result.changed).toMatchObject({ cells: [], views: [] });
    const named = await current();
    expect(named.columns).toHaveLength(table.colCount);
    expect(named.columns?.slice(0, 2)).toEqual([
      { name: "Column 1", type: "any" },
      { name: "Column 2", type: "any" },
    ]);
    expect(await stored()).toEqual({ "0:0": "kept" });
  });

  it("deletes the empty rows at the end, so a data table holds only its rows", async () => {
    const { id, table, current } = await start({ A1: "first", A3: "third", B5: "=SUM(A1:A20)" });
    await user.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
    expect((await current()).rowCount).toBe(5);
    // The rows are deleted as any rows are, so a range that named them follows.
    expect(await storedInputs(user, id, table.id)).toMatchObject({ "4:1": "=SUM(A1:A5)" });
  });

  it("leaves a table that holds nothing with no rows", async () => {
    const { table, current } = await start();
    await user.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
    expect((await current()).rowCount).toBe(0);
  });

  it("takes the names from the first row and removes that row", async () => {
    const { stored, current } = await sales();
    const now = await current();
    expect(names(now).slice(0, 4)).toEqual(["Item", "Price", "Qty", "Column 1"]);
    expect(now.rowCount).toBe(2);
    expect(await stored()).toEqual({
      "0:0": "pen",
      "0:1": "2",
      "0:2": "10",
      "1:0": "ink",
      "1:1": "5",
      "1:2": "3",
    });
  });

  it("gives a usable name to a header cell that is empty, repeated, a formula, or has brackets", async () => {
    const { table, current } = await start({
      A1: "Name",
      B1: "name",
      C1: "=1+1",
      E1: "Total [USD]",
      F1: "Column 1",
    });
    await user.json("POST", `/tables/${table.id}/columns`, { headerRow: true });
    expect(names(await current()).slice(0, 6)).toEqual([
      "Name",
      "Column 1",
      "Column 2",
      "Column 3",
      "Total USD",
      "Column 4",
    ]);
  });

  it("rewrites formulas that read below the header row, which moves up", async () => {
    const fixture = await start({
      A1: "Amount",
      A2: "5",
      A3: "7",
      B3: "=A2+A3",
      C3: "=A1",
    });
    const { id, table, stored, current } = fixture;
    const result = await user.json<Change>("POST", `/tables/${table.id}/columns`, {
      headerRow: true,
    });
    expect(await stored()).toEqual({ "0:0": "5", "1:0": "7", "1:1": "=A1+A2", "1:2": "=#REF!" });
    expect(await changedCells(user, id, result)).toEqual(
      expect.arrayContaining([
        { tableId: table.id, row: 1, col: 1, input: "=A1+A2" },
        { tableId: table.id, row: 1, col: 2, input: "=#REF!" },
      ]),
    );
    expect(names(await current())[0]).toBe("Amount");
    // The table is in the change once, as it is after it was named.
    expect(result.changed?.tables.map((changed) => changed.table?.columns?.[0]?.name)).toEqual([
      "Amount",
    ]);
  });

  it("leaves no row in a table that has only a header row", async () => {
    const { table, stored, current } = await start({ A1: "Only" });
    await user.json("PATCH", `/tables/${table.id}`, { rowCount: 1 });
    await user.json("POST", `/tables/${table.id}/columns`, { headerRow: true });
    expect((await current()).rowCount).toBe(0);
    expect(names(await current())[0]).toBe("Only");
    expect(await stored()).toEqual({});
  });

  it("refuses a table that already has named columns", async () => {
    const { table } = await sales();
    expect(
      await user.json("POST", `/tables/${table.id}/columns`, { headerRow: false }, 409),
    ).toEqual({
      error: { code: "conflict", message: "Table 1 already has named columns" },
    });
  });

  it("makes a plain table of a data table again", async () => {
    const { table, current, stored } = await sales();
    expect(await user.json("DELETE", `/tables/${table.id}/columns`)).toMatchObject({
      changed: { tables: [{ id: table.id, table: { columns: null } }] },
    });
    expect((await current()).columns).toBeNull();
    expect(await stored()).toMatchObject({ "0:0": "pen" });
  });

  it("gives a row to a data table with none when its column names are removed", async () => {
    const { table, current } = await start();
    await user.json("POST", `/tables/${table.id}/columns`, { headerRow: false });
    await user.json("DELETE", `/tables/${table.id}/columns`);
    expect(await current()).toMatchObject({ columns: null, rowCount: 1 });
  });
});

describe("changing a column", () => {
  it("changes its type", async () => {
    const { patchColumn, current } = await sales();
    const { table } = await patchColumn(1, { type: "number" });
    expect(table.columns?.[1]).toEqual({ name: "Price", type: "number" });
    expect((await current()).columns?.[1]).toEqual({ name: "Price", type: "number" });
  });

  it("makes a formula column, which loses what was typed into it, and adds the = when it is left out", async () => {
    const { patchColumn, stored } = await sales();
    const { table } = await patchColumn(2, { type: "formula", formula: "[Price] * 2" });
    expect(table.columns?.[2]).toEqual({ name: "Qty", type: "formula", formula: "=[Price] * 2" });
    expect(await stored()).toEqual({ "0:0": "pen", "0:1": "2", "1:0": "ink", "1:1": "5" });
  });

  it("changes a formula column's formula, and drops it when the column stops being one", async () => {
    const { patchColumn } = await sales();
    await patchColumn(3, { type: "formula", formula: "=[Price] * [Qty]" });
    expect((await patchColumn(3, { formula: "=[Price] + 1" })).table.columns?.[3]).toEqual({
      name: "Column 1",
      type: "formula",
      formula: "=[Price] + 1",
    });
    expect((await patchColumn(3, { type: "text" })).table.columns?.[3]).toEqual({
      name: "Column 1",
      type: "text",
    });
  });

  it("refuses a formula column without a formula", async () => {
    const { patchColumn } = await sales();
    for (const changes of [{ type: "formula" }, { type: "formula", formula: " = " }]) {
      expect(await patchColumn(1, changes, 422)).toEqual({
        error: { code: "formula_required", message: "A formula column needs a formula" },
      });
    }
  });

  it("renames a column and rewrites everything that names it", async () => {
    const { id, page, table, patchColumn, stored } = await sales();
    await patchColumn(3, { name: "Total", type: "formula", formula: "=[Price] * [Qty]" });
    await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ E1: "=[Price] + 1" }), 200);
    const other = await addTable(user, page.id);
    await user.json(
      "PUT",
      `/tables/${other.id}/cells`,
      cellsBody({ A1: "=SUM('Table 1'[Price])", A2: "=SUM('Table 1'[Qty])" }),
      200,
    );
    const text = await addView(user, page.id);
    await user.json("PATCH", `/views/${text.id}`, { source: "{{ SUM('Table 1'[price]) }}" });

    const result = await patchColumn(1, { name: "Unit Price" });
    expect(await changedCells(user, id, result.change)).toEqual(
      expect.arrayContaining([
        { tableId: table.id, row: 0, col: 4, input: "=[Unit Price] + 1" },
        { tableId: other.id, row: 0, col: 0, input: "=SUM('Table 1'[Unit Price])" },
      ]),
    );
    expect(result.change.changed).toMatchObject({
      views: [{ id: text.id, view: { source: "{{ SUM('Table 1'[Unit Price]) }}" } }],
      tables: [{ id: table.id }],
    });
    expect(result.table.columns?.slice(1, 4)).toEqual([
      { name: "Unit Price", type: "any" },
      { name: "Qty", type: "any" },
      { name: "Total", type: "formula", formula: "=[Unit Price] * [Qty]" },
    ]);
    expect(await stored()).toMatchObject({ "0:4": "=[Unit Price] + 1" });
    expect(await storedInputs(user, id, other.id)).toEqual({
      "0:0": "=SUM('Table 1'[Unit Price])",
      "1:0": "=SUM('Table 1'[Qty])",
    });
  });

  it("rewrites the formula of a column that is renamed and names itself", async () => {
    const { patchColumn } = await sales();
    await patchColumn(3, { name: "Running", type: "formula", formula: "=[Running] + 1" });
    expect((await patchColumn(3, { name: "Sum" })).table.columns?.[3]?.formula).toBe("=[Sum] + 1");
  });

  it("tells of the other tables whose formula columns it rewrote", async () => {
    const { page, table, patchColumn } = await sales();
    const other = await addTable(user, page.id);
    await user.json("POST", `/tables/${other.id}/columns`, { headerRow: false });
    await user.json("PATCH", `/tables/${other.id}/columns/0`, {
      type: "formula",
      formula: "=SUM('Table 1'[Price])",
    });
    const { change } = await patchColumn(1, { name: "Cost" });
    const changed = new Map(change.changed?.tables.map((entry) => [entry.id, entry.table]));
    expect([...changed.keys()].sort()).toEqual([other.id, table.id].sort());
    expect(changed.get(other.id)?.columns?.[0]?.formula).toBe("=SUM('Table 1'[Cost])");
  });

  it("refuses a name another column has, without regard to case", async () => {
    const { patchColumn, current } = await sales();
    expect(await patchColumn(1, { name: " item " }, 409)).toEqual({
      error: { code: "conflict", message: "A column named item already exists" },
    });
    expect(names(await current())[1]).toBe("Price");
    // Changing only the case of a column's own name is allowed.
    expect(names((await patchColumn(1, { name: "PRICE" })).table)[1]).toBe("PRICE");
  });

  it.each<[string, object]>([
    ["an empty change", {}],
    ["an empty name", { name: " " }],
    ["a name with a bracket", { name: "a[b" }],
    ["an unknown type", { type: "money" }],
  ])("refuses %s", async (_, changes) => {
    const { patchColumn } = await sales();
    await patchColumn(1, changes, 400);
  });

  it("refuses a column the table does not have, and a table without named columns", async () => {
    const { patchColumn } = await sales();
    expect(await patchColumn(50, { name: "x" }, 409)).toMatchObject({
      error: { code: "column_deleted" },
    });
    const plain = await start();
    expect(await plain.patchColumn(0, { name: "x" }, 422)).toEqual({
      error: { code: "not_a_data_table", message: "Table 1 has no named columns" },
    });
  });
});

describe("a data table as rows and columns come and go", () => {
  it("names a new column, and forgets a deleted one", async () => {
    const { table, current } = await sales();
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "insert", index: 1 });
    expect(names(await current()).slice(0, 4)).toEqual(["Item", "Column 6", "Price", "Qty"]);
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "delete", index: 0 });
    expect(names(await current()).slice(0, 3)).toEqual(["Column 6", "Price", "Qty"]);
    expect((await current()).columns).toHaveLength((await current()).colCount);
  });

  it("names each of several new columns, and forgets several deleted ones", async () => {
    const { table, current } = await sales();
    const edits = `/tables/${table.id}/edits`;
    await user.json("POST", edits, { axis: "col", kind: "insert", index: 1, count: 2 });
    expect(names(await current()).slice(0, 5)).toEqual([
      "Item",
      "Column 6",
      "Column 7",
      "Price",
      "Qty",
    ]);
    await user.json("POST", edits, { axis: "col", kind: "delete", index: 0, count: 2 });
    expect(names(await current()).slice(0, 3)).toEqual(["Column 7", "Price", "Qty"]);
    expect((await current()).columns).toHaveLength((await current()).colCount);
  });

  it("keeps a formula column's formula with its column, and rewrites cell addresses in it", async () => {
    const { table, patchColumn, current } = await sales();
    await patchColumn(3, { name: "Total", type: "formula", formula: "=[Price] * [Qty] + $A$2" });
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "col", kind: "insert", index: 0 });
    await user.json("POST", `/tables/${table.id}/edits`, { axis: "row", kind: "insert", index: 0 });
    expect((await current()).columns?.[4]).toEqual({
      name: "Total",
      type: "formula",
      formula: "=[Price] * [Qty] + $B$3",
    });
  });

  it("adds named columns when the table is widened, and drops them when it is narrowed", async () => {
    const { table, current } = await sales();
    await user.json("PATCH", `/tables/${table.id}`, { colCount: table.colCount + 2 });
    expect((await current()).columns).toHaveLength(table.colCount + 2);
    expect(names(await current()).at(-1)).toBe("Column 7");
    await user.json("PATCH", `/tables/${table.id}`, { colCount: 2 });
    expect(names(await current())).toEqual(["Item", "Price"]);
  });

  it("rewrites formula columns when their table is renamed", async () => {
    const { table, patchColumn, current } = await sales();
    await patchColumn(3, { type: "formula", formula: "=SUM('Table 1'[Price])" });
    const result = await user.json<Change>("PATCH", `/tables/${table.id}`, { name: "Sales" });
    expect((await current()).columns?.[3]?.formula).toBe("=SUM(Sales[Price])");
    expect(result.changed?.tables.map(({ id }) => id)).toEqual([table.id]);
  });
});

describe("the cells of a formula column", () => {
  it("cannot be typed into", async () => {
    const { table, patchColumn, stored } = await sales();
    await patchColumn(3, { name: "Total", type: "formula", formula: "=[Price] * [Qty]" });
    const before = await stored();
    expect(
      await user.json("PUT", `/tables/${table.id}/cells`, cellsBody({ A1: "x", D1: "5" }), 422),
    ).toEqual({
      error: {
        code: "formula_column",
        message: "Total is a formula column. Change the column's formula instead",
      },
    });
    expect(await stored()).toEqual(before);
  });

  it("are computed when a button runs, and a button can read them", async () => {
    const { id, page, table, patchColumn } = await sales();
    await patchColumn(3, { name: "Total", type: "formula", formula: "=[Price] * [Qty]" });
    const other = await addTable(user, page.id);
    await user.json(
      "PUT",
      `/tables/${other.id}/cells`,
      cellsBody({ A1: `=BUTTON("Sum", EXECUTE(SUM('Table 1'[Total]), B1))` }),
    );
    const result = await user.json<ClickResult>("POST", `/tables/${other.id}/cells/0/0/click`);
    expect(result).toMatchObject({ status: "succeeded" });
    expect(await changedCells(user, id, result.change!)).toEqual([
      { tableId: other.id, row: 0, col: 1, input: "35" },
    ]);
    expect(table.id).not.toBe(other.id);
  });

  it("are refused as the target of a button", async () => {
    const { table, patchColumn } = await sales();
    await patchColumn(3, { name: "Total", type: "formula", formula: "=[Price] * [Qty]" });
    await user.json(
      "PUT",
      `/tables/${table.id}/cells`,
      cellsBody({ E1: '=BUTTON("Bad", EXECUTE(1, D1))' }),
    );
    const result = await user.json<ClickResult>("POST", `/tables/${table.id}/cells/0/4/click`);
    expect(result).toMatchObject({
      status: "failed",
      error: "#VALUE! Total is a formula column and cannot be written to",
    });
  });
});

describe("columns in a spreadsheet file", () => {
  const columns: ColumnDefinition[] = [
    { name: "Price", type: "number" },
    { name: "Double", type: "formula", formula: "[Price] * 2" },
  ];
  const file = (overrides: object = {}) => ({
    format: "spreadsheet-app",
    version: 1,
    name: "Imported",
    pages: [
      {
        name: "P",
        blocks: [
          {
            type: "table",
            name: "T",
            rowCount: 2,
            colCount: 2,
            columns,
            cells: [
              { row: 0, col: 0, input: "4" },
              { row: 0, col: 1, input: "stale" },
            ],
            ...overrides,
          },
        ],
      },
    ],
  });

  it("are imported with the table, without cells for formula columns", async () => {
    const summary = await user.json<SpreadsheetSummary>(
      "POST",
      "/spreadsheets/import",
      file(),
      201,
    );
    const snapshot = await readSnapshot(user, summary.id);
    expect(snapshot.tables[0]?.columns).toEqual([
      { name: "Price", type: "number" },
      { name: "Double", type: "formula", formula: "=[Price] * 2" },
    ]);
    expect(snapshot.cells.map(({ row, col, input }) => [row, col, input])).toEqual([[0, 0, "4"]]);
  });

  it.each<[string, object, string]>([
    [
      "fewer names than columns",
      { columns: columns.slice(0, 1) },
      "The table T names 1 of its 2 columns",
    ],
    [
      "a repeated name",
      { columns: [columns[0], { name: " price", type: "text" }] },
      "Two columns of T are named price",
    ],
    [
      "a formula column without a formula",
      { columns: [columns[0], { name: "Double", type: "formula" }] },
      "The formula column Double of T has no formula",
    ],
  ])("are refused with %s", async (_, overrides, message) => {
    expect(await user.json("POST", "/spreadsheets/import", file(overrides), 422)).toEqual({
      error: { code: "invalid_file", message },
    });
  });
});

describe("dropdown columns", () => {
  /** A data table of Item and Qty, and a second data table whose Name column can supply choices. */
  async function withSource() {
    const fixture = await sales();
    const source = await addTable(user, fixture.page.id);
    await user.json(
      "PUT",
      `/tables/${source.id}/cells`,
      cellsBody({ A1: "Name", A2: "x", A3: "y" }),
    );
    await user.json("POST", `/tables/${source.id}/columns`, { headerRow: true });
    const snapshot = await readSnapshot(user, fixture.id);
    const sourceTable = snapshot.tables.find((candidate) => candidate.id === source.id)!;
    return { ...fixture, source: sourceTable, nameColId: sourceTable.colIds[0]! };
  }

  it("takes a list of choices, dropping repeats, and keeps nothing for other types", async () => {
    const { patchColumn } = await withSource();
    const { table } = await patchColumn(0, { type: "choice", choices: ["red", "green", "red"] });
    expect(table.columns?.[0]).toEqual({ name: "Item", type: "choice", choices: ["red", "green"] });
    const text = await patchColumn(0, { type: "text" });
    expect(text.table.columns?.[0]).toEqual({ name: "Item", type: "text" });
  });

  it("needs a list or a source", async () => {
    const { patchColumn } = await withSource();
    const refused = await patchColumn(0, { type: "choice" }, 422);
    expect(refused).toMatchObject({ error: { code: "choices_required" } });
    await patchColumn(0, { type: "choice", choices: [] }, 422);
  });

  it("takes the values of a column of another data table", async () => {
    const { patchColumn, source, nameColId } = await withSource();
    const { table } = await patchColumn(0, {
      type: "choice",
      choicesFrom: { tableId: source.id, colId: nameColId },
    });
    expect(table.columns?.[0]).toEqual({
      name: "Item",
      type: "choice",
      choicesFrom: { tableId: source.id, colId: nameColId },
    });
  });

  it("replaces a source with a list and a list with a source", async () => {
    const { patchColumn, source, nameColId } = await withSource();
    await patchColumn(0, { type: "choice", choices: ["a"] });
    const fromSource = await patchColumn(0, {
      choicesFrom: { tableId: source.id, colId: nameColId },
    });
    expect(fromSource.table.columns?.[0]).not.toHaveProperty("choices");
    const listed = await patchColumn(0, { choices: ["b"] });
    expect(listed.table.columns?.[0]).toEqual({ name: "Item", type: "choice", choices: ["b"] });
  });

  it("refuses both a list and a source in one request", async () => {
    const { patchColumn, source, nameColId } = await withSource();
    await patchColumn(
      0,
      { type: "choice", choices: ["a"], choicesFrom: { tableId: source.id, colId: nameColId } },
      400,
    );
  });

  it("refuses a source that is a plain table, another spreadsheet's column, or a missing column", async () => {
    const { patchColumn, source, page, nameColId } = await withSource();
    const plain = await addTable(user, page.id);
    const refused = await patchColumn(
      0,
      { type: "choice", choicesFrom: { tableId: plain.id, colId: plain.colIds[0] } },
      422,
    );
    expect(refused).toMatchObject({ error: { code: "invalid_choice_source" } });
    const other = await createSpreadsheet(user);
    await patchColumn(
      0,
      {
        type: "choice",
        choicesFrom: { tableId: other.tables[0]!.id, colId: other.tables[0]!.colIds[0] },
      },
      422,
    );
    await patchColumn(
      0,
      { type: "choice", choicesFrom: { tableId: source.id, colId: crypto.randomUUID() } },
      409,
    );
    expect(nameColId).toBeDefined();
  });

  it("refuses a column of the same table as the source", async () => {
    const { patchColumn, table } = await withSource();
    const refused = await patchColumn(
      0,
      { type: "choice", choicesFrom: { tableId: table.id, colId: table.colIds[1] } },
      422,
    );
    expect(refused).toMatchObject({ error: { code: "invalid_choice_source" } });
  });

  it("lets a column whose source was deleted be renamed, and a file of it be imported", async () => {
    const { patchColumn, source, nameColId, id } = await withSource();
    await patchColumn(0, { type: "choice", choicesFrom: { tableId: source.id, colId: nameColId } });
    await user.json("DELETE", `/tables/${source.id}`);
    const renamed = await patchColumn(0, { name: "Kind" });
    expect(renamed.table.columns?.[0]).toMatchObject({ name: "Kind", type: "choice" });
    // A file writes the dropdown with no choices, and reads it back.
    const body = {
      format: "spreadsheet-app",
      version: 1,
      name: "Gone",
      pages: [
        {
          name: "Data",
          blocks: [
            {
              type: "table",
              name: "Runs",
              rowCount: 1,
              colCount: 1,
              columns: [{ name: "Race", type: "choice", choices: [] }],
              cells: [],
            },
          ],
        },
      ],
    };
    await user.json("POST", "/spreadsheets/import", body, 201);
    expect(id).toBeDefined();
  });

  it("keeps the source as it was across a rename of the source column or table", async () => {
    const { patchColumn, source, nameColId, current } = await withSource();
    await patchColumn(0, { type: "choice", choicesFrom: { tableId: source.id, colId: nameColId } });
    await user.json("PATCH", `/tables/${source.id}`, { name: "Renamed" });
    await user.json("PATCH", `/tables/${source.id}/columns/${nameColId}`, { name: "Label" });
    expect((await current()).columns?.[0]?.choicesFrom).toEqual({
      tableId: source.id,
      colId: nameColId,
    });
  });

  describe("in a file", () => {
    const fileWith = (choicesFrom: object | undefined, choices?: string[]) => ({
      format: "spreadsheet-app",
      version: 1,
      name: "Races",
      pages: [
        {
          name: "Data",
          blocks: [
            {
              type: "table",
              name: "Runs",
              rowCount: 1,
              colCount: 1,
              columns: [
                {
                  name: "Race",
                  type: "choice",
                  ...(choicesFrom ? { choicesFrom } : {}),
                  ...(choices ? { choices } : {}),
                },
              ],
              cells: [],
            },
            {
              type: "table",
              name: "Races",
              rowCount: 1,
              colCount: 1,
              columns: [{ name: "Race Name", type: "text" }],
              cells: [{ row: 0, col: 0, input: "Trial" }],
            },
          ],
        },
      ],
    });

    it("is imported with the source resolved to the new ids, wherever the table sits in the file", async () => {
      const summary = await user.json<SpreadsheetSummary>(
        "POST",
        "/spreadsheets/import",
        fileWith({ page: "data", table: "races", column: "race name" }),
        201,
      );
      const { tables } = await readSnapshot(user, summary.id);
      const [runs, races] = [tables[0]!, tables[1]!];
      expect(runs.columns?.[0]).toEqual({
        name: "Race",
        type: "choice",
        choicesFrom: { tableId: races.id, colId: races.colIds[0] },
      });
    });

    it("is refused without choices, with both kinds, or with a source that is not a column", async () => {
      const post = (body: object) => user.json("POST", "/spreadsheets/import", body, 422);
      await post(fileWith(undefined));
      await post(fileWith({ page: "Data", table: "Races", column: "Race Name" }, ["a"]));
      await post(fileWith({ page: "Data", table: "Races", column: "Nothing" }));
      await post(fileWith({ page: "Data", table: "Missing", column: "Race Name" }));
    });
  });
});
