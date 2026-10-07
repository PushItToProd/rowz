import {
  conditionalFormatAt,
  formatAt,
  prepareConditionals,
  type CellFormat,
  type CellId,
  type ConditionalRule,
  type FormatPatch,
  type PreparedConditionals,
} from "@spreadsheet-app/engine";
import { type IdentityConditionalRule, type IdentityFormatRange } from "@spreadsheet-app/shared";
import { computed } from "vue";
import { api } from "../../api/client";
import type { ConditionalAction } from "../workbook";
import type { WorkbookContext } from "./context";
const NO_FORMAT: CellFormat = Object.freeze({});

export function createFormats(context: WorkbookContext) {
  /** The conditional rules of the tables that have any, with what applying them needs, for each state of the engine. */
  const preparedConditionals = computed(() => {
    const prepared = new Map<string, PreparedConditionals>();
    const current = context.engine.value;
    for (const table of context.tables.value) {
      if (table.conditionalFormats.length === 0) continue;
      prepared.set(
        table.id,
        prepareConditionals(
          table.conditionalFormats,
          (row, col) => current.getValue({ tableId: table.id, row, col }),
          { rows: table.rowCount, cols: table.colCount },
        ),
      );
    }
    return prepared;
  });

  /** How a cell is shown: the formats its table gives it, with its conditional formats laid over them. */
  function formatOf(id: CellId): CellFormat {
    const rules = context.tables.value.find((table) => table.id === id.tableId)?.formats ?? [];
    const plain = rules.length === 0 ? NO_FORMAT : formatAt(rules, id.row, id.col);
    const prepared = preparedConditionals.value.get(id.tableId);
    if (!prepared) return plain;
    const conditional = conditionalFormatAt(
      prepared,
      id.row,
      id.col,
      context.engine.value.getValue(id),
    );
    if (Object.keys(conditional).length === 0) return plain;
    const merged: Record<string, unknown> = { ...plain };
    for (const [key, value] of Object.entries(conditional)) {
      // A null means a conditional rule cleared this property, so the cell goes back to the default even if a plain rule set it.
      if (value === null) Reflect.deleteProperty(merged, key);
      else merged[key] = value;
    }
    return merged;
  }

  /**
   * Changes how the selected cells are shown. A selection that reaches the
   * last row or column is taken to mean the rest of the table, so rows and
   * columns added later are shown the same way.
   */
  function formatSelection(patch: FormatPatch, reset = false): Promise<boolean> {
    const target = selectedRule("Format");
    if (!target) return Promise.resolve(false);
    return context.attempt(async () => {
      await context.receiveChange(
        await api.formatCells(target.tableId, target.range, patch, reset),
      );
    }, "The format could not be changed");
  }

  /**
   * The range a rule over the selected cells covers, named by id. A selection
   * that reaches the last row or column is taken to mean the rest of the
   * table, so rows and columns added later are covered the same way.
   *
   * A rule covers a run of stored rows. The rows of a sorted or filtered table
   * are not a run, unless the rule is one row or the whole column, so other
   * selections are refused with a notice naming the `action`.
   */
  function selectedRule(
    action: string,
  ): { tableId: string; range: IdentityFormatRange } | undefined {
    const selected = context.selectedRange.value;
    const table = context.tables.value.find(
      (candidate) => candidate.id === context.selection.value?.tableId,
    );
    if (!selected || !table || !context.canEdit.value) return undefined;
    const view = context.rowView(table.id);
    const shown = view.rows.length;
    // With rows hidden, every row shown is not every row of the column.
    const wholeColumn = selected.entireColumn === true;
    const wholeRows = selected.startRow === 0 && selected.endRow >= shown - 1 && view.hidden === 0;
    const wholeCols = selected.startCol === 0 && selected.endCol >= table.colCount - 1;
    if (view.reordered && !wholeRows && !wholeColumn && selected.startRow !== selected.endRow) {
      const hasFilter = table.display.filter !== undefined && table.display.filter !== "";
      const hasSort = table.display.sort.length > 0;
      const clear =
        hasFilter && hasSort ? "the filter and the sort" : hasFilter ? "the filter" : "the sort";
      context.notice.value = {
        kind: "error",
        text: `You can only ${action.toLowerCase()} one row or whole columns while the table is sorted or filtered. Clear ${clear} first.`,
      };
      return undefined;
    }
    const startRow = wholeRows || wholeColumn ? 0 : view.storedRow(selected.startRow);
    const start = context.identityOf({ tableId: table.id, row: startRow, col: selected.startCol });
    const end =
      wholeRows || wholeColumn
        ? undefined
        : context.identityOf({
            tableId: table.id,
            row: view.storedRow(selected.endRow),
            col: selected.endCol,
          });
    const endColId = wholeCols ? null : table.colIds[selected.endCol];
    if (!start || (!wholeRows && !wholeColumn && !end) || endColId === undefined) return undefined;
    return {
      tableId: table.id,
      range: {
        startRowId: start.rowId,
        endRowId: wholeRows || wholeColumn ? null : (end?.rowId ?? null),
        startColId: start.colId,
        endColId,
      },
    };
  }

  /** The conditional formats a table has, as positions. */
  function conditionalFormatsOf(tableId: string): readonly ConditionalRule[] {
    return context.tables.value.find((table) => table.id === tableId)?.conditionalFormats ?? [];
  }

  /** The rules of a table as a request names them, by the ids at the corners of each range. */
  function identityRules(tableId: string): IdentityConditionalRule[] {
    const layout = context.layouts.value.get(tableId);
    if (!layout) return [];
    return conditionalFormatsOf(tableId).flatMap((rule) => {
      const rowId = (row: number | null): string | null | undefined =>
        row === null ? null : layout.rowIds[row];
      const colId = (col: number | null): string | null | undefined =>
        col === null ? null : layout.colIds[col];
      const [startRowId, endRowId] = [layout.rowIds[rule.startRow], rowId(rule.endRow)];
      const [startColId, endColId] = [layout.colIds[rule.startCol], colId(rule.endCol)];
      if (!startRowId || endRowId === undefined || !startColId || endColId === undefined) return [];
      const range = { startRowId, endRowId, startColId, endColId };
      return [
        rule.kind === "criterion"
          ? { range, kind: rule.kind, criterion: rule.criterion, format: rule.format }
          : { range, kind: rule.kind, low: rule.low, high: rule.high },
      ];
    });
  }

  /** Replaces the conditional formats of a table. */
  function setConditionalFormats(
    tableId: string,
    rules: IdentityConditionalRule[],
  ): Promise<boolean> {
    if (!context.canEdit.value) return Promise.resolve(false);
    return context.attempt(async () => {
      await context.receiveChange(await api.setConditionalFormats(tableId, rules));
    }, "The conditional formats could not be saved");
  }

  /** Adds a conditional format over the selected cells, after the ones the table has. */
  function addConditionalFormat(action: ConditionalAction): Promise<boolean> {
    const target = selectedRule("Add a conditional format to");
    if (!target) return Promise.resolve(false);
    return setConditionalFormats(target.tableId, [
      ...identityRules(target.tableId),
      { range: target.range, ...action },
    ]);
  }

  /** Changes what one conditional format of a table does, by its place in the list. It keeps the cells it covers. */
  function editConditionalFormat(
    tableId: string,
    index: number,
    action: ConditionalAction,
  ): Promise<boolean> {
    return setConditionalFormats(
      tableId,
      identityRules(tableId).map((rule, position) =>
        position === index ? { range: rule.range, ...action } : rule,
      ),
    );
  }

  /** Moves one conditional format of a table `by` places in the list. Later rules win, so a positive `by` raises its precedence. */
  function moveConditionalFormat(tableId: string, index: number, by: number): Promise<boolean> {
    const rules = identityRules(tableId);
    const target = index + by;
    const rule = rules[index];
    if (!rule || target < 0 || target >= rules.length) return Promise.resolve(false);
    rules.splice(index, 1);
    rules.splice(target, 0, rule);
    return setConditionalFormats(tableId, rules);
  }

  /** Removes one conditional format of a table, by its place in the list. */
  function removeConditionalFormat(tableId: string, index: number): Promise<boolean> {
    return setConditionalFormats(
      tableId,
      identityRules(tableId).filter((_, position) => position !== index),
    );
  }

  /** Saves pixel sizes for the row or column identities captured by the grid or header menu. */
  function resizeLines(
    tableId: string,
    axis: "row" | "col",
    ids: string[],
    size: number | null,
  ): Promise<boolean> {
    if (!context.canEdit.value) return Promise.resolve(false);
    return context.attempt(async () => {
      await context.receiveChange(await api.resizeLines(tableId, { axis, ids, size }));
    }, "The sizes could not be saved");
  }
  return {
    formatOf,
    formatSelection,
    conditionalFormatsOf,
    addConditionalFormat,
    editConditionalFormat,
    moveConditionalFormat,
    removeConditionalFormat,
    resizeLines,
  };
}
