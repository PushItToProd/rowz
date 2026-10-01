import {
  error,
  isError,
  isLambda,
  isRange,
  isScalar,
  toBoolean,
  toNumber,
  toText,
  type CellValue,
  type ErrorCode,
  type ErrorValue,
  type Evaluated,
  type LambdaValue,
  type RangeValue,
  type Scalar,
} from "../values";
import { isDate, parseDate, type DateValue } from "../dates";
import type { PureFunction } from "./registry";

/**
 * Thrown inside a function to make the call evaluate to an error. The
 * evaluator catches it where it calls the function, so function bodies can
 * convert arguments without checking each result.
 */
export class Failure extends Error {
  constructor(readonly error: ErrorValue) {
    super(error.message ?? error.code);
    this.name = "Failure";
  }
}

export function fail(code: ErrorCode, message?: string): never {
  throw new Failure(error(code, message));
}

function unwrap<T>(value: T | ErrorValue): T {
  if (isError(value)) throw new Failure(value);
  return value;
}

/** A single value. An error argument fails the call, and so does a range, action, or button. */
export function scalar(value: Evaluated): Scalar {
  const single = unwrap(value);
  return isScalar(single) ? single : fail("#VALUE!", "Expected a single value");
}

export function number(value: Evaluated): number {
  return unwrap(toNumber(scalar(value)));
}

/** A whole number. A fraction is cut off toward zero, as spreadsheets do for counts and positions. */
export function integer(value: Evaluated): number {
  return Math.trunc(number(value));
}

export function text(value: Evaluated): string {
  return toText(scalar(value));
}

/** A date. Text written as a date is read as one. */
export function dateOf(value: Evaluated): DateValue {
  const given = scalar(value);
  if (isDate(given)) return given;
  const read = typeof given === "string" ? parseDate(given) : undefined;
  return read ?? fail("#VALUE!", `${toText(given) || "An empty cell"} is not a date`);
}

export function boolean(value: Evaluated): boolean {
  return unwrap(toBoolean(scalar(value)));
}

/** The cells of a range as rows. A single value is a grid of one cell. An error argument fails the call. */
export function grid(value: Evaluated): CellValue[][] {
  const given = unwrap(value);
  return isRange(given) ? given.rows : [[given]];
}

/** Makes an array result from rows of cells. */
export function array(rows: CellValue[][]): RangeValue {
  return { kind: "range", rows };
}

/** A function made by `LAMBDA`, which functions such as `MAP` take as an argument. */
export function lambda(value: Evaluated): LambdaValue {
  const given = unwrap(value);
  return isLambda(given) ? given : fail("#VALUE!", "Expected a function made with LAMBDA");
}

/** A value fit to be one cell of an array. A failure becomes that cell's error, and a nested array its first value. */
export function element(compute: () => Evaluated): CellValue {
  try {
    const value = compute();
    return isRange(value) ? (value.rows[0]?.[0] ?? null) : value;
  } catch (cause) {
    if (cause instanceof Failure) return cause.error;
    throw cause;
  }
}

/** Defines a function that receives its arguments unevaluated, to evaluate only the ones it needs. */
export function lazy(minArgs: number, maxArgs: number, call: PureFunction["call"]): PureFunction {
  return { kind: "pure", minArgs, maxArgs, call };
}

/**
 * Defines a function that receives every argument evaluated. Arguments left
 * out are `undefined`, so `compute` can give them default values.
 */
export function eager(
  minArgs: number,
  maxArgs: number,
  compute: (...values: Evaluated[]) => Evaluated,
): PureFunction {
  return lazy(minArgs, maxArgs, (args) => compute(...args.map((arg) => arg())));
}

interface Item {
  value: CellValue;
  /** Whether the value came from a cell inside a range argument. */
  fromRange: boolean;
}

/** Lists the values of evaluated arguments, expanding ranges cell by cell. */
export function items(values: readonly Evaluated[]): Item[] {
  return values.flatMap((value): Item[] => {
    if (!isRange(value)) return [{ value, fromRange: false }];
    return value.rows.flat().map((cell) => ({ value: cell, fromRange: true }));
  });
}

/**
 * Collects values for an aggregate such as `SUM` or `AND`. A value given
 * directly is converted with `convert`, so `SUM("3", TRUE)` is 4. Inside a
 * range only values already of type `type` count, and the rest are skipped,
 * which lets a range cover header text and blanks. An error anywhere fails
 * the call.
 */
function collect<T extends number | boolean>(
  values: readonly Evaluated[],
  type: "number" | "boolean",
  convert: (value: Evaluated) => T,
): T[] {
  const collected: T[] = [];
  for (const { value, fromRange } of items(values)) {
    if (fromRange) {
      if (typeof unwrap(value) === type) collected.push(value as T);
    } else if (scalar(value) !== null) {
      collected.push(convert(value));
    }
  }
  return collected;
}

export function numbers(values: readonly Evaluated[]): number[] {
  return collect(values, "number", number);
}

export function booleans(values: readonly Evaluated[]): boolean[] {
  return collect(values, "boolean", boolean);
}
