import {
  error,
  isError,
  isRange,
  isScalar,
  toBoolean,
  toNumber,
  toText,
  type CellValue,
  type ErrorCode,
  type ErrorValue,
  type Evaluated,
  type Scalar,
} from "../values";
import type { Argument, PureFunction } from "./registry";

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

export function boolean(value: Evaluated): boolean {
  return unwrap(toBoolean(scalar(value)));
}

/** The cells of a range as rows. A single value is a grid of one cell. An error argument fails the call. */
export function grid(value: Evaluated): CellValue[][] {
  const given = unwrap(value);
  return isRange(given) ? given.rows : [[given]];
}

/** Defines a function that receives its arguments unevaluated, to evaluate only the ones it needs. */
export function lazy(
  minArgs: number,
  maxArgs: number,
  call: (args: readonly Argument[]) => Evaluated,
): PureFunction {
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
