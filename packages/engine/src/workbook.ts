import { cellKey, rangeContains, type CellId, type CellRange } from "./address";
import type { Node, Reference } from "./ast";
import type { Effect } from "./effects";
import { evaluate, referencesOf, type EvaluationContext } from "./evaluate";
import { defaultFunctions } from "./functions";
import type { FunctionRegistry } from "./functions/registry";
import { DependencyIndex, evaluationOrder } from "./graph";
import { parseFormula } from "./parser";
import { FormulaSyntaxError } from "./tokenizer";
import {
  error,
  isError,
  isFormulaInput,
  isRange,
  parseLiteralInput,
  type ActionValue,
  type CellValue,
  type ErrorValue,
  type Scalar,
} from "./values";

export interface PageDefinition {
  id: string;
  name: string;
}

export interface TableDefinition {
  id: string;
  pageId: string;
  name: string;
}

export interface WorkbookStructure {
  pages: readonly PageDefinition[];
  tables: readonly TableDefinition[];
}

/** Everything needed to build a workbook: its structure and the non-empty cells. */
export interface WorkbookData extends WorkbookStructure {
  cells: readonly (CellId & { input: string })[];
}

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

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The cells of one spreadsheet and their computed values.
 *
 * Values are computed on demand and cached. Changing a cell discards the
 * cached values of the cells that depend on it, so the next read recomputes
 * only those. Computing never has side effects: action formulas evaluate to
 * descriptions, which `planAction` turns into effects for the caller to apply.
 */
export class Workbook {
  private pages: readonly PageDefinition[] = [];
  private readonly tables = new Map<string, TableDefinition>();
  private readonly cells = new Map<string, Map<string, CellRecord>>();
  /** Computed values of formula cells. */
  private readonly cache = new Map<string, CellValue>();
  private readonly dependencies = new DependencyIndex();

  constructor(private readonly functions: FunctionRegistry = defaultFunctions) {}

  /**
   * Replaces the pages and tables. Cells of tables that still exist are kept.
   * References are matched to tables by name, so every formula is re-resolved.
   */
  setStructure({ pages, tables }: WorkbookStructure): void {
    this.pages = pages;
    this.tables.clear();
    for (const table of tables) {
      this.tables.set(table.id, table);
      if (!this.cells.has(table.id)) this.cells.set(table.id, new Map());
    }
    for (const tableId of this.cells.keys()) {
      if (!this.tables.has(tableId)) this.cells.delete(tableId);
    }

    this.cache.clear();
    this.dependencies.clear();
    for (const records of this.cells.values()) {
      for (const record of records.values()) this.index(record);
    }
  }

  /** Sets what the user typed into a cell. An empty input clears the cell. */
  setCell(id: CellId, input: string): void {
    const records = this.cells.get(id.tableId);
    if (!records) throw new Error(`Unknown table ${id.tableId}`);

    const key = cellKey(id);
    if (input === "") {
      records.delete(key);
      this.dependencies.remove(id);
    } else {
      const record: CellRecord = { id, input, content: parseContent(input), precedents: [] };
      records.set(key, record);
      this.index(record);
    }

    this.cache.delete(key);
    for (const dependent of this.dependencies.transitiveDependents(id)) {
      this.cache.delete(cellKey(dependent));
    }
  }

  getInput(id: CellId): string {
    return this.record(id)?.input ?? "";
  }

  getValue(id: CellId): CellValue {
    const record = this.record(id);
    if (!record) return null;
    switch (record.content.type) {
      case "literal":
        return record.content.value;
      case "invalid":
        return record.content.error;
      case "formula":
        return this.cache.get(cellKey(id)) ?? this.compute(record);
    }
  }

  /**
   * Turns an action into the effects it asks for, using current cell values.
   * Nothing is applied: the caller decides whether and how to carry them out.
   */
  planAction(action: ActionValue): ActionPlan {
    const definition = this.functions.get(action.name);
    if (definition?.kind !== "action") {
      return { ok: false, error: error("#NAME?", `Unknown action ${action.name}`) };
    }
    const context = this.context(action.origin);
    const result = definition.plan(action.args, {
      origin: action.origin,
      evaluate: (node) => evaluate(node, context),
      resolve: (reference) => context.resolve(reference),
    });
    return isError(result) ? { ok: false, error: result } : { ok: true, effects: result };
  }

  private record(id: CellId): CellRecord | undefined {
    return this.cells.get(id.tableId)?.get(cellKey(id));
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
    const table = this.findTable(reference, originTableId);
    if (!table) return undefined;
    const { start, end = start } = reference;
    return {
      tableId: table.id,
      startRow: Math.min(start.row, end.row),
      startCol: Math.min(start.col, end.col),
      endRow: Math.max(start.row, end.row),
      endCol: Math.max(start.col, end.col),
    };
  }

  private findTable(reference: Reference, originTableId: string): TableDefinition | undefined {
    const origin = this.tables.get(originTableId);
    const tableName = reference.table;
    if (tableName === undefined) return origin;

    const pageName = reference.page;
    const pageId =
      pageName === undefined
        ? origin?.pageId
        : this.pages.find((page) => sameName(page.name, pageName))?.id;
    return [...this.tables.values()].find(
      (table) => table.pageId === pageId && sameName(table.name, tableName),
    );
  }

  private context(origin: CellId): EvaluationContext {
    return {
      origin,
      functions: this.functions,
      resolve: (reference) => this.resolve(reference, origin.tableId),
      read: (cell) => this.getValue(cell),
    };
  }

  /**
   * Computes a formula cell and every uncomputed formula cell it depends on,
   * dependencies first, so evaluating one cell never recurses into another.
   */
  private compute(root: CellRecord): CellValue {
    const { order, cyclic } = evaluationOrder(root, (record) => this.uncomputedPrecedents(record));
    for (const record of order) {
      const value = cyclic.has(record)
        ? error("#CYCLE!", "The formula depends on its own cell")
        : this.evaluateRecord(record);
      this.cache.set(cellKey(record.id), value);
    }
    return this.cache.get(cellKey(root.id)) ?? null;
  }

  private evaluateRecord(record: CellRecord): CellValue {
    if (record.content.type !== "formula") return this.getValue(record.id);
    const value = evaluate(record.content.ast, this.context(record.id));
    return isRange(value) ? error("#VALUE!", "A cell cannot hold a range") : value;
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
