import { error, isError, toNumber, type Evaluated } from "../values";
import { items, numbers, scalarFunction } from "./arguments";
import type { Argument, FunctionDefinition, PureFunction } from "./registry";

function aggregate(compute: (values: readonly number[]) => Evaluated): PureFunction {
  return {
    kind: "pure",
    minArgs: 1,
    maxArgs: Infinity,
    call(args: readonly Argument[]) {
      const values = numbers(args);
      return isError(values) ? values : compute(values);
    },
  };
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Rounds half away from zero, as spreadsheets do. `Math.round` rounds half toward positive infinity. */
function round(value: number, digits: number): number {
  const factor = 10 ** Math.trunc(digits);
  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

export const mathFunctions: Record<string, FunctionDefinition> = {
  SUM: aggregate(sum),
  AVERAGE: aggregate((values) =>
    values.length === 0 ? error("#DIV/0!", "No numbers to average") : sum(values) / values.length,
  ),
  MIN: aggregate((values) => (values.length === 0 ? 0 : Math.min(...values))),
  MAX: aggregate((values) => (values.length === 0 ? 0 : Math.max(...values))),

  /** Counts numbers. Unlike the other aggregates it skips errors. */
  COUNT: {
    kind: "pure",
    minArgs: 1,
    maxArgs: Infinity,
    call: (args) => items(args).filter(({ value }) => typeof value === "number").length,
  },
  /** Counts cells that are not empty, including errors. */
  COUNTA: {
    kind: "pure",
    minArgs: 1,
    maxArgs: Infinity,
    call: (args) => items(args).filter(({ value }) => value !== null && value !== "").length,
  },

  ROUND: scalarFunction(1, 2, ([value = null, digits = 0]) => {
    const number = toNumber(value);
    if (isError(number)) return number;
    const places = toNumber(digits);
    if (isError(places)) return places;
    return round(number, places);
  }),
  ABS: scalarFunction(1, 1, ([value = null]) => {
    const number = toNumber(value);
    return isError(number) ? number : Math.abs(number);
  }),
};
