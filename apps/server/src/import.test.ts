import { FILE_LIMITS, LIMITS, type SpreadsheetFile } from "@spreadsheet-app/shared";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { SpreadsheetSummary } from "./app";
import { Contents } from "./repo/contents";
import { toSpreadsheetFile } from "@spreadsheet-app/shared";
import type { Snapshot } from "./app";
import {
  readSnapshot,
  startTestServer,
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
const limits: { cells: number } = FILE_LIMITS;
const REAL_CELL_LIMIT = FILE_LIMITS.cells;
afterEach(() => {
  limits.cells = REAL_CELL_LIMIT;
});
afterAll(() => server.close());

function file(overrides: Partial<SpreadsheetFile> = {}): SpreadsheetFile {
  return {
    format: "spreadsheet-app",
    version: 1,
    name: "Budget",
    pages: [
      {
        name: "Data",
        blocks: [
          {
            type: "table",
            name: "Sales",
            rowCount: 5,
            colCount: 3,
            cells: [
              { row: 0, col: 0, input: "10" },
              { row: 1, col: 0, input: "=A1*2" },
              { row: 4, col: 2, input: "corner" },
              { row: 2, col: 2, input: "" },
            ],
          },
          { type: "chart", name: "Trend", source: "Sales!A1:B5", chartType: "line" },
          { type: "table", name: "Costs", rowCount: 1, colCount: 1, cells: [] },
        ],
      },
      {
        name: "Report",
        blocks: [{ type: "text", name: "Summary", source: "{{ Data!Sales!A1 }}" }],
      },
      { name: "Empty", blocks: [] },
    ],
    ...overrides,
  };
}

async function imported(contents: SpreadsheetFile): Promise<TestSnapshot> {
  const summary = await user.json<SpreadsheetSummary>(
    "POST",
    "/spreadsheets/import",
    contents,
    201,
  );
  return readSnapshot(user, summary.id);
}

describe("importing a spreadsheet file", () => {
  it("copies all serialized content with fresh IDs, ownership, and empty history", async () => {
    const contents = file();
    const table = contents.pages[0]!.blocks[0]!;
    if (table.type !== "table") throw new Error("Expected table fixture");
    table.gridSizes = { rows: [{ index: 0, size: 60 }], columns: [{ index: 1, size: 180 }] };
    table.formats = [{ startRow: 0, endRow: null, startCol: 0, endCol: 1, format: { bold: true } }];
    table.conditionalFormats = [
      {
        kind: "criterion",
        criterion: ">15",
        startRow: 0,
        endRow: null,
        startCol: 0,
        endCol: 0,
        format: { fill: "red" },
      },
    ];
    table.names = [{ name: "Total", formula: "=SUM(A1:A5)" }];
    table.cells.push({ row: 0, col: 1, input: '=BUTTON("Increment", EXECUTE(A1+1,A1))' });
    contents.pages[1]!.blocks.push(
      { type: "script", name: "Calculations", source: "Twice = Data!Sales!A1*2" },
      {
        type: "table",
        name: "Derived",
        rowCount: 2,
        colCount: 2,
        columns: [
          { name: "Amount", type: "number" },
          { name: "Double", type: "formula", formula: "=[Amount]*2" },
        ],
        display: { sort: [{ column: 0, descending: true }], filter: "=[Amount]>0" },
        cells: [{ row: 0, col: 0, input: "7" }],
      },
      {
        type: "table",
        name: "Choices",
        rowCount: 0,
        colCount: 1,
        columns: [
          {
            name: "Amount",
            type: "choice",
            choicesFrom: { page: "Report", table: "Derived", column: "Amount" },
          },
        ],
        cells: [],
      },
    );
    const source = await imported(contents);
    const reader = await server.signUp("Copier");
    await user.json("PUT", `/spreadsheets/${source.id}/members`, {
      email: reader.email,
      role: "viewer",
    });
    const copy = await reader.json<SpreadsheetSummary>(
      "POST",
      `/spreadsheets/${source.id}/copy`,
      undefined,
      201,
    );
    const original = await user.json<Snapshot>("GET", `/spreadsheets/${source.id}`);
    const duplicated = await reader.json<Snapshot>("GET", `/spreadsheets/${copy.id}`);
    const serialize = (snapshot: Snapshot) => {
      const { data } = new Contents(snapshot);
      return toSpreadsheetFile("same name", snapshot.pages, data.tables, snapshot.views, (table) =>
        data.cells
          .filter((cell) => cell.tableId === table.id)
          .map(({ row, col, input }) => ({ row, col, input })),
      );
    };
    expect(serialize(duplicated)).toEqual(serialize(original));
    expect(duplicated).toMatchObject({
      name: "Budget (copy)",
      role: "owner",
      revision: 0,
      undoable: false,
      redoable: false,
    });
    const identities = (snapshot: Snapshot) => [
      snapshot.id,
      ...snapshot.pages.map((page) => page.id),
      ...snapshot.tables.flatMap((table) => [table.id, ...table.colIds]),
      ...snapshot.rows.map((row) => row.id),
      ...snapshot.views.map((view) => view.id),
    ];
    expect(identities(duplicated).some((id) => identities(original).includes(id))).toBe(false);
    expect(await reader.json("GET", `/spreadsheets/${copy.id}/versions`)).toEqual([]);
    const members = await reader.json<{ shared: boolean }[]>(
      "GET",
      `/spreadsheets/${copy.id}/members`,
    );
    expect(members).toHaveLength(1);
    expect(members[0]!.shared).toBe(false);
    await reader.json("PUT", `/tables/${duplicated.tables[0]!.id}/cells`, {
      cells: [{ row: 0, col: 0, input: "changed" }],
    });
    expect(serialize(await user.json<Snapshot>("GET", `/spreadsheets/${source.id}`))).toEqual(
      serialize(original),
    );
    await user.json("POST", `/spreadsheets/${copy.id}/copy`, undefined, 404);
    const stranger = await server.signUp();
    await stranger.json("POST", `/spreadsheets/${source.id}/copy`, undefined, 404);
    const again = await reader.json<SpreadsheetSummary>(
      "POST",
      `/spreadsheets/${source.id}/copy`,
      undefined,
      201,
    );
    expect(again.name).toBe(copy.name);
    expect(again.id).not.toBe(copy.id);
  });

  it("creates the pages, tables, views, and cells the file describes, in its order", async () => {
    const snapshot = await imported(file());
    expect(snapshot).toMatchObject({ name: "Budget", role: "owner" });
    expect(snapshot.pages.map(({ name, position }) => [name, position])).toEqual([
      ["Data", 0],
      ["Report", 1],
      ["Empty", 2],
    ]);
    const [data, report] = snapshot.pages;
    expect(snapshot.tables).toMatchObject([
      { pageId: data!.id, name: "Sales", position: 0, rowCount: 5, colCount: 3 },
      { pageId: data!.id, name: "Costs", position: 2, rowCount: 1, colCount: 1 },
    ]);
    expect(snapshot.views).toMatchObject([
      { pageId: report!.id, kind: "text", name: "Summary", position: 0, chartType: null },
      { pageId: data!.id, kind: "chart", name: "Trend", position: 1, chartType: "line" },
    ]);
    const sales = snapshot.tables[0]!.id;
    expect(
      snapshot.cells.map(({ tableId, row, col, input }) => [tableId, row, col, input]).sort(),
    ).toEqual([
      [sales, 0, 0, "10"],
      [sales, 1, 0, "=A1*2"],
      [sales, 4, 2, "corner"],
    ]);
  });

  it("keeps a version of the file as it arrived, which the first edit does not replace", async () => {
    const snapshot = await imported(file());
    const sales = snapshot.tables.find((table) => table.name === "Sales")!;
    await user.json(
      "PUT",
      `/tables/${sales.id}/cells`,
      { cells: [{ row: 0, col: 0, input: "changed" }] },
      200,
    );
    const history = await user.json<{ id: string }[]>(
      "GET",
      `/spreadsheets/${snapshot.id}/versions`,
    );
    expect(history).toHaveLength(1);
    await user.json(
      "POST",
      `/spreadsheets/${snapshot.id}/versions/${history[0]!.id}/restore`,
      undefined,
      200,
    );
    const restored = await readSnapshot(user, snapshot.id);
    expect(restored.cells.find((cell) => cell.row === 0 && cell.col === 0)?.input).toBe("10");
  });

  it("lists the new spreadsheet, and can import the same file again", async () => {
    const other = await server.signUp();
    await other.json("POST", "/spreadsheets/import", file({ name: "Twice" }), 201);
    await other.json("POST", "/spreadsheets/import", file({ name: "Twice" }), 201);
    const listed = await other.json<SpreadsheetSummary[]>("GET", "/spreadsheets");
    expect(listed.map((item) => item.name)).toEqual(["Twice", "Twice"]);
  });

  it("stores more cells than one statement can insert", async () => {
    const cells = Array.from({ length: 6000 }, (_, index) => ({
      row: Math.floor(index / 10),
      col: index % 10,
      input: String(index),
    }));
    const snapshot = await imported(
      file({
        pages: [
          { name: "P", blocks: [{ type: "table", name: "T", rowCount: 600, colCount: 10, cells }] },
        ],
      }),
    );
    expect(snapshot.cells).toHaveLength(6000);
  });

  it.each<[string, (contents: SpreadsheetFile) => void, string]>([
    [
      "two pages with one name",
      (contents) => contents.pages.push({ name: "data", blocks: [] }),
      "Two pages are named data",
    ],
    [
      "two tables on a page with one name",
      (contents) =>
        contents.pages[0]!.blocks.push({
          type: "table",
          name: "SALES",
          rowCount: 1,
          colCount: 1,
          cells: [],
        }),
      "Two tables on Data are named SALES",
    ],
    [
      "a cell outside its table",
      (contents) => {
        const [table] = contents.pages[0]!.blocks;
        if (table?.type === "table") table.cells.push({ row: 5, col: 0, input: "x" });
      },
      "A6 is outside the table Sales",
    ],
    [
      "a cell listed twice",
      (contents) => {
        const [table] = contents.pages[0]!.blocks;
        if (table?.type === "table") table.cells.push({ row: 0, col: 0, input: "x" });
      },
      "A1 appears twice in the table Sales",
    ],
  ])("refuses %s, and creates nothing", async (_, spoil, message) => {
    const other = await server.signUp();
    const contents = file();
    spoil(contents);
    expect(await other.json("POST", "/spreadsheets/import", contents, 422)).toEqual({
      error: { code: "invalid_file", message },
    });
    expect(await other.json("GET", "/spreadsheets")).toEqual([]);
  });

  it("refuses a file with more cells than the limit across its tables", async () => {
    const perTable = LIMITS.tableRows * LIMITS.tableCols;
    const full = Array.from({ length: perTable }, (_, index) => ({
      row: Math.floor(index / LIMITS.tableCols),
      col: index % LIMITS.tableCols,
      input: "1",
    }));
    const table = (name: string, cells: typeof full) =>
      ({
        type: "table",
        name,
        rowCount: LIMITS.tableRows,
        colCount: LIMITS.tableCols,
        cells,
      }) as const;
    expect(perTable).toBe(FILE_LIMITS.cells);
    const contents = file({
      pages: [{ name: "P", blocks: [table("A", full), table("B", full.slice(0, 1))] }],
    });
    expect(await user.json("POST", "/spreadsheets/import", contents, 422)).toMatchObject({
      error: { code: "invalid_file" },
    });
  });

  it.each<[string, object]>([
    ["another format", { ...file(), format: "other" }],
    ["a later version", { ...file(), version: 2 }],
    ["no pages", { ...file(), pages: [] }],
    ["no name", { ...file(), name: " " }],
    ["an unknown kind of block", { ...file(), pages: [{ name: "P", blocks: [{ type: "map" }] }] }],
    [
      "a table with fewer than no rows",
      {
        ...file(),
        pages: [
          {
            name: "P",
            blocks: [{ type: "table", name: "T", rowCount: -1, colCount: 1, cells: [] }],
          },
        ],
      },
    ],
    [
      "a chart with no kind",
      { ...file(), pages: [{ name: "P", blocks: [{ type: "chart", name: "C", source: "" }] }] },
    ],
    ["something that is not a file", { hello: "world" }],
  ])("refuses a file with %s", async (_, contents) => {
    await user.json("POST", "/spreadsheets/import", contents, 400);
  });

  it("takes a data table with no rows, and refuses a plain table with none", async () => {
    const empty = (columns?: { name: string; type: "any" }[]) =>
      file({
        pages: [
          {
            name: "P",
            blocks: [
              {
                type: "table",
                name: "T",
                rowCount: 0,
                colCount: 1,
                cells: [],
                ...(columns ? { columns } : {}),
              },
            ],
          },
        ],
      });
    expect(await user.json("POST", "/spreadsheets/import", empty(), 422)).toEqual({
      error: { code: "invalid_file", message: "The table T has no rows" },
    });
    const snapshot = await imported(empty([{ name: "Amount", type: "any" }]));
    expect(snapshot.tables).toMatchObject([{ rowCount: 0, colCount: 1 }]);
    expect(snapshot.rows).toEqual([]);
  });

  it("holds a spreadsheet to the limits of a file, so that what is exported can be imported", async () => {
    const other = await server.signUp();
    const views = Array.from({ length: FILE_LIMITS.blocksPerPage }, (_, index) => ({
      type: "text" as const,
      name: `Text ${String(index)}`,
      source: "",
    }));
    const pages = Array.from({ length: FILE_LIMITS.pages }, (_, index) => ({
      name: `Page ${String(index)}`,
      blocks: index === 0 ? views : [],
    }));
    const summary = await other.json<SpreadsheetSummary>(
      "POST",
      "/spreadsheets/import",
      file({ pages }),
      201,
    );
    const snapshot = await readSnapshot(other, summary.id);
    const [full, empty] = snapshot.pages;

    expect(await other.json("POST", `/spreadsheets/${summary.id}/pages`, {}, 422)).toMatchObject({
      error: { code: "too_many_pages" },
    });
    for (const [path, body] of [
      [`/pages/${full!.id}/tables`, {}],
      [`/pages/${full!.id}/views`, { kind: "chart" }],
    ] as const) {
      expect(await other.json("POST", path, body, 422)).toMatchObject({
        error: { code: "page_full" },
      });
    }
    await other.json("POST", `/pages/${empty!.id}/tables`, {}, 201);
  });

  it("refuses a cell past the most a file may hold, and still lets cells be changed and emptied", async () => {
    // A small limit stands in for the real one, which takes long to reach.
    limits.cells = 3;
    const other = await server.signUp();
    const cells = [0, 1, 2].map((row) => ({ row, col: 0, input: "1" }));
    const full = { type: "table" as const, name: "Full", rowCount: 5, colCount: 1, cells };
    const spare = { type: "table" as const, name: "Spare", rowCount: 2, colCount: 2, cells: [] };
    const summary = await other.json<SpreadsheetSummary>(
      "POST",
      "/spreadsheets/import",
      file({ pages: [{ name: "P", blocks: [full, spare] }] }),
      201,
    );
    const snapshot = await readSnapshot(other, summary.id);
    const [fullId, spareId] = snapshot.tables.map((table) => table.id);
    const put = (tableId: string | undefined, input: string, status: number) =>
      other.json(
        "PUT",
        `/tables/${tableId ?? ""}/cells`,
        { cells: [{ row: 0, col: 0, input }] },
        status,
      );

    expect(await put(spareId, "one too many", 422)).toMatchObject({
      error: { code: "too_many_cells" },
    });
    await put(fullId, "changed", 200);
    await put(fullId, "", 200);
    await put(spareId, "fits now", 200);
  });

  it("refuses a body larger than a file may be", async () => {
    const response = await user.request("POST", "/spreadsheets/import", {
      ...file(),
      padding: "x".repeat(FILE_LIMITS.bytes),
    });
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: { code: "too_large", message: "The request is too large" },
    });
  });
});
