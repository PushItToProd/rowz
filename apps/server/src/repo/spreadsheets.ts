import {
  addFormatRule,
  columnFormulasAfterEdit,
  columnFormulasAfterMove,
  columnFormulasAfterRename,
  defaultFunctions,
  refusedName,
  renamedNames,
  nameFormulasAfterEdit,
  nameFormulasAfterMove,
  nameFormulasAfterRename,
  nameFormulaAfterRename,
  type NameFormula,
  columnLabel,
  formatAddress,
  formatRulesAfterEdit,
  formulasAfterEdit,
  inputsAfterMove,
  inputsAfterRename,
  isFormulaInput,
  scriptNames,
  sameColumnName,
  viewsAfterEdit,
  viewsAfterMove,
  viewsAfterRename,
  viewSourceAfterRename,
  type ChartType,
  type ColumnDefinition,
  type ColumnFormula,
  type ColumnType,
  type Effect,
  type FormatRule,
  type Move,
  type Rename,
  type StoredInput,
  type StructuralEdit,
  type TableName,
} from "@spreadsheet-app/engine";
import {
  DEFAULT_TABLE_SIZE,
  FILE_FORMAT,
  FILE_LIMITS,
  LIMITS,
  MAX_FORMAT_RULES,
  keysAfter,
  TableLayout,
  type IdentityCellInput,
  type IdentityFormatRange,
  type IdentifiedStructuralEditBody,
  type CellInput,
  type JournalLimits,
  type RowRecord,
  type SpreadsheetFile,
  type StoredCell,
  toSpreadsheetFile,
} from "@spreadsheet-app/shared";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { and, asc, count, desc, eq, gte, gt, inArray, lt, notInArray, sql, sum } from "drizzle-orm";
import { noteChange, noteJournaled, requestContext } from "../changes";
import type { Database } from "../db/client";
import { Contents } from "./contents";
import {
  applyRecorded,
  ContentWriter,
  countRows,
  MAX_ANNOUNCED_CELLS,
  orderedRows,
  type Change,
  type ChangedContent,
  type JournalData,
  readInputs,
  touchSame,
  UndoRefusal,
  writesFormulas,
} from "./journal";
import {
  actionRuns,
  cells,
  deletedRows,
  journal,
  pages,
  spreadsheetMembers,
  versions,
  spreadsheets,
  tables,
  tableRows,
  users,
  views,
  workspaceMembers,
  workspaces,
  type Role,
  type ViewKind,
} from "../db/schema";
import {
  ApiFailure,
  columnDeleted,
  conflict,
  forbidden,
  isForeignKeyViolation,
  isUniqueViolation,
  notFound,
  ownerOnly,
  rowDeleted,
  staleFormula,
  unprocessable,
} from "../errors";

export type { Change, ChangedContent } from "./journal";

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

/**
 * A table without its rows, which are records of their own. Holding no row
 * count keeps one person's added row from making the table another person
 * recorded look changed.
 */
export interface TableRecord {
  id: string;
  pageId: string;
  name: string;
  position: number;
  /** The ids of the table's columns, in order. */
  colIds: string[];
  /** The named columns of a data table, one for each column. `null` for a plain table. */
  columns: ColumnDefinition[] | null;
  /** How cells are shown: rules applied in order, later ones over earlier ones. */
  formats: FormatRule[];
  /** The names a plain table holds. Always empty for a data table. */
  names: TableName[];
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
  /** How many changes have been made to what the spreadsheet holds. A change carries the revision it made. */
  revision: number;
  pages: PageRecord[];
  tables: TableRecord[];
  /** The rows of every table. Their order within a table is the order of their keys. */
  rows: RowRecord[];
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
  /** What the undo or redo wrote. `null` when it wrote nothing. */
  change: Change | null;
  undoable: boolean;
  redoable: boolean;
}

