import { dateFromMs, isDate } from "../dates";
import type { Evaluated } from "../values";
import { eager, fail, integer, items, number, numbers } from "./arguments";
import type { FunctionDefinition } from "./registry";

function aggregate(compute: (values: readonly number[]) => Evaluated): FunctionDefinition {
  return eager(1, Infinity, (...values) => compute(numbers(values)));
}

/**
 * `MIN` or `MAX`. Over numbers the result is a number, and over dates it is a
 * date. Numbers and dates together have no common scale to compare on.
 */
function extreme(name: string, pick: (...values: number[]) => number): FunctionDefinition {
  return eager(1, Infinity, (...values) => {
    const dates = items(values).flatMap(({ value }) => (isDate(value) ? [value.ms] : []));
    // A date given directly would otherwise be counted as its number of days.
    const found = numbers(values.filter((value) => !isDate(value)));
    if (dates.length === 0) return found.length === 0 ? 0 : pick(...found);
    if (found.length > 0) fail("#VALUE!", `${name} cannot compare dates with numbers`);
    return dateFromMs(pick(...dates));
  });
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function median(values: readonly number[]): number {
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const [below = 0, above = 0] = [sorted[middle - 1], sorted[middle]];
  return sorted.length % 2 === 1 ? above : (below + above) / 2;
}

type Rounding = (value: number) => number;

/** Rounds half away from zero, as spreadsheets do. `Math.round` rounds half toward positive infinity. */
const halfAwayFromZero: Rounding = (value) => Math.sign(value) * Math.round(Math.abs(value));
const awayFromZero: Rounding = (value) => Math.sign(value) * Math.ceil(Math.abs(value));

/** Applies a rounding at a number of decimal places. Negative places round to tens, hundreds, and so on. */
function atPlaces(rounding: Rounding): FunctionDefinition {
  return eager(1, 2, (value, places = 0) => {
    const factor = 10 ** integer(places);
    return rounding(number(value) * factor) / factor;
  });
}

/** Rounds to a multiple of `significance`, which defaults to 1. */
function toMultiple(rounding: Rounding): FunctionDefinition {
  return eager(1, 2, (value, significance = 1) => {
    const step = number(significance);
    return step === 0 ? 0 : rounding(number(value) / step) * step;
  });
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : fail("#VALUE!", "The result is not a number");
}

export const mathFunctions: Record<string, FunctionDefinition> = {
  SUM: aggregate(sum),
  AVERAGE: aggregate((values) =>
    values.length === 0 ? fail("#DIV/0!", "No numbers to average") : sum(values) / values.length,
  ),
  MIN: extreme("MIN", Math.min),
  MAX: extreme("MAX", Math.max),
  PRODUCT: aggregate((values) => values.reduce((product, value) => product * value, 1)),
  MEDIAN: aggregate((values) =>
    values.length === 0 ? fail("#VALUE!", "No numbers to take the median of") : median(values),
  ),

  /** Counts numbers. Unlike the other aggregates it skips errors. */
  COUNT: eager(
    1,
    Infinity,
    (...values) => items(values).filter(({ value }) => typeof value === "number").length,
  ),
  /** Counts cells that are not empty, including errors. */
  COUNTA: eager(
    1,
    Infinity,
    (...values) => items(values).filter(({ value }) => value !== null && value !== "").length,
  ),

  ROUND: atPlaces(halfAwayFromZero),
  ROUNDUP: atPlaces(awayFromZero),
  ROUNDDOWN: atPlaces(Math.trunc),
  FLOOR: toMultiple(Math.floor),
  CEILING: toMultiple(Math.ceil),
  INT: eager(1, 1, (value) => Math.floor(number(value))),
  ABS: eager(1, 1, (value) => Math.abs(number(value))),
  SQRT: eager(1, 1, (value) => finite(Math.sqrt(number(value)))),
  POWER: eager(2, 2, (base, exponent) => finite(number(base) ** number(exponent))),
  /** The remainder, with the sign of the divisor: `MOD(-1, 3)` is 2. */
  MOD: eager(2, 2, (value, divisor) => {
    const by = number(divisor);
    if (by === 0) fail("#DIV/0!", "Division by zero");
    const dividend = number(value);
    return dividend - by * Math.floor(dividend / by);
  }),
};
