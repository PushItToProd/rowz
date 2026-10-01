import type { CellId } from "./address";
import type { Reference } from "./ast";

export interface PageDefinition {
  id: string;
  name: string;
}

export interface TableDefinition {
  id: string;
  pageId: string;
  name: string;
  /**
   * The table's size. A range with an open side, such as `A:A`, stops here.
   * Without a size it stops at the last row and column that hold a cell.
   */
  rowCount?: number;
  colCount?: number;
}

export interface WorkbookStructure {
  pages: readonly PageDefinition[];
  tables: readonly TableDefinition[];
}

export type StoredInput = CellId & { input: string };

/** Everything needed to build a workbook: its structure and the non-empty cells. */
export interface WorkbookData extends WorkbookStructure {
  cells: readonly StoredInput[];
}

/** Page and table names in references are matched without regard to letter case. */
function nameKey(name: string): string {
  return name.toLowerCase();
}

/**
 * Finds the table a reference means. This is the one place that defines how
 * the names in a reference map to tables:
 *
 * - no table name: the table that holds the formula
 * - a table name alone: the table of that name on the formula's own page
 * - a page name and a table name: that table on that page
 */
export class TableResolver {
  private readonly tablesById: ReadonlyMap<string, TableDefinition>;
  private readonly pageIdByName: ReadonlyMap<string, string>;
  /** Keyed by page ID, then by table name. */
  private readonly tablesByPage: ReadonlyMap<string, ReadonlyMap<string, TableDefinition>>;

  constructor({ pages, tables }: WorkbookStructure) {
    this.tablesById = new Map(tables.map((table) => [table.id, table]));
    this.pageIdByName = new Map(pages.map((page) => [nameKey(page.name), page.id]));
    const byPage = new Map<string, Map<string, TableDefinition>>();
    for (const table of tables) {
      const named = byPage.get(table.pageId) ?? new Map<string, TableDefinition>();
      named.set(nameKey(table.name), table);
      byPage.set(table.pageId, named);
    }
    this.tablesByPage = byPage;
  }

  table(tableId: string): TableDefinition | undefined {
    return this.tablesById.get(tableId);
  }

  find(reference: Reference, originTableId: string): TableDefinition | undefined {
    const origin = this.tablesById.get(originTableId);
    return reference.table === undefined ? origin : this.findNamed(reference, origin?.pageId);
  }

  /**
   * Finds the table a reference means when it is written on a page but not in
   * a table, as in a chart or a text view. Such a reference must name its table.
   */
  findFromPage(reference: Reference, pageId: string): TableDefinition | undefined {
    return this.findNamed(reference, pageId);
  }

  private findNamed(
    reference: Reference,
    originPageId: string | undefined,
  ): TableDefinition | undefined {
    if (reference.table === undefined) return undefined;
    const pageId =
      reference.page === undefined ? originPageId : this.pageIdByName.get(nameKey(reference.page));
    if (pageId === undefined) return undefined;
    return this.tablesByPage.get(pageId)?.get(nameKey(reference.table));
  }

  /** Whether a page qualifier names the given page. */
  isPage(name: string, pageId: string): boolean {
    return this.pageIdByName.get(nameKey(name)) === pageId;
  }
}
