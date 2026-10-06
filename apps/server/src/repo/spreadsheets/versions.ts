import {
  LIMITS,
  type CellInput,
  type SpreadsheetFile,
  toSpreadsheetFile,
} from "@spreadsheet-app/shared";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import type { Database } from "../../db/client";
import { type Change } from "../journal";
import { journal, pages, versions, spreadsheets, users } from "../../db/schema";
import { notFound } from "../../errors";
import { type SpreadsheetSummary, type VersionRecord } from "./records";
import type { RepositoryContext } from "./context";

/** A version is kept when a change is made this long after the last one was. */
export const VERSION_INTERVAL_MS = 10 * 60_000;

/** The kept versions of a spreadsheet, newest first. */
export async function listVersions(
  ctx: RepositoryContext,
  spreadsheetId: string,
): Promise<VersionRecord[]> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "read");
  return ctx.db
    .select({
      id: versions.id,
      createdAt: versions.createdAt,
      reason: versions.reason,
      createdBy: users.name,
    })
    .from(versions)
    .leftJoin(users, eq(users.id, versions.createdBy))
    .where(eq(versions.spreadsheetId, spreadsheetId))
    .orderBy(desc(versions.createdAt));
}

/**
 * Puts a spreadsheet back as a kept version has it. What it holds now is
 * kept as a version first, so restoring can itself be undone. Everything is
 * replaced, with new ids, so sessions read the spreadsheet again.
 */
export async function restoreVersion(
  ctx: RepositoryContext,
  spreadsheetId: string,
  versionId: string,
): Promise<Change> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "write");
  const { change } = await ctx.change(spreadsheetId, async (tx, writer) => {
    const version = await ctx.findVersion(tx, spreadsheetId, versionId);
    await ctx.keepVersion(tx, spreadsheetId, "Before restoring an earlier version");
    await tx.delete(journal).where(eq(journal.spreadsheetId, spreadsheetId));
    // Pages take their tables, rows, cells, and views with them.
    await tx.delete(pages).where(eq(pages.spreadsheetId, spreadsheetId));
    await tx
      .update(spreadsheets)
      .set({ name: version.name })
      .where(eq(spreadsheets.id, spreadsheetId));
    await ctx.insertContents(tx, spreadsheetId, version);
    writer.markRewrites();
    writer.markUndescribed();
  });
  return change;
}

/** Makes a new spreadsheet, in the caller's own workspace, of a kept version. */
export async function copyVersion(
  ctx: RepositoryContext,
  spreadsheetId: string,
  versionId: string,
): Promise<SpreadsheetSummary> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "read");
  const version = await ctx.findVersion(ctx.db, spreadsheetId, versionId);
  const name = `${version.name} (copy)`.slice(0, LIMITS.nameLength);
  return ctx.createFromFile({ ...version, name });
}

export async function findVersion(
  _ctx: RepositoryContext,
  db: Database,
  spreadsheetId: string,
  versionId: string,
): Promise<SpreadsheetFile> {
  const [version] = await db
    .select({ data: versions.data })
    .from(versions)
    .where(and(eq(versions.id, versionId), eq(versions.spreadsheetId, spreadsheetId)));
  if (!version) throw notFound("Version");
  return version.data;
}

/**
 * Keeps the spreadsheet as it is now, before a change that cannot be taken
 * back by hand. Nothing is kept when nothing changed since the last version.
 */
export async function keepVersion(
  ctx: RepositoryContext,
  db: Database,
  spreadsheetId: string,
  reason: string,
): Promise<void> {
  const [current] = await db
    .select({ id: versions.id })
    .from(versions)
    .innerJoin(spreadsheets, eq(spreadsheets.id, versions.spreadsheetId))
    .where(
      and(
        eq(versions.spreadsheetId, spreadsheetId),
        gte(versions.createdAt, spreadsheets.updatedAt),
      ),
    )
    .limit(1);
  if (!current) await ctx.saveVersion(db, spreadsheetId, reason);
}

export async function saveVersion(
  ctx: RepositoryContext,
  db: Database,
  spreadsheetId: string,
  reason: string | null,
): Promise<void> {
  const { snapshot, data } = await ctx.within(db).repository.read(spreadsheetId);
  const cellsOf = new Map<string, CellInput[]>();
  for (const { tableId, ...cell } of data.cells) {
    const held = cellsOf.get(tableId);
    // Added in place: copying the list for each cell takes seconds for a full table.
    if (held) held.push(cell);
    else cellsOf.set(tableId, [cell]);
  }
  const file = toSpreadsheetFile(
    snapshot.name,
    snapshot.pages,
    data.tables,
    snapshot.views,
    (table) => cellsOf.get(table.id) ?? [],
  );
  await db.insert(versions).values({ spreadsheetId, createdBy: ctx.userId, reason, data: file });

  const stale = await db
    .select({ id: versions.id })
    .from(versions)
    .where(eq(versions.spreadsheetId, spreadsheetId))
    .orderBy(desc(versions.createdAt))
    .offset(LIMITS.versions);
  if (stale.length > 0) {
    await db.delete(versions).where(
      inArray(
        versions.id,
        stale.map((version) => version.id),
      ),
    );
  }
}
