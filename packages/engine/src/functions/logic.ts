import { compare, isError, type Evaluated } from "../values";
import { boolean, booleans, eager, fail, lazy, scalar } from "./arguments";
import type { FunctionDefinition } from "./registry";

function combine(compute: (values: readonly boolean[]) => boolean): FunctionDefinition {
  return eager(1, Infinity, (...values) => compute(booleans(values)));
}

export const logicFunctions: Record<string, FunctionDefinition> = {
  /** Evaluates only the branch it returns, so `IF(B1=0, 0, A1/B1)` does not divide by zero. */
  IF: lazy(2, 3, ([condition, whenTrue, whenFalse]): Evaluated => {
    if (boolean(condition?.() ?? null)) return whenTrue?.() ?? null;
    return whenFalse ? whenFalse() : false;
  }),
  /** Takes condition and value pairs and gives the value after the first true condition. */
  IFS: lazy(2, Infinity, (args): Evaluated => {
    if (args.length % 2 === 1) fail("#ERROR!", "IFS takes conditions and values in pairs");
    for (let index = 0; index < args.length; index += 2) {
      if (boolean(args[index]?.() ?? null)) return args[index + 1]?.() ?? null;
    }
    return fail("#N/A", "No condition is true");
  }),
  /** Compares a value with each case in turn. A last argument without a pair is the default. */
  SWITCH: lazy(3, Infinity, ([subject, ...rest]): Evaluated => {
    const value = scalar(subject?.() ?? null);
    const hasDefault = rest.length % 2 === 1;
    const pairs = hasDefault ? rest.slice(0, -1) : rest;
    for (let index = 0; index < pairs.length; index += 2) {
      if (compare(value, scalar(pairs[index]?.() ?? null)) === 0) {
        return pairs[index + 1]?.() ?? null;
      }
    }
    return hasDefault ? (rest.at(-1)?.() ?? null) : fail("#N/A", "No case matches");
  }),
  IFERROR: lazy(2, 2, ([value, fallback]): Evaluated => {
    const result = value?.() ?? null;
    return isError(result) ? (fallback?.() ?? null) : result;
  }),
  AND: combine((values) => values.every(Boolean)),
  OR: combine((values) => values.some(Boolean)),
  NOT: eager(1, 1, (value) => !boolean(value)),
};
