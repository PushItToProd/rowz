import { cellKey, formatAddress, rangeContains, type CellId, type CellRange } from "./address";
import { isColumnReference, isSingleCell, quoteName, type Node, type Reference } from "./ast";
import { formatDate, isDate, parseDate } from "./dates";
import type { Effect } from "./effects";
import type { ScriptFunctionLocation } from "./errors";
import {
  evaluate,
  referencesOf,
  type EvaluationContext,
  type NameScope,
  type Read,
} from "./evaluate";
import { defaultFunctions } from "./functions";
import { fail, Failure } from "./functions/arguments";
import type { FunctionRegistry } from "./functions/registry";
import { DependencyIndex, evaluationOrder } from "./graph";
import { refusedName } from "./names";
import { parseFormula } from "./parser";
import { namesOf, type NameUse } from "./scope";
import { scriptNames, scriptStatements } from "./script";
import {
  findColumn,
  TableResolver,
  type ColumnDefinition,
  type Holder,
  type NameDefinition,
  type TableDefinition,
  type WorkbookData,
  type WorkbookStructure,
} from "./structure";
import { FormulaSyntaxError } from "./tokenizer";
import {
  compare,
  error,
  isLambda,
  isFormulaInput,
  kindOf,
  literalInput,
  toBoolean,
  toText,
  type ControlValue,
  isError,
  isButton,
  isRange,
  isScalar,
  parseLiteralInput,
  parseNumber,
  type ActionValue,
  type CellValue,
  type ErrorValue,
  type Evaluated,
  type Scalar,
} from "./values";

export type ActionPlan = { ok: true; effects: Effect[] } | { ok: false; error: ErrorValue };

type CellContent =
  | { type: "literal"; value: Scalar }
  | { type: "formula"; ast: Node }
  | { type: "invalid"; error: ErrorValue };

interface CellRecord {
  id: CellId;
  input: string;
  content: CellContent;
  /** Whether the cell is in a formula column, whose formula the table holds and not the cell. */
  computed?: boolean;
  /** The ranges the formula reads during recalculation. Empty for non-formulas. */
  precedents: CellRange[];
}

/** A name the document defines, with what its formula parsed to. */
interface NameRecord {
  holder: Holder;
  name: string;
  /** A repeated script definition is an error, but not another meaning of the name. */
  duplicate?: boolean;
  content: { ast: Node } | { error: ErrorValue };
  /** The cells the formula reads, through other names as well. */
  precedents: CellRange[];
  /** The value computed for it, and the state of the cells it was computed from. */
  kept?: { epoch: number; value: Evaluated };
  evaluating: boolean;
  /** Whether evaluating this name has read the workbook clock. */
  volatile?: boolean;
  /** Set for a bare formula of a script, which has no name: the line it is written on. */
  line?: number;
  /** The line of a named script definition. */
  scriptLine?: number;
  /** Set for a function defined by name and parameters in a script. */
  functionLocation?: ScriptFunctionLocation;
}

/** Where an evaluated cell, named value, or script statement is defined. */
type ErrorLocation =
  | { kind: "cell"; cell: CellId }
  | { kind: "name"; holderId: string; name: string; line?: number }
  | { kind: "statement"; holderId: string; line: number };

/** An evaluated error and its location in the workbook. */
export type WorkbookError = ErrorLocation & {
  code: ErrorValue["code"];
  message: string;
  trace?: ErrorValue["trace"];
};
/** An `ASSERT` that is false, and where it is. */
export type AssertionFailure = ErrorLocation & { message: string; trace?: ErrorValue["trace"] };

/** The value a qualified name stands for when no cell holds its formula. */
const NO_CELL: CellId = { tableId: "", row: 0, col: 0 };

const TEXT_PREFIX = "'";

/**
 * Reads what was typed into a cell of a typed column. The column's type says
 * what the cell holds, so `007` in a text column stays text, and anything
 * that does not read as the type is an error the cell shows.
 */
function parseTyped(input: string, type: ColumnDefinition["type"]): CellContent {
  const refuse = (what: string): CellContent => ({
    type: "invalid",
    error: error("#VALUE!", `${input} is not ${what}`),
  });
  // An apostrophe forces text in any cell. Here the text is then checked against the type.
  const typed = input.startsWith(TEXT_PREFIX) ? input.slice(1) : input;
  switch (type) {
    case "text":
      return { type: "literal", value: typed };
    case "number": {
      const value = parseNumber(typed);
      return value === undefined ? refuse("a number") : { type: "literal", value };
    }
    case "date": {
      const value = parseDate(typed);
      return value === undefined ? refuse("a date") : { type: "literal", value };
    }
    case "checkbox": {
      const upper = typed.trim().toUpperCase();
      if (upper !== "TRUE" && upper !== "FALSE") return refuse("TRUE or FALSE");
      return { type: "literal", value: upper === "TRUE" };
    }
    default:
      return parseContent(input);
  }
}

function parseContent(input: string): CellContent {
  if (!isFormulaInput(input)) return { type: "literal", value: parseLiteralInput(input) };
  try {
    return { type: "formula", ast: parseFormula(input.slice(1)) };
  } catch (cause) {
    if (!(cause instanceof FormulaSyntaxError)) throw cause;
    return { type: "invalid", error: error(cause.code, cause.message) };
  }
}

/**
 * The first and last index a reference covers along one axis, given what its
 * two corners say. A corner that leaves the axis out makes that side open:
 * the start defaults to the first row or column, and the end has no limit.
 */
function span(start: number | null, end: number | null): [first: number, last: number] {
  if (end === null) return [start ?? 0, Infinity];
  if (start === null) return [0, end];
  return [Math.min(start, end), Math.max(start, end)];
}

export interface WorkbookOptions {
  functions?: FunctionRegistry;
  /**
   * The current date and time on the user's clock, as the milliseconds a
   * `DateValue` holds. `TODAY` and `NOW` read it. The default is this
   * machine's local time, which on a server is not the user's.
   */
  now?: () => number;
}

const MINUTE_MS = 60_000;

/** This machine's local date and time. */
function localClock(): number {
  const moment = new Date();
  return moment.getTime() - moment.getTimezoneOffset() * MINUTE_MS;
}

// How many times one settling pass may recompute a cell before its value is
// declared a cycle. Array results that fill each other's inputs can undo one
// another forever, and this is what stops them.
const MAX_ATTEMPTS = 20;

function countWithUnit(count: number, unit: string): string {
  return `${String(count)} ${unit}${count === 1 ? "" : "s"}`;
}

