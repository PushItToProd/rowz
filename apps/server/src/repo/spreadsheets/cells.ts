import { formatAddress, type Effect } from "@spreadsheet-app/engine";
import {
  FILE_LIMITS,
  TableLayout,
  type IdentityCellInput,
  type StoredCell,
} from "@spreadsheet-app/shared";
import { count, eq, inArray } from "drizzle-orm";
import type { Database } from "../../db/client";
import { orderedRows, type Change } from "../journal";
import { cells, deletedRows, pages, tables, tableRows } from "../../db/schema";
import { columnDeleted, conflict, notFound, rowDeleted, unprocessable } from "../../errors";
import { type TableRecord } from "./records";
import { fail } from "./helpers";
import type { RepositoryContext } from "./context";

/** A request that writes this many cells, as a paste or an import does, keeps a version first. */
export const BULK_WRITE_CELLS = 20;

/**
 * Stores cell inputs. An empty input deletes the cell. Later entries for
 * the same cell win.
 *
 * `appendRows` are ids the client made for rows to add at the end of the
 * table, in the same change as the cells. The ones that exist already are
 * left alone, so a request sent twice adds each row once. An id that names
 * a deleted row is refused: adding it would bring back, with its old cells,
 * a row that was deleted or whose insert was undone.
 */
export async function setCells(
  ctx: RepositoryContext,
  tableId: string,
  {
    cells: written,
    appendRows = [],
  }: {
    cells: readonly IdentityCellInput[];
    appendRows?: readonly string[] | undefined;
    revision?: number | undefined;
  },
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    writer.setLabel(`Change cells in ${table.name}`);
    // One statement cannot update the same cell twice, so keep the last entry per cell.
    const latest = [
      ...new Map(written.map((cell) => [`${cell.rowId}:${cell.colId}`, cell])).values(),
    ];
    if (latest.length >= BULK_WRITE_CELLS) {
      await ctx.keepVersion(
        tx,
        table.spreadsheetId,
        `Before changing ${String(latest.length)} cells of ${table.name}`,
      );
    }

    let rows = await orderedRows(tx, tableId);
    const present = new Set(rows.map((row) => row.id));
    const added = appendRows.filter((id) => !present.has(id));
    if (added.length > 0) {
      await ctx.checkNewRows(tx, added);
      rows = [...rows, ...(await writer.insertRows(tableId, rows.length, added.length, added))];
    }

    const layout = new TableLayout(rows, table.colIds);
    for (const cell of latest) {
      if (layout.rowIndex(cell.rowId) === undefined) throw rowDeleted();
      const col = layout.colIndex(cell.colId);
      if (col === undefined) throw columnDeleted();
      const column = table.columns?.[col];
      if (column?.type === "formula") {
        throw unprocessable(
          "formula_column",
          `${column.name} is a formula column. Change the column's formula instead`,
        );
      }
    }
    await writer.setCells(latest.map((cell) => ({ tableId, ...cell })));
    if (latest.some((cell) => cell.input !== "")) {
      await ctx.checkCellCount(tx, table.spreadsheetId);
    }
  });
  return change;
}

/**
 * Refuses ids a client made for new rows when a row has one of them, in
 * any table of any spreadsheet, or had one and was deleted. The answer does
 * not say where an id exists.
 */
export async function checkNewRows(
  _ctx: RepositoryContext,
  tx: Database,
  ids: readonly string[],
): Promise<void> {
  const [existing] = await tx
    .select({ id: tableRows.id })
    .from(tableRows)
    .where(inArray(tableRows.id, [...ids]))
    .limit(1);
  if (existing) throw conflict("A new row has an id that is already in use");
  const [deleted] = await tx
    .select({ rowId: deletedRows.rowId })
    .from(deletedRows)
    .where(inArray(deletedRows.rowId, [...ids]))
    .limit(1);
  if (deleted) throw rowDeleted();
}

