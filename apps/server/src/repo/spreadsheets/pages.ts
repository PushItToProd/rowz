import { DEFAULT_TABLE_SIZE, FILE_LIMITS } from "@spreadsheet-app/shared";
import { and, eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { type ContentWriter, type Change } from "../journal";
import { pages, tables, views } from "../../db/schema";
import { conflict, isUniqueViolation, notFound, unprocessable } from "../../errors";
import { type PageRecord, type TableRecord, type Found, type Created } from "./records";
import { nextName, rethrowDuplicate } from "./helpers";
import type { RepositoryContext } from "./context";

/** Creates a page with one empty table. Without a name the page gets the next free `Page N`. */
export async function createPage(
  ctx: RepositoryContext,
  spreadsheetId: string,
  name?: string,
): Promise<Created<{ page: PageRecord; table: TableRecord }>> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "write");
  const { result, change } = await ctx.change(spreadsheetId, async (tx, writer) => {
    writer.setLabel("Add page");
    const siblings = await tx
      .select({ name: pages.name, position: pages.position })
      .from(pages)
      .where(eq(pages.spreadsheetId, spreadsheetId));
    if (siblings.length >= FILE_LIMITS.pages) {
      throw unprocessable(
        "too_many_pages",
        `A document can have at most ${String(FILE_LIMITS.pages)} pages`,
      );
    }
    const values = {
      spreadsheetId,
      name:
        name ??
        nextName(
          "Page",
          siblings.map((page) => page.name),
        ),
      position: Math.max(-1, ...siblings.map((page) => page.position)) + 1,
    };
    const page = await writer.insertPage(values).catch(rethrowDuplicate("page", values.name));
    const table = await ctx.insertTable(tx, page.id, undefined, writer);
    return { page, table };
  });
  return { ...result, change };
}

/** Renames a page and the formulas that name it. */
export async function renamePage(
  ctx: RepositoryContext,
  pageId: string,
  name: string,
): Promise<Change> {
  const { change } = await ctx.changePage(pageId, async (page, tx, writer) => {
    writer.setLabel(`Rename page ${page.name}`);
    await ctx.rewriteFormulas(tx, writer, page.spreadsheetId, { kind: "page", pageId, name });
    await writer.updatePage(pageId, { name }).catch(rethrowDuplicate("page", name));
  });
  return change;
}

/**
 * Puts the blocks of a page in the order given. The
 * list must name every one of them once, so that a stale client cannot
 * leave two blocks in one place.
 */
export async function reorderPage(
  ctx: RepositoryContext,
  pageId: string,
  blocks: readonly string[],
): Promise<Change> {
  const { change } = await ctx.changePage(pageId, async (page, tx, writer) => {
    writer.setLabel(`Reorder blocks on ${page.name}`);
    const [tableRecords, viewRecords] = await Promise.all([
      tx.select({ id: tables.id }).from(tables).where(eq(tables.pageId, pageId)),
      tx.select({ id: views.id }).from(views).where(eq(views.pageId, pageId)),
    ]);
    const tableIds = new Set(tableRecords.map((table) => table.id));
    const present = new Set([...tableIds, ...viewRecords.map((view) => view.id)]);
    const complete =
      blocks.length === present.size &&
      new Set(blocks).size === blocks.length &&
      blocks.every((id) => present.has(id));
    if (!complete) {
      throw conflict("The page has changed. Reload it and try again");
    }
    for (const [position, id] of blocks.entries()) {
      if (tableIds.has(id)) await writer.updateTable(id, { position });
      else await writer.updateView(id, { position });
    }
  });
  return change;
}

/**
 * Puts the pages of a spreadsheet in the order given. The list must name
 * every one of them once, so that a stale client cannot leave two pages in
 * one place.
 */