/**
 * The cells of one spreadsheet and their computed values.
 *
 * Changing a cell discards the computed values of the cells that depend on
 * it. The next read computes every discarded value before it answers, because
 * a formula whose result is an array fills the cells around it, and a reader
 * of those cells cannot know that until the array formula has run.
 *
 * Computing never has side effects: action formulas evaluate to descriptions,
 * which `planAction` turns into effects for the caller to apply.
 */
export class Workbook {
  private tables = new TableResolver({ pages: [], tables: [] });
  private readonly cells = new Map<string, Map<string, CellRecord>>();
  /** Computed values of formula cells. */
  private readonly cache = new Map<string, CellValue>();
  /** Formula cells whose value is not computed. */
  private readonly pending = new Set<CellRecord>();
  private readonly volatileCells = new Set<CellRecord>();
  private evaluatingCell: CellRecord | undefined;
  private readonly evaluatingNames = new Set<NameRecord>();
  private readonly dependencies = new DependencyIndex();

  /** The values an array formula placed in other cells, keyed by the cell each landed in. */
  private readonly spilled = new Map<string, { anchor: CellId; value: CellValue }>();
  /** The cells each array formula filled, keyed by the formula's own cell. */
  private readonly spillAreas = new Map<string, CellId[]>();
  /** Array formulas whose result did not fit. A change to their table may make room. */
  private readonly blocked = new Map<string, CellId>();

  /** Tables whose cells were last read according to named columns. */
  private readonly typed = new Set<string>();
  /**
   * For each data table that was given no size, how many of its rows have
   * their formula-column cells: the rows through the last one typed into.
   */
  private readonly computedRows = new Map<string, number>();

  /** The names the document defines, by spelling in lower case. Several may share one. */
  private names = new Map<string, NameRecord[]>();
  /** The bare formulas of scripts. They define no name, so nothing reads them. */
  private statements: NameRecord[] = [];
  /** Counts discarded cell values, so a name's kept value can tell that a cell it read may have changed. */
  private epoch = 0;

  private settling = false;
  /** Counts calls to `invalidate`, so a computing pass can tell that one happened under it. */
  private invalidations = 0;

  private readonly functions: FunctionRegistry;
  private readonly now: () => number;

  constructor({ functions = defaultFunctions, now = localClock }: WorkbookOptions = {}) {
    this.functions = functions;
    this.now = now;
  }

  /**
   * Replaces the pages and tables. Cells of tables that still exist are kept.
   * References are matched to tables by name, so every formula is re-resolved.
   */
  setStructure(structure: WorkbookStructure): void {
    this.tables = new TableResolver(structure);
    for (const table of structure.tables) {
      if (!this.cells.has(table.id)) this.cells.set(table.id, new Map());
    }
    for (const tableId of this.cells.keys()) {
      if (this.tables.table(tableId)) continue;
      this.cells.delete(tableId);
      this.computedRows.delete(tableId);
    }
    for (const table of structure.tables) this.applyColumns(table);
    const scripts = structure.scripts ?? [];
    this.defineNames(
      [
        ...(structure.names ?? []),
        ...scripts.flatMap((script) => scriptNames(script.id, script.source)),
      ],
      scripts.flatMap((script) => scriptStatements(script.id, script.source)),
    );

    this.cache.clear();
    this.pending.clear();
    this.volatileCells.clear();
    this.dependencies.clear();
    this.spilled.clear();
    this.spillAreas.clear();
    this.blocked.clear();
    for (const records of this.cells.values()) {
      for (const record of records.values()) {
        this.index(record);
        if (record.content.type === "formula") this.pending.add(record);
      }
    }
  }

  /**
   * Makes a table's cells agree with its columns: every row computes the
   * formulas of the formula columns, and what was typed into a typed column
   * is read as that type.
   */
  private applyColumns(table: TableDefinition): void {
    const records = this.cells.get(table.id);
    if (!records) return;
    // A plain table that was never a data table has nothing to bring into agreement.
    if (!table.columns && !this.typed.has(table.id)) return;
    if (table.columns) this.typed.add(table.id);
    else this.typed.delete(table.id);
    let typedRows = 0;
    for (const [key, record] of records) {
      const column = table.columns?.[record.id.col];
      if (record.computed || column?.type === "formula") records.delete(key);
      else {
        record.content = parseTyped(record.input, column?.type ?? "any");
        typedRows = Math.max(typedRows, record.id.row + 1);
      }
    }
    this.computedRows.delete(table.id);
    if (!table.columns) return;
    const rows = table.rowCount ?? typedRows;
    if (table.rowCount === undefined) this.computedRows.set(table.id, rows);
    for (let row = 0; row < rows; row += 1) this.computeRow(table, row, records);
  }

  /** Gives a row its formula-column cells. */
  private computeRow(
    table: TableDefinition,
    row: number,
    records: Map<string, CellRecord>,
  ): CellRecord[] {
    const added: CellRecord[] = [];
    for (const [col, column] of (table.columns ?? []).entries()) {
      if (column.type !== "formula" || column.formula === undefined) continue;
      const id = { tableId: table.id, row, col };
      const record: CellRecord = {
        id,
        input: column.formula,
        content: parseContent(column.formula),
        computed: true,
        precedents: [],
      };
      records.set(cellKey(id), record);
      added.push(record);
    }
    return added;
  }

  /**
   * Gives the rows through `row` their formula-column cells, in a data table
   * that was given no size and so ends at the last row typed into.
   */
  private coverRow({ tableId, row }: CellId, records: Map<string, CellRecord>): void {
    const covered = this.computedRows.get(tableId);
    const table = this.tables.table(tableId);
    if (covered === undefined || !table || row < covered) return;
    for (let next = covered; next <= row; next += 1) {
      for (const record of this.computeRow(table, next, records)) {
        this.index(record);
        this.invalidate(record.id);
      }
    }
    this.computedRows.set(tableId, row + 1);
  }

