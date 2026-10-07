import type { CellId } from "./address";

/** `#ASSERT!` is the failure of an `ASSERT` the user wrote. `#ERROR!` means the formula text could not be parsed, or a function got the wrong number of arguments. */
export const ERROR_CODES = [
  "#DIV/0!",
  "#VALUE!",
  "#NUM!",
  "#REF!",
  "#NAME?",
  "#N/A",
  "#SPILL!",
  "#CYCLE!",
  "#ASSERT!",
  "#ERROR!",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** A spill the table can resolve by growing to include the formula's result. */
export interface SpillErrorDetails {
  /** Table whose array result is too large for its current dimensions. */
  tableId: string;
  reason: "table-size";
  /** Full table dimensions needed to fit the result at its anchor. */
  requiredRowCount: number;
  requiredColumnCount: number;
}

/** A function definition in a script. */
export interface ScriptFunctionLocation {
  scriptId: string;
  scriptName: string;
  line: number;
  name: string;
}

/** A caller location, or a count of caller locations omitted from the bounded trace. */
export type ErrorTraceCallSite =
  | { kind: "cell"; cell: CellId; tableName?: string; parent?: ErrorTraceCallSite }
  | {
      kind: "script";
      scriptId: string;
      scriptName: string;
      line: number;
      name?: string;
      parent?: ErrorTraceCallSite;
    }
  | { kind: "page"; pageId: string; pageName?: string; parent?: ErrorTraceCallSite }
  | { kind: "more"; count: number };

/** Where an error first arose in a script function and how evaluation reached it. */
export interface ErrorTraceFrame {
  function: string;
  location: ScriptFunctionLocation;
  /** The nearest callers, followed by a count when older caller locations are omitted. */
  callSite?: ErrorTraceCallSite;
}

export interface ErrorValue {
  kind: "error";
  code: ErrorCode;
  message?: string;
  /** Present only when a spill cannot fit within the current table dimensions. */
  spill?: SpillErrorDetails;
  /** The script function where an error first arose, with its call site chain. */
  trace?: ErrorTraceFrame[];
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
