import {
  columnFormulasAfterEdit,
  filterFormulasAfterEdit,
  nameFormulasAfterEdit,
  columnLabel,
  formatRulesAfterEdit,
  formulasAfterEdit,
  viewsAfterEdit,
  type StructuralEdit,
} from "@spreadsheet-app/engine";
import { LIMITS, type IdentifiedStructuralEditBody } from "@spreadsheet-app/shared";
import { randomUUID } from "node:crypto";
import { inArray, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { type ContentWriter, orderedRows, type Change } from "../journal";
import { cells, tables } from "../../db/schema";
import { columnDeleted, conflict, notFound, rowDeleted, unprocessable } from "../../errors";
import { withColumnsInserted } from "./helpers";
import type { RepositoryContext } from "./context";

/**
 * Inserts or deletes rows or columns. No cell moves: a cell belongs to its
 * row and column, whose ids do not change. Formulas anywhere in the
 * spreadsheet that read the table are rewritten to keep reading the same
 * cells, as are charts, text views, and formats.
 */
export async function editStructure(
  ctx: RepositoryContext,
  tableId: string,
  body: IdentifiedStructuralEditBody,
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    const { spreadsheetId } = table;
    const rows = body.axis === "row";
    const noun = rows ? "row" : "column";
    const several = body.ids.length === 1 ? "" : "s";
    writer.setLabel(
      `${body.kind === "insert" ? "Insert" : "Delete"} ${noun}${several} in ${table.name}`,
    );
    if (body.kind === "delete") {
      await ctx.deleteLines(tx, writer, spreadsheetId, tableId, body.axis, body.ids);
      return;
    }

    const ordered = rows ? (await orderedRows(tx, tableId)).map((row) => row.id) : table.colIds;
    const index = body.beforeId === null ? ordered.length : ordered.indexOf(body.beforeId);
    if (index < 0) throw rows ? rowDeleted() : columnDeleted();
    if (rows) await ctx.checkNewRows(tx, body.ids);
    else {
      const [existing] = await tx
        .select({ id: tables.id })
        .from(tables)
        .where(
          sql`${tables.colIds} ?| ARRAY[${sql.join(
            body.ids.map((id) => sql`${id}`),
            sql`, `,
          )}]::text[]`,
        )
        .limit(1);
      if (existing) throw conflict("A new column has an id that is already in use");
      if (ordered.length + body.ids.length > LIMITS.tableCols) {
        throw unprocessable(
          "table_full",
          `A table can have at most ${String(LIMITS.tableCols)} columns`,
        );
      }
    }
    await ctx.applyEdit(tx, writer, spreadsheetId, {
      tableId,
      axis: body.axis,
      kind: "insert",
      index,
      count: body.ids.length,
      ids: body.ids,
    });
  });
  return change;
}

/**
 * Deletes rows or columns of a table by id. The ids need not be next to
 * each other: someone may have inserted a row between two of them since
 * they were chosen. Each run of neighbors is one edit, last run first, so
 * that an earlier run's positions are not moved by a later one. Rows and
 * columns that were not named are kept. Must run inside `change`.
 */
export async function deleteLines(
  ctx: RepositoryContext,
  tx: Database,
  writer: ContentWriter,
  spreadsheetId: string,
  tableId: string,
  axis: "row" | "col",
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return;
  const table = await ctx.within(tx).repository.findTable(tableId, "write");
  const rows = axis === "row";
  const noun = rows ? "row" : "column";
  const ordered = rows ? (await orderedRows(tx, tableId)).map((row) => row.id) : table.colIds;
  const indexes = ids
    .map((id) => {
      const index = ordered.indexOf(id);
      if (index < 0) throw rows ? rowDeleted() : columnDeleted();
      return index;
    })
    .sort((a, b) => a - b);
  // A data table can lose every row. A plain table keeps one, and any table keeps a column.
  const keepsOne = !rows || !table.columns;
  if (keepsOne && indexes.length >= ordered.length) {
    throw unprocessable("last_one", `A table needs at least one ${noun}`);
  }
  const runs: { index: number; count: number }[] = [];
  for (const index of indexes) {
    const last = runs.at(-1);
    if (last && last.index + last.count === index) last.count += 1;
    else runs.push({ index, count: 1 });
  }
  const label = (index: number): string => (rows ? String(index + 1) : columnLabel(index));
  const deleted = runs
    .map(({ index, count }) =>
      count === 1 ? label(index) : `${label(index)} to ${label(index + count - 1)}`,
    )
    .join(", ");
  await ctx.keepVersion(
    tx,
    spreadsheetId,
    `Before deleting ${noun}${indexes.length === 1 ? "" : "s"} ${deleted} of ${table.name}`,
  );
  for (const run of runs.reverse()) {
    await ctx.applyEdit(tx, writer, spreadsheetId, { tableId, axis, kind: "delete", ...run });
  }
}

