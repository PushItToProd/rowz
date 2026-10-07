import { callFunction } from "../evaluate";
import {
  cellOrder,
  identityOf,
  isError,
  isScalar,
  type CellValue,
  type Evaluated,
} from "../values";
import {
  array,
  boolean,
  eager,
  element,
  fail,
  grid,
  integer,
  functionValue,
  lazy,
  limitCells,
  number,
} from "./arguments";
import type { FunctionDefinition } from "./registry";

function width(rows: readonly CellValue[][]): number {
  return rows[0]?.length ?? 0;
}

function sortDirection(value: Evaluated): number {
  const direction = number(value);
  if (direction !== 1 && direction !== -1) fail("#VALUE!", "Sort order must be 1 or -1");
  return direction;
}

function result(rows: CellValue[][], whenEmpty: string): Evaluated {
  return rows.length === 0 || width(rows) === 0 ? fail("#N/A", whenEmpty) : array(rows);
}

/** A key under which two cells that compare as equal are the same. */
function identity(cell: CellValue): string {
  if (isScalar(cell)) return identityOf(cell);
  return isError(cell) ? `e:${cell.code}` : "other";
}

/** How many leading (positive) or trailing (negative) items a count selects out of `length`. */
function slice<T>(items: readonly T[], count: number, keep: boolean): T[] {
  if (count === 0) fail("#VALUE!", "The count cannot be 0");
  const fromStart = count > 0;
  const size = Math.min(Math.abs(count), items.length);
  if (keep) return fromStart ? items.slice(0, size) : items.slice(items.length - size);
  return fromStart ? items.slice(size) : items.slice(0, items.length - size);
}

/** Defines `TAKE` (keep) or `DROP` (remove): rows first, then optionally columns. */
function takeOrDrop(keep: boolean, minArgs = 2, maxArgs = 3): FunctionDefinition {
  return lazy(minArgs, maxArgs, ([source, rowCount, colCount]) => {
    let rows = slice(grid(source?.() ?? null), integer(rowCount?.() ?? null), keep);
    if (colCount) {
      const count = integer(colCount());
      rows = rows.map((cells) => slice(cells, count, keep));
    }
    return result(rows, "Nothing is left");
  });
}

