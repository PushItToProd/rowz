import { isError, toText, type Scalar } from "../values";
import { asScalar, items, scalarFunction } from "./arguments";
import type { FunctionDefinition } from "./registry";

function textFunction(compute: (text: string) => Scalar): FunctionDefinition {
  return scalarFunction(1, 1, ([value = null]) => compute(toText(value)));
}

export const textFunctions: Record<string, FunctionDefinition> = {
  CONCATENATE: {
    kind: "pure",
    minArgs: 1,
    maxArgs: Infinity,
    call(args) {
      let text = "";
      for (const { value } of items(args)) {
        const scalar = asScalar(value);
        if (isError(scalar)) return scalar;
        text += toText(scalar);
      }
      return text;
    },
  },
  LEN: textFunction((text) => text.length),
  UPPER: textFunction((text) => text.toUpperCase()),
  LOWER: textFunction((text) => text.toLowerCase()),
  /** Removes leading and trailing spaces and collapses runs of spaces between words. */
  TRIM: textFunction((text) => text.trim().replace(/ {2,}/g, " ")),
};
