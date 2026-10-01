import type { CellId } from "./address";
import type { Node } from "./ast";
import { DAY_MS, formatDate, isDate, parseDate, type DateValue } from "./dates";
import type { EvaluationContext } from "./evaluate";

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

/**
 * A side effect described as data. Evaluating an action function such as
 * `SEND_EMAIL(...)` produces one of these and does nothing else. The arguments
 * stay unevaluated until the action is planned, so they see the cell values at
 * click time.
 */
export interface ActionValue {
  kind: "action";
  name: string;
  args: Node[];
  /** The cell whose formula contains the action. Unqualified references resolve against its table. */
  origin: CellId;
}

export interface ButtonValue {
  kind: "button";
  label: string;
  action: ActionValue;
}

/**
 * A function made by `LAMBDA`. It keeps the context it was made in, so its
 * body reads cells relative to the cell that defines it and sees the names
 * that were bound there.
 */
export interface LambdaValue {
  kind: "lambda";
  /** Parameter names as written. Lookups ignore letter case. */
  params: string[];
  body: Node;
  context: EvaluationContext;
}

/** `null` is an empty cell. */
export type Scalar = number | string | boolean | DateValue | null;

/**
 * An input the cell shows, such as a checkbox, bound to another cell. It
 * shows that cell's value, and a change made through it is written there.
 */
export interface ControlValue {
  kind: "control";
  control: "checkbox" | "dropdown";
  /** The cell the control reads and writes. */
  target: CellId;
  /** The target cell's value when the control was computed. */
  value: Scalar;
  /** The choices of a dropdown. Empty for a checkbox. */
  options: Scalar[];
  /** Text shown beside a checkbox. */
  label: string;
}

export type CellValue =
  Scalar | ErrorValue | ActionValue | ButtonValue | LambdaValue | ControlValue;

/** Several values as rows of cells: what a range reference reads, or an array a function made. */
export interface RangeValue {
  kind: "range";
  rows: CellValue[][];
}

/**
 * What an expression can evaluate to. A formula whose result is a range puts
 * the first value in its own cell and the rest in the cells around it.
 */
export type Evaluated = CellValue | RangeValue;

export function error(code: ErrorCode, message?: string): ErrorValue {
  return message === undefined ? { kind: "error", code } : { kind: "error", code, message };
}

function hasKind(value: unknown, kind: string): boolean {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === kind;
}

export function isError(value: unknown): value is ErrorValue {
  return hasKind(value, "error");
}

export function isAction(value: unknown): value is ActionValue {
  return hasKind(value, "action");
}

export function isButton(value: unknown): value is ButtonValue {
  return hasKind(value, "button");
}

export function isLambda(value: unknown): value is LambdaValue {
  return hasKind(value, "lambda");
}

export function isControl(value: unknown): value is ControlValue {
  return hasKind(value, "control");
}

export function isRange(value: unknown): value is RangeValue {
  return hasKind(value, "range");
}

export function isScalar(value: Evaluated): value is Scalar {
  return typeof value !== "object" || value === null || isDate(value);
}

export type ScalarKind = "empty" | "number" | "text" | "boolean" | "date";

/** Which kind of value a scalar is. Two values can only be equal when they are of one kind. */
export function kindOf(value: Scalar): ScalarKind {
  if (value === null) return "empty";
  if (isDate(value)) return "date";
  if (typeof value === "string") return "text";
  return typeof value === "number" ? "number" : "boolean";
}

