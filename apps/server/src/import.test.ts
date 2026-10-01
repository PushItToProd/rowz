import { FILE_LIMITS, LIMITS, type SpreadsheetFile } from "@spreadsheet-app/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Snapshot, SpreadsheetSummary } from "./app";
import { startTestServer, type TestServer, type TestUser } from "./testing";

let server: TestServer;
let user: TestUser;
beforeAll(async () => {
  server = await startTestServer();
  user = await server.signUp();
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
        items: [
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
      { name: "Report", items: [{ type: "text", name: "Summary", source: "{{ Data!Sales!A1 }}" }] },
      { name: "Empty", items: [] },
    ],
    ...overrides,
  };
}

async function imported(contents: SpreadsheetFile): Promise<Snapshot> {
  const summary = await user.json<SpreadsheetSummary>(
    "POST",
    "/spreadsheets/import",
    contents,
    201,
  );
  return user.json<Snapshot>("GET", `/spreadsheets/${summary.id}`);
}

describe("importing a spreadsheet file", () => {
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
          { name: "P", items: [{ type: "table", name: "T", rowCount: 600, colCount: 10, cells }] },
        ],
      }),
    );
    expect(snapshot.cells).toHaveLength(6000);
  });

  it.each<[string, (contents: SpreadsheetFile) => void, string]>([
    [
      "two pages with one name",
      (contents) => contents.pages.push({ name: "data", items: [] }),
      "Two pages are named data",
    ],
    [
      "two tables on a page with one name",
      (contents) =>
        contents.pages[0]!.items.push({
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
        const [table] = contents.pages[0]!.items;
        if (table?.type === "table") table.cells.push({ row: 5, col: 0, input: "x" });
      },
      "A6 is outside the table Sales",
    ],
    [
      "a cell listed twice",
      (contents) => {
        const [table] = contents.pages[0]!.items;
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
      pages: [{ name: "P", items: [table("A", full), table("B", full.slice(0, 1))] }],
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
    ["an unknown kind of item", { ...file(), pages: [{ name: "P", items: [{ type: "map" }] }] }],
    [
      "a table with no rows",
      {
        ...file(),
        pages: [
          { name: "P", items: [{ type: "table", name: "T", rowCount: 0, colCount: 1, cells: [] }] },
        ],
      },
    ],
    [
      "a chart with no kind",
      { ...file(), pages: [{ name: "P", items: [{ type: "chart", name: "C", source: "" }] }] },
    ],
    ["something that is not a file", { hello: "world" }],
  ])("refuses a file with %s", async (_, contents) => {
    await user.json("POST", "/spreadsheets/import", contents, 400);
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
