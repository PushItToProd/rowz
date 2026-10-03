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
});

describe("readSpreadsheetFile", () => {
  it("reads back a file that was written", () => {
    expect(readSpreadsheetFile(JSON.stringify(file()))).toEqual(file());
  });

  it("refuses text that is not JSON", () => {
    expect(() => readSpreadsheetFile("a,b\n1,2")).toThrow(
      "The file is not a spreadsheet exported from this app",
    );
  });

  it("refuses JSON that is not a spreadsheet, and says where it goes wrong", () => {
    expect(() => readSpreadsheetFile('{"some": "json"}')).toThrow(
      /^The file is not a spreadsheet this app can read \(format: /,
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