  /**
   * Which rows of a table pass a filter formula, such as `=[Payout] > 60000`.
   * The formula is evaluated for each row as a formula column's would be, so
   * `[Column]` means that row's own cell. A row for which the formula gives an
   * error is shown, and the first error is returned beside the rows.
   */
  filterRows(tableId: string, formula: string): { shown: boolean[]; error?: ErrorValue } {
    this.settle();
    const rows = this.extent(tableId).rows;
    const shown = Array.from({ length: rows }, () => true);
    const written = formula.trim();
    const content = parseContent(written.startsWith("=") ? written : `=${written}`);
    if (content.type === "invalid") return { shown, error: content.error };
    if (content.type !== "formula") {
      return { shown, error: error("#VALUE!", "A filter is a formula") };
    }
    let first: ErrorValue | undefined;
    for (let row = 0; row < rows; row += 1) {
      const value = evaluate(content.ast, this.context({ tableId, row, col: 0 }));
      const truth = isError(value)
        ? value
        : isScalar(value)
          ? toBoolean(value)
          : error("#VALUE!", "A filter must give TRUE or FALSE");
      if (typeof truth === "boolean") shown[row] = truth;
      else first ??= truth;
    }
    return { shown, ...(first ? { error: first } : {}) };
  }

  /** The column a cell is in, when its table has named columns. */
  columnOf(id: CellId): ColumnDefinition | undefined {
    return this.tables.table(id.tableId)?.columns?.[id.col];
  }

  /** Why a cell cannot be used as the stored target of an input control. */
  private controlTargetError({ tableId, row, col }: CellId): string | undefined {
    const table = this.tables.table(tableId);
    if (!table) return "The cell to read and write does not exist";
    if (
      row < 0 ||
      col < 0 ||
      (table.rowCount !== undefined && row >= table.rowCount) ||
      (table.colCount !== undefined && col >= table.colCount)
    ) {
      return `${formatAddress({ row, col })} is outside the table`;
    }

    const column = this.columnOf({ tableId, row, col });
    if (column?.type === "formula") {
      return `${column.name} is a formula column and cannot be written to`;
    }
    const record = this.record({ tableId, row, col });
    if (record && isFormulaInput(record.input)) {
      return `${formatAddress({ row, col })} has a formula and cannot be used as a control target`;
    }
    if (this.spillAnchor({ tableId, row, col })) {
      return `${formatAddress({ row, col })} is filled by an array formula and cannot be used as a control target`;
    }
    return undefined;
  }

  /** A cycle can hide the error from a control whose direct target is a formula cell. */
  private invalidControlTarget(record: CellRecord): ErrorValue | undefined {
    if (record.content.type !== "formula" || record.content.ast.type !== "call") return undefined;
    const call = record.content.ast;
    const name = call.name.toUpperCase();
    const targetIndex =
      name === "DROPDOWN"
        ? 1
        : name === "CHECKBOX" || name === "TEXTBOX" || name === "NUMBERBOX"
          ? 0
          : undefined;
    if (targetIndex === undefined) return undefined;
    const node = call.args[targetIndex];
    if (node?.type !== "reference" || !isSingleCell(node.reference)) return undefined;
    const range = this.resolve(node.reference, record.id);
    if (!range) return undefined;
    const message = this.controlTargetError({
      tableId: range.tableId,
      row: range.startRow,
      col: range.startCol,
    });
    return message === undefined ? undefined : error("#VALUE!", message);
  }

  /**
   * Sets what the user typed into a cell. An empty input clears the cell. A
   * cell of a formula column is left alone: its formula belongs to the column.
   */
  setCell(id: CellId, input: string): void {
    const records = this.cells.get(id.tableId);
    if (!records) throw new Error(`Unknown table ${id.tableId}`);
    const column = this.columnOf(id);
    if (column?.type === "formula") return;

    const key = cellKey(id);
    const replaced = records.get(key);
    if (replaced) {
      this.pending.delete(replaced);
      this.volatileCells.delete(replaced);
    }
    if (input === "") {
      records.delete(key);
      this.dependencies.remove(id);
    } else {
      const content = parseTyped(input, column?.type ?? "any");
      const record: CellRecord = { id, input, content, precedents: [] };
      records.set(key, record);
      this.index(record);
    }

    if (input !== "") this.coverRow(id, records);

    // An array that had filled this cell no longer fits, and one that did not
    // fit in this table may fit now.
    const filledBy = this.spilled.get(key)?.anchor;
    this.invalidate(id);
    if (filledBy) this.invalidate(filledBy);
    this.invalidateBlocked(id.tableId);
  }

  getInput(id: CellId): string {
    return this.record(id)?.input ?? "";
  }

  /** Refresh clock readers and their dependents after a write or a clock tick. */
  recalculateVolatile(): void {
    // Names and script statements can read the clock without any cell reading them.
    this.epoch += 1;
    for (const record of this.volatileCells) this.invalidate(record.id);
  }

  private markClockReaders(): void {
    if (this.evaluatingCell) this.volatileCells.add(this.evaluatingCell);
    for (const record of this.evaluatingNames) record.volatile = true;
  }

  private readClock = (): number => {
    this.markClockReaders();
    return this.now();
  };

  getValue(id: CellId): CellValue {
    this.settle();
    return this.current(id);
  }

  /**
   * The cell whose array formula filled this cell, or `undefined` when the
   * cell shows its own content.
   */
  spillAnchor(id: CellId): CellId | undefined {
    this.settle();
    return this.spilled.get(cellKey(id))?.anchor;
  }

  /**
   * The whole result of a formula as rows: one cell for a single value, and
   * every cell it filled for an array.
   */
  getArray(id: CellId): CellValue[][] {
    this.settle();
    const filled = this.spillAreas.get(cellKey(id)) ?? [];
    const lastRow = Math.max(id.row, ...filled.map((cell) => cell.row));
    const lastCol = Math.max(id.col, ...filled.map((cell) => cell.col));
    const rows: CellValue[][] = [];
    for (let row = id.row; row <= lastRow; row += 1) {
      const cells: CellValue[] = [];
      for (let col = id.col; col <= lastCol; col += 1) {
        cells.push(this.current({ tableId: id.tableId, row, col }));
      }
      rows.push(cells);
    }
    return rows;
  }

  /**
   * Evaluates a formula written on a page but not in a cell, as a chart's
   * data or an expression in a text view is. With no table of its own, the
   * formula must name the table of every cell it reads. `names` are values
   * the formula can use by name.
   */
  evaluateOnPage(
    pageId: string,
    formula: string,
    names?: ReadonlyMap<string, Evaluated>,
  ): Evaluated {
    this.settle();
    let ast: Node;
    try {
      ast = parseFormula(formula.startsWith("=") ? formula.slice(1) : formula);
    } catch (cause) {
      if (!(cause instanceof FormulaSyntaxError)) throw cause;
      return error(cause.code, cause.message);
    }
    return evaluate(ast, { ...this.pageContext(pageId), ...(names ? { names } : {}) });
  }

