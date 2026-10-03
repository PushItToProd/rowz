import { criterion } from "./functions/criteria";
import { Failure } from "./functions/arguments";
import type { CellFormat, ConditionalRule, FormatPatch, RuleArea } from "./formats";
import { isScalar, type CellValue } from "./values";

/** The smallest and largest number in the area a color scale covers. */
export interface ScaleBounds {
  min: number;
  max: number;
}

/** A table's conditional rules with what applying them to cells needs, worked out once. */
export interface PreparedConditionals {
  rules: readonly ConditionalRule[];
  /** For each rule, the test of a criterion rule. A criterion that cannot be built matches nothing. */
  tests: readonly (((cell: CellValue) => boolean) | undefined)[];
  /**
   * The numbers the scale rule at an index spans, or `undefined` when its area
   * holds none. Worked out when first asked for, so that a table nobody is
   * looking at costs nothing.
   */
  bounds(index: number): ScaleBounds | undefined;
}

function within(start: number, end: number | null, index: number): boolean {
  return index >= start && (end === null || index <= end);
}

function covers(area: RuleArea, row: number, col: number): boolean {
  return within(area.startRow, area.endRow, row) && within(area.startCol, area.endCol, col);
}

/**
 * The test a criterion rule applies, or `undefined` when the criterion cannot
 * be built, as a wildcard pattern that is too long. The server refuses such a
 * criterion on save, so this is the answer for a rule it did not check.
 */
export function criterionTest(text: string): ((cell: CellValue) => boolean) | undefined {
  try {
    return criterion(text);
  } catch (cause) {
    if (cause instanceof Failure) return undefined;
    throw cause;
  }
}

/** The smallest and largest number among the cells of an area, which stops at the table's size where it is open. */
export function scaleBounds(
  area: RuleArea,
  read: (row: number, col: number) => CellValue,
  extent: { rows: number; cols: number },
): ScaleBounds | undefined {
  const endRow = Math.min(area.endRow ?? Infinity, extent.rows - 1);
  const endCol = Math.min(area.endCol ?? Infinity, extent.cols - 1);
  let min = Infinity;
  let max = -Infinity;
  for (let row = area.startRow; row <= endRow; row += 1) {
    for (let col = area.startCol; col <= endCol; col += 1) {
      const value = read(row, col);
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
  }
  return min <= max ? { min, max } : undefined;
}

/** Builds the tests and scale bounds of a table's rules for the cells as they are now. */
export function prepareConditionals(
  rules: readonly ConditionalRule[],
  read: (row: number, col: number) => CellValue,
  extent: { rows: number; cols: number },
): PreparedConditionals {
  const spans = new Map<number, ScaleBounds | undefined>();
  return {
    rules,
    tests: rules.map((rule) =>
      rule.kind === "criterion" ? criterionTest(rule.criterion) : undefined,
    ),
    bounds(index) {
      const rule = rules[index];
      if (rule?.kind !== "scale") return undefined;
      if (!spans.has(index)) spans.set(index, scaleBounds(rule, read, extent));
      return spans.get(index);
    },
  };
}

/** Where a number sits from the smallest, 0, to the largest, 1. The middle when they are equal. */
function positionIn({ min, max }: ScaleBounds, value: number): number {
  if (max === min) return 0.5;
  // Finite numbers can be far enough apart for their difference to overflow, which halving avoids.
  const size = Number.isFinite(max - min) ? 1 : 2;
  return (value / size - min / size) / (max / size - min / size);
}

/**
 * What conditional rules do to one cell's format. A property that is `null`
 * was removed by a rule, and removes it from the plain format beneath too.
 */
export type ConditionalFormat = FormatPatch & Pick<CellFormat, "shade">;

/**
 * The format the conditional rules give one cell, to lay over the format its
 * table's plain rules give it. Rules apply in order, later over earlier. A
 * criterion rule applies where the cell's own value meets the criterion. A
 * scale rule shades a number by where it sits between the smallest and
 * largest number of the rule's area, and gives the middle shade when they are
 * equal.
 */
export function conditionalFormatAt(
  prepared: PreparedConditionals,
  row: number,
  col: number,
  value: CellValue,
): ConditionalFormat {
  const format: Record<string, unknown> = {};
  for (const [index, rule] of prepared.rules.entries()) {
    if (!covers(rule, row, col)) continue;
    if (rule.kind === "criterion") {
      if (!prepared.tests[index]?.(isScalar(value) ? value : null)) continue;
      for (const [key, patch] of Object.entries(rule.format)) {
        format[key] = patch === false ? null : patch;
      }
      // A fill given after a scale is the one shown.
      if (rule.format.fill !== undefined) Reflect.deleteProperty(format, "shade");
      continue;
    }
    const bounds = prepared.bounds(index);
    if (!bounds || typeof value !== "number" || !Number.isFinite(value)) continue;
    format.shade = { low: rule.low, high: rule.high, at: positionIn(bounds, value) };
  }
  return format;
}