export async function reorderPages(
  ctx: RepositoryContext,
  spreadsheetId: string,
  order: readonly string[],
): Promise<Change> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "write");
  const { change } = await ctx.change(spreadsheetId, async (tx, writer) => {
    writer.setLabel("Reorder pages");
    const rows = await tx
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.spreadsheetId, spreadsheetId));
    const present = new Set(rows.map((row) => row.id));
    const complete =
      order.length === present.size &&
      new Set(order).size === order.length &&
      order.every((id) => present.has(id));
    if (!complete) {
      throw conflict("The pages have changed. Reload the document and try again");
    }
    for (const [position, id] of order.entries()) {
      await writer.updatePage(id, { position });
    }
  });
  return change;
}

/** The names of a page's tables and scripts, which formulas use to qualify a name such as `Summary!Total`. */
export async function holderNames(
  _ctx: RepositoryContext,
  tx: Database,
  pageId: string,
): Promise<string[]> {
  const [tableRows, scriptRows] = await Promise.all([
    tx.select({ name: tables.name }).from(tables).where(eq(tables.pageId, pageId)),
    tx
      .select({ name: views.name })
      .from(views)
      .where(and(eq(views.pageId, pageId), eq(views.kind, "script"))),
  ]);
  return [...tableRows, ...scriptRows].map((row) => row.name);
}

/**
 * Refuses a name for a table or script that a script on the page has, or,
 * for a script, that a table has, ignoring case, so that `Summary!Total`
 * means one of them. The database refuses a table with another table's
 * name; scripts are views, which no index covers.
 */
export async function checkHolderName(
  _ctx: RepositoryContext,
  tx: Database,
  pageId: string,
  name: string,
  subject: { kind: "table" | "script"; id?: string },
): Promise<void> {
  const key = name.toLowerCase();
  const named = (row: { id: string; name: string }): boolean =>
    row.id !== subject.id && row.name.toLowerCase() === key;
  const scriptRows = await tx
    .select({ id: views.id, name: views.name })
    .from(views)
    .where(and(eq(views.pageId, pageId), eq(views.kind, "script")));
  if (scriptRows.some(named)) throw conflict(`A script named ${name} already exists`);
  if (subject.kind === "table") return;
  const tableRows = await tx
    .select({ id: tables.id, name: tables.name })
    .from(tables)
    .where(eq(tables.pageId, pageId));
  if (tableRows.some(named)) throw conflict(`A table named ${name} already exists`);
}

/**
 * The page a block is to move to: another page of the block's own
 * spreadsheet. Must run inside `change`.
 */
export async function destination(
  ctx: RepositoryContext,
  tx: Database,
  block: Found<{ pageId: string; name: string }>,
  pageId: string,
): Promise<PageRecord> {
  const page = await ctx.within(tx).repository.findPage(pageId, "write");
  // A page of another spreadsheet is reported as a page of this one that does not exist.
  if (page.spreadsheetId !== block.spreadsheetId) throw notFound("Page");
  if (page.id === block.pageId) {
    throw unprocessable("same_page", `${block.name} is already on ${page.name}`);
  }
  return page;
}

/**
 * Moves a table to the end of another page of its spreadsheet. A table name
 * alone in a formula means a table on the formula's own page, so formulas
 * that would come to mean another table are rewritten to name the page.
 */
export async function moveTable(
  ctx: RepositoryContext,
  tableId: string,
  pageId: string,
): Promise<Change> {
  const { change } = await ctx.changeTable(tableId, async (table, tx, writer) => {
    const page = await ctx.destination(tx, table, pageId);
    const position = await ctx.within(tx).nextPosition(pageId);
    writer.setLabel(`Move table ${table.name}`);
    await ctx.rewriteForMove(tx, writer, table.spreadsheetId, {
      kind: "table",
      tableId,
      pageId,
    });
    await ctx.checkHolderName(tx, pageId, table.name, { kind: "table", id: tableId });
    await writer.updateTable(tableId, { pageId, position }).catch((cause: unknown) => {
      if (!isUniqueViolation(cause)) throw cause;
      throw conflict(`${page.name} already has a table named ${table.name}`);
    });
  });
  return change;
}

/**
 * Moves a chart or text view to the end of another page of its
 * spreadsheet. Where its source named a table by name alone, it now names
 * the page too, and so reads the same table.
 */