  /**
   * The value of a name that a table or script holds, or `undefined` when it
   * holds none of that spelling.
   */
  getName(holderId: string, name: string, line?: number): Evaluated | undefined {
    this.settle();
    const record = this.names
      .get(name.toLowerCase())
      ?.find(
        (candidate) =>
          candidate.holder.id === holderId && (line === undefined || candidate.scriptLine === line),
      );
    return record && this.valueOfName(record);
  }

  /**
   * The value of a bare formula of a script, such as an `ASSERT`, by the line
   * it is written on, or `undefined` when that line holds none.
   */
  getStatement(holderId: string, line: number): Evaluated | undefined {
    this.settle();
    const record = this.statements.find(
      (candidate) => candidate.holder.id === holderId && candidate.line === line,
    );
    return record && this.valueOfName(record);
  }

  /**
   * Every `ASSERT` that is false: in a cell, as the value of a name, or as a
   * statement of a script. A name that only reads a failed cell is reported
   * too, since it has the cell's error as its value.
   */
  failedAssertions(): AssertionFailure[] {
    return this.errors().flatMap(({ code, ...failure }) => (code === "#ASSERT!" ? [failure] : []));
  }

  /** Every evaluated error in cells, named values, and script statements. */
  errors(): WorkbookError[] {
    this.settle();
    const failures: WorkbookError[] = [];
    const failureOf = (value: Evaluated): Evaluated => {
      if (!isButton(value)) return value;
      const plan = this.planAction(value.action);
      return plan.ok ? value : plan.error;
    };
    for (const records of this.cells.values()) {
      for (const { id } of records.values()) {
        const value = failureOf(this.current(id));
        if (isError(value)) {
          failures.push({
            kind: "cell",
            cell: id,
            code: value.code,
            message: value.message ?? value.code,
            ...(value.trace === undefined ? {} : { trace: value.trace }),
          });
        }
      }
    }
    for (const cells of this.spillAreas.values()) {
      for (const cell of cells) {
        const value = failureOf(this.current(cell));
        if (isError(value))
          failures.push({
            kind: "cell",
            cell,
            code: value.code,
            message: value.message ?? value.code,
            ...(value.trace === undefined ? {} : { trace: value.trace }),
          });
      }
    }
    for (const record of [...this.names.values()].flat()) {
      const value = failureOf(this.valueOfName(record));
      if (!isError(value)) continue;
      failures.push({
        kind: "name",
        holderId: record.holder.id,
        name: record.name,
        ...(record.duplicate && record.scriptLine !== undefined ? { line: record.scriptLine } : {}),
        code: value.code,
        message: value.message ?? value.code,
        ...(value.trace === undefined ? {} : { trace: value.trace }),
      });
    }
    for (const record of this.statements) {
      const value = failureOf(this.valueOfName(record));
      if (!isError(value) || record.line === undefined) continue;
      failures.push({
        kind: "statement",
        holderId: record.holder.id,
        line: record.line,
        code: value.code,
        message: value.message ?? value.code,
        ...(value.trace === undefined ? {} : { trace: value.trace }),
      });
    }
    return failures;
  }

  /** A name's value, with a failure to read it as an error value. */
  private valueOfName(record: NameRecord): Evaluated {
    try {
      return this.nameValue(record);
    } catch (cause) {
      if (cause instanceof Failure) return cause.error;
      throw cause;
    }
  }

  /**
   * Turns an action into the effects it asks for, using current cell values.
   * Nothing is applied: the caller decides whether and how to carry them out.
   */
  planAction(action: ActionValue): ActionPlan {
    this.settle();
    try {
      return { ok: true, effects: this.effectsOf(action) };
    } catch (cause) {
      if (cause instanceof Failure) return { ok: false, error: cause.error };
      throw cause;
    }
  }

  /**
   * Turns a value chosen through a control, such as a checkbox being ticked,
   * into the effect that stores it in the control's target cell.
   */
  planInput(control: ControlValue, value: Scalar): ActionPlan {
    const refuse = (message: string): ActionPlan => ({
      ok: false,
      error: error("#VALUE!", message),
    });
    const targetError = this.controlTargetError(control.target);
    if (targetError) return refuse(targetError);
    const write = (input: string): ActionPlan => {
      const column = this.columnOf(control.target);
      if (input !== "" && column) {
        const content = parseTyped(input, column.type);
        if (content.type === "invalid") {
          return refuse(`${column.name}: ${content.error.message ?? content.error.code}`);
        }
      }
      return { ok: true, effects: [{ type: "setCell", ...control.target, input }] };
    };
    if (control.control === "checkbox" && typeof value !== "boolean") {
      return refuse("A checkbox takes TRUE or FALSE");
    }
    if (control.control === "textbox") {
      if (typeof value !== "string") return refuse("A text box takes text");
      return write(value === "" ? "" : literalInput(value));
    }
    if (control.control === "numberbox") {
      if (value === null || value === "") {
        return write("");
      }
      const parsed =
        typeof value === "number"
          ? value
          : typeof value === "string"
            ? parseNumber(value)
            : undefined;
      if (parsed === undefined || !Number.isFinite(parsed)) {
        return refuse("A number box takes a number");
      }
      return write(literalInput(parsed));
    }
    // A date choice arrives as text, because the request that carries it has no date type.
    const given = typeof value === "string" ? value.trim() : value;
    const choice = control.options.find(
      (option) =>
        (kindOf(option) === kindOf(value) && compare(option, value) === 0) ||
        (isDate(option) && formatDate(option) === given),
    );
    if (control.control === "dropdown" && value !== null && choice === undefined) {
      return refuse(`${toText(value)} is not one of the choices`);
    }
    return {
      ok: true,
      effects: [{ type: "setCell", ...control.target, input: literalInput(choice ?? value) }],
    };
  }

  /** The effects an action asks for. Throws `Failure` when the action cannot run. */
  private effectsOf(action: ActionValue): Effect[] {
    const definition = this.functions.get(action.name);
    if (definition?.kind !== "action") fail("#NAME?", `Unknown action ${action.name}`);
    const context = {
      ...(action.pageId === undefined
        ? this.context(action.origin)
        : this.pageContext(action.pageId)),
      ...(action.names === undefined ? {} : { names: action.names }),
    };
    const effects = definition.plan(action.args, {
      origin: action.origin,
      evaluate: (node) => evaluate(node, context),
      resolve: (reference) => context.resolve(reference),
      target: (node) => this.targetOf(node, action.origin, action.pageId),
      tableOf: (tableId) => ({
        ...this.extent(tableId),
        columns: this.tables.table(tableId)?.columns ?? null,
      }),
      // A formula column's cells hold nothing a user typed, and nothing can be typed into them.
      inputsIn: (range) =>
        this.recordsIn(range)
          .filter((record) => !record.computed)
          .map((record) => record.id),
      plan: (inner) => this.effectsOf(inner),
    });
    for (const effect of effects) {
      const column = effect.type === "setCell" ? this.columnOf(effect) : undefined;
      if (column?.type === "formula") {
        fail("#VALUE!", `${column.name} is a formula column and cannot be written to`);
      }
    }
    return effects;
  }

