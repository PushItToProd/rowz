import {
  addFormatRule,
  columnFormulasAfterEdit,
  columnFormulasAfterMove,
  columnFormulasAfterRename,
  columnLabel,
  formatAddress,
  formatRulesAfterEdit,
  inputsAfterEdit,
  inputsAfterMove,
  inputsAfterRename,
  isFormulaInput,
  sameColumnName,
  viewsAfterEdit,
  viewsAfterMove,
  viewsAfterRename,
  type ChartType,
  type ColumnDefinition,
  type ColumnFormula,
  type ColumnType,
  type FormatRule,
  type Move,
  type Rename,
  type StructuralEdit,
} from "@spreadsheet-app/engine";
import {
  DEFAULT_TABLE_SIZE,
  FILE_FORMAT,
  FILE_LIMITS,
  LIMITS,
  MAX_FORMAT_RULES,
  type CellInput,
  type JournalLimits,
  type SpreadsheetFile,
  type StoredCell,
  toSpreadsheetFile,
  type StructuralEditBody,
} from "@spreadsheet-app/shared";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, count, desc, eq, gte, gt, inArray, or, sql, sum } from "drizzle-orm";
import { noteChange, noteJournaled, requestContext } from "../changes";
import type { Database } from "../db/client";
import {
  applyRecorded,
  ContentWriter,
  type ChangedContent,
  type JournalData,
  readInputs,
  UndoRefusal,
} from "./journal";
import {
  actionRuns,
  cells,
  journal,
  pages,
  spreadsheetMembers,
  versions,
  spreadsheets,
  tables,
  users,
  views,
  workspaceMembers,
  workspaces,
  type Role,
  type ViewKind,
} from "../db/schema";
import {
  conflict,
  forbidden,
  isForeignKeyViolation,
  isUniqueViolation,
  notFound,
  ownerOnly,
  unprocessable,
} from "../errors";

/** What a caller means to do: read, change the contents, or do what only the owner may. */
export type Access = "read" | "write" | "own";

/** Someone who can open a spreadsheet, as the Share panel lists them. */
export interface MemberRecord {
  userId: string;
  name: string;
  email: string;
  role: Role;
  /** Whether the person has the spreadsheet through a share, which the owner can change or remove. */
  shared: boolean;
}

export interface SpreadsheetSummary {
  id: string;
  name: string;
  updatedAt: Date;
}

/** A spreadsheet in the caller's list, with the caller's role on it. */
export interface ListedSpreadsheet extends SpreadsheetSummary {
  role: Role;
}

export interface PageRecord {
  id: string;
  name: string;
  position: number;
}

export interface TableRecord {
  id: string;
  pageId: string;
  name: string;
  position: number;
  rowCount: number;
  colCount: number;
  /** The named columns of a data table, one for each column. `null` for a plain table. */
  columns: ColumnDefinition[] | null;
  /** How cells are shown: rules applied in order, later ones over earlier ones. */
  formats: FormatRule[];
}

export interface ViewRecord {
  id: string;
  pageId: string;
  kind: ViewKind;
  name: string;
  position: number;
  source: string;
  /** `null` for a text view. */
  chartType: ChartType | null;
}

/** A page, table, or view as a lookup returns it: with its spreadsheet and the caller's role there. */
type Found<T> = T & { spreadsheetId: string; role: Role };

/** What a rename or a row or column edit rewrote, for the client to apply. */
export interface Rewritten {
  /** Cells that changed. An empty input means the cell is now empty. */
  cells: StoredCell[];
  /** Charts and text views whose sources changed. */
  views: { id: string; source: string }[];
  /** Tables whose formula columns changed. */
  tables: TableRecord[];
}

/** A kept version of a spreadsheet, as the history lists it. */
export interface VersionRecord {
  id: string;
  createdAt: Date;
  /** What was about to happen when the version was kept. `null` for one kept as time passed. */
  reason: string | null;
  /** The name of whoever made the change that kept it. */
  createdBy: string | null;
}

/** A version is kept when a change is made this long after the last one was. */
const VERSION_INTERVAL_MS = 10 * 60_000;
/** A request that writes this many cells, as a paste or an import does, keeps a version first. */
const BULK_WRITE_CELLS = 20;

/** A whole spreadsheet: everything the editor and the formula engine need. */
export interface Snapshot {
  id: string;
  name: string;
  role: Role;
  pages: PageRecord[];
  tables: TableRecord[];
  views: ViewRecord[];
  cells: StoredCell[];
}

/** The spreadsheet snapshot and the undo state of the requesting tab. */
export interface SnapshotWithHistory extends Snapshot {
  undoable: boolean;
  redoable: boolean;
}

export interface UndoResult {
  outcome: "done" | "refused" | "nothing";
  label: string | null;
  error: string | null;
  changed: ChangedContent;
  undoable: boolean;
  redoable: boolean;
}

const pageColumns = { id: pages.id, name: pages.name, position: pages.position };
const tableColumns = {
  id: tables.id,
  pageId: tables.pageId,
  name: tables.name,
  position: tables.position,
  rowCount: tables.rowCount,
  colCount: tables.colCount,
  columns: tables.columns,
  formats: tables.formats,
};

const viewColumns = {
  id: views.id,
  pageId: views.pageId,
  kind: views.kind,
  name: views.name,
  position: views.position,
  source: views.source,
  chartType: views.chartType,
};

const STARTER_TEMPLATE = `## New text view

Write Markdown here. A formula in double braces puts its value into the text: {{ 1 + 1 }}
`;

// Each row binds six parameters, and Postgres takes at most 65,535 in one statement.
const INSERT_BATCH = 5000;

export interface RepositoryOptions {
  /**
   * Whether a spreadsheet can be shared only with an account that has
   * confirmed its email address. Set when the server makes new accounts
   * confirm theirs, so that a share by address reaches the person who reads
   * mail at it and not whoever signed up with it first.
   */
  sharesNeedVerifiedEmail?: boolean;
  /** Overrides the journal limits for tests. Production uses the shared defaults. */
  journalLimits?: Partial<JournalLimits>;
}

/** The first name in a list that another, earlier name matches without regard to case. */
function repeated(names: readonly string[]): string | undefined {
  const seen = new Set<string>();
  return names.find((name) => {
    const key = name.toLowerCase();
    const again = seen.has(key);
    seen.add(key);
    return again;
  });
}

/**
 * Refuses a file that breaks a rule the request schema cannot state: names
 * that collide, cells outside their table or listed twice, and too many cells
 * in all.
 */
function checkFile(file: SpreadsheetFile): void {
  const invalid = (message: string): never => {
    throw unprocessable("invalid_file", message);
  };
  const page = repeated(file.pages.map(({ name }) => name));
  if (page !== undefined) invalid(`Two pages are named ${page}`);

  let total = 0;
  for (const { name: pageName, blocks } of file.pages) {
    const fileTables = blocks.filter((block) => block.type === "table");
    const table = repeated(fileTables.map(({ name }) => name));
    if (table !== undefined) invalid(`Two tables on ${pageName} are named ${table}`);
    for (const { name, rowCount, colCount, cells: fileCells, columns } of fileTables) {
      if (columns) {
        if (columns.length !== colCount) {
          invalid(
            `The table ${name} names ${String(columns.length)} of its ${String(colCount)} columns`,
          );
        }
        const column = repeated(columns.map((definition) => definition.name.trim()));
        if (column !== undefined) invalid(`Two columns of ${name} are named ${column}`);
        const empty = columns.find(
          ({ type, formula = "" }) => type === "formula" && ["", "="].includes(formula.trim()),
        );
        if (empty) invalid(`The formula column ${empty.name} of ${name} has no formula`);
      }
      const seen = new Set<string>();
      for (const { row, col } of fileCells) {
        const address = formatAddress({ row, col });
        if (row >= rowCount || col >= colCount) invalid(`${address} is outside the table ${name}`);
        if (seen.has(address)) invalid(`${address} appears twice in the table ${name}`);
        seen.add(address);
      }
      total += fileCells.length;
    }
  }
  if (total > FILE_LIMITS.cells) {
    invalid(`The file has more than ${String(FILE_LIMITS.cells)} cells`);
  }
}