export async function moveView(
  ctx: RepositoryContext,
  viewId: string,
  pageId: string,
): Promise<Change> {
  const { change } = await ctx.changeView(viewId, async (view, tx, writer) => {
    await ctx.destination(tx, view, pageId);
    if (view.kind === "script") {
      await ctx.checkHolderName(tx, pageId, view.name, { kind: "script", id: viewId });
    }
    const position = await ctx.within(tx).nextPosition(pageId);
    writer.setLabel(`Move ${view.kind} ${view.name}`);
    await ctx.rewriteForMove(tx, writer, view.spreadsheetId, {
      kind: "view",
      viewId,
      pageId,
    });
    await writer.updateView(viewId, { pageId, position });
  });
  return change;
}

export async function insertTable(
  ctx: RepositoryContext,
  tx: Database,
  pageId: string,
  name: string | undefined,
  writer: ContentWriter,
  position?: number,
): Promise<TableRecord> {
  if (name !== undefined) await ctx.checkHolderName(tx, pageId, name, { kind: "table" });
  const values = {
    pageId,
    name: name ?? nextName("Table", await ctx.holderNames(tx, pageId)),
    position: await ctx.within(tx).insertPosition(pageId, writer, position),
  };
  return writer
    .insertTable(values, DEFAULT_TABLE_SIZE)
    .catch(rethrowDuplicate("table", values.name));
}

export async function deletePage(ctx: RepositoryContext, pageId: string): Promise<Change> {
  const { change } = await ctx.changePage(pageId, async (page, tx, writer) => {
    writer.setLabel(`Delete page ${page.name}`);
    const remaining = await tx.$count(pages, eq(pages.spreadsheetId, page.spreadsheetId));
    if (remaining <= 1) throw conflict("A document needs at least one page");
    await ctx.keepVersion(tx, page.spreadsheetId, `Before deleting the page ${page.name}`);
    await writer.deletePage(pageId);
  });
  return change;
}

/** Makes room at a display index, journaling shifted blocks under the page lock. */
export async function insertPosition(
  ctx: RepositoryContext,
  pageId: string,
  writer: ContentWriter,
  index?: number,
): Promise<number> {
  const end = await ctx.nextPosition(pageId);
  if (index === undefined) return end;
  const [pageTables, pageViews] = await Promise.all([
    ctx.db
      .select({ id: tables.id, position: tables.position })
      .from(tables)
      .where(eq(tables.pageId, pageId)),
    ctx.db
      .select({ id: views.id, position: views.position })
      .from(views)
      .where(eq(views.pageId, pageId)),
  ]);
  const blocks = [...pageTables, ...pageViews].sort((a, b) => a.position - b.position);
  if (index > blocks.length) {
    throw unprocessable(
      "invalid_position",
      "Insertion position exceeds the number of blocks on the page",
    );
  }
  const tableIds = new Set(pageTables.map(({ id }) => id));
  for (const [offset, block] of blocks.entries()) {
    const position = offset < index ? offset : offset + 1;
    if (position === block.position) continue;
    if (tableIds.has(block.id)) await writer.updateTable(block.id, { position });
    else await writer.updateView(block.id, { position });
  }
  return index;
}

/**
 * The position that puts a new block after everything else on its
 * page. Refuses when the page already holds as many as a file of it may.
 */
export async function nextPosition(ctx: RepositoryContext, pageId: string): Promise<number> {
  const taken = await Promise.all([
    ctx.db.select({ position: tables.position }).from(tables).where(eq(tables.pageId, pageId)),
    ctx.db.select({ position: views.position }).from(views).where(eq(views.pageId, pageId)),
  ]);
  const blocks = taken.flat();
  if (blocks.length >= FILE_LIMITS.blocksPerPage) {
    throw unprocessable(
      "page_full",
      `A page can have at most ${String(FILE_LIMITS.blocksPerPage)} blocks`,
    );
  }
  return Math.max(-1, ...blocks.map((block) => block.position)) + 1;
}
