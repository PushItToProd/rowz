import { FILE_LIMITS, LIMITS } from "@spreadsheet-app/shared";
import { isDeepStrictEqual } from "node:util";
import { and, asc, count, desc, eq, gt, inArray, notInArray, sql } from "drizzle-orm";
import { noteChange, requestContext } from "../../changes";
import type { Database } from "../../db/client";
import {
  applyRecorded,
  countRows,
  MAX_ANNOUNCED_CELLS,
  type ChangedContent,
  type JournalData,
  readInputs,
  touchSame,
  UndoRefusal,
  writesFormulas,
} from "../journal";
import { cells, journal, pages, tables, tableRows, views } from "../../db/schema";
import { isForeignKeyViolation, isUniqueViolation } from "../../errors";
import { type UndoResult } from "./records";
import { pageColumns, tableColumns, viewColumns } from "./context";
import { INSERT_BATCH } from "./files";

import type { RepositoryContext } from "./context";

export function sameRecord(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

export function emptyChanged(): ChangedContent {
  return { pages: [], tables: [], views: [], rows: [], cells: [] };
}

/**
 * What two changes applied one after the other wrote together. Where both
 * wrote the same thing, the later one has it as it now is. Too much to send
 * is `null`, as it is from one change.
 */
export function mergeChanged(
  earlier: ChangedContent | null,
  later: ChangedContent | null,
): ChangedContent | null {
  if (!earlier || !later) return null;
  const latest = <T>(items: readonly T[], key: (item: T) => string): T[] => [
    ...new Map(items.map((item) => [key(item), item])).values(),
  ];
  const cellsWritten = latest(
    [...earlier.cells, ...later.cells],
    ({ rowId, colId }) => `${rowId}:${colId}`,
  );
  if (cellsWritten.length > MAX_ANNOUNCED_CELLS) return null;
  return {
    pages: latest([...earlier.pages, ...later.pages], ({ id }) => id),
    tables: latest([...earlier.tables, ...later.tables], ({ id }) => id),
    views: latest([...earlier.views, ...later.views], ({ id }) => id),
    rows: latest([...earlier.rows, ...later.rows], ({ id }) => id),
    cells: cellsWritten,
  };
}

/** Whether this tab has anything it can undo or redo. */
export async function undoState(
  ctx: RepositoryContext,
  spreadsheetId: string,
): Promise<{ undoable: boolean; redoable: boolean }> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "read");
  return ctx.stackState(ctx.db, spreadsheetId, requestContext()?.clientId ?? null);
}

/** Reverses the newest step on this tab's stack. */
export async function undo(ctx: RepositoryContext, spreadsheetId: string): Promise<UndoResult> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "write");
  return ctx.locked(spreadsheetId, (tx) => ctx.changeHistory(tx, spreadsheetId, "undo"));
}

/** Reapplies the oldest step on this tab's redo stack. */
export async function redo(ctx: RepositoryContext, spreadsheetId: string): Promise<UndoResult> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "write");
  return ctx.locked(spreadsheetId, (tx) => ctx.changeHistory(tx, spreadsheetId, "redo"));
}

