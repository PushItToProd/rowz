import { formatAddress } from "@spreadsheet-app/engine";
import { DEFAULT_TABLE_SIZE, type CellInput, type StoredCell } from "@spreadsheet-app/shared";
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

  async renamePage(pageId: string, name: string): Promise<void> {
    const page = await this.findPage(pageId, "write");
    await this.db
      .update(pages)
      .set({ name })
      .where(eq(pages.id, pageId))
      .catch(rethrowDuplicate("page", name));
    await touch(this.db, page.spreadsheetId);
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

  /** Renames or resizes a table. Shrinking deletes the cells that no longer fit. */
  async updateTable(
    tableId: string,
    changes: {
      name?: string | undefined;
      rowCount?: number | undefined;
      colCount?: number | undefined;
    },
  ): Promise<TableRecord> {
    const table = await this.findTable(tableId, "write");
    return this.db.transaction(async (tx) => {
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
      return updated;
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
    const filled = latest.filter((cell) => cell.input !== "");
    const cleared = latest.filter((cell) => cell.input === "");

    await this.db.transaction(async (tx) => {
      if (filled.length > 0) {
        await tx
          .insert(cells)
          .values(filled.map((cell) => ({ tableId, ...cell, updatedBy: this.userId })))
          .onConflictDoUpdate({
            target: [cells.tableId, cells.row, cells.col],
            set: {
              input: sql`excluded.input`,
              updatedBy: sql`excluded.updated_by`,
              updatedAt: sql`now()`,
            },
          });
      }
      if (cleared.length > 0) {
        const targets = cleared.map((cell) =>
          and(eq(cells.row, cell.row), eq(cells.col, cell.col)),
        );
        await tx.delete(cells).where(and(eq(cells.tableId, tableId), or(...targets)));
      }
      await touch(tx, table.spreadsheetId);
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
