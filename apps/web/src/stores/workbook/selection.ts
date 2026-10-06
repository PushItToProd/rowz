import { displayRows, formatValue, type CellAddress, type CellId } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { computed } from "vue";
import {
  clearWrites,
  fillWrites,
  fromClipboardText,
  inputsOf,
  pasteWrites,
  rangeOf,
  toClipboardText,
  type GridRange,
} from "../../formula/fill";
import type { RowView } from "../workbook";
import type { WorkbookContext } from "./context";

function identityView(rowCount: number): RowView {
  return {
    rows: Array.from({ length: rowCount }, (_, row) => row),
    reordered: false,
    hidden: 0,
    filterError: undefined,
    place: (row) => row,
    storedRow: (place) => place,
  };
}

export function createSelection(context: WorkbookContext) {
  let tabStart: { tableId: string; col: number } | undefined;

  /** What was last copied here, to recognize it when it is pasted back. */
  let copied:
    | { text: string; rows: string[][]; from: CellAddress; sourceRows: readonly number[] }
    | undefined;

  /** The selected cells as a rectangle of places within the selected cell's table. */
  const selectedRange = computed<GridRange | null>(() => {
    const anchor = context.selection.value;
    if (!anchor) return null;
    const view = rowView(anchor.tableId);
    const end = context.selectionEnd.value ?? anchor;
    return rangeOf(
      { row: view.place(anchor.row) ?? anchor.row, col: anchor.col },
      { row: view.place(end.row) ?? end.row, col: end.col },
    );
  });

  /** The tables that show their rows in an order or with some left out, which are the ones worth computing. */
  const rowViews = computed(() => {
    const computedViews = new Map<string, RowView>();
    const current = context.engine.value;
    for (const table of context.tables.value) {
      const { sort, filter } = table.display;
      const filtering = table.columns && filter !== undefined && filter !== "";
      const keys = table.columns ? sort : [];
      if (!filtering && keys.length === 0) continue;
      const filtered = filtering ? current.filterRows(table.id, filter) : undefined;
      const sortColumns = keys.flatMap(({ colId, descending }) => {
        const col = table.colIds.indexOf(colId);
        return col < 0 ? [] : [{ col, descending }];
      });
      const rows = displayRows(
        table.rowCount,
        (row, col) => current.getValue({ tableId: table.id, row, col }),
        sortColumns,
        (row) => filtered?.shown[row] ?? true,
      );
      const places = new Map(rows.map((row, place) => [row, place]));
      computedViews.set(table.id, {
        rows,
        reordered: true,
        hidden: table.rowCount - rows.length,
        // Some errors, such as #DIV/0! from QUOTIENT, carry no message.
        filterError: filtered?.error?.message ?? filtered?.error?.code,
        place: (row) =>
          row >= table.rowCount ? rows.length + row - table.rowCount : places.get(row),
        storedRow: (place) => rows[place] ?? table.rowCount + place - rows.length,
      });
    }
    return computedViews;
  });

  function resetTabTraversal(): void {
    tabStart = undefined;
  }

  /** Pick the destination before saving, since an edit can sort or hide its row. */
  function prepareCellMove(
    key: "Tab" | "Enter" | "ArrowUp" | "ArrowDown",
    backwards = false,
  ): () => void {
    const from = context.selection.value;
    const table = context.tables.value.find((candidate) => candidate.id === from?.tableId);
    if (!from || !table)
      return () => {
        // There is no selected cell to move.
      };
    const view = rowView(table.id);
    const count = view.rows.length + (table.columns && table.rowCount < LIMITS.tableRows ? 1 : 0);
    const place = view.place(from.row) ?? from.row;
    const start = key === "Tab" ? (tabStart ?? { tableId: table.id, col: from.col }) : undefined;
    const nextPlace = Math.max(
      0,
      Math.min(place + (key === "Tab" ? 0 : key === "ArrowUp" ? -1 : 1), count - 1),
    );
    const row = view.storedRow(nextPlace);
    const col = Math.max(
      0,
      Math.min(
        key === "Tab"
          ? from.col + (backwards ? -1 : 1)
          : key === "Enter"
            ? tabStart?.tableId === table.id
              ? tabStart.col
              : from.col
            : from.col,
        table.colCount - 1,
      ),
    );
    return () => {
      const current = rowView(table.id);
      const destination = current.place(row);
      if (destination === undefined && key === "Tab") context.selection.value = null;
      else
        context.selection.value = {
          tableId: table.id,
          row: current.storedRow(destination ?? Math.min(nextPlace, current.rows.length)),
          col,
        };
      tabStart = context.selection.value ? start : undefined;
    };
  }

  /**
   * Puts the keyboard in the grid of the selected cell. Something outside the
   * grid that edits the cell, as the formula bar does, calls this when it is done.
   */
  function focusGrid(): void {
    context.gridFocusRequests.value += 1;
  }

  /** The rows a table shows, and the order it shows them in. */
  function rowView(tableId: string): RowView {
    const view = rowViews.value.get(tableId);
    if (view) return view;
    const table = context.tables.value.find((candidate) => candidate.id === tableId);
    return identityView(table?.rowCount ?? 0);
  }

  /** Makes the selection a range from the selected cell to `address`. */
  function extendSelection(address: CellAddress): void {
    const anchor = context.selection.value;
    if (!anchor) return;
    const single = anchor.row === address.row && anchor.col === address.col;
    context.selectionEnd.value = single ? null : { row: address.row, col: address.col };
  }

  /**
   * Fills `target` with the pattern of the cells in `source`, moving formula
   * references. Both ranges are rectangles of the rows the table shows.
   */
  function fill(
    tableId: string,
    source: GridRange,
    target: GridRange,
    series = false,
  ): Promise<void> {
    const view = rowView(tableId);
    const inputAt = (cell: CellAddress): string =>
      context.engine.value.getInput({ tableId, row: view.storedRow(cell.row), col: cell.col });
    return context.setCells(tableId, fillWrites(source, target, inputAt, series, view.storedRow));
  }

  /** Empties the selected cells. */
  function clearSelection(): Promise<void> {
    const selected = selectedRange.value;
    const tableId = context.selection.value?.tableId;
    if (!selected || tableId === undefined || !context.canEdit.value) return Promise.resolve();
    const view = rowView(tableId);
    return context.setCells(
      tableId,
      clearWrites(
        selected,
        (cell) =>
          context.engine.value.getInput({ tableId, row: view.storedRow(cell.row), col: cell.col }),
        view.storedRow,
      ),
    );
  }

  /**
   * Remembers the selected cells for pasting and returns the text to put on
   * the system clipboard: the values the cells show, which is what another
   * app can use. Pasting that text back here pastes the formulas.
   */
  function copySelection(): string {
    const selected = selectedRange.value;
    const tableId = context.selection.value?.tableId;
    if (!selected || tableId === undefined) return "";
    const view = rowView(tableId);
    const at = (cell: CellAddress): CellId => ({
      tableId,
      row: view.storedRow(cell.row),
      col: cell.col,
    });
    const shown = inputsOf(selected, (cell) =>
      formatValue(context.engine.value.getValue(at(cell))),
    );
    const text = toClipboardText(shown);
    copied = {
      text,
      rows: inputsOf(selected, (cell) => context.engine.value.getInput(at(cell))),
      from: { row: selected.startRow, col: selected.startCol },
      sourceRows: shown.map((_, offset) => view.storedRow(selected.startRow + offset)),
    };
    return text;
  }

  /**
   * Pastes clipboard text with its top-left corner at the selected cell. The
   * table grows to fit, up to its size limit.
   */
  async function paste(text: string): Promise<void> {
    const at = context.selection.value;
    if (!at || !context.canEdit.value) return;
    const view = rowView(at.tableId);
    const place = { row: view.place(at.row) ?? at.row, col: at.col };
    // Text this app put on the clipboard stands for the cells it was copied from.
    const own = copied?.text === text ? copied : undefined;
    const rows = own?.rows ?? fromClipboardText(text);
    const writes = pasteWrites(rows, place, own?.from, {
      storedRow: view.storedRow,
      sourceRows: own?.sourceRows ?? [],
    });
    const width = Math.max(0, ...rows.map((cells) => cells.length));
    const selectTo = view.reordered
      ? { row: view.storedRow(place.row + rows.length - 1), col: place.col + width - 1 }
      : undefined;
    await context.writeCells(at, writes, context.revision.value, true, selectTo);
  }

  /**
   * Puts rows read from a file into a table, with their top-left corner at
   * the table's first cell, and leaves them selected.
   */
  async function importRows(tableId: string, rows: readonly (readonly string[])[]): Promise<void> {
    if (!context.canEdit.value) return;
    const at = { tableId, row: 0, col: 0 };
    context.selection.value = at;
    context.selectionEnd.value = null;
    await context.writeCells(at, pasteWrites(rows, at), context.revision.value, true);
  }
  return {
    resetTabTraversal,
    prepareCellMove,
    focusGrid,
    rowView,
    extendSelection,
    fill,
    clearSelection,
    copySelection,
    paste,
    importRows,
    selectedRange,
    rowViews,
  };
}
