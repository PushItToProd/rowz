import { moveRun, type StructuralEdit } from "./rewrite";

/** The named colors a cell's text or background can take. What each looks like is up to whatever draws the cell. */
export const FORMAT_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
] as const;
export type FormatColor = (typeof FORMAT_COLORS)[number];

export const FORMAT_ALIGNMENTS = ["left", "center", "right"] as const;

/** How a cell is shown. It changes nothing about the cell's value. */
export interface CellFormat {
  bold?: boolean;
  italic?: boolean;
  align?: (typeof FORMAT_ALIGNMENTS)[number];
  /** The color of the text. */
  color?: FormatColor;
  /** The color of the background. */
  fill?: FormatColor;
  /** A format in the notation `TEXT` takes, applied to numbers and dates: `#,##0.00`, `mmm d, yyyy`. */
  numberFormat?: string;
}

/** A change to formats: a value to set, or `null` to go back to the default. */
export type FormatPatch = { [Key in keyof CellFormat]?: CellFormat[Key] | null };

/**
 * A format given to a range of cells. A table's formats are a list of rules,
 * and a cell is shown with every rule that covers it, later ones over earlier
 * ones. Formatting a whole column is then one rule, and covers rows added
 * later when the rule has no last row.
 */
export interface FormatRule {
  startRow: number;
  /** `null` when the rule runs to the bottom of the table, however long it grows. */
  endRow: number | null;
  startCol: number;
  /** `null` when the rule runs to the right edge of the table. */
  endCol: number | null;
  format: FormatPatch;
  /** Whether the rule first removes every format the cells had. */
  reset?: boolean;
}

/** More rules than a person makes by hand. Past this a table's formats must be cleared before more are added. */
export const MAX_FORMAT_RULES = 500;

type Area = Pick<FormatRule, "startRow" | "endRow" | "startCol" | "endCol">;

function within(start: number, end: number | null, index: number): boolean {
  return index >= start && (end === null || index <= end);
}

/** Whether every cell of `inner` is in `outer`. */
function covers(outer: Area, inner: Area): boolean {
  const along = (
    outerStart: number,
    outerEnd: number | null,
    innerStart: number,
    innerEnd: number | null,
  ): boolean =>
    outerStart <= innerStart && (outerEnd === null || (innerEnd !== null && innerEnd <= outerEnd));
  return (
    along(outer.startRow, outer.endRow, inner.startRow, inner.endRow) &&
    along(outer.startCol, outer.endCol, inner.startCol, inner.endCol)
  );
}

function intersects(a: Area, b: Area): boolean {
  const along = (
    aStart: number,
    aEnd: number | null,
    bStart: number,
    bEnd: number | null,
  ): boolean => (aEnd === null || bStart <= aEnd) && (bEnd === null || aStart <= bEnd);
  return (
    along(a.startRow, a.endRow, b.startRow, b.endRow) &&
    along(a.startCol, a.endCol, b.startCol, b.endCol)
  );
}

/** The format of one cell under a table's rules. Properties left at their defaults are absent. */
export function formatAt(rules: readonly FormatRule[], row: number, col: number): CellFormat {
  let format: Record<string, unknown> = {};
  for (const rule of rules) {
    if (!within(rule.startRow, rule.endRow, row) || !within(rule.startCol, rule.endCol, col)) {
      continue;
    }
    if (rule.reset) format = {};
    for (const [key, value] of Object.entries(rule.format)) {
      if (value === null || value === false) Reflect.deleteProperty(format, key);
      else format[key] = value;
    }
  }
  return format;
}

/**
 * A table's rules with one more applied. Earlier rules that the new one
 * overrides everywhere are dropped, so formatting the same cells again and
 * again does not grow the list.
 */
export function addFormatRule(rules: readonly FormatRule[], rule: FormatRule): FormatRule[] {
  const keys = Object.keys(rule.format);
  const kept = rules.filter((earlier) => {
    if (!covers(rule, earlier)) return true;
    if (rule.reset) return false;
    // A rule that resets still matters for what came before it.
    return (
      earlier.reset === true || !Object.keys(earlier.format).every((key) => keys.includes(key))
    );
  });
  // A rule that only removes formats does nothing where there are none to remove.
  const onlyRemoves = Object.values(rule.format).every(
    (value) => value === null || value === false,
  );
  if (onlyRemoves && !kept.some((earlier) => intersects(rule, earlier))) return kept;
  return [...kept, rule];
}

/**
 * A table's rules after rows or columns are inserted or deleted, so that each
 * rule keeps covering the cells it covered. A rule grows when a row is
 * inserted inside it, shrinks when one inside it is deleted, and is dropped
 * when every row or column it covered is deleted.
 */
export function formatRulesAfterEdit(
  rules: readonly FormatRule[],
  edit: Pick<StructuralEdit, "axis" | "kind" | "index" | "count">,
): FormatRule[] {
  const [startKey, endKey] =
    edit.axis === "row" ? (["startRow", "endRow"] as const) : (["startCol", "endCol"] as const);
  return rules.flatMap((rule) => {
    const end = rule[endKey];
    const moved = moveRun(rule[startKey], end ?? Infinity, edit);
    if (!moved) return [];
    return [{ ...rule, [startKey]: moved[0], [endKey]: end === null ? null : moved[1] }];
  });
}