  private record(id: CellId): CellRecord | undefined {
    return this.cells.get(id.tableId)?.get(cellKey(id));
  }

  /** What a cell holds right now, without computing anything. */
  private current(id: CellId): CellValue {
    const key = cellKey(id);
    const record = this.record(id);
    if (!record) return this.spilled.get(key)?.value ?? null;
    switch (record.content.type) {
      case "literal":
        return record.content.value;
      case "invalid":
        return record.content.error;
      case "formula":
        return this.cache.get(key) ?? null;
    }
  }

  /**
   * Resolves a record's references and registers them with the dependency
   * index. A name is not in the index: a cell that uses one is recorded as
   * reading the cells the name reads.
   */
  private index(record: CellRecord): void {
    if (record.content.type !== "formula") record.precedents = [];
    else {
      const { ast } = record.content;
      const pageId = this.tables.table(record.id.tableId)?.pageId;
      record.precedents = [
        ...referencesOf(ast, this.functions)
          .map((read) => this.precedent(read, record.id))
          .filter((range) => range !== undefined),
        ...namesOf(ast, this.functions).flatMap((use) =>
          this.precedentsOf(this.nameUsed(use, pageId)),
        ),
      ];
    }
    this.dependencies.set(record.id, record.precedents);
  }

  /**
   * Reads the document's names. A name that cannot be defined is kept with
   * the reason as its value, so a formula that uses it shows why.
   */
  private defineNames(
    definitions: readonly NameDefinition[],
    statements: readonly { holderId: string; line: number; formula: string }[],
  ): void {
    this.names = new Map();
    this.statements = [];
    for (const { holderId, name, formula, scriptLine, scriptFunction } of definitions) {
      const holder = this.tables.holder(holderId);
      if (!holder) continue;
      const key = name.toLowerCase();
      const sharing = this.names.get(key) ?? [];
      this.names.set(key, sharing);
      const previous = sharing.find((other) => other.holder.id === holderId);
      const duplicate =
        holder.kind === "script" && scriptLine !== undefined && previous?.scriptLine !== undefined;
      const refuse = (message: string): NameRecord["content"] => ({
        error: error("#NAME?", message),
      });
      const refused = refusedName(name, this.functions);
      let content: NameRecord["content"];
      if (duplicate)
        content = refuse(
          `${name} is already defined on line ${String(previous.scriptLine)} of this script`,
        );
      else if (refused !== undefined) content = refuse(refused);
      else if (this.tables.table(holderId)?.columns?.length) {
        content = refuse(`${holder.name} has named columns, and such a table holds no names`);
      } else if (previous) {
        content = refuse(`${holder.name} defines ${name} twice`);
      } else {
        try {
          content = { ast: parseFormula(formula.startsWith("=") ? formula.slice(1) : formula) };
        } catch (cause) {
          if (!(cause instanceof FormulaSyntaxError)) throw cause;
          content = { error: error(cause.code, cause.message) };
        }
      }
      sharing.push({
        holder,
        name,
        ...(duplicate ? { duplicate: true } : {}),
        content,
        precedents: [],
        evaluating: false,
        ...(scriptLine === undefined ? {} : { scriptLine }),
        ...(holder.kind !== "script" || !scriptFunction || scriptLine === undefined
          ? {}
          : {
              functionLocation: {
                scriptId: holder.id,
                scriptName: holder.name,
                line: scriptLine,
                name,
              },
            }),
      });
    }
    for (const record of [...this.names.values()].flat()) {
      record.precedents = this.namePrecedents(record, new Set());
    }
    for (const { holderId, line, formula } of statements) {
      const holder = this.tables.holder(holderId);
      if (!holder) continue;
      let content: NameRecord["content"];
      try {
        content = { ast: parseFormula(formula) };
      } catch (cause) {
        if (!(cause instanceof FormulaSyntaxError)) throw cause;
        content = { error: error(cause.code, cause.message) };
      }
      this.statements.push({
        holder,
        name: `line ${String(line)}`,
        line,
        content,
        precedents: [],
        evaluating: false,
      });
    }
  }

  /** The cells a name's formula reads, directly and through the names it uses. */
  private namePrecedents(record: NameRecord, seen: Set<NameRecord>): CellRange[] {
    if (seen.has(record) || !("ast" in record.content)) return [];
    seen.add(record);
    const { ast } = record.content;
    const { holder } = record;
    return [
      ...referencesOf(ast, this.functions)
        .map(({ reference }) => this.resolveFrom(holder, reference))
        .filter((range) => range !== undefined),
      ...namesOf(ast, this.functions).flatMap((use) => {
        const used = this.nameUsed(use, holder.pageId);
        if (!used) return [];
        return "holder" in used ? this.namePrecedents(used, seen) : [this.tableRange(used.id)];
      }),
    ];
  }

  /** The cells a reference written in a table or script means. */
  private resolveFrom(holder: Holder, reference: Reference): CellRange | undefined {
    return holder.kind === "table"
      ? this.rangeOf(reference, this.tables.find(reference, holder.id))
      : this.rangeOf(reference, this.tables.findFromPage(reference, holder.pageId));
  }

  /** How a name or table is written in full, for a message. */
  private written(holder: Holder, name?: string): string {
    const parts = [this.tables.pageName(holder.pageId) ?? "", holder.name];
    return [...parts, ...(name === undefined ? [] : [name])].map(quoteName).join("!");
  }

  /**
   * Everything a word written alone can mean: every name of that spelling,
   * and every table of that spelling, on any page. More than one meaning is
   * an error wherever the word is used. Nothing wins by being nearer to the
   * formula, so adding a name cannot quietly change what a formula reads.
   */
  private meanings(word: string): { names: NameRecord[]; tables: Holder[] } {
    return {
      names: (this.names.get(word.toLowerCase()) ?? []).filter((record) => !record.duplicate),
      tables: this.tables.tablesNamed(word),
    };
  }