/** The first of `Page 1`, `Page 2`, ... that no existing name matches, ignoring case. */
function nextName(prefix: string, existing: readonly string[]): string {
  const taken = new Set(existing.map((name) => name.toLowerCase()));
  for (let n = 1; ; n += 1) {
    const candidate = `${prefix} ${String(n)}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * All reads and writes of spreadsheet data on behalf of one user.
 *
 * Authorization lives here and nowhere else. Every method starts from one of
 * the `find*` lookups, which join through the user's workspace memberships.
 * Data in a workspace the user does not belong to is reported as not found, so
 * a caller cannot tell it exists.
 */
export class SpreadsheetRepository {
  /**
   * Who may open which spreadsheet, and as what: the members of its
   * workspace, and the people it is shared with. Every query for spreadsheet
   * data joins this, limited to the caller.
   */
  private readonly access;

  constructor(
    private readonly db: Database,
    private readonly userId: string,
    private readonly options: RepositoryOptions = {},
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
  private within(tx: Database): SpreadsheetRepository {
    return new SpreadsheetRepository(tx, this.userId, this.options);
  }

  /**
   * Runs a change to what a spreadsheet holds. The spreadsheet is locked
   * first, so one change at a time reads and writes it, and `touch` follows
   * the work. Every change goes through here.
   *
   * What a caller read before the lock may be stale by the time `work` runs.
   * `work` reads again whatever it decides by, which `changePage`,
   * `changeTable`, and `changeView` do for the thing being changed. Write
   * access is checked again under the lock before `work` runs.
   */
  private async locked<T>(spreadsheetId: string, work: (tx: Database) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await lockSpreadsheet(tx, spreadsheetId);
      await this.within(tx).findSpreadsheet(spreadsheetId, "write");
      return work(tx);
    });
  }

  private async change<T>(
    spreadsheetId: string,
    work: (tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<T> {
    const outcome = await this.locked(spreadsheetId, async (tx) => {
      let journaled = false;
      const writer = new ContentWriter(
        tx,
        this.userId,
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
          label: writer.label,
          data: recorded.data,
          bytes: recorded.bytes,
        });
        await this.pruneJournal(tx, spreadsheetId);
        journaled = true;
      }
      await this.touch(tx, spreadsheetId);
      return { result, journaled };
    });
    if (outcome.journaled) noteJournaled();
    return outcome.result;
  }

  private async pruneJournal(tx: Database, spreadsheetId: string): Promise<void> {
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
  private async changePage<T>(
    pageId: string,
    work: (page: Found<PageRecord>, tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<T> {
    const { spreadsheetId } = await this.findPage(pageId, "write");
    return this.change(spreadsheetId, async (tx, writer) =>
      work(await this.within(tx).findPage(pageId, "write"), tx, writer),
    );
  }

  /** Runs a change to a table, giving `work` the table as it is under the lock. */
  private async changeTable<T>(
    tableId: string,
    work: (table: Found<TableRecord>, tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<T> {
    const { spreadsheetId } = await this.findTable(tableId, "write");
    return this.change(spreadsheetId, async (tx, writer) =>
      work(await this.within(tx).findTable(tableId, "write"), tx, writer),
    );
  }

  /** Runs a change to a chart or text view, giving `work` the view as it is under the lock. */
  private async changeView<T>(
    viewId: string,
    work: (view: Found<ViewRecord>, tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<T> {
    const { spreadsheetId } = await this.findView(viewId, "write");
    return this.change(spreadsheetId, async (tx, writer) =>
      work(await this.within(tx).findView(viewId, "write"), tx, writer),
    );
  }

  async listSpreadsheets(): Promise<ListedSpreadsheet[]> {
    return this.db
      .select({
        id: spreadsheets.id,
        name: spreadsheets.name,
        updatedAt: spreadsheets.updatedAt,
        role: this.access.role,
      })
      .from(spreadsheets)
      .innerJoin(this.access, this.granted())
      .orderBy(desc(spreadsheets.updatedAt));
  }

  /** Everyone who can open a spreadsheet: the members of its workspace, then the people it is shared with. */
  async listMembers(spreadsheetId: string): Promise<MemberRecord[]> {
    await this.findSpreadsheet(spreadsheetId, "read");
    const person = { userId: users.id, name: users.name, email: users.email };
    const [inWorkspace, shared] = await Promise.all([
      this.db
        .select({ ...person, role: workspaceMembers.role })
        .from(spreadsheets)
        .innerJoin(workspaceMembers, eq(workspaceMembers.workspaceId, spreadsheets.workspaceId))
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(spreadsheets.id, spreadsheetId))
        .orderBy(asc(workspaceMembers.createdAt)),
      this.db
        .select({ ...person, role: spreadsheetMembers.role })
        .from(spreadsheetMembers)
        .innerJoin(users, eq(users.id, spreadsheetMembers.userId))
        .where(eq(spreadsheetMembers.spreadsheetId, spreadsheetId))
        .orderBy(asc(spreadsheetMembers.createdAt)),
    ]);
    return [
      ...inWorkspace.map((member) => ({ ...member, shared: false })),
      ...shared.map((member) => ({ ...member, shared: true })),
    ];
  }

  /**
   * Shares a spreadsheet with the account that has an email address, or
   * changes the role of someone it is already shared with. Only the owner can.
   */
  async share(spreadsheetId: string, email: string, role: "editor" | "viewer"): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, "own");
    const [user] = await this.db
      .select({ id: users.id, emailVerified: users.emailVerified })
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.trim().toLowerCase()));
    if (!user) {
      throw unprocessable(
        "no_such_account",
        `No account uses ${email}. Ask them to sign up, then share again`,
      );
    }
    if (this.options.sharesNeedVerifiedEmail && !user.emailVerified) {
      throw unprocessable(
        "email_not_confirmed",
        `The account for ${email} has not confirmed its email address yet. Share again once it has`,
      );
    }
    const members = await this.listMembers(spreadsheetId);
    if (members.some((member) => member.userId === user.id && !member.shared)) {
      throw conflict(`${email} already has this spreadsheet through its workspace`);
    }
    // A guest whose role changes sees it without reloading.
    noteChange(spreadsheetId);
    await this.db
      .insert(spreadsheetMembers)
      .values({ spreadsheetId, userId: user.id, role })
      .onConflictDoUpdate({
        target: [spreadsheetMembers.spreadsheetId, spreadsheetMembers.userId],
        set: { role },
      });
  }

  /** Stops sharing a spreadsheet with someone. The owner can remove anyone, and anyone can remove themselves. */
  async unshare(spreadsheetId: string, userId: string): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, userId === this.userId ? "read" : "own");
    const removed = await this.db
      .delete(spreadsheetMembers)
      .where(
        and(
          eq(spreadsheetMembers.spreadsheetId, spreadsheetId),
          eq(spreadsheetMembers.userId, userId),
        ),
      )
      .returning({ userId: spreadsheetMembers.userId });
    if (removed.length === 0) throw notFound("Share");
    noteChange(spreadsheetId);
  }

  /** Creates a spreadsheet with one page holding one empty table. */
  async createSpreadsheet(name: string): Promise<SpreadsheetSummary> {
    return this.createFromFile({
      format: FILE_FORMAT,
      version: 1,
      name,
      pages: [
        {
          name: "Page 1",
          blocks: [{ type: "table", name: "Table 1", ...DEFAULT_TABLE_SIZE, cells: [] }],
        },
      ],
    });
  }

  /** Creates a spreadsheet from a file, in the caller's own workspace. Nothing is created if any part is refused. */
  async importSpreadsheet(file: SpreadsheetFile): Promise<SpreadsheetSummary> {
    checkFile(file);
    return this.createFromFile(file);
  }

  private async createFromFile(file: SpreadsheetFile): Promise<SpreadsheetSummary> {
    return this.db.transaction(async (tx) => {
      const workspaceId = await this.within(tx).personalWorkspace();
      const [spreadsheet] = await tx
        .insert(spreadsheets)
        .values({ workspaceId, name: file.name, createdBy: this.userId })
        .returning();
      if (!spreadsheet) throw new Error("Insert returned no spreadsheet");
      await this.insertContents(tx, spreadsheet.id, file);
      // Keeps the first version, so that the spreadsheet can be put back as it arrived.
      await this.touch(tx, spreadsheet.id);
      return { id: spreadsheet.id, name: spreadsheet.name, updatedAt: spreadsheet.updatedAt };
    });
  }

  /** Creates the pages of a file, and everything on them, in a spreadsheet that has none. */
  private async insertContents(
    tx: Database,
    spreadsheetId: string,
    file: SpreadsheetFile,
  ): Promise<void> {
    for (const [pagePosition, page] of file.pages.entries()) {
      const [created] = await tx
        .insert(pages)
        .values({ spreadsheetId, name: page.name, position: pagePosition })
        .returning({ id: pages.id });
      if (!created) throw new Error("Insert returned no page");
      for (const [position, block] of page.blocks.entries()) {
        const placed = { pageId: created.id, name: block.name, position };
        if (block.type !== "table") {
          await tx.insert(views).values({
            ...placed,
            kind: block.type,
            source: block.source,
            chartType: block.type === "chart" ? block.chartType : null,
          });
          continue;
        }
        const columns = block.columns?.map(normalized) ?? null;
        const [table] = await tx
          .insert(tables)
          .values({
            ...placed,
            rowCount: block.rowCount,
            colCount: block.colCount,
            columns,
            formats: block.formats ?? [],
          })
          .returning({ id: tables.id });
        if (!table) throw new Error("Insert returned no table");
        // A formula column computes its cells, so none are stored for it.
        const filled = block.cells.filter(
          (cell) => cell.input !== "" && columns?.[cell.col]?.type !== "formula",
        );
        for (let from = 0; from < filled.length; from += INSERT_BATCH) {
          await tx.insert(cells).values(
            filled.slice(from, from + INSERT_BATCH).map((cell) => ({
              tableId: table.id,
              ...cell,
              updatedBy: this.userId,
            })),
          );
        }
      }
    }
  }

  /** The kept versions of a spreadsheet, newest first. */
  async listVersions(spreadsheetId: string): Promise<VersionRecord[]> {
    await this.findSpreadsheet(spreadsheetId, "read");
    return this.db
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
   * kept as a version first, so restoring can itself be undone.
   */
  async restoreVersion(spreadsheetId: string, versionId: string): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, "write");
    await this.change(spreadsheetId, async (tx) => {
      const version = await this.findVersion(tx, spreadsheetId, versionId);
      await this.keepVersion(tx, spreadsheetId, "Before restoring an earlier version");
      await tx.delete(journal).where(eq(journal.spreadsheetId, spreadsheetId));
      // Pages take their tables, cells, and views with them.
      await tx.delete(pages).where(eq(pages.spreadsheetId, spreadsheetId));
      await tx
        .update(spreadsheets)
        .set({ name: version.name })
        .where(eq(spreadsheets.id, spreadsheetId));
      await this.insertContents(tx, spreadsheetId, version);
    });
  }

  /** Makes a new spreadsheet, in the caller's own workspace, of a kept version. */
  async copyVersion(spreadsheetId: string, versionId: string): Promise<SpreadsheetSummary> {
    await this.findSpreadsheet(spreadsheetId, "read");
    const version = await this.findVersion(this.db, spreadsheetId, versionId);
    const name = `${version.name} (copy)`.slice(0, LIMITS.nameLength);
    return this.createFromFile({ ...version, name });
  }

  private async findVersion(
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
  private async keepVersion(db: Database, spreadsheetId: string, reason: string): Promise<void> {
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
    if (!current) await this.saveVersion(db, spreadsheetId, reason);
  }

  private async saveVersion(
    db: Database,
    spreadsheetId: string,
    reason: string | null,
  ): Promise<void> {
    const snapshot = await this.within(db).getSnapshot(spreadsheetId);
    const cellsOf = new Map<string, CellInput[]>();
    for (const { tableId, ...cell } of snapshot.cells) {
      cellsOf.set(tableId, [...(cellsOf.get(tableId) ?? []), cell]);
    }
    const data = toSpreadsheetFile(
      snapshot.name,
      snapshot.pages,
      snapshot.tables,
      snapshot.views,
      (table) => cellsOf.get(table.id) ?? [],
    );
    await db.insert(versions).values({ spreadsheetId, createdBy: this.userId, reason, data });

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

  /**
   * Marks the spreadsheet as changed now. When no version was kept lately,
   * one is kept of the spreadsheet as the change leaves it.
   */
  private async touch(db: Database, spreadsheetId: string): Promise<void> {
    noteChange(spreadsheetId);
    await db
      .update(spreadsheets)
      // The clock, not the start of the transaction: a version kept earlier in
      // this transaction must count as older than this change.
      .set({ updatedAt: sql`clock_timestamp()` })
      .where(eq(spreadsheets.id, spreadsheetId));
    const [latest] = await db
      .select({ createdAt: versions.createdAt })
      .from(versions)
      .where(eq(versions.spreadsheetId, spreadsheetId))
      .orderBy(desc(versions.createdAt))
      .limit(1);
    if (!latest || Date.now() - latest.createdAt.getTime() >= VERSION_INTERVAL_MS) {
      await this.saveVersion(db, spreadsheetId, null);
    }
  }

  /**
   * Everything a spreadsheet holds, as of one moment. The queries run in one
   * transaction that sees the database as it was when it began, so a change
   * that commits between two of them cannot give tables from before it and
   * cells from after. Inside a change the transaction is the change's own, and
   * the lock is what holds the spreadsheet still.
   */
  async getSnapshot(spreadsheetId: string): Promise<Snapshot> {
    return this.db.transaction(
      async (tx) => {
        const spreadsheet = await this.within(tx).findSpreadsheet(spreadsheetId, "read");
        const pageRows = await tx
          .select(pageColumns)
          .from(pages)
          .where(eq(pages.spreadsheetId, spreadsheetId))
          .orderBy(asc(pages.position));
        const tableRows = await tx
          .select(tableColumns)
          .from(tables)
          .innerJoin(pages, eq(pages.id, tables.pageId))
          .where(eq(pages.spreadsheetId, spreadsheetId))
          .orderBy(asc(tables.position));
        const cellRows = await tx
          .select({ tableId: cells.tableId, row: cells.row, col: cells.col, input: cells.input })
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
          pages: pageRows,
          tables: tableRows,
          views: viewRows,
          cells: cellRows,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async renameSpreadsheet(spreadsheetId: string, name: string): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, "write");
    noteChange(spreadsheetId);
    await this.db
      .update(spreadsheets)
      .set({ name, updatedAt: sql`now()` })
      .where(eq(spreadsheets.id, spreadsheetId));
  }

  async deleteSpreadsheet(spreadsheetId: string): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, "own");
    // Sessions that have it open learn that it is gone.
    noteChange(spreadsheetId);
    await this.db.delete(spreadsheets).where(eq(spreadsheets.id, spreadsheetId));
  }

  /** Creates a page with one empty table. Without a name the page gets the next free `Page N`. */
  async createPage(
    spreadsheetId: string,
    name?: string,
  ): Promise<{ page: PageRecord; table: TableRecord }> {
    await this.findSpreadsheet(spreadsheetId, "write");
    return this.change(spreadsheetId, async (tx, writer) => {
      writer.setLabel("Add page");
      const siblings = await tx
        .select({ name: pages.name, position: pages.position })
        .from(pages)
        .where(eq(pages.spreadsheetId, spreadsheetId));
      if (siblings.length >= FILE_LIMITS.pages) {
        throw unprocessable(
          "too_many_pages",
          `A spreadsheet can have at most ${String(FILE_LIMITS.pages)} pages`,
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
      const table = await this.insertTable(tx, page.id, undefined, writer);
      return { page, table };
    });
  }

  /** Renames a page and the formulas that name it. Returns what was rewritten. */
  async renamePage(pageId: string, name: string): Promise<Rewritten> {
    return this.changePage(pageId, async (page, tx, writer) => {
      writer.setLabel(`Rename page ${page.name}`);
      const rewritten = await this.rewriteFormulas(tx, writer, page.spreadsheetId, {
        kind: "page",
        pageId,
        name,
      });
      await writer.updatePage(pageId, { name }).catch(rethrowDuplicate("page", name));
      return rewritten;
    });
  }

  /**
   * Puts the blocks of a page in the order given. The
   * list must name every one of them once, so that a stale client cannot
   * leave two blocks in one place.
   */
  async reorderPage(pageId: string, blocks: readonly string[]): Promise<void> {
    await this.changePage(pageId, async (page, tx, writer) => {
      writer.setLabel(`Reorder blocks on ${page.name}`);
      const [tableRows, viewRows] = await Promise.all([
        tx.select({ id: tables.id }).from(tables).where(eq(tables.pageId, pageId)),
        tx.select({ id: views.id }).from(views).where(eq(views.pageId, pageId)),
      ]);
      const tableIds = new Set(tableRows.map((row) => row.id));
      const present = new Set([...tableIds, ...viewRows.map((row) => row.id)]);
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
  }

  /**
   * Puts the pages of a spreadsheet in the order given. The list must name
   * every one of them once, so that a stale client cannot leave two pages in
   * one place.
   */
  async reorderPages(spreadsheetId: string, order: readonly string[]): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, "write");
    await this.change(spreadsheetId, async (tx, writer) => {
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
        throw conflict("The pages have changed. Reload the spreadsheet and try again");
      }
      for (const [position, id] of order.entries()) {
        await writer.updatePage(id, { position });
      }
    });
  }

  /**
   * The page a block is to move to: another page of the block's own
   * spreadsheet. Must run inside `change`.
   */
  private async destination(
    tx: Database,
    block: Found<{ pageId: string; name: string }>,
    pageId: string,
  ): Promise<PageRecord> {
    const page = await this.within(tx).findPage(pageId, "write");
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
  async moveTable(tableId: string, pageId: string): Promise<Rewritten & { table: TableRecord }> {
    return this.changeTable(tableId, async (table, tx, writer) => {
      const page = await this.destination(tx, table, pageId);
      const position = await this.within(tx).nextPosition(pageId);
      writer.setLabel(`Move table ${table.name}`);
      const rewritten = await this.rewriteForMove(tx, writer, table.spreadsheetId, {
        kind: "table",
        tableId,
        pageId,
      });
      const updated = await writer
        .updateTable(tableId, { pageId, position })
        .catch((cause: unknown) => {
          if (!isUniqueViolation(cause)) throw cause;
          throw conflict(`${page.name} already has a table named ${table.name}`);
        });
      return {
        table: updated,
        ...rewritten,
        tables: rewritten.tables.filter((candidate) => candidate.id !== tableId),
      };
    });
  }

  /**
   * Moves a chart or text view to the end of another page of its
   * spreadsheet. Where its source named a table by name alone, it now names
   * the page too, and so reads the same table.
   */
  async moveView(viewId: string, pageId: string): Promise<Rewritten & { view: ViewRecord }> {
    return this.changeView(viewId, async (view, tx, writer) => {
      await this.destination(tx, view, pageId);
      const position = await this.within(tx).nextPosition(pageId);
      writer.setLabel(`Move ${view.kind} ${view.name}`);
      const rewritten = await this.rewriteForMove(tx, writer, view.spreadsheetId, {
        kind: "view",
        viewId,
        pageId,
      });
      const updated = await writer.updateView(viewId, { pageId, position });
      return {
        view: updated,
        ...rewritten,
        views: rewritten.views.filter((candidate) => candidate.id !== viewId),
      };
    });
  }

  private async insertTable(
    tx: Database,
    pageId: string,
    name: string | undefined,
    writer: ContentWriter,
  ): Promise<TableRecord> {
    const siblings = await tx
      .select({ name: tables.name })
      .from(tables)
      .where(eq(tables.pageId, pageId));
    const values = {
      pageId,
      name:
        name ??
        nextName(
          "Table",
          siblings.map((table) => table.name),
        ),
      position: await this.within(tx).nextPosition(pageId),
      ...DEFAULT_TABLE_SIZE,
    };
    return writer.insertTable(values).catch(rethrowDuplicate("table", values.name));
  }

  async deletePage(pageId: string): Promise<void> {
    await this.changePage(pageId, async (page, tx, writer) => {
      writer.setLabel(`Delete page ${page.name}`);
      const remaining = await tx.$count(pages, eq(pages.spreadsheetId, page.spreadsheetId));
      if (remaining <= 1) throw conflict("A spreadsheet needs at least one page");
      await this.keepVersion(tx, page.spreadsheetId, `Before deleting the page ${page.name}`);
      await writer.deletePage(pageId);
    });
  }

  /** Creates an empty table. Without a name the table gets the next free `Table N`. */
  async createTable(pageId: string, name?: string): Promise<TableRecord> {
    return this.changePage(pageId, async (_page, tx, writer) => {
      writer.setLabel("Add table");
      return this.insertTable(tx, pageId, name, writer);
    });
  }

  /**
   * Renames or resizes a table. Renaming rewrites the formulas that name the
   * table. Making it smaller deletes the rows and columns past the new size
   * as any others are deleted, so formulas, views, and formats follow.
   */
  async updateTable(
    tableId: string,
    changes: {
      name?: string | undefined;
      rowCount?: number | undefined;
      colCount?: number | undefined;
    },
  ): Promise<Rewritten & { table: TableRecord }> {
    return this.changeTable(tableId, async (table, tx, writer) => {
      const { spreadsheetId } = table;
      writer.setLabel(
        changes.name !== undefined ? `Rename table ${table.name}` : `Resize table ${table.name}`,
      );
      const sizes = [
        { axis: "row", from: table.rowCount, to: changes.rowCount ?? table.rowCount },
        { axis: "col", from: table.colCount, to: changes.colCount ?? table.colCount },
      ] as const;
      if (sizes.some(({ from, to }) => to < from)) {
        await this.keepVersion(tx, spreadsheetId, `Before making ${table.name} smaller`);
      }
      let rewritten: Rewritten = { cells: [], views: [], tables: [] };
      for (const { axis, from, to } of sizes) {
        if (to >= from) continue;
        const edit = { tableId, axis, kind: "delete", index: to, count: from - to } as const;
        rewritten = merged(rewritten, await this.applyEdit(tx, writer, spreadsheetId, edit));
      }
      if (changes.name !== undefined) {
        const rename = { kind: "table", tableId, name: changes.name } as const;
        rewritten = merged(
          rewritten,
          await this.rewriteFormulas(tx, writer, spreadsheetId, rename),
        );
      }
      // The steps above may have rewritten this table's own formula columns.
      const current =
        rewritten.tables.find((candidate) => candidate.id === tableId)?.columns ?? table.columns;
      const columns =
        current && changes.colCount !== undefined ? resized(current, changes.colCount) : current;
      const updated = await writer
        .updateTable(tableId, { ...changes, columns })
        .catch(rethrowDuplicate("table", changes.name ?? ""));
      return {
        table: updated,
        ...rewritten,
        tables: rewritten.tables.filter((candidate) => candidate.id !== tableId),
      };
    });
  }

  /**
   * Gives a plain table named columns, which makes it a data table. With
   * `headerRow`, the first row supplies the names and is removed from the
   * data. Otherwise the columns are named Column 1, Column 2, and so on.
   */
  async nameColumns(
    tableId: string,
    headerRow: boolean,
  ): Promise<Rewritten & { table: TableRecord }> {
    return this.changeTable(tableId, async (table, tx, writer) => {
      if (table.columns) throw conflict(`${table.name} already has named columns`);
      writer.setLabel(`Name the columns of ${table.name}`);
      if (headerRow) {
        await this.keepVersion(
          tx,
          table.spreadsheetId,
          `Before naming the columns of ${table.name}`,
        );
      }
      const header = headerRow
        ? await tx
            .select({ col: cells.col, input: cells.input })
            .from(cells)
            .where(and(eq(cells.tableId, tableId), eq(cells.row, 0)))
        : [];
      // Taking the header row out moves every cell up, and formulas follow as for any deleted row.
      let rewritten: Rewritten = { cells: [], views: [], tables: [] };
      if (headerRow && table.rowCount > 1) {
        rewritten = await this.applyEdit(tx, writer, table.spreadsheetId, {
          tableId,
          axis: "row",
          kind: "delete",
          index: 0,
          count: 1,
        });
      } else if (headerRow) {
        rewritten.cells = header.map(({ col }) => ({ tableId, row: 0, col, input: "" }));
        await writer.setCells(rewritten.cells);
      }
      const typed = new Map(header.map(({ col, input }) => [col, input]));
      const names: string[] = [];
      for (let col = 0; col < table.colCount; col += 1)
        names.push(columnNameFrom(typed.get(col), names));
      const updated = await writer.updateTable(tableId, {
        columns: names.map((name) => ({ name, type: "any" as const })),
      });
      return {
        ...rewritten,
        table: updated,
        // The edit returned this table as it was before its columns were named.
        tables: rewritten.tables.filter((candidate) => candidate.id !== tableId),
      };
    });
  }

  /** Changes how a range of cells is shown. The format is added to whatever the cells already have. */
  async formatCells(tableId: string, rule: FormatRule): Promise<TableRecord> {
    return this.changeTable(tableId, async (table, _tx, writer) => {
      writer.setLabel(`Format cells in ${table.name}`);
      const formats = addFormatRule(table.formats, rule);
      if (formats.length > MAX_FORMAT_RULES) {
        throw unprocessable(
          "too_many_formats",
          `${table.name} has too many separate formats. Clear the formatting of some cells first`,
        );
      }
      return writer.updateTable(tableId, { formats });
    });
  }

  /** Makes a data table a plain table again. Its formula columns stop computing. */
  async dropColumns(tableId: string): Promise<TableRecord> {
    return this.changeTable(tableId, async (table, tx, writer) => {
      writer.setLabel(`Remove the column names of ${table.name}`);
      await this.keepVersion(
        tx,
        table.spreadsheetId,
        `Before removing the column names of ${table.name}`,
      );
      return writer.updateTable(tableId, { columns: null });
    });
  }

  /**
   * Changes a column's name, type, or formula. A rename rewrites the formulas
   * that name the column. A column that becomes a formula column loses what
   * was typed into it.
   */
  async updateColumn(
    tableId: string,
    col: number,
    changes: {
      name?: string | undefined;
      type?: ColumnType | undefined;
      formula?: string | undefined;
    },
  ): Promise<Rewritten & { table: TableRecord }> {
    return this.changeTable(tableId, async (found, tx, writer) => {
      const before = found.columns?.[col];
      if (!found.columns)
        throw unprocessable("not_a_data_table", `${found.name} has no named columns`);
      if (!before)
        throw unprocessable("out_of_bounds", `${found.name} has no column ${columnLabel(col)}`);
      writer.setLabel(
        changes.name !== undefined
          ? `Rename column ${before.name}`
          : `Change column ${before.name}`,
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
      const column = normalized({ name, type, formula: given });

      if (type === "formula" && before.type !== "formula") {
        await this.keepVersion(
          tx,
          found.spreadsheetId,
          `Before making ${before.name} a formula column`,
        );
      }
      const renamed = !sameColumnName(before.name, name) || before.name !== name;
      const rewritten = renamed
        ? await this.rewriteFormulas(tx, writer, found.spreadsheetId, {
            kind: "column",
            tableId,
            from: before.name,
            name,
          })
        : { cells: [], views: [], tables: [] };
      // The rename may have rewritten the other formula columns of this table.
      const current =
        rewritten.tables.find((candidate) => candidate.id === tableId)?.columns ?? found.columns;
      // A formula column's own formula is taken from the request when it gives one, and
      // otherwise from the rewrite, which has the new name written into it.
      const kept = current[col];
      const next =
        type === "formula" && changes.formula === undefined && kept?.formula !== undefined
          ? { ...column, formula: kept.formula }
          : column;
      const updated = await writer.updateTable(tableId, { columns: current.with(col, next) });
      if (type === "formula") {
        await writer.clearCells(tableId, eq(cells.col, col));
      }
      return {
        table: updated,
        ...rewritten,
        tables: rewritten.tables.filter((candidate) => candidate.id !== tableId),
      };
    });
  }

  /** Adds a chart or a text view to the end of a page. */
  async createView(pageId: string, kind: ViewKind): Promise<ViewRecord> {
    return this.changePage(pageId, async (_page, tx, writer) => {
      writer.setLabel(kind === "chart" ? "Add chart" : "Add text view");
      const siblings = await tx
        .select({ name: views.name })
        .from(views)
        .where(and(eq(views.pageId, pageId), eq(views.kind, kind)));
      const names = siblings.map((view) => view.name);
      return writer.insertView({
        pageId,
        kind,
        position: await this.within(tx).nextPosition(pageId),
        ...(kind === "chart"
          ? { name: nextName("Chart", names), source: "", chartType: "bar" as const }
          : { name: nextName("Text", names), source: STARTER_TEMPLATE }),
      });
    });
  }

  async updateView(
    viewId: string,
    changes: {
      name?: string | undefined;
      source?: string | undefined;
      chartType?: ChartType | undefined;
    },
  ): Promise<ViewRecord> {
    return this.changeView(viewId, async (view, _tx, writer) => {
      writer.setLabel(`Update ${view.kind} ${view.name}`);
      if (changes.chartType !== undefined && view.kind !== "chart") {
        throw unprocessable("not_a_chart", `${view.name} is not a chart`);
      }
      return writer.updateView(viewId, changes);
    });
  }

  async deleteView(viewId: string): Promise<void> {
    await this.changeView(viewId, async (view, tx, writer) => {
      writer.setLabel(`Delete ${view.kind} ${view.name}`);
      await this.keepVersion(tx, view.spreadsheetId, `Before deleting ${view.name}`);
      await writer.deleteView(viewId);
    });
  }

  async deleteTable(tableId: string): Promise<void> {
    await this.changeTable(tableId, async (table, tx, writer) => {
      writer.setLabel(`Delete table ${table.name}`);
      await this.keepVersion(tx, table.spreadsheetId, `Before deleting the table ${table.name}`);
      await writer.deleteTable(tableId);
    });
  }

  /** Stores cell inputs. An empty input deletes the cell. Later entries for the same cell win. */
  async setCells(tableId: string, inputs: readonly CellInput[]): Promise<void> {
    await this.changeTable(tableId, async (table, tx, writer) => {
      writer.setLabel(`Change cells in ${table.name}`);
      const outside = inputs.find(
        (cell) => cell.row >= table.rowCount || cell.col >= table.colCount,
      );
      if (outside) {
        throw unprocessable(
          "cell_out_of_bounds",
          `${formatAddress(outside)} is outside the table ${table.name}`,
        );
      }

      const computed = inputs
        .map((cell) => table.columns?.[cell.col])
        .find((column) => column?.type === "formula");
      if (computed) {
        throw unprocessable(
          "formula_column",
          `${computed.name} is a formula column. Change the column's formula instead`,
        );
      }

      // One statement cannot update the same row twice, so keep the last entry per cell.
      const latest = [...new Map(inputs.map((cell) => [formatAddress(cell), cell])).values()];
      if (latest.length >= BULK_WRITE_CELLS) {
        await this.keepVersion(
          tx,
          table.spreadsheetId,
          `Before changing ${String(latest.length)} cells of ${table.name}`,
        );
      }
      await writer.setCells(latest.map((cell) => ({ tableId, ...cell })));
      if (latest.some((cell) => cell.input !== "")) {
        await this.checkCellCount(tx, table.spreadsheetId);
      }
    });
  }

  /** Refuses a change that leaves a spreadsheet with more filled cells than a file of it may hold. */
  private async checkCellCount(tx: Database, spreadsheetId: string): Promise<void> {
    const [counted] = await tx
      .select({ filled: count() })
      .from(cells)
      .innerJoin(tables, eq(tables.id, cells.tableId))
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(eq(pages.spreadsheetId, spreadsheetId));
    if ((counted?.filled ?? 0) > FILE_LIMITS.cells) {
      throw unprocessable(
        "too_many_cells",
        `A spreadsheet can have at most ${String(FILE_LIMITS.cells)} filled cells`,
      );
    }
  }

  /**
   * Grows a table to at least `rowCount` rows. Returns the table when it
   * grew, and `undefined` when it was already as tall.
   */
  async ensureRows(tableId: string, rowCount: number): Promise<TableRecord | undefined> {
    return this.changeTable(tableId, async (table, _tx, writer) => {
      if (rowCount <= table.rowCount) return undefined;
      writer.setLabel(`Grow ${table.name} to ${String(rowCount)} rows`);
      if (rowCount > LIMITS.tableRows) {
        throw unprocessable(
          "table_full",
          `${table.name} cannot have more than ${String(LIMITS.tableRows)} rows`,
        );
      }
      return writer.updateTable(tableId, { rowCount });
    });
  }

  /**
   * Inserts or deletes rows or columns that sit next to each other. Cells
   * past them move, and formulas anywhere in the spreadsheet that read the
   * table are rewritten to keep reading the same cells, as are charts and
   * text views.
   */
  async editStructure(
    tableId: string,
    body: StructuralEditBody,
  ): Promise<Rewritten & { table: TableRecord }> {
    return this.changeTable(tableId, async (table, tx, writer) => {
      const { spreadsheetId } = table;
      const { count = 1 } = body;
      const edit = { tableId, ...body, count };
      const rows = edit.axis === "row";
      const noun = rows ? "row" : "column";
      writer.setLabel(
        `${edit.kind === "insert" ? "Insert" : "Delete"} ${noun}${count === 1 ? "" : "s"} in ${table.name}`,
      );
      const size = rows ? table.rowCount : table.colCount;
      const limit = rows ? LIMITS.tableRows : LIMITS.tableCols;
      const label = (index: number): string => (rows ? String(index + 1) : columnLabel(index));
      if (edit.kind === "delete") {
        const last = edit.index + count - 1;
        if (last >= size) {
          throw unprocessable("out_of_bounds", `${table.name} has no ${noun} ${label(last)}`);
        }
        if (count >= size) throw unprocessable("last_one", `A table needs at least one ${noun}`);
        const deleted =
          count === 1
            ? `${noun} ${label(edit.index)}`
            : `${noun}s ${label(edit.index)} to ${label(last)}`;
        await this.keepVersion(tx, spreadsheetId, `Before deleting ${deleted} of ${table.name}`);
      } else {
        if (edit.index > size) {
          const counted = `${String(size)} ${noun}${size === 1 ? "" : "s"}`;
          throw unprocessable("out_of_bounds", `${table.name} has only ${counted}`);
        }
        if (size + count > limit) {
          throw unprocessable("table_full", `A table can have at most ${String(limit)} ${noun}s`);
        }
      }

      const { tables: changed, ...rewritten } = await this.applyEdit(
        tx,
        writer,
        spreadsheetId,
        edit,
      );
      const updated = changed.find((candidate) => candidate.id === tableId);
      if (!updated) throw notFound("Table");
      return {
        table: updated,
        ...rewritten,
        tables: changed.filter((candidate) => candidate.id !== tableId),
      };
    });
  }

  /**
   * Carries out an edit that is known to fit its table: moves the cells,
   * rewrites what reads them, and resizes the table. Must run inside `change`.
   * The tables returned include the edited one.
   */
  private async applyEdit(
    tx: Database,
    writer: ContentWriter,
    spreadsheetId: string,
    edit: StructuralEdit & { count: number },
  ): Promise<Rewritten> {
    writer.markRewrites();
    const snapshot = await this.within(tx).getSnapshot(spreadsheetId);
    const table = snapshot.tables.find((candidate) => candidate.id === edit.tableId);
    if (!table) throw notFound("Table");
    const rows = edit.axis === "row";

    const written = inputsAfterEdit(snapshot, edit);
    await writer.setCells(written);
    const rewrittenViews = viewsAfterEdit(snapshot, snapshot.views, edit);
    await this.storeViewSources(writer, rewrittenViews);
    const changed = await this.storeColumnFormulas(
      writer,
      snapshot.tables,
      columnFormulasAfterEdit(snapshot, edit),
    );
    // The formulas were rewritten at the positions the columns had before the edit.
    const current =
      changed.find((candidate) => candidate.id === table.id)?.columns ?? table.columns;
    const columns =
      current && !rows
        ? edit.kind === "insert"
          ? withColumnsInserted(current, edit.index, edit.count)
          : current.toSpliced(edit.index, edit.count)
        : current;
    const size =
      (rows ? table.rowCount : table.colCount) + edit.count * (edit.kind === "insert" ? 1 : -1);
    const updated = await writer.updateTable(table.id, {
      ...(rows ? { rowCount: size } : { colCount: size, columns }),
      // Formats follow the cells they were given to.
      formats: formatRulesAfterEdit(table.formats, edit),
    });
    return {
      cells: written,
      views: rewrittenViews,
      tables: [...changed.filter((candidate) => candidate.id !== table.id), updated],
    };
  }

  /**
   * Blocks other transactions that lock the same spreadsheet until this one
   * ends. Button clicks use it so that two clicks on a counter do not both
   * read the same starting value.
   */
  async lockSpreadsheet(spreadsheetId: string): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, "write");
    await lockSpreadsheet(this.db, spreadsheetId);
    await this.findSpreadsheet(spreadsheetId, "write");
  }

  /** Whether this tab has anything it can undo or redo. */
  async undoState(spreadsheetId: string): Promise<{ undoable: boolean; redoable: boolean }> {
    await this.findSpreadsheet(spreadsheetId, "read");
    return this.stackState(this.db, spreadsheetId, requestContext()?.clientId ?? null);
  }

  /** Reverses the newest step on this tab's stack. */
  async undo(spreadsheetId: string): Promise<UndoResult> {
    await this.findSpreadsheet(spreadsheetId, "write");
    return this.locked(spreadsheetId, (tx) => this.changeHistory(tx, spreadsheetId, "undo"));
  }

  /** Reapplies the oldest step on this tab's redo stack. */
  async redo(spreadsheetId: string): Promise<UndoResult> {
    await this.findSpreadsheet(spreadsheetId, "write");
    return this.locked(spreadsheetId, (tx) => this.changeHistory(tx, spreadsheetId, "redo"));
  }

  private async changeHistory(
    tx: Database,
    spreadsheetId: string,
    direction: "undo" | "redo",
  ): Promise<UndoResult> {
    const clientId = requestContext()?.clientId ?? null;
    if (clientId === null) return this.historyResult(tx, spreadsheetId, clientId, "nothing");
    const undone = direction === "redo";
    const stack = and(
      eq(journal.spreadsheetId, spreadsheetId),
      eq(journal.userId, this.userId),
      eq(journal.clientId, clientId),
      eq(journal.undone, undone),
    );
    const [latest] = await tx
      .select({ step: journal.step, label: journal.label })
      .from(journal)
      .where(stack)
      .orderBy(direction === "undo" ? desc(journal.seq) : asc(journal.seq))
      .limit(1);
    if (!latest) return this.historyResult(tx, spreadsheetId, clientId, "nothing");

    const group = and(
      eq(journal.spreadsheetId, spreadsheetId),
      eq(journal.userId, this.userId),
      eq(journal.clientId, clientId),
      eq(journal.step, latest.step),
    );
    const entries = await tx
      .select()
      .from(journal)
      .where(group)
      .orderBy(direction === "undo" ? desc(journal.seq) : asc(journal.seq));
    const newestSequence = Math.max(...entries.map((entry) => entry.seq));

    try {
      const later = await tx
        .select({ rewrites: journal.rewrites, undone: journal.undone })
        .from(journal)
        .where(
          and(
            eq(journal.spreadsheetId, spreadsheetId),
            gt(journal.seq, newestSequence),
            eq(journal.undone, false),
          ),
        );
      const structural = entries.some(
        (entry) =>
          entry.rewrites ||
          (entry.data !== null &&
            [...entry.data.pages, ...entry.data.tables, ...entry.data.views].some(
              ({ before, after }) => before === null || after === null,
            )),
      );
      if (structural && later.length > 0) {
        throw new UndoRefusal("A later change prevents undoing this structural change");
      }
      if (later.some((entry) => entry.rewrites)) {
        throw new UndoRefusal("A later structural change prevents undoing this change");
      }

      const changed = await tx.transaction(async (writes) => {
        let accumulated = emptyChangedContent();
        for (const entry of entries) {
          if (!entry.data) {
            throw new UndoRefusal(
              "This change is too large to undo. Use History to restore a version",
            );
          }
          await this.assertRecordedMatches(writes, entry.data, direction);
          accumulated = mergeChangedContent(
            accumulated,
            await applyRecorded(writes, spreadsheetId, this.userId, entry.data, direction),
          );
        }
        await this.checkRestoredState(writes, spreadsheetId);
        return accumulated;
      });
      await tx.update(journal).set({ undone: !undone }).where(group);
      await this.touch(tx, spreadsheetId);
      return {
        outcome: "done",
        label: latest.label,
        error: null,
        changed,
        ...(await this.stackState(tx, spreadsheetId, clientId)),
      };
    } catch (error) {
      // The nested transaction has rolled back whatever the apply wrote.
      const message =
        error instanceof UndoRefusal
          ? error.message
          : isUniqueViolation(error)
            ? "This change would create a duplicate name and cannot be restored"
            : isForeignKeyViolation(error)
              ? "This change belongs to a page or table that has since been deleted"
              : undefined;
      if (message === undefined) throw error;
      await tx.update(journal).set({ clientId: null }).where(group);
      return {
        outcome: "refused",
        label: latest.label,
        error: message,
        changed: emptyChangedContent(),
        ...(await this.stackState(tx, spreadsheetId, clientId)),
      };
    }
  }

  private async stackState(
    db: Database,
    spreadsheetId: string,
    clientId: string | null,
  ): Promise<{ undoable: boolean; redoable: boolean }> {
    if (clientId === null) return { undoable: false, redoable: false };
    const rows = await db
      .select({ undone: journal.undone })
      .from(journal)
      .where(
        and(
          eq(journal.spreadsheetId, spreadsheetId),
          eq(journal.userId, this.userId),
          eq(journal.clientId, clientId),
        ),
      );
    return {
      undoable: rows.some((row) => !row.undone),
      redoable: rows.some((row) => row.undone),
    };
  }

  private async historyResult(
    db: Database,
    spreadsheetId: string,
    clientId: string | null,
    outcome: UndoResult["outcome"],
  ): Promise<UndoResult> {
    return {
      outcome,
      label: null,
      error: null,
      changed: emptyChangedContent(),
      ...(await this.stackState(db, spreadsheetId, clientId)),
    };
  }

  private async assertRecordedMatches(
    db: Database,
    data: JournalData,
    direction: "undo" | "redo",
  ): Promise<void> {
    const expected = <T>(before: T, after: T): T => (direction === "undo" ? after : before);
    for (const { id, before, after } of data.pages) {
      const [current] = await db.select(pageColumns).from(pages).where(eq(pages.id, id)).limit(1);
      if (!sameRecord(current ?? null, expected(before, after))) {
        throw new UndoRefusal("This page has changed since this step");
      }
    }
    for (const { id, before, after } of data.tables) {
      const [current] = await db
        .select(tableColumns)
        .from(tables)
        .where(eq(tables.id, id))
        .limit(1);
      if (!sameRecord(current ?? null, expected(before, after))) {
        throw new UndoRefusal("This table has changed since this step");
      }
    }
    for (const { id, before, after } of data.views) {
      const [current] = await db.select(viewColumns).from(views).where(eq(views.id, id)).limit(1);
      if (!sameRecord(current ?? null, expected(before, after))) {
        throw new UndoRefusal("This view has changed since this step");
      }
    }
    for (const { tableId, changes } of data.cells) {
      const inputs = await readInputs(
        db,
        tableId,
        changes.map(([row, col]) => ({ row, col })),
      );
      for (const [row, col, before, after] of changes) {
        if (inputs.get({ row, col }) !== expected(before, after)) {
          throw new UndoRefusal("A cell has changed since this step");
        }
      }
    }
  }

  private async checkRestoredState(db: Database, spreadsheetId: string): Promise<void> {
    const pageRows = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.spreadsheetId, spreadsheetId));
    if (pageRows.length === 0) throw new UndoRefusal("A spreadsheet needs at least one page");
    if (pageRows.length > FILE_LIMITS.pages) {
      throw new UndoRefusal("This change would exceed the page limit");
    }
    const tableRows = await db
      .select({
        id: tables.id,
        pageId: tables.pageId,
        rowCount: tables.rowCount,
        colCount: tables.colCount,
        columns: tables.columns,
      })
      .from(tables)
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(eq(pages.spreadsheetId, spreadsheetId));
    if (
      tableRows.some(
        (table) =>
          table.rowCount > LIMITS.tableRows ||
          table.colCount > LIMITS.tableCols ||
          table.rowCount < 1 ||
          table.colCount < 1,
      )
    ) {
      throw new UndoRefusal("This change would exceed a table limit");
    }
    const [cellCount] = await db
      .select({ filled: count() })
      .from(cells)
      .innerJoin(tables, eq(tables.id, cells.tableId))
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(eq(pages.spreadsheetId, spreadsheetId));
    if ((cellCount?.filled ?? 0) > FILE_LIMITS.cells) {
      throw new UndoRefusal("This change would exceed the spreadsheet cell limit");
    }
    const outside = await db
      .select({ tableId: cells.tableId })
      .from(cells)
      .innerJoin(tables, eq(tables.id, cells.tableId))
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(
        and(
          eq(pages.spreadsheetId, spreadsheetId),
          or(gte(cells.row, tables.rowCount), gte(cells.col, tables.colCount)),
        ),
      )
      .limit(1);
    if (outside.length > 0) throw new UndoRefusal("This change would put a cell outside its table");

    const formulaCells = tableRows.flatMap((table) =>
      (table.columns ?? []).flatMap((column, col) =>
        column.type === "formula" ? [{ tableId: table.id, col }] : [],
      ),
    );
    for (let start = 0; start < formulaCells.length; start += INSERT_BATCH) {
      const found = await db
        .select({ tableId: cells.tableId })
        .from(cells)
        .where(
          or(
            ...formulaCells
              .slice(start, start + INSERT_BATCH)
              .map(({ tableId, col }) => and(eq(cells.tableId, tableId), eq(cells.col, col))),
          ),
        )
        .limit(1);
      if (found.length > 0) {
        throw new UndoRefusal("This change would store a value in a formula column");
      }
    }
    const blockCounts = new Map(pageRows.map(({ id }) => [id, 0]));
    const blocks = await Promise.all([
      db
        .select({ pageId: tables.pageId })
        .from(tables)
        .innerJoin(pages, eq(pages.id, tables.pageId))
        .where(eq(pages.spreadsheetId, spreadsheetId)),
      db
        .select({ pageId: views.pageId })
        .from(views)
        .innerJoin(pages, eq(pages.id, views.pageId))
        .where(eq(pages.spreadsheetId, spreadsheetId)),
    ]);
    for (const { pageId } of [...blocks[0], ...blocks[1]]) {
      blockCounts.set(pageId, (blockCounts.get(pageId) ?? 0) + 1);
    }
    if ([...blockCounts.values()].some((total) => total > FILE_LIMITS.blocksPerPage)) {
      throw new UndoRefusal("This change would exceed the page block limit");
    }
  }

  /**
   * Makes other transactions that count this user's email wait until this one
   * ends. Without it, two clicks at once would each count the email sent so
   * far, find room, and together send more than the limit.
   */
  async lockUser(): Promise<void> {
    await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, this.userId))
      .for("update");
  }

  /** How many emails the user's button clicks set out to send since `since`. */
  async countEmails(since: Date): Promise<number> {
    const [counted] = await this.db
      .select({ emails: sum(actionRuns.emails).mapWith(Number) })
      .from(actionRuns)
      .where(and(eq(actionRuns.userId, this.userId), gte(actionRuns.createdAt, since)));
    return counted?.emails ?? 0;
  }

  async findSpreadsheet(
    spreadsheetId: string,
    access: Access,
  ): Promise<{ id: string; name: string; role: Role }> {
    const [row] = await this.db
      .select({ id: spreadsheets.id, name: spreadsheets.name, role: this.access.role })
      .from(spreadsheets)
      .innerJoin(this.access, this.granted())
      .where(eq(spreadsheets.id, spreadsheetId));
    return authorize(row, access, "Spreadsheet");
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

  /**
   * Rewrites the formulas that name a page or table about to be renamed, and
   * returns the cells that changed. Must run inside `change`, before the
   * rename itself: the old name is how the formulas are recognized, and a
   * cell saved during the rename would keep the old name.
   */
  private async rewriteFormulas(
    tx: Database,
    writer: ContentWriter,
    spreadsheetId: string,
    rename: Rename,
  ): Promise<Rewritten> {
    const snapshot = await this.within(tx).getSnapshot(spreadsheetId);
    return this.storeRewrite(writer, snapshot, {
      cells: inputsAfterRename(snapshot, rename),
      views: viewsAfterRename(snapshot, snapshot.views, rename),
      columns: columnFormulasAfterRename(snapshot, rename),
    });
  }

  /**
   * Rewrites the formulas that must name a page for a table or view to move
   * to another page, and returns what changed. Must run inside `change`,
   * before the move itself: where things are now is how the formulas are read.
   */
  private async rewriteForMove(
    tx: Database,
    writer: ContentWriter,
    spreadsheetId: string,
    move: Move,
  ): Promise<Rewritten> {
    const snapshot = await this.within(tx).getSnapshot(spreadsheetId);
    return this.storeRewrite(writer, snapshot, {
      cells: inputsAfterMove(snapshot, move),
      views: viewsAfterMove(snapshot, snapshot.views, move),
      columns: columnFormulasAfterMove(snapshot, move),
    });
  }

  /** Stores what a rewrite changed in the three places that hold formulas. */
  private async storeRewrite(
    writer: ContentWriter,
    snapshot: Snapshot,
    rewritten: {
      cells: StoredCell[];
      views: { id: string; source: string }[];
      columns: ColumnFormula[];
    },
  ): Promise<Rewritten> {
    writer.markRewrites();
    await writer.setCells(rewritten.cells);
    await this.storeViewSources(writer, rewritten.views);
    const tables = await this.storeColumnFormulas(writer, snapshot.tables, rewritten.columns);
    return { cells: rewritten.cells, views: rewritten.views, tables };
  }

  /** Stores rewritten formulas of formula columns, and returns the tables they belong to as they now are. */
  private async storeColumnFormulas(
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

  private async storeViewSources(
    writer: ContentWriter,
    changed: readonly { id: string; source: string }[],
  ): Promise<void> {
    for (const { id, source } of changed) {
      await writer.updateView(id, { source });
    }
  }

  /**
   * The position that puts a new block after everything else on its
   * page. Refuses when the page already holds as many as a file of it may.
   */
  private async nextPosition(pageId: string): Promise<number> {
    const taken = await Promise.all([
      this.db.select({ position: tables.position }).from(tables).where(eq(tables.pageId, pageId)),
      this.db.select({ position: views.position }).from(views).where(eq(views.pageId, pageId)),
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

  /** The join condition that limits a query to the spreadsheets the user may open. */
  private granted() {
    return and(eq(this.access.spreadsheetId, spreadsheets.id), eq(this.access.userId, this.userId));
  }

  /**
   * The workspace new spreadsheets go into: the user's oldest one, created on
   * first use. Must run in a transaction. Locking the user row makes two
   * concurrent first requests wait for each other instead of each creating a
   * workspace.
   */
  private async personalWorkspace(): Promise<string> {
    const [user] = await this.db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, this.userId))
      .for("update");
    if (!user) throw notFound("User");

    const [membership] = await this.db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, this.userId))
      .orderBy(asc(workspaceMembers.createdAt))
      .limit(1);
    if (membership) return membership.workspaceId;

    const [workspace] = await this.db
      .insert(workspaces)
      .values({ name: `${user.name}'s workspace` })
      .returning({ id: workspaces.id });
    if (!workspace) throw new Error("Insert returned no workspace");
    await this.db
      .insert(workspaceMembers)
      .values({ workspaceId: workspace.id, userId: this.userId, role: "owner" });
    return workspace.id;
  }
}

