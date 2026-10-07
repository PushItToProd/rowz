import { mapCsvRowsForAppend } from "@spreadsheet-app/shared";
import type { TableRecord } from "../api/client";
import { parseCsv } from "./csv";

/** The parsed file and its preview mapping for one table's append operation. */
export function prepareCsvAppend(source: string, table: Pick<TableRecord, "columns" | "colCount">) {
  const sourceRows = parseCsv(source);
  return {
    sourceRows,
    ...mapCsvRowsForAppend(sourceRows, table.columns, table.colCount),
  };
}