  /** The one name or table a word written alone means, or `undefined`. */
  private bareMeaning(word: string): NameRecord | TableDefinition | undefined {
    const { names, tables } = this.meanings(word);
    if (names.length + tables.length > 1) {
      const all = [
        ...names.map((record) => this.written(record.holder, record.name)),
        ...tables.map((table) => this.written(table)),
      ];
      fail(
        "#NAME?",
        `${word} has more than one meaning: ${all.join(", ")}. Use one of these qualified names.`,
      );
    }
    if (names[0]) return names[0];
    const table = tables[0];
    return table && this.tables.table(table.id);
  }

  /** A bare document name; tables are values, not action targets. */
  private bareName(word: string): NameRecord | undefined {
    const meaning = this.bareMeaning(word);
    return meaning && "holder" in meaning ? meaning : undefined;
  }

  private qualifiedName(
    { page, holder: holderName, name }: Node & { type: "qualified" },
    pageId: string | undefined,
  ): NameRecord {
    const holder = this.tables.findHolder(holderName, page, pageId);
    if (!holder) fail("#NAME?", `There is no table or script named ${holderName}`);
    const record = this.names
      .get(name.toLowerCase())
      ?.find((candidate) => candidate.holder.id === holder.id);
    return record ?? fail("#NAME?", `${holder.name} has no name ${name}`);
  }

  /** Resolves `Summary!Total` as a held name or `Page!Sales` as a whole table. */
  private qualifiedMeaning(
    node: Node & { type: "qualified" },
    pageId: string | undefined,
  ): NameRecord | TableDefinition {
    if (node.page !== undefined) return this.qualifiedName(node, pageId);

    const holder = this.tables.findHolder(node.holder, undefined, pageId);
    const record = holder
      ? this.names
          .get(node.name.toLowerCase())
          ?.find((candidate) => candidate.holder.id === holder.id)
      : undefined;
    const table = this.tables.tableOnPage(node.holder, node.name);
    if (record && table) {
      const writtenName = this.written(record.holder, record.name);
      const writtenTable = this.written({
        kind: "table",
        id: table.id,
        pageId: table.pageId,
        name: table.name,
      });
      fail(
        "#NAME?",
        `${node.holder}!${node.name} has more than one meaning: ${writtenName}, ${writtenTable}. Use one of these qualified names.`,
      );
    }
    if (record) return record;
    if (table) return table;
    if (holder) fail("#NAME?", `${holder.name} has no name ${node.name}`);
    fail("#NAME?", `There is no table or script named ${node.holder}`);
  }

  /** The name a formula on a page uses, or `undefined` when the use is an error. */
  private nameUsed(
    use: NameUse,
    pageId: string | undefined,
  ): NameRecord | TableDefinition | undefined {
    try {
      return "holder" in use
        ? this.qualifiedMeaning({ type: "qualified", ...use }, pageId)
        : this.bareMeaning(use.name);
    } catch (cause) {
      if (cause instanceof Failure) return undefined;
      throw cause;
    }
  }

  /**
   * Computes a name, or returns the value kept for it. A kept value stands
   * until a cell's value is discarded. The cells a name reads are precedents
   * of every cell that uses the name, so they are computed before it is.
   */
  private nameValue(record: NameRecord): Evaluated {
    if ("error" in record.content) return record.content.error;
    if (record.volatile) this.markClockReaders();
    if (record.kept?.epoch === this.epoch) return record.kept.value;
    if (record.evaluating) fail("#CYCLE!", `${record.name} depends on itself`);
    record.evaluating = true;
    this.evaluatingNames.add(record);
    try {
      const { holder } = record;
      const source =
        holder.kind === "script"
          ? record.scriptLine !== undefined
            ? {
                kind: "script" as const,
                scriptId: holder.id,
                scriptName: holder.name,
                line: record.scriptLine,
                name: record.name,
              }
            : record.line !== undefined
              ? {
                  kind: "script" as const,
                  scriptId: holder.id,
                  scriptName: holder.name,
                  line: record.line,
                }
              : undefined
          : undefined;
      const value = evaluate(record.content.ast, {
        ...(holder.kind === "table"
          ? this.context({ ...NO_CELL, tableId: holder.id }, false)
          : this.pageContext(holder.pageId)),
        ...(source === undefined ? {} : { traceSource: source }),
      });
      const named =
        record.functionLocation && isLambda(value)
          ? {
              ...value,
              userFunction: { function: record.name, location: record.functionLocation },
            }
          : value;
      record.kept = { epoch: this.epoch, value: named };
      return named;
    } finally {
      record.evaluating = false;
      this.evaluatingNames.delete(record);
    }
  }

  /** The document's names as a formula written on a page sees them. */
  private scope(pageId: string | undefined): NameScope {
    return {
      bare: (word) => {
        const meaning = this.bareMeaning(word);
        if (!meaning) return undefined;
        return "holder" in meaning ? this.nameValue(meaning) : this.tableValue(meaning);
      },
      qualified: (node) => {
        const meaning = this.qualifiedMeaning(node, pageId);
        return "holder" in meaning ? this.nameValue(meaning) : this.tableValue(meaning);
      },
    };
  }

  /**
   * The cells an action's argument names: a reference, or a name whose
   * formula is one reference. Such a name stands for those cells wherever
   * cells are asked for.
   */
  private targetOf(
    node: Node | undefined,
    origin: CellId,
    pageId?: string,
  ): { range: CellRange | undefined; single: boolean } | undefined {
    if (node?.type === "reference") {
      const range =
        pageId === undefined
          ? this.resolve(node.reference, origin)
          : this.rangeOf(node.reference, this.tables.findFromPage(node.reference, pageId));
      return { range, single: isSingleCell(node.reference) };
    }
    if (node?.type !== "name" && node?.type !== "qualified") return undefined;
    const holderPage = pageId ?? this.tables.table(origin.tableId)?.pageId;
    const record =
      node.type === "name" ? this.bareName(node.name) : this.qualifiedName(node, holderPage);
    if (!record || !("ast" in record.content) || record.content.ast.type !== "reference") {
      return undefined;
    }
    const { reference } = record.content.ast;
    return { range: this.resolveFrom(record.holder, reference), single: isSingleCell(reference) };
  }