const NUMERIC_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/** Reads text as a number the way a typed cell entry is read. */
export function parseNumber(text: string): number | undefined {
  const trimmed = text.trim();
  if (!NUMERIC_TEXT.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

/** A value as a number. A date is its count of days from the start of 1970, so dates can be subtracted. */
export function toNumber(value: Scalar): number | ErrorValue {
  if (isDate(value)) return value.ms / DAY_MS;
  switch (typeof value) {
    case "number":
      return value;
    case "boolean":
      return value ? 1 : 0;
    case "string":
      return parseNumber(value) ?? error("#VALUE!", `"${value}" is not a number`);
    default:
      return 0;
  }
}

export function toText(value: Scalar): string {
  if (isDate(value)) return formatDate(value);
  switch (typeof value) {
    case "number":
      return formatNumber(value);
    case "boolean":
      return value ? "TRUE" : "FALSE";
    case "string":
      return value;
    default:
      return "";
  }
}

export function toBoolean(value: Scalar): boolean | ErrorValue {
  if (isDate(value)) return error("#VALUE!", "A date is not TRUE or FALSE");
  switch (typeof value) {
    case "boolean":
      return value;
    case "number":
      return value !== 0;
    case "string": {
      const upper = value.trim().toUpperCase();
      if (upper === "TRUE") return true;
      if (upper === "FALSE") return false;
      return error("#VALUE!", `"${value}" is not TRUE or FALSE`);
    }
    default:
      return false;
  }
}

// 15 significant digits hides binary floating point noise such as
// 0.1 + 0.2 = 0.30000000000000004.
const DISPLAY_PRECISION = 15;

export function formatNumber(value: number): string {
  return String(Number(value.toPrecision(DISPLAY_PRECISION)));
}

/** The text a cell shows for a value. Buttons show their label. */
export function formatValue(value: CellValue): string {
  if (isError(value)) return value.code;
  if (isAction(value)) return value.name;
  if (isButton(value)) return value.label;
  if (isLambda(value)) return `LAMBDA(${value.params.join(", ")})`;
  if (isControl(value)) return value.control === "checkbox" ? value.label : toText(value.value);
  return toText(value);
}

const FORMULA_PREFIX = "=";
const TEXT_PREFIX = "'";

export function isFormulaInput(input: string): boolean {
  return input.startsWith(FORMULA_PREFIX) && input.length > 1;
}

/**
 * Interprets what a user typed into a cell that is not a formula. A leading
 * apostrophe forces the rest to be text.
 */
export function parseLiteralInput(input: string): Scalar {
  if (input === "") return null;
  if (input.startsWith(TEXT_PREFIX)) return input.slice(1);
  const number = parseNumber(input);
  if (number !== undefined) return number;
  const upper = input.trim().toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  return parseDate(input) ?? input;
}

/**
 * The cell input that stores `value` as a literal. Text that would otherwise
 * be read back as a number, boolean, or formula gets the apostrophe prefix.
 */
export function literalInput(value: Scalar): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (isDate(value)) return formatDate(value);
  const readsBackAsText = !isFormulaInput(value) && parseLiteralInput(value) === value;
  return readsBackAsText ? value : TEXT_PREFIX + value;
}

// Values of different kinds order as number < date < text < boolean.
const KIND_RANK: Record<ScalarKind, number> = { empty: 0, number: 0, date: 1, text: 2, boolean: 3 };

/** An empty cell compares as the empty value of the other side's kind. */
function fillEmpty(value: Scalar, other: Scalar): Exclude<Scalar, null> {
  if (value !== null) return value;
  if (typeof other === "string") return "";
  if (typeof other === "boolean") return false;
  return 0;
}

/**
 * Orders two values the way the comparison operators do: negative when the
 * left is smaller, zero when they are equal. Text is compared without regard
 * to letter case.
 */
export function compare(leftValue: Scalar, rightValue: Scalar): number {
  const left = fillEmpty(leftValue, rightValue);
  const right = fillEmpty(rightValue, leftValue);
  if (typeof left === "number" && typeof right === "number") return left - right;
  if (isDate(left) && isDate(right)) return left.ms - right.ms;
  if (typeof left === "string" && typeof right === "string") {
    // Text comparison ignores case.
    const [a, b] = [left.toLowerCase(), right.toLowerCase()];
    return a < b ? -1 : Number(a > b);
  }
  if (typeof left === "boolean" && typeof right === "boolean") return Number(left) - Number(right);
  return KIND_RANK[kindOf(left)] - KIND_RANK[kindOf(right)];
}
