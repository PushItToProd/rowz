import { compare, isScalar, kindOf, type CellValue, type Evaluated, type Scalar } from "../values";
import { boolean, eager, fail, grid, integer, lazy, scalar } from "./arguments";
import type { FunctionDefinition } from "./registry";

/** The cells of a range that is one row or one column, in order. */
function line(value: Evaluated, what: string): CellValue[] {
  const cells = grid(value);
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

export const lookupFunctions: Record<string, FunctionDefinition> = {
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

  /** The cell at a 1-based row and column of a range. A single row or column needs only one position. */
  INDEX: lazy(2, 3, ([range, first, second]) => {
    const cells = grid(range?.() ?? null);
    const position = integer(first?.() ?? null);
    // One position into a single row counts along the row.
    const alongRow = cells.length === 1 && !second;
    const row = alongRow ? 1 : position;
    const col = alongRow ? position : second ? integer(second()) : 1;
    if (row < 1 || col < 1) fail("#VALUE!", "Positions start at 1");
    const cell = cells[row - 1]?.[col - 1];
    return cell === undefined ? fail("#REF!", "The position is outside the range") : cell;
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
    if (position > (rows[0]?.length ?? 0)) fail("#REF!", "The column is outside the range");
    const keys = rows.map(([cell]) => cell ?? null);
    const wanted = scalar(key);
    const row = found(boolean(sorted) ? nearest(wanted, keys) : exact(wanted, keys));
    return rows[row]?.[position - 1] ?? null;
  }),

  /**
   * Finds a key in one row or column and gives the cell at the same position
   * of another. The match is exact. The fourth argument, evaluated only when
   * nothing matches, is the result in that case.
   */
  XLOOKUP: lazy(3, 4, ([key, lookup, result, otherwise]) => {
    const keys = line(lookup?.() ?? null, "The range to search");
    const results = line(result?.() ?? null, "The range of results");
    if (keys.length !== results.length) {
      fail("#VALUE!", "The range to search and the range of results must be the same size");
    }
    const index = exact(scalar(key?.() ?? null), keys);
    if (index === -1 && otherwise) return otherwise();
    return results[found(index)] ?? null;
  }),
};
