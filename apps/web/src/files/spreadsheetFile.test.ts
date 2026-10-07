import { describe, expect, it } from "vitest";
import type { PageRecord, TableRecord, ViewRecord } from "../api/client";
import { FILE_LIMITS } from "@spreadsheet-app/shared";
import { fitsImport, readSpreadsheetFile, toSpreadsheetFile } from "./spreadsheetFile";

const PAGES: PageRecord[] = [
  { id: "p2", name: "Report", position: 1 },
  { id: "p1", name: "Data", position: 0 },
];
const TABLES: TableRecord[] = [
  {
    id: "t2",
    pageId: "p1",
    name: "Costs",
    position: 2,
    rowCount: 2,
    colCount: 2,
    colIds: ["c1", "c2"],
    gridSizes: { rows: {}, columns: {} },
    columns: null,
    formats: [],
    display: { sort: [] },
    conditionalFormats: [],
    names: [],
    rows: [],
  },
  {
    id: "t1",
    pageId: "p1",
    name: "Sales",
    position: 0,
    rowCount: 5,
    colCount: 3,
    colIds: ["c1", "c2", "c3"],
    gridSizes: { rows: {}, columns: {} },
    columns: null,
    formats: [],
    display: { sort: [] },
    conditionalFormats: [],
    names: [],
    rows: [],
  },
];
const VIEWS: ViewRecord[] = [
  {
    id: "v1",
    pageId: "p1",
    kind: "chart",
    name: "Trend",
    position: 1,
    source: "Sales!A:B",
    chartType: "pie",
  },
  {
    id: "v2",
    pageId: "p2",
    kind: "text",
    name: "Summary",
    position: 0,
    source: "# Hi",
    chartType: null,
  },
];

function file() {
  return toSpreadsheetFile("Budget", PAGES, TABLES, VIEWS, (table) =>
    table.id === "t1" ? [{ row: 0, col: 0, input: "=1+1" }] : [],
  );
}

describe("toSpreadsheetFile", () => {
  it("writes pages and the blocks on them in their order, by name and without ids", () => {
    expect(file()).toEqual({
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
              cells: [{ row: 0, col: 0, input: "=1+1" }],
            },
            { type: "chart", name: "Trend", source: "Sales!A:B", chartType: "pie" },
            { type: "table", name: "Costs", rowCount: 2, colCount: 2, cells: [] },
          ],
        },
        { name: "Report", blocks: [{ type: "text", name: "Summary", source: "# Hi" }] },
      ],
    });
  });

  it("exports freeze counts in the table display so a file round trip keeps them", () => {
    const tables = [{ ...TABLES[0]!, display: { sort: [], freezeRows: 1, freezeColumns: 2 } }];
    const written = toSpreadsheetFile("Budget", PAGES, tables, [], () => []);
    expect(written.pages[0]?.blocks[0]).toMatchObject({
      type: "table",
      display: { sort: [], freezeRows: 1, freezeColumns: 2 },
    });
    expect(readSpreadsheetFile(JSON.stringify(written))).toEqual(written);
  });

  it("exports and imports wrap format rules", () => {
    const formats = [{ startRow: 0, endRow: 0, startCol: 0, endCol: 0, format: { wrap: true } }];
    const written = toSpreadsheetFile("Budget", PAGES, [{ ...TABLES[0]!, formats }], [], () => []);
    expect(written.pages[0]?.blocks[0]).toMatchObject({ type: "table", formats });
    expect(readSpreadsheetFile(JSON.stringify(written))).toEqual(written);
  });
});

describe("toSpreadsheetFile for sort, filter, and dropdown columns", () => {
  const races: TableRecord = {
    ...TABLES[1]!,
    id: "races",
    name: "Races",
    colIds: ["r1", "r2"],
    columns: [
      { name: "Race Name", type: "text" },
      { name: "Payout", type: "number" },
    ],
    display: { sort: [{ colId: "r2", descending: true }], filter: "=[Payout] > 1" },
  };
  const runs = (choicesFrom: { tableId: string; colId: string }): TableRecord => ({
    ...TABLES[0]!,
    id: "runs",
    name: "Runs",
    colIds: ["u1", "u2"],
    columns: [
      { name: "Race", type: "choice", choicesFrom },
      { name: "Kind", type: "choice", choices: ["a", "b"] },
    ],
  });
  const write = (tables: TableRecord[]) =>
    toSpreadsheetFile("Budget", PAGES, tables, [], () => []).pages[0]?.blocks;

  it("writes a sort key as a column position and a source as page, table, and column names", () => {
    const table = (name: string) =>
      write([races, runs({ tableId: "races", colId: "r1" })])!.find(
        (block) => block.type === "table" && block.name === name,
      );
    expect(table("Races")).toMatchObject({
      display: { sort: [{ column: 1, descending: true }], filter: "=[Payout] > 1" },
    });
    expect(table("Runs")).toMatchObject({
      columns: [
        {
          name: "Race",
          type: "choice",
          choicesFrom: { page: "Data", table: "Races", column: "Race Name" },
        },
        { name: "Kind", type: "choice", choices: ["a", "b"] },
      ],
    });
  });

  it("writes a dropdown whose source is gone as one with no choices", () => {
    const blocks = write([runs({ tableId: "gone", colId: "r1" })])!;
    expect(blocks.find((block) => block.type === "table" && block.name === "Runs")).toMatchObject({
      columns: [{ name: "Race", type: "choice", choices: [] }, { name: "Kind" }],
    });
  });
});

describe("readSpreadsheetFile", () => {
  it("reads back a file that was written", () => {
    expect(readSpreadsheetFile(JSON.stringify(file()))).toEqual(file());
  });

  it("refuses text that is not JSON", () => {
    expect(() => readSpreadsheetFile("a,b\n1,2")).toThrow(
      "The file is not a document exported from this app",
    );
  });

  it("refuses JSON that is not a spreadsheet, and says where it goes wrong", () => {
    expect(() => readSpreadsheetFile('{"some": "json"}')).toThrow(
      /^The file is not a document this app can read \(format: /,
    );
    const broken = { ...file(), pages: [{ name: "P", blocks: [{ type: "table", name: "T" }] }] };
    expect(() => readSpreadsheetFile(JSON.stringify(broken))).toThrow(/pages\.0\.blocks\.0\./);
  });
});

describe("fitsImport", () => {
  const withText = (length: number) =>
    toSpreadsheetFile("Big", PAGES, TABLES, [], (table) =>
      table.id === "t1" ? [{ row: 0, col: 0, input: "x".repeat(length) }] : [],
    );

  it("accepts a file the server would read, and refuses one past the size it reads", () => {
    expect(fitsImport(withText(10))).toBe(true);
    expect(fitsImport(withText(FILE_LIMITS.bytes))).toBe(false);
  });
});
