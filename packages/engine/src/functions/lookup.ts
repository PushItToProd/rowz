import { compare, isScalar, kindOf, type CellValue, type Evaluated, type Scalar } from "../values";
import type { CellRange } from "../address";
import { array, boolean, eager, fail, grid, integer, lazy, scalar } from "./arguments";
import type { FunctionDefinition } from "./registry";

/** `ROW` or `COLUMN`: the position of a referenced cell, or of the formula's own cell. */
function position(
  name: string,
  read: (place: CellRange | { row: number; col: number }) => number,
): FunctionDefinition {
  return {
    kind: "special",
    minArgs: 0,
    maxArgs: 1,
    evaluate([target], context) {
      if (!target) return read(context.origin) + 1;
      if (target.type !== "reference") fail("#VALUE!", `${name} takes a cell reference`);
      const range = context.resolve(target.reference);
      return range ? read(range) + 1 : fail("#REF!", "The table was not found");
    },
  };
}

/** The cells of a range that is one row or one column, in order. */
function line(value: Evaluated | CellValue[][], what: string): CellValue[] {
  const cells = Array.isArray(value) ? value : grid(value);
  if (cells.length === 1) return cells[0] ?? [];
  if (cells.every((row) => row.length === 1)) return cells.map(([cell]) => cell ?? null);
  return fail("#VALUE!", `${what} must be a single row or column`);
}

function comparable(key: Scalar, cell: CellValue): cell is Scalar {
  return isScalar(cell) && cell !== null && kindOf(cell) === kindOf(key);
}

/** The index of the first cell equal to the key, or -1. Text is matched without regard to letter case. */
function exact(key: Scalar, cells: readonly CellValue[]): number {
  return cells.findIndex((cell) => comparable(key, cell) && compare(cell, key) === 0);
}

/**
 * The index of the last cell that is at most the key, for cells sorted in
 * ascending order, or -1. With `descending`, the last cell that is at least
 * the key, for cells sorted the other way.
 */
function nearest(key: Scalar, cells: readonly CellValue[], descending = false): number {
  return cells.findLastIndex(
    (cell) =>
      comparable(key, cell) && (descending ? compare(cell, key) >= 0 : compare(cell, key) <= 0),
  );
}

function found(index: number): number {
  return index === -1 ? fail("#N/A", "No match was found") : index;
}

function isVertical(rows: CellValue[][]): boolean {
  return rows.length > 1 && rows.every((row) => row.length === 1);
}

function horizontal(rows: CellValue[][]): boolean {
  if (rows.length === 1) return true;
  if (isVertical(rows)) return false;
  const width = rows.reduce((widest, row) => Math.max(widest, row.length), 0);
  return width > rows.length;
}

