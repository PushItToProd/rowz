import { columnLabel, type CellId, type CellRange } from "./address";
import {
  formatReference,
  isColumnReference,
  isSingleCell,
  quoteName,
  type BinaryOperator,
  type Node,
  type Reference,
} from "./ast";
import { DAY_MS, dateFromMs, isDate } from "./dates";
import {
  error,
  fail,
  Failure,
  finite,
  type ErrorTraceCallSite,
  type ErrorValue,
  type ScriptFunctionLocation,
} from "./errors";
import { array, element, limitCells, number, scalar } from "./functions/arguments";
import { logicFunctions } from "./functions/logic";
import type { FunctionRegistry } from "./functions/registry";
import {
  compare,
  isError,
  isFunction,
  isLambda,
  isRange,
  toText,
  type CellValue,
  type Evaluated,
  type FunctionValue,
  type Scalar,
} from "./values";
import { sameColumnName } from "./structure";

/**
 * The names a document defines, as a formula sees them from where it is
 * written. Each method throws `Failure` for a name that cannot be read.
 */
export interface NameScope {
  /**
   * The value of a word written alone, or `undefined` when the document has
   * nothing of that name. A word with more than one meaning fails.
   */
  bare(name: string): Evaluated | undefined;
  /** The value of a name written with the table or script that holds it. */
  qualified(node: Node & { type: "qualified" }): Evaluated;
}

export interface EvaluationContext {
  /** The cell whose formula is being evaluated. */
  origin: CellId;
  /** The page whose formula is being evaluated when it is not in a cell. */
  pageId?: string;
  /** The page containing a cell formula, used to explain missing table references. */
  homePageId?: string;
  functions: FunctionRegistry;
  /** Finds the cells a reference points at, or `undefined` if its table does not exist. */
  resolve(reference: Reference): CellRange | undefined;
  read(cell: CellId): CellValue;
  /** Why a cell cannot be used as the stored target of an input control. */
  controlTargetError(cell: CellId): string | undefined;
  /** The size of a table, which is where a range with an open side stops. */
  extent(tableId: string): { rows: number; cols: number };
  /** The names of a data table's columns, or `undefined` for a plain grid. */
  columnNames?(tableId: string): readonly string[] | undefined;
  /** Pages that hold a table with the given name. */
  tablePages?(name: string): readonly { pageId: string; pageName: string; tableId: string }[];
  /** Values bound by `LET` and `LAMBDA`, keyed by name in lower case. */
  names?: ReadonlyMap<string, Evaluated>;
  /** The names the document defines. A binding in `names` comes before them. */
  document?: NameScope;
  /** How many function calls deep the evaluation is. */
  depth?: number;
  /** The source in which the current expression is written, for error traces. */
  traceSource?: ErrorTraceCallSite;
  /** How the current user function was called, nearest caller first. */
  traceCallSite?: ErrorTraceCallSite;
  /** The current date and time on the user's clock, in the milliseconds a `DateValue` holds. */
  now?: () => number;
}

// Deep enough for real formulas, and far short of overflowing the call stack.
const MAX_CALL_DEPTH = 200;
const MAX_TRACE_CALLERS = 5;

function arity(name: string, min: number, max: number): string {
  const count = (n: number): string => `${String(n)} argument${n === 1 ? "" : "s"}`;
  if (max === Infinity) return `${name} takes at least ${count(min)}`;
  if (min === max) return `${name} takes ${count(min)}`;
  return `${name} takes ${String(min)} to ${count(max)}`;
}

function checkArity(name: string, count: number, min: number, max: number): void {
  if (count < min || count > max) fail("#ERROR!", arity(name, min, max));
}

