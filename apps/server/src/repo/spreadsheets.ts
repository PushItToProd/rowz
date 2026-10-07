import {
  type ChartType,
  type ColumnType,
  type Effect,
  type FormatRule,
  type SortKey,
  type TableName,
} from "@spreadsheet-app/engine";
import {
  type IdentityCellInput,
  type IdentityConditionalRule,
  type IdentityFormatRange,
  type IdentifiedStructuralEditBody,
  type ResizeLinesBody,
  type SpreadsheetFile,
  type UpdateTableBody,
} from "@spreadsheet-app/shared";
import type { Database } from "../db/client";
import { type Contents } from "./contents";
import { type Change } from "./journal";
import { type Role, type ViewKind } from "../db/schema";
import {
  type Access,
  type MemberRecord,
  type SpreadsheetSummary,
  type FolderRecord,
  type DocumentList,
  type PageRecord,
  type TableRecord,
  type ViewRecord,
  type Found,
  type VersionRecord,
  type ActionRunRecord,
  type Snapshot,
  type UndoResult,
  type RepositoryOptions,
  type Created,
} from "./spreadsheets/records";
import { RepositoryContext } from "./spreadsheets/context";
import { replace } from "./spreadsheets/replace";
import type { ReplaceBody, ReplaceReport } from "@spreadsheet-app/shared";
export type {
  Access,
  MemberRecord,
  SpreadsheetSummary,
  ListedSpreadsheet,
  FolderRecord,
  DocumentList,
  PageRecord,
  TableRecord,
  ViewRecord,
  VersionRecord,
  ActionRunRecord,
  Snapshot,
  SnapshotWithHistory,
  UndoResult,
  RepositoryOptions,
  Created,
} from "./spreadsheets/records";
export type { Change, ChangedContent } from "./journal";
/**
 * All reads and writes of spreadsheet data on behalf of one user.
 * The internal context shares authorization and transactions across concern modules.
 */
export class SpreadsheetRepository {
  async replace(spreadsheetId: string, request: ReplaceBody): Promise<Change & ReplaceReport> {
    return replace(this.context, spreadsheetId, request);
  }
  private readonly context: RepositoryContext;
  constructor(db: Database, userId: string, options: RepositoryOptions = {}) {
    this.context = new RepositoryContext(
      db,
      userId,
      options,
      this,
      (tx) => new SpreadsheetRepository(tx, userId, options).context,
    );
  }

  /**
   * Reads a spreadsheet for the formula engine, which names cells by
   * position. Inside a change the read is as current as the lock makes it.
   */
  async read(spreadsheetId: string): Promise<Contents> {
    return this.context.read(spreadsheetId);
  }

  async listSpreadsheets(): Promise<DocumentList> {
    return this.context.listSpreadsheets();
  }

  async createFolder(name: string): Promise<FolderRecord> {
    return this.context.createFolder(name);
  }

  async renameFolder(folderId: string, name: string): Promise<FolderRecord> {
    return this.context.renameFolder(folderId, name);
  }

  async deleteFolder(folderId: string): Promise<void> {
    return this.context.deleteFolder(folderId);
  }

  /** Moves a document in this user's list; a missing folder puts it at the root. */
  async moveDocument(spreadsheetId: string, folderId: string | null): Promise<void> {
    return this.context.moveDocument(spreadsheetId, folderId);
  }

  /** Everyone who can open a spreadsheet: the members of its workspace, then the people it is shared with. */
  async listMembers(spreadsheetId: string): Promise<MemberRecord[]> {
    return this.context.listMembers(spreadsheetId);
  }

  /**
   * Shares a spreadsheet with the account that has an email address, or
   * changes the role of someone it is already shared with. Only the owner can.
   */
  async share(spreadsheetId: string, email: string, role: "editor" | "viewer"): Promise<void> {
    return this.context.share(spreadsheetId, email, role);
  }

