import type { CellId, CellRange } from "./address";
import type { BinaryOperator, Node, Reference } from "./ast";
import { DAY_MS, dateFromMs, isDate } from "./dates";
import { array, element, fail, Failure, number, scalar } from "./functions/arguments";
import type { FunctionRegistry } from "./functions/registry";
import {
  compare,
  error,
  isError,
  isLambda,
  isRange,
  toText,
  type CellValue,
  type Evaluated,
  type LambdaValue,
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
  /** Values bound by `LET` and `LAMBDA`, keyed by name in lower case. */
  names?: ReadonlyMap<string, Evaluated>;
  /** How many function calls deep the evaluation is. */
  depth?: number;
  /** The current date and time on the user's clock, in the milliseconds a `DateValue` holds. */
  now?: () => number;
}

// Deep enough for real formulas, and far short of overflowing the call stack.
const MAX_CALL_DEPTH = 200;

function arity(name: string, min: number, max: number): string {
  const count = (n: number): string => `${String(n)} argument${n === 1 ? "" : "s"}`;
  if (max === Infinity) return `${name} takes at least ${count(min)}`;
  if (min === max) return `${name} takes ${count(min)}`;
  return `${name} takes ${String(min)} to ${count(max)}`;
}

/**
 * Arithmetic that involves a date. A number added to or taken from a date is
 * a count of days and gives a date. One date taken from another gives the
 * days between them. Anything else treats a date as its day count.
 */
function dateArithmetic(operator: string, left: Scalar, right: Scalar): Scalar | undefined {
  if (operator !== "+" && operator !== "-") return undefined;
  const sign = operator === "+" ? 1 : -1;
  if (isDate(left) && isDate(right)) {
    return operator === "-"
      ? (left.ms - right.ms) / DAY_MS
      : fail("#VALUE!", "Two dates cannot be added");
  }
  if (isDate(left)) return dateFromMs(left.ms + sign * number(right) * DAY_MS);
  if (isDate(right) && operator === "+") return dateFromMs(right.ms + number(left) * DAY_MS);
  return undefined;
}

function arithmetic(operator: "+" | "-" | "*" | "/" | "^", left: Scalar, right: Scalar): Scalar {
  const withDate = dateArithmetic(operator, left, right);
  if (withDate !== undefined) return withDate;
  const a = number(left);
  const b = number(right);
  if (operator === "/" && b === 0) fail("#DIV/0!", "Division by zero");
  const result = { "+": a + b, "-": a - b, "*": a * b, "/": a / b, "^": a ** b }[operator];
  return Number.isFinite(result) ? result : fail("#VALUE!", "The result is not a number");
}

function binary(operator: BinaryOperator, left: Scalar, right: Scalar): Scalar {
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
  if (!range) fail("#REF!", "The referenced table does not exist");
  const { tableId, startRow, startCol } = range;
  if (!reference.end) return context.read({ tableId, row: startRow, col: startCol });

  const extent = context.extent(tableId);
  const endRow = Math.min(range.endRow, extent.rows - 1);
  const endCol = Math.min(range.endCol, extent.cols - 1);
  const rows: CellValue[][] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    const cells: CellValue[] = [];
    for (let col = startCol; col <= endCol; col += 1) {
      cells.push(context.read({ tableId, row, col }));
    }
    rows.push(cells);
  }
  return { kind: "range", rows };
}

/**
 * Applies an operator to its operands. With only single values that is one
 * computation. When an operand is an array, the operator is applied cell by
 * cell and the result is an array: a single value pairs with every cell, and
 * an array of one row or one column pairs with every row or column of a
 * larger one. A cell with no partner is `#N/A`.
 */
function elementwise(
  operands: readonly Evaluated[],
  operate: (...values: Scalar[]) => Scalar,
): Evaluated {
  if (!operands.some(isRange)) return operate(...operands.map(scalar));

  const grids = operands.map((operand) => (isRange(operand) ? operand.rows : [[scalar(operand)]]));
  const height = Math.max(...grids.map((rows) => rows.length));
  const width = Math.max(...grids.map((rows) => rows[0]?.length ?? 0));
  const cellAt = (rows: readonly CellValue[][], row: number, col: number): CellValue => {
    const cells = rows.length === 1 ? rows[0] : rows[row];
    const cell = cells?.length === 1 ? cells[0] : cells?.[col];
    return cell === undefined ? error("#N/A", "The arrays are not the same size") : cell;
  };
  return array(
    Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, col) =>
        element(() => operate(...grids.map((rows) => scalar(cellAt(rows, row, col))))),
      ),
    ),
  );
}