function withParent(
  source: ErrorTraceCallSite | undefined,
  parent: ErrorTraceCallSite | undefined,
): ErrorTraceCallSite | undefined {
  const callers: Exclude<ErrorTraceCallSite, { kind: "more" }>[] = [];
  let moreCalls = 0;
  const append = (site: ErrorTraceCallSite | undefined): void => {
    while (site) {
      if (site.kind === "more") {
        moreCalls += site.count;
        return;
      }
      if (callers.length < MAX_TRACE_CALLERS) callers.push(site);
      else moreCalls += 1;
      site = site.parent;
    }
  };
  append(source);
  append(parent);

  let result: ErrorTraceCallSite | undefined =
    moreCalls > 0 ? { kind: "more", count: moreCalls } : undefined;
  for (let index = callers.length - 1; index >= 0; index -= 1) {
    const site = callers[index];
    if (!site) continue;
    switch (site.kind) {
      case "cell":
        result = {
          kind: "cell",
          cell: site.cell,
          ...(site.tableName === undefined ? {} : { tableName: site.tableName }),
          ...(result === undefined ? {} : { parent: result }),
        };
        break;
      case "script":
        result = {
          kind: "script",
          scriptId: site.scriptId,
          scriptName: site.scriptName,
          line: site.line,
          ...(site.name === undefined ? {} : { name: site.name }),
          ...(result === undefined ? {} : { parent: result }),
        };
        break;
      case "page":
        result = {
          kind: "page",
          pageId: site.pageId,
          ...(site.pageName === undefined ? {} : { pageName: site.pageName }),
          ...(result === undefined ? {} : { parent: result }),
        };
        break;
    }
  }
  return result;
}

function collectErrors(value: Evaluated, errors: Set<ErrorValue>): void {
  if (isError(value)) errors.add(value);
  else if (isRange(value))
    for (const row of value.rows) for (const cell of row) if (isError(cell)) errors.add(cell);
}

function traceResult(
  value: Evaluated,
  frame: NonNullable<ErrorValue["trace"]>[number],
  unchanged: ReadonlySet<ErrorValue>,
): Evaluated {
  const trace = (cell: CellValue): CellValue =>
    isError(cell) && cell.trace === undefined && !unchanged.has(cell)
      ? { ...cell, trace: [frame] }
      : cell;
  if (isError(value)) return trace(value);
  return isRange(value) ? { ...value, rows: value.rows.map((row) => row.map(trace)) } : value;
}

function scriptCallSite(location: ScriptFunctionLocation): ErrorTraceCallSite {
  return {
    kind: "script",
    scriptId: location.scriptId,
    scriptName: location.scriptName,
    line: location.line,
    name: location.name,
  };
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
  return finite(result);
}

