import { LIMITS } from "@spreadsheet-app/shared";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, lt, sql } from "drizzle-orm";
import { noteChange, noteJournaled, requestContext } from "../../changes";
import type { Database } from "../../db/client";
import type { SpreadsheetRepository } from "../spreadsheets";
import { ContentWriter } from "../journal";
import {
  deletedRows,
  journal,
  pages,
  spreadsheetMembers,
  versions,
  spreadsheets,
  tables,
  views,
  workspaceMembers,
  type Role,
} from "../../db/schema";
import { conflict, forbidden, notFound, ownerOnly } from "../../errors";
import {
  type Access,
  type PageRecord,
  type TableRecord,
  type ViewRecord,
  type Found,
  type RepositoryOptions,
  type Outcome,
} from "./records";
import { VERSION_INTERVAL_MS } from "./versions";
import * as documentsOperations from "./documents";
import * as foldersOperations from "./folders";
import * as sharingOperations from "./sharing";
import * as filesOperations from "./files";
import * as versionsOperations from "./versions";
import * as pagesOperations from "./pages";
import * as tablesOperations from "./tables";
import * as formatsOperations from "./formats";
import * as columnsOperations from "./columns";
import * as viewsOperations from "./views";
import * as cellsOperations from "./cells";
import * as structureOperations from "./structure";
import * as historyOperations from "./history";
import * as rewritesOperations from "./rewrites";
import * as runsOperations from "./runs";
import * as searchOperations from "./search";

export const pageColumns = { id: pages.id, name: pages.name, position: pages.position };

export const tableColumns = {
  id: tables.id,
  pageId: tables.pageId,
  name: tables.name,
  position: tables.position,
  colIds: tables.colIds,
  gridSizes: tables.gridSizes,
  columns: tables.columns,
  formats: tables.formats,
  display: tables.display,
  conditionalFormats: tables.conditionalFormats,
  names: tables.names,
};

export const viewColumns = {
  id: views.id,
  pageId: views.pageId,
  kind: views.kind,
  name: views.name,
  position: views.position,
  source: views.source,
  chartType: views.chartType,
};

export function authorize<T extends { role: Role }>(
  row: T | undefined,
  access: Access,
  what: string,
): T {
  if (!row) throw notFound(what);
  if (access !== "read" && row.role === "viewer") throw forbidden();
  if (access === "own" && row.role !== "owner") throw ownerOnly();
  return row;
}

export async function lockSpreadsheetRow(db: Database, spreadsheetId: string): Promise<void> {
  await db
    .select({ id: spreadsheets.id })
    .from(spreadsheets)
    .where(eq(spreadsheets.id, spreadsheetId))
    .for("update");
}
/** Shared state and authorization/transaction machinery for the repository implementation. */
export class RepositoryContext {
  /**
   * Who may open which spreadsheet, and as what: the members of its
   * workspace, and the people it is shared with. Every query for spreadsheet
   * data joins this, limited to the caller.
   */
  readonly access;

