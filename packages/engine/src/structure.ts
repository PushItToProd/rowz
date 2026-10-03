import type { CellId } from "./address";
import type { Reference } from "./ast";

export interface PageDefinition {
  id: string;
  name: string;
}

/** What a column of a data table accepts. `any` reads what is typed as an ordinary cell does. */
export type ColumnType = "any" | "text" | "number" | "date" | "checkbox" | "formula";

export const COLUMN_TYPES: readonly ColumnType[] = [
  "any",
  "text",
  "number",
  "date",
  "checkbox",
  "formula",
];

export interface ColumnDefinition {
  name: string;
  type: ColumnType;
  /** For a formula column: the formula every row computes, with its leading `=`. */
  formula?: string;
}

/** Column names are matched without regard to letter case or to spaces around them. */
function columnKey(name: string): string {
  return name.trim().toLowerCase();
}

/** The index of a table's column by name, or -1. */
export function findColumn(table: TableDefinition, name: string): number {
  const key = columnKey(name);
  return (table.columns ?? []).findIndex((column) => columnKey(column.name) === key);
}

export function sameColumnName(a: string, b: string): boolean {
  return columnKey(a) === columnKey(b);
}

export interface TableDefinition {
  id: string;
  pageId: string;
  name: string;
  /**
   * The named columns of a data table, one for each column in order. A table
   * without them is a plain grid whose columns are known only by letter.
   */
  columns?: readonly ColumnDefinition[] | null;
  /**
   * The table's size. A range with an open side, such as `A:A`, stops here.
   * Without a size it stops at the last row and column that hold a cell.
   */
  rowCount?: number;
  colCount?: number;
}

/** A block that holds names and has no cells. Its source is parsed by `parseScript`. */
export interface ScriptDefinition {
  id: string;
  pageId: string;
  name: string;
  source: string;
}

/**
 * A name for a value: an identifier and the formula that computes it. A plain
 * table or a script holds it, and the formula is written there. In a table, a
 * reference with no table name means that table. In a script, as in a text
 * view, a reference names its table.
 *
 * A data table holds no names. Its rows can be sorted and filtered for
 * display while `B2` keeps meaning a position, so a named cell could appear
 * to point at a row it does not read, and its columns already have names.
 */
export interface NameDefinition {
  /** The id of the table that holds the name. A script's names come from its source. */
  holderId: string;
  name: string;
  /** With or without the leading `=`. */
  formula: string;
}

/**
 * A name as a plain table lists it. A data table lists none: its rows can be
 * sorted and filtered for display while `B2` stays positional, so a named
 * cell could appear to point at a row it does not read, and its columns
 * already have names.
 */
export interface TableName {
  name: string;
  /** With or without the leading `=`. */
  formula: string;
}

/** What holds a name: a table or a script, either of which is on a page and has a name. */
export interface Holder {
  kind: "table" | "script";
  id: string;
  pageId: string;
  name: string;
}

export interface WorkbookStructure {
  pages: readonly PageDefinition[];
  tables: readonly TableDefinition[];
  scripts?: readonly ScriptDefinition[];
  names?: readonly NameDefinition[];
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
  private readonly pages: ReadonlyMap<string, PageDefinition>;
  private readonly holders: readonly Holder[];
  private readonly pageIdByName: ReadonlyMap<string, string>;
  /** Keyed by page ID, then by table name. */
  private readonly tablesByPage: ReadonlyMap<string, ReadonlyMap<string, TableDefinition>>;

  constructor({ pages, tables, scripts = [] }: WorkbookStructure) {
    this.tablesById = new Map(tables.map((table) => [table.id, table]));
    this.pages = new Map(pages.map((page) => [page.id, page]));
    this.holders = [
      ...tables.map(({ id, pageId, name }) => ({ kind: "table" as const, id, pageId, name })),
      ...scripts.map(({ id, pageId, name }) => ({ kind: "script" as const, id, pageId, name })),
    ];
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

  /** The table or script with an id. */
  holder(id: string): Holder | undefined {
    return this.holders.find((holder) => holder.id === id);
  }

  /**
   * Finds the table or script a qualified name is held by. With no page name
   * it is the one on the page the formula is written on.
   */
  findHolder(
    name: string,
    page: string | undefined,
    originPageId: string | undefined,
  ): Holder | undefined {
    const pageId = page === undefined ? originPageId : this.pageIdByName.get(nameKey(page));
    const key = nameKey(name);
    return this.holders.find((holder) => holder.pageId === pageId && nameKey(holder.name) === key);
  }

  /** Every table of a name, on any page. */
  tablesNamed(name: string): Holder[] {
    const key = nameKey(name);
    return this.holders.filter((holder) => holder.kind === "table" && nameKey(holder.name) === key);
  }

  pageName(pageId: string): string | undefined {
    return this.pages.get(pageId)?.name;
  }

  /** Whether a page qualifier names the given page. */
  isPage(name: string, pageId: string): boolean {
    return this.pageIdByName.get(nameKey(name)) === pageId;
  }
}