function binary(
  operator: Exclude<BinaryOperator, "and" | "or">,
  left: Scalar,
  right: Scalar,
): Scalar {
  switch (operator) {
    case "&":
      return toText(left) + toText(right);
    case "=":
      return compare(left, right) === 0;
    case "<>":
    case "!=":
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

/** Why a reference could not be resolved. */
function missing(reference: Reference, context: EvaluationContext): string {
  if (!isColumnReference(reference)) return "The referenced table does not exist";
  if (reference.table === undefined) return `This table has no column named ${reference.column}`;

  const fallback = `There is no table ${reference.table} with a column named ${reference.column}`;
  const formulaPageId = context.homePageId ?? context.pageId;
  if (reference.page !== undefined || formulaPageId === undefined || !context.tablePages)
    return fallback;

  const pages = context.tablePages(reference.table);
  if (pages.some(({ pageId }) => pageId === formulaPageId)) return fallback;

  const locations = pages
    .filter(
      ({ pageId, tableId }) =>
        pageId !== formulaPageId &&
        context.columnNames?.(tableId)?.some((name) => sameColumnName(name, reference.column)),
    )
    .map(({ pageName }) => pageName);
  if (locations.length === 0) return fallback;

  const noLocalTable = `There is no table ${reference.table} on this page.`;
  if (locations.length === 1) {
    const page = locations[0];
    if (page === undefined) return fallback;
    return `${noLocalTable} The table ${reference.table} is on page ${quoteName(page)}; write ${formatReference({ ...reference, page })}.`;
  }

  const suggestions = locations.map((page) => formatReference({ ...reference, page }));
  return `${noLocalTable} ${reference.table} is on pages ${locations.map(quoteName).join(", ")}; write one of ${suggestions.join(", ")}.`;
}

function readReference(reference: Reference, context: EvaluationContext): Evaluated {
  const range = context.resolve(reference);
  if (!range) fail("#REF!", missing(reference, context));
  const { tableId, startRow, startCol } = range;
  if (isSingleCell(reference)) return context.read({ tableId, row: startRow, col: startCol });

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
  const columnNames = context.columnNames?.(tableId)?.slice(startCol, endCol + 1);
  return {
    kind: "range",
    rows,
    ...(columnNames === undefined ? {} : { columnNames }),
  };
}

/** The formula's own row or its own column. */
export type OwnLine = "row" | "col";

/**
 * Which cells of a reference an operator reads when the reference is its
 * operand: `"row"` for a whole column, which gives its cell in the formula's
 * own row, and `"col"` for a whole row, which gives its cell in the formula's
 * own column. `undefined` for anything else, which is read whole.
 */
function ownLineOf(node: Node): OwnLine | undefined {
  if (node.type !== "reference") return undefined;
  const { reference } = node;
  // `Sales[Price]` is a whole column just as `A:A` is.
  if (isColumnReference(reference)) return reference.table === undefined ? undefined : "row";
  const { start, end } = reference;
  if (end === undefined) return undefined;
  if (start.row === null && end.row === null) return "row";
  if (start.col === null && end.col === null) return "col";
  return undefined;
}

/**
 * Evaluates an operand of an operator. A whole column written as an operand
 * means that column's cell in the formula's own row, so `=A:A + B:B` in row 5
 * is `=A5 + B5`, and one formula serves every row it is filled into. A whole
 * row means its cell in the formula's own column. Anywhere else, and in a
 * formula that is not in a cell, a whole column is all of its cells.
 */
function operand(node: Node, context: EvaluationContext): Evaluated {
  const { origin } = context;
  const own = origin.tableId === "" ? undefined : ownLineOf(node);
  if (node.type !== "reference" || own === undefined) return compute(node, context);
  const { reference } = node;

  const range = context.resolve(reference);
  if (!range) fail("#REF!", missing(reference, context));
  const { tableId } = range;
  const extent = context.extent(tableId);
  const written = formatReference(reference);
  if (own === "row") {
    if (origin.row >= extent.rows)
      fail("#VALUE!", `${written} has no row ${String(origin.row + 1)}`);
    const cells: CellValue[] = [];
    for (let col = range.startCol; col <= Math.min(range.endCol, extent.cols - 1); col += 1) {
      cells.push(context.read({ tableId, row: origin.row, col }));
    }
    return cells.length === 1 ? (cells[0] ?? null) : { kind: "range", rows: [cells] };
  }
  if (origin.col >= extent.cols) {
    fail("#VALUE!", `${written} has no column ${columnLabel(origin.col)}`);
  }
  const cells: CellValue[][] = [];
  for (let row = range.startRow; row <= Math.min(range.endRow, extent.rows - 1); row += 1) {
    cells.push([context.read({ tableId, row, col: origin.col })]);
  }
  return cells.length === 1 ? (cells[0]?.[0] ?? null) : { kind: "range", rows: cells };
}

/**
 * Applies an operator to its operands. With only single values that is one
 * computation. When an operand is an array, the operator is applied cell by
 * cell and the result is an array: a single value pairs with every cell, and
 * an array of one row or one column pairs with every row or column of a
 * larger one. A cell with no partner is `#N/A`. An array with no rows gives
 * an array with no rows.
 */
function elementwise(
  operands: readonly Evaluated[],
  operate: (...values: Scalar[]) => Scalar,
): Evaluated {
  if (!operands.some(isRange)) return operate(...operands.map(scalar));

  const grids = operands.map((operand) => (isRange(operand) ? operand.rows : [[scalar(operand)]]));
  // A range over a table with no rows has no cell to pair with anything.
  if (grids.some((rows) => rows.length === 0)) return array([]);
  const height = Math.max(...grids.map((rows) => rows.length));
  const width = Math.max(...grids.map((rows) => rows[0]?.length ?? 0));
  const cellAt = (rows: readonly CellValue[][], row: number, col: number): CellValue => {
    const cells = rows.length === 1 ? rows[0] : rows[row];
    const cell = cells?.length === 1 ? cells[0] : cells?.[col];
    return cell === undefined ? error("#N/A", "The arrays are not the same size") : cell;
  };
  // A column paired with a row gives a cell for every pair.
  limitCells(height * width);
  return array(
    Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, col) =>
        element(() => operate(...grids.map((rows) => scalar(cellAt(rows, row, col))))),
      ),
    ),
  );
}

/**
 * Calls a function with evaluated arguments. A `LAMBDA` body or built-in call
 * runs in the context where that function value was made.
 */