export async function changeHistory(
  ctx: RepositoryContext,
  tx: Database,
  spreadsheetId: string,
  direction: "undo" | "redo",
): Promise<UndoResult> {
  // Pruning otherwise runs when a change is recorded, so the entries of a
  // spreadsheet nobody has changed since would stay past the age limit.
  await ctx.pruneJournal(tx, spreadsheetId);
  const clientId = requestContext()?.clientId ?? null;
  if (clientId === null) return ctx.historyResult(tx, spreadsheetId, clientId, "nothing");
  const undone = direction === "redo";
  const stack = and(
    eq(journal.spreadsheetId, spreadsheetId),
    eq(journal.userId, ctx.userId),
    eq(journal.clientId, clientId),
    eq(journal.undone, undone),
  );
  const [latest] = await tx
    .select({ step: journal.step, label: journal.label })
    .from(journal)
    .where(stack)
    .orderBy(direction === "undo" ? desc(journal.seq) : asc(journal.seq))
    .limit(1);
  if (!latest) return ctx.historyResult(tx, spreadsheetId, clientId, "nothing");

  const group = and(
    eq(journal.spreadsheetId, spreadsheetId),
    eq(journal.userId, ctx.userId),
    eq(journal.clientId, clientId),
    eq(journal.step, latest.step),
  );
  const entries = await tx
    .select()
    .from(journal)
    .where(group)
    .orderBy(direction === "undo" ? desc(journal.seq) : asc(journal.seq));
  const own = entries.map((entry) => entry.seq);

  try {
    // Changes in effect that came after any part of the step. The requests
    // of one step are separate changes, so another tab's can fall between them.
    const others = await tx
      .select({ seq: journal.seq, rewrites: journal.rewrites, formulas: journal.formulas })
      .from(journal)
      .where(
        and(
          eq(journal.spreadsheetId, spreadsheetId),
          gt(journal.seq, Math.min(...own)),
          notInArray(journal.seq, own),
          eq(journal.undone, false),
        ),
      );
    for (const entry of entries) {
      const later = others.filter((other) => other.seq > entry.seq);
      const { data } = entry;
      const createsOrDeletes =
        data !== null &&
        [...data.pages, ...data.tables, ...data.views].some(
          ({ before, after }) => before === null || after === null,
        );
      if (createsOrDeletes && later.length > 0) {
        throw new UndoRefusal(
          `A later change prevents ${direction}ing the adding or deleting of a page, table, or view`,
        );
      }
      // Ids fix which cell an entry means, and not what a formula's text
      // means. One of two changes altering what references mean conflicts
      // with the other writing formula text: the text was written for the
      // rows, columns, and names of its own moment.
      if (entry.rewrites && later.some((other) => other.formulas)) {
        throw new UndoRefusal(
          `A formula written since prevents ${direction}ing this change to rows, columns, or names`,
        );
      }
      // An entry too large to record is refused below, whatever it would write.
      const restoresFormulas =
        data !== null && writesFormulas(data, direction === "undo" ? "before" : "after");
      if (restoresFormulas && later.some((other) => other.rewrites)) {
        throw new UndoRefusal(
          `A later change to rows, columns, or names prevents ${direction}ing this change to a formula`,
        );
      }
    }

    // Comparing what the spreadsheet holds with what the step left does not
    // show a later change that put the same value back: a cell typed over
    // and then typed again as it was. Reversing the step would erase that
    // change, so what later changes wrote is compared too. A later change
    // too large to record has no state to compare, and only the comparison
    // of values in `assertRecordedMatches` stands against it.
    const laterStates =
      others.length === 0
        ? []
        : await tx
            .select({ seq: journal.seq, data: journal.data })
            .from(journal)
            .where(
              inArray(
                journal.seq,
                others.map((other) => other.seq),
              ),
            );
    for (const entry of entries) {
      const { data } = entry;
      if (data === null) continue;
      const overwritten = laterStates.some(
        (other) => other.seq > entry.seq && other.data !== null && touchSame(data, other.data),
      );
      if (overwritten) {
        throw new UndoRefusal(
          `A later change to the same content prevents ${direction}ing this change`,
        );
      }
    }

    const rowsBefore = await countRows(tx, spreadsheetId);
    const changed = await tx.transaction(async (writes) => {
      let accumulated: ChangedContent | null = emptyChanged();
      for (const entry of entries) {
        if (!entry.data) {
          throw new UndoRefusal(
            "This change is too large to undo. Use History to restore a version",
          );
        }
        await ctx.assertRecordedMatches(writes, entry.data, direction);
        accumulated = mergeChanged(
          accumulated,
          await applyRecorded(writes, spreadsheetId, ctx.userId, entry.data, direction),
        );
      }
      await ctx.checkRestoredState(writes, spreadsheetId, rowsBefore);
      return accumulated;
    });
    await tx.update(journal).set({ undone: !undone }).where(group);
    const revision = await ctx.touch(
      tx,
      spreadsheetId,
      entries.some((entry) => entry.rewrites),
    );
    const change = { revision, changed };
    noteChange(spreadsheetId, change);
    return {
      outcome: "done",
      label: latest.label,
      error: null,
      change,
      ...(await ctx.stackState(tx, spreadsheetId, clientId)),
    };
  } catch (error) {
    // The nested transaction has rolled back whatever the apply wrote.
    const message =
      error instanceof UndoRefusal
        ? error.message
        : isUniqueViolation(error)
          ? "This change would create a duplicate name and cannot be restored"
          : isForeignKeyViolation(error)
            ? "This change belongs to a page or table that has since been deleted"
            : undefined;
    if (message === undefined) throw error;
    await tx.update(journal).set({ clientId: null }).where(group);
    return {
      outcome: "refused",
      label: latest.label,
      error: message,
      change: null,
      ...(await ctx.stackState(tx, spreadsheetId, clientId)),
    };
  }
}

