import { LIMITS, type CellInput, type StoredCell } from "@spreadsheet-app/shared";
import { and, asc, eq, gt, gte, inArray, lte, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { cells, pages, tables, views } from "../db/schema";
import { notFound, unprocessable } from "../errors";
import type { PageRecord, TableRecord, ViewRecord } from "./spreadsheets";

export interface JournalData {
  pages: { id: string; before: PageRecord | null; after: PageRecord | null }[];
  tables: { id: string; before: TableRecord | null; after: TableRecord | null }[];
  views: { id: string; before: ViewRecord | null; after: ViewRecord | null }[];
  cells: { tableId: string; changes: [number, number, string, string][] }[];
}

export interface ChangedContent {
  pages: { id: string; page: PageRecord | null }[];
  tables: { id: string; table: TableRecord | null }[];
  views: { id: string; view: ViewRecord | null }[];
  cells: StoredCell[];
}

export class UndoRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UndoRefusal";
  }
}

interface RecordedItem<T> {
  id: string;
  before: T | null;
  after: T | null;
}

interface CellState {
  tableId: string;
  row: number;
  col: number;
  before: string;
  after: string;
}

const pageColumns = { id: pages.id, name: pages.name, position: pages.position };
const tableColumns = {
  id: tables.id,
  pageId: tables.pageId,
  name: tables.name,
  position: tables.position,
  rowCount: tables.rowCount,
  colCount: tables.colCount,
  columns: tables.columns,
  formats: tables.formats,
};
const viewColumns = {
  id: views.id,
  pageId: views.pageId,
  kind: views.kind,
  name: views.name,
  position: views.position,
  source: views.source,
  chartType: views.chartType,
};

/** A statement binds a few parameters per cell, and Postgres accepts 65535. */
const BATCH = 5000;
/**
 * Up to this many cells of a table are read by address. More are read as the
 * rectangle that holds them: a condition per cell takes the database seconds
 * to plan once there are thousands, and a change that large is a paste, a
 * fill, or cells moved by a row or column, which fill their rectangle.
 */
const READ_BY_ADDRESS = 100;

const addressKey = ({ row, col }: Pick<CellInput, "row" | "col">): string =>
  `${String(row)}:${String(col)}`;

/** The stored inputs of cells of one table, keyed by `row:col`. A cell that holds nothing has no entry. */
export async function readInputs(
  db: Database,
  tableId: string,
  addresses: readonly Pick<CellInput, "row" | "col">[],
): Promise<{ get(address: Pick<CellInput, "row" | "col">): string }> {
  const inputs = new Map<string, string>();
  if (addresses.length > 0) {
    const rows = addresses.map(({ row }) => row);
    const cols = addresses.map(({ col }) => col);
    // Spread arguments have a limit that a full table of addresses passes.
    const least = (values: number[]): number => values.reduce((a, b) => Math.min(a, b));
    const most = (values: number[]): number => values.reduce((a, b) => Math.max(a, b));
    const wanted =
      addresses.length <= READ_BY_ADDRESS
        ? or(...addresses.map(({ row, col }) => and(eq(cells.row, row), eq(cells.col, col))))
        : and(
            gte(cells.row, least(rows)),
            lte(cells.row, most(rows)),
            gte(cells.col, least(cols)),
            lte(cells.col, most(cols)),
          );
    const found = await db
      .select({ row: cells.row, col: cells.col, input: cells.input })
      .from(cells)
      .where(and(eq(cells.tableId, tableId), wanted));
    for (const cell of found) inputs.set(addressKey(cell), cell.input);
  }
  return { get: (address) => inputs.get(addressKey(address)) ?? "" };
}

