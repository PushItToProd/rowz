import {
  defaultFunctions,
  refusedName,
  renamedNames,
  nameFormulaAfterRename,
  type SortKey,
  type TableName,
} from "@spreadsheet-app/engine";
import { type UpdateTableBody } from "@spreadsheet-app/shared";
import { randomUUID } from "node:crypto";

import { orderedRows, type Change } from "../journal";

import { columnDeleted, conflict, notFound, unprocessable } from "../../errors";
import { type TableRecord, type Created } from "./records";
import { filterFormula, resized, columnNameFrom, rethrowDuplicate } from "./helpers";
import type { RepositoryContext } from "./context";

export async function deleteTable(ctx: RepositoryContext, tableId: string): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    writer.setLabel(`Delete table ${table.name}`);
    await ctx.keepVersion(tx, table.spreadsheetId, `Before deleting the table ${table.name}`);
    await writer.deleteTable(tableId);
  });
  return change;
}

/** Creates an empty table. Without a name the table gets the next free `Table N`. */
export async function createTable(
  ctx: RepositoryContext,
  pageId: string,
  name?: string,
  position?: number,
): Promise<Created<{ table: TableRecord }>> {
  const { result, change } = await ctx.changePage(pageId, async (_page, tx, writer) => {
    writer.setLabel("Add table");
    return ctx.insertTable(tx, pageId, name, writer, position);
  });
  return { table: result, change };
}

/**
 * Renames or resizes a table. Renaming rewrites the formulas that name the
 * table. A size is counted from the start of the table: rows and columns
 * are added at its end, and making it smaller deletes the ones past the new
 * size as any others are deleted, so formulas, views, and formats follow.
 */
export async function updateTable(
  ctx: RepositoryContext,
  tableId: string,
  changes: UpdateTableBody,
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    const { spreadsheetId } = table;
    writer.setLabel(
      changes.name !== undefined ? `Rename table ${table.name}` : `Resize table ${table.name}`,
    );
    const rows = await orderedRows(tx, tableId);
    const requestedRows = changes.rowCount ?? rows.length;
    const requestedCols = changes.colCount ?? table.colIds.length;
    const sizes = [
      {
        axis: "row",
        from: rows.length,
        to: changes.grow ? Math.max(rows.length, requestedRows) : requestedRows,
      },
      {
        axis: "col",
        from: table.colIds.length,
        to: changes.grow ? Math.max(table.colIds.length, requestedCols) : requestedCols,
      },
    ] as const;
    const [height, width] = sizes;
    if (height.to === 0 && !table.columns) {
      throw unprocessable("last_one", "A table needs at least one row");
    }
    if (sizes.some(({ from, to }) => to < from)) {
      await ctx.keepVersion(tx, spreadsheetId, `Before making ${table.name} smaller`);
    }
    for (const { axis, from, to } of sizes) {
      if (to >= from) continue;
      const edit = { tableId, axis, kind: "delete", index: to, count: from - to } as const;
      await ctx.applyEdit(tx, writer, spreadsheetId, edit);
    }
    if (changes.name !== undefined) {
      await ctx.checkHolderName(tx, table.pageId, changes.name, { kind: "table", id: tableId });
      const rename = { kind: "table", tableId, name: changes.name } as const;
      await ctx.rewriteFormulas(tx, writer, spreadsheetId, rename);
    }
    if (height.to > height.from) {
      await writer.insertRows(tableId, height.from, height.to - height.from);
    }
    // The steps above may have rewritten this table's own formula columns.
    const current = await ctx.within(tx).repository.findTable(tableId, "write");
    const added = Array.from({ length: Math.max(0, width.to - width.from) }, () => randomUUID());
    await writer
      .updateTable(tableId, {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        colIds: [...current.colIds, ...added],
        columns: current.columns && resized(current.columns, current.colIds.length + added.length),
      })
      .catch(rethrowDuplicate("table", changes.name ?? ""));
  });
  return change;
}

/**
 * Gives a plain table named columns, which makes it a data table. With
 * `headerRow`, the first row supplies the names and is removed from the
 * data. Otherwise the columns are named Column 1, Column 2, and so on.
 *
 * A data table holds the rows that were added to it and no unused ones, so
 * the empty rows at the end of the table are deleted, which can be all of
 * them. They are deleted as any rows are, so formulas that read them follow.
 */
