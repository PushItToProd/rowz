import { randomUUID } from "node:crypto";
import { isFormulaInput } from "@spreadsheet-app/engine";
import {
  LIMITS,
  keysAfter,
  keyBetween,
  rebalanceKeys,
  MAX_ORDER_KEY_LENGTH,
  type CellIdentity,
  type RowRecord,
  type StoredCell,
} from "@spreadsheet-app/shared";
import { and, asc, eq, gt, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Database } from "../db/client";
import { cells, deletedRows, pages, tables, tableRows, journal, views } from "../db/schema";
import { notFound, unprocessable } from "../errors";
import type { PageRecord, TableRecord, ViewRecord } from "./spreadsheets";

/** A row as a change left it or found it: its id, with its order key or `null` for no row. */
type RowChange = [rowId: string, before: string | null, after: string | null];
type CellChange = [rowId: string, colId: string, before: string, after: string];

/**
 * What one change wrote, as it was before and after. Rows, columns, and cells
 * are named by id, so an entry means the same cells whatever was inserted or
 * deleted around them since.
 */
export interface JournalData {
  rows: { tableId: string; changes: RowChange[] }[];
  pages: { id: string; before: PageRecord | null; after: PageRecord | null }[];
  tables: { id: string; before: TableRecord | null; after: TableRecord | null }[];
  views: { id: string; before: ViewRecord | null; after: ViewRecord | null }[];
  cells: { tableId: string; changes: CellChange[] }[];
}

/** The state a change left each thing it wrote in. `null` marks something deleted. */
export interface ChangedContent {
  pages: { id: string; page: PageRecord | null }[];
  tables: { id: string; table: TableRecord | null }[];
  views: { id: string; view: ViewRecord | null }[];
  rows: { id: string; tableId: string; orderKey: string | null }[];
  /** An empty input means the cell is now empty. */
  cells: StoredCell[];
}

/**
 * A change to what a spreadsheet holds, as it is sent to the session that made
 * it and announced to the others. `changed` is `null` for a change too large
 * to describe, after which a session reads the spreadsheet again.
 */
export interface Change {
  revision: number;
  changed: ChangedContent | null;
}

/** A change that writes more cells than this is announced without its content. */
export const MAX_ANNOUNCED_CELLS = 1000;

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

interface RowState {
  tableId: string;
  id: string;
  before: string | null;
  after: string | null;
}

interface CellState extends StoredCell {
  before: string;
}