export async function stackState(
  ctx: RepositoryContext,
  db: Database,
  spreadsheetId: string,
  clientId: string | null,
): Promise<{ undoable: boolean; redoable: boolean }> {
  if (clientId === null) return { undoable: false, redoable: false };
  const rows = await db
    .select({ undone: journal.undone })
    .from(journal)
    .where(
      and(
        eq(journal.spreadsheetId, spreadsheetId),
        eq(journal.userId, ctx.userId),
        eq(journal.clientId, clientId),
      ),
    );
  return {
    undoable: rows.some((row) => !row.undone),
    redoable: rows.some((row) => row.undone),
  };
}

export async function historyResult(
  ctx: RepositoryContext,
  db: Database,
  spreadsheetId: string,
  clientId: string | null,
  outcome: UndoResult["outcome"],
): Promise<UndoResult> {
  return {
    outcome,
    label: null,
    error: null,
    change: null,
    ...(await ctx.stackState(db, spreadsheetId, clientId)),
  };
}

/**
 * Refuses an undo or redo of a recorded change when something it wrote is
 * no longer as the change left it, so that it would write over what someone
 * did since.
 */
export async function assertRecordedMatches(
  _ctx: RepositoryContext,
  db: Database,
  data: JournalData,
  direction: "undo" | "redo",
): Promise<void> {
  const expected = <T>(before: T, after: T): T => (direction === "undo" ? after : before);
  const target = <T>(before: T, after: T): T => (direction === "undo" ? before : after);
  for (const { id, before, after } of data.pages) {
    const [current] = await db.select(pageColumns).from(pages).where(eq(pages.id, id)).limit(1);
    if (!sameRecord(current ?? null, expected(before, after))) {
      throw new UndoRefusal("This page has changed since this step");
    }
  }
  for (const { id, before, after } of data.tables) {
    const [current] = await db.select(tableColumns).from(tables).where(eq(tables.id, id)).limit(1);
    const recorded = expected(before, after);
    const normalized = recorded && {
      ...recorded,
      gridSizes: recorded.gridSizes ?? { rows: {}, columns: {} },
    };
    if (!sameRecord(current ?? null, normalized)) {
      throw new UndoRefusal("This table has changed since this step");
    }
  }
  for (const { id, before, after } of data.views) {
    const [current] = await db.select(viewColumns).from(views).where(eq(views.id, id)).limit(1);
    if (!sameRecord(current ?? null, expected(before, after))) {
      throw new UndoRefusal("This view has changed since this step");
    }
  }

  const recordedCells = new Set(
    data.cells.flatMap(({ changes }) => changes.map(([rowId, colId]) => `${rowId}:${colId}`)),
  );
  for (const { changes } of data.rows) {
    const ids = changes.map(([id]) => id);
    // A row is compared by whether it exists. Its key may have changed: a
    // row put back where another has taken its key gets a key next to it.
    const present = new Set<string>();
    for (let start = 0; start < ids.length; start += INSERT_BATCH) {
      const found = await db
        .select({ id: tableRows.id })
        .from(tableRows)
        .where(inArray(tableRows.id, ids.slice(start, start + INSERT_BATCH)));
      for (const row of found) present.add(row.id);
    }
    for (const [id, before, after] of changes) {
      if (present.has(id) !== (expected(before, after) !== null)) {
        throw new UndoRefusal("A row has changed since this step");
      }
    }
    // A row this is about to delete takes its cells with it. It may hold
    // only what the step itself wrote, or the delete would take what someone
    // typed into it since.
    const doomed = changes
      .filter(([, before, after]) => target(before, after) === null)
      .map(([id]) => id);
    for (let start = 0; start < doomed.length; start += INSERT_BATCH) {
      const held = await db
        .select({ rowId: cells.rowId, colId: cells.colId })
        .from(cells)
        .where(inArray(cells.rowId, doomed.slice(start, start + INSERT_BATCH)));
      if (held.some(({ rowId, colId }) => !recordedCells.has(`${rowId}:${colId}`))) {
        throw new UndoRefusal("A row this step added now holds something typed since");
      }
    }
  }
  for (const { tableId, changes } of data.cells) {
    const inputs = await readInputs(
      db,
      tableId,
      changes.map(([rowId, colId]) => ({ rowId, colId })),
    );
    for (const [rowId, colId, before, after] of changes) {
      if (inputs.get({ rowId, colId }) !== expected(before, after)) {
        throw new UndoRefusal("A cell has changed since this step");
      }
    }
  }
}

