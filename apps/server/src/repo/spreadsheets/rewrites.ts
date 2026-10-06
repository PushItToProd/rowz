import {
  columnFormulasAfterMove,
  columnFormulasAfterRename,
  filterFormulasAfterMove,
  filterFormulasAfterRename,
  nameFormulasAfterMove,
  nameFormulasAfterRename,
  type NameFormula,
  inputsAfterMove,
  inputsAfterRename,
  viewsAfterMove,
  viewsAfterRename,
  type ColumnDefinition,
  type ColumnFormula,
  type FilterFormula,
  type Move,
  type Rename,
  type StoredInput,
  type TableName,
} from "@spreadsheet-app/engine";
import type { Database } from "../../db/client";
import { type Contents } from "../contents";
import { type ContentWriter } from "../journal";

import { type TableRecord } from "./records";
import type { RepositoryContext } from "./context";

/**
 * Rewrites the formulas that name a page, table, or column about to be
 * renamed. Must run inside `change`, before the rename itself: the old name
 * is how the formulas are recognized, and a cell saved during the rename
 * would keep the old name.
 */
export async function rewriteFormulas(
  ctx: RepositoryContext,
  tx: Database,
  writer: ContentWriter,
  spreadsheetId: string,
  rename: Rename,
): Promise<Contents> {
  const contents = await ctx.within(tx).repository.read(spreadsheetId);
  const { data } = contents;
  await ctx.storeRewrite(writer, contents, {
    cells: inputsAfterRename(data, rename),
    views: viewsAfterRename(data, data.views, rename),
    columns: columnFormulasAfterRename(data, rename),
    names: nameFormulasAfterRename(data, rename),
    filters: filterFormulasAfterRename(data, rename),
  });
  return contents;
}

/**
 * Rewrites the formulas that must name a page for a table or view to move
 * to another page. Must run inside `change`, before the move itself: where
 * things are now is how the formulas are read.
 */
export async function rewriteForMove(
  ctx: RepositoryContext,
  tx: Database,
  writer: ContentWriter,
  spreadsheetId: string,
  move: Move,
): Promise<void> {
  const contents = await ctx.within(tx).repository.read(spreadsheetId);
  const { data } = contents;
  await ctx.storeRewrite(writer, contents, {
    cells: inputsAfterMove(data, move),
    views: viewsAfterMove(data, data.views, move),
    columns: columnFormulasAfterMove(data, move),
    names: nameFormulasAfterMove(data, move),
    filters: filterFormulasAfterMove(data, move),
  });
}

/** Stores what a rewrite changed in the places that hold formulas. */
export async function storeRewrite(
  ctx: RepositoryContext,
  writer: ContentWriter,
  contents: Contents,
  rewritten: {
    cells: StoredInput[];
    views: { id: string; source: string }[];
    columns: ColumnFormula[];
    names: NameFormula[];
    filters: FilterFormula[];
  },
): Promise<void> {
  writer.markRewrites();
  await writer.setCells(rewritten.cells.map((cell) => contents.identify(cell)));
  await ctx.storeViewSources(writer, rewritten.views);
  await ctx.storeColumnFormulas(writer, contents.data.tables, rewritten.columns);
  await ctx.storeNameFormulas(writer, contents.data.tables, rewritten.names);
  await ctx.storeFilterFormulas(writer, contents.data.tables, rewritten.filters);
}

/** Stores rewritten formulas of the names tables hold. */
export async function storeNameFormulas(
  _ctx: RepositoryContext,
  writer: ContentWriter,
  before: readonly TableRecord[],
  changed: readonly NameFormula[],
): Promise<void> {
  const namesOf = new Map<string, TableName[]>();
  for (const { tableId, index, formula } of changed) {
    const names = namesOf.get(tableId) ?? [
      ...(before.find((table) => table.id === tableId)?.names ?? []),
    ];
    const held = names[index];
    if (held) names[index] = { ...held, formula };
    namesOf.set(tableId, names);
  }
  for (const [tableId, names] of namesOf) await writer.updateTable(tableId, { names });
}

/** Stores rewritten filters, and returns the tables they belong to as they now are. */
export async function storeFilterFormulas(
  _ctx: RepositoryContext,
  writer: ContentWriter,
  before: readonly TableRecord[],
  changed: readonly FilterFormula[],
): Promise<TableRecord[]> {
  const stored: TableRecord[] = [];
  for (const { tableId, formula } of changed) {
    const held = before.find((table) => table.id === tableId)?.display;
    if (!held) continue;
    stored.push(await writer.updateTable(tableId, { display: { ...held, filter: formula } }));
  }
  return stored;
}

/** Stores rewritten formulas of formula columns, and returns the tables they belong to as they now are. */
export async function storeColumnFormulas(
  _ctx: RepositoryContext,
  writer: ContentWriter,
  before: readonly TableRecord[],
  changed: readonly ColumnFormula[],
): Promise<TableRecord[]> {
  const columnsOf = new Map<string, ColumnDefinition[]>();
  for (const { tableId, col, formula } of changed) {
    const columns = columnsOf.get(tableId) ?? [
      ...(before.find((table) => table.id === tableId)?.columns ?? []),
    ];
    const column = columns[col];
    if (column) columns[col] = { ...column, formula };
    columnsOf.set(tableId, columns);
  }
  const stored: TableRecord[] = [];
  for (const [tableId, columns] of columnsOf) {
    stored.push(await writer.updateTable(tableId, { columns }));
  }
  return stored;
}

export async function storeViewSources(
  _ctx: RepositoryContext,
  writer: ContentWriter,
  changed: readonly { id: string; source: string }[],
): Promise<void> {
  for (const { id, source } of changed) {
    await writer.updateView(id, { source });
  }
}
