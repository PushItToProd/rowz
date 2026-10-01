import {
  FILE_FORMAT,
  spreadsheetFile,
  type CellInput,
  type SpreadsheetFile,
} from "@spreadsheet-app/shared";
import type { PageRecord, TableRecord, ViewRecord } from "../api/client";

type FileItem = SpreadsheetFile["pages"][number]["items"][number];

/** Writes a spreadsheet as a file. `cellsOf` gives the filled cells of a table. */
export function toSpreadsheetFile(
  name: string,
  pages: readonly PageRecord[],
  tables: readonly TableRecord[],
  views: readonly ViewRecord[],
  cellsOf: (table: TableRecord) => CellInput[],
): SpreadsheetFile {
  const itemsOf = (pageId: string): FileItem[] =>
    [
      ...tables.map((table) => ({
        pageId: table.pageId,
        position: table.position,
        item: {
          type: "table",
          name: table.name,
          rowCount: table.rowCount,
          colCount: table.colCount,
          ...(table.columns ? { columns: table.columns } : {}),
          ...(table.formats.length > 0 ? { formats: table.formats } : {}),
          cells: cellsOf(table),
        } satisfies FileItem,
      })),
      ...views.map((view) => ({
        pageId: view.pageId,
        position: view.position,
        item: (view.kind === "chart"
          ? {
              type: "chart",
              name: view.name,
              source: view.source,
              chartType: view.chartType ?? "bar",
            }
          : { type: "text", name: view.name, source: view.source }) satisfies FileItem,
      })),
    ]
      .filter((entry) => entry.pageId === pageId)
      .sort((a, b) => a.position - b.position)
      .map(({ item }) => item);

  return {
    format: FILE_FORMAT,
    version: 1,
    name,
    pages: pages
      .toSorted((a, b) => a.position - b.position)
      .map((page) => ({ name: page.name, items: itemsOf(page.id) })),
  };
}

/** Reads the text of a file as a spreadsheet. Throws an error whose message says what is wrong with it. */
export function readSpreadsheetFile(text: string): SpreadsheetFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not a spreadsheet exported from this app");
  }
  const result = spreadsheetFile.safeParse(parsed);
  if (result.success) return result.data;
  const [issue] = result.error.issues;
  const where = issue?.path.join(".") ?? "";
  throw new Error(
    `The file is not a spreadsheet this app can read${where === "" ? "" : ` (${where}: ${issue?.message ?? ""})`}`,
  );
}
