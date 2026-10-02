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