  /**
   * The cells a formula at `origin` reads through one of its references. A
   * whole column written as an operand is read in the formula's own row only.
   * Recording the whole column would make the formula depend on cells it
   * never reads, and one of those may depend on the formula.
   */
  private precedent({ reference, own }: Read, origin: CellId): CellRange | undefined {
    const range = this.resolve(reference, origin);
    if (!range || own === undefined) return range;
    return own === "row"
      ? { ...range, startRow: origin.row, endRow: origin.row }
      : { ...range, startCol: origin.col, endCol: origin.col };
  }

  private resolve(reference: Reference, origin: CellId): CellRange | undefined {
    return this.rangeOf(reference, this.tables.find(reference, origin.tableId), origin.row);
  }

  /**
   * The cells a reference covers in the table it was found to mean. `row` is
   * the row of the formula, which is the row `[Column]` reads.
   */
  private rangeOf(
    reference: Reference,
    table: TableDefinition | undefined,
    row?: number,
  ): CellRange | undefined {
    if (!table) return undefined;
    if (isColumnReference(reference)) {
      const col = findColumn(table, reference.column);
      if (col === -1) return undefined;
      const whole = {
        tableId: table.id,
        startRow: 0,
        endRow: Infinity,
        startCol: col,
        endCol: col,
      };
      if (reference.table !== undefined) return whole;
      return row === undefined ? undefined : { ...whole, startRow: row, endRow: row };
    }
    const { start, end = start } = reference;
    const [startRow, endRow] = span(start.row, end.row);
    const [startCol, endCol] = span(start.col, end.col);
    return { tableId: table.id, startRow, startCol, endRow, endCol };
  }

  private extent(tableId: string): { rows: number; cols: number } {
    const table = this.tables.table(tableId);
    if (table?.rowCount !== undefined && table.colCount !== undefined) {
      return { rows: table.rowCount, cols: table.colCount };
    }
    let rows = 0;
    let cols = 0;
    for (const { id } of this.cells.get(tableId)?.values() ?? []) {
      rows = Math.max(rows, id.row + 1);
      cols = Math.max(cols, id.col + 1);
    }
    for (const filled of this.spillAreas.values()) {
      for (const cell of filled) {
        if (cell.tableId !== tableId) continue;
        rows = Math.max(rows, cell.row + 1);
        cols = Math.max(cols, cell.col + 1);
      }
    }
    return { rows: table?.rowCount ?? rows, cols: table?.colCount ?? cols };
  }

  /** A bare table name returns all its stored cells, with schema labels for data tables. */
  private tableValue(table: TableDefinition): Evaluated {
    const { rows: height, cols: width } = this.extent(table.id);
    const rows = Array.from({ length: height }, (_, row) =>
      Array.from({ length: width }, (_, col) => this.current({ tableId: table.id, row, col })),
    );
    return {
      kind: "range",
      rows,
      ...(table.columns ? { columnNames: table.columns.map((column) => column.name) } : {}),
    };
  }

  /** A dependency range that includes every current or future cell of a table. */
  private tableRange(tableId: string): CellRange {
    return { tableId, startRow: 0, endRow: Infinity, startCol: 0, endCol: Infinity };
  }

  private precedentsOf(meaning: NameRecord | TableDefinition | undefined): CellRange[] {
    if (!meaning) return [];
    return "holder" in meaning ? meaning.precedents : [this.tableRange(meaning.id)];
  }

  private context(origin: CellId, traceSource = true): EvaluationContext {
    const tableName = this.tables.table(origin.tableId)?.name;
    return {
      origin,
      ...(traceSource
        ? {
            traceSource: {
              kind: "cell" as const,
              cell: origin,
              ...(tableName === undefined ? {} : { tableName }),
            },
          }
        : {}),
      functions: this.functions,
      resolve: (reference) => this.resolve(reference, origin),
      read: (cell) => this.current(cell),
      controlTargetError: (cell) => this.controlTargetError(cell),
      extent: (tableId) => this.extent(tableId),
      columnNames: (tableId) => this.tables.table(tableId)?.columns?.map((column) => column.name),
      now: this.readClock,
      document: this.scope(this.tables.table(origin.tableId)?.pageId),
    };
  }

  /** The context of a formula written on a page and not in a table, which names the table of every cell it reads. */
  private pageContext(pageId: string): EvaluationContext {
    const pageName = this.tables.pageName(pageId);
    return {
      // No cell holds this formula, so actions keep the page as their context.
      origin: NO_CELL,
      pageId,
      traceSource: {
        kind: "page",
        pageId,
        ...(pageName === undefined ? {} : { pageName }),
      },
      functions: this.functions,
      resolve: (reference) => this.rangeOf(reference, this.tables.findFromPage(reference, pageId)),
      read: (cell) => this.current(cell),
      controlTargetError: (cell) => this.controlTargetError(cell),
      extent: (tableId) => this.extent(tableId),
      columnNames: (tableId) => this.tables.table(tableId)?.columns?.map((column) => column.name),
      now: this.readClock,
      document: this.scope(pageId),
    };
  }

  /**
   * Discards the computed value of a cell and of every cell that depends on
   * it. Discarding an array formula empties the cells it filled, so their
   * readers are discarded too.
   */
  private invalidate(start: CellId): void {
    this.invalidations += 1;
    this.epoch += 1;
    const queue = [start, ...this.dependencies.transitiveDependents(start)];
    const seen = new Set<string>();
    for (let id = queue.pop(); id; id = queue.pop()) {
      const key = cellKey(id);
      if (seen.has(key)) continue;
      seen.add(key);

      this.cache.delete(key);
      this.blocked.delete(key);
      const record = this.record(id);
      if (record?.content.type === "formula") this.pending.add(record);

      const filled = this.spillAreas.get(key);
      if (!filled) continue;
      this.spillAreas.delete(key);
      for (const cell of filled) {
        this.spilled.delete(cellKey(cell));
        queue.push(...this.dependencies.transitiveDependents(cell));
      }
      // The cells this array gave up may be what another array was waiting for.
      queue.push(...this.blockedIn(id.tableId));
    }
  }

  private blockedIn(tableId: string): CellId[] {
    return [...this.blocked.values()].filter((anchor) => anchor.tableId === tableId);
  }

  private invalidateBlocked(tableId: string): void {
    for (const anchor of this.blockedIn(tableId)) this.invalidate(anchor);
  }

  /** Computes every formula cell that has no computed value. */
  private settle(): void {
    // A read made while computing sees the values computed so far.
    if (this.settling || this.pending.size === 0) return;
    this.settling = true;
    try {
      const attempts = new Map<CellRecord, number>();
      for (const [next] of this.pending.entries()) {
        // Computing can add to `pending`, and a set's iterator visits entries added during the loop.
        if (this.pending.has(next)) this.compute(next, attempts);
      }
    } finally {
      this.settling = false;
    }
  }

