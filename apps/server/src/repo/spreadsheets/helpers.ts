import { isFormulaInput, sameColumnName, type ColumnDefinition } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";

import { conflict, isUniqueViolation } from "../../errors";

/** The first of `Page 1`, `Page 2`, ... that no existing name matches, ignoring case. */
export function nextName(prefix: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const candidate = `${prefix} ${String(n)}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/** Throws, where an expression needs a value. */
export function fail(error: Error): never {
  throw error;
}

/** A filter as it is stored: a formula with its leading `=`. */
export function filterFormula(text: string): string {
  return isFormulaInput(text) ? text : `=${text}`;
}

/** A column definition as it is stored: a formula only on a formula column, and starting with `=`; choices only on a choice column. */
export function normalized({
  name,
  type,
  formula = "",
  choices,
  choicesFrom,
}: ColumnDefinition): ColumnDefinition {
  if (type === "choice") {
    // The list repeats nothing: a choice appears once, in the order first given.
    return choicesFrom
      ? { name, type, choicesFrom }
      : { name, type, choices: [...new Set(choices ?? [])] };
  }
  if (type !== "formula") return { name, type };
  const trimmed = formula.trim();
  return { name, type, formula: isFormulaInput(trimmed) ? trimmed : `=${trimmed}` };
}

/** The first of `Column 1`, `Column 2`, ... that no column has. */
export function nextColumnName(columns: readonly ColumnDefinition[]): string {
  return nextName(
    "Column",
    columns.map((column) => column.name),
  );
}

/** A table's columns with `count` new ones put in at `index`, each with the next free name. */
export function withColumnsInserted(
  columns: readonly ColumnDefinition[],
  index: number,
  count: number,
): ColumnDefinition[] {
  const result = [...columns];
  for (let added = 0; added < count; added += 1) {
    result.splice(index + added, 0, { name: nextColumnName(result), type: "any" });
  }
  return result;
}

/** A table's columns after its width changes: new ones at the end, or fewer. */
export function resized(
  columns: readonly ColumnDefinition[],
  colCount: number,
): ColumnDefinition[] {
  const kept = columns.slice(0, colCount);
  return withColumnsInserted(kept, kept.length, colCount - kept.length);
}

/**
 * A column name made from what a header cell holds. A cell that is empty,
 * holds a formula, or repeats an earlier name gets the next free name.
 */
export function columnNameFrom(input: string | undefined, taken: readonly string[]): string {
  const cleaned = (input ?? "").replaceAll(/[[\]]/g, "").trim().slice(0, LIMITS.nameLength);
  const usable =
    cleaned !== "" &&
    !isFormulaInput(input ?? "") &&
    !taken.some((name) => sameColumnName(name, cleaned));
  return usable ? cleaned : nextName("Column", taken);
}

/** For `.catch()`: turns a unique-name violation into a 409 and rethrows anything else. */
export function rethrowDuplicate(kind: "page" | "table", name: string): (cause: unknown) => never {
  return (cause) => {
    if (isUniqueViolation(cause)) throw conflict(`A ${kind} named ${name} already exists`);
    throw cause;
  };
}
