/** `#ERROR!` means the formula text could not be parsed, or a function got the wrong number of arguments. */
export const ERROR_CODES = [
  "#DIV/0!",
  "#VALUE!",
  "#REF!",
  "#NAME?",
  "#N/A",
  "#SPILL!",
  "#CYCLE!",
  "#ERROR!",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ErrorValue {
  kind: "error";
  code: ErrorCode;
  message?: string;
}

export function error(code: ErrorCode, message?: string): ErrorValue {
  return message === undefined ? { kind: "error", code } : { kind: "error", code, message };
}

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

/** A number a cell can hold. Arithmetic on very large numbers gives infinity, which no cell shows. */
export function finite(value: number): number {
  return Number.isFinite(value) ? value : fail("#VALUE!", "The result is not a number");
}
