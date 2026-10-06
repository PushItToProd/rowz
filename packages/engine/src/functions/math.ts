import { dateFromMs, isDate } from "../dates";
import { compare, isRange, type CellValue, type Evaluated } from "../values";
import {
  array,
  eager,
  element,
  fail,
  grid,
  integer,
  items,
  limitCells,
  number,
  numbers,
  scalar,
} from "./arguments";
import type { FunctionDefinition } from "./registry";
import { compensatedSum } from "./sum";

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
  return compensatedSum(values);
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

/** A whole number that is not negative, for functions defined only on those. */
function natural(value: Evaluated, name: string): number {
  const whole = integer(value);
  return whole < 0 ? fail("#VALUE!", `${name} needs numbers that are not negative`) : whole;
}

function cellAt(rows: readonly CellValue[][], row: number, col: number): CellValue {
  const cells = rows.length === 1 ? rows[0] : rows[row];
  const cell = cells?.length === 1 ? cells[0] : cells?.[col];
  if (cell === undefined) return fail("#N/A", "The arrays are not the same size");
  return cell;
}

/** Clamps values with the comparison and cellwise array pairing used by operators. */
function clampArray(value: Evaluated, minimum: Evaluated, maximum: Evaluated): Evaluated {
  const grids = [grid(value), grid(minimum), grid(maximum)] as const;
  if (grids.some((rows) => rows.length === 0)) return array([]);
  const height = Math.max(...grids.map((rows) => rows.length));
  const width = Math.max(...grids.map((rows) => rows[0]?.length ?? 0));
  limitCells(height * width);

  return array(
    Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, col) =>
        element(() => {
          const valueCell = cellAt(grids[0], row, col);
          const minimumCell = cellAt(grids[1], row, col);
          const maximumCell = cellAt(grids[2], row, col);
          const valueScalar = scalar(valueCell);
          const minimumScalar = scalar(minimumCell);
          const maximumScalar = scalar(maximumCell);
          if (compare(valueScalar, minimumScalar) < 0) return minimumCell;
          return compare(valueScalar, maximumScalar) > 0 ? maximumCell : valueCell;
        }),
      ),
    ),
  );
}

/** Returns the selected input unchanged after comparing all three arguments. */
function clamp(value: Evaluated, minimum: Evaluated, maximum: Evaluated): Evaluated {
  if (isRange(value) || isRange(minimum) || isRange(maximum)) {
    return clampArray(value, minimum, maximum);
  }

  const valueScalar = scalar(value);
  const minimumScalar = scalar(minimum);
  const maximumScalar = scalar(maximum);
  if (compare(valueScalar, minimumScalar) < 0) return minimum;
  return compare(valueScalar, maximumScalar) > 0 ? maximum : value;
}

/**
 * The largest number whose factorial a number can hold. The limit also bounds
 * the loop: counting down from a number too large to hold every whole number
 * would never reach 1.
 */
const MAX_FACTORIAL = 170;

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Rounds away from zero to the next even number, or with `odd` the next odd one. */
function toParity(value: number, odd: boolean): number {
  const up = Math.ceil(Math.abs(value));
  const matches = (up % 2 === 1) === odd;
  return (Math.sign(value) || 1) * (matches ? up : up + 1);
}

function logarithm(value: Evaluated, base: number): number {
  const given = number(value);
  if (given <= 0) fail("#VALUE!", "A logarithm needs a number above 0");
  if (base <= 0 || base === 1) fail("#VALUE!", "The base must be above 0 and not 1");
  // The dedicated functions are exact where the ratio of two logarithms is not: log10(1000) is 3.
  if (base === 10) return Math.log10(given);
  if (base === 2) return Math.log2(given);
  return base === Math.E ? Math.log(given) : Math.log(given) / Math.log(base);
}

/** A function of one number, such as a trigonometric function of an angle in radians. */
function angle(compute: (value: number) => number): FunctionDefinition {
  return eager(1, 1, (value) => compute(number(value)));
}

/** An inverse trigonometric function, which is defined only from -1 to 1. */
function unit(name: string, compute: (value: number) => number): FunctionDefinition {
  return eager(1, 1, (value) => {
    const given = number(value);
    return given < -1 || given > 1
      ? fail("#VALUE!", `${name} needs a number from -1 to 1`)
      : compute(given);
  });
}