/** Stores cell inputs, each cell given once. An empty input deletes the cell. */
async function storeCells(
  db: Database,
  userId: string,
  inputs: readonly StoredCell[],
): Promise<void> {
  const filled = inputs.filter((cell) => cell.input !== "");
  for (let start = 0; start < filled.length; start += BATCH) {
    await db
      .insert(cells)
      .values(filled.slice(start, start + BATCH).map((cell) => ({ ...cell, updatedBy: userId })))
      .onConflictDoUpdate({
        target: [cells.tableId, cells.row, cells.col],
        set: {
          input: sql`excluded.input`,
          updatedBy: sql`excluded.updated_by`,
          updatedAt: sql`now()`,
        },
      });
  }
  const cleared = inputs.filter((cell) => cell.input === "");
  for (let start = 0; start < cleared.length; start += BATCH) {
    const targets = cleared
      .slice(start, start + BATCH)
      .map((cell) =>
        and(eq(cells.tableId, cell.tableId), eq(cells.row, cell.row), eq(cells.col, cell.col)),
      );
    await db.delete(cells).where(or(...targets));
  }
}

/**
 * Writes spreadsheet content and remembers its first and final states for
 * undo. Repeated writes to one row, view, or cell stay one recorded change.
 */
export class ContentWriter {
  private readonly pageChanges = new Map<string, RecordedItem<PageRecord>>();
  private readonly tableChanges = new Map<string, RecordedItem<TableRecord>>();
  private readonly viewChanges = new Map<string, RecordedItem<ViewRecord>>();
  private readonly cellChanges = new Map<string, CellState>();
  private estimatedBytes = 0;
  private tooLarge = false;
  private rewrites = false;
  private changeLabel = "Change";

  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly entryLimit = LIMITS.journalEntryBytes,
  ) {}

  setLabel(label: string): void {
    this.changeLabel = label;
  }

  markRewrites(): void {
    this.rewrites = true;
  }

  get label(): string {
    return this.changeLabel;
  }

  get rewroteReferences(): boolean {
    return this.rewrites;
  }

  hasChanges(): boolean {
    return (
      this.tooLarge ||
      this.pageChanges.size +
        this.tableChanges.size +
        this.viewChanges.size +
        this.cellChanges.size >
        0
    );
  }

  /** The final state, or `null` when this change exceeded the history limit. */
  recorded(): { data: JournalData | null; bytes: number } | undefined {
    if (!this.hasChanges()) return undefined;
    if (this.tooLarge) return { data: null, bytes: 0 };
    const data = this.data();
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > this.entryLimit) {
      this.discard();
      return { data: null, bytes: 0 };
    }
    return { data, bytes };
  }

  async insertPage(values: typeof pages.$inferInsert): Promise<PageRecord> {
    const [inserted] = await this.db.insert(pages).values(values).returning(pageColumns);
    if (!inserted) throw new Error("Insert returned no page");
    this.recordItem(this.pageChanges, inserted.id, null, inserted);
    return inserted;
  }

  async updatePage(
    pageId: string,
    changes: Partial<typeof pages.$inferInsert>,
  ): Promise<PageRecord> {
    const before = await this.findPage(pageId);
    const [updated] = await this.db
      .update(pages)
      .set(changes)
      .where(eq(pages.id, pageId))
      .returning(pageColumns);
    if (!updated) throw notFound("Page");
    this.recordItem(this.pageChanges, pageId, before, updated);
    return updated;
  }

  async deletePage(pageId: string): Promise<void> {
    const before = await this.findPage(pageId);
    const pageTables = await this.db
      .select({ id: tables.id })
      .from(tables)
      .where(eq(tables.pageId, pageId));
    const pageViews = await this.db
      .select({ id: views.id })
      .from(views)
      .where(eq(views.pageId, pageId));
    for (const table of pageTables) await this.deleteTable(table.id);
    for (const view of pageViews) await this.deleteView(view.id);
    await this.db.delete(pages).where(eq(pages.id, pageId));
    this.recordItem(this.pageChanges, pageId, before, null);
  }

  async insertTable(values: typeof tables.$inferInsert): Promise<TableRecord> {
    this.checkColumns(values.columns);
    const [inserted] = await this.db.insert(tables).values(values).returning(tableColumns);
    if (!inserted) throw new Error("Insert returned no table");
    await this.checkRowCount(inserted.pageId);
    this.recordItem(this.tableChanges, inserted.id, null, inserted);
    return inserted;
  }

  async updateTable(
    tableId: string,
    changes: Partial<typeof tables.$inferInsert>,
  ): Promise<TableRecord> {
    this.checkColumns(changes.columns);
    const before = await this.findTable(tableId);
    const [updated] = await this.db
      .update(tables)
      .set(changes)
      .where(eq(tables.id, tableId))
      .returning(tableColumns);
    if (!updated) throw notFound("Table");
    if (updated.rowCount > before.rowCount) await this.checkRowCount(updated.pageId);
    this.recordItem(this.tableChanges, tableId, before, updated);
    return updated;
  }

  async deleteTable(tableId: string): Promise<void> {
    const before = await this.findTable(tableId);
    await this.clearCells(tableId, sql`true`);
    await this.db.delete(tables).where(eq(tables.id, tableId));
    this.recordItem(this.tableChanges, tableId, before, null);
  }

  async insertView(values: typeof views.$inferInsert): Promise<ViewRecord> {
    this.checkViewSource(values.source);
    const [inserted] = await this.db.insert(views).values(values).returning(viewColumns);
    if (!inserted) throw new Error("Insert returned no view");
    this.recordItem(this.viewChanges, inserted.id, null, inserted);
    return inserted;
  }

  async updateView(
    viewId: string,
    changes: Partial<typeof views.$inferInsert>,
  ): Promise<ViewRecord> {
    if (changes.source !== undefined) this.checkViewSource(changes.source);
    const before = await this.findView(viewId);
    const [updated] = await this.db
      .update(views)
      .set(changes)
      .where(eq(views.id, viewId))
      .returning(viewColumns);
    if (!updated) throw notFound("View");
    this.recordItem(this.viewChanges, viewId, before, updated);
    return updated;
  }

  async deleteView(viewId: string): Promise<void> {
    const before = await this.findView(viewId);
    await this.db.delete(views).where(eq(views.id, viewId));
    this.recordItem(this.viewChanges, viewId, before, null);
  }

  /** Stores cell inputs. An empty input deletes the cell. Later entries win. */
  async setCells(inputs: readonly StoredCell[]): Promise<void> {
    const latest = [...new Map(inputs.map((cell) => [this.cellKey(cell), cell])).values()];
    for (const cell of latest) this.checkCellInput(cell.input);
    for (const [tableId, written] of Map.groupBy(latest, (cell) => cell.tableId)) {
      const before = await readInputs(this.db, tableId, written);
      await storeCells(this.db, this.userId, written);
      for (const cell of written) {
        this.recordCell(tableId, cell.row, cell.col, before.get(cell), cell.input);
      }
    }
  }

  /** Clears cells matching `where`, retaining their inputs for undo. */
  async clearCells(tableId: string, where: SQL): Promise<void> {
    // Read in address order, a batch at a time, and no further once the change is too large to keep.
    let last: { row: number; col: number } | undefined;
    while (!this.tooLarge) {
      const found = await this.db
        .select({ row: cells.row, col: cells.col, input: cells.input })
        .from(cells)
        .where(
          and(
            eq(cells.tableId, tableId),
            where,
            last &&
              or(gt(cells.row, last.row), and(eq(cells.row, last.row), gt(cells.col, last.col))),
          ),
        )
        .orderBy(asc(cells.row), asc(cells.col))
        .limit(BATCH);
      for (const cell of found) this.recordCell(tableId, cell.row, cell.col, cell.input, "");
      last = found.at(-1);
      if (found.length < BATCH) break;
    }
    await this.db.delete(cells).where(and(eq(cells.tableId, tableId), where));
  }

  private async findPage(pageId: string): Promise<PageRecord> {
    const [found] = await this.db
      .select(pageColumns)
      .from(pages)
      .where(eq(pages.id, pageId))
      .limit(1);
    if (!found) throw notFound("Page");
    return found;
  }

  /** Runs after a row addition, inside the caller's spreadsheet transaction. */
  private async checkRowCount(pageId: string): Promise<void> {
    const [page] = await this.db
      .select({ spreadsheetId: pages.spreadsheetId })
      .from(pages)
      .where(eq(pages.id, pageId));
    if (!page) throw notFound("Page");
    const [counted] = await this.db
      .select({ rows: sql<number>`coalesce(sum(${tables.rowCount}), 0)`.mapWith(Number) })
      .from(tables)
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(eq(pages.spreadsheetId, page.spreadsheetId));
    if ((counted?.rows ?? 0) > LIMITS.spreadsheetRows) {
      throw unprocessable(
        "too_many_rows",
        `A spreadsheet can have at most ${String(LIMITS.spreadsheetRows)} rows`,
      );
    }
  }

  private async findTable(tableId: string): Promise<TableRecord> {
    const [found] = await this.db
      .select(tableColumns)
      .from(tables)
      .where(eq(tables.id, tableId))
      .limit(1);
    if (!found) throw notFound("Table");
    return found;
  }

  private async findView(viewId: string): Promise<ViewRecord> {
    const [found] = await this.db
      .select(viewColumns)
      .from(views)
      .where(eq(views.id, viewId))
      .limit(1);
    if (!found) throw notFound("View");
    return found;
  }

  private recordItem<T>(
    collection: Map<string, RecordedItem<T>>,
    id: string,
    before: T | null,
    after: T | null,
  ): void {
    if (this.tooLarge) return;
    const previous = collection.get(id);
    const original = previous ? previous.before : before;
    const wasChanged = previous !== undefined;
    const nextChanged = !this.same(original, after);
    if (wasChanged) this.estimatedBytes -= this.recordSize(previous) + 1;
    if (nextChanged) {
      const next = { id, before: original, after };
      collection.set(id, next);
      this.estimatedBytes += this.recordSize(next) + 1;
    } else {
      collection.delete(id);
    }
    this.checkEstimatedSize();
  }

  private recordCell(
    tableId: string,
    row: number,
    col: number,
    before: string,
    after: string,
  ): void {
    if (this.tooLarge) return;
    const key = `${tableId}\u0000${String(row)}\u0000${String(col)}`;
    const previous = this.cellChanges.get(key);
    const original = previous ? previous.before : before;
    if (previous) this.estimatedBytes -= this.cellSize(previous) + 1;
    if (original !== after) {
      const next = { tableId, row, col, before: original, after };
      this.cellChanges.set(key, next);
      this.estimatedBytes += this.cellSize(next) + 1;
    } else {
      this.cellChanges.delete(key);
    }
    this.checkEstimatedSize();
  }

  private cellKey(cell: Pick<CellInput, "row" | "col"> & { tableId: string }): string {
    return `${cell.tableId}\u0000${String(cell.row)}\u0000${String(cell.col)}`;
  }

  private recordSize<T>(record: RecordedItem<T>): number {
    return Buffer.byteLength(JSON.stringify(record));
  }

  private cellSize(cell: CellState): number {
    return Buffer.byteLength(JSON.stringify([cell.row, cell.col, cell.before, cell.after]));
  }

  private same<T>(left: T | null, right: T | null): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private checkEstimatedSize(): void {
    if (this.estimatedBytes > this.entryLimit) this.discard();
  }

  private discard(): void {
    this.tooLarge = true;
    this.pageChanges.clear();
    this.tableChanges.clear();
    this.viewChanges.clear();
    this.cellChanges.clear();
    this.estimatedBytes = 0;
  }

  private checkCellInput(input: string): void {
    if (input.length > LIMITS.inputLength) {
      throw unprocessable(
        "input_too_long",
        `A cell input can have at most ${String(LIMITS.inputLength)} characters`,
      );
    }
  }

  private checkColumns(columns: typeof tables.$inferInsert.columns): void {
    if (!columns) return;
    for (const column of columns) {
      if (column.type === "formula" && (column.formula?.length ?? 0) > LIMITS.inputLength) {
        throw unprocessable(
          "input_too_long",
          `A formula can have at most ${String(LIMITS.inputLength)} characters`,
        );
      }
    }
  }

  private checkViewSource(source: string | null | undefined): void {
    if (source !== null && source !== undefined && source.length > LIMITS.viewSourceLength) {
      throw unprocessable(
        "view_source_too_long",
        `A view source can have at most ${String(LIMITS.viewSourceLength)} characters`,
      );
    }
  }

  private data(): JournalData {
    const groupedCells = new Map<string, [number, number, string, string][]>();
    for (const cell of this.cellChanges.values()) {
      const changes = groupedCells.get(cell.tableId) ?? [];
      changes.push([cell.row, cell.col, cell.before, cell.after]);
      groupedCells.set(cell.tableId, changes);
    }
    return {
      pages: [...this.pageChanges.values()],
      tables: [...this.tableChanges.values()],
      views: [...this.viewChanges.values()],
      cells: [...groupedCells].map(([tableId, changes]) => ({ tableId, changes })),
    };
  }
}

