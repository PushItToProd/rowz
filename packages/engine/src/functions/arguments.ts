import {
  error,
  isError,
  isRange,
  isScalar,
  toBoolean,
  toNumber,
  type CellValue,
  type ErrorValue,
  type Evaluated,
  type Scalar,
} from "../values";
import type { Argument, PureFunction } from "./registry";

/** Narrows an evaluated argument to a scalar. Ranges, actions, and buttons are `#VALUE!`. */
export function asScalar(value: Evaluated): Scalar | ErrorValue {
  if (isScalar(value) || isError(value)) return value;
  return error("#VALUE!", "Expected a single value");
}

/** Defines a function whose arguments are all single values. An error in any argument is returned as the result. */
export function scalarFunction(
  minArgs: number,
  maxArgs: number,
  compute: (values: readonly Scalar[]) => Evaluated,
): PureFunction {
  return {
    kind: "pure",
    minArgs,
    maxArgs,
    call(args) {
      const values: Scalar[] = [];
      for (const arg of args) {
        const value = asScalar(arg());
        if (isError(value)) return value;
        values.push(value);
      }
      return compute(values);
    },
  };
}

interface Item {
  value: CellValue;
  /** Whether the value came from a cell inside a range argument. */
  fromRange: boolean;
}

/** Evaluates all arguments and lists their values, expanding ranges cell by cell. */
export function items(args: readonly Argument[]): Item[] {
  return args.flatMap((arg): Item[] => {
    const value = arg();
    if (!isRange(value)) return [{ value, fromRange: false }];
    return value.rows.flat().map((cell) => ({ value: cell, fromRange: true }));
  });
}

/**
 * Collects values for an aggregate such as `SUM` or `AND`. A value given
 * directly is converted with `convert`, so `SUM("3", TRUE)` is 4. Inside a
 * range only values already of type `type` count, and the rest are skipped,
 * which lets a range cover header text and blanks.
 */
function collect<T extends number | boolean>(
  args: readonly Argument[],
  type: "number" | "boolean",
  convert: (value: Scalar) => T | ErrorValue,
): T[] | ErrorValue {
  const collected: T[] = [];
  for (const { value, fromRange } of items(args)) {
    if (isError(value)) return value;
    if (fromRange) {
      if (typeof value === type) collected.push(value as T);
      continue;
    }
    const scalar = asScalar(value);
    if (isError(scalar)) return scalar;
    if (scalar === null) continue;
    const converted = convert(scalar);
    if (isError(converted)) return converted;
    collected.push(converted);
  }
  return collected;
}

export function numbers(args: readonly Argument[]): number[] | ErrorValue {
  return collect(args, "number", toNumber);
}

export function booleans(args: readonly Argument[]): boolean[] | ErrorValue {
  return collect(args, "boolean", toBoolean);
}