/**
 * Refuses an undo or redo that leaves the spreadsheet in a state no other
 * change could: over a limit, a table too small, or a cell where none can
 * be. `rowsBefore` is how many rows the spreadsheet had, which a
 * spreadsheet already over the row limit may come down from.
 */
export async function checkRestoredState(
  _ctx: RepositoryContext,
  db: Database,
  spreadsheetId: string,
  rowsBefore: number,
): Promise<void> {
  const pageRows = await db
    .select({ id: pages.id })
    .from(pages)
    .where(eq(pages.spreadsheetId, spreadsheetId));
  if (pageRows.length === 0) throw new UndoRefusal("A document needs at least one page");
  if (pageRows.length > FILE_LIMITS.pages) {
    throw new UndoRefusal("This change would exceed the page limit");
  }
  const inSpreadsheet = eq(pages.spreadsheetId, spreadsheetId);
  const tableRecords = await db
    .select({
      id: tables.id,
      pageId: tables.pageId,
      colIds: tables.colIds,
      columns: tables.columns,
      rowCount:
        sql<number>`(select count(*) from ${tableRows} where ${tableRows.tableId} = ${tables.id})`.mapWith(
          Number,
        ),
    })
    .from(tables)
    .innerJoin(pages, eq(pages.id, tables.pageId))
    .where(inSpreadsheet);
  const totalRows = tableRecords.reduce((total, table) => total + table.rowCount, 0);
  if (totalRows > LIMITS.spreadsheetRows && totalRows >= rowsBefore) {
    throw new UndoRefusal("This change would exceed the document row limit");
  }
  const outOfBounds = tableRecords.some(
    (table) =>
      table.rowCount > LIMITS.tableRows ||
      table.colIds.length > LIMITS.tableCols ||
      table.colIds.length < 1 ||
      // A data table holds the rows added to it, which can be none.
      (table.rowCount < 1 && !table.columns),
  );
  if (outOfBounds) throw new UndoRefusal("This change would exceed a table limit");
  const [cellCount] = await db
    .select({ filled: count() })
    .from(cells)
    .innerJoin(tables, eq(tables.id, cells.tableId))
    .innerJoin(pages, eq(pages.id, tables.pageId))
    .where(inSpreadsheet);
  if ((cellCount?.filled ?? 0) > FILE_LIMITS.cells) {
    throw new UndoRefusal("This change would exceed the document cell limit");
  }
  // The database keeps a cell's row in its table. Nothing but this keeps its column there.
  const outside = await db
    .select({ tableId: cells.tableId })
    .from(cells)
    .innerJoin(tables, eq(tables.id, cells.tableId))
    .innerJoin(pages, eq(pages.id, tables.pageId))
    .where(and(inSpreadsheet, sql`NOT (${tables.colIds} ? ${cells.colId}::text)`))
    .limit(1);
  if (outside.length > 0) {
    throw new UndoRefusal("This change would leave a cell in a column its table no longer has");
  }

  const formulaColumns = tableRecords.flatMap((table) =>
    (table.columns ?? []).flatMap((column, col) => {
      const colId = table.colIds[col];
      return column.type === "formula" && colId !== undefined ? [colId] : [];
    }),
  );
  for (let start = 0; start < formulaColumns.length; start += INSERT_BATCH) {
    const found = await db
      .select({ tableId: cells.tableId })
      .from(cells)
      .where(inArray(cells.colId, formulaColumns.slice(start, start + INSERT_BATCH)))
      .limit(1);
    if (found.length > 0) {
      throw new UndoRefusal("This change would store a value in a formula column");
    }
  }
  const blockCounts = new Map(pageRows.map(({ id }) => [id, 0]));
  const blocks = await Promise.all([
    db
      .select({ pageId: tables.pageId })
      .from(tables)
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(inSpreadsheet),
    db
      .select({ pageId: views.pageId })
      .from(views)
      .innerJoin(pages, eq(pages.id, views.pageId))
      .where(inSpreadsheet),
  ]);
  for (const { pageId } of [...blocks[0], ...blocks[1]]) {
    blockCounts.set(pageId, (blockCounts.get(pageId) ?? 0) + 1);
  }
  if ([...blockCounts.values()].some((total) => total > FILE_LIMITS.blocksPerPage)) {
    throw new UndoRefusal("This change would exceed the page block limit");
  }
}
