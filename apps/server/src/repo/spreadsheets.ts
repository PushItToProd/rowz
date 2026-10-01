import {
  addFormatRule,
  columnFormulasAfterEdit,
  columnFormulasAfterRename,
  columnLabel,
  formatAddress,
  formatRulesAfterEdit,
  inputsAfterEdit,
  inputsAfterRename,
  isFormulaInput,
  sameColumnName,
  viewsAfterEdit,
  viewsAfterRename,
  type ChartType,
  type ColumnDefinition,
  type ColumnFormula,
  type ColumnType,
  type FormatRule,
  type Rename,
} from "@spreadsheet-app/engine";
import {
  DEFAULT_TABLE_SIZE,
  FILE_LIMITS,
  LIMITS,
  MAX_FORMAT_RULES,
  type CellInput,
  type SpreadsheetFile,
  type StoredCell,
  toSpreadsheetFile,
  type StructuralEditBody,
} from "@spreadsheet-app/shared";
import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  actionRuns,
  cells,
  pages,
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
import { conflict, forbidden, isUniqueViolation, notFound, unprocessable } from "../errors";

export type Access = "read" | "write";

export interface SpreadsheetSummary {
  id: string;
  name: string;
  updatedAt: Date;
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
  for (const { name: pageName, items } of file.pages) {
    const fileTables = items.filter((item) => item.type === "table");
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
  constructor(
    private readonly db: Database,
    private readonly userId: string,
  ) {}

  async listSpreadsheets(): Promise<SpreadsheetSummary[]> {
    return this.db
      .select({ id: spreadsheets.id, name: spreadsheets.name, updatedAt: spreadsheets.updatedAt })
      .from(spreadsheets)
      .innerJoin(workspaceMembers, this.membership())
      .orderBy(desc(spreadsheets.updatedAt));
  }

  /** Creates a spreadsheet with one page holding one empty table. */
  async createSpreadsheet(name: string): Promise<SpreadsheetSummary> {
    return this.db.transaction(async (tx) => {
      const workspaceId = await new SpreadsheetRepository(tx, this.userId).personalWorkspace();
      const [spreadsheet] = await tx
        .insert(spreadsheets)
        .values({ workspaceId, name, createdBy: this.userId })
        .returning();
      if (!spreadsheet) throw new Error("Insert returned no spreadsheet");
      await new SpreadsheetRepository(tx, this.userId).createPage(spreadsheet.id);
      return { id: spreadsheet.id, name: spreadsheet.name, updatedAt: spreadsheet.updatedAt };
    });
  }

  /** Creates a spreadsheet from a file, in the caller's own workspace. Nothing is created if any part is refused. */
  async importSpreadsheet(file: SpreadsheetFile): Promise<SpreadsheetSummary> {
    checkFile(file);
    return this.createFromFile(file);
  }

  private async createFromFile(file: SpreadsheetFile): Promise<SpreadsheetSummary> {
    return this.db.transaction(async (tx) => {
      const workspaceId = await new SpreadsheetRepository(tx, this.userId).personalWorkspace();
      const [spreadsheet] = await tx
        .insert(spreadsheets)
        .values({ workspaceId, name: file.name, createdBy: this.userId })
        .returning();
      if (!spreadsheet) throw new Error("Insert returned no spreadsheet");
      await this.insertContents(tx, spreadsheet.id, file);
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
      for (const [position, item] of page.items.entries()) {
        const placed = { pageId: created.id, name: item.name, position };
        if (item.type !== "table") {
          await tx.insert(views).values({
            ...placed,
            kind: item.type,
            source: item.source,
            chartType: item.type === "chart" ? item.chartType : null,
          });
          continue;
        }
        const columns = item.columns?.map(normalized) ?? null;
        const [table] = await tx
          .insert(tables)
          .values({
            ...placed,
            rowCount: item.rowCount,
            colCount: item.colCount,
            columns,
            formats: item.formats ?? [],
          })
          .returning({ id: tables.id });
        if (!table) throw new Error("Insert returned no table");
        // A formula column computes its cells, so none are stored for it.
        const filled = item.cells.filter(
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
    await this.db.transaction(async (tx) => {
      await lockSpreadsheet(tx, spreadsheetId);
      const version = await this.findVersion(tx, spreadsheetId, versionId);
      await this.keepVersion(tx, spreadsheetId, "Before restoring an earlier version");
      // Pages take their tables, cells, and views with them.
      await tx.delete(pages).where(eq(pages.spreadsheetId, spreadsheetId));
      await tx
        .update(spreadsheets)
        .set({ name: version.name })
        .where(eq(spreadsheets.id, spreadsheetId));
      await this.insertContents(tx, spreadsheetId, version);
      await this.touch(tx, spreadsheetId);
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
    const snapshot = await new SpreadsheetRepository(db, this.userId).getSnapshot(spreadsheetId);
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

  async getSnapshot(spreadsheetId: string): Promise<Snapshot> {
    const spreadsheet = await this.findSpreadsheet(spreadsheetId, "read");
    const pageRows = await this.db
      .select(pageColumns)
      .from(pages)
      .where(eq(pages.spreadsheetId, spreadsheetId))
      .orderBy(asc(pages.position));
    const tableRows = await this.db
      .select(tableColumns)
      .from(tables)
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(eq(pages.spreadsheetId, spreadsheetId))
      .orderBy(asc(tables.position));
    const cellRows = await this.db
      .select({ tableId: cells.tableId, row: cells.row, col: cells.col, input: cells.input })
      .from(cells)
      .innerJoin(tables, eq(tables.id, cells.tableId))
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .where(eq(pages.spreadsheetId, spreadsheetId));
    const viewRows = await this.db
      .select(viewColumns)
      .from(views)
      .innerJoin(pages, eq(pages.id, views.pageId))
      .where(eq(pages.spreadsheetId, spreadsheetId))
      .orderBy(asc(views.position));
    return { ...spreadsheet, pages: pageRows, tables: tableRows, views: viewRows, cells: cellRows };
  }

  async renameSpreadsheet(spreadsheetId: string, name: string): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, "write");
    await this.db
      .update(spreadsheets)
      .set({ name, updatedAt: sql`now()` })
      .where(eq(spreadsheets.id, spreadsheetId));
  }

  async deleteSpreadsheet(spreadsheetId: string): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, "write");
    await this.db.delete(spreadsheets).where(eq(spreadsheets.id, spreadsheetId));
  }

  /** Creates a page with one empty table. Without a name the page gets the next free `Page N`. */
  async createPage(
    spreadsheetId: string,
    name?: string,
  ): Promise<{ page: PageRecord; table: TableRecord }> {
    await this.findSpreadsheet(spreadsheetId, "write");
    return this.db.transaction(async (tx) => {
      const siblings = await tx
        .select({ name: pages.name, position: pages.position })
        .from(pages)
        .where(eq(pages.spreadsheetId, spreadsheetId));
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
      const [page] = await tx
        .insert(pages)
        .values(values)
        .returning(pageColumns)
        .catch(rethrowDuplicate("page", values.name));
      if (!page) throw new Error("Insert returned no page");
      const table = await new SpreadsheetRepository(tx, this.userId).createTable(page.id);
      await this.touch(tx, spreadsheetId);
      return { page, table };
    });
  }

  /** Renames a page and the formulas that name it. Returns what was rewritten. */
  async renamePage(pageId: string, name: string): Promise<Rewritten> {
    const page = await this.findPage(pageId, "write");
    return this.db.transaction(async (tx) => {
      const rewritten = await this.rewriteFormulas(tx, page.spreadsheetId, {
        kind: "page",
        pageId,
        name,
      });
      await tx
        .update(pages)
        .set({ name })
        .where(eq(pages.id, pageId))
        .catch(rethrowDuplicate("page", name));
      await this.touch(tx, page.spreadsheetId);
      return rewritten;
    });
  }

  /**
   * Puts the tables, charts, and text views of a page in the order given. The
   * list must name every one of them once, so that a stale client cannot
   * leave two items in one place.
   */
  async reorderPage(pageId: string, items: readonly string[]): Promise<void> {
    const page = await this.findPage(pageId, "write");
    await this.db.transaction(async (tx) => {
      await lockSpreadsheet(tx, page.spreadsheetId);
      const [tableRows, viewRows] = await Promise.all([
        tx.select({ id: tables.id }).from(tables).where(eq(tables.pageId, pageId)),
        tx.select({ id: views.id }).from(views).where(eq(views.pageId, pageId)),
      ]);
      const tableIds = new Set(tableRows.map((row) => row.id));
      const present = new Set([...tableIds, ...viewRows.map((row) => row.id)]);
      const complete =
        items.length === present.size &&
        new Set(items).size === items.length &&
        items.every((id) => present.has(id));
      if (!complete) {
        throw conflict("The page has changed. Reload it and try again");
      }
      for (const [position, id] of items.entries()) {
        const target = tableIds.has(id) ? tables : views;
        await tx.update(target).set({ position }).where(eq(target.id, id));
      }
      await this.touch(tx, page.spreadsheetId);
    });
  }

  async deletePage(pageId: string): Promise<void> {
    const page = await this.findPage(pageId, "write");
    await this.db.transaction(async (tx) => {
      // Locking the spreadsheet keeps two concurrent deletes from removing the last two pages.
      await lockSpreadsheet(tx, page.spreadsheetId);
      const remaining = await tx.$count(pages, eq(pages.spreadsheetId, page.spreadsheetId));
      if (remaining <= 1) throw conflict("A spreadsheet needs at least one page");
      await this.keepVersion(tx, page.spreadsheetId, `Before deleting the page ${page.name}`);
      await tx.delete(pages).where(eq(pages.id, pageId));
      await this.touch(tx, page.spreadsheetId);
    });
  }

  /** Creates an empty table. Without a name the table gets the next free `Table N`. */
  async createTable(pageId: string, name?: string): Promise<TableRecord> {
    const page = await this.findPage(pageId, "write");
    const siblings = await this.db
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
      position: await this.nextPosition(pageId),
      ...DEFAULT_TABLE_SIZE,
    };
    const [table] = await this.db
      .insert(tables)
      .values(values)
      .returning(tableColumns)
      .catch(rethrowDuplicate("table", values.name));
    if (!table) throw new Error("Insert returned no table");
    await this.touch(this.db, page.spreadsheetId);
    return table;
  }

  /**
   * Renames or resizes a table. Renaming rewrites the formulas that name the
   * table, and `cells` lists the ones that changed. Shrinking deletes the
   * cells that no longer fit.
   */
  async updateTable(
    tableId: string,
    changes: {
      name?: string | undefined;
      rowCount?: number | undefined;
      colCount?: number | undefined;
    },
  ): Promise<Rewritten & { table: TableRecord }> {
    const table = await this.findTable(tableId, "write");
    return this.db.transaction(async (tx) => {
      const shrinks =
        (changes.rowCount ?? table.rowCount) < table.rowCount ||
        (changes.colCount ?? table.colCount) < table.colCount;
      if (shrinks) {
        await this.keepVersion(tx, table.spreadsheetId, `Before making ${table.name} smaller`);
      }
      const rewritten =
        changes.name === undefined
          ? { cells: [], views: [], tables: [] }
          : await this.rewriteFormulas(tx, table.spreadsheetId, {
              kind: "table",
              tableId,
              name: changes.name,
            });
      // The rename may have rewritten this table's own formula columns.
      const current =
        rewritten.tables.find((candidate) => candidate.id === tableId)?.columns ?? table.columns;
      const columns =
        current && changes.colCount !== undefined ? resized(current, changes.colCount) : current;
      const [updated] = await tx
        .update(tables)
        .set({ ...changes, columns })
        .where(eq(tables.id, tableId))
        .returning(tableColumns)
        .catch(rethrowDuplicate("table", changes.name ?? ""));
      if (!updated) throw notFound("Table");
      await tx
        .delete(cells)
        .where(
          and(
            eq(cells.tableId, tableId),
            or(gte(cells.row, updated.rowCount), gte(cells.col, updated.colCount)),
          ),
        );
      await this.touch(tx, table.spreadsheetId);
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
    const table = await this.findTable(tableId, "write");
    if (table.columns) throw conflict(`${table.name} already has named columns`);
    return this.db.transaction(async (tx) => {
      const inner = new SpreadsheetRepository(tx, this.userId);
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
        rewritten = await inner.editStructure(tableId, { axis: "row", kind: "delete", index: 0 });
      } else if (headerRow) {
        rewritten.cells = header.map(({ col }) => ({ tableId, row: 0, col, input: "" }));
        await this.storeCells(tx, rewritten.cells);
      }
      const typed = new Map(header.map(({ col, input }) => [col, input]));
      const names: string[] = [];
      for (let col = 0; col < table.colCount; col += 1)
        names.push(columnNameFrom(typed.get(col), names));
      const [updated] = await tx
        .update(tables)
        .set({ columns: names.map((name) => ({ name, type: "any" as const })) })
        .where(eq(tables.id, tableId))
        .returning(tableColumns);
      if (!updated) throw notFound("Table");
      await this.touch(tx, table.spreadsheetId);
      return { ...rewritten, table: updated };
    });
  }

  /** Changes how a block of cells is shown. The format is added to whatever the cells already have. */
  async formatCells(tableId: string, rule: FormatRule): Promise<TableRecord> {
    const table = await this.findTable(tableId, "write");
    const formats = addFormatRule(table.formats, rule);
    if (formats.length > MAX_FORMAT_RULES) {
      throw unprocessable(
        "too_many_formats",
        `${table.name} has too many separate formats. Clear the formatting of some cells first`,
      );
    }
    const [updated] = await this.db
      .update(tables)
      .set({ formats })
      .where(eq(tables.id, tableId))
      .returning(tableColumns);
    if (!updated) throw notFound("Table");
    await this.touch(this.db, table.spreadsheetId);
    return updated;
  }

  /** Makes a data table a plain table again. Its formula columns stop computing. */
  async dropColumns(tableId: string): Promise<TableRecord> {
    const table = await this.findTable(tableId, "write");
    await this.keepVersion(
      this.db,
      table.spreadsheetId,
      `Before removing the column names of ${table.name}`,
    );
    const [updated] = await this.db
      .update(tables)
      .set({ columns: null })
      .where(eq(tables.id, tableId))
      .returning(tableColumns);
    if (!updated) throw notFound("Table");
    await this.touch(this.db, table.spreadsheetId);
    return updated;
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
    const found = await this.findTable(tableId, "write");
    const before = found.columns?.[col];
    if (!found.columns)
      throw unprocessable("not_a_data_table", `${found.name} has no named columns`);
    if (!before)
      throw unprocessable("out_of_bounds", `${found.name} has no column ${columnLabel(col)}`);

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

    return this.db.transaction(async (tx) => {
      if (type === "formula" && before.type !== "formula") {
        await this.keepVersion(
          tx,
          found.spreadsheetId,
          `Before making ${before.name} a formula column`,
        );
      }
      const renamed = !sameColumnName(before.name, name) || before.name !== name;
      const rewritten = renamed
        ? await this.rewriteFormulas(tx, found.spreadsheetId, {
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
      const kept = current?.[col];
      const next =
        type === "formula" && changes.formula === undefined && kept?.formula !== undefined
          ? { ...column, formula: kept.formula }
          : column;
      const [updated] = await tx
        .update(tables)
        .set({ columns: (current ?? []).with(col, next) })
        .where(eq(tables.id, tableId))
        .returning(tableColumns);
      if (!updated) throw notFound("Table");
      if (type === "formula") {
        await tx.delete(cells).where(and(eq(cells.tableId, tableId), eq(cells.col, col)));
      }
      await this.touch(tx, found.spreadsheetId);
      return {
        table: updated,
        ...rewritten,
        tables: rewritten.tables.filter((candidate) => candidate.id !== tableId),
      };
    });
  }

  /** Adds a chart or a text view to the end of a page. */
  async createView(pageId: string, kind: ViewKind): Promise<ViewRecord> {
    const page = await this.findPage(pageId, "write");
    const siblings = await this.db
      .select({ name: views.name })
      .from(views)
      .where(and(eq(views.pageId, pageId), eq(views.kind, kind)));
    const names = siblings.map((view) => view.name);
    const [view] = await this.db
      .insert(views)
      .values({
        pageId,
        kind,
        position: await this.nextPosition(pageId),
        ...(kind === "chart"
          ? { name: nextName("Chart", names), source: "", chartType: "bar" as const }
          : { name: nextName("Text", names), source: STARTER_TEMPLATE }),
      })
      .returning(viewColumns);
    if (!view) throw new Error("Insert returned no view");
    await this.touch(this.db, page.spreadsheetId);
    return view;
  }

  async updateView(
    viewId: string,
    changes: {
      name?: string | undefined;
      source?: string | undefined;
      chartType?: ChartType | undefined;
    },
  ): Promise<ViewRecord> {
    const view = await this.findView(viewId, "write");
    if (changes.chartType !== undefined && view.kind !== "chart") {
      throw unprocessable("not_a_chart", `${view.name} is not a chart`);
    }
    const [updated] = await this.db
      .update(views)
      .set(changes)
      .where(eq(views.id, viewId))
      .returning(viewColumns);
    if (!updated) throw notFound("View");
    await this.touch(this.db, view.spreadsheetId);
    return updated;
  }

  async deleteView(viewId: string): Promise<void> {
    const view = await this.findView(viewId, "write");
    await this.keepVersion(this.db, view.spreadsheetId, `Before deleting ${view.name}`);
    await this.db.delete(views).where(eq(views.id, viewId));
    await this.touch(this.db, view.spreadsheetId);
  }

  async deleteTable(tableId: string): Promise<void> {
    const table = await this.findTable(tableId, "write");
    await this.keepVersion(this.db, table.spreadsheetId, `Before deleting the table ${table.name}`);
    await this.db.delete(tables).where(eq(tables.id, tableId));
    await this.touch(this.db, table.spreadsheetId);
  }

  /** Stores cell inputs. An empty input deletes the cell. Later entries for the same cell win. */
  async setCells(tableId: string, inputs: readonly CellInput[]): Promise<void> {
    const table = await this.findTable(tableId, "write");
    const outside = inputs.find((cell) => cell.row >= table.rowCount || cell.col >= table.colCount);
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

    await this.db.transaction(async (tx) => {
      if (latest.length >= BULK_WRITE_CELLS) {
        await this.keepVersion(
          tx,
          table.spreadsheetId,
          `Before changing ${String(latest.length)} cells of ${table.name}`,
        );
      }
      await this.storeCells(
        tx,
        latest.map((cell) => ({ tableId, ...cell })),
      );
      await this.touch(tx, table.spreadsheetId);
    });
  }

  /**
   * Grows a table to at least `rowCount` rows. Returns the table when it
   * grew, and `undefined` when it was already as tall.
   */
  async ensureRows(tableId: string, rowCount: number): Promise<TableRecord | undefined> {
    const table = await this.findTable(tableId, "write");
    if (rowCount <= table.rowCount) return undefined;
    if (rowCount > LIMITS.tableRows) {
      throw unprocessable(
        "table_full",
        `${table.name} cannot have more than ${String(LIMITS.tableRows)} rows`,
      );
    }
    const [updated] = await this.db
      .update(tables)
      .set({ rowCount })
      .where(eq(tables.id, tableId))
      .returning(tableColumns);
    return updated;
  }

  /**
   * Inserts or deletes one row or column. Cells past it move by one, and
   * formulas anywhere in the spreadsheet that read the table are rewritten to
   * keep reading the same cells, as are charts and text views.
   */
  async editStructure(
    tableId: string,
    edit: StructuralEditBody,
  ): Promise<Rewritten & { table: TableRecord }> {
    const { spreadsheetId } = await this.findTable(tableId, "write");
    return this.db.transaction(async (tx) => {
      // The edit is computed from a snapshot, so nothing may change under it.
      await lockSpreadsheet(tx, spreadsheetId);
      const snapshot = await new SpreadsheetRepository(tx, this.userId).getSnapshot(spreadsheetId);
      const table = snapshot.tables.find((candidate) => candidate.id === tableId);
      if (!table) throw notFound("Table");

      const rows = edit.axis === "row";
      const noun = rows ? "row" : "column";
      const count = rows ? table.rowCount : table.colCount;
      const limit = rows ? LIMITS.tableRows : LIMITS.tableCols;
      if (edit.kind === "delete") {
        if (edit.index >= count) {
          const label = rows ? String(edit.index + 1) : columnLabel(edit.index);
          throw unprocessable("out_of_bounds", `${table.name} has no ${noun} ${label}`);
        }
        if (count <= 1) throw unprocessable("last_one", `A table needs at least one ${noun}`);
      } else {
        if (edit.index > count) {
          const counted = `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
          throw unprocessable("out_of_bounds", `${table.name} has only ${counted}`);
        }
        if (count >= limit) {
          throw unprocessable("table_full", `A table can have at most ${String(limit)} ${noun}s`);
        }
      }

      if (edit.kind === "delete") {
        const label = rows ? `row ${String(edit.index + 1)}` : `column ${columnLabel(edit.index)}`;
        await this.keepVersion(tx, spreadsheetId, `Before deleting ${label} of ${table.name}`);
      }
      const written = inputsAfterEdit(snapshot, { tableId, ...edit });
      await this.storeCells(tx, written);
      const rewrittenViews = viewsAfterEdit(snapshot, snapshot.views, { tableId, ...edit });
      await this.storeViewSources(tx, rewrittenViews);
      const changed = await this.storeColumnFormulas(
        tx,
        snapshot.tables,
        columnFormulasAfterEdit(snapshot, { tableId, ...edit }),
      );
      // The formulas were rewritten at the positions the columns had before the edit.
      const current =
        changed.find((candidate) => candidate.id === tableId)?.columns ?? table.columns;
      const columns =
        current && !rows
          ? edit.kind === "insert"
            ? current.toSpliced(edit.index, 0, { name: nextColumnName(current), type: "any" })
            : current.toSpliced(edit.index, 1)
          : current;
      const newCount = count + (edit.kind === "insert" ? 1 : -1);
      const [updated] = await tx
        .update(tables)
        .set({
          ...(rows ? { rowCount: newCount } : { colCount: newCount, columns }),
          // Formats follow the cells they were given to.
          formats: formatRulesAfterEdit(table.formats, edit),
        })
        .where(eq(tables.id, tableId))
        .returning(tableColumns);
      if (!updated) throw notFound("Table");
      await this.touch(tx, spreadsheetId);
      return {
        table: updated,
        cells: written,
        views: rewrittenViews,
        tables: changed.filter((candidate) => candidate.id !== tableId),
      };
    });
  }

  /**
   * Blocks other transactions that lock the same spreadsheet until this one
   * ends. Button clicks use it so that two clicks on a counter do not both
   * read the same starting value.
   */
  async lockSpreadsheet(spreadsheetId: string): Promise<void> {
    await this.findSpreadsheet(spreadsheetId, "write");
    await lockSpreadsheet(this.db, spreadsheetId);
  }

  /** How many of the user's button clicks sent email since `since`. */
  async countEmailRuns(since: Date): Promise<number> {
    const sendsEmail = sql`${actionRuns.effects} @> '[{"type":"sendEmail"}]'::jsonb`;
    return this.db.$count(
      actionRuns,
      and(
        eq(actionRuns.userId, this.userId),
        gte(actionRuns.createdAt, since),
        inArray(actionRuns.status, ["pending", "succeeded"]),
        sendsEmail,
      ),
    );
  }

  async findSpreadsheet(
    spreadsheetId: string,
    access: Access,
  ): Promise<{ id: string; name: string; role: Role }> {
    const [row] = await this.db
      .select({ id: spreadsheets.id, name: spreadsheets.name, role: workspaceMembers.role })
      .from(spreadsheets)
      .innerJoin(workspaceMembers, this.membership())
      .where(eq(spreadsheets.id, spreadsheetId));
    return authorize(row, access, "Spreadsheet");
  }

  async findPage(
    pageId: string,
    access: Access,
  ): Promise<PageRecord & { spreadsheetId: string; role: Role }> {
    const [row] = await this.db
      .select({ ...pageColumns, spreadsheetId: spreadsheets.id, role: workspaceMembers.role })
      .from(pages)
      .innerJoin(spreadsheets, eq(spreadsheets.id, pages.spreadsheetId))
      .innerJoin(workspaceMembers, this.membership())
      .where(eq(pages.id, pageId));
    return authorize(row, access, "Page");
  }

  async findTable(
    tableId: string,
    access: Access,
  ): Promise<TableRecord & { spreadsheetId: string; role: Role }> {
    const [row] = await this.db
      .select({ ...tableColumns, spreadsheetId: spreadsheets.id, role: workspaceMembers.role })
      .from(tables)
      .innerJoin(pages, eq(pages.id, tables.pageId))
      .innerJoin(spreadsheets, eq(spreadsheets.id, pages.spreadsheetId))
      .innerJoin(workspaceMembers, this.membership())
      .where(eq(tables.id, tableId));
    return authorize(row, access, "Table");
  }

  /**
   * Rewrites the formulas that name a page or table about to be renamed, and
   * returns the cells that changed. Must run in a transaction, before the
   * rename itself: the old name is how the formulas are recognized.
   */
  private async rewriteFormulas(
    tx: Database,
    spreadsheetId: string,
    rename: Rename,
  ): Promise<Rewritten> {
    // Without the lock, a cell saved during the rename could keep the old name.
    await lockSpreadsheet(tx, spreadsheetId);
    const snapshot = await new SpreadsheetRepository(tx, this.userId).getSnapshot(spreadsheetId);
    const rewritten = {
      cells: inputsAfterRename(snapshot, rename),
      views: viewsAfterRename(snapshot, snapshot.views, rename),
    };
    await this.storeCells(tx, rewritten.cells);
    await this.storeViewSources(tx, rewritten.views);
    const changed = await this.storeColumnFormulas(
      tx,
      snapshot.tables,
      columnFormulasAfterRename(snapshot, rename),
    );
    return { ...rewritten, tables: changed };
  }

  /** Stores rewritten formulas of formula columns, and returns the tables they belong to as they now are. */
  private async storeColumnFormulas(
    db: Database,
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
      const [updated] = await db
        .update(tables)
        .set({ columns })
        .where(eq(tables.id, tableId))
        .returning(tableColumns);
      if (updated) stored.push(updated);
    }
    return stored;
  }

  private async storeViewSources(
    db: Database,
    changed: readonly { id: string; source: string }[],
  ): Promise<void> {
    for (const { id, source } of changed) {
      await db.update(views).set({ source }).where(eq(views.id, id));
    }
  }

  /** The position that puts a new table or view after everything else on its page. */
  private async nextPosition(pageId: string): Promise<number> {
    const taken = await Promise.all([
      this.db.select({ position: tables.position }).from(tables).where(eq(tables.pageId, pageId)),
      this.db.select({ position: views.position }).from(views).where(eq(views.pageId, pageId)),
    ]);
    return Math.max(-1, ...taken.flat().map((item) => item.position)) + 1;
  }

  /**
   * Stores cell inputs in any tables of a spreadsheet the caller has already
   * authorized. An empty input deletes the cell. No cell may appear twice.
   */
  private async storeCells(db: Database, inputs: readonly StoredCell[]): Promise<void> {
    // A statement binds a few parameters per cell, and Postgres accepts 65535.
    const BATCH = 5000;
    const filled = inputs.filter((cell) => cell.input !== "");
    for (let start = 0; start < filled.length; start += BATCH) {
      await db
        .insert(cells)
        .values(
          filled.slice(start, start + BATCH).map((cell) => ({ ...cell, updatedBy: this.userId })),
        )
        .onConflictDoUpdate({
          target: [cells.tableId, cells.row, cells.col],
          set: {
            input: sql`excluded.input`,
            updatedBy: sql`excluded.updated_by`,
            updatedAt: sql`now()`,
          },
        });
    }

    const cleared = inputs.filter((cell) => cell.input === "");
    for (let start = 0; start < cleared.length; start += BATCH) {
      const targets = cleared
        .slice(start, start + BATCH)
        .map((cell) =>
          and(eq(cells.tableId, cell.tableId), eq(cells.row, cell.row), eq(cells.col, cell.col)),
        );
      await db.delete(cells).where(or(...targets));
    }
  }

  async findView(
    viewId: string,
    access: Access,
  ): Promise<ViewRecord & { spreadsheetId: string; role: Role }> {
    const [row] = await this.db
      .select({ ...viewColumns, spreadsheetId: spreadsheets.id, role: workspaceMembers.role })
      .from(views)
      .innerJoin(pages, eq(pages.id, views.pageId))
      .innerJoin(spreadsheets, eq(spreadsheets.id, pages.spreadsheetId))
      .innerJoin(workspaceMembers, this.membership())
      .where(eq(views.id, viewId));
    return authorize(row, access, "View");
  }

  /** The join condition that limits a query to spreadsheets in the user's workspaces. */
  private membership() {
    return and(
      eq(workspaceMembers.workspaceId, spreadsheets.workspaceId),
      eq(workspaceMembers.userId, this.userId),
    );
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
  if (access === "write" && row.role === "viewer") throw forbidden();
  return row;
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

/** A table's columns after its width changes: new ones at the end, or fewer. */
function resized(columns: readonly ColumnDefinition[], colCount: number): ColumnDefinition[] {
  const result = columns.slice(0, colCount);
  while (result.length < colCount) result.push({ name: nextColumnName(result), type: "any" });
  return result;
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
