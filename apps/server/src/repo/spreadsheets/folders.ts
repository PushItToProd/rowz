import { createWorkbook, documentErrors } from "@spreadsheet-app/engine";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Database } from "../../db/client";
import { documentFolders, folders, spreadsheets } from "../../db/schema";
import { conflict, isUniqueViolation, notFound } from "../../errors";
import { type ListedSpreadsheet, type FolderRecord, type DocumentList } from "./records";
import type { RepositoryContext } from "./context";

/** Shared across request repositories; access is still checked by the list query. */
export const diagnosticCaches = new WeakMap<
  Database,
  Map<string, { revision: number; hasErrors: boolean }>
>();

export const MAX_DIAGNOSTIC_CACHE_ENTRIES = 256;

export async function listSpreadsheets(ctx: RepositoryContext): Promise<DocumentList> {
  const [listed, listedFolders] = await Promise.all([
    ctx.db
      .select({
        id: spreadsheets.id,
        name: spreadsheets.name,
        revision: spreadsheets.revision,
        updatedAt: spreadsheets.updatedAt,
        role: ctx.access.role,
        folderId: documentFolders.folderId,
      })
      .from(spreadsheets)
      .innerJoin(ctx.access, ctx.granted())
      .leftJoin(
        documentFolders,
        and(
          eq(documentFolders.spreadsheetId, spreadsheets.id),
          eq(documentFolders.userId, ctx.userId),
        ),
      )
      .orderBy(desc(spreadsheets.updatedAt)),
    ctx.db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(eq(folders.userId, ctx.userId))
      .orderBy(sql`lower(${folders.name})`, asc(folders.name)),
  ]);
  let cache = diagnosticCaches.get(ctx.db);
  if (!cache) {
    cache = new Map();
    diagnosticCaches.set(ctx.db, cache);
  }
  const documents: ListedSpreadsheet[] = [];
  for (const { revision, ...item } of listed) {
    const cached = cache.get(item.id);
    if (cached?.revision === revision) {
      documents.push({ ...item, hasErrors: cached.hasErrors });
      continue;
    }
    const { data, snapshot } = await ctx.repository.read(item.id);
    const hasErrors = documentErrors(createWorkbook(data), data.tables, data.views).length > 0;
    cache.delete(item.id);
    // A conservative scan also catches calls in scripts and Markdown templates.
    // Clock-dependent results can change without a content revision.
    if (!/\b(?:NOW|TODAY)\b/i.test(JSON.stringify(data))) {
      if (cache.size >= MAX_DIAGNOSTIC_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value;
        if (oldest !== undefined) cache.delete(oldest);
      }
      cache.set(item.id, { revision: snapshot.revision, hasErrors });
    }
    documents.push({ ...item, hasErrors });
  }
  return { folders: listedFolders, documents };
}

export async function createFolder(ctx: RepositoryContext, name: string): Promise<FolderRecord> {
  try {
    const [folder] = await ctx.db
      .insert(folders)
      .values({ userId: ctx.userId, name })
      .returning({ id: folders.id, name: folders.name });
    if (!folder) throw new Error("Insert returned no folder");
    return folder;
  } catch (cause) {
    if (isUniqueViolation(cause)) throw conflict(`A folder named ${name} already exists`);
    throw cause;
  }
}

export async function renameFolder(
  ctx: RepositoryContext,
  folderId: string,
  name: string,
): Promise<FolderRecord> {
  try {
    const [folder] = await ctx.db
      .update(folders)
      .set({ name })
      .where(and(eq(folders.id, folderId), eq(folders.userId, ctx.userId)))
      .returning({ id: folders.id, name: folders.name });
    if (!folder) throw notFound("Folder");
    return folder;
  } catch (cause) {
    if (isUniqueViolation(cause)) throw conflict(`A folder named ${name} already exists`);
    throw cause;
  }
}

export async function deleteFolder(ctx: RepositoryContext, folderId: string): Promise<void> {
  const deleted = await ctx.db
    .delete(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, ctx.userId)))
    .returning({ id: folders.id });
  if (deleted.length === 0) throw notFound("Folder");
}

/** Moves a document in this user's list; a missing folder puts it at the root. */
export async function moveDocument(
  ctx: RepositoryContext,
  spreadsheetId: string,
  folderId: string | null,
): Promise<void> {
  await ctx.repository.findSpreadsheet(spreadsheetId, "read");
  if (folderId === null) {
    await ctx.db
      .delete(documentFolders)
      .where(
        and(
          eq(documentFolders.userId, ctx.userId),
          eq(documentFolders.spreadsheetId, spreadsheetId),
        ),
      );
    return;
  }

  const [folder] = await ctx.db
    .select({ id: folders.id })
    .from(folders)
    .where(and(eq(folders.id, folderId), eq(folders.userId, ctx.userId)));
  if (!folder) throw notFound("Folder");

  await ctx.db
    .insert(documentFolders)
    .values({ userId: ctx.userId, spreadsheetId, folderId })
    .onConflictDoUpdate({
      target: [documentFolders.userId, documentFolders.spreadsheetId],
      set: { folderId },
    });
}
