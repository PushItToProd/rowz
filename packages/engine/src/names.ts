import { parseAddress } from "./address";
import type { FunctionRegistry } from "./functions/registry";

const WORD = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Why a name cannot be defined, or `undefined` when it can. A name that
 * reads as something else in a formula could never be used: `AB12` is a cell,
 * `TRUE` is a value, and `SUM(` calls the built-in function.
 */
export function refusedName(name: string, functions: FunctionRegistry): string | undefined {
  if (name.trim() === "") return "A name cannot be empty";
  if (!WORD.test(name)) return undefined;
  if (parseAddress(name)) return `${name} is a cell address and cannot be used as a name`;
  const upper = name.toUpperCase();
  if (upper === "TRUE" || upper === "FALSE")
    return `${upper} is a value and cannot be used as a name`;
  if (functions.has(upper)) return `${upper} is a function and cannot be used as a name`;
  return undefined;
}

/** Name pairs that share a formula, where each old and new spelling occurs once. */
export function renamedNames(
  before: readonly { name: string; formula: string }[],
  after: readonly { name: string; formula: string }[],
): { from: string; name: string }[] {
  const beforeNames = new Set(before.map(({ name }) => name.toLowerCase()));
  const afterNames = new Set(after.map(({ name }) => name.toLowerCase()));
  const old = before.filter(({ name }) => !afterNames.has(name.toLowerCase()));
  const added = after.filter(({ name }) => !beforeNames.has(name.toLowerCase()));
  const normalize = (formula: string): string =>
    (formula.startsWith("=") ? formula.slice(1) : formula).trim();
  const formulas = new Set([...old, ...added].map(({ formula }) => normalize(formula)));
  return [...formulas].flatMap((formula) => {
    const oldNames = old.filter((item) => normalize(item.formula) === formula);
    const newNames = added.filter((item) => normalize(item.formula) === formula);
    const from = oldNames[0]?.name;
    const name = newNames[0]?.name;
    return oldNames.length === 1 &&
      newNames.length === 1 &&
      from !== undefined &&
      name !== undefined
      ? [{ from, name }]
      : [];
  });
}