export const lookupFunctions: Record<string, FunctionDefinition> = {
  /** Whether a row or column contains a value equal to the key. Text comparison ignores letter case. */
  RANGE_CONTAINS: eager(2, 2, (range, key) => exact(scalar(key), grid(range).flat()) !== -1),

  /**
   * The 1-based position of a value in a row or column. The match type is 0
   * for an exact match, 1 (the default) for the nearest value at or below
   * the key in ascending data, and -1 for the nearest at or above it in
   * descending data.
   */
  MATCH: eager(2, 3, (key, range, type = 1) => {
    const cells = line(range, "The range to search");
    const mode = integer(type);
    const wanted = scalar(key);
    return found(mode === 0 ? exact(wanted, cells) : nearest(wanted, cells, mode < 0)) + 1;
  }),

  /**
   * Finds the nearest value at or below the key in sorted ascending data. A
   * row or column is searched as a vector. A wider 2-D range searches its
   * first row and returns from its last row; a taller or square range searches
   * its first column and returns from its last column. With a result vector,
   * its orientation chooses the direction for a 2-D search. A result vector
   * must have the same length as the searched vector.
   */
  LOOKUP: lazy(2, 3, ([key, search, result]) => {
    const rows = grid(search?.() ?? null);
    const twoDimensional = rows.length > 1 && !rows.every((row) => row.length === 1);
    const resultRows = result === undefined ? undefined : grid(result());
    const results = resultRows === undefined ? undefined : line(resultRows, "The result range");
    const isHorizontal =
      twoDimensional && resultRows !== undefined ? horizontal(resultRows) : horizontal(rows);
    const keys = isHorizontal ? (rows[0] ?? []) : rows.map((row) => row[0] ?? null);
    if (results !== undefined && results.length !== keys.length) {
      fail("#VALUE!", "The search and result ranges must have the same size");
    }
    const wanted = scalar(key?.() ?? null);
    const index = found(nearest(wanted, keys));

    if (results !== undefined) {
      return results[index] ?? null;
    }

    if (!twoDimensional) return keys[index] ?? null;
    return isHorizontal ? (rows.at(-1)?.[index] ?? null) : (rows[index]?.at(-1) ?? null);
  }),

  /**
   * Finds a row key in the first column and a column key in the first row,
   * then gives the cell where that row and column meet. The top-left cell is
   * ignored. Both keys must match exactly.
   */
  XYLOOKUP: eager(3, 3, (rowKey, columnKey, range) => {
    const rows = grid(range);
    const width = rows[0]?.length ?? 0;
    if (rows.length < 2 || width < 2 || rows.some((row) => row.length !== width)) {
      fail("#VALUE!", "The range must have a header row and a header column");
    }
    const rowKeys = rows.slice(1).map((row) => row[0] ?? null);
    const columnKeys = (rows[0] ?? []).slice(1);
    const row = found(exact(scalar(rowKey), rowKeys));
    const column = found(exact(scalar(columnKey), columnKeys));
    return rows[row + 1]?.[column + 1] ?? null;
  }),

  /**
   * The cell at a 1-based row and column of a range. A single row or column
   * needs only one position. Leaving the column out, or giving 0 for the row
   * or the column, takes the whole row or column.
   */
  INDEX: lazy(2, 3, ([range, first, second]) => {
    const cells = grid(range?.() ?? null);
    const position = integer(first?.() ?? null);
    // One position into a single row counts along the row.
    const alongRow = cells.length === 1 && !second;
    const row = alongRow ? 1 : position;
    const col = alongRow ? position : second ? integer(second()) : 0;
    if (row < 0 || col < 0) fail("#VALUE!", "Positions start at 1");
    const width = cells[0]?.length ?? 0;
    if (row > cells.length || col > width) fail("#REF!", "The position is outside the range");
    const rows = row === 0 ? cells : [cells[row - 1] ?? []];
    const picked = col === 0 ? rows : rows.map((line) => [line[col - 1] ?? null]);
    return picked.length === 1 && picked[0]?.length === 1 ? (picked[0][0] ?? null) : array(picked);
  }),

  /**
   * Finds a key in the first column of a range and gives the cell of that row
   * in another column. It looks for the nearest key at or below the given one
   * in sorted data unless `sorted` is FALSE, which asks for an exact match.
   */
  VLOOKUP: eager(3, 4, (key, range, column, sorted = true) => {
    const rows = grid(range);
    const position = integer(column);
    if (position < 1) fail("#VALUE!", "The column must be 1 or more");
    // A range with no rows has no width to check the column against, and no key to find.
    if (rows.length > 0 && position > (rows[0]?.length ?? 0)) {
      fail("#REF!", "The column is outside the range");
    }
    const keys = rows.map(([cell]) => cell ?? null);
    const wanted = scalar(key);
    const row = found(boolean(sorted) ? nearest(wanted, keys) : exact(wanted, keys));
    return rows[row]?.[position - 1] ?? null;
  }),

  /** `VLOOKUP` turned on its side: finds a key in the first row and gives the cell of that column in another row. */
  HLOOKUP: eager(3, 4, (key, range, row, sorted = true) => {
    const rows = grid(range);
    const wantedRow = integer(row);
    if (wantedRow < 1) fail("#VALUE!", "The row must be 1 or more");
    if (wantedRow > rows.length) fail("#REF!", "The row is outside the range");
    const keys = rows[0] ?? [];
    const wanted = scalar(key);
    const col = found(boolean(sorted) ? nearest(wanted, keys) : exact(wanted, keys));
    return rows[wantedRow - 1]?.[col] ?? null;
  }),

  /** The row number of a cell, or of the formula's own cell. */
  ROW: position("ROW", (place) => ("row" in place ? place.row : place.startRow)),
  /** The column number of a cell, or of the formula's own cell. Column A is 1. */
  COLUMN: position("COLUMN", (place) => ("col" in place ? place.col : place.startCol)),

  /**
   * Finds a key in one row or column and gives what is at the same position
   * of another range: a cell, or a whole row or column when the range of
   * results is wider. The match is exact. The fourth argument, evaluated only
   * when nothing matches, is the result in that case.
   */
  XLOOKUP: lazy(3, 4, ([key, lookup, result, otherwise]) => {
    const searched = grid(lookup?.() ?? null);
    const keys = line(searched, "The range to search");
    const results = grid(result?.() ?? null);
    // Keys down a column pair with the rows of the results, and keys along a row with the columns.
    const vertical = searched.length > 1;
    const count = vertical ? results.length : (results[0]?.length ?? 0);
    if (keys.length !== count) {
      fail("#VALUE!", "The range to search and the range of results must be the same size");
    }
    const index = exact(scalar(key?.() ?? null), keys);
    if (index === -1 && otherwise) return otherwise();
    const at = found(index);
    const picked = vertical ? [results[at] ?? []] : results.map((cells) => [cells[at] ?? null]);
    return picked.length === 1 && picked[0]?.length === 1 ? (picked[0][0] ?? null) : array(picked);
  }),
};
