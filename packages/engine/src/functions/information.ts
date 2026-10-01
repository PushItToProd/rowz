import { isDate } from "../dates";
import { isError, isRange } from "../values";
import { lazy, scalar } from "./arguments";
import type { FunctionDefinition } from "./registry";

/**
 * Defines a check on a single value. An error is a value here, not a failure
 * of the call, and so is a button, a chart, or anything else a cell can hold.
 * Only a range is refused.
 */
function check(test: (value: unknown) => boolean): FunctionDefinition {
  return lazy(1, 1, ([argument]) => {
    const value = argument?.() ?? null;
    return isRange(value) ? test(scalar(value)) : test(value);
  });
}

export const informationFunctions: Record<string, FunctionDefinition> = {
  ISBLANK: check((value) => value === null),
  ISNUMBER: check((value) => typeof value === "number"),
  ISTEXT: check((value) => typeof value === "string"),
  ISLOGICAL: check((value) => typeof value === "boolean"),
  ISDATE: check(isDate),
  ISERROR: check(isError),
  /** Whether a value is the error `#N/A`, which a lookup gives when it finds nothing. */
  ISNA: check((value) => isError(value) && value.code === "#N/A"),
  /** Whether a value is an error other than `#N/A`. */
  ISERR: check((value) => isError(value) && value.code !== "#N/A"),
  ISNONTEXT: check((value) => typeof value !== "string"),
};