const pageColumns = { id: pages.id, name: pages.name, position: pages.position };
const tableColumns = {
  id: tables.id,
  pageId: tables.pageId,
  name: tables.name,
  position: tables.position,
  colIds: tables.colIds,
  columns: tables.columns,
  formats: tables.formats,
  names: tables.names,
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

const VIEW_LABELS: Record<ViewKind, string> = {
  chart: "Add chart",
  text: "Add text view",
  script: "Add script",
};

/** What a new script holds: an example of each kind of statement, as comments. */
const STARTER_SCRIPT = `// Each line names a formula. Formulas anywhere in the document can use the name.
// Total = SUM(Sales[Amount])
// WithTax(amount) = amount * 1.2
`;

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
 * that collide, a plain table with no rows, cells outside their table or
 * listed twice, and too many cells or rows in all.
 */
function checkFile(file: SpreadsheetFile): void {
  const invalid = (message: string): never => {
    throw unprocessable("invalid_file", message);
  };
  const page = repeated(file.pages.map(({ name }) => name));
  if (page !== undefined) invalid(`Two pages are named ${page}`);

  let total = 0;
  let totalRows = 0;
  for (const { name: pageName, blocks } of file.pages) {
    const fileTables = blocks.filter((block) => block.type === "table");
    const table = repeated(fileTables.map(({ name }) => name));
    if (table !== undefined) invalid(`Two tables on ${pageName} are named ${table}`);
    // A qualified name such as `Summary!Total` must mean one table or script.
    const holders = blocks.filter((block) => block.type === "table" || block.type === "script");
    const holder = repeated(holders.map(({ name }) => name));
    if (holder !== undefined) {
      invalid(`Two tables or scripts on ${pageName} are named ${holder}`);
    }
    for (const { name, rowCount, colCount, cells: fileCells, columns } of fileTables) {
      totalRows += rowCount;
      if (rowCount === 0 && !columns) invalid(`The table ${name} has no rows`);
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
  if (totalRows > LIMITS.spreadsheetRows) {
    invalid(`The file has more than ${String(LIMITS.spreadsheetRows)} rows`);
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
   * Runs `work` in a transaction that holds the spreadsheet's lock, so one
   * such transaction at a time reads and writes it. Write access is checked
   * again under the lock: a caller that waited for it may have lost access
   * meanwhile.
   */
  private async locked<T>(spreadsheetId: string, work: (tx: Database) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => {
      await lockSpreadsheet(tx, spreadsheetId);
      await this.within(tx).findSpreadsheet(spreadsheetId, "write");
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
  private async change<T>(
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

  /**
   * Reads a spreadsheet for the formula engine, which names cells by
   * position. Inside a change the read is as current as the lock makes it.
   */
  async read(spreadsheetId: string): Promise<Contents> {
    return new Contents(await this.getSnapshot(spreadsheetId));
  }

  /**
   * Refuses formula text that was written before the last change to what
   * references mean. `revision` is the one the writer's session had applied
   * when the text was begun. A missing or future revision is refused. Must
   * run inside `change`.
   */
  private async checkWrittenAt(
    tx: Database,
    spreadsheetId: string,
    revision: number | undefined,
  ): Promise<void> {
    if (revision === undefined) {
      throw unprocessable("revision_required", "A revision is required when writing a formula");
    }
    const [current] = await tx
      .select({ revision: spreadsheets.revision, rewriteRevision: spreadsheets.rewriteRevision })
      .from(spreadsheets)
      .where(eq(spreadsheets.id, spreadsheetId));
    if (!current) throw notFound("Spreadsheet");
    if (revision > current.revision || revision < current.rewriteRevision) throw staleFormula();
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
  private async changePage<T>(
    pageId: string,
    work: (page: Found<PageRecord>, tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<Outcome<T>> {
    const { spreadsheetId } = await this.findPage(pageId, "write");
    return this.change(spreadsheetId, async (tx, writer) =>
      work(await this.within(tx).findPage(pageId, "write"), tx, writer),
    );
  }

  /** Runs a change to a table, giving `work` the table as it is under the lock. */
  private async changeTable<T>(
    tableId: string,
    work: (table: Found<TableRecord>, tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<Outcome<T>> {
    const { spreadsheetId } = await this.findTable(tableId, "write");
    return this.change(spreadsheetId, async (tx, writer) =>
      work(await this.within(tx).findTable(tableId, "write"), tx, writer),
    );
  }

  /** Runs a change to a chart or text view, giving `work` the view as it is under the lock. */
  private async changeView<T>(
    viewId: string,
    work: (view: Found<ViewRecord>, tx: Database, writer: ContentWriter) => Promise<T>,
  ): Promise<Outcome<T>> {
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

  /**
   * Creates the pages of a file, and everything on them, in a spreadsheet
   * that has none. Rows and columns get new ids, as pages and tables do: a
   * file names them by position.
   */
  private async insertContents(
    tx: Database,
    spreadsheetId: string,
    file: SpreadsheetFile,
  ): Promise<void> {
    // A file kept as a version of a spreadsheet that had more rows than the limit is refused too.
    const fileTables = file.pages.flatMap((page) =>
      page.blocks.filter((block) => block.type === "table"),
    );
    if (fileTables.reduce((total, table) => total + table.rowCount, 0) > LIMITS.spreadsheetRows) {
      throw unprocessable(
        "too_many_rows",
        `A spreadsheet can have at most ${String(LIMITS.spreadsheetRows)} rows`,
      );
    }
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
        const colIds = Array.from({ length: block.colCount }, () => randomUUID());
        const [table] = await tx
          .insert(tables)
          .values({
            ...placed,
            colIds,
            columns,
            formats: block.formats ?? [],
            names: block.names ?? [],
          })
          .returning({ id: tables.id });
        if (!table) throw new Error("Insert returned no table");
        const rows = keysAfter(null, block.rowCount).map((orderKey) => ({
          id: randomUUID(),
          tableId: table.id,
          orderKey,
        }));
        for (let from = 0; from < rows.length; from += INSERT_BATCH) {
          await tx.insert(tableRows).values(rows.slice(from, from + INSERT_BATCH));
        }
        const layout = new TableLayout(rows, colIds);
        const filled = block.cells.flatMap((cell) => {
          const identity = layout.identity(cell);
          // A formula column computes its cells, so none are stored for it.
          const kept = cell.input !== "" && columns?.[cell.col]?.type !== "formula";
          return kept && identity
            ? [{ tableId: table.id, ...identity, input: cell.input, updatedBy: this.userId }]
            : [];
        });
        for (let from = 0; from < filled.length; from += INSERT_BATCH) {
          await tx.insert(cells).values(filled.slice(from, from + INSERT_BATCH));
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
   * kept as a version first, so restoring can itself be undone. Everything is
   * replaced, with new ids, so sessions read the spreadsheet again.
   */
  async restoreVersion(spreadsheetId: string, versionId: string): Promise<Change> {
    await this.findSpreadsheet(spreadsheetId, "write");
    const { change } = await this.change(spreadsheetId, async (tx, writer) => {
      const version = await this.findVersion(tx, spreadsheetId, versionId);
      await this.keepVersion(tx, spreadsheetId, "Before restoring an earlier version");
      await tx.delete(journal).where(eq(journal.spreadsheetId, spreadsheetId));
      // Pages take their tables, rows, cells, and views with them.
      await tx.delete(pages).where(eq(pages.spreadsheetId, spreadsheetId));
      await tx
        .update(spreadsheets)
        .set({ name: version.name })
        .where(eq(spreadsheets.id, spreadsheetId));
      await this.insertContents(tx, spreadsheetId, version);
      writer.markRewrites();
      writer.markUndescribed();
    });
    return change;
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
    const { snapshot, data } = await this.within(db).read(spreadsheetId);
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
    await db.insert(versions).values({ spreadsheetId, createdBy: this.userId, reason, data: file });

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
   * Marks the spreadsheet as changed now, and returns the revision the change
   * made. `rewrites` says the change altered what references mean. When no
   * version was kept lately, one is kept of the spreadsheet as the change
   * leaves it.
   */
  private async touch(db: Database, spreadsheetId: string, rewrites = false): Promise<number> {
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
    if (!touched) throw notFound("Spreadsheet");
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
  async revisionOf(spreadsheetId: string): Promise<number> {
    await this.findSpreadsheet(spreadsheetId, "read");
    const [counted] = await this.db
      .select({ revision: spreadsheets.revision })
      .from(spreadsheets)
      .where(eq(spreadsheets.id, spreadsheetId));
    return counted?.revision ?? 0;
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
  ): Promise<Created<{ page: PageRecord; table: TableRecord }>> {
    await this.findSpreadsheet(spreadsheetId, "write");
    const { result, change } = await this.change(spreadsheetId, async (tx, writer) => {
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
    return { ...result, change };
  }

  /** Renames a page and the formulas that name it. */
  async renamePage(pageId: string, name: string): Promise<Change> {
    const { change } = await this.changePage(pageId, async (page, tx, writer) => {
      writer.setLabel(`Rename page ${page.name}`);
      await this.rewriteFormulas(tx, writer, page.spreadsheetId, { kind: "page", pageId, name });
      await writer.updatePage(pageId, { name }).catch(rethrowDuplicate("page", name));
    });
    return change;
  }

  /**
   * Puts the blocks of a page in the order given. The
   * list must name every one of them once, so that a stale client cannot
   * leave two blocks in one place.
   */
  async reorderPage(pageId: string, blocks: readonly string[]): Promise<Change> {
    const { change } = await this.changePage(pageId, async (page, tx, writer) => {
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
  async reorderPages(spreadsheetId: string, order: readonly string[]): Promise<Change> {
    await this.findSpreadsheet(spreadsheetId, "write");
    const { change } = await this.change(spreadsheetId, async (tx, writer) => {
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
    return change;
  }

  /** The names of a page's tables and scripts, which formulas use to qualify a name such as `Summary!Total`. */
  private async holderNames(tx: Database, pageId: string): Promise<string[]> {
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
  private async checkHolderName(
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
  async moveTable(tableId: string, pageId: string): Promise<Change> {
    const { change } = await this.changeTable(tableId, async (table, tx, writer) => {
      const page = await this.destination(tx, table, pageId);
      const position = await this.within(tx).nextPosition(pageId);
      writer.setLabel(`Move table ${table.name}`);
      await this.rewriteForMove(tx, writer, table.spreadsheetId, {
        kind: "table",
        tableId,
        pageId,
      });
      await this.checkHolderName(tx, pageId, table.name, { kind: "table", id: tableId });
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
  async moveView(viewId: string, pageId: string): Promise<Change> {
    const { change } = await this.changeView(viewId, async (view, tx, writer) => {
      await this.destination(tx, view, pageId);
      if (view.kind === "script") {
        await this.checkHolderName(tx, pageId, view.name, { kind: "script", id: viewId });
      }
      const position = await this.within(tx).nextPosition(pageId);
      writer.setLabel(`Move ${view.kind} ${view.name}`);
      await this.rewriteForMove(tx, writer, view.spreadsheetId, {
        kind: "view",
        viewId,
        pageId,
      });
      await writer.updateView(viewId, { pageId, position });
    });
    return change;
  }

  private async insertTable(
    tx: Database,
    pageId: string,
    name: string | undefined,
    writer: ContentWriter,
  ): Promise<TableRecord> {
    if (name !== undefined) await this.checkHolderName(tx, pageId, name, { kind: "table" });
    const values = {
      pageId,
      name: name ?? nextName("Table", await this.holderNames(tx, pageId)),
      position: await this.within(tx).nextPosition(pageId),
    };
    return writer
      .insertTable(values, DEFAULT_TABLE_SIZE)
      .catch(rethrowDuplicate("table", values.name));
  }

  async deletePage(pageId: string): Promise<Change> {
    const { change } = await this.changePage(pageId, async (page, tx, writer) => {
      writer.setLabel(`Delete page ${page.name}`);
      const remaining = await tx.$count(pages, eq(pages.spreadsheetId, page.spreadsheetId));
      if (remaining <= 1) throw conflict("A spreadsheet needs at least one page");
      await this.keepVersion(tx, page.spreadsheetId, `Before deleting the page ${page.name}`);
      await writer.deletePage(pageId);
    });
    return change;
  }

  /** Creates an empty table. Without a name the table gets the next free `Table N`. */
  async createTable(pageId: string, name?: string): Promise<Created<{ table: TableRecord }>> {
    const { result, change } = await this.changePage(pageId, async (_page, tx, writer) => {
      writer.setLabel("Add table");
      return this.insertTable(tx, pageId, name, writer);
    });
    return { table: result, change };
  }

  /**
   * Renames or resizes a table. Renaming rewrites the formulas that name the
   * table. A size is counted from the start of the table: rows and columns
   * are added at its end, and making it smaller deletes the ones past the new
   * size as any others are deleted, so formulas, views, and formats follow.
   */
  async updateTable(
    tableId: string,
    changes: {
      name?: string | undefined;
      rowCount?: number | undefined;
      colCount?: number | undefined;
    },
  ): Promise<Change> {
    const { change } = await this.changeTable(tableId, async (table, tx, writer) => {
      const { spreadsheetId } = table;
      writer.setLabel(
        changes.name !== undefined ? `Rename table ${table.name}` : `Resize table ${table.name}`,
      );
      const rows = await orderedRows(tx, tableId);
      const sizes = [
        { axis: "row", from: rows.length, to: changes.rowCount ?? rows.length },
        { axis: "col", from: table.colIds.length, to: changes.colCount ?? table.colIds.length },
      ] as const;
      const [height, width] = sizes;
      if (height.to === 0 && !table.columns) {
        throw unprocessable("last_one", "A table needs at least one row");
      }
      if (sizes.some(({ from, to }) => to < from)) {
        await this.keepVersion(tx, spreadsheetId, `Before making ${table.name} smaller`);
      }
      for (const { axis, from, to } of sizes) {
        if (to >= from) continue;
        const edit = { tableId, axis, kind: "delete", index: to, count: from - to } as const;
        await this.applyEdit(tx, writer, spreadsheetId, edit);
      }
      if (changes.name !== undefined) {
        await this.checkHolderName(tx, table.pageId, changes.name, { kind: "table", id: tableId });
        const rename = { kind: "table", tableId, name: changes.name } as const;
        await this.rewriteFormulas(tx, writer, spreadsheetId, rename);
      }
      if (height.to > height.from) {
        await writer.insertRows(tableId, height.from, height.to - height.from);
      }
      // The steps above may have rewritten this table's own formula columns.
      const current = await this.within(tx).findTable(tableId, "write");
      const added = Array.from({ length: Math.max(0, width.to - width.from) }, () => randomUUID());
      await writer
        .updateTable(tableId, {
          ...(changes.name === undefined ? {} : { name: changes.name }),
          colIds: [...current.colIds, ...added],
          columns:
            current.columns && resized(current.columns, current.colIds.length + added.length),
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
  async nameColumns(tableId: string, headerRow: boolean): Promise<Change> {
    const { change } = await this.changeTable(tableId, async (table, tx, writer) => {
      if (table.columns) throw conflict(`${table.name} already has named columns`);
      if (table.names.length > 0) {
        throw conflict(`${table.name} holds names, and a table with named columns holds none`);
      }
      const { spreadsheetId } = table;
      writer.setLabel(`Name the columns of ${table.name}`);
      if (headerRow) {
        await this.keepVersion(tx, spreadsheetId, `Before naming the columns of ${table.name}`);
      }
      const { data } = await this.within(tx).read(spreadsheetId);
      const filled = data.cells.filter((cell) => cell.tableId === tableId);
      const taken = headerRow ? 1 : 0;
      const header = filled.filter((cell) => cell.row < taken);
      let height = data.tables.find((candidate) => candidate.id === tableId)?.rowCount ?? 0;
      const remove = async (index: number, count: number): Promise<void> => {
        if (count <= 0) return;
        const edit = { tableId, axis: "row", kind: "delete", index, count } as const;
        await this.applyEdit(tx, writer, spreadsheetId, edit);
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
  async setTableNames(tableId: string, names: TableName[]): Promise<Change> {
    const { change } = await this.changeTable(tableId, async (table, tx, writer) => {
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
        const contents = await this.rewriteFormulas(tx, writer, table.spreadsheetId, {
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
    const { change } = await this.changeTable(tableId, async (table, tx, writer) => {
      const layout = new TableLayout(await orderedRows(tx, tableId), table.colIds);
      const row = (id: string): number => layout.rowIndex(id) ?? fail(rowDeleted());
      const col = (id: string): number => layout.colIndex(id) ?? fail(columnDeleted());
      const rule: FormatRule = {
        startRow: row(range.startRowId),
        endRow: range.endRowId === null ? null : row(range.endRowId),
        startCol: col(range.startColId),
        endCol: range.endColId === null ? null : col(range.endColId),
        format,
        ...(reset ? { reset } : {}),
      };
      if (
        (rule.endRow !== null && rule.endRow < rule.startRow) ||
        (rule.endCol !== null && rule.endCol < rule.startCol)
      ) {
        throw new ApiFailure(400, "invalid_request", "A range ends at or after where it starts");
      }
      writer.setLabel(`Format cells in ${table.name}`);
      const formats = addFormatRule(table.formats, rule);
      if (formats.length > MAX_FORMAT_RULES) {
        throw unprocessable(
          "too_many_formats",
          `${table.name} has too many separate formats. Clear the formatting of some cells first`,
        );
      }
      await writer.updateTable(tableId, { formats });
    });
    return change;
  }

  /**
   * Makes a data table a plain table again. Its formula columns stop
   * computing. A plain table has at least one row, so a table with none
   * gets one.
   */
  async dropColumns(tableId: string): Promise<Change> {
    const { change } = await this.changeTable(tableId, async (table, tx, writer) => {
      writer.setLabel(`Remove the column names of ${table.name}`);
      await this.keepVersion(
        tx,
        table.spreadsheetId,
        `Before removing the column names of ${table.name}`,
      );
      await writer.updateTable(tableId, { columns: null });
      if ((await orderedRows(tx, tableId)).length === 0) await writer.insertRows(tableId, 0, 1);
    });
    return change;
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
      revision?: number | undefined;
    },
  ): Promise<Change> {
    const { change } = await this.changeTable(tableId, async (found, tx, writer) => {
      const col = found.colIds.indexOf(colId);
      if (col < 0) throw columnDeleted();
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
      if (changes.formula !== undefined) {
        await this.checkWrittenAt(tx, found.spreadsheetId, changes.revision);
      }

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
      if (renamed) {
        await this.rewriteFormulas(tx, writer, found.spreadsheetId, {
          kind: "column",
          tableId,
          from: before.name,
          name,
        });
      }
      // The rename may have rewritten the other formula columns of this table.
      const current = (await this.within(tx).findTable(tableId, "write")).columns ?? found.columns;
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

  /** Adds a chart, a text view, or a script to the end of a page. */
  async createView(pageId: string, kind: ViewKind): Promise<Created<{ view: ViewRecord }>> {
    const { result, change } = await this.changePage(pageId, async (_page, tx, writer) => {
      writer.setLabel(VIEW_LABELS[kind]);
      const position = await this.within(tx).nextPosition(pageId);
      if (kind === "script") {
        const name = nextName("Script", await this.holderNames(tx, pageId));
        return writer.insertView({ pageId, kind, position, name, source: STARTER_SCRIPT });
      }
      const siblings = await tx
        .select({ name: views.name })
        .from(views)
        .where(and(eq(views.pageId, pageId), eq(views.kind, kind)));
      const names = siblings.map((view) => view.name);
      return writer.insertView({
        pageId,
        kind,
        position,
        ...(kind === "chart"
          ? { name: nextName("Chart", names), source: "", chartType: "bar" as const }
          : { name: nextName("Text", names), source: STARTER_TEMPLATE }),
      });
    });
    return { view: result, change };
  }

  async updateView(
    viewId: string,
    {
      revision,
      ...changes
    }: {
      name?: string | undefined;
      source?: string | undefined;
      chartType?: ChartType | undefined;
      revision?: number | undefined;
    },
  ): Promise<Change> {
    const { change } = await this.changeView(viewId, async (view, tx, writer) => {
      writer.setLabel(`Update ${view.kind} ${view.name}`);
      if (changes.chartType !== undefined && view.kind !== "chart") {
        throw unprocessable("not_a_chart", `${view.name} is not a chart`);
      }
      if (changes.source !== undefined && changes.source !== view.source) {
        await this.checkWrittenAt(tx, view.spreadsheetId, revision);
      }
      let source = changes.source;
      if (view.kind === "script" && source !== undefined && source !== view.source) {
        const renames = renamedNames(scriptNames(viewId, view.source), scriptNames(viewId, source));
        for (const rename of renames) {
          const change = {
            kind: "name" as const,
            holderId: viewId,
            ...rename,
          };
          const contents = await this.rewriteFormulas(tx, writer, view.spreadsheetId, change);
          source = viewSourceAfterRename(contents.data, { ...view, source }, change);
        }
      }
      if (view.kind === "script" && changes.name !== undefined && changes.name !== view.name) {
        await this.checkHolderName(tx, view.pageId, changes.name, { kind: "script", id: viewId });
        await this.rewriteFormulas(tx, writer, view.spreadsheetId, {
          kind: "script",
          scriptId: viewId,
          name: changes.name,
        });
      }
      await writer.updateView(viewId, {
        ...changes,
        ...(source === undefined ? {} : { source }),
      });
    });
    return change;
  }

  async deleteView(viewId: string): Promise<Change> {
    const { change } = await this.changeView(viewId, async (view, tx, writer) => {
      writer.setLabel(`Delete ${view.kind} ${view.name}`);
      await this.keepVersion(tx, view.spreadsheetId, `Before deleting ${view.name}`);
      await writer.deleteView(viewId);
    });
    return change;
  }

  async deleteTable(tableId: string): Promise<Change> {
    const { change } = await this.changeTable(tableId, async (table, tx, writer) => {
      writer.setLabel(`Delete table ${table.name}`);
      await this.keepVersion(tx, table.spreadsheetId, `Before deleting the table ${table.name}`);
      await writer.deleteTable(tableId);
    });
    return change;
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
      revision,
    }: {
      cells: readonly IdentityCellInput[];
      appendRows?: readonly string[] | undefined;
      revision?: number | undefined;
    },
  ): Promise<Change> {
    const { change } = await this.changeTable(tableId, async (table, tx, writer) => {
      writer.setLabel(`Change cells in ${table.name}`);
      if (written.some((cell) => isFormulaInput(cell.input))) {
        await this.checkWrittenAt(tx, table.spreadsheetId, revision);
      }
      // One statement cannot update the same cell twice, so keep the last entry per cell.
      const latest = [
        ...new Map(written.map((cell) => [`${cell.rowId}:${cell.colId}`, cell])).values(),
      ];
      if (latest.length >= BULK_WRITE_CELLS) {
        await this.keepVersion(
          tx,
          table.spreadsheetId,
          `Before changing ${String(latest.length)} cells of ${table.name}`,
        );
      }

      let rows = await orderedRows(tx, tableId);
      const present = new Set(rows.map((row) => row.id));
      const added = appendRows.filter((id) => !present.has(id));
      if (added.length > 0) {
        await this.checkNewRows(tx, added);
        rows = [...rows, ...(await writer.insertRows(tableId, rows.length, added.length, added))];
      }

      const layout = new TableLayout(rows, table.colIds);
      for (const cell of latest) {
        if (layout.rowIndex(cell.rowId) === undefined) throw rowDeleted();
        const col = layout.colIndex(cell.colId);
        if (col === undefined) throw columnDeleted();
        const column = table.columns?.[col];
        if (column?.type === "formula") {
          throw unprocessable(
            "formula_column",
            `${column.name} is a formula column. Change the column's formula instead`,
          );
        }
      }
      await writer.setCells(latest.map((cell) => ({ tableId, ...cell })));
      if (latest.some((cell) => cell.input !== "")) {
        await this.checkCellCount(tx, table.spreadsheetId);
      }
    });
    return change;
  }

  /**
   * Refuses ids a client made for new rows when a row has one of them, in
   * any table of any spreadsheet, or had one and was deleted. The answer does
   * not say where an id exists.
   */
  private async checkNewRows(tx: Database, ids: readonly string[]): Promise<void> {
    const [existing] = await tx
      .select({ id: tableRows.id })
      .from(tableRows)
      .where(inArray(tableRows.id, [...ids]))
      .limit(1);
    if (existing) throw conflict("A new row has an id that is already in use");
    const [deleted] = await tx
      .select({ rowId: deletedRows.rowId })
      .from(deletedRows)
      .where(inArray(deletedRows.rowId, [...ids]))
      .limit(1);
    if (deleted) throw rowDeleted();
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
    const grown = effects.filter((effect) => effect.type === "ensureRows");
    const written = effects.filter((effect) => effect.type === "setCell");
    const removed = effects.filter((effect) => effect.type === "deleteRows");
    if (grown.length + written.length + removed.length === 0) return undefined;

    const { change } = await this.change(spreadsheetId, async (tx, writer) => {
      // Tables grow first, so the cells written into new rows are inside the table.
      for (const [tableId, growths] of Map.groupBy(grown, (effect) => effect.tableId)) {
        const height = (await orderedRows(tx, tableId)).length;
        const wanted = Math.max(...growths.map((effect) => effect.rowCount));
        if (wanted > height) await writer.insertRows(tableId, height, wanted - height);
      }
      const contents = await this.within(tx).read(spreadsheetId);
      const tableOf = (tableId: string): TableRecord =>
        contents.snapshot.tables.find((table) => table.id === tableId) ?? fail(notFound("Table"));
      const tableIds = new Set([...grown, ...written, ...removed].map((effect) => effect.tableId));
      const [only] = tableIds.size === 1 ? [...tableIds] : [];
      writer.setLabel(only === undefined ? "Run action" : `Change cells in ${tableOf(only).name}`);

      const inputs = written.map(({ tableId, row, col, input }): StoredCell => {
        const table = tableOf(tableId);
        const identity = contents.layout(tableId).identity({ row, col });
        if (!identity) {
          throw unprocessable(
            "cell_out_of_bounds",
            `${formatAddress({ row, col })} is outside the table ${table.name}`,
          );
        }
        const column = table.columns?.[col];
        if (column?.type === "formula") {
          throw unprocessable(
            "formula_column",
            `${column.name} is a formula column. Change the column's formula instead`,
          );
        }
        return { tableId, ...identity, input };
      });
      // Resolve all ranges against the same starting layout and delete each
      // row id once. DO plans every action against that layout, so OVERWRITE
      // ranges can overlap.
      const doomed = new Map<string, Set<string>>();
      for (const { tableId, startRow, count } of removed) {
        const ids = contents.layout(tableId).rowIds.slice(startRow, startRow + count);
        const held = doomed.get(tableId) ?? new Set<string>();
        for (const id of ids) held.add(id);
        doomed.set(tableId, held);
      }
      if (inputs.length >= BULK_WRITE_CELLS || [...doomed.values()].some((ids) => ids.size > 0)) {
        await this.keepVersion(tx, spreadsheetId, "Before running an action");
      }
      await writer.setCells(inputs);
      if (inputs.some((cell) => cell.input !== "")) await this.checkCellCount(tx, spreadsheetId);
      for (const [tableId, ids] of doomed) {
        await this.deleteLines(tx, writer, spreadsheetId, tableId, "row", [...ids]);
      }
    });
    return change;
  }

  /**
   * Inserts or deletes rows or columns. No cell moves: a cell belongs to its
   * row and column, whose ids do not change. Formulas anywhere in the
   * spreadsheet that read the table are rewritten to keep reading the same
   * cells, as are charts, text views, and formats.
   */
  async editStructure(tableId: string, body: IdentifiedStructuralEditBody): Promise<Change> {
    const { change } = await this.changeTable(tableId, async (table, tx, writer) => {
      const { spreadsheetId } = table;
      const rows = body.axis === "row";
      const noun = rows ? "row" : "column";
      const several = body.ids.length === 1 ? "" : "s";
      writer.setLabel(
        `${body.kind === "insert" ? "Insert" : "Delete"} ${noun}${several} in ${table.name}`,
      );
      if (body.kind === "delete") {
        await this.deleteLines(tx, writer, spreadsheetId, tableId, body.axis, body.ids);
        return;
      }

      const ordered = rows ? (await orderedRows(tx, tableId)).map((row) => row.id) : table.colIds;
      const index = body.beforeId === null ? ordered.length : ordered.indexOf(body.beforeId);
      if (index < 0) throw rows ? rowDeleted() : columnDeleted();
      if (rows) await this.checkNewRows(tx, body.ids);
      else {
        const [existing] = await tx
          .select({ id: tables.id })
          .from(tables)
          .where(
            sql`${tables.colIds} ?| ARRAY[${sql.join(
              body.ids.map((id) => sql`${id}`),
              sql`, `,
            )}]::text[]`,
          )
          .limit(1);
        if (existing) throw conflict("A new column has an id that is already in use");
        if (ordered.length + body.ids.length > LIMITS.tableCols) {
          throw unprocessable(
            "table_full",
            `A table can have at most ${String(LIMITS.tableCols)} columns`,
          );
        }
      }
      await this.applyEdit(tx, writer, spreadsheetId, {
        tableId,
        axis: body.axis,
        kind: "insert",
        index,
        count: body.ids.length,
        ids: body.ids,
      });
    });
    return change;
  }

  /**
   * Deletes rows or columns of a table by id. The ids need not be next to
   * each other: someone may have inserted a row between two of them since
   * they were chosen. Each run of neighbors is one edit, last run first, so
   * that an earlier run's positions are not moved by a later one. Rows and
   * columns that were not named are kept. Must run inside `change`.
   */
  private async deleteLines(
    tx: Database,
    writer: ContentWriter,
    spreadsheetId: string,
    tableId: string,
    axis: "row" | "col",
    ids: readonly string[],
  ): Promise<void> {
    if (ids.length === 0) return;
    const table = await this.within(tx).findTable(tableId, "write");
    const rows = axis === "row";
    const noun = rows ? "row" : "column";
    const ordered = rows ? (await orderedRows(tx, tableId)).map((row) => row.id) : table.colIds;
    const indexes = ids
      .map((id) => {
        const index = ordered.indexOf(id);
        if (index < 0) throw rows ? rowDeleted() : columnDeleted();
        return index;
      })
      .sort((a, b) => a - b);
    // A data table can lose every row. A plain table keeps one, and any table keeps a column.
    const keepsOne = !rows || !table.columns;
    if (keepsOne && indexes.length >= ordered.length) {
      throw unprocessable("last_one", `A table needs at least one ${noun}`);
    }
    const runs: { index: number; count: number }[] = [];
    for (const index of indexes) {
      const last = runs.at(-1);
      if (last && last.index + last.count === index) last.count += 1;
      else runs.push({ index, count: 1 });
    }
    const label = (index: number): string => (rows ? String(index + 1) : columnLabel(index));
    const deleted = runs
      .map(({ index, count }) =>
        count === 1 ? label(index) : `${label(index)} to ${label(index + count - 1)}`,
      )
      .join(", ");
    await this.keepVersion(
      tx,
      spreadsheetId,
      `Before deleting ${noun}${indexes.length === 1 ? "" : "s"} ${deleted} of ${table.name}`,
    );
    for (const run of runs.reverse()) {
      await this.applyEdit(tx, writer, spreadsheetId, { tableId, axis, kind: "delete", ...run });
    }
  }

  /**
   * Carries out an edit that is known to fit its table: adds or removes the
   * rows or the column ids, and rewrites the formula text that reads them, in
   * cells, in views, in formula columns, and in formats. Must run inside
   * `change`.
   */
  private async applyEdit(
    tx: Database,
    writer: ContentWriter,
    spreadsheetId: string,
    edit: StructuralEdit & { count: number; ids?: readonly string[] },
  ): Promise<void> {
    writer.markRewrites();
    const contents = await this.within(tx).read(spreadsheetId);
    const { data } = contents;
    const table = data.tables.find((candidate) => candidate.id === edit.tableId);
    if (!table) throw notFound("Table");
    const layout = contents.layout(table.id);
    const rows = edit.axis === "row";

    // Each rewritten formula is named by the position its cell had before the
    // edit. The cell keeps its ids through the edit, so that is where it is stored.
    const formulas = formulasAfterEdit(data, edit).map((cell) => contents.identify(cell));
    const sources = viewsAfterEdit(data, data.views, edit);
    const columnFormulas = columnFormulasAfterEdit(data, edit);
    const nameFormulas = nameFormulasAfterEdit(data, edit);

    if (rows && edit.kind === "insert") {
      await writer.insertRows(table.id, edit.index, edit.count, edit.ids);
    } else if (rows) {
      await writer.deleteRows(table.id, layout.rowIds.slice(edit.index, edit.index + edit.count));
    }
    await writer.setCells(formulas);
    await this.storeViewSources(writer, sources);
    const changed = await this.storeColumnFormulas(writer, data.tables, columnFormulas);
    await this.storeNameFormulas(writer, data.tables, nameFormulas);
    // The formulas were rewritten at the positions the columns had before the edit.
    const current =
      changed.find((candidate) => candidate.id === table.id)?.columns ?? table.columns;
    // Formats follow the cells they were given to.
    const formats = formatRulesAfterEdit(table.formats, edit);
    if (rows) {
      await writer.updateTable(table.id, { formats });
    } else if (edit.kind === "insert") {
      const added = edit.ids ?? Array.from({ length: edit.count }, () => randomUUID());
      await writer.updateTable(table.id, {
        colIds: table.colIds.toSpliced(edit.index, 0, ...added),
        columns: current && withColumnsInserted(current, edit.index, edit.count),
        formats,
      });
    } else {
      const removed = table.colIds.slice(edit.index, edit.index + edit.count);
      await writer.clearCells(table.id, inArray(cells.colId, removed));
      await writer.updateTable(table.id, {
        colIds: table.colIds.toSpliced(edit.index, edit.count),
        columns: current?.toSpliced(edit.index, edit.count) ?? null,
        formats,
      });
    }
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
    // Pruning otherwise runs when a change is recorded, so the entries of a
    // spreadsheet nobody has changed since would stay past the age limit.
    await this.pruneJournal(tx, spreadsheetId);
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
    const own = entries.map((entry) => entry.seq);

    try {
      // Changes in effect that came after any part of the step. The requests
      // of one step are separate changes, so another tab's can fall between them.
      const others = await tx
        .select({ seq: journal.seq, rewrites: journal.rewrites, formulas: journal.formulas })
        .from(journal)
        .where(
          and(
            eq(journal.spreadsheetId, spreadsheetId),
            gt(journal.seq, Math.min(...own)),
            notInArray(journal.seq, own),
            eq(journal.undone, false),
          ),
        );
      for (const entry of entries) {
        const later = others.filter((other) => other.seq > entry.seq);
        const { data } = entry;
        const createsOrDeletes =
          data !== null &&
          [...data.pages, ...data.tables, ...data.views].some(
            ({ before, after }) => before === null || after === null,
          );
        if (createsOrDeletes && later.length > 0) {
          throw new UndoRefusal(
            `A later change prevents ${direction}ing the adding or deleting of a page, table, or view`,
          );
        }
        // Ids fix which cell an entry means, and not what a formula's text
        // means. One of two changes altering what references mean conflicts
        // with the other writing formula text: the text was written for the
        // rows, columns, and names of its own moment.
        if (entry.rewrites && later.some((other) => other.formulas)) {
          throw new UndoRefusal(
            `A formula written since prevents ${direction}ing this change to rows, columns, or names`,
          );
        }
        // An entry too large to record is refused below, whatever it would write.
        const restoresFormulas =
          data !== null && writesFormulas(data, direction === "undo" ? "before" : "after");
        if (restoresFormulas && later.some((other) => other.rewrites)) {
          throw new UndoRefusal(
            `A later change to rows, columns, or names prevents ${direction}ing this change to a formula`,
          );
        }
      }

      // Comparing what the spreadsheet holds with what the step left does not
      // show a later change that put the same value back: a cell typed over
      // and then typed again as it was. Reversing the step would erase that
      // change, so what later changes wrote is compared too. A later change
      // too large to record has no state to compare, and only the comparison
      // of values in `assertRecordedMatches` stands against it.
      const laterStates =
        others.length === 0
          ? []
          : await tx
              .select({ seq: journal.seq, data: journal.data })
              .from(journal)
              .where(
                inArray(
                  journal.seq,
                  others.map((other) => other.seq),
                ),
              );
      for (const entry of entries) {
        const { data } = entry;
        if (data === null) continue;
        const overwritten = laterStates.some(
          (other) => other.seq > entry.seq && other.data !== null && touchSame(data, other.data),
        );
        if (overwritten) {
          throw new UndoRefusal(
            `A later change to the same content prevents ${direction}ing this change`,
          );
        }
      }

      const rowsBefore = await countRows(tx, spreadsheetId);
      const changed = await tx.transaction(async (writes) => {
        let accumulated: ChangedContent | null = emptyChanged();
        for (const entry of entries) {
          if (!entry.data) {
            throw new UndoRefusal(
              "This change is too large to undo. Use History to restore a version",
            );
          }
          await this.assertRecordedMatches(writes, entry.data, direction);
          accumulated = mergeChanged(
            accumulated,
            await applyRecorded(writes, spreadsheetId, this.userId, entry.data, direction),
          );
        }
        await this.checkRestoredState(writes, spreadsheetId, rowsBefore);
        return accumulated;
      });
      await tx.update(journal).set({ undone: !undone }).where(group);
      const revision = await this.touch(
        tx,
        spreadsheetId,
        entries.some((entry) => entry.rewrites),
      );
      const change = { revision, changed };
      noteChange(spreadsheetId, change);
      return {
        outcome: "done",
        label: latest.label,
        error: null,
        change,
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
        change: null,
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
      change: null,
      ...(await this.stackState(db, spreadsheetId, clientId)),
    };
  }

  /**
   * Refuses an undo or redo of a recorded change when something it wrote is
   * no longer as the change left it, so that it would write over what someone
   * did since.
   */
  private async assertRecordedMatches(
    db: Database,
    data: JournalData,
    direction: "undo" | "redo",
  ): Promise<void> {
    const expected = <T>(before: T, after: T): T => (direction === "undo" ? after : before);
    const target = <T>(before: T, after: T): T => (direction === "undo" ? before : after);
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

    const recordedCells = new Set(
      data.cells.flatMap(({ changes }) => changes.map(([rowId, colId]) => `${rowId}:${colId}`)),
    );
    for (const { changes } of data.rows) {
      const ids = changes.map(([id]) => id);
      // A row is compared by whether it exists. Its key may have changed: a
      // row put back where another has taken its key gets a key next to it.
      const present = new Set<string>();
      for (let start = 0; start < ids.length; start += INSERT_BATCH) {
        const found = await db
          .select({ id: tableRows.id })
          .from(tableRows)
          .where(inArray(tableRows.id, ids.slice(start, start + INSERT_BATCH)));
        for (const row of found) present.add(row.id);
      }
      for (const [id, before, after] of changes) {
        if (present.has(id) !== (expected(before, after) !== null)) {
          throw new UndoRefusal("A row has changed since this step");
        }
      }
      // A row this is about to delete takes its cells with it. It may hold
      // only what the step itself wrote, or the delete would take what someone
      // typed into it since.
      const doomed = changes
        .filter(([, before, after]) => target(before, after) === null)
        .map(([id]) => id);
      for (let start = 0; start < doomed.length; start += INSERT_BATCH) {
        const held = await db
          .select({ rowId: cells.rowId, colId: cells.colId })
          .from(cells)
          .where(inArray(cells.rowId, doomed.slice(start, start + INSERT_BATCH)));
        if (held.some(({ rowId, colId }) => !recordedCells.has(`${rowId}:${colId}`))) {
          throw new UndoRefusal("A row this step added now holds something typed since");
        }
      }
    }
    for (const { tableId, changes } of data.cells) {
      const inputs = await readInputs(
        db,
        tableId,
        changes.map(([rowId, colId]) => ({ rowId, colId })),
      );
      for (const [rowId, colId, before, after] of changes) {
        if (inputs.get({ rowId, colId }) !== expected(before, after)) {
          throw new UndoRefusal("A cell has changed since this step");
        }
      }
    }
  }

  /**
   * Refuses an undo or redo that leaves the spreadsheet in a state no other
   * change could: over a limit, a table too small, or a cell where none can
   * be. `rowsBefore` is how many rows the spreadsheet had, which a
   * spreadsheet already over the row limit may come down from.
   */
  private async checkRestoredState(
    db: Database,
    spreadsheetId: string,
    rowsBefore: number,
  ): Promise<void> {
    const pageRows = await db
      .select({ id: pages.id })
      .from(pages)
      .where(eq(pages.spreadsheetId, spreadsheetId));
    if (pageRows.length === 0) throw new UndoRefusal("A spreadsheet needs at least one page");
    if (pageRows.length > FILE_LIMITS.pages) {
      throw new UndoRefusal("This change would exceed the page limit");
    }
    const inSpreadsheet = eq(pages.spreadsheetId, spreadsheetId);
    const tableRecords = await db
      .select({
        id: tables.id,
        pageId: tables.pageId,
        colIds: tables.colIds,
        columns: tables.columns,
        rowCount:
          sql<number>`(select count(*) from ${tableRows} where ${tableRows.tableId} = ${tables.id})`.mapWith(
            Number,
          ),
      })
      .from(tables)
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(inSpreadsheet);
    const totalRows = tableRecords.reduce((total, table) => total + table.rowCount, 0);
    if (totalRows > LIMITS.spreadsheetRows && totalRows >= rowsBefore) {
      throw new UndoRefusal("This change would exceed the spreadsheet row limit");
    }
    const outOfBounds = tableRecords.some(
      (table) =>
        table.rowCount > LIMITS.tableRows ||
        table.colIds.length > LIMITS.tableCols ||
        table.colIds.length < 1 ||
        // A data table holds the rows added to it, which can be none.
        (table.rowCount < 1 && !table.columns),
    );
    if (outOfBounds) throw new UndoRefusal("This change would exceed a table limit");
    const [cellCount] = await db
      .select({ filled: count() })
      .from(cells)
      .innerJoin(tables, eq(tables.id, cells.tableId))
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(inSpreadsheet);
    if ((cellCount?.filled ?? 0) > FILE_LIMITS.cells) {
      throw new UndoRefusal("This change would exceed the spreadsheet cell limit");
    }
    // The database keeps a cell's row in its table. Nothing but this keeps its column there.
    const outside = await db
      .select({ tableId: cells.tableId })
      .from(cells)
      .innerJoin(tables, eq(tables.id, cells.tableId))
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(and(inSpreadsheet, sql`NOT (${tables.colIds} ? ${cells.colId}::text)`))
      .limit(1);
    if (outside.length > 0) {
      throw new UndoRefusal("This change would leave a cell in a column its table no longer has");
    }

    const formulaColumns = tableRecords.flatMap((table) =>
      (table.columns ?? []).flatMap((column, col) => {
        const colId = table.colIds[col];
        return column.type === "formula" && colId !== undefined ? [colId] : [];
      }),
    );
    for (let start = 0; start < formulaColumns.length; start += INSERT_BATCH) {
      const found = await db
        .select({ tableId: cells.tableId })
        .from(cells)
        .where(inArray(cells.colId, formulaColumns.slice(start, start + INSERT_BATCH)))
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
        .where(inSpreadsheet),
      db
        .select({ pageId: views.pageId })
        .from(views)
        .innerJoin(pages, eq(pages.id, views.pageId))
        .where(inSpreadsheet),
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
   * Rewrites the formulas that name a page, table, or column about to be
   * renamed. Must run inside `change`, before the rename itself: the old name
   * is how the formulas are recognized, and a cell saved during the rename
   * would keep the old name.
   */
  private async rewriteFormulas(
    tx: Database,
    writer: ContentWriter,
    spreadsheetId: string,
    rename: Rename,
  ): Promise<Contents> {
    const contents = await this.within(tx).read(spreadsheetId);
    const { data } = contents;
    await this.storeRewrite(writer, contents, {
      cells: inputsAfterRename(data, rename),
      views: viewsAfterRename(data, data.views, rename),
      columns: columnFormulasAfterRename(data, rename),
      names: nameFormulasAfterRename(data, rename),
    });
    return contents;
  }

  /**
   * Rewrites the formulas that must name a page for a table or view to move
   * to another page. Must run inside `change`, before the move itself: where
   * things are now is how the formulas are read.
   */
  private async rewriteForMove(
    tx: Database,
    writer: ContentWriter,
    spreadsheetId: string,
    move: Move,
  ): Promise<void> {
    const contents = await this.within(tx).read(spreadsheetId);
    const { data } = contents;
    await this.storeRewrite(writer, contents, {
      cells: inputsAfterMove(data, move),
      views: viewsAfterMove(data, data.views, move),
      columns: columnFormulasAfterMove(data, move),
      names: nameFormulasAfterMove(data, move),
    });
  }

  /** Stores what a rewrite changed in the three places that hold formulas. */
  private async storeRewrite(
    writer: ContentWriter,
    contents: Contents,
    rewritten: {
      cells: StoredInput[];
      views: { id: string; source: string }[];
      columns: ColumnFormula[];
      names: NameFormula[];
    },
  ): Promise<void> {
    writer.markRewrites();
    await writer.setCells(rewritten.cells.map((cell) => contents.identify(cell)));
    await this.storeViewSources(writer, rewritten.views);
    await this.storeColumnFormulas(writer, contents.data.tables, rewritten.columns);
    await this.storeNameFormulas(writer, contents.data.tables, rewritten.names);
  }

  /** Stores rewritten formulas of the names tables hold. */
  private async storeNameFormulas(
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

/** Throws, where an expression needs a value. */
function fail(error: Error): never {
  throw error;
}

function emptyChanged(): ChangedContent {
  return { pages: [], tables: [], views: [], rows: [], cells: [] };
}

/** What a change made, with what the work inside it returned. */
interface Outcome<T> {
  result: T;
  change: Change;
}

/** What a request created, with the change that created it. */
export type Created<Records> = Records & { change: Change };

/**
 * What two changes applied one after the other wrote together. Where both
 * wrote the same thing, the later one has it as it now is. Too much to send
 * is `null`, as it is from one change.
 */
function mergeChanged(
  earlier: ChangedContent | null,
  later: ChangedContent | null,
): ChangedContent | null {
  if (!earlier || !later) return null;
  const latest = <T>(items: readonly T[], key: (item: T) => string): T[] => [
    ...new Map(items.map((item) => [key(item), item])).values(),
  ];
  const cellsWritten = latest(
    [...earlier.cells, ...later.cells],
    ({ rowId, colId }) => `${rowId}:${colId}`,
  );
  if (cellsWritten.length > MAX_ANNOUNCED_CELLS) return null;
  return {
    pages: latest([...earlier.pages, ...later.pages], ({ id }) => id),
    tables: latest([...earlier.tables, ...later.tables], ({ id }) => id),
    views: latest([...earlier.views, ...later.views], ({ id }) => id),
    rows: latest([...earlier.rows, ...later.rows], ({ id }) => id),
    cells: cellsWritten,
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
