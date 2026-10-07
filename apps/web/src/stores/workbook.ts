import {
  Workbook,
  type CellAddress,
  type CellId,
  type FormatColor,
  type FormatPatch,
} from "@spreadsheet-app/engine";
import { TableLayout, type IdentifiedCell, type IdentityCellInput } from "@spreadsheet-app/shared";
import { defineStore } from "pinia";
import { computed, reactive, ref, shallowRef, watch } from "vue";
import type { Notice } from "../notice";
import {
  setJournaledHandler,
  type PageRecord,
  type Snapshot,
  type TableRecord,
  type ViewRecord,
} from "../api/client";
import { type StoredRow } from "../formula/fill";
import { createActions } from "./workbook/actions";
import type { WorkbookContext } from "./workbook/context";
import { createFormats } from "./workbook/formats";
import { createQueue } from "./workbook/queue";
import { createSelection } from "./workbook/selection";
import { createStructure } from "./workbook/structure";
import { createSync } from "./workbook/sync";
import { createUndo } from "./workbook/undo";
import { createValues } from "./workbook/values";
import { createWrites } from "./workbook/writes";
import { createSearch } from "./workbook/search";

/** What a conditional format does where it applies, before a range is chosen for it. */
export type ConditionalAction =
  | { kind: "criterion"; criterion: string; format: FormatPatch }
  | { kind: "scale"; low: FormatColor | null; high: FormatColor };

export type { Notice } from "../notice";

/**
 * The rows of a table as it shows them. A sorted or filtered table shows its
 * stored rows in an order of its own, and leaves some out. The stored row
 * order, which cells and formulas name rows by, does not change.
 *
 * A place is a row's position in what is shown. The selection is a stored
 * position, as every reader of it expects, and a range is a rectangle of
 * places.
 */
export interface RowView {
  /** The stored row at each place, filtered rows left out. */
  rows: readonly number[];
  /** Whether the rows are shown in another order or some are hidden. */
  reordered: boolean;
  /** How many stored rows the filter hides. */
  hidden: number;
  /** The first error the filter's formula gave, which the filter bar shows. */
  filterError: string | undefined;
  /** The place a stored row is shown at, or `undefined` when a filter hides it. */
  place: (row: number) => number | undefined;
  /**
   * The stored row at a place. Places past the last row shown are rows the
   * table does not have yet, as a paste that appends writes them, and name the
   * stored rows after the last.
   */
  storedRow: StoredRow;
}

/**
 * The spreadsheet open in the editor.
 *
 * The formula engine runs here in the browser, so a typed value shows up at
 * once. The server stores what was typed, and it alone runs button actions.
 */
