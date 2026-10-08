import { compare, isError, type Evaluated } from "../values";
import { boolean, booleans, eager, fail, lazy, scalar, text } from "./arguments";
import type { FunctionDefinition } from "./registry";

function combine(compute: (values: readonly boolean[]) => boolean): FunctionDefinition {
  return eager(1, Infinity, (...values) => compute(booleans(values)));
}

function shortCircuit(isAnd: boolean): FunctionDefinition {
  const definition = lazy(1, Infinity, (args) => {
    for (const arg of args) {
      const values = booleans([arg()]);
      if (isAnd ? values.includes(false) : values.includes(true)) return !isAnd;
    }
    return isAnd;
  });
  return { ...definition, callableAsValue: true };
}

export const logicFunctions: Record<string, FunctionDefinition> = {
  /** Evaluates only the branch it returns, so `IF(B1=0, 0, A1/B1)` does not divide by zero. */
  IF: lazy(2, 3, ([condition, whenTrue, whenFalse]): Evaluated => {
    if (boolean(condition?.() ?? null)) return whenTrue?.() ?? null;
    return whenFalse ? whenFalse() : false;
  }),
  /** Tests condition and value pairs in order, with an optional trailing default. */
  IFS: lazy(2, Infinity, (args): Evaluated => {
    const hasDefault = args.length % 2 === 1;
    const pairEnd = hasDefault ? args.length - 1 : args.length;
    for (let index = 0; index < pairEnd; index += 2) {
      if (boolean(args[index]?.() ?? null)) return args[index + 1]?.() ?? null;
    }
    return hasDefault ? (args.at(-1)?.() ?? null) : fail("#N/A", "No condition is true");
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
  /** A check the document makes of itself. The editor lists the ones that fail. */
  ASSERT: eager(1, 2, (condition, message) =>
    boolean(condition ?? null) ? true : fail("#ASSERT!", text(message ?? "Assertion failed")),
  ),
  IFERROR: lazy(2, 2, ([value, fallback]): Evaluated => {
    const result = value?.() ?? null;
    return isError(result) ? (fallback?.() ?? null) : result;
  }),
  /** Like `IFERROR`, but only for `#N/A`. Other errors pass through, so a lookup that finds nothing does not hide a mistake. */
  IFNA: lazy(2, 2, ([value, fallback]): Evaluated => {
    const result = value?.() ?? null;
    return isError(result) && result.code === "#N/A" ? (fallback?.() ?? null) : result;
  }),
  AND: shortCircuit(true),
  OR: shortCircuit(false),
  ALL: combine((values) => values.every(Boolean)),
  ANY: combine((values) => values.some(Boolean)),
  NOT: eager(1, 1, (value) => !boolean(value)),
};