function authorize<T extends { role: Role }>(row: T | undefined, access: Access, what: string): T {
  if (!row) throw notFound(what);
  if (access !== "read" && row.role === "viewer") throw forbidden();
  if (access === "own" && row.role !== "owner") throw ownerOnly();
  return row;
}

function sameRecord(left: unknown, right: unknown): boolean {
  return isDeepStrictEqual(left, right);
}

function emptyChangedContent(): ChangedContent {
  return { pages: [], tables: [], views: [], cells: [] };
}

function mergeChangedContent(earlier: ChangedContent, later: ChangedContent): ChangedContent {
  const latest = <T>(items: readonly T[], key: (item: T) => string): T[] => [
    ...new Map(items.map((item) => [key(item), item])).values(),
  ];
  return {
    pages: latest([...earlier.pages, ...later.pages], ({ id }) => id),
    tables: latest([...earlier.tables, ...later.tables], ({ id }) => id),
    views: latest([...earlier.views, ...later.views], ({ id }) => id),
    cells: latest(
      [...earlier.cells, ...later.cells],
      ({ tableId, row, col }) => `${tableId}:${String(row)}:${String(col)}`,
    ),
  };
}

async function lockSpreadsheet(db: Database, spreadsheetId: string): Promise<void> {
  await db
    .select({ id: spreadsheets.id })
    .from(spreadsheets)
    .where(eq(spreadsheets.id, spreadsheetId))
    .for("update");
}