const pageColumns = { id: pages.id, name: pages.name, position: pages.position };
const tableColumns = {
  id: tables.id,
  pageId: tables.pageId,
  name: tables.name,
  position: tables.position,
  colIds: tables.colIds,
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
 * rows that hold them: a condition per cell takes the database seconds to
 * plan once there are thousands, and a change that large is a paste or a
 * fill, which fills its rows.
 */
const READ_BY_ADDRESS = 100;

const addressKey = ({ rowId, colId }: CellIdentity): string => `${rowId}:${colId}`;

/** The stored inputs of cells of one table. A cell that holds nothing reads as empty. */
export async function readInputs(
  db: Database,
  tableId: string,
  addresses: readonly CellIdentity[],
): Promise<{ get(address: CellIdentity): string }> {
  const inputs = new Map<string, string>();
  if (addresses.length > 0) {
    const wanted =
      addresses.length <= READ_BY_ADDRESS
        ? or(
            ...addresses.map(({ rowId, colId }) =>
              and(eq(cells.rowId, rowId), eq(cells.colId, colId)),
            ),
          )
        : inArray(cells.rowId, [...new Set(addresses.map(({ rowId }) => rowId))]);
    const found = await db
      .select({ rowId: cells.rowId, colId: cells.colId, input: cells.input })
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
        target: [cells.rowId, cells.colId],
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
      .map((cell) => and(eq(cells.rowId, cell.rowId), eq(cells.colId, cell.colId)));
    await db.delete(cells).where(or(...targets));
  }
}

/** The rows of a table, first to last. */
export async function orderedRows(db: Database, tableId: string): Promise<RowRecord[]> {
  return db
    .select()
    .from(tableRows)
    .where(eq(tableRows.tableId, tableId))
    .orderBy(asc(tableRows.orderKey));
}

/** How many rows the tables of a spreadsheet hold together. */
export async function countRows(db: Database, spreadsheetId: string): Promise<number> {
  const [counted] = await db
    .select({ rows: sql<number>`count(*)`.mapWith(Number) })
    .from(tableRows)
    .innerJoin(tables, eq(tables.id, tableRows.tableId))
    .innerJoin(pages, eq(pages.id, tables.pageId))
    .where(eq(pages.spreadsheetId, spreadsheetId));
  return counted?.rows ?? 0;
}

/** Notes rows as deleted, or as existing again, for `setCells` to refuse or accept their ids. */
async function markDeleted(
  db: Database,
  spreadsheetId: string,
  rowIds: readonly string[],
  deleted: boolean,
): Promise<void> {
  for (let start = 0; start < rowIds.length; start += BATCH) {
    const batch = rowIds.slice(start, start + BATCH);
    if (deleted) {
      await db
        .insert(deletedRows)
        .values(batch.map((rowId) => ({ rowId, spreadsheetId })))
        .onConflictDoNothing();
    } else {
      await db.delete(deletedRows).where(inArray(deletedRows.rowId, batch));
    }
  }
}

/** A table's values as a caller gives them. Its rows and column ids are made here. */
type NewTable = Omit<typeof tables.$inferInsert, "colIds">;

/**
 * Writes spreadsheet content and remembers its first and final states for
 * undo. Repeated writes to one row, view, or cell stay one recorded change.
 * Every write to the rows and cells of a table goes through here, so this is
 * where the limits on rows, and the rule that a cell's column belongs to its
 * table, are kept.
 */
export class ContentWriter {
  private readonly rowChanges = new Map<string, RowState>();
  private readonly pageChanges = new Map<string, RecordedItem<PageRecord>>();
  private readonly tableChanges = new Map<string, RecordedItem<TableRecord>>();
  private readonly viewChanges = new Map<string, RecordedItem<ViewRecord>>();
  private readonly cellChanges = new Map<string, CellState>();
  private estimatedBytes = 0;
  private tooLarge = false;
  private rewrites = false;
  private undescribed = false;
  private changeLabel = "Change";

  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly spreadsheetId: string,
    private readonly entryLimit = LIMITS.journalEntryBytes,
  ) {}

  setLabel(label: string): void {
    this.changeLabel = label;
  }

  /** Marks the change as one that alters what references mean, whether or not it rewrites any. */
  markRewrites(): void {
    this.rewrites = true;
  }

  /**
   * Marks the change as one that wrote content without this writer, as
   * restoring a version does. Sessions are then told to read the spreadsheet
   * again, because what the writer recorded is not all that changed.
   */
  markUndescribed(): void {
    this.undescribed = true;
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
      this.rowChanges.size +
        this.pageChanges.size +
        this.tableChanges.size +
        this.viewChanges.size +
        this.cellChanges.size >
        0
    );
  }

  /**
   * What the change wrote, for the journal. `data` is `null` when the change
   * exceeded the history limit. `formulas` says whether the state it left
   * holds formula text it wrote, which is assumed of a change with no data.
   */
  recorded(): { data: JournalData | null; bytes: number; formulas: boolean } | undefined {
    if (!this.hasChanges()) return undefined;
    if (this.tooLarge) return { data: null, bytes: 0, formulas: true };
    const data = this.data();
    const bytes = Buffer.byteLength(JSON.stringify(data));
    if (bytes > this.entryLimit) {
      this.discard();
      return { data: null, bytes: 0, formulas: true };
    }
    return { data, bytes, formulas: writesFormulas(data, "after") };
  }

  /**
   * The state the change left everything it wrote in, for the sessions that
   * have the spreadsheet open. `null` when the change is too large to send.
   */
  changed(): ChangedContent | null {
    if (this.tooLarge || this.undescribed) return null;
    const tableAfter = new Map([...this.tableChanges.values()].map(({ id, after }) => [id, after]));
    const gone = (tableId: string): boolean => tableAfter.get(tableId) === null;
    const deleted = new Set(
      [...this.rowChanges.values()].filter((row) => row.after === null).map((row) => row.id),
    );
    // A deleted table, row, or column takes its cells with it, and a session drops them itself.
    const written = [...this.cellChanges.values()].filter(
      ({ tableId, rowId, colId, input }) =>
        input !== "" ||
        !(
          gone(tableId) ||
          deleted.has(rowId) ||
          tableAfter.get(tableId)?.colIds.includes(colId) === false
        ),
    );
    if (written.length > MAX_ANNOUNCED_CELLS) return null;
    return {
      pages: [...this.pageChanges.values()].map(({ id, after }) => ({ id, page: after })),
      tables: [...this.tableChanges.values()].map(({ id, after }) => ({ id, table: after })),
      views: [...this.viewChanges.values()].map(({ id, after }) => ({ id, view: after })),
      rows: [...this.rowChanges.values()]
        .filter(({ tableId }) => !gone(tableId))
        .map(({ id, tableId, after }) => ({ id, tableId, orderKey: after })),
      cells: written.map(({ tableId, rowId, colId, input }) => ({ tableId, rowId, colId, input })),
    };
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

  /** Creates a table of a size. Its rows and columns get new ids. */
  async insertTable(
    values: NewTable,
    size: { rowCount: number; colCount: number },
  ): Promise<TableRecord> {
    this.checkColumns(values.columns);
    const [inserted] = await this.db
      .insert(tables)
      .values({ ...values, colIds: Array.from({ length: size.colCount }, () => randomUUID()) })
      .returning(tableColumns);
    if (!inserted) throw new Error("Insert returned no table");
    this.recordItem(this.tableChanges, inserted.id, null, inserted);
    await this.insertRows(inserted.id, 0, size.rowCount);
    return inserted;
  }

  /** Changes a table's record. Its rows change through `insertRows` and `deleteRows`. */
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
    this.recordItem(this.tableChanges, tableId, before, updated);
    return updated;
  }

  async deleteTable(tableId: string): Promise<void> {
    const before = await this.findTable(tableId);
    const rows = await orderedRows(this.db, tableId);
    await this.deleteRows(
      tableId,
      rows.map((row) => row.id),
    );
    await this.db.delete(tables).where(eq(tables.id, tableId));
    this.recordItem(this.tableChanges, tableId, before, null);
  }

  /**
   * Inserts `count` rows so that the first is the table's row `index`, without
   * changing any other row. `ids` names the new rows, for a caller that was
   * given their ids. Refuses rows past the limits of a table and a spreadsheet.
   */
  async insertRows(
    tableId: string,
    index: number,
    count: number,
    ids?: readonly string[],
  ): Promise<RowRecord[]> {
    if (count === 0) return [];
    let rows = await orderedRows(this.db, tableId);
    if (rows.length + count > LIMITS.tableRows) {
      throw unprocessable(
        "table_full",
        `A table can have at most ${String(LIMITS.tableRows)} rows`,
      );
    }
    const makeKeys = (): string[] => {
      const before = rows[index - 1]?.orderKey ?? null;
      const after = rows[index]?.orderKey ?? null;
      if (after === null) return keysAfter(before, count);
      const between = (lower: string | null, upper: string | null, size: number): string[] => {
        if (size === 0) return [];
        const middle = keyBetween(lower, upper);
        const left = Math.floor(size / 2);
        return [
          ...between(lower, middle, left),
          middle,
          ...between(middle, upper, size - left - 1),
        ];
      };
      return between(before, after, count);
    };
    let keys = makeKeys();
    if (keys.some((key) => key.length > MAX_ORDER_KEY_LENGTH)) {
      rows = await this.rebalance(rows);
      keys = makeKeys();
    }
    const inserted = await this.db
      .insert(tableRows)
      .values(
        keys.map((orderKey, index) => ({ tableId, orderKey, ...(ids ? { id: ids[index] } : {}) })),
      )
      .returning();
    if ((await countRows(this.db, this.spreadsheetId)) > LIMITS.spreadsheetRows) {
      throw unprocessable(
        "too_many_rows",
        `A spreadsheet can have at most ${String(LIMITS.spreadsheetRows)} rows`,
      );
    }
    await markDeleted(
      this.db,
      this.spreadsheetId,
      inserted.map((row) => row.id),
      false,
    );
    for (const row of inserted) this.recordRow(tableId, row.id, null, row.orderKey);
    return inserted;
  }

  /**
   * Gives every row of a table a short, evenly spaced key, keeping their
   * order. Journal entries hold the keys rows had, so the history of every
   * tab on the spreadsheet is emptied and this change is not recorded.
   */
  private async rebalance(rows: readonly RowRecord[]): Promise<RowRecord[]> {
    await this.db.delete(journal).where(eq(journal.spreadsheetId, this.spreadsheetId));
    // Every row moves out of the way first: a new key may be one a later row still has.
    for (const row of rows) {
      await this.db
        .update(tableRows)
        .set({ orderKey: "~" + row.id })
        .where(eq(tableRows.id, row.id));
    }
    const rebalanced = rebalanceKeys(rows.length).map((orderKey, index) => {
      const row = rows[index];
      if (!row) throw new Error("Missing row during order key rebalance");
      return { ...row, orderKey };
    });
    for (const row of rebalanced) {
      await this.db
        .update(tableRows)
        .set({ orderKey: row.orderKey })
        .where(eq(tableRows.id, row.id));
    }
    this.discard();
    return rebalanced;
  }

  /** Deletes rows of a table, and the cells in them. */
  async deleteRows(tableId: string, ids: readonly string[]): Promise<void> {
    for (let start = 0; start < ids.length; start += BATCH) {
      const batch = ids.slice(start, start + BATCH);
      // The cells go with their rows. They are cleared first so that undo can bring them back.
      await this.clearCells(tableId, inArray(cells.rowId, batch));
      const removed = await this.db
        .delete(tableRows)
        .where(and(eq(tableRows.tableId, tableId), inArray(tableRows.id, batch)))
        .returning();
      await markDeleted(
        this.db,
        this.spreadsheetId,
        removed.map((row) => row.id),
        true,
      );
      for (const row of removed) this.recordRow(tableId, row.id, row.orderKey, null);
    }
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

  /**
   * Stores cell inputs. An empty input deletes the cell. Later entries win.
   * Refuses a cell whose column is not one of its table's. The database
   * refuses one whose row is not.
   */
  async setCells(inputs: readonly StoredCell[]): Promise<void> {
    const latest = [...new Map(inputs.map((cell) => [this.cellKey(cell), cell])).values()];
    for (const cell of latest) this.checkCellInput(cell.input);
    for (const [tableId, written] of Map.groupBy(latest, (cell) => cell.tableId)) {
      const { colIds } = await this.findTable(tableId);
      const columns = new Set(colIds);
      if (written.some((cell) => cell.input !== "" && !columns.has(cell.colId))) {
        throw new Error(`A cell of table ${tableId} names a column the table does not have`);
      }
      const before = await readInputs(this.db, tableId, written);
      await storeCells(this.db, this.userId, written);
      for (const cell of written) this.recordCell(cell, before.get(cell));
    }
  }

  /** Clears cells matching `where`, retaining their inputs for undo. */
  async clearCells(tableId: string, where: SQL): Promise<void> {
    // Read in address order, a batch at a time, and no further once the change is too large to keep.
    let last: CellIdentity | undefined;
    while (!this.tooLarge) {
      const found = await this.db
        .select({ rowId: cells.rowId, colId: cells.colId, input: cells.input })
        .from(cells)
        .where(
          and(
            eq(cells.tableId, tableId),
            where,
            last &&
              or(
                gt(cells.rowId, last.rowId),
                and(eq(cells.rowId, last.rowId), gt(cells.colId, last.colId)),
              ),
          ),
        )
        .orderBy(asc(cells.rowId), asc(cells.colId))
        .limit(BATCH);
      for (const { input, ...cell } of found) {
        this.recordCell({ tableId, ...cell, input: "" }, input);
      }
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
    if (wasChanged) this.estimatedBytes -= this.size(previous) + 1;
    if (nextChanged) {
      const next = { id, before: original, after };
      collection.set(id, next);
      this.estimatedBytes += this.size(next) + 1;
    } else {
      collection.delete(id);
    }
    this.checkEstimatedSize();
  }

  private recordRow(
    tableId: string,
    id: string,
    before: string | null,
    after: string | null,
  ): void {
    if (this.tooLarge) return;
    const previous = this.rowChanges.get(id);
    const original = previous ? previous.before : before;
    if (previous) this.estimatedBytes -= this.rowSize(previous) + 1;
    if (original !== after) {
      const next = { tableId, id, before: original, after };
      this.rowChanges.set(id, next);
      this.estimatedBytes += this.rowSize(next) + 1;
    } else {
      this.rowChanges.delete(id);
    }
    this.checkEstimatedSize();
  }

  private recordCell(cell: StoredCell, before: string): void {
    if (this.tooLarge) return;
    const key = this.cellKey(cell);
    const previous = this.cellChanges.get(key);
    const original = previous ? previous.before : before;
    if (previous) this.estimatedBytes -= this.cellSize(previous) + 1;
    if (original !== cell.input) {
      const next = { ...cell, before: original };
      this.cellChanges.set(key, next);
      this.estimatedBytes += this.cellSize(next) + 1;
    } else {
      this.cellChanges.delete(key);
    }
    this.checkEstimatedSize();
  }

  private cellKey({ rowId, colId }: CellIdentity): string {
    return `${rowId}:${colId}`;
  }

  private size(record: unknown): number {
    return Buffer.byteLength(JSON.stringify(record));
  }

  private rowSize(row: RowState): number {
    return this.size([row.id, row.before, row.after]);
  }

  private cellSize(cell: CellState): number {
    return this.size([cell.rowId, cell.colId, cell.before, cell.input]);
  }

  private same<T>(left: T | null, right: T | null): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  private checkEstimatedSize(): void {
    if (this.estimatedBytes > this.entryLimit) this.discard();
  }

  private discard(): void {
    this.tooLarge = true;
    this.rowChanges.clear();
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
    const rows = Map.groupBy(this.rowChanges.values(), (row) => row.tableId);
    const written = Map.groupBy(this.cellChanges.values(), (cell) => cell.tableId);
    return {
      rows: [...rows].map(([tableId, changes]) => ({
        tableId,
        changes: changes.map(({ id, before, after }): RowChange => [id, before, after]),
      })),
      pages: [...this.pageChanges.values()],
      tables: [...this.tableChanges.values()],
      views: [...this.viewChanges.values()],
      cells: [...written].map(([tableId, changes]) => ({
        tableId,
        changes: changes.map(({ rowId, colId, before, input }): CellChange => [
          rowId,
          colId,
          before,
          input,
        ]),
      })),
    };
  }
}

/**
 * Whether one side of a recorded change holds formula text that the other
 * side does not: a cell input that starts with `=`, the source of a view, or
 * the formula of a formula column. `"after"` is what the change wrote and what
 * a redo puts back, and `"before"` is what an undo puts back.
 */
export function writesFormulas(data: JournalData, side: "before" | "after"): boolean {
  const other = side === "before" ? "after" : "before";
  const cell = data.cells.some(({ changes }) =>
    changes.some(([, , before, after]) => isFormulaInput(side === "before" ? before : after)),
  );
  const view = data.views.some(
    (change) =>
      (change[side]?.source ?? "") !== "" && change[side]?.source !== change[other]?.source,
  );
  const column = data.tables.some((change) => {
    const [written, was] = [change[side], change[other]];
    return (written?.columns ?? []).some(({ formula }, index) => {
      if (formula === undefined) return false;
      const place = was?.colIds.indexOf(written?.colIds[index] ?? "") ?? -1;
      return was?.columns?.[place]?.formula !== formula;
    });
  });
  return cell || view || column;
}

/**
 * Whether two recorded changes wrote the same page, table, view, row, or
 * cell. `step` is the smaller of the two: its items are indexed and the
 * other's are looked up among them.
 */
export function touchSame(step: JournalData, other: JournalData): boolean {
  const rowsOf = (data: JournalData): string[] =>
    data.rows.flatMap(({ changes }) => changes.map(([id]) => id));
  const cellsOf = (data: JournalData): string[] =>
    data.cells.flatMap(({ changes }) => changes.map(([rowId, colId]) => `${rowId}:${colId}`));
  const items = new Set([
    ...[...step.pages, ...step.tables, ...step.views].map(({ id }) => id),
    ...rowsOf(step),
  ]);
  const written = new Set(cellsOf(step));
  return (
    [...other.pages, ...other.tables, ...other.views].some(({ id }) => items.has(id)) ||
    rowsOf(other).some((id) => items.has(id)) ||
    cellsOf(other).some((key) => written.has(key))
  );
}

/**
 * A key for a row put back into a table, given the keys the table's rows
 * have. The row takes the key it had. When another row has taken that key
 * since, it takes a key just after it.
 */
function freeKey(wanted: string, taken: readonly string[]): string {
  if (!taken.includes(wanted)) return wanted;
  const next = taken.filter((key) => key > wanted).sort()[0] ?? null;
  return keyBetween(wanted, next);
}

/** Applies a recorded state without making another journal entry. Returns what it wrote. */
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
    rows: [],
    cells: data.cells.flatMap(({ tableId, changes }) =>
      changes.map(([rowId, colId, before, after]) => ({
        tableId,
        rowId,
        colId,
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
          colIds: table.colIds,
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
  for (const { tableId, changes } of data.rows) {
    const removed = changes.filter(([, before, after]) => target(before, after) === null);
    const removedIds = removed.map(([id]) => id);
    for (let start = 0; start < removedIds.length; start += BATCH) {
      await db
        .delete(tableRows)
        .where(inArray(tableRows.id, removedIds.slice(start, start + BATCH)));
    }
    await markDeleted(db, spreadsheetId, removedIds, true);
    for (const id of removedIds) changed.rows.push({ id, tableId, orderKey: null });

    if (removedTables.includes(tableId)) continue;
    const present = await orderedRows(db, tableId);
    const existing = new Set(present.map((row) => row.id));
    const keys = present.map((row) => row.orderKey);
    const restored: RowRecord[] = [];
    for (const [id, before, after] of changes) {
      const wanted = target(before, after);
      if (wanted === null || existing.has(id)) continue;
      const orderKey = freeKey(wanted, keys);
      keys.push(orderKey);
      restored.push({ id, tableId, orderKey });
    }
    for (let start = 0; start < restored.length; start += BATCH) {
      await db.insert(tableRows).values(restored.slice(start, start + BATCH));
    }
    await markDeleted(
      db,
      spreadsheetId,
      restored.map((row) => row.id),
      false,
    );
    changed.rows.push(...restored);
  }
  await storeCells(db, userId, changed.cells);
  return changed;
}
