import { cellOrder, type CellValue } from "./values";

/** One key of a table's sort: a column, by its id, and the direction. */
export interface SortKey {
  colId: string;
  descending: boolean;
}

/**
 * How a table is shown. Sorting and filtering are display settings: the
 * stored row order does not change, so `A2` and `SUM(Sales[Amount])` read the
 * same cells under any sort or filter.
 */
export interface TableDisplay {
  sort: SortKey[];
  /** A formula that is true for the rows to show, such as `=[Payout] > 60000`. */
  filter?: string;
}

/** What a sort key reads: the column's position in the table, and its direction. */
export interface SortColumn {
  col: number;
  descending: boolean;
}

/**
 * The stored row indexes of a table in the order it is shown. Rows `shown`
 * rejects are left out. The sort is stable, so rows that tie keep their
 * stored order, and empty cells go last in either direction.
 */
export function displayRows(
  rowCount: number,
  valueAt: (row: number, col: number) => CellValue,
  sort: readonly SortColumn[],
  shown: (row: number) => boolean = () => true,
): number[] {
  const rows: number[] = [];
  for (let row = 0; row < rowCount; row += 1) if (shown(row)) rows.push(row);
  if (sort.length === 0) return rows;
  const keyed = rows.map((row) => ({
    row,
    values: sort.map(({ col }) => valueAt(row, col)),
  }));
  keyed.sort((a, b) => {
    for (const [index, { descending }] of sort.entries()) {
      const order = cellOrder(
        a.values[index] ?? null,
        b.values[index] ?? null,
        descending ? -1 : 1,
      );
      if (order !== 0) return order;
    }
    return a.row - b.row;
  });
  return keyed.map(({ row }) => row);
}