export function callFunction(
  fn: FunctionValue,
  values: readonly Evaluated[],
  caller: EvaluationContext,
): Evaluated {
  const depth = (caller.depth ?? 0) + 1;
  if (depth > MAX_CALL_DEPTH) fail("#ERROR!", "Function calls are nested too deeply");

  if (isLambda(fn)) {
    if (values.length !== fn.params.length) {
      fail("#ERROR!", arity("The function", fn.params.length, fn.params.length));
    }
    const names = new Map(fn.context.names);
    fn.params.forEach((param, index) => names.set(param.toLowerCase(), values[index] ?? null));
    const callSite = withParent(caller.traceSource, caller.traceCallSite);
    const unchanged = new Set<ErrorValue>();
    values.forEach((value) => {
      collectErrors(value, unchanged);
    });
    const frame = fn.userFunction
      ? {
          function: fn.userFunction.function,
          location: fn.userFunction.location,
          ...(callSite === undefined ? {} : { callSite }),
        }
      : undefined;
    const document = fn.context.document;
    const context: EvaluationContext = fn.userFunction
      ? {
          ...fn.context,
          names,
          depth,
          read: (cell) => {
            const value = fn.context.read(cell);
            collectErrors(value, unchanged);
            return value;
          },
          ...(document === undefined
            ? {}
            : {
                document: {
                  bare: (name: string) => {
                    const value = document.bare(name);
                    if (value !== undefined) collectErrors(value, unchanged);
                    return value;
                  },
                  qualified: (node: Node & { type: "qualified" }) => {
                    const value = document.qualified(node);
                    collectErrors(value, unchanged);
                    return value;
                  },
                },
              }),
          traceSource: scriptCallSite(fn.userFunction.location),
          traceCallSite: callSite,
        }
      : { ...fn.context, names, depth };
    try {
      const result = compute(fn.body, context);
      return frame === undefined ? result : traceResult(result, frame, unchanged);
    } catch (cause) {
      if (
        !(cause instanceof Failure) ||
        frame === undefined ||
        cause.error.trace !== undefined ||
        unchanged.has(cause.error)
      )
        throw cause;
      throw new Failure({ ...cause.error, trace: [frame] });
    }
  }

  const definition = fn.context.functions.get(fn.name);
  if (definition?.kind !== "pure" || !definition.callableAsValue) {
    fail("#VALUE!", "This built-in function cannot be used as a value");
  }
  checkArity(fn.name, values.length, definition.minArgs, definition.maxArgs);
  return returned(
    definition.call(
      values.map((value) => () => value),
      { ...fn.context, depth },
    ),
  );
}

/** Calls a function value with arguments read in the context of the call. */
function applyValue(
  target: Evaluated,
  args: readonly Node[],
  context: EvaluationContext,
): Evaluated {
  if (isError(target)) throw new Failure(target);
  if (!isFunction(target)) fail("#VALUE!", "Only a LAMBDA or built-in function can be called");
  return callFunction(
    target,
    args.map((arg) => evaluate(arg, context)),
    context,
  );
}

/**
 * What a function returned, with any number that is not finite made an error.
 * Checking here means no function has to check its own result.
 */
function returned(result: Evaluated): Evaluated {
  if (typeof result === "number") return finite(result);
  if (!isRange(result)) return result;
  const unfit = (cell: CellValue): boolean => typeof cell === "number" && !Number.isFinite(cell);
  if (!result.rows.some((cells) => cells.some(unfit))) return result;
  return array(result.rows.map((cells) => cells.map((cell) => element(() => returned(cell)))));
}

function call(name: string, args: readonly Node[], context: EvaluationContext): Evaluated {
  // A name bound by LET or LAMBDA comes before a built-in function of the same name.
  const bound = context.names?.get(name.toLowerCase());
  if (bound !== undefined) return applyValue(bound, args, context);

  const definition = context.functions.get(name);
  if (!definition) {
    // A name cannot be spelled like a built-in function, so the order of these two does not matter.
    const named = context.document?.bare(name);
    if (named !== undefined) return applyValue(named, args, context);
    fail("#NAME?", `Unknown function ${name}`);
  }
  checkArity(name, args.length, definition.minArgs, definition.maxArgs);
  switch (definition.kind) {
    case "action":
      return {
        kind: "action",
        name,
        args: [...args],
        origin: context.origin,
        ...(context.names === undefined ? {} : { names: new Map(context.names) }),
        ...(context.pageId === undefined ? {} : { pageId: context.pageId }),
      };
    case "special":
      return definition.evaluate(args, context);
    case "pure":
      return returned(
        definition.call(
          args.map((arg) => () => evaluate(arg, context)),
          context,
        ),
      );
  }
}