export const arrayFunctions: Record<string, FunctionDefinition> = {
  /**
   * Keeps the rows of a range where every condition is true. A condition is a
   * column as tall as the range, usually a comparison such as `B1:B9 > 5`. A
   * condition that is a row as wide as the range keeps columns.
   */
  FILTER: eager(2, Infinity, (source, ...conditions) => {
    const rows = grid(source);
    const keepRow = rows.map(() => true);
    const keepCol = Array.from({ length: width(rows) }, () => true);
    for (const condition of conditions) {
      const flags = grid(condition);
      if (flags.length === rows.length && flags.every((cells) => cells.length === 1)) {
        flags.forEach(([flag = null], row) => (keepRow[row] &&= boolean(flag)));
      } else if (flags.length === 1 && width(flags) === width(rows)) {
        flags[0]?.forEach((flag, col) => (keepCol[col] &&= boolean(flag)));
      } else {
        fail("#VALUE!", "A condition must be one column as tall as the range, or one row as wide");
      }
    }
    const kept = rows
      .filter((_, row) => keepRow[row])
      .map((cells) => cells.filter((_, col) => keepCol[col]));
    return result(kept, "Nothing matches");
  }),

  /** Keeps columns where every condition row is true. Each condition must be one row as wide as the range. */
  FILTER_COLUMNS: eager(2, Infinity, (source, ...conditions) => {
    const rows = grid(source);
    const columns = width(rows);
    const keep = Array.from({ length: columns }, () => true);
    for (const condition of conditions) {
      const flags = grid(condition);
      if (flags.length !== 1 || width(flags) !== columns) {
        fail("#VALUE!", "A condition must be one row as wide as the range");
      }
      flags[0]?.forEach((flag, col) => (keep[col] &&= boolean(flag)));
    }
    return result(
      rows.map((cells) => cells.filter((_, col) => keep[col])),
      "Nothing matches",
    );
  }),

  /** Selects columns by their 1-based positions; negative positions count from the right. */
  CHOOSECOLS: eager(2, Infinity, (source, ...columnNumbers) => {
    const rows = grid(source);
    const columns = width(rows);
    const selected = columnNumbers.map((columnNumber) => {
      const position = integer(columnNumber);
      if (position === 0 || Math.abs(position) > columns) {
        fail("#VALUE!", "A column number is not in the range");
      }
      return position > 0 ? position - 1 : columns + position;
    });
    limitCells(rows.length * selected.length);
    return array(rows.map((cells) => selected.map((column) => cells[column] ?? null)));
  }),

  /**
   * Sorts the rows of a range. Without more arguments it sorts by the first
   * column, ascending. Otherwise the arguments are pairs of a column number
   * and TRUE for ascending or FALSE for descending. -1 also means descending,
   * as it does in Excel.
   */
  SORT: eager(1, Infinity, (source, ...keys) => {
    const rows = grid(source);
    // A range over a table with no rows has no column to sort by.
    if (rows.length === 0) return array([]);
    const criteria: { col: number; direction: number }[] = [];
    for (let index = 0; index < Math.max(keys.length, 1); index += 2) {
      const column = keys[index] === undefined ? 1 : integer(keys[index] ?? null);
      if (column < 1 || column > width(rows))
        fail("#VALUE!", "The column to sort by is not in the range");
      const order = keys[index + 1] ?? null;
      const ascending = keys[index + 1] === undefined || (order !== -1 && boolean(order));
      criteria.push({ col: column - 1, direction: ascending ? 1 : -1 });
    }
    return array(
      rows.toSorted((a, b) => {
        for (const { col, direction } of criteria) {
          const order = cellOrder(a[col] ?? null, b[col] ?? null, direction);
          if (order !== 0) return order;
        }
        return 0;
      }),
    );
  }),

  /** Sorts rows by column arrays, or columns by row arrays, keeping the input order for ties. */
  SORTBY: lazy(2, Infinity, (args) => {
    if (args.length > 3 && (args.length - 3) % 2 !== 0) {
      fail("#VALUE!", "Each additional sort key needs a sort order");
    }
    const rows = grid(args[0]?.() ?? null);
    const rowCount = rows.length;
    const columnCount = width(rows);
    const firstKey = grid(args[1]?.() ?? null);
    const vertical = firstKey.length === rowCount && firstKey.every((cells) => cells.length === 1);
    const horizontal = firstKey.length === 1 && width(firstKey) === columnCount;
    if (!vertical && !horizontal) {
      fail("#VALUE!", "A sort key must be one row or column matching the array");
    }
    const sortRows = vertical;
    const keyValues = (keyRows: CellValue[][]): CellValue[] => {
      const matches = sortRows
        ? keyRows.length === rowCount && keyRows.every((cells) => cells.length === 1)
        : keyRows.length === 1 && width(keyRows) === columnCount;
      if (!matches) fail("#VALUE!", "A sort key must be one row or column matching the array");
      return sortRows ? keyRows.map((cells) => cells[0] ?? null) : [...(keyRows[0] ?? [])];
    };
    const criteria = [
      {
        values: keyValues(firstKey),
        direction: args[2] === undefined ? 1 : sortDirection(args[2]()),
      },
    ];
    for (let index = 3; index < args.length; index += 2) {
      const keyRows = grid(args[index]?.() ?? null);
      const order = args[index + 1];
      if (!order) fail("#VALUE!", "Each additional sort key needs a sort order");
      criteria.push({ values: keyValues(keyRows), direction: sortDirection(order()) });
    }

    const compareIndexes = (left: number, right: number): number => {
      for (const { values, direction } of criteria) {
        const order = cellOrder(values[left] ?? null, values[right] ?? null, direction);
        if (order !== 0) return order;
      }
      return 0;
    };
    const indexes = Array.from(
      { length: sortRows ? rowCount : columnCount },
      (_, index) => index,
    ).toSorted(compareIndexes);
    return sortRows
      ? array(indexes.map((row) => rows[row] ?? []))
      : array(rows.map((cells) => indexes.map((column) => cells[column] ?? null)));
  }),

  /** The rows of a range with repeats removed, keeping the first of each. */
  UNIQUE: eager(1, 1, (source) => {
    const seen = new Set<string>();
    return array(
      grid(source).filter((cells) => {
        const key = JSON.stringify(cells.map(identity));
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    );
  }),

  /** A grid of counting numbers, filled row by row. */
  SEQUENCE: eager(1, 4, (rowCount, colCount = 1, start = 1, step = 1) => {
    const [height, wide] = [integer(rowCount), integer(colCount)];
    if (height < 1 || wide < 1) fail("#VALUE!", "SEQUENCE needs at least one row and one column");
    limitCells(height * wide);
    const [first, increment] = [number(start), number(step)];
    return array(
      Array.from({ length: height }, (_, row) =>
        Array.from({ length: wide }, (_, col) => first + (row * wide + col) * increment),
      ),
    );
  }),

  TRANSPOSE: eager(1, 1, (source) => {
    const rows = grid(source);
    return array(
      Array.from({ length: width(rows) }, (_, col) => rows.map((cells) => cells[col] ?? null)),
    );
  }),

  /** The first rows of a range, or the last with a negative count. A third argument does the same for columns. */
  TAKE: takeOrDrop(true),
  /** Takes the requested number of rows and columns, using the same count rules as TAKE. */
  ARRAY_CONSTRAIN: takeOrDrop(true, 3, 3),
  /** A range without its first rows, or without its last with a negative count. */
  DROP: takeOrDrop(false),

  /** Puts ranges side by side. Shorter ones are padded with empty cells at the bottom. */
  HSTACK: eager(1, Infinity, (...sources) => {
    const grids = sources.map(grid);
    const height = Math.max(...grids.map((rows) => rows.length));
    limitCells(height * grids.reduce((total, rows) => total + width(rows), 0));
    return array(
      Array.from({ length: height }, (_, row) =>
        grids.flatMap((rows) =>
          Array.from({ length: width(rows) }, (_, col) => rows[row]?.[col] ?? null),
        ),
      ),
    );
  }),
  /** Puts ranges one under another. Narrower ones are padded with empty cells on the right. */
  VSTACK: eager(1, Infinity, (...sources) => {
    const grids = sources.map(grid);
    const widest = Math.max(...grids.map(width));
    limitCells(widest * grids.reduce((total, rows) => total + rows.length, 0));
    return array(
      grids.flatMap((rows) =>
        rows.map((cells) => Array.from({ length: widest }, (_, col) => cells[col] ?? null)),
      ),
    );
  }),

  /** Every cell of the ranges in one column, reading each range row by row. */
  FLATTEN: eager(1, Infinity, (...sources) => {
    const grids = sources.map(grid);
    limitCells(grids.flat().reduce((total, cells) => total + cells.length, 0));
    return result(
      grids.flatMap((rows) => rows.flat()).map((cell) => [cell]),
      "There are no cells to list",
    );
  }),

  ROWS: eager(1, 1, (source) => grid(source).length),
  COLUMNS: eager(1, 1, (source) => width(grid(source))),

  /**
   * Calls a function on each cell of an array and gives an array of the
   * results. With several arrays of one size, the function gets one cell of
   * each.
   */
  MAP: lazy(2, Infinity, (args, context) => {
    const convert = functionValue(args.at(-1)?.() ?? null);
    const grids = args.slice(0, -1).map((arg) => grid(arg()));
    const [first = []] = grids;
    if (grids.some((rows) => rows.length !== first.length || width(rows) !== width(first))) {
      fail("#VALUE!", "The arrays given to MAP must be the same size");
    }
    return array(
      first.map((cells, row) =>
        cells.map((_, col) =>
          element(() =>
            callFunction(
              convert,
              grids.map((rows) => rows[row]?.[col] ?? null),
              context,
            ),
          ),
        ),
      ),
    );
  }),

  /**
   * Folds an array into one value: starts from an initial value and, for each
   * cell in reading order, replaces it with `function(value so far, cell)`.
   */
  REDUCE: lazy(3, 3, ([initial, source, combine], context) => {
    const step = functionValue(combine?.() ?? null);
    return grid(source?.() ?? null)
      .flat()
      .reduce<Evaluated>(
        (soFar, cell) => callFunction(step, [soFar, cell], context),
        initial?.() ?? null,
      );
  }),

  /** Returns each running accumulator value in the same arrangement as the input array. */
  SCAN: lazy(2, 3, (args, context) => {
    const hasInitial = args.length === 3;
    const step = functionValue(args.at(-1)?.() ?? null);
    const rows = grid(args[hasInitial ? 1 : 0]?.() ?? null);
    let accumulator: Evaluated = hasInitial ? (args[0]?.() ?? null) : null;
    let started = hasInitial;
    return array(
      rows.map((cells) =>
        cells.map((cell) => {
          if (!started) {
            accumulator = cell;
            started = true;
            return cell;
          }
          accumulator = element(() => callFunction(step, [accumulator, cell], context));
          return accumulator;
        }),
      ),
    );
  }),

  /** Calls a function on each row of a range and gives a column of the results. */
  BYROW: lazy(2, 2, ([source, convert], context) => {
    const each = functionValue(convert?.() ?? null);
    return array(
      grid(source?.() ?? null).map((cells) => [
        element(() => callFunction(each, [array([cells])], context)),
      ]),
    );
  }),

  /** Calls a function on each column of a range and gives a row of the results. */
  BYCOL: lazy(2, 2, ([source, convert], context) => {
    const each = functionValue(convert?.() ?? null);
    const rows = grid(source?.() ?? null);
    return array([
      Array.from({ length: width(rows) }, (_, col) =>
        element(() =>
          callFunction(each, [array(rows.map((cells) => [cells[col] ?? null]))], context),
        ),
      ),
    ]);
  }),
};
