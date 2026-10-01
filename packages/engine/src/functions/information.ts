import { isDate } from "../dates";
import { isError } from "../values";
import { lazy, scalar } from "./arguments";
import type { FunctionDefinition } from "./registry";

/** Defines a check on a single value. An error is a value here, not a failure of the call. */
function check(test: (value: unknown) => boolean): FunctionDefinition {
  return lazy(1, 1, ([argument]) => {
    const value = argument?.() ?? null;
    return isError(value) ? test(value) : test(scalar(value));
  });
}

export const informationFunctions: Record<string, FunctionDefinition> = {
  ISBLANK: check((value) => value === null),
  ISNUMBER: check((value) => typeof value === "number"),
  ISTEXT: check((value) => typeof value === "string"),
  ISLOGICAL: check((value) => typeof value === "boolean"),
  ISDATE: check(isDate),
  ISERROR: check(isError),
};