export async function nameColumns(
  ctx: RepositoryContext,
  tableId: string,
  headerRow: boolean,
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    if (table.columns) throw conflict(`${table.name} already has named columns`);
    if (table.names.length > 0) {
      throw conflict(`${table.name} holds names, and a table with named columns holds none`);
    }
    const { spreadsheetId } = table;
    writer.setLabel(`Name the columns of ${table.name}`);
    if (headerRow) {
      await ctx.keepVersion(tx, spreadsheetId, `Before naming the columns of ${table.name}`);
    }
    const { data } = await ctx.within(tx).repository.read(spreadsheetId);
    const filled = data.cells.filter((cell) => cell.tableId === tableId);
    const taken = headerRow ? 1 : 0;
    const header = filled.filter((cell) => cell.row < taken);
    let height = data.tables.find((candidate) => candidate.id === tableId)?.rowCount ?? 0;
    const remove = async (index: number, count: number): Promise<void> => {
      if (count <= 0) return;
      const edit = { tableId, axis: "row", kind: "delete", index, count } as const;
      await ctx.applyEdit(tx, writer, spreadsheetId, edit);
      height -= count;
    };
    // Taking the header row out moves every row up, and formulas follow as for any deleted row.
    await remove(0, Math.min(taken, height));
    const used = Math.max(0, ...filled.map((cell) => cell.row + 1 - taken));
    await remove(used, height - used);

    const typed = new Map(header.map(({ col, input }) => [col, input]));
    const names: string[] = [];
    for (let col = 0; col < table.colIds.length; col += 1) {
      names.push(columnNameFrom(typed.get(col), names));
    }
    await writer.updateTable(tableId, {
      columns: names.map((name) => ({ name, type: "any" as const })),
    });
  });
  return change;
}

/**
 * Replaces the names a plain table holds. A name cannot be one that reads as
 * a cell address, a value, or a function, and a table lists a name once.
 */
export async function setTableNames(
  ctx: RepositoryContext,
  tableId: string,
  names: TableName[],
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    if (table.columns && names.length > 0) {
      throw conflict(`${table.name} has named columns, and such a table holds no names`);
    }
    const seen = new Set<string>();
    for (const { name } of names) {
      const refused = refusedName(name, defaultFunctions);
      if (refused !== undefined) throw unprocessable("invalid_name", refused);
      if (seen.has(name.toLowerCase())) {
        throw conflict(`${table.name} already has a name ${name}`);
      }
      seen.add(name.toLowerCase());
    }
    writer.setLabel(`Change the names of ${table.name}`);
    let changed = [...names];
    for (const rename of renamedNames(table.names, names)) {
      const contents = await ctx.rewriteFormulas(tx, writer, table.spreadsheetId, {
        kind: "name",
        holderId: tableId,
        ...rename,
      });
      changed = changed.map((entry) => ({
        ...entry,
        formula: nameFormulaAfterRename(contents.data, tableId, entry.formula, {
          kind: "name",
          holderId: tableId,
          ...rename,
        }),
      }));
    }
    await writer.updateTable(tableId, { names: changed });
  });
  return change;
}

/** Updates a named formula against the current list under the spreadsheet lock. */
export async function updateNamedFormula(
  ctx: RepositoryContext,
  tableId: string,
  name: string,
  formula: string,
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, _tx, writer) => {
    const index = table.names.findIndex((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (index < 0) throw notFound("Name");
    writer.setLabel(`Change formula of ${name} in ${table.name}`);
    await writer.updateTable(tableId, {
      names: table.names.map((entry, position) =>
        position === index ? { ...entry, formula } : entry,
      ),
    });
  });
  return change;
}

/**
 * Replaces how a data table's rows are shown: its sort and filter. Neither
 * changes the stored row order. The submitted filter is accepted literally.
 */
export async function setTableDisplay(
  ctx: RepositoryContext,
  tableId: string,
  display: { sort: SortKey[]; filter?: string | undefined; revision?: number | undefined },
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    if (!table.columns) {
      throw unprocessable("not_a_data_table", `${table.name} has no named columns`);
    }
    if (display.sort.some(({ colId }) => !table.colIds.includes(colId))) throw columnDeleted();
    const written = display.filter?.trim() ?? "";
    const filter = written === "" || written === "=" ? "" : filterFormula(written);
    writer.setLabel(`Sort and filter ${table.name}`);
    await writer.updateTable(tableId, {
      display: { sort: display.sort, ...(filter === "" ? {} : { filter }) },
    });
  });
  return change;
}