/** Local bindings cannot change the built-in meaning of a boolean operator. */
function booleanOperation(
  name: string,
  args: readonly Node[],
  context: EvaluationContext,
): Evaluated {
  const definition = logicFunctions[name];
  if (definition?.kind !== "pure") throw new Error(`Missing boolean function ${name}`);
  return returned(
    definition.call(
      args.map((arg) => () => evaluate(arg, context)),
      context,
    ),
  );
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
      // A name can be bound to an empty cell, whose value is null, so presence is what counts.
      const key = node.name.toLowerCase();
      if (context.names?.has(key)) return context.names.get(key) ?? null;
      const named = context.document?.bare(node.name);
      if (named !== undefined) return named;
      const name = node.name.toUpperCase();
      const definition = context.functions.get(name);
      if (definition?.kind === "pure" && definition.callableAsValue) {
        return { kind: "builtin", name, context };
      }
      if (definition?.kind === "pure") return fail("#NAME?", `Unknown name '${node.name}'`);
      if (definition?.kind === "action") {
        return fail("#VALUE!", "Action functions cannot be used as values");
      }
      if (definition?.kind === "special") {
        return fail("#VALUE!", "Special forms cannot be used as values");
      }
      return fail("#NAME?", `Unknown name '${node.name}'`);
    }
    case "qualified":
      if (!context.document) fail("#NAME?", `Unknown name '${node.name}'`);
      return context.document.qualified(node);
    case "call":
      return call(node.name, node.args, context);
    case "apply":
      return applyValue(compute(node.target, context), node.args, context);
    case "unary": {
      if (node.operator === "not") return booleanOperation("NOT", [node.operand], context);
      const sign = node.operator === "-" ? -1 : 1;
      return elementwise([operand(node.operand, context)], (value) => sign * number(value));
    }
    case "binary": {
      if (node.operator === "and" || node.operator === "or")
        return booleanOperation(node.operator.toUpperCase(), [node.left, node.right], context);
      const operator = node.operator;
      return elementwise(
        [operand(node.left, context), operand(node.right, context)],
        (left = null, right = null) => binary(operator, left, right),
      );
    }
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
    // A function reports a bad argument by throwing Failure.
    if (cause instanceof Failure) return cause.error;
    // JavaScript reports a limit of its own this way: text longer than a string
    // can be, or calls nested deeper than the stack. A formula can ask for
    // either, and one cell's error must not stop the rest from calculating.
    if (cause instanceof RangeError) return error("#VALUE!", "The result is too large to compute");
    // Anything else is a bug.
    throw cause;
  }
}

/** A reference a formula in a cell reads. */
export interface Read {
  reference: Reference;
  /** Set when the formula reads the reference only where it crosses the formula's own row or column. */
  own?: OwnLine;
}

/**
 * Lists the references a formula in a cell reads during recalculation, each
 * with as much of it as `operand` reads. Arguments of action functions are
 * left out: they are evaluated when the action runs, so a cell holding
 * `=BUTTON("Add", EXECUTE(A1+1, A1))` does not depend on A1.
 */
export function referencesOf(node: Node, functions: FunctionRegistry): Read[] {
  const all = (nodes: readonly Node[]): Read[] =>
    nodes.flatMap((child) => referencesOf(child, functions));
  const operands = (nodes: readonly Node[]): Read[] =>
    nodes.flatMap((child) => {
      const own = ownLineOf(child);
      return child.type === "reference" && own !== undefined
        ? [{ reference: child.reference, own }]
        : referencesOf(child, functions);
    });
  switch (node.type) {
    case "reference":
      return [{ reference: node.reference }];
    case "unary":
      return node.operator === "not" ? all([node.operand]) : operands([node.operand]);
    case "binary":
      return node.operator === "and" || node.operator === "or"
        ? all([node.left, node.right])
        : operands([node.left, node.right]);
    case "call":
      return functions.get(node.name)?.kind === "action" ? [] : all(node.args);
    case "apply":
      return all([node.target, ...node.args]);
    default:
      return [];
  }
}