export const useWorkbookStore = defineStore("workbook", () => {
  // Getters keep shared dependencies live without changing their initialization order.
  const context: WorkbookContext = {
    get selection() {
      return selection;
    },
    get selectionKind() {
      return selectionKind;
    },
    get tables() {
      return tables;
    },
    get gridFocusRequests() {
      return gridFocusRequests;
    },
    get selectionEnd() {
      return selectionEnd;
    },
    get engine() {
      return engine;
    },
    get setCells() {
      return setCells;
    },
    get selectedRange() {
      return selectedRange;
    },
    get canEdit() {
      return canEdit;
    },
    get writeCells() {
      return writeCells;
    },
    get revision() {
      return revision;
    },
    get attempt() {
      return attempt;
    },
    get receiveChange() {
      return receiveChange;
    },
    get rowView() {
      return rowView;
    },
    get notice() {
      return notice;
    },
    get identityOf() {
      return identityOf;
    },
    get layouts() {
      return layouts;
    },
    get positionOf() {
      return positionOf;
    },
    get cellIdentityKey() {
      return cellIdentityKey;
    },
    get running() {
      return running;
    },
    get saves() {
      return saves;
    },
    set saves(value) {
      saves = value;
    },
    get failedSaves() {
      return failedSaves;
    },
    set failedSaves(value) {
      failedSaves = value;
    },
    get enqueueWrite() {
      return enqueueWrite;
    },
    get stored() {
      return stored;
    },
    get fail() {
      return fail;
    },
    get views() {
      return views;
    },
    get rows() {
      return rows;
    },
    get pendingRows() {
      return pendingRows;
    },
    get inputs() {
      return inputs;
    },
    get unsavedChanges() {
      return unsavedChanges;
    },
    get pages() {
      return pages;
    },
    get spreadsheet() {
      return spreadsheet;
    },
    get undoable() {
      return undoable;
    },
    get redoable() {
      return redoable;
    },
    get rememberOrders() {
      return rememberOrders;
    },
    get showPendingOrders() {
      return showPendingOrders;
    },
    get unanswered() {
      return unanswered;
    },
    get begun() {
      return begun;
    },
    set begun(value) {
      begun = value;
    },
    get optimisticPageOrder() {
      return optimisticPageOrder;
    },
    set optimisticPageOrder(value) {
      optimisticPageOrder = value;
    },
    get acceptedPageOrder() {
      return acceptedPageOrder;
    },
    set acceptedPageOrder(value) {
      acceptedPageOrder = value;
    },
    get showPageOrder() {
      return showPageOrder;
    },
    get optimisticBlockOrders() {
      return optimisticBlockOrders;
    },
    get showOrder() {
      return showOrder;
    },
    get acceptedBlockOrders() {
      return acceptedBlockOrders;
    },
    get inputOf() {
      return inputOf;
    },
    get columnOf() {
      return columnOf;
    },
    get updateColumn() {
      return updateColumn;
    },
    get rejectedDraft() {
      return rejectedDraft;
    },
    get withStableSelection() {
      return withStableSelection;
    },
    get syncStructure() {
      return syncStructure;
    },
    get syncCells() {
      return syncCells;
    },
    get extendSelection() {
      return extendSelection;
    },
    get hasTable() {
      return hasTable;
    },
    get unansweredCount() {
      return unansweredCount;
    },
    get submitFormulaDraft() {
      return submitFormulaDraft;
    },
  };
  const {
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
  } = createSelection(context);
  const {
    formatOf,
    formatSelection,
    conditionalFormatsOf,
    addConditionalFormat,
    editConditionalFormat,
    moveConditionalFormat,
    removeConditionalFormat,
    resizeLines,
  } = createFormats(context);
  const {
    click,
    clickViewButton,
    inputViewControl,
    isViewButtonRunning,
    isViewInputRunning,
    input,
    isRunning,
  } = createActions(context);
  const {
    hasTable,
    identityOf,
    positionOf,
    withStableSelection,
    syncStructure,
    syncCells,
    receiveChange,
    load,
    refresh,
  } = createSync(context);
  const { setIdentifiedCell, submitFormulaDraft, setCell, setCells, writeCells, appendCell } =
    createWrites(context);
  const {
    setTableDisplay,
    setTableNames,
    renameSpreadsheet,
    addPage,
    renamePage,
    blocksOn,
    rememberOrders,
    showPendingOrders,
    showOrder,
    moveBlock,
    showPageOrder,
    movePage,
    moveBlockToPage,
    deletePage,
    addTable,
    updateTable,
    canResizeTableTo,
    resizeTableTo,
    nameColumns,
    dropColumns,
    updateColumn,
    editTable,
    deleteLines,
    addView,
    updateView,
    deleteView,
    deleteTable,
    restoreVersion,
  } = createStructure(context);
  const { undo, redo } = createUndo(context);
  const {
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
  } = createValues(context);
  const { enqueueWrite, stored, fail, attempt } = createQueue(context);
  const { find, replace } = createSearch(context, formatOf);

  const spreadsheet = ref<{ id: string; name: string; role: string } | null>(null);
  const pages = ref<PageRecord[]>([]);
  const tables = ref<TableRecord[]>([]);
  const revision = ref(0);
  type StoredCell = Snapshot["cells"][number];
  const inputs = new Map<string, StoredCell>();
  const rows = new Map<string, Snapshot["rows"][number]>();
  const pendingRows = new Map<string, { tableId: string; ids: string[] }>();
  const cellIdentityKey = (id: IdentifiedCell): string => `${id.tableId}:${id.rowId}:${id.colId}`;
  const rejectedDraft = ref<{ id: IdentifiedCell; input: string; revision: number } | null>(null);

  const layouts = computed(
    () =>
      new Map(
        tables.value.map((table) => [table.id, new TableLayout(table.rows, table.colIds)] as const),
      ),
  );
  /** Charts and text views: the things on a page that are not tables. */
  const views = ref<ViewRecord[]>([]);
  /** The selected cell: the one the keyboard edits and the formula bar shows. */
  const selection = ref<CellId | null>(null);
  /** Whether the selected range came from a row or column header. */
  const selectionKind = ref<"row" | "col" | null>(null);
  /** The far corner of a selected range, when more than one cell is selected. */
  const selectionEnd = ref<CellAddress | null>(null);
  // Selecting another cell selects just that cell.
  watch(
    selection,
    () => {
      selectionEnd.value = null;
      selectionKind.value = null;
    },
    { flush: "sync" },
  );
  watch(
    selection,
    (current, previous) => {
      if (
        current?.tableId !== previous?.tableId ||
        current?.row !== previous?.row ||
        current?.col !== previous?.col
      )
        resetTabTraversal();
    },
    { flush: "sync" },
  );

  /** Counts the requests to put the keyboard in the grid of the selected cell. */
  const gridFocusRequests = ref(0);
  const notice = ref<Notice | null>(null);
  /** Keys of the button cells whose click is in flight. */
  const running = reactive(new Set<string>());

  // The engine is a plain object and Vue cannot see inside it. It sits in a
  // shallow ref that is triggered by hand after every change, so anything
  // that read a value through `engine.value` is recomputed.
  const engine = shallowRef(new Workbook());

  // A filter can hide the row a cell is in, as editing the cell can. The selection goes with it.
  watch(
    rowViews,
    () => {
      const anchor = selection.value;
      if (!anchor) return;
      // A whole-column selection is independent of which rows the current
      // sort and filter happen to put at its ends.
      if (selectionKind.value === "col") return;
      const view = rowView(anchor.tableId);
      if (view.place(anchor.row) === undefined) selection.value = null;
      else if (selectionEnd.value && view.place(selectionEnd.value.row) === undefined) {
        selectionEnd.value = null;
      }
    },
    { flush: "sync" },
  );

  // Saves run one at a time so the server applies edits in the order typed.
  let saves: Promise<void> = Promise.resolve();
  /** How many saves have failed, which `stored` compares across a wait. */
  let failedSaves = 0;
  let acceptedPageOrder: string[] | undefined;
  const acceptedBlockOrders = new Map<string, string[]>();
  const optimisticBlockOrders = new Map<string, string[]>();
  let optimisticPageOrder: string[] | undefined;

  /** The changes, undos, and redos the server has not answered yet. */
  const unanswered = new Set<Promise<unknown>>();
  const unansweredCount = ref(0);
  /** How many changes, undos, and redos have begun, which `refresh` compares across its read. */
  let begun = 0;
  /** Whether a change is still on its way to the server. Leaving the page now would lose it. */
  const saving = computed(() => unansweredCount.value > 0);

  const canEdit = computed(() => spreadsheet.value !== null && spreadsheet.value.role !== "viewer");

  /** Whether the requesting tab has a step it can undo or redo. */
  const undoable = ref(false);
  const redoable = ref(false);
  const canUndo = computed(() => canEdit.value && undoable.value);
  const canRedo = computed(() => canEdit.value && redoable.value);

  setJournaledHandler(() => {
    if (notice.value?.dismissOnHistoryChange) notice.value = null;
    undoable.value = true;
    redoable.value = false;
  });

  type CellChange = IdentityCellInput;
  const unsavedChanges = new Set<{ tableId: string; changes: CellChange[] }>();

  return {
    find,
    replace,
    revision,
    appendCell,
    rejectedDraft,
    receiveChange,
    isRunning,
    isViewButtonRunning,
    isViewInputRunning,
    restoreVersion,
    spreadsheet,
    pages,
    tables,
    views,
    importRows,
    shownRows,
    toFile,
    evaluateOnPage,
    cellReferenceOnPage,
    nameValue,
    setTableNames,
    submitFormulaDraft,
    statementValue,
    assertions,
    errors,
    errorPages,
    errorBlocks,
    documentNames,
    addView,
    updateView,
    deleteView,
    identityOf,
    positionOf,
    setIdentifiedCell,
    selection,
    selectionEnd,
    selectedRange,
    extendSelection,
    gridFocusRequests,
    focusGrid,
    prepareCellMove,
    resetTabTraversal,
    setCells,
    fill,
    clearSelection,
    copySelection,
    paste,
    notice,
    running,
    canEdit,
    load,
    valueOf,
    filledBy,
    inputOf,
    setCell,
    click,
    clickViewButton,
    inputViewControl,
    input,
    renameSpreadsheet,
    addPage,
    renamePage,
    deletePage,
    addTable,
    updateTable,
    canResizeTableTo,
    resizeTableTo,
    editTable,
    deleteLines,
    deleteTable,
    refresh,
    blocksOn,
    moveBlock,
    movePage,
    moveBlockToPage,
    canUndo,
    canRedo,
    saving,
    undo,
    redo,
    columnOf,
    choicesOf,
    formatOf,
    formatSelection,
    setTableDisplay,
    resizeLines,
    rowView,
    conditionalFormatsOf,
    addConditionalFormat,
    editConditionalFormat,
    moveConditionalFormat,
    removeConditionalFormat,
    nameColumns,
    dropColumns,
    updateColumn,
  };
});