/**
 * Calls a function made by `LAMBDA` with values for its parameters. The body
 * runs in the context the function was made in, with the parameters bound.
 */
export function callLambda(
  lambda: LambdaValue,
  values: readonly Evaluated[],
  caller: EvaluationContext,
): Evaluated {
  if (values.length !== lambda.params.length) {
    fail("#ERROR!", arity("The function", lambda.params.length, lambda.params.length));
  }
  const depth = (caller.depth ?? 0) + 1;
  if (depth > MAX_CALL_DEPTH) fail("#ERROR!", "Function calls are nested too deeply");

  const names = new Map(lambda.context.names);
  lambda.params.forEach((param, index) => names.set(param.toLowerCase(), values[index] ?? null));
  return compute(lambda.body, { ...lambda.context, names, depth });
}

/** Calls whatever a value is, which must be a function made by `LAMBDA`. */
function applyValue(
  target: Evaluated,
  args: readonly Node[],
  context: EvaluationContext,
): Evaluated {
  if (isError(target)) throw new Failure(target);
  if (!isLambda(target)) fail("#VALUE!", "Only a function made with LAMBDA can be called");
  return callLambda(
    target,
    args.map((arg) => evaluate(arg, context)),
    context,
  );
}

function call(name: string, args: readonly Node[], context: EvaluationContext): Evaluated {
  // A name bound by LET or LAMBDA comes before a built-in function of the same name.
  const bound = context.names?.get(name.toLowerCase());
  if (bound !== undefined) return applyValue(bound, args, context);

  const definition = context.functions.get(name);
  if (!definition) fail("#NAME?", `Unknown function ${name}`);
  if (args.length < definition.minArgs || args.length > definition.maxArgs) {
    fail("#ERROR!", arity(name, definition.minArgs, definition.maxArgs));
  }
  switch (definition.kind) {
    case "action":
      return { kind: "action", name, args: [...args], origin: context.origin };
    case "special":
      return definition.evaluate(args, context);
    case "pure":
      return definition.call(
        args.map((arg) => () => evaluate(arg, context)),
        context,
      );
  }
}

/** Evaluates a node. Throws `Failure` where `evaluate` would return an error. */
function compute(node: Node, context: EvaluationContext): Evaluated {
  switch (node.type) {
    case "number":
    case "string":
    case "boolean":
      return node.value;
    case "error":
      return error(node.code);
    case "reference":
      return readReference(node.reference, context);
    case "name": {
      const bound = context.names?.get(node.name.toLowerCase());
      return bound ?? fail("#NAME?", `Unknown name ${node.name}`);
    }
    case "call":
      return call(node.name, node.args, context);
    case "apply":
      return applyValue(compute(node.target, context), node.args, context);
    case "unary": {
      const sign = node.operator === "-" ? -1 : 1;
      return elementwise([compute(node.operand, context)], (operand) => sign * number(operand));
    }
    case "binary":
      return elementwise(
        [compute(node.left, context), compute(node.right, context)],
        (left = null, right = null) => binary(node.operator, left, right),
      );
  }
}

/**
 * Evaluates an AST. Reads cell values through `context` and has no side
 * effects. A failure anywhere inside comes back as an error value.
 */
export function evaluate(node: Node, context: EvaluationContext): Evaluated {
  try {
    return compute(node, context);
  } catch (cause) {
    // A function reports a bad argument by throwing Failure. Anything else is a bug.
    if (cause instanceof Failure) return cause.error;
    throw cause;
  }
}

/**
 * Lists the references a formula reads during recalculation. Arguments of
 * action functions are left out: they are evaluated when the action runs, so
 * a cell holding `=BUTTON("Add", EXECUTE(A1+1, A1))` does not depend on A1.
 */
export function referencesOf(node: Node, functions: FunctionRegistry): Reference[] {
  const all = (nodes: readonly Node[]): Reference[] =>
    nodes.flatMap((child) => referencesOf(child, functions));
  switch (node.type) {
    case "reference":
      return [node.reference];
    case "unary":
      return referencesOf(node.operand, functions);
    case "binary":
      return all([node.left, node.right]);
    case "call":
      return functions.get(node.name)?.kind === "action" ? [] : all(node.args);
    case "apply":
      return all([node.target, ...node.args]);
    default:
      return [];
  }
}
