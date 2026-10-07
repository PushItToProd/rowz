export interface CsvAppendMapping {
  rows: string[][];
  dataRows: number;
  matchedColumns: string[];
  ignoredColumns: string[];
  duplicateColumnsIgnored: string[];
}

/** Maps parsed CSV rows to the columns a table can store. */
export function mapCsvRowsForAppend(
  sourceRows: readonly (readonly string[])[],
  columns: readonly { name: string }[] | null,
  columnCount: number,
): CsvAppendMapping | { noMatchingColumns: true } {
  if (!columns) {
    const rows = sourceRows.map((row) => [...row]);
    return {
      rows,
      dataRows: rows.length,
      matchedColumns: [],
      ignoredColumns: [],
      duplicateColumnsIgnored: [],
    };
  }

  const [header = [], ...data] = sourceRows;
  const byName = new Map(columns.map((column, index) => [column.name.trim().toLowerCase(), index]));
  const matches = header.map((name) => byName.get(name.trim().toLowerCase()));
  const matchedColumns: string[] = [];
  const ignoredColumns: string[] = [];
  const duplicateColumnsIgnored: string[] = [];
  const seenMatches = new Set<number>();
  const dataMatches = matches.map((column, index) => {
    const name = header[index] ?? "";
    if (column === undefined) {
      ignoredColumns.push(name.trim() || "(unnamed column)");
      return undefined;
    }
    if (seenMatches.has(column)) {
      duplicateColumnsIgnored.push(name.trim() || "(unnamed column)");
      return undefined;
    }
    seenMatches.add(column);
    const columnName = columns[column]?.name;
    if (columnName !== undefined) matchedColumns.push(columnName);
    return column;
  });
  if (seenMatches.size === 0) return { noMatchingColumns: true };

  const rows = data.map((source) => {
    const target = Array.from({ length: columnCount }, () => "");
    dataMatches.forEach((column, index) => {
      if (column !== undefined && column < target.length) target[column] = source[index] ?? "";
    });
    return target;
  });
  return { rows, dataRows: rows.length, matchedColumns, ignoredColumns, duplicateColumnsIgnored };
}