/** Refuses a change that leaves a spreadsheet with more filled cells than a file of it may hold. */
export async function checkCellCount(
  _ctx: RepositoryContext,
  tx: Database,
  spreadsheetId: string,
): Promise<void> {
  const [counted] = await tx
    .select({ filled: count() })
    .from(cells)
    .innerJoin(tables, eq(tables.id, cells.tableId))
    .innerJoin(pages, eq(pages.id, tables.pageId))
    .where(eq(pages.spreadsheetId, spreadsheetId));
  if ((counted?.filled ?? 0) > FILE_LIMITS.cells) {
    throw unprocessable(
      "too_many_cells",
      `A document can have at most ${String(FILE_LIMITS.cells)} filled cells`,
    );
  }
}

/**
 * Carries out what an action does to the contents of a spreadsheet, as one
 * change: tables grow, cells are written, and rows are deleted. The effects
 * name cells and rows by the positions they had when the action was
 * planned. The caller planned it under the spreadsheet's lock and still
 * holds it, so the positions mean the same rows here.
 *
 * Returns `undefined` when no effect writes to the spreadsheet.
 */
export async function applyEffects(
  ctx: RepositoryContext,
  spreadsheetId: string,
  effects: readonly Effect[],
): Promise<Change | undefined> {
  const grown = effects.filter((effect) => effect.type === "ensureRows");
  const written = effects.filter((effect) => effect.type === "setCell");
  const removed = effects.filter((effect) => effect.type === "deleteRows");
  if (grown.length + written.length + removed.length === 0) return undefined;

  const { change } = await ctx.change(spreadsheetId, async (tx, writer) => {
    // Tables grow first, so the cells written into new rows are inside the table.
    for (const [tableId, growths] of Map.groupBy(grown, (effect) => effect.tableId)) {
      const height = (await orderedRows(tx, tableId)).length;
      const wanted = Math.max(...growths.map((effect) => effect.rowCount));
      if (wanted > height) await writer.insertRows(tableId, height, wanted - height);
    }
    const contents = await ctx.within(tx).repository.read(spreadsheetId);
    const tableOf = (tableId: string): TableRecord =>
      contents.snapshot.tables.find((table) => table.id === tableId) ?? fail(notFound("Table"));
    const tableIds = new Set([...grown, ...written, ...removed].map((effect) => effect.tableId));
    const [only] = tableIds.size === 1 ? [...tableIds] : [];
    writer.setLabel(only === undefined ? "Run action" : `Change cells in ${tableOf(only).name}`);

    const inputs = written.map(({ tableId, row, col, input }): StoredCell => {
      const table = tableOf(tableId);
      const identity = contents.layout(tableId).identity({ row, col });
      if (!identity) {
        throw unprocessable(
          "cell_out_of_bounds",
          `${formatAddress({ row, col })} is outside the table ${table.name}`,
        );
      }
      const column = table.columns?.[col];
      if (column?.type === "formula") {
        throw unprocessable(
          "formula_column",
          `${column.name} is a formula column. Change the column's formula instead`,
        );
      }
      return { tableId, ...identity, input };
    });
    // Resolve all ranges against the same starting layout and delete each
    // row id once. DO plans every action against that layout, so OVERWRITE
    // ranges can overlap.
    const doomed = new Map<string, Set<string>>();
    for (const { tableId, startRow, count } of removed) {
      const ids = contents.layout(tableId).rowIds.slice(startRow, startRow + count);
      const held = doomed.get(tableId) ?? new Set<string>();
      for (const id of ids) held.add(id);
      doomed.set(tableId, held);
    }
    if (inputs.length >= BULK_WRITE_CELLS || [...doomed.values()].some((ids) => ids.size > 0)) {
      await ctx.keepVersion(tx, spreadsheetId, "Before running an action");
    }
    await writer.setCells(inputs);
    if (inputs.some((cell) => cell.input !== "")) await ctx.checkCellCount(tx, spreadsheetId);
    for (const [tableId, ids] of doomed) {
      await ctx.deleteLines(tx, writer, spreadsheetId, tableId, "row", [...ids]);
    }
  });
  return change;
}
