import { cellKey, formatAddress, rangeContains, type CellId, type CellRange } from "./address";
import type { Node, Reference } from "./ast";
import type { Effect } from "./effects";
import { evaluate, referencesOf, type EvaluationContext } from "./evaluate";
import { defaultFunctions } from "./functions";
import { fail, Failure } from "./functions/arguments";
import type { FunctionRegistry } from "./functions/registry";
import { DependencyIndex, evaluationOrder } from "./graph";
import { parseFormula } from "./parser";
import { TableResolver, type WorkbookData, type WorkbookStructure } from "./structure";
import { FormulaSyntaxError } from "./tokenizer";
import {
  compare,
  error,
  isFormulaInput,
  literalInput,
  toText,
  type ControlValue,
  isRange,
  parseLiteralInput,
  type ActionValue,
  type CellValue,
  type ErrorValue,
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
  /** The ranges the formula reads during recalculation. Empty for non-formulas. */
  precedents: CellRange[];
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

// How many times one settling pass may recompute a cell before its value is
// declared a cycle. Array results that fill each other's inputs can undo one
// another forever, and this is what stops them.
const MAX_ATTEMPTS = 20;

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
  private readonly dependencies = new DependencyIndex();

  /** The values an array formula placed in other cells, keyed by the cell each landed in. */
  private readonly spilled = new Map<string, { anchor: CellId; value: CellValue }>();
  /** The cells each array formula filled, keyed by the formula's own cell. */
  private readonly spillAreas = new Map<string, CellId[]>();
  /** Array formulas whose result did not fit. A change to their table may make room. */
  private readonly blocked = new Map<string, CellId>();

  private settling = false;
  /** Counts calls to `invalidate`, so a computing pass can tell that one happened under it. */
  private invalidations = 0;

  constructor(private readonly functions: FunctionRegistry = defaultFunctions) {}

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
      if (!this.tables.table(tableId)) this.cells.delete(tableId);
    }

    this.cache.clear();
    this.pending.clear();
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

  /** Sets what the user typed into a cell. An empty input clears the cell. */
  setCell(id: CellId, input: string): void {
    const records = this.cells.get(id.tableId);
    if (!records) throw new Error(`Unknown table ${id.tableId}`);

    const key = cellKey(id);
    const replaced = records.get(key);
    if (replaced) this.pending.delete(replaced);
    if (input === "") {
      records.delete(key);
      this.dependencies.remove(id);
    } else {
      const record: CellRecord = { id, input, content: parseContent(input), precedents: [] };
      records.set(key, record);
      this.index(record);
    }

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
    if (control.control === "checkbox" && typeof value !== "boolean") {
      return refuse("A checkbox takes TRUE or FALSE");
    }
    const isChoice = control.options.some(
      (option) => typeof option === typeof value && compare(option, value) === 0,
    );
    if (control.control === "dropdown" && value !== null && !isChoice) {
      return refuse(`${toText(value)} is not one of the choices`);
    }
    return {
      ok: true,
      effects: [{ type: "setCell", ...control.target, input: literalInput(value) }],
    };
  }

  /** The effects an action asks for. Throws `Failure` when the action cannot run. */
  private effectsOf(action: ActionValue): Effect[] {
    const definition = this.functions.get(action.name);
    if (definition?.kind !== "action") fail("#NAME?", `Unknown action ${action.name}`);
    const context = this.context(action.origin);
    return definition.plan(action.args, {
      origin: action.origin,
      evaluate: (node) => evaluate(node, context),
      resolve: (reference) => context.resolve(reference),
      inputsIn: (range) => this.recordsIn(range).map((record) => record.id),
      plan: (inner) => this.effectsOf(inner),
    });
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

  /** Resolves a record's references and registers them with the dependency index. */
  private index(record: CellRecord): void {
    record.precedents =
      record.content.type === "formula"
        ? referencesOf(record.content.ast, this.functions)
            .map((reference) => this.resolve(reference, record.id.tableId))
            .filter((range) => range !== undefined)
        : [];
    this.dependencies.set(record.id, record.precedents);
  }

  private resolve(reference: Reference, originTableId: string): CellRange | undefined {
    const table = this.tables.find(reference, originTableId);
    if (!table) return undefined;
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

  private context(origin: CellId): EvaluationContext {
    return {
      origin,
      functions: this.functions,
      resolve: (reference) => this.resolve(reference, origin.tableId),
      read: (cell) => this.current(cell),
      extent: (tableId) => this.extent(tableId),
    };
  }

  /**
   * Discards the computed value of a cell and of every cell that depends on
   * it. Discarding an array formula empties the cells it filled, so their
   * readers are discarded too.
   */
  private invalidate(start: CellId): void {
    this.invalidations += 1;
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
      if (isCyclic) value = error("#CYCLE!", "The formula depends on its own cell");
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
    const value = evaluate(record.content.ast, this.context(record.id));
    return isRange(value) ? this.place(record.id, value.rows) : value;
  }

  /**
   * Puts an array result into the cells below and to the right of its
   * formula, and returns what the formula's own cell shows: the first value,
   * or `#SPILL!` when a cell the array needs is taken or outside the table.
   */
  private place(anchor: CellId, rows: readonly CellValue[][]): CellValue {
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
    const taken = targets.find(
      ({ id }) =>
        this.record(id) !== undefined ||
        this.spilled.has(cellKey(id)) ||
        id.row >= (table?.rowCount ?? Infinity) ||
        id.col >= (table?.colCount ?? Infinity),
    );
    if (taken) {
      this.blocked.set(cellKey(anchor), anchor);
      const size = `${String(rows.length)} rows and ${String(rows[0]?.length ?? 0)} columns`;
      return error(
        "#SPILL!",
        `The result needs ${size}, and ${formatAddress(taken.id)} is not free`,
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

    // A range such as A1:Z10000 is mostly empty, so walk whichever is smaller:
    // the range's coordinates or the table's stored cells.
    const area = (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
    if (area > records.size) {
      return [...records.values()].filter((record) => rangeContains(range, record.id));
    }
    const found: CellRecord[] = [];
    for (let row = range.startRow; row <= range.endRow; row += 1) {
      for (let col = range.startCol; col <= range.endCol; col += 1) {
        const record = records.get(cellKey({ tableId: range.tableId, row, col }));
        if (record) found.push(record);
      }
    }
    return found;
  }
}

export function createWorkbook(data: WorkbookData, functions?: FunctionRegistry): Workbook {
  const workbook = new Workbook(functions);
  workbook.setStructure(data);
  for (const { input, ...id } of data.cells) workbook.setCell(id, input);
  return workbook;
}