export const mathFunctions: Record<string, FunctionDefinition> = {
  /** Multiplies ranges of one size cell by cell and adds the products. A cell that is not a number counts as 0. */
  SUMPRODUCT: eager(1, Infinity, (...ranges) => {
    const grids = ranges.map((range) => grid(range).flat());
    const [first = []] = grids;
    if (grids.some((cells) => cells.length !== first.length)) {
      fail("#VALUE!", "The ranges must all be the same size");
    }
    return compensatedSum(
      first.map((_, index) =>
        grids.reduce((product, cells) => {
          const cell = cells[index];
          return product * (typeof cell === "number" ? cell : 0);
        }, 1),
      ),
    );
  }),
  TRUNC: atPlaces(Math.trunc),
  SIGN: eager(1, 1, (value) => Math.sign(number(value))),
  /** Rounds to the nearest multiple. */
  MROUND: eager(2, 2, (value, multiple) => {
    const step = number(multiple);
    return step === 0 ? 0 : halfAwayFromZero(number(value) / step) * step;
  }),
  /** The whole-number part of a division. */
  QUOTIENT: eager(2, 2, (dividend, divisor) => {
    const by = number(divisor);
    return by === 0 ? fail("#DIV/0!") : Math.trunc(number(dividend) / by);
  }),
  EXP: eager(1, 1, (value) => Math.exp(number(value))),
  LN: eager(1, 1, (value) => logarithm(value, Math.E)),
  LOG: eager(1, 2, (value, base = 10) => logarithm(value, number(base))),
  PI: eager(0, 0, () => Math.PI),
  SIN: angle(Math.sin),
  COS: angle(Math.cos),
  TAN: angle(Math.tan),
  ASIN: unit("ASIN", Math.asin),
  ACOS: unit("ACOS", Math.acos),
  ATAN: angle(Math.atan),
  SINH: angle(Math.sinh),
  COSH: angle(Math.cosh),
  TANH: angle(Math.tanh),
  /** Turns an angle in radians into degrees. */
  DEGREES: angle((radians) => (radians * 180) / Math.PI),
  /** Turns an angle in degrees into radians. */
  RADIANS: angle((degrees) => (degrees * Math.PI) / 180),
  EVEN: eager(1, 1, (value) => toParity(number(value), false)),
  ODD: eager(1, 1, (value) => toParity(number(value), true)),
  ISEVEN: eager(1, 1, (value) => integer(value) % 2 === 0),
  ISODD: eager(1, 1, (value) => integer(value) % 2 !== 0),
  /** The largest whole number that divides every value. */
  GCD: eager(1, Infinity, (...values) =>
    numbers(values)
      .map((value) => natural(value, "GCD"))
      .reduce(gcd, 0),
  ),
  /** The smallest whole number that every value divides. */
  LCM: eager(1, Infinity, (...values) =>
    numbers(values)
      .map((value) => natural(value, "LCM"))
      .reduce(
        (multiple, value) => (value === 0 ? 0 : (multiple / gcd(multiple, value)) * value),
        1,
      ),
  ),
  /** The product of the whole numbers from 1 to the value. */
  FACT: eager(1, 1, (value) => {
    const count = natural(value, "FACT");
    if (count > MAX_FACTORIAL) {
      fail("#VALUE!", `FACT needs a number up to ${String(MAX_FACTORIAL)}`);
    }
    let product = 1;
    for (let factor = count; factor > 1; factor -= 1) product *= factor;
    return product;
  }),

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
  CLAMP: eager(3, 3, clamp),
  ROUNDUP: atPlaces(awayFromZero),
  ROUNDDOWN: atPlaces(Math.trunc),
  FLOOR: toMultiple(Math.floor),
  CEILING: toMultiple(Math.ceil),
  INT: eager(1, 1, (value) => Math.floor(number(value))),
  ABS: eager(1, 1, (value) => Math.abs(number(value))),
  SQRT: eager(1, 1, (value) => Math.sqrt(number(value))),
  POWER: eager(2, 2, (base, exponent) => number(base) ** number(exponent)),
  /** The remainder, with the sign of the divisor: `MOD(-1, 3)` is 2. */
  MOD: eager(2, 2, (value, divisor) => {
    const by = number(divisor);
    if (by === 0) fail("#DIV/0!", "Division by zero");
    const dividend = number(value);
    return dividend - by * Math.floor(dividend / by);
  }),
};
