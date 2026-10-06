import { and, asc, eq, gte, sql, sum } from "drizzle-orm";
import { noteChange } from "../../changes";
import { Contents } from "../contents";
import {
  actionRuns,
  cells,
  pages,
  spreadsheets,
  tables,
  tableRows,
  users,
  views,
  workspaceMembers,
  workspaces,
} from "../../db/schema";
import { notFound } from "../../errors";
import { type Snapshot } from "./records";
import { pageColumns, tableColumns, viewColumns } from "./context";
import type { RepositoryContext } from "./context";

/**
 * Reads a spreadsheet for the formula engine, which names cells by
 * position. Inside a change the read is as current as the lock makes it.
 */
export async function read(ctx: RepositoryContext, spreadsheetId: string): Promise<Contents> {
  return new Contents(await ctx.repository.getSnapshot(spreadsheetId));
}

/**
 * Everything a spreadsheet holds, as of one moment. The queries run in one
 * transaction that sees the database as it was when it began, so a change
 * that commits between two of them cannot give tables from before it and
 * cells from after. Inside a change the transaction is the change's own, and
 * the lock is what holds the spreadsheet still.
 */
export async function getSnapshot(
  ctx: RepositoryContext,
  spreadsheetId: string,
): Promise<Snapshot> {
  return ctx.db.transaction(
    async (tx) => {
      const spreadsheet = await ctx.within(tx).repository.findSpreadsheet(spreadsheetId, "read");
      const [counted] = await tx
        .select({ revision: spreadsheets.revision })
        .from(spreadsheets)
        .where(eq(spreadsheets.id, spreadsheetId));
      const pageRows = await tx
        .select(pageColumns)
        .from(pages)
        .where(eq(pages.spreadsheetId, spreadsheetId))
        .orderBy(asc(pages.position));
      const tableRecords = await tx
        .select(tableColumns)
        .from(tables)
        .innerJoin(pages, eq(pages.id, tables.pageId))
        .where(eq(pages.spreadsheetId, spreadsheetId))
        .orderBy(asc(tables.position));
      const rowRecords = await tx
        .select({ id: tableRows.id, tableId: tableRows.tableId, orderKey: tableRows.orderKey })
        .from(tableRows)
        .innerJoin(tables, eq(tables.id, tableRows.tableId))
        .innerJoin(pages, eq(pages.id, tables.pageId))
        .where(eq(pages.spreadsheetId, spreadsheetId))
        .orderBy(asc(tableRows.tableId), asc(tableRows.orderKey));
      const cellRows = await tx
        .select({
          tableId: cells.tableId,
          rowId: cells.rowId,
          colId: cells.colId,
          input: cells.input,
        })
        .from(cells)
        .innerJoin(tables, eq(tables.id, cells.tableId))
        .innerJoin(pages, eq(pages.id, tables.pageId))
        .where(eq(pages.spreadsheetId, spreadsheetId));
      const viewRows = await tx
        .select(viewColumns)
        .from(views)
        .innerJoin(pages, eq(pages.id, views.pageId))
        .where(eq(pages.spreadsheetId, spreadsheetId))
        .orderBy(asc(views.position));
      return {
        ...spreadsheet,
        revision: counted?.revision ?? 0,
        pages: pageRows,
        tables: tableRecords,
        rows: rowRecords,
        views: viewRows,
        cells: cellRows,
      };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

/** How many changes have been made to what a spreadsheet holds. */
export async function revisionOf(ctx: RepositoryContext, spreadsheetId: string): Promise<number> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "read");
  const [counted] = await ctx.db
    .select({ revision: spreadsheets.revision })
    .from(spreadsheets)
    .where(eq(spreadsheets.id, spreadsheetId));
  return counted?.revision ?? 0;
}

export async function renameSpreadsheet(
  ctx: RepositoryContext,
  spreadsheetId: string,
  name: string,
): Promise<void> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "write");
  noteChange(spreadsheetId);
  await ctx.db
    .update(spreadsheets)
    .set({ name, updatedAt: sql`now()` })
    .where(eq(spreadsheets.id, spreadsheetId));
}

export async function deleteSpreadsheet(
  ctx: RepositoryContext,
  spreadsheetId: string,
): Promise<void> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "own");
  // Sessions that have it open learn that it is gone.
  noteChange(spreadsheetId);
  await ctx.db.delete(spreadsheets).where(eq(spreadsheets.id, spreadsheetId));
}

/**
 * Makes other transactions that count this user's email wait until this one
 * ends. Without it, two clicks at once would each count the email sent so
 * far, find room, and together send more than the limit.
 */
export async function lockUser(ctx: RepositoryContext): Promise<void> {
  await ctx.db.select({ id: users.id }).from(users).where(eq(users.id, ctx.userId)).for("update");
}

/** How many emails the user's button clicks set out to send since `since`. */
export async function countEmails(ctx: RepositoryContext, since: Date): Promise<number> {
  const [counted] = await ctx.db
    .select({ emails: sum(actionRuns.emails).mapWith(Number) })
    .from(actionRuns)
    .where(and(eq(actionRuns.userId, ctx.userId), gte(actionRuns.createdAt, since)));
  return counted?.emails ?? 0;
}

/**
 * The workspace new spreadsheets go into: the user's oldest one, created on
 * first use. Must run in a transaction. Locking the user row makes two
 * concurrent first requests wait for each other instead of each creating a
 * workspace.
 */
export async function personalWorkspace(ctx: RepositoryContext): Promise<string> {
  const [user] = await ctx.db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, ctx.userId))
    .for("update");
  if (!user) throw notFound("User");

  const [membership] = await ctx.db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.userId, ctx.userId))
    .orderBy(asc(workspaceMembers.createdAt))
    .limit(1);
  if (membership) return membership.workspaceId;

  const [workspace] = await ctx.db
    .insert(workspaces)
    .values({ name: `${user.name}'s workspace` })
    .returning({ id: workspaces.id });
  if (!workspace) throw new Error("Insert returned no workspace");
  await ctx.db
    .insert(workspaceMembers)
    .values({ workspaceId: workspace.id, userId: ctx.userId, role: "owner" });
  return workspace.id;
}