  constructor(
    readonly db: Database,
    readonly userId: string,
    readonly options: RepositoryOptions,
    /** Public method calls use this instance so overrides and spies observe them. */
    readonly repository: SpreadsheetRepository,
    private readonly forTransaction: (tx: Database) => RepositoryContext,
  ) {
    this.access = db
      .select({
        spreadsheetId: spreadsheets.id,
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
      })
      .from(spreadsheets)
      .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, spreadsheets.workspaceId))
      .unionAll(
        db
          .select({
            spreadsheetId: spreadsheetMembers.spreadsheetId,
            userId: spreadsheetMembers.userId,
            role: spreadsheetMembers.role,
          })
          .from(spreadsheetMembers),
      )
      .as("access");
  }

  /** This repository on an open transaction. */
  within(tx: Database): RepositoryContext {
    return this.forTransaction(tx);
  }

  /**
   * Runs `work` in a transaction that holds the spreadsheet's lock, so one
   * such transaction at a time reads and writes it. Write access is checked
   * again under the lock: a caller that waited for it may have lost access
   * meanwhile.
   */
  async locked<T>(spreadsheetId: string, work: (tx: Database) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await lockSpreadsheetRow(tx, spreadsheetId);
      await this.within(tx).repository.findSpreadsheet(spreadsheetId, "write");
      return work(tx);
    });
  }

  /**
   * Runs a change to what a spreadsheet holds, under its lock. What `work`
   * writes through the writer becomes one journal entry, one revision, and
   * one announcement to the sessions that have the spreadsheet open. Every
   * change goes through here.
   *
   * What a caller read before the lock may be stale by the time `work` runs.
   * `work` reads again whatever it decides by, which `changePage`,
   * `changeTable`, and `changeView` do for the thing being changed.
   */
  async change<T>(
    spreadsheetId: string,
    work: (tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<Outcome<T>> {
    const outcome = await this.locked(spreadsheetId, async (tx) => {
      let journaled = false;
      const writer = new ContentWriter(
        tx,
        this.userId,
        spreadsheetId,
        this.options.journalLimits?.journalEntryBytes,
      );
      const result = await work(tx, writer);
      const recorded = writer.recorded();
      if (recorded) {
        const context = requestContext();
        const clientId = context?.clientId ?? null;
        if (clientId !== null) {
          await tx
            .delete(journal)
            .where(
              and(
                eq(journal.spreadsheetId, spreadsheetId),
                eq(journal.userId, this.userId),
                eq(journal.clientId, clientId),
                eq(journal.undone, true),
              ),
            );
        }
        await tx.insert(journal).values({
          spreadsheetId,
          step: context?.stepId ?? randomUUID(),
          userId: this.userId,
          clientId,
          rewrites: writer.rewroteReferences,
          formulas: recorded.formulas,
          label: writer.label,
          data: recorded.data,
          bytes: recorded.bytes,
        });
        await this.pruneJournal(tx, spreadsheetId);
        journaled = true;
      }
      const revision = await this.touch(tx, spreadsheetId, writer.rewroteReferences);
      const change = { revision, changed: writer.changed() };
      noteChange(spreadsheetId, change);
      return { result, change, journaled };
    });
    if (outcome.journaled) noteJournaled();
    return { result: outcome.result, change: outcome.change };
  }
  readonly read = documentsOperations.read.bind(null, this);
  readonly listRuns = runsOperations.listRuns.bind(null, this);
  readonly searchDocuments = searchOperations.searchDocuments.bind(null, this);

  async pruneJournal(tx: Database, spreadsheetId: string): Promise<void> {
    const entries = await tx
      .select({
        seq: journal.seq,
        step: journal.step,
        userId: journal.userId,
        clientId: journal.clientId,
        createdAt: journal.createdAt,
        bytes: journal.bytes,
      })
      .from(journal)
      .where(eq(journal.spreadsheetId, spreadsheetId))
      .orderBy(asc(journal.seq));
    const deleted = new Set<number>();
    const limits = this.options.journalLimits ?? {};
    const cutoff = Date.now() - (limits.journalAgeMs ?? LIMITS.journalAgeMs);
    for (const entry of entries) {
      if (entry.createdAt.getTime() < cutoff) deleted.add(entry.seq);
    }
    // The ids of deleted rows are kept as long as a journal entry could bring them back.
    await tx
      .delete(deletedRows)
      .where(
        and(
          eq(deletedRows.spreadsheetId, spreadsheetId),
          lt(deletedRows.deletedAt, new Date(cutoff)),
        ),
      );
    const remaining = entries.filter((entry) => !deleted.has(entry.seq));
    let bytes = remaining.reduce((sumOfBytes, entry) => sumOfBytes + entry.bytes, 0);
    while (
      remaining.length > (limits.journalEntries ?? LIMITS.journalEntries) ||
      bytes > (limits.journalBytes ?? LIMITS.journalBytes)
    ) {
      const oldest = remaining.shift();
      if (!oldest) break;
      deleted.add(oldest.seq);
      bytes -= oldest.bytes;
    }
    if (deleted.size === 0) return;

    for (const entry of entries.filter((candidate) => deleted.has(candidate.seq))) {
      if (entry.clientId === null) continue;
      await tx
        .update(journal)
        .set({ clientId: null })
        .where(
          and(
            eq(journal.spreadsheetId, spreadsheetId),
            eq(journal.step, entry.step),
            eq(journal.userId, entry.userId),
            eq(journal.clientId, entry.clientId),
          ),
        );
    }
    await tx.delete(journal).where(inArray(journal.seq, [...deleted]));
  }

  /** Runs a change to a page, giving `work` the page as it is under the lock. */
  async changePage<T>(
    pageId: string,
    work: (page: Found<PageRecord>, tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<Outcome<T>> {
    const { spreadsheetId } = await this.repository.findPage(pageId, "write");
    return this.change(spreadsheetId, async (tx, writer) =>
      work(await this.within(tx).repository.findPage(pageId, "write"), tx, writer),
    );
  }

  /** Runs a change to a table, giving `work` the table as it is under the lock. */
  async changeTable<T>(
    tableId: string,
    work: (table: Found<TableRecord>, tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<Outcome<T>> {
    const { spreadsheetId } = await this.repository.findTable(tableId, "write");
    return this.change(spreadsheetId, async (tx, writer) =>
      work(await this.within(tx).repository.findTable(tableId, "write"), tx, writer),
    );
  }

  /** Runs a change to a chart or text view, giving `work` the view as it is under the lock. */
  async changeView<T>(
    viewId: string,
    work: (view: Found<ViewRecord>, tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<Outcome<T>> {
    const { spreadsheetId } = await this.repository.findView(viewId, "write");
    return this.change(spreadsheetId, async (tx, writer) =>
      work(await this.within(tx).repository.findView(viewId, "write"), tx, writer),
    );
  }
  readonly listSpreadsheets = foldersOperations.listSpreadsheets.bind(null, this);

  readonly createFolder = foldersOperations.createFolder.bind(null, this);

  readonly renameFolder = foldersOperations.renameFolder.bind(null, this);

  readonly deleteFolder = foldersOperations.deleteFolder.bind(null, this);

  readonly moveDocument = foldersOperations.moveDocument.bind(null, this);

  readonly listMembers = sharingOperations.listMembers.bind(null, this);

  readonly share = sharingOperations.share.bind(null, this);

  readonly unshare = sharingOperations.unshare.bind(null, this);

  readonly createSpreadsheet = filesOperations.createSpreadsheet.bind(null, this);

  readonly importSpreadsheet = filesOperations.importSpreadsheet.bind(null, this);

  readonly copySpreadsheet = filesOperations.copySpreadsheet.bind(null, this);

  readonly createFromFile = filesOperations.createFromFile.bind(null, this);

  readonly insertContents = filesOperations.insertContents.bind(null, this);

  readonly resolveChoiceSources = filesOperations.resolveChoiceSources.bind(null, this);

  readonly listVersions = versionsOperations.listVersions.bind(null, this);

  readonly restoreVersion = versionsOperations.restoreVersion.bind(null, this);

  readonly copyVersion = versionsOperations.copyVersion.bind(null, this);

  readonly findVersion = versionsOperations.findVersion.bind(null, this);

  readonly keepVersion = versionsOperations.keepVersion.bind(null, this);

  readonly saveVersion = versionsOperations.saveVersion.bind(null, this);

  /**
   * Marks the spreadsheet as changed now, and returns the revision the change
   * made. `rewrites` says the change altered what references mean. When no
   * version was kept lately, one is kept of the spreadsheet as the change
   * leaves it.
   */
  async touch(db: Database, spreadsheetId: string, rewrites = false): Promise<number> {
    const next = sql`${spreadsheets.revision} + 1`;
    const [touched] = await db
      .update(spreadsheets)
      // The clock, not the start of the transaction: a version kept earlier in
      // this transaction must count as older than this change.
      .set({
        updatedAt: sql`clock_timestamp()`,
        revision: next,
        ...(rewrites ? { rewriteRevision: next } : {}),
      })
      .where(eq(spreadsheets.id, spreadsheetId))
      .returning({ revision: spreadsheets.revision });
    if (!touched) throw notFound("Document");
    const [latest] = await db
      .select({ createdAt: versions.createdAt })
      .from(versions)
      .where(eq(versions.spreadsheetId, spreadsheetId))
      .orderBy(desc(versions.createdAt))
      .limit(1);
    if (!latest || Date.now() - latest.createdAt.getTime() >= VERSION_INTERVAL_MS) {
      await this.saveVersion(db, spreadsheetId, null);
    }
    return touched.revision;
  }
  readonly getSnapshot = documentsOperations.getSnapshot.bind(null, this);

  readonly revisionOf = documentsOperations.revisionOf.bind(null, this);

  readonly renameSpreadsheet = documentsOperations.renameSpreadsheet.bind(null, this);

  readonly deleteSpreadsheet = documentsOperations.deleteSpreadsheet.bind(null, this);

  readonly createPage = pagesOperations.createPage.bind(null, this);

  readonly renamePage = pagesOperations.renamePage.bind(null, this);

  readonly reorderPage = pagesOperations.reorderPage.bind(null, this);

  readonly reorderPages = pagesOperations.reorderPages.bind(null, this);

  readonly holderNames = pagesOperations.holderNames.bind(null, this);

  readonly checkHolderName = pagesOperations.checkHolderName.bind(null, this);

  readonly destination = pagesOperations.destination.bind(null, this);

  readonly moveTable = pagesOperations.moveTable.bind(null, this);

  readonly moveView = pagesOperations.moveView.bind(null, this);

  readonly insertTable = pagesOperations.insertTable.bind(null, this);

  readonly deletePage = pagesOperations.deletePage.bind(null, this);

  readonly createTable = tablesOperations.createTable.bind(null, this);

  readonly updateTable = tablesOperations.updateTable.bind(null, this);

  readonly nameColumns = tablesOperations.nameColumns.bind(null, this);

  readonly setTableNames = tablesOperations.setTableNames.bind(null, this);

  readonly updateNamedFormula = tablesOperations.updateNamedFormula.bind(null, this);

  readonly setTableDisplay = tablesOperations.setTableDisplay.bind(null, this);

  readonly resizeLines = formatsOperations.resizeLines.bind(null, this);

  readonly formatCells = formatsOperations.formatCells.bind(null, this);

  readonly setConditionalFormats = formatsOperations.setConditionalFormats.bind(null, this);

  readonly dropColumns = columnsOperations.dropColumns.bind(null, this);

  readonly updateColumn = columnsOperations.updateColumn.bind(null, this);

  readonly checkChoiceSource = columnsOperations.checkChoiceSource.bind(null, this);

  readonly createView = viewsOperations.createView.bind(null, this);

  readonly updateView = viewsOperations.updateView.bind(null, this);

  readonly deleteView = viewsOperations.deleteView.bind(null, this);

  readonly deleteTable = tablesOperations.deleteTable.bind(null, this);

  readonly appendCsvRows = tablesOperations.appendCsvRows.bind(null, this);

  readonly setCells = cellsOperations.setCells.bind(null, this);

  readonly checkNewRows = cellsOperations.checkNewRows.bind(null, this);

  readonly checkCellCount = cellsOperations.checkCellCount.bind(null, this);

  readonly applyEffects = cellsOperations.applyEffects.bind(null, this);

  readonly editStructure = structureOperations.editStructure.bind(null, this);

  readonly deleteLines = structureOperations.deleteLines.bind(null, this);

  readonly applyEdit = structureOperations.applyEdit.bind(null, this);

  /**
   * Blocks other transactions that lock the same spreadsheet until this one
   * ends. Button clicks use it so that two clicks on a counter do not both
   * read the same starting value.
   */
  async lockSpreadsheet(spreadsheetId: string): Promise<void> {
    await this.repository.findSpreadsheet(spreadsheetId, "write");
    await lockSpreadsheetRow(this.db, spreadsheetId);
    await this.repository.findSpreadsheet(spreadsheetId, "write");
  }
  readonly undoState = historyOperations.undoState.bind(null, this);

  readonly undo = historyOperations.undo.bind(null, this);

  readonly redo = historyOperations.redo.bind(null, this);

  readonly changeHistory = historyOperations.changeHistory.bind(null, this);

  readonly stackState = historyOperations.stackState.bind(null, this);

  readonly historyResult = historyOperations.historyResult.bind(null, this);

  readonly assertRecordedMatches = historyOperations.assertRecordedMatches.bind(null, this);

  readonly checkRestoredState = historyOperations.checkRestoredState.bind(null, this);

  readonly lockUser = documentsOperations.lockUser.bind(null, this);

  readonly countEmails = documentsOperations.countEmails.bind(null, this);

  async findSpreadsheet(
    spreadsheetId: string,
    access: Access,
  ): Promise<{ id: string; name: string; role: Role }> {
    const [row] = await this.db
      .select({ id: spreadsheets.id, name: spreadsheets.name, role: this.access.role })
      .from(spreadsheets)
      .innerJoin(this.access, this.granted())
      .where(eq(spreadsheets.id, spreadsheetId));
    return authorize(row, access, "Document");
  }

  async findPage(pageId: string, access: Access): Promise<Found<PageRecord>> {
    const [row] = await this.db
      .select({ ...pageColumns, spreadsheetId: spreadsheets.id, role: this.access.role })
      .from(pages)
      .innerJoin(spreadsheets, eq(spreadsheets.id, pages.spreadsheetId))
      .innerJoin(this.access, this.granted())
      .where(eq(pages.id, pageId));
    return authorize(row, access, "Page");
  }

  async findTable(tableId: string, access: Access): Promise<Found<TableRecord>> {
    const [row] = await this.db
      .select({ ...tableColumns, spreadsheetId: spreadsheets.id, role: this.access.role })
      .from(tables)
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .innerJoin(spreadsheets, eq(spreadsheets.id, pages.spreadsheetId))
      .innerJoin(this.access, this.granted())
      .where(eq(tables.id, tableId));
    return authorize(row, access, "Table");
  }
  readonly rewriteFormulas = rewritesOperations.rewriteFormulas.bind(null, this);

  readonly rewriteForMove = rewritesOperations.rewriteForMove.bind(null, this);

  readonly storeRewrite = rewritesOperations.storeRewrite.bind(null, this);

  readonly storeNameFormulas = rewritesOperations.storeNameFormulas.bind(null, this);

  readonly storeFilterFormulas = rewritesOperations.storeFilterFormulas.bind(null, this);

  readonly storeColumnFormulas = rewritesOperations.storeColumnFormulas.bind(null, this);

  readonly storeViewSources = rewritesOperations.storeViewSources.bind(null, this);

  readonly insertPosition = pagesOperations.insertPosition.bind(null, this);

  readonly nextPosition = pagesOperations.nextPosition.bind(null, this);

  async findView(viewId: string, access: Access): Promise<Found<ViewRecord>> {
    const [row] = await this.db
      .select({ ...viewColumns, spreadsheetId: spreadsheets.id, role: this.access.role })
      .from(views)
      .innerJoin(pages, eq(pages.id, views.pageId))
      .innerJoin(spreadsheets, eq(spreadsheets.id, pages.spreadsheetId))
      .innerJoin(this.access, this.granted())
      .where(eq(views.id, viewId));
    return authorize(row, access, "View");
  }

  /** Finds a view for a click, returning 409 for a deleted view and hiding inaccessible views. */
  async findViewForClick(viewId: string): Promise<Found<ViewRecord>> {
    const [row] = await this.db
      .select({ ...viewColumns, spreadsheetId: spreadsheets.id, role: this.access.role })
      .from(views)
      .innerJoin(pages, eq(pages.id, views.pageId))
      .innerJoin(spreadsheets, eq(spreadsheets.id, pages.spreadsheetId))
      .leftJoin(this.access, this.granted())
      .where(eq(views.id, viewId));
    if (!row) throw conflict("This text view no longer exists");
    if (row.role === null) throw notFound("View");
    const found: Found<ViewRecord> = { ...row, role: row.role };
    return authorize(found, "write", "View");
  }

  /** The join condition that limits a query to the spreadsheets the user may open. */
  granted() {
    return and(eq(this.access.spreadsheetId, spreadsheets.id), eq(this.access.userId, this.userId));
  }
  readonly personalWorkspace = documentsOperations.personalWorkspace.bind(null, this);
}