/** A column definition as it is stored: a formula only on a formula column, and starting with `=`. */
function normalized({ name, type, formula = "" }: ColumnDefinition): ColumnDefinition {
  if (type !== "formula") return { name, type };
  const trimmed = formula.trim();
  return { name, type, formula: isFormulaInput(trimmed) ? trimmed : `=${trimmed}` };
}

/** The first of `Column 1`, `Column 2`, ... that no column has. */
function nextColumnName(columns: readonly ColumnDefinition[]): string {
  return nextName(
    "Column",
    columns.map((column) => column.name),
  );
}

/**
 * What two rewrites in a row rewrote together. Where both wrote the same
 * cell, view, or table, the later one has it as it now is.
 */
function merged(earlier: Rewritten, later: Rewritten): Rewritten {
  const latest = <T>(items: readonly T[], key: (item: T) => string): T[] => [
    ...new Map(items.map((item) => [key(item), item])).values(),
  ];
  return {
    cells: latest(
      [...earlier.cells, ...later.cells],
      (cell) => `${cell.tableId}:${formatAddress(cell)}`,
    ),
    views: latest([...earlier.views, ...later.views], (view) => view.id),
    tables: latest([...earlier.tables, ...later.tables], (table) => table.id),
  };
}

/** A table's columns with `count` new ones put in at `index`, each with the next free name. */
function withColumnsInserted(
  columns: readonly ColumnDefinition[],
  index: number,
  count: number,
): ColumnDefinition[] {
  const result = [...columns];
  for (let added = 0; added < count; added += 1) {
    result.splice(index + added, 0, { name: nextColumnName(result), type: "any" });
  }
  return result;
}

/** A table's columns after its width changes: new ones at the end, or fewer. */
function resized(columns: readonly ColumnDefinition[], colCount: number): ColumnDefinition[] {
  const kept = columns.slice(0, colCount);
  return withColumnsInserted(kept, kept.length, colCount - kept.length);
}

/**
 * A column name made from what a header cell holds. A cell that is empty,
 * holds a formula, or repeats an earlier name gets the next free name.
 */
function columnNameFrom(input: string | undefined, taken: readonly string[]): string {
  const cleaned = (input ?? "").replaceAll(/[[\]]/g, "").trim().slice(0, LIMITS.nameLength);
  const usable =
    cleaned !== "" &&
    !isFormulaInput(input ?? "") &&
    !taken.some((name) => sameColumnName(name, cleaned));
  return usable ? cleaned : nextName("Column", taken);
}

/** For `.catch()`: turns a unique-name violation into a 409 and rethrows anything else. */
function rethrowDuplicate(kind: "page" | "table", name: string): (cause: unknown) => never {
  return (cause) => {
    if (isUniqueViolation(cause)) throw conflict(`A ${kind} named ${name} already exists`);
    throw cause;
  };
}
