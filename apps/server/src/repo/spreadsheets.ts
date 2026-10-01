import {
  columnLabel,
  formatAddress,
  inputsAfterEdit,
  inputsAfterRename,
  type Rename,
} from "@spreadsheet-app/engine";
import {
  DEFAULT_TABLE_SIZE,
  LIMITS,
  type CellInput,
  type StoredCell,
  type StructuralEditBody,
} from "@spreadsheet-app/shared";
import { and, asc, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import type { Database } from "../db/client";
import {
  actionRuns,
  cells,
  pages,
  spreadsheets,
  tables,
  users,
  workspaceMembers,
  workspaces,
  type Role,
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
}

/** A whole spreadsheet: everything the editor and the formula engine need. */
export interface Snapshot {
  id: string;
  name: string;
  role: Role;
  pages: PageRecord[];
  tables: TableRecord[];
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
};

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
    return { ...spreadsheet, pages: pageRows, tables: tableRows, cells: cellRows };
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
      await touch(tx, spreadsheetId);
      return { page, table };
    });
  }

  /** Renames a page and the formulas that name it. Returns the cells whose formulas changed. */
  async renamePage(pageId: string, name: string): Promise<StoredCell[]> {
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
      await touch(tx, page.spreadsheetId);
      return rewritten;
    });
  }

  async deletePage(pageId: string): Promise<void> {
    const page = await this.findPage(pageId, "write");
    await this.db.transaction(async (tx) => {
      // Locking the spreadsheet keeps two concurrent deletes from removing the last two pages.
      await lockSpreadsheet(tx, page.spreadsheetId);
      const remaining = await tx.$count(pages, eq(pages.spreadsheetId, page.spreadsheetId));
      if (remaining <= 1) throw conflict("A spreadsheet needs at least one page");
      await tx.delete(pages).where(eq(pages.id, pageId));
      await touch(tx, page.spreadsheetId);
    });
  }

  /** Creates an empty table. Without a name the table gets the next free `Table N`. */
  async createTable(pageId: string, name?: string): Promise<TableRecord> {
    const page = await this.findPage(pageId, "write");
    const siblings = await this.db
      .select({ name: tables.name, position: tables.position })
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
      position: Math.max(-1, ...siblings.map((table) => table.position)) + 1,
      ...DEFAULT_TABLE_SIZE,
    };
    const [table] = await this.db
      .insert(tables)
      .values(values)
      .returning(tableColumns)
      .catch(rethrowDuplicate("table", values.name));
    if (!table) throw new Error("Insert returned no table");
    await touch(this.db, page.spreadsheetId);
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
  ): Promise<{ table: TableRecord; cells: StoredCell[] }> {
    const table = await this.findTable(tableId, "write");
    return this.db.transaction(async (tx) => {
      const rewritten =
        changes.name === undefined
          ? []
          : await this.rewriteFormulas(tx, table.spreadsheetId, {
              kind: "table",
              tableId,
              name: changes.name,
            });
      const [updated] = await tx
        .update(tables)
        .set(changes)
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
      await touch(tx, table.spreadsheetId);
      return { table: updated, cells: rewritten };
    });
  }

  async deleteTable(tableId: string): Promise<void> {
    const table = await this.findTable(tableId, "write");
    await this.db.delete(tables).where(eq(tables.id, tableId));
    await touch(this.db, table.spreadsheetId);
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

    // One statement cannot update the same row twice, so keep the last entry per cell.
    const latest = [...new Map(inputs.map((cell) => [formatAddress(cell), cell])).values()];

    await this.db.transaction(async (tx) => {
      await this.storeCells(
        tx,
        latest.map((cell) => ({ tableId, ...cell })),
      );
      await touch(tx, table.spreadsheetId);
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
   * keep reading the same cells. `cells` lists every cell that changed, with
   * an empty input for a cell that is now empty.
   */
  async editStructure(
    tableId: string,
    edit: StructuralEditBody,
  ): Promise<{ table: TableRecord; cells: StoredCell[] }> {
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

      const written = inputsAfterEdit(snapshot, { tableId, ...edit });
      await this.storeCells(tx, written);
      const newCount = count + (edit.kind === "insert" ? 1 : -1);
      const [updated] = await tx
        .update(tables)
        .set(rows ? { rowCount: newCount } : { colCount: newCount })
        .where(eq(tables.id, tableId))
        .returning(tableColumns);
      if (!updated) throw notFound("Table");
      await touch(tx, spreadsheetId);
      return { table: updated, cells: written };
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
  ): Promise<StoredCell[]> {
    // Without the lock, a cell saved during the rename could keep the old name.
    await lockSpreadsheet(tx, spreadsheetId);
    const snapshot = await new SpreadsheetRepository(tx, this.userId).getSnapshot(spreadsheetId);
    const rewritten = inputsAfterRename(snapshot, rename);
    await this.storeCells(tx, rewritten);
    return rewritten;
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

async function touch(db: Database, spreadsheetId: string): Promise<void> {
  await db
    .update(spreadsheets)
    .set({ updatedAt: sql`now()` })
    .where(eq(spreadsheets.id, spreadsheetId));
}

async function lockSpreadsheet(db: Database, spreadsheetId: string): Promise<void> {
  await db
    .select({ id: spreadsheets.id })
    .from(spreadsheets)
    .where(eq(spreadsheets.id, spreadsheetId))
    .for("update");
}

/** For `.catch()`: turns a unique-name violation into a 409 and rethrows anything else. */
function rethrowDuplicate(kind: "page" | "table", name: string): (cause: unknown) => never {
  return (cause) => {
    if (isUniqueViolation(cause)) throw conflict(`A ${kind} named ${name} already exists`);
    throw cause;
  };
}
