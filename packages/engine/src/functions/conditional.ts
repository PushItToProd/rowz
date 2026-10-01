import type { CellValue, Evaluated } from "../values";
import { eager, fail, grid, scalar } from "./arguments";
import { criterion } from "./criteria";
import type { FunctionDefinition } from "./registry";

interface Position {
  row: number;
  col: number;
}

/** The positions in a range whose cells meet a criterion. */
function matches(range: Evaluated, criterionValue: Evaluated): Position[] {
  const test = criterion(scalar(criterionValue));
  return grid(range).flatMap((cells, row) =>
    cells.flatMap((cell, col) => (test(cell) ? [{ row, col }] : [])),
  );
}

/** The positions that meet every criterion of `range, criterion` pairs. */
function matchesAll(pairs: readonly Evaluated[], name: string): Position[] {
  if (pairs.length === 0 || pairs.length % 2 === 1) {
    fail("#ERROR!", `${name} takes ranges and criteria in pairs`);
  }
  let positions: Position[] | undefined;
  for (let index = 0; index < pairs.length; index += 2) {
    const found = matches(pairs[index] ?? null, pairs[index + 1] ?? null);
    const keys = new Set(found.map(({ row, col }) => `${String(row)}:${String(col)}`));
    positions = (positions ?? found).filter(({ row, col }) =>
      keys.has(`${String(row)}:${String(col)}`),
    );
  }
  return positions ?? [];
}

/** The numbers found at the given positions of a range. Other values are skipped. */
function numbersAt(range: Evaluated, positions: readonly Position[]): number[] {
  const cells = grid(range);
  return positions
    .map(({ row, col }): CellValue => cells[row]?.[col] ?? null)
    .filter((value) => typeof value === "number");
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: readonly number[]): number {
  return values.length === 0
    ? fail("#DIV/0!", "No numbers to average")
    : sum(values) / values.length;
}

export const conditionalFunctions: Record<string, FunctionDefinition> = {
  COUNTIF: eager(2, 2, (range, test) => matches(range, test).length),
  /** Adds the numbers of `sumRange` (or of `range`) where the cell of `range` meets the criterion. */
  SUMIF: eager(2, 3, (range, test, sumRange = range) =>
    sum(numbersAt(sumRange, matches(range, test))),
  ),
  AVERAGEIF: eager(2, 3, (range, test, averageRange = range) =>
    average(numbersAt(averageRange, matches(range, test))),
  ),
  /** The largest number of `range` where every criterion is met, or 0 when none is. */
  MAXIFS: eager(3, Infinity, (range, ...pairs) => {
    const found = numbersAt(range, matchesAll(pairs, "MAXIFS"));
    return found.length === 0 ? 0 : Math.max(...found);
  }),
  /** The smallest number of `range` where every criterion is met, or 0 when none is. */
  MINIFS: eager(3, Infinity, (range, ...pairs) => {
    const found = numbersAt(range, matchesAll(pairs, "MINIFS"));
    return found.length === 0 ? 0 : Math.min(...found);
  }),
  COUNTIFS: eager(2, Infinity, (...pairs) => matchesAll(pairs, "COUNTIFS").length),
  SUMIFS: eager(3, Infinity, (sumRange, ...pairs) =>
    sum(numbersAt(sumRange, matchesAll(pairs, "SUMIFS"))),
  ),
};
