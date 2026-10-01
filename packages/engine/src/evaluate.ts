import type { CellId, CellRange } from "./address";
import type { BinaryOperator, Node, Reference } from "./ast";
import { Failure } from "./functions/arguments";
import type { FunctionRegistry } from "./functions/registry";
import {
  compare,
  error,
  isError,
  isScalar,
  toNumber,
  toText,
  type CellValue,
  type ErrorValue,
  type Evaluated,
  type Scalar,
} from "./values";

export interface EvaluationContext {
  /** The cell whose formula is being evaluated. */
  origin: CellId;
  functions: FunctionRegistry;
  /** Finds the cells a reference points at, or `undefined` if its table does not exist. */
  resolve(reference: Reference): CellRange | undefined;
  read(cell: CellId): CellValue;
  /** The size of a table, which is where a range with an open side stops. */
  extent(tableId: string): { rows: number; cols: number };
}

function arity(name: string, min: number, max: number): string {
  const count = (n: number): string => `${String(n)} argument${n === 1 ? "" : "s"}`;
  if (max === Infinity) return `${name} takes at least ${count(min)}`;
  if (min === max) return `${name} takes ${count(min)}`;
  return `${name} takes ${String(min)} to ${count(max)}`;
}

function arithmetic(
  operator: "+" | "-" | "*" | "/" | "^",
  left: Scalar,
  right: Scalar,
): Scalar | ErrorValue {
  const a = toNumber(left);
  if (isError(a)) return a;
  const b = toNumber(right);
  if (isError(b)) return b;
  if (operator === "/" && b === 0) return error("#DIV/0!", "Division by zero");
  const result = {
    "+": a + b,
    "-": a - b,
    "*": a * b,
    "/": a / b,
    "^": a ** b,
  }[operator];
  return Number.isFinite(result) ? result : error("#VALUE!", "The result is not a number");
}

function binary(operator: BinaryOperator, left: Scalar, right: Scalar): Scalar | ErrorValue {
  switch (operator) {
    case "&":
      return toText(left) + toText(right);
    case "=":
      return compare(left, right) === 0;
    case "<>":
      return compare(left, right) !== 0;
    case "<":
      return compare(left, right) < 0;
    case ">":
      return compare(left, right) > 0;
    case "<=":
      return compare(left, right) <= 0;
    case ">=":
      return compare(left, right) >= 0;
    default:
      return arithmetic(operator, left, right);
  }
}

function readReference(reference: Reference, context: EvaluationContext): Evaluated {
  const range = context.resolve(reference);
  if (!range) return error("#REF!", "The referenced table does not exist");
  const { tableId, startRow, startCol } = range;
  if (!reference.end) return context.read({ tableId, row: startRow, col: startCol });

  const extent = context.extent(tableId);
  const endRow = Math.min(range.endRow, extent.rows - 1);
  const endCol = Math.min(range.endCol, extent.cols - 1);
  const rows: CellValue[][] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    const cells: CellValue[] = [];
    for (let col = startCol; col <= endCol; col += 1)
      cells.push(context.read({ tableId, row, col }));
    rows.push(cells);
  }
  return { kind: "range", rows };
}

function call(name: string, args: Node[], context: EvaluationContext): Evaluated {
  const definition = context.functions.get(name);
  if (!definition) return error("#NAME?", `Unknown function ${name}`);
  if (args.length < definition.minArgs || args.length > definition.maxArgs) {
    return error("#ERROR!", arity(name, definition.minArgs, definition.maxArgs));
  }
  if (definition.kind === "action") return { kind: "action", name, args, origin: context.origin };
  try {
    return definition.call(args.map((arg) => () => evaluate(arg, context)));
  } catch (cause) {
    // A function reports a bad argument by throwing. Anything else is a bug and keeps propagating.
    if (cause instanceof Failure) return cause.error;
    throw cause;
  }
}

/** Narrows an operand to a single value. Ranges, actions, and buttons are `#VALUE!`. */
function asScalar(value: Evaluated): Scalar | ErrorValue {
  if (isScalar(value) || isError(value)) return value;
  return error("#VALUE!", "Expected a single value");
}

/** Evaluates an AST. Reads cell values through `context` and has no side effects. */
export function evaluate(node: Node, context: EvaluationContext): Evaluated {
  switch (node.type) {
    case "number":
    case "string":
    case "boolean":
      return node.value;
    case "error":
      return error(node.code);
    case "reference":
      return readReference(node.reference, context);
    case "call":
      return call(node.name, node.args, context);
    case "unary": {
      const operand = asScalar(evaluate(node.operand, context));
      if (isError(operand)) return operand;
      const number = toNumber(operand);
      if (isError(number)) return number;
      return node.operator === "-" ? -number : number;
    }
    case "binary": {
      const left = asScalar(evaluate(node.left, context));
      if (isError(left)) return left;
      const right = asScalar(evaluate(node.right, context));
      if (isError(right)) return right;
      return binary(node.operator, left, right);
    }
  }
}

/**
 * Lists the references a formula reads during recalculation. Arguments of
 * action functions are left out: they are evaluated when the action runs, so
 * a cell holding `=BUTTON("Add", EXECUTE(A1+1, A1))` does not depend on A1.
 */
export function referencesOf(node: Node, functions: FunctionRegistry): Reference[] {
  switch (node.type) {
    case "reference":
      return [node.reference];
    case "unary":
      return referencesOf(node.operand, functions);
    case "binary":
      return [...referencesOf(node.left, functions), ...referencesOf(node.right, functions)];
    case "call":
      if (functions.get(node.name)?.kind === "action") return [];
      return node.args.flatMap((arg) => referencesOf(arg, functions));
    default:
      return [];
  }
}