  /** Stops sharing a spreadsheet with someone. The owner can remove anyone, and anyone can remove themselves. */
  async unshare(spreadsheetId: string, userId: string): Promise<void> {
    return this.context.unshare(spreadsheetId, userId);
  }

  /** Creates a spreadsheet with one page holding one empty table. */
  async createSpreadsheet(name: string): Promise<SpreadsheetSummary> {
    return this.context.createSpreadsheet(name);
  }

  /** Creates a spreadsheet from a file, in the caller's own workspace. Nothing is created if any part is refused. */
  async importSpreadsheet(file: SpreadsheetFile): Promise<SpreadsheetSummary> {
    return this.context.importSpreadsheet(file);
  }

  /** Copies current content with fresh identities and no shares or history. */
  async copySpreadsheet(spreadsheetId: string): Promise<SpreadsheetSummary> {
    return this.context.copySpreadsheet(spreadsheetId);
  }

  /** The kept versions of a spreadsheet, newest first. */
  async listVersions(spreadsheetId: string): Promise<VersionRecord[]> {
    return this.context.listVersions(spreadsheetId);
  }

  /** The latest action runs of a spreadsheet, newest first. */
  async listRuns(spreadsheetId: string): Promise<ActionRunRecord[]> {
    return this.context.listRuns(spreadsheetId);
  }

  /**
   * Puts a spreadsheet back as a kept version has it. What it holds now is
   * kept as a version first, so restoring can itself be undone. Everything is
   * replaced, with new ids, so sessions read the spreadsheet again.
   */
  async restoreVersion(spreadsheetId: string, versionId: string): Promise<Change> {
    return this.context.restoreVersion(spreadsheetId, versionId);
  }

  /** Makes a new spreadsheet, in the caller's own workspace, of a kept version. */
  async copyVersion(spreadsheetId: string, versionId: string): Promise<SpreadsheetSummary> {
    return this.context.copyVersion(spreadsheetId, versionId);
  }

  /**
   * Everything a spreadsheet holds, as of one moment. The queries run in one
   * transaction that sees the database as it was when it began, so a change
   * that commits between two of them cannot give tables from before it and
   * cells from after. Inside a change the transaction is the change's own, and
   * the lock is what holds the spreadsheet still.
   */
  async getSnapshot(spreadsheetId: string): Promise<Snapshot> {
    return this.context.getSnapshot(spreadsheetId);
  }

  /** How many changes have been made to what a spreadsheet holds. */
  async revisionOf(spreadsheetId: string): Promise<number> {
    return this.context.revisionOf(spreadsheetId);
  }

  async renameSpreadsheet(spreadsheetId: string, name: string): Promise<void> {
    return this.context.renameSpreadsheet(spreadsheetId, name);
  }

  async deleteSpreadsheet(spreadsheetId: string): Promise<void> {
    return this.context.deleteSpreadsheet(spreadsheetId);
  }

  /** Creates a page with one empty table. Without a name the page gets the next free `Page N`. */
  async createPage(
    spreadsheetId: string,
    name?: string,
  ): Promise<Created<{ page: PageRecord; table: TableRecord }>> {
    return this.context.createPage(spreadsheetId, name);
  }

  /** Renames a page and the formulas that name it. */
  async renamePage(pageId: string, name: string): Promise<Change> {
    return this.context.renamePage(pageId, name);
  }

  /**
   * Puts the blocks of a page in the order given. The
   * list must name every one of them once, so that a stale client cannot
   * leave two blocks in one place.
   */
  async reorderPage(pageId: string, blocks: readonly string[]): Promise<Change> {
    return this.context.reorderPage(pageId, blocks);
  }

  /**
   * Puts the pages of a spreadsheet in the order given. The list must name
   * every one of them once, so that a stale client cannot leave two pages in
   * one place.
   */
  async reorderPages(spreadsheetId: string, order: readonly string[]): Promise<Change> {
    return this.context.reorderPages(spreadsheetId, order);
  }

