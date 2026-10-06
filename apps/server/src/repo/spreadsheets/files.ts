import {
  criterionTest,
  formatAddress,
  sameColumnName,
  type ColumnDefinition,
  type TableDisplay,
} from "@spreadsheet-app/engine";
import {
  DEFAULT_TABLE_SIZE,
  FILE_FORMAT,
  FILE_LIMITS,
  LIMITS,
  keysAfter,
  TableLayout,
  type CellInput,
  type SpreadsheetFile,
  toSpreadsheetFile,
} from "@spreadsheet-app/shared";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { Database } from "../../db/client";
import { cells, pages, spreadsheets, tables, tableRows, views } from "../../db/schema";
import { unprocessable } from "../../errors";
import { type SpreadsheetSummary } from "./records";
import { filterFormula, normalized } from "./helpers";
import type { RepositoryContext } from "./context";

// Each row binds six parameters, and Postgres takes at most 65,535 in one statement.
export const INSERT_BATCH = 5000;

/** The first name in a list that another, earlier name matches without regard to case. */
export function repeated(names: readonly string[]): string | undefined {
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
export function checkFile(file: SpreadsheetFile): void {
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
    for (const fileTable of fileTables) {
      const { name, rowCount, colCount, cells: fileCells, columns, display } = fileTable;
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
        for (const column of columns) {
          if (column.type !== "choice") continue;
          if (column.choices && column.choicesFrom) {
            invalid(`The column ${column.name} of ${name} has choices and a source for them`);
          }
          // An empty list is a dropdown whose source was deleted, as an export writes it.
          if (column.choices === undefined && !column.choicesFrom) {
            invalid(`The dropdown column ${column.name} of ${name} has no choices`);
          }
          const from = column.choicesFrom;
          if (!from) continue;
          const source = file.pages
            .find((candidate) => candidate.name.toLowerCase() === from.page.toLowerCase())
            ?.blocks.find(
              (block) =>
                block.type === "table" && block.name.toLowerCase() === from.table.toLowerCase(),
            );
          const sourceColumns = source?.type === "table" ? source.columns : undefined;
          if (source === fileTable) {
            invalid(`The choices of ${column.name} in ${name} cannot come from ${name} itself`);
          }
          if (!sourceColumns?.some((candidate) => sameColumnName(candidate.name, from.column))) {
            invalid(
              `The choices of ${column.name} in ${name} come from ${from.column} of ${from.table}, which is not a column of a data table`,
            );
          }
        }
        const empty = columns.find(
          ({ type, formula = "" }) => type === "formula" && ["", "="].includes(formula.trim()),
        );
        if (empty) invalid(`The formula column ${empty.name} of ${name} has no formula`);
      }
      if (display) {
        if (!columns) invalid(`The table ${name} has a sort or filter and no named columns`);
        const keys = display.sort.map(({ column }) => column);
        if (keys.some((column) => column >= colCount)) {
          invalid(`The sort of ${name} names a column outside the table`);
        }
        if (new Set(keys).size !== keys.length) {
          invalid(`The sort of ${name} names a column twice`);
        }
      }
      for (const rule of fileTable.conditionalFormats ?? []) {
        if (
          (rule.endRow !== null && rule.endRow < rule.startRow) ||
          (rule.endCol !== null && rule.endCol < rule.startCol)
        ) {
          invalid(`A conditional format in ${name} ends before it starts`);
        }
        if (rule.kind === "criterion" && criterionTest(rule.criterion) === undefined) {
          invalid(`${rule.criterion} in ${name} is not a criterion`);
        }
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

/** A table just created from a file, with what resolving its choice columns needs. */
export interface InsertedTable {
  id: string;
  colIds: readonly string[];
  page: string;
  block: Extract<SpreadsheetFile["pages"][number]["blocks"][number], { type: "table" }>;
  columns: ColumnDefinition[] | null;
}

/** A file's sort and filter as they are stored: sort keys name column ids, which are new. */
export function displayFromFile(
  display: NonNullable<
    SpreadsheetFile["pages"][number]["blocks"][number] & { type: "table" }
  >["display"],
  colIds: readonly string[],
): TableDisplay {
  if (!display) return { sort: [] };
  const sort = display.sort.flatMap(({ column, descending }) => {
    const colId = colIds[column];
    return colId === undefined ? [] : [{ colId, descending }];
  });
  const filter = display.filter?.trim() ?? "";
  return { sort, ...(filter === "" ? {} : { filter: filterFormula(filter) }) };
}

/** Creates a spreadsheet with one page holding one empty table. */
export async function createSpreadsheet(
  ctx: RepositoryContext,
  name: string,
): Promise<SpreadsheetSummary> {
  return ctx.createFromFile({
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
export async function importSpreadsheet(
  ctx: RepositoryContext,
  file: SpreadsheetFile,
): Promise<SpreadsheetSummary> {
  checkFile(file);
  return ctx.createFromFile(file);
}

/** Copies current content with fresh identities and no shares or history. */
export async function copySpreadsheet(
  ctx: RepositoryContext,
  spreadsheetId: string,
): Promise<SpreadsheetSummary> {
  const { snapshot, data } = await ctx.repository.read(spreadsheetId);
  const cellsOf = new Map<string, CellInput[]>();
  for (const { tableId, ...cell } of data.cells) {
    const held = cellsOf.get(tableId);
    if (held) held.push(cell);
    else cellsOf.set(tableId, [cell]);
  }
  const suffix = " (copy)";
  const file = toSpreadsheetFile(
    snapshot.name.slice(0, LIMITS.nameLength - suffix.length) + suffix,
    snapshot.pages,
    data.tables,
    snapshot.views,
    (table) => cellsOf.get(table.id) ?? [],
  );
  return ctx.createFromFile(file, false);
}

export async function createFromFile(
  ctx: RepositoryContext,
  file: SpreadsheetFile,
  keepInitialVersion = true,
): Promise<SpreadsheetSummary> {
  return ctx.db.transaction(async (tx) => {
    const workspaceId = await ctx.within(tx).personalWorkspace();
    const [spreadsheet] = await tx
      .insert(spreadsheets)
      .values({ workspaceId, name: file.name, createdBy: ctx.userId })
      .returning();
    if (!spreadsheet) throw new Error("Insert returned no spreadsheet");
    await ctx.insertContents(tx, spreadsheet.id, file);
    // Keeps the first version, so that the spreadsheet can be put back as it arrived.
    if (keepInitialVersion) await ctx.touch(tx, spreadsheet.id);
    return { id: spreadsheet.id, name: spreadsheet.name, updatedAt: spreadsheet.updatedAt };
  });
}

/**
 * Creates the pages of a file, and everything on them, in a spreadsheet
 * that has none. Rows and columns get new ids, as pages and tables do: a
 * file names them by position.
 */
export async function insertContents(
  ctx: RepositoryContext,
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
      `A document can have at most ${String(LIMITS.spreadsheetRows)} rows`,
    );
  }
  const inserted: InsertedTable[] = [];
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
      // A choice column's source is resolved below, once every table has its ids.
      const columns =
        block.columns?.map(({ name, type, formula, choices }) =>
          normalized({
            name,
            type,
            ...(formula === undefined ? {} : { formula }),
            ...(choices === undefined ? {} : { choices }),
          }),
        ) ?? null;
      const colIds = Array.from({ length: block.colCount }, () => randomUUID());
      const [table] = await tx
        .insert(tables)
        .values({
          ...placed,
          colIds,
          columns,
          formats: block.formats ?? [],
          conditionalFormats: block.conditionalFormats ?? [],
          names: block.names ?? [],
          display: displayFromFile(block.display, colIds),
        })
        .returning({ id: tables.id });
      if (!table) throw new Error("Insert returned no table");
      inserted.push({ id: table.id, colIds, page: page.name, block, columns });
      const rows = keysAfter(null, block.rowCount).map((orderKey) => ({
        id: randomUUID(),
        tableId: table.id,
        orderKey,
      }));
      for (let from = 0; from < rows.length; from += INSERT_BATCH) {
        await tx.insert(tableRows).values(rows.slice(from, from + INSERT_BATCH));
      }
      const layout = new TableLayout(rows, colIds);
      if (block.gridSizes) {
        await tx
          .update(tables)
          .set({
            gridSizes: {
              rows: Object.fromEntries(
                block.gridSizes.rows.map(({ index, size }) => {
                  const row = rows[index];
                  if (!row) throw new Error("A row size is outside the imported table");
                  return [row.id, size];
                }),
              ),
              columns: Object.fromEntries(
                block.gridSizes.columns.map(({ index, size }) => {
                  const id = colIds[index];
                  if (!id) throw new Error("A column size is outside the imported table");
                  return [id, size];
                }),
              ),
            },
          })
          .where(eq(tables.id, table.id));
      }
      const filled = block.cells.flatMap((cell) => {
        const identity = layout.identity(cell);
        // A formula column computes its cells, so none are stored for it.
        const kept = cell.input !== "" && columns?.[cell.col]?.type !== "formula";
        return kept && identity
          ? [{ tableId: table.id, ...identity, input: cell.input, updatedBy: ctx.userId }]
          : [];
      });
      for (let from = 0; from < filled.length; from += INSERT_BATCH) {
        await tx.insert(cells).values(filled.slice(from, from + INSERT_BATCH));
      }
    }
  }
  await ctx.resolveChoiceSources(tx, inserted);
}

/**
 * Gives the choice columns of inserted tables the ids of the columns they
 * take their choices from. A file names a source by page, table, and column.
 */
export async function resolveChoiceSources(
  _ctx: RepositoryContext,
  tx: Database,
  inserted: readonly InsertedTable[],
): Promise<void> {
  const find = (page: string, table: string): InsertedTable | undefined =>
    inserted.find(
      (candidate) =>
        candidate.page.toLowerCase() === page.toLowerCase() &&
        candidate.block.name.toLowerCase() === table.toLowerCase(),
    );
  for (const { id, block, columns } of inserted) {
    if (!columns || !block.columns?.some((column) => column.choicesFrom)) continue;
    const resolved = columns.map((column, col) => {
      const from = block.columns?.[col]?.choicesFrom;
      const source = from && find(from.page, from.table);
      const index =
        from && source
          ? (source.block.columns ?? []).findIndex((candidate) =>
              sameColumnName(candidate.name, from.column),
            )
          : -1;
      const colId = source?.colIds[index];
      return source && colId
        ? { name: column.name, type: column.type, choicesFrom: { tableId: source.id, colId } }
        : column;
    });
    await tx.update(tables).set({ columns: resolved }).where(eq(tables.id, id));
  }
}