/**
 * Whether two recorded changes wrote the same page, table, view, or cell.
 * `step` is the smaller of the two: its items are indexed and the other's are
 * looked up among them.
 */
export function touchSame(step: JournalData, other: JournalData): boolean {
  const cell = (tableId: string, row: number, col: number): string =>
    `${tableId}:${String(row)}:${String(col)}`;
  const items = new Set([...step.pages, ...step.tables, ...step.views].map(({ id }) => id));
  const cells = new Set(
    step.cells.flatMap(({ tableId, changes }) =>
      changes.map(([row, col]) => cell(tableId, row, col)),
    ),
  );
  return (
    [...other.pages, ...other.tables, ...other.views].some(({ id }) => items.has(id)) ||
    other.cells.some(({ tableId, changes }) =>
      changes.some(([row, col]) => cells.has(cell(tableId, row, col))),
    )
  );
}

/** Applies a recorded state without making another journal entry. */
export async function applyRecorded(
  db: Database,
  spreadsheetId: string,
  userId: string,
  data: JournalData,
  direction: "undo" | "redo",
): Promise<ChangedContent> {
  const target = <T>(before: T, after: T): T => (direction === "undo" ? before : after);
  const changed: ChangedContent = {
    pages: data.pages.map(({ id, before, after }) => ({ id, page: target(before, after) })),
    tables: data.tables.map(({ id, before, after }) => ({ id, table: target(before, after) })),
    views: data.views.map(({ id, before, after }) => ({ id, view: target(before, after) })),
    cells: data.cells.flatMap(({ tableId, changes }) =>
      changes.map(([row, col, before, after]) => ({
        tableId,
        row,
        col,
        input: target(before, after),
      })),
    ),
  };

  const removedViews = changed.views.filter(({ view }) => view === null).map(({ id }) => id);
  if (removedViews.length > 0) await db.delete(views).where(inArray(views.id, removedViews));
  const removedTables = changed.tables.filter(({ table }) => table === null).map(({ id }) => id);
  if (removedTables.length > 0) await db.delete(tables).where(inArray(tables.id, removedTables));
  const removedPages = changed.pages.filter(({ page }) => page === null).map(({ id }) => id);
  if (removedPages.length > 0) await db.delete(pages).where(inArray(pages.id, removedPages));

  for (const { page } of changed.pages) {
    if (!page) continue;
    await db
      .insert(pages)
      .values({ spreadsheetId, ...page })
      .onConflictDoUpdate({
        target: pages.id,
        set: { spreadsheetId, name: page.name, position: page.position },
      });
  }
  for (const { table } of changed.tables) {
    if (!table) continue;
    await db
      .insert(tables)
      .values(table)
      .onConflictDoUpdate({
        target: tables.id,
        set: {
          pageId: table.pageId,
          name: table.name,
          position: table.position,
          rowCount: table.rowCount,
          colCount: table.colCount,
          columns: table.columns,
          formats: table.formats,
        },
      });
  }
  for (const { view } of changed.views) {
    if (!view) continue;
    await db
      .insert(views)
      .values(view)
      .onConflictDoUpdate({
        target: views.id,
        set: {
          pageId: view.pageId,
          kind: view.kind,
          name: view.name,
          position: view.position,
          source: view.source,
          chartType: view.chartType,
        },
      });
  }
  await storeCells(db, userId, changed.cells);
  return changed;
}