  /**
   * Moves a table to the end of another page of its spreadsheet. A table name
   * alone in a formula means a table on the formula's own page, so formulas
   * that would come to mean another table are rewritten to name the page.
   */
  async moveTable(tableId: string, pageId: string): Promise<Change> {
    return this.context.moveTable(tableId, pageId);
  }

  /**
   * Moves a chart or text view to the end of another page of its
   * spreadsheet. Where its source named a table by name alone, it now names
   * the page too, and so reads the same table.
   */
  async moveView(viewId: string, pageId: string): Promise<Change> {
    return this.context.moveView(viewId, pageId);
  }

  async deletePage(pageId: string): Promise<Change> {
    return this.context.deletePage(pageId);
  }

  /** Creates an empty table. Without a name the table gets the next free `Table N`. */
  async createTable(
    pageId: string,
    name?: string,
    position?: number,
  ): Promise<Created<{ table: TableRecord }>> {
    return this.context.createTable(pageId, name, position);
  }

  /**
   * Renames or resizes a table. Renaming rewrites the formulas that name the
   * table. A size is counted from the start of the table: rows and columns
   * are added at its end, and making it smaller deletes the ones past the new
   * size as any others are deleted, so formulas, views, and formats follow.
   */
  async updateTable(tableId: string, changes: UpdateTableBody): Promise<Change> {
    return this.context.updateTable(tableId, changes);
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
  async nameColumns(tableId: string, headerRow: boolean): Promise<Change> {
    return this.context.nameColumns(tableId, headerRow);
  }

  /**
   * Replaces the names a plain table holds. A name cannot be one that reads as
   * a cell address, a value, or a function, and a table lists a name once.
   */
  async setTableNames(tableId: string, names: TableName[]): Promise<Change> {
    return this.context.setTableNames(tableId, names);
  }

  /** Updates a named formula against the current list under the spreadsheet lock. */
  async updateNamedFormula(tableId: string, name: string, formula: string): Promise<Change> {
    return this.context.updateNamedFormula(tableId, name, formula);
  }

  /**
   * Replaces how a data table's rows are shown: its sort and filter. Neither
   * changes the stored row order. The submitted filter is accepted literally.
   */
  async setTableDisplay(
    tableId: string,
    display: { sort: SortKey[]; filter?: string | undefined; revision?: number | undefined },
  ): Promise<Change> {
    return this.context.setTableDisplay(tableId, display);
  }

  /** Sets or resets pixel sizes for existing row or column identities under the spreadsheet lock. */
  async resizeLines(tableId: string, request: ResizeLinesBody): Promise<Change> {
    return this.context.resizeLines(tableId, request);
  }

  /**
   * Changes how a range of cells is shown. The format is added to whatever
   * the cells already have. The range names the rows and columns at its
   * corners by id, and a format rule holds their positions as they are now.
   */
  async formatCells(
    tableId: string,
    range: IdentityFormatRange,
    format: FormatRule["format"],
    reset?: boolean,
  ): Promise<Change> {
    return this.context.formatCells(tableId, range, format, reset);
  }

  /**
   * Replaces the conditional formats of a table. Each rule names the rows and
   * columns at its corners by id, and a stored rule holds their positions as
   * they are now. A criterion is built once here, so that one that cannot be
   * built is refused on save and not shown as a rule that never applies.
   */
  async setConditionalFormats(tableId: string, rules: IdentityConditionalRule[]): Promise<Change> {
    return this.context.setConditionalFormats(tableId, rules);
  }

  /**
   * Makes a data table a plain table again. Its formula columns stop
   * computing. A plain table has at least one row, so a table with none
   * gets one.
   */
  async dropColumns(tableId: string): Promise<Change> {
    return this.context.dropColumns(tableId);
  }

  /**
   * Changes a column's name, type, or formula. A rename rewrites the formulas
   * that name the column. A column that becomes a formula column loses what
   * was typed into it.
   */
  async updateColumn(
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
    return this.context.updateColumn(tableId, colId, changes);
  }

  /** Adds a view at an index, defaulting to the end of a page. */
  async createView(
    pageId: string,
    kind: ViewKind,
    insertAt?: number,
  ): Promise<Created<{ view: ViewRecord }>> {
    return this.context.createView(pageId, kind, insertAt);
  }

  async updateView(
    viewId: string,
    {
      revision: _revision,
      ...changes
    }: {
      name?: string | undefined;
      source?: string | undefined;
      chartType?: ChartType | undefined;
      revision?: number | undefined;
    },
  ): Promise<Change> {
    return this.context.updateView(viewId, {
      revision: _revision,
      ...changes,
    });
  }

  async deleteView(viewId: string): Promise<Change> {
    return this.context.deleteView(viewId);
  }

  async deleteTable(tableId: string): Promise<Change> {
    return this.context.deleteTable(tableId);
  }

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
  async setCells(
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
    return this.context.setCells(tableId, {
      cells: written,
      appendRows,
    });
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
  async applyEffects(
    spreadsheetId: string,
    effects: readonly Effect[],
  ): Promise<Change | undefined> {
    return this.context.applyEffects(spreadsheetId, effects);
  }

  /**
   * Inserts or deletes rows or columns. No cell moves: a cell belongs to its
   * row and column, whose ids do not change. Formulas anywhere in the
   * spreadsheet that read the table are rewritten to keep reading the same
   * cells, as are charts, text views, and formats.
   */
  async editStructure(tableId: string, body: IdentifiedStructuralEditBody): Promise<Change> {
    return this.context.editStructure(tableId, body);
  }

  /**
   * Blocks other transactions that lock the same spreadsheet until this one
   * ends. Button clicks use it so that two clicks on a counter do not both
   * read the same starting value.
   */
  async lockSpreadsheet(spreadsheetId: string): Promise<void> {
    return this.context.lockSpreadsheet(spreadsheetId);
  }

  /** Whether this tab has anything it can undo or redo. */
  async undoState(spreadsheetId: string): Promise<{ undoable: boolean; redoable: boolean }> {
    return this.context.undoState(spreadsheetId);
  }

  /** Reverses the newest step on this tab's stack. */
  async undo(spreadsheetId: string): Promise<UndoResult> {
    return this.context.undo(spreadsheetId);
  }

  /** Reapplies the oldest step on this tab's redo stack. */
  async redo(spreadsheetId: string): Promise<UndoResult> {
    return this.context.redo(spreadsheetId);
  }

  /**
   * Makes other transactions that count this user's email wait until this one
   * ends. Without it, two clicks at once would each count the email sent so
   * far, find room, and together send more than the limit.
   */
  async lockUser(): Promise<void> {
    return this.context.lockUser();
  }

  /** How many emails the user's button clicks set out to send since `since`. */
  async countEmails(since: Date): Promise<number> {
    return this.context.countEmails(since);
  }

  async findSpreadsheet(
    spreadsheetId: string,
    access: Access,
  ): Promise<{ id: string; name: string; role: Role }> {
    return this.context.findSpreadsheet(spreadsheetId, access);
  }

  async findPage(pageId: string, access: Access): Promise<Found<PageRecord>> {
    return this.context.findPage(pageId, access);
  }

  async findTable(tableId: string, access: Access): Promise<Found<TableRecord>> {
    return this.context.findTable(tableId, access);
  }

  async findView(viewId: string, access: Access): Promise<Found<ViewRecord>> {
    return this.context.findView(viewId, access);
  }

  /** Finds a view for a click, returning 409 for a deleted view and hiding inaccessible views. */
  async findViewForClick(viewId: string): Promise<Found<ViewRecord>> {
    return this.context.findViewForClick(viewId);
  }
}