  /**
   * Computes a formula cell and every uncomputed formula cell it depends on,
   * dependencies first, so evaluating one cell never recurses into another.
   */
  private compute(root: CellRecord, attempts: Map<CellRecord, number>): void {
    const { order, cyclic } = evaluationOrder(root, (record) => this.uncomputedPrecedents(record));
    const invalidationsBefore = this.invalidations;
    for (const record of order) {
      const isCyclic = cyclic.has(record);
      // An array placed earlier in this pass may have discarded a value this
      // cell reads. Leave the cell pending and compute it in a later pass.
      const disturbed = this.invalidations !== invalidationsBefore;
      if (disturbed && !isCyclic && this.uncomputedPrecedents(record).length > 0) continue;

      const tries = (attempts.get(record) ?? 0) + 1;
      attempts.set(record, tries);
      this.pending.delete(record);
      let value: CellValue;
      if (isCyclic)
        value =
          this.invalidControlTarget(record) ??
          error("#CYCLE!", "The formula depends on its own cell");
      else if (tries > MAX_ATTEMPTS) {
        value = error("#CYCLE!", "The formula and another keep changing each other's inputs");
      } else {
        value = this.evaluateRecord(record);
        // Placing this cell's array discarded this cell: it reads a cell it fills.
        if (this.pending.has(record)) {
          this.pending.delete(record);
          value = error("#CYCLE!", "The formula reads a cell that its own result would fill");
        }
      }
      this.cache.set(cellKey(record.id), value);
    }
  }

  private evaluateRecord(record: CellRecord): CellValue {
    if (record.content.type !== "formula") return this.current(record.id);
    const previous = this.evaluatingCell;
    this.evaluatingCell = record;
    try {
      const value = evaluate(record.content.ast, this.context(record.id));
      return isRange(value) ? this.place(record.id, value.rows) : value;
    } finally {
      this.evaluatingCell = previous;
    }
  }

  /**
   * Puts an array result into the cells below and to the right of its
   * formula, and returns what the formula's own cell shows: the first value,
   * or `#SPILL!` when a cell the array needs is taken or outside the table.
   */
  private place(anchor: CellId, rows: readonly CellValue[][]): CellValue {
    const rowCount = rows.length;
    const colCount = rows[0]?.length ?? 0;
    const targets = rows.flatMap((cells, rowOffset) =>
      cells.flatMap((value, colOffset) =>
        rowOffset === 0 && colOffset === 0
          ? []
          : [
              {
                id: { ...anchor, row: anchor.row + rowOffset, col: anchor.col + colOffset },
                value,
              },
            ],
      ),
    );
    const table = this.tables.table(anchor.tableId);
    const size = `${countWithUnit(rowCount, "row")} and ${countWithUnit(colCount, "column")}`;
    const outside = targets.some(
      ({ id }) =>
        id.row >= (table?.rowCount ?? Infinity) || id.col >= (table?.colCount ?? Infinity),
    );
    const taken = targets.find(
      ({ id }) => this.record(id) !== undefined || this.spilled.has(cellKey(id)),
    );
    if (outside) {
      this.blocked.set(cellKey(anchor), anchor);
      const rows =
        table?.rowCount === undefined
          ? "an unknown number of rows"
          : countWithUnit(table.rowCount, "row");
      const cols =
        table?.colCount === undefined
          ? "an unknown number of columns"
          : countWithUnit(table.colCount, "column");
      const spill = error(
        "#SPILL!",
        `The result needs ${size}, but the table is only ${rows} and ${cols}.`,
      );
      return table && !taken
        ? {
            ...spill,
            spill: {
              tableId: anchor.tableId,
              reason: "table-size",
              requiredRowCount: anchor.row + rowCount,
              requiredColumnCount: anchor.col + colCount,
            },
          }
        : spill;
    }

    if (taken) {
      this.blocked.set(cellKey(anchor), anchor);
      const range = `${formatAddress(anchor)}:${formatAddress({
        row: anchor.row + rowCount - 1,
        col: anchor.col + colCount - 1,
      })}`;
      return error(
        "#SPILL!",
        `The result needs ${size}, but one or more cells in ${range} already have values.`,
      );
    }

    for (const { id, value } of targets) this.spilled.set(cellKey(id), { anchor, value });
    if (targets.length > 0) {
      this.spillAreas.set(
        cellKey(anchor),
        targets.map(({ id }) => id),
      );
    }
    // Cells that read the filled cells were computed as if those were empty.
    for (const { id } of targets) this.invalidate(id);
    return rows[0]?.[0] ?? null;
  }

  private uncomputedPrecedents(record: CellRecord): CellRecord[] {
    return record.precedents
      .flatMap((range) => this.recordsIn(range))
      .filter(
        (precedent) =>
          precedent.content.type === "formula" && !this.cache.has(cellKey(precedent.id)),
      );
  }

  private recordsIn(range: CellRange): CellRecord[] {
    const records = this.cells.get(range.tableId);
    if (!records) return [];

    // A range with an open side stops where the table does, as it does when it
    // is read. Without that a whole column counts as larger than any table, and
    // every formula that reads one would walk all of the table's cells.
    const table = this.tables.table(range.tableId);
    const endRow = Math.min(range.endRow, (table?.rowCount ?? Infinity) - 1);
    const endCol = Math.min(range.endCol, (table?.colCount ?? Infinity) - 1);

    // A range such as A1:Z10000 is mostly empty, so walk whichever is smaller:
    // the range's coordinates or the table's stored cells.
    const area = (endRow - range.startRow + 1) * (endCol - range.startCol + 1);
    if (area > records.size) {
      return [...records.values()].filter((record) => rangeContains(range, record.id));
    }
    const found: CellRecord[] = [];
    for (let row = range.startRow; row <= endRow; row += 1) {
      for (let col = range.startCol; col <= endCol; col += 1) {
        const record = records.get(cellKey({ tableId: range.tableId, row, col }));
        if (record) found.push(record);
      }
    }
    return found;
  }
}

export function createWorkbook(data: WorkbookData, options?: WorkbookOptions): Workbook {
  const workbook = new Workbook(options);
  workbook.setStructure(data);
  for (const { input, ...id } of data.cells) workbook.setCell(id, input);
  return workbook;
}
