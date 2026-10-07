import {
  documentErrors,
  formatAddress,
  formatValue,
  scriptNames,
  type CellId,
  type CellValue,
  type ColumnDefinition,
  type Evaluated,
} from "@spreadsheet-app/engine";
import { LIMITS, type CellInput, type SpreadsheetFile } from "@spreadsheet-app/shared";
import { computed } from "vue";
import { type TableRecord } from "../../api/client";
import { toSpreadsheetFile } from "../../files/spreadsheetFile";
import type { WorkbookContext } from "./context";

export function createValues(context: WorkbookContext) {
  const errors = computed(() =>
    documentErrors(
      context.engine.value,
      context.tables.value.map((table) => ({ ...table, filter: table.display.filter })),
      context.views.value,
    ),
  );

  const errorPages = computed(() => new Set(errors.value.map((failure) => failure.pageId)));

  const errorBlocks = computed(() => new Set(errors.value.map((failure) => failure.blockId)));

  /** The `ASSERT`s that are false, each with where it is and the page to open to see it. */
  const assertions = computed(() =>
    context.engine.value.failedAssertions().flatMap((failure) => {
      const where = (():
        | {
            pageId: string;
            blockId: string;
            label: string;
            cell?: CellId;
            line?: number;
            name?: string;
            scriptId?: string;
          }
        | undefined => {
        if (failure.kind === "cell") {
          const table = context.tables.value.find(
            (candidate) => candidate.id === failure.cell.tableId,
          );
          return (
            table && {
              pageId: table.pageId,
              blockId: table.id,
              label: `${table.name}!${formatAddress(failure.cell)}`,
              cell: failure.cell,
            }
          );
        }
        const script = context.views.value.find((candidate) => candidate.id === failure.holderId);
        const holder =
          script ?? context.tables.value.find((candidate) => candidate.id === failure.holderId);
        const label =
          failure.kind === "name"
            ? `${holder?.name ?? ""}!${failure.name}`
            : `${holder?.name ?? ""} line ${String(failure.line)}`;
        return holder
          ? {
              pageId: holder.pageId,
              blockId: holder.id,
              label,
              ...(failure.kind === "name"
                ? {
                    name: failure.name,
                    ...(failure.line === undefined ? {} : { line: failure.line }),
                  }
                : { line: failure.line }),
              ...(script ? { scriptId: script.id } : {}),
            }
          : undefined;
      })();
      return where ? [{ ...where, message: failure.message }] : [];
    }),
  );

  /** The names the document's scripts define, with the script that holds each, for completion. */
  const scriptNameList = computed(() =>
    context.views.value
      .filter((view) => view.kind === "script")
      .flatMap((script) =>
        scriptNames(script.id, script.source).map(({ name }) => ({
          name,
          holder: script.name,
          holderId: script.id,
          pageId: script.pageId,
        })),
      ),
  );

  const documentNames = computed(() => [
    ...context.tables.value.flatMap((table) =>
      table.names.map(({ name }) => ({ name, holder: table.name, pageId: table.pageId })),
    ),
    ...scriptNameList.value,
  ]);

  /** The choices of every choice column, read once for each state of the engine rather than once for each cell. */
  const choiceLists = computed(() => {
    const lists = new Map<string, readonly string[]>();
    for (const table of context.tables.value) {
      for (const [col, column] of (table.columns ?? []).entries()) {
        if (column.type !== "choice") continue;
        lists.set(
          `${table.id}:${String(col)}`,
          column.choices ?? sourceChoices(column.choicesFrom),
        );
      }
    }
    return lists;
  });

  /**
   * Evaluates a formula written on a page and not in a cell: a chart's data,
   * or an expression in a text view.
   */
  function evaluateOnPage(
    pageId: string,
    formula: string,
    names?: ReadonlyMap<string, Evaluated>,
  ): Evaluated {
    return context.engine.value.evaluateOnPage(pageId, formula, names);
  }

  /** The stored cell named by a lone positional cell reference in a page formula. */
  function cellReferenceOnPage(pageId: string, formula: string): CellId | undefined {
    return context.engine.value.cellReferenceOnPage(pageId, formula);
  }

  /**
   * The value of a name a table or script holds, or `undefined` when it holds
   * none of that spelling.
   */
  function nameValue(holderId: string, name: string, line?: number): Evaluated | undefined {
    return context.engine.value.getName(holderId, name, line);
  }

  /** A bare formula of a script, by its line: an `ASSERT` has a value, and shows it there. */
  function statementValue(holderId: string, line: number): Evaluated | undefined {
    return context.engine.value.getStatement(holderId, line);
  }

  function valueOf(id: CellId): CellValue {
    return context.engine.value.getValue(id);
  }

  /** The cell whose array formula filled this cell, if one did. */
  function filledBy(id: CellId): CellId | undefined {
    return context.engine.value.spillAnchor(id);
  }

  function inputOf(id: CellId): string {
    return context.engine.value.getInput(id);
  }

  /**
   * The choices a choice column offers: its list, or the distinct non-empty
   * values of the column it takes them from, in stored order. `undefined` for
   * a column that is not a choice column.
   */
  function choicesOf(tableId: string, col: number): readonly string[] | undefined {
    return choiceLists.value.get(`${tableId}:${String(col)}`);
  }

  /** The distinct non-empty values of a source column, up to as many as a list may hold. */
  function sourceChoices(from: ColumnDefinition["choicesFrom"]): readonly string[] {
    const source = from && context.tables.value.find((candidate) => candidate.id === from.tableId);
    const col = from && source ? source.colIds.indexOf(from.colId) : -1;
    if (!source || col < 0) return [];
    const seen = new Set<string>();
    for (let row = 0; row < source.rowCount && seen.size < LIMITS.choices; row += 1) {
      const text = formatValue(context.engine.value.getValue({ tableId: source.id, row, col }));
      if (text !== "") seen.add(text);
    }
    return [...seen];
  }

  /** The column a cell is in, when its table has named columns. */
  function columnOf(id: CellId): ColumnDefinition | undefined {
    return context.engine.value.columnOf(id);
  }

  /** The values of every stored row, as text. */
  function cellTexts(table: TableRecord): string[][] {
    return Array.from({ length: table.rowCount }, (_, row) =>
      Array.from({ length: table.colCount }, (_, col) =>
        formatValue(context.engine.value.getValue({ tableId: table.id, row, col })),
      ),
    );
  }

  /** The values a table shows, row by row. Rows and columns that are empty at the end are left out. */
  function shownRows(table: TableRecord): string[][] {
    const rows = cellTexts(table);
    const lastRow = rows.findLastIndex((cells) => cells.some((cell) => cell !== ""));
    const lastCol = Math.max(
      -1,
      ...rows.map((cells) => cells.findLastIndex((cell) => cell !== "")),
    );
    return rows.slice(0, lastRow + 1).map((cells) => cells.slice(0, lastCol + 1));
  }

  /** The cells of a table that hold something, as typed. */
  function filledCells(table: TableRecord): CellInput[] {
    const filled: CellInput[] = [];
    for (let row = 0; row < table.rowCount; row += 1) {
      for (let col = 0; col < table.colCount; col += 1) {
        // A formula column's cells are computed, and its formula is kept with the column.
        if (table.columns?.[col]?.type === "formula") continue;
        const input = context.engine.value.getInput({ tableId: table.id, row, col });
        if (input !== "") filled.push({ row, col, input });
      }
    }
    return filled;
  }

  /** The spreadsheet as a file that can be imported again. */
  function toFile(): SpreadsheetFile | undefined {
    if (!context.spreadsheet.value) return undefined;
    return toSpreadsheetFile(
      context.spreadsheet.value.name,
      context.pages.value,
      context.tables.value,
      context.views.value,
      filledCells,
    );
  }
  return {
    evaluateOnPage,
    cellReferenceOnPage,
    nameValue,
    statementValue,
    valueOf,
    filledBy,
    inputOf,
    choicesOf,
    columnOf,
    shownRows,
    toFile,
    errors,
    errorPages,
    errorBlocks,
    assertions,
    documentNames,
  };
}
