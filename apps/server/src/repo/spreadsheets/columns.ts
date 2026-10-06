import { columnLabel, sameColumnName, type ColumnType } from "@spreadsheet-app/engine";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { orderedRows, type Change } from "../journal";
import { cells } from "../../db/schema";
import { columnDeleted, conflict, unprocessable } from "../../errors";
import { type TableRecord, type Found } from "./records";
import { normalized } from "./helpers";
import type { RepositoryContext } from "./context";

/**
 * Makes a data table a plain table again. Its formula columns stop
 * computing. A plain table has at least one row, so a table with none
 * gets one.
 */
export async function dropColumns(ctx: RepositoryContext, tableId: string): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    writer.setLabel(`Remove the column names of ${table.name}`);
    await ctx.keepVersion(
      tx,
      table.spreadsheetId,
      `Before removing the column names of ${table.name}`,
    );
    await writer.updateTable(tableId, { columns: null, display: { sort: [] } });
    if ((await orderedRows(tx, tableId)).length === 0) await writer.insertRows(tableId, 0, 1);
  });
  return change;
}

/**
 * Changes a column's name, type, or formula. A rename rewrites the formulas
 * that name the column. A column that becomes a formula column loses what
 * was typed into it.
 */
export async function updateColumn(
  ctx: RepositoryContext,
  tableId: string,
  colId: string,
  changes: {
    name?: string | undefined;
    type?: ColumnType | undefined;
    formula?: string | undefined;
    choices?: string[] | undefined;
    choicesFrom?: { tableId: string; colId: string } | undefined;
    revision?: number | undefined;
  },
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (found, tx, writer) => {
    const col = found.colIds.indexOf(colId);
    if (col < 0) throw columnDeleted();
    const before = found.columns?.[col];
    if (!found.columns)
      throw unprocessable("not_a_data_table", `${found.name} has no named columns`);
    if (!before)
      throw unprocessable("out_of_bounds", `${found.name} has no column ${columnLabel(col)}`);
    writer.setLabel(
      changes.name !== undefined ? `Rename column ${before.name}` : `Change column ${before.name}`,
    );

    const name = changes.name ?? before.name;
    const taken = found.columns.some(
      (other, index) => index !== col && sameColumnName(other.name, name),
    );
    if (taken) throw conflict(`A column named ${name} already exists`);
    const type = changes.type ?? before.type;
    const given = (changes.formula ?? before.formula ?? "").trim();
    if (type === "formula" && (given === "" || given === "=")) {
      throw unprocessable("formula_required", "A formula column needs a formula");
    }
    // Giving a list replaces a source column and the other way round. Neither is kept by other types.
    const choices =
      changes.choicesFrom === undefined ? (changes.choices ?? before.choices) : undefined;
    const choicesFrom =
      changes.choices === undefined ? (changes.choicesFrom ?? before.choicesFrom) : undefined;
    if (type === "choice") {
      if ((choices?.length ?? 0) === 0 && !choicesFrom) {
        throw unprocessable(
          "choices_required",
          "A dropdown column needs a list of choices or a column to take them from",
        );
      }
      // A source that is already stored may since have been deleted, which must not stop a rename.
      if (changes.choicesFrom) await ctx.checkChoiceSource(tx, found, changes.choicesFrom);
    }
    const column = normalized({
      name,
      type,
      formula: given,
      ...(choices ? { choices } : {}),
      ...(choicesFrom ? { choicesFrom } : {}),
    });

    if (type === "formula" && before.type !== "formula") {
      await ctx.keepVersion(
        tx,
        found.spreadsheetId,
        `Before making ${before.name} a formula column`,
      );
    }
    const renamed = !sameColumnName(before.name, name) || before.name !== name;
    if (renamed) {
      await ctx.rewriteFormulas(tx, writer, found.spreadsheetId, {
        kind: "column",
        tableId,
        from: before.name,
        name,
      });
    }
    // The rename may have rewritten the other formula columns of this table.
    const current =
      (await ctx.within(tx).repository.findTable(tableId, "write")).columns ?? found.columns;
    // A formula column's own formula is taken from the request when it gives one, and
    // otherwise from the rewrite, which has the new name written into it.
    const kept = current[col];
    const next =
      type === "formula" && changes.formula === undefined && kept?.formula !== undefined
        ? { ...column, formula: kept.formula }
        : column;
    await writer.updateTable(tableId, { columns: current.with(col, next) });
    if (type === "formula") await writer.clearCells(tableId, eq(cells.colId, colId));
  });
  return change;
}

/**
 * Refuses a column to take a dropdown's choices from unless it is a column
 * of a data table in the same spreadsheet.
 */
export async function checkChoiceSource(
  ctx: RepositoryContext,
  tx: Database,
  table: Found<TableRecord>,
  source: { tableId: string; colId: string },
): Promise<void> {
  const found = await ctx
    .within(tx)
    .repository.findTable(source.tableId, "read")
    .catch(() => undefined);
  if (found?.spreadsheetId !== table.spreadsheetId || !found.columns || found.id === table.id) {
    throw unprocessable(
      "invalid_choice_source",
      "Choices can come from a column of another data table in this document",
    );
  }
  if (!found.colIds.includes(source.colId)) throw columnDeleted();
}