/**
 * Carries out an edit that is known to fit its table: adds or removes the
 * rows or the column ids, and rewrites the formula text that reads them, in
 * cells, in views, in formula columns, and in formats. Must run inside
 * `change`.
 */
export async function applyEdit(
  ctx: RepositoryContext,
  tx: Database,
  writer: ContentWriter,
  spreadsheetId: string,
  edit: StructuralEdit & { count: number; ids?: readonly string[] },
): Promise<void> {
  writer.markRewrites();
  const contents = await ctx.within(tx).repository.read(spreadsheetId);
  const { data } = contents;
  const table = data.tables.find((candidate) => candidate.id === edit.tableId);
  if (!table) throw notFound("Table");
  const layout = contents.layout(table.id);
  const rows = edit.axis === "row";

  // Each rewritten formula is named by the position its cell had before the
  // edit. The cell keeps its ids through the edit, so that is where it is stored.
  const formulas = formulasAfterEdit(data, edit).map((cell) => contents.identify(cell));
  const sources = viewsAfterEdit(data, data.views, edit);
  const columnFormulas = columnFormulasAfterEdit(data, edit);
  const nameFormulas = nameFormulasAfterEdit(data, edit);
  const filters = filterFormulasAfterEdit(data, edit);

  if (rows && edit.kind === "insert") {
    await writer.insertRows(table.id, edit.index, edit.count, edit.ids);
  } else if (rows) {
    await writer.deleteRows(table.id, layout.rowIds.slice(edit.index, edit.index + edit.count));
  }
  await writer.setCells(formulas);
  await ctx.storeViewSources(writer, sources);
  const changed = await ctx.storeColumnFormulas(writer, data.tables, columnFormulas);
  await ctx.storeNameFormulas(writer, data.tables, nameFormulas);
  const filtered = await ctx.storeFilterFormulas(writer, data.tables, filters);
  const display = filtered.find((candidate) => candidate.id === table.id)?.display ?? table.display;
  // The formulas were rewritten at the positions the columns had before the edit.
  const current = changed.find((candidate) => candidate.id === table.id)?.columns ?? table.columns;
  // Formats follow the cells they were given to.
  const formats = formatRulesAfterEdit(table.formats, edit);
  const conditionalFormats = formatRulesAfterEdit(table.conditionalFormats, edit);
  if (rows) {
    const removed =
      edit.kind === "delete" ? layout.rowIds.slice(edit.index, edit.index + edit.count) : [];
    const heights = { ...table.gridSizes.rows };
    for (const id of removed) Reflect.deleteProperty(heights, id);
    await writer.updateTable(table.id, {
      formats,
      conditionalFormats,
      gridSizes: { ...table.gridSizes, rows: heights },
    });
  } else if (edit.kind === "insert") {
    const added = edit.ids ?? Array.from({ length: edit.count }, () => randomUUID());
    await writer.updateTable(table.id, {
      colIds: table.colIds.toSpliced(edit.index, 0, ...added),
      columns: current && withColumnsInserted(current, edit.index, edit.count),
      formats,
      conditionalFormats,
    });
  } else {
    const removed = table.colIds.slice(edit.index, edit.index + edit.count);
    const widths = { ...table.gridSizes.columns };
    for (const id of removed) Reflect.deleteProperty(widths, id);
    await writer.clearCells(table.id, inArray(cells.colId, removed));
    await writer.updateTable(table.id, {
      colIds: table.colIds.toSpliced(edit.index, edit.count),
      gridSizes: { ...table.gridSizes, columns: widths },
      columns: current?.toSpliced(edit.index, edit.count) ?? null,
      formats,
      conditionalFormats,
      display: { ...display, sort: display.sort.filter(({ colId }) => !removed.includes(colId)) },
    });
  }
}
