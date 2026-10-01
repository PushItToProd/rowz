import { isError, toBoolean, type Evaluated } from "../values";
import { asScalar, booleans, scalarFunction } from "./arguments";
import type { Argument, FunctionDefinition, PureFunction } from "./registry";

function combine(compute: (values: readonly boolean[]) => boolean): PureFunction {
  return {
    kind: "pure",
    minArgs: 1,
    maxArgs: Infinity,
    call(args: readonly Argument[]) {
      const values = booleans(args);
      return isError(values) ? values : compute(values);
    },
  };
}

export const logicFunctions: Record<string, FunctionDefinition> = {
  /** Evaluates only the branch it returns, so `IF(B1=0, 0, A1/B1)` does not divide by zero. */
  IF: {
    kind: "pure",
    minArgs: 2,
    maxArgs: 3,
    call([condition, whenTrue, whenFalse]): Evaluated {
      const scalar = asScalar(condition?.() ?? null);
      if (isError(scalar)) return scalar;
      const test = toBoolean(scalar);
      if (isError(test)) return test;
      if (test) return whenTrue?.() ?? null;
      return whenFalse ? whenFalse() : false;
    },
  },
  IFERROR: {
    kind: "pure",
    minArgs: 2,
    maxArgs: 2,
    call([value, fallback]): Evaluated {
      const result = value?.() ?? null;
      return isError(result) ? (fallback?.() ?? null) : result;
    },
  },
  AND: combine((values) => values.every(Boolean)),
  OR: combine((values) => values.some(Boolean)),
  NOT: scalarFunction(1, 1, ([value = null]) => {
    const boolean = toBoolean(value);
    return isError(boolean) ? boolean : !boolean;
  }),
};
