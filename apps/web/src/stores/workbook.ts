import {
  createWorkbook,
  documentErrors,
  conditionalFormatAt,
  displayRows,
  prepareConditionals,
  type PreparedConditionals,
  formatAddress,
  formatDate,
  formatAt,
  formatValue,
  isFormulaInput,
  isDate,
  scriptNames,
  Workbook,
  type CellAddress,
  type CellId,
  type CellFormat,
  type CellValue,
  type ChartType,
  type ColumnDefinition,
  type ColumnType,
  type ConditionalRule,
  type Evaluated,
  type FormatColor,
  type FormatPatch,
  type Scalar,
  type SortKey,
  type TableName,
} from "@spreadsheet-app/engine";
import {
  LIMITS,
  keyBetween,
  TableLayout,
  type IdentifiedCell,
  type IdentityCellInput,
  type IdentifiedStructuralEditBody,
  type IdentityConditionalRule,
  type IdentityFormatRange,
  type CellInput,
  type SpreadsheetFile,
  type StructuralEditBody,
} from "@spreadsheet-app/shared";
import { defineStore } from "pinia";
import { useFormulaSessionStore, type EditingTarget } from "../formula/session";
import { toSpreadsheetFile } from "../files/spreadsheetFile";
import { computed, reactive, ref, shallowRef, watch } from "vue";
import {
  setJournaledHandler,
  api,
  type ClickResult,
  type PageRecord,
  type Change,
  type ChangedContent,
  type Snapshot,
  type TableRecord,
  type ViewRecord,
} from "../api/client";
import {
  rangeOf,
  clearWrites,
  fillWrites,
  fromClipboardText,
  inputsOf,
  pasteWrites,
  toClipboardText,
  type GridRange,
  type StoredRow,
} from "../formula/fill";

/** What a conditional format does where it applies, before a range is chosen for it. */
export type ConditionalAction =
  | { kind: "criterion"; criterion: string; format: FormatPatch }
  | { kind: "scale"; low: FormatColor | null; high: FormatColor };

export interface Notice {
  kind: "success" | "error";
  text: string;
}

/** A notice names the cells an action wrote, up to this many. Past that it gives the count. */
const MAX_NAMED_CELLS = 3;
/** The format of every cell that has none. One object, so a cell that renders it sees no change. */
const NO_FORMAT: CellFormat = Object.freeze({});

function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}

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

/**
 * The spreadsheet open in the editor.
 *
 * The formula engine runs here in the browser, so a typed value shows up at
 * once. The server stores what was typed, and it alone runs button actions.
 */
export const useWorkbookStore = defineStore("workbook", () => {
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
  /** The far corner of a selected range, when more than one cell is selected. */
  const selectionEnd = ref<CellAddress | null>(null);
  // Selecting another cell selects just that cell.
  watch(selection, () => (selectionEnd.value = null), { flush: "sync" });
  /** The selected cells as a rectangle of places within the selected cell's table. */
  const selectedRange = computed<GridRange | null>(() => {
    const anchor = selection.value;
    if (!anchor) return null;
    const view = rowView(anchor.tableId);
    const end = selectionEnd.value ?? anchor;
    return rangeOf(
      { row: view.place(anchor.row) ?? anchor.row, col: anchor.col },
      { row: view.place(end.row) ?? end.row, col: end.col },
    );
  });
  let tabStart: { tableId: string; col: number } | undefined;
  function resetTabTraversal(): void {
    tabStart = undefined;
  }
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

  /** Pick the destination before saving, since an edit can sort or hide its row. */
  function prepareCellMove(
    key: "Tab" | "Enter" | "ArrowUp" | "ArrowDown",
    backwards = false,
  ): () => void {
    const from = selection.value;
    const table = tables.value.find((candidate) => candidate.id === from?.tableId);
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
      if (destination === undefined && key === "Tab") selection.value = null;
      else
        selection.value = {
          tableId: table.id,
          row: current.storedRow(destination ?? Math.min(nextPlace, current.rows.length)),
          col,
        };
      tabStart = selection.value ? start : undefined;
    };
  }

  /** Counts the requests to put the keyboard in the grid of the selected cell. */
  const gridFocusRequests = ref(0);
  /**
   * Puts the keyboard in the grid of the selected cell. Something outside the
   * grid that edits the cell, as the formula bar does, calls this when it is done.
   */
  function focusGrid(): void {
    gridFocusRequests.value += 1;
  }
  /** What was last copied here, to recognize it when it is pasted back. */
  let copied:
    | { text: string; rows: string[][]; from: CellAddress; sourceRows: readonly number[] }
    | undefined;
  const notice = ref<Notice | null>(null);
  /** Keys of the button cells whose click is in flight. */
  const running = reactive(new Set<string>());

  // The engine is a plain object and Vue cannot see inside it. It sits in a
  // shallow ref that is triggered by hand after every change, so anything
  // that read a value through `engine.value` is recomputed.
  const engine = shallowRef(new Workbook());

  /** The tables that show their rows in an order or with some left out, which are the ones worth computing. */
  const rowViews = computed(() => {
    const computedViews = new Map<string, RowView>();
    const current = engine.value;
    for (const table of tables.value) {
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

  /** The rows a table shows, and the order it shows them in. */
  function rowView(tableId: string): RowView {
    const view = rowViews.value.get(tableId);
    if (view) return view;
    const table = tables.value.find((candidate) => candidate.id === tableId);
    return identityView(table?.rowCount ?? 0);
  }

  // A filter can hide the row a cell is in, as editing the cell can. The selection goes with it.
  watch(
    rowViews,
    () => {
      const anchor = selection.value;
      if (!anchor) return;
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

  /** Every content mutation, including undo and redo, enters this queue immediately. */
  let mutations: Promise<unknown> = Promise.resolve();
  let acceptedPageOrder: string[] | undefined;
  const acceptedBlockOrders = new Map<string, string[]>();
  const pendingPageReorders = new Map<string, number>();
  const pendingBlockReorders = new Map<string, number>();
  const optimisticBlockOrders = new Map<string, string[]>();
  let optimisticPageOrder: string[] | undefined;
  const viewUpdates = new Map<string, Promise<boolean>>();

  /** The changes, undos, and redos the server has not answered yet. */
  const unanswered = new Set<Promise<unknown>>();
  const unansweredCount = ref(0);
  /** How many changes, undos, and redos have begun, which `refresh` compares across its read. */
  let begun = 0;
  /** Whether a change is still on its way to the server. Leaving the page now would lose it. */
  const saving = computed(() => unansweredCount.value > 0);

  /** Counts a request toward `saving` until it settles. */
  function countUnanswered<T>(request: Promise<T>): Promise<T> {
    begun += 1;
    unanswered.add(request);
    unansweredCount.value = unanswered.size;
    const settled = (): void => {
      unanswered.delete(request);
      unansweredCount.value = unanswered.size;
    };
    void request.then(settled, settled);
    return request;
  }

  function enqueueWrite<T>(change: () => Promise<T>, draftWrite = false): Promise<T> {
    const sessions = useFormulaSessionStore();
    if (!draftWrite && sessions.active) {
      return sessions.submit(submitFormulaDraft).then((saved) => {
        if (!saved) {
          sessions.focus();
          throw new Error(sessions.active?.error ?? "The draft could not be saved");
        }
        return enqueueWrite(change, true);
      });
    }
    const queued = mutations.then(change);
    mutations = queued.catch(() => undefined);
    return countUnanswered(queued);
  }

  /** Waits for the edits made so far to be saved. Resolves to whether every one of them was. */
  async function stored(queue: Promise<void> = saves, before = failedSaves): Promise<boolean> {
    await queue;
    return failedSaves === before;
  }

  // The server answers reads in any order. Each read takes a number, and one
  // that ends after a later read began is dropped, so the editor ends on the
  // newest. A refresh is also dropped when a load began after it did.
  let loads = 0;
  let refreshes = 0;

  const canEdit = computed(() => spreadsheet.value !== null && spreadsheet.value.role !== "viewer");

  function fail(cause: unknown, fallback: string): void {
    notice.value = { kind: "error", text: messageOf(cause, fallback) };
  }

  function hasTable(tableId: string): boolean {
    return tables.value.some((table) => table.id === tableId);
  }

  function identityOf(id: CellId): IdentifiedCell | undefined {
    const table = tables.value.find((candidate) => candidate.id === id.tableId);
    if (!table?.rows) return undefined;
    const identity = layouts.value.get(id.tableId)?.identity(id);
    return identity && { tableId: table.id, ...identity };
  }

  function positionOf(id: IdentifiedCell): CellId | undefined {
    const table = tables.value.find((candidate) => candidate.id === id.tableId);
    if (!table?.rows) return undefined;
    const position = layouts.value.get(id.tableId)?.position(id);
    return position && position.row < table.rowCount && position.col < table.colCount
      ? { tableId: table.id, ...position }
      : undefined;
  }

  function withStableSelection(change: () => void): void {
    const anchor = selection.value && identityOf(selection.value);
    const end =
      selection.value &&
      selectionEnd.value &&
      identityOf({ tableId: selection.value.tableId, ...selectionEnd.value });
    change();
    if (anchor) {
      selection.value = positionOf(anchor) ?? null;
      selectionEnd.value = selection.value && end ? (positionOf(end) ?? null) : null;
    }
  }

  async function setIdentifiedCell(
    id: IdentifiedCell,
    input: string,
    writtenAt = revision.value,
  ): Promise<void> {
    const position = positionOf(id);
    if (!position) {
      notice.value = {
        kind: "error",
        text: "The row or column being edited was deleted. Your text was not saved.",
      };
      return;
    }
    await setCell(position, input, writtenAt);
  }

  /** Rebuild positions from identities, then overlay edits whose requests have not settled. */
  function syncStructure(): void {
    tables.value = tables.value.map((table) => {
      const ordered = [...rows.values()]
        .filter((row) => row.tableId === table.id)
        .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
      const present = new Set(ordered.map((row) => row.id));
      for (const pending of pendingRows.values()) {
        if (pending.tableId !== table.id) continue;
        for (const id of pending.ids) {
          if (!present.has(id)) {
            ordered.push({
              id,
              tableId: table.id,
              orderKey: keyBetween(ordered.at(-1)?.orderKey ?? null, null),
            });
            present.add(id);
          }
        }
      }
      return {
        ...table,
        rows: ordered.map(({ id, orderKey }) => ({ id, orderKey })),
        rowCount: ordered.length,
        colCount: table.colIds.length,
      };
    });
    const visible = new Map(inputs);
    for (const { tableId, changes } of unsavedChanges) {
      for (const change of changes) {
        const cell = { tableId, ...change };
        visible.set(cellIdentityKey(cell), cell);
      }
    }
    const cells = [...visible.values()].flatMap((cell) => {
      const position = positionOf(cell);
      return position ? [{ ...position, input: cell.input }] : [];
    });
    engine.value = createWorkbook({
      pages: pages.value,
      tables: tables.value,
      scripts: views.value.filter((view) => view.kind === "script"),
      names: tables.value.flatMap((table) =>
        table.names.map(({ name, formula }) => ({ holderId: table.id, name, formula })),
      ),
      cells,
    });
  }

  function installSnapshot(snapshot: Snapshot): void {
    revision.value = snapshot.revision;
    inputs.clear();
    for (const cell of snapshot.cells) inputs.set(cellIdentityKey(cell), cell);
    rows.clear();
    for (const row of snapshot.rows) rows.set(`${row.tableId}:${row.id}`, row);
    spreadsheet.value = { id: snapshot.id, name: snapshot.name, role: snapshot.role };
    pages.value = snapshot.pages;
    tables.value = snapshot.tables.map((table) => ({
      ...table,
      rows: [],
      rowCount: 0,
      colCount: table.colIds.length,
    }));
    views.value = snapshot.views;
    undoable.value = snapshot.undoable;
    redoable.value = snapshot.redoable;
    syncStructure();
    rememberOrders();
    showPendingOrders();
  }

  /** Responses and events share this path. A missing revision requires a fresh snapshot. */
  async function receiveChange(change: Change): Promise<void> {
    if (change.revision <= revision.value) return;
    if (change.revision !== revision.value + 1 || change.changed === null) {
      await refresh();
      return;
    }
    const content = change.changed;
    withStableSelection(() => {
      applyChanged(content);
      revision.value = change.revision;
    });
  }

  /** Whether the requesting tab has a step it can undo or redo. */
  const undoable = ref(false);
  const redoable = ref(false);
  const canUndo = computed(() => canEdit.value && undoable.value);
  const canRedo = computed(() => canEdit.value && redoable.value);

  setJournaledHandler(() => {
    undoable.value = true;
    redoable.value = false;
  });

  /**
   * Reads a spreadsheet to show in place of what the editor holds. It gives
   * the snapshot at a moment when no change, undo, or redo made here is
   * unanswered, or `undefined` once `wanted` says the read is out of date.
   *
   * The answer to a change is applied to whatever the editor holds when it
   * arrives. Replacing the editor's contents only when none is on its way
   * keeps the answer to a change made in one spreadsheet out of the next one
   * opened, and keeps a snapshot read before a change from hiding it.
   */
  async function readSettled(
    spreadsheetId: string,
    wanted: () => boolean,
  ): Promise<Snapshot | undefined> {
    for (;;) {
      // What was changed here is answered first, so that what comes back includes it.
      while (unanswered.size > 0) await Promise.allSettled(unanswered);
      const before = begun;
      const snapshot = await api.getSnapshot(spreadsheetId);
      if (!wanted()) return undefined;
      // Something was changed, undone, or redone here while the spreadsheet was
      // being read, and its result may be newer than what was read: read again.
      if (begun === before) return snapshot;
    }
  }

  async function load(spreadsheetId: string): Promise<void> {
    const turn = ++loads;
    const snapshot = await readSettled(spreadsheetId, () => turn === loads).catch(
      (cause: unknown) => {
        // A spreadsheet the editor has moved on from is not one to report on.
        if (turn === loads) throw cause;
        return undefined;
      },
    );
    if (!snapshot) return;
    installSnapshot(snapshot);
    selection.value = null;
    notice.value = null;
  }

  /**
   * Reads the spreadsheet again after someone else changed it, and keeps the
   * selection where it still exists, and refreshes this tab's undo state.
   */
  async function refresh(): Promise<void> {
    const open = spreadsheet.value;
    if (!open) return;
    const [turn, loaded] = [++refreshes, loads];
    const snapshot = await api.getSnapshot(open.id);
    if (
      turn !== refreshes ||
      loaded !== loads ||
      spreadsheet.value?.id !== open.id ||
      snapshot.revision < revision.value
    )
      return;

    const anchored = selection.value && identityOf(selection.value);
    const end =
      selection.value &&
      selectionEnd.value &&
      identityOf({ tableId: selection.value.tableId, ...selectionEnd.value });
    installSnapshot(snapshot);

    const selected = anchored && positionOf(anchored);
    selection.value = selected ?? null;
    selectionEnd.value = selected && end ? (positionOf(end) ?? null) : null;
  }

  /**
   * Evaluates a formula written on a page and not in a cell: a chart's data,
   * or an expression in a text view.
   */
  function evaluateOnPage(
    pageId: string,
    formula: string,
    names?: ReadonlyMap<string, Evaluated>,
  ): Evaluated {
    return engine.value.evaluateOnPage(pageId, formula, names);
  }

  /**
   * The value of a name a table or script holds, or `undefined` when it holds
   * none of that spelling.
   */
  function nameValue(holderId: string, name: string): Evaluated | undefined {
    return engine.value.getName(holderId, name);
  }

  /** A bare formula of a script, by its line: an `ASSERT` has a value, and shows it there. */
  function statementValue(holderId: string, line: number): Evaluated | undefined {
    return engine.value.getStatement(holderId, line);
  }

  const errors = computed(() =>
    documentErrors(
      engine.value,
      tables.value.map((table) => ({ ...table, filter: table.display.filter })),
      views.value,
    ),
  );
  const errorPages = computed(() => new Set(errors.value.map((failure) => failure.pageId)));
  const errorBlocks = computed(() => new Set(errors.value.map((failure) => failure.blockId)));

  /** The `ASSERT`s that are false, each with where it is and the page to open to see it. */
  const assertions = computed(() =>
    engine.value.failedAssertions().flatMap((failure) => {
      const where = (():
        { pageId: string; label: string; cell?: CellId; scriptId?: string } | undefined => {
        if (failure.kind === "cell") {
          const table = tables.value.find((candidate) => candidate.id === failure.cell.tableId);
          return (
            table && {
              pageId: table.pageId,
              label: `${table.name}!${formatAddress(failure.cell)}`,
              cell: failure.cell,
            }
          );
        }
        const script = views.value.find((candidate) => candidate.id === failure.holderId);
        const holder =
          script ?? tables.value.find((candidate) => candidate.id === failure.holderId);
        const label =
          failure.kind === "name"
            ? `${holder?.name ?? ""}!${failure.name}`
            : `${holder?.name ?? ""} line ${String(failure.line)}`;
        return (
          holder && { pageId: holder.pageId, label, ...(script ? { scriptId: script.id } : {}) }
        );
      })();
      return where ? [{ ...where, message: failure.message }] : [];
    }),
  );

  /** The names the document's scripts define, with the script that holds each, for completion. */
  const scriptNameList = computed(() =>
    views.value
      .filter((view) => view.kind === "script")
      .flatMap((script) =>
        scriptNames(script.id, script.source).map(({ name }) => ({
          name,
          holder: script.name,
          pageId: script.pageId,
        })),
      ),
  );

  const documentNames = computed(() => [
    ...tables.value.flatMap((table) =>
      table.names.map(({ name }) => ({ name, holder: table.name, pageId: table.pageId })),
    ),
    ...scriptNameList.value,
  ]);

  /** Applies the content the server restored, then keeps or moves the selection. */
  function applyChanged(changed: ChangedContent): void {
    // Start from confirmed positions before merging an earlier reorder response.
    if (optimisticPageOrder && acceptedPageOrder) showPageOrder(acceptedPageOrder);
    for (const pageId of optimisticBlockOrders.keys())
      showOrder(acceptedBlockOrders.get(pageId) ?? []);
    const pageRecords = new Map(changed.pages.map(({ id, page }) => [id, page]));
    pages.value = [
      ...pages.value.filter((page) => !pageRecords.has(page.id)),
      ...[...pageRecords.values()].filter((page): page is PageRecord => page !== null),
    ].sort((left, right) => left.position - right.position);

    const tableRecords = new Map(changed.tables.map(({ id, table }) => [id, table]));
    tables.value = [
      ...tables.value.filter((table) => !tableRecords.has(table.id)),
      ...[...tableRecords.values()].flatMap((table) =>
        table ? [{ ...table, rows: [], rowCount: 0, colCount: table.colIds.length }] : [],
      ),
    ].sort(
      (left, right) => left.pageId.localeCompare(right.pageId) || left.position - right.position,
    );

    const viewRecords = new Map(changed.views.map(({ id, view }) => [id, view]));
    views.value = [
      ...views.value.filter((view) => !viewRecords.has(view.id)),
      ...[...viewRecords.values()].filter((view): view is ViewRecord => view !== null),
    ].sort(
      (left, right) => left.pageId.localeCompare(right.pageId) || left.position - right.position,
    );

    for (const row of changed.rows) {
      if (row.orderKey === null) rows.delete(`${row.tableId}:${row.id}`);
      else rows.set(`${row.tableId}:${row.id}`, { ...row, orderKey: row.orderKey });
    }
    for (const cell of changed.cells) {
      if (cell.input === "") inputs.delete(cellIdentityKey(cell));
      else inputs.set(cellIdentityKey(cell), cell);
    }
    for (const [key, cell] of inputs) {
      const table = tables.value.find((table) => table.id === cell.tableId);
      if (!rows.has(`${cell.tableId}:${cell.rowId}`) || !table?.colIds.includes(cell.colId))
        inputs.delete(key);
    }
    syncStructure();

    rememberOrders();
    showPendingOrders();
  }

  async function runHistory(direction: "undo" | "redo"): Promise<void> {
    const current = spreadsheet.value;
    if (!current || !canEdit.value) return;
    if (!(direction === "undo" ? undoable.value : redoable.value)) return;
    try {
      const result = await (direction === "undo" ? api.undo(current.id) : api.redo(current.id));
      // The answer is about the spreadsheet that was open when it was asked for.
      if (spreadsheet.value?.id !== current.id) return;
      undoable.value = result.undoable;
      redoable.value = result.redoable;
      if (result.outcome === "done") {
        if (result.change) await receiveChange(result.change);
        if (
          result.change?.changed &&
          (result.change.changed.pages.length > 0 ||
            result.change.changed.tables.length > 0 ||
            result.change.changed.views.length > 0)
        ) {
          notice.value = {
            kind: "success",
            text: `${direction === "undo" ? "Undid" : "Redid"}: ${result.label ?? "change"}`,
          };
        }
      } else if (result.outcome === "refused") {
        notice.value = { kind: "error", text: result.error ?? "This change cannot be restored" };
      }
    } catch (cause) {
      if (spreadsheet.value?.id !== current.id) return;
      fail(
        cause,
        direction === "undo" ? "The change could not be undone" : "The change could not be redone",
      );
    }
  }

  function undo(): Promise<void> {
    return enqueueWrite(() => runHistory("undo"));
  }

  function redo(): Promise<void> {
    return enqueueWrite(() => runHistory("redo"));
  }

  function valueOf(id: CellId): CellValue {
    return engine.value.getValue(id);
  }

  /** The cell whose array formula filled this cell, if one did. */
  function filledBy(id: CellId): CellId | undefined {
    return engine.value.spillAnchor(id);
  }

  function inputOf(id: CellId): string {
    return engine.value.getInput(id);
  }

  /** The conditional rules of the tables that have any, with what applying them needs, for each state of the engine. */
  const preparedConditionals = computed(() => {
    const prepared = new Map<string, PreparedConditionals>();
    const current = engine.value;
    for (const table of tables.value) {
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
    const rules = tables.value.find((table) => table.id === id.tableId)?.formats ?? [];
    const plain = rules.length === 0 ? NO_FORMAT : formatAt(rules, id.row, id.col);
    const prepared = preparedConditionals.value.get(id.tableId);
    if (!prepared) return plain;
    const conditional = conditionalFormatAt(prepared, id.row, id.col, engine.value.getValue(id));
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
    return attempt(async () => {
      await receiveChange(await api.formatCells(target.tableId, target.range, patch, reset));
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
    const selected = selectedRange.value;
    const table = tables.value.find((candidate) => candidate.id === selection.value?.tableId);
    if (!selected || !table || !canEdit.value) return undefined;
    const view = rowView(table.id);
    const shown = view.rows.length;
    // With rows hidden, every row shown is not every row of the column.
    const wholeRows = selected.startRow === 0 && selected.endRow >= shown - 1 && view.hidden === 0;
    const wholeCols = selected.startCol === 0 && selected.endCol >= table.colCount - 1;
    if (view.reordered && !wholeRows && selected.startRow !== selected.endRow) {
      const hasFilter = table.display.filter !== undefined && table.display.filter !== "";
      const hasSort = table.display.sort.length > 0;
      const clear =
        hasFilter && hasSort ? "the filter and the sort" : hasFilter ? "the filter" : "the sort";
      notice.value = {
        kind: "error",
        text: `You can only ${action.toLowerCase()} one row or whole columns while the table is sorted or filtered. Clear ${clear} first.`,
      };
      return undefined;
    }
    const startRow = wholeRows ? 0 : view.storedRow(selected.startRow);
    const endRow = view.storedRow(selected.endRow);
    const start = identityOf({ tableId: table.id, row: startRow, col: selected.startCol });
    const end = identityOf({ tableId: table.id, row: endRow, col: selected.endCol });
    if (!start || !end) return undefined;
    return {
      tableId: table.id,
      range: {
        startRowId: start.rowId,
        endRowId: wholeRows ? null : end.rowId,
        startColId: start.colId,
        endColId: wholeCols ? null : end.colId,
      },
    };
  }

  /** The conditional formats a table has, as positions. */
  function conditionalFormatsOf(tableId: string): readonly ConditionalRule[] {
    return tables.value.find((table) => table.id === tableId)?.conditionalFormats ?? [];
  }

  /** The rules of a table as a request names them, by the ids at the corners of each range. */
  function identityRules(tableId: string): IdentityConditionalRule[] {
    const layout = layouts.value.get(tableId);
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
    if (!canEdit.value) return Promise.resolve(false);
    return attempt(async () => {
      await receiveChange(await api.setConditionalFormats(tableId, rules));
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
    if (!canEdit.value) return Promise.resolve(false);
    return attempt(async () => {
      await receiveChange(await api.resizeLines(tableId, { axis, ids, size }));
    }, "The sizes could not be saved");
  }

  /**
   * Replaces how a data table's rows are shown. The sort and filter are
   * display settings, and the stored rows stay as they are.
   */
  function setTableDisplay(
    tableId: string,
    display: { sort: SortKey[]; filter?: string },
    writtenAt = revision.value,
  ): Promise<boolean> {
    if (!canEdit.value) return Promise.resolve(false);
    return attempt(async () => {
      await receiveChange(await api.setTableDisplay(tableId, display, writtenAt));
    }, "The sort and filter could not be saved");
  }

  /** Replaces the names a plain table holds. */
  function setTableNames(tableId: string, names: TableName[]): Promise<boolean> {
    if (!canEdit.value) return Promise.resolve(false);
    return attempt(async () => {
      await receiveChange(await api.setTableNames(tableId, names));
    }, "The names could not be saved");
  }

  /** Saves exact draft text to its current target, without a starting-revision restriction. */
  function submitFormulaDraft(target: EditingTarget, text: string): Promise<"saved" | "deleted"> {
    return enqueueWrite(async () => {
      if (!canEdit.value) throw new Error("You cannot edit this spreadsheet");
      const table =
        "tableId" in target ? tables.value.find((item) => item.id === target.tableId) : undefined;
      if ("tableId" in target && !table) return "deleted";
      try {
        let change: Change;
        switch (target.kind) {
          case "cell":
            if (!positionOf(target)) return "deleted";
            change = await api.setCells(target.tableId, [
              { rowId: target.rowId, colId: target.colId, input: text },
            ]);
            break;
          case "column":
            if (!table?.colIds.includes(target.colId)) return "deleted";
            change = await api.updateColumn(target.tableId, target.colId, { formula: text });
            break;
          case "name": {
            change = await api.updateNamedFormula(target.tableId, target.name, text);
            break;
          }
          case "filter":
            if (!table) return "deleted";
            change = await api.setTableDisplay(target.tableId, { ...table.display, filter: text });
            break;
          case "chart":
            {
              const view = views.value.find((item) => item.id === target.viewId);
              if (!view) return "deleted";
              if (text === view.source) return "saved";
            }
            change = await api.updateView(target.viewId, { source: text });
            break;
        }
        await receiveChange(change);
        return "saved";
      } catch (cause) {
        if (
          cause instanceof Error &&
          "code" in cause &&
          ["not_found", "row_deleted", "column_deleted"].includes(String(cause.code))
        )
          return "deleted";
        throw cause;
      }
    }, true);
  }

  /**
   * The choices a choice column offers: its list, or the distinct non-empty
   * values of the column it takes them from, in stored order. `undefined` for
   * a column that is not a choice column.
   */
  function choicesOf(tableId: string, col: number): readonly string[] | undefined {
    return choiceLists.value.get(`${tableId}:${String(col)}`);
  }

  /** The choices of every choice column, read once for each state of the engine rather than once for each cell. */
  const choiceLists = computed(() => {
    const lists = new Map<string, readonly string[]>();
    for (const table of tables.value) {
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

  /** The distinct non-empty values of a source column, up to as many as a list may hold. */
  function sourceChoices(from: ColumnDefinition["choicesFrom"]): readonly string[] {
    const source = from && tables.value.find((candidate) => candidate.id === from.tableId);
    const col = from && source ? source.colIds.indexOf(from.colId) : -1;
    if (!source || col < 0) return [];
    const seen = new Set<string>();
    for (let row = 0; row < source.rowCount && seen.size < LIMITS.choices; row += 1) {
      const text = formatValue(engine.value.getValue({ tableId: source.id, row, col }));
      if (text !== "") seen.add(text);
    }
    return [...seen];
  }

  /** The column a cell is in, when its table has named columns. */
  function columnOf(id: CellId): ColumnDefinition | undefined {
    return engine.value.columnOf(id);
  }

  /**
   * Shows the new input at once and saves it. A failed save puts the old
   * input back. What is typed into a cell of a formula column becomes the
   * formula of the whole column.
   */
  async function setCell(id: CellId, input: string, writtenAt = revision.value): Promise<void> {
    if (columnOf(id)?.type !== "formula") {
      return writeCells(id, [{ row: id.row, col: id.col, input }], writtenAt);
    }
    if (input.trim() === "" || input === engine.value.getInput(id)) return;
    if (!isFormulaInput(input)) {
      // A stray keystroke must not replace the formula of a whole column.
      const name = columnOf(id)?.name ?? "This";
      notice.value = {
        kind: "error",
        text: `${name} is a formula column. Type a formula starting with = to change it for every row`,
      };
      return;
    }
    const identity = identityOf(id);
    if (!(await updateColumn(id.tableId, id.col, { formula: input }, writtenAt)) && identity) {
      rejectedDraft.value = { id: identity, input, revision: writtenAt };
    }
  }

  type CellChange = IdentityCellInput;
  const unsavedChanges = new Set<{ tableId: string; changes: CellChange[] }>();

  function showInputs(tableId: string, writes: readonly CellInput[]): CellChange[] {
    return writes
      .filter((write) => columnOf({ tableId, ...write })?.type !== "formula")
      .flatMap((write) => {
        const identity = identityOf({ tableId, ...write });
        if (!identity) throw new Error("The row or column being edited no longer exists");
        return engine.value.getInput({ tableId, ...write }) === write.input
          ? []
          : [{ rowId: identity.rowId, colId: identity.colId, input: write.input }];
      });
  }

  function setCells(tableId: string, writes: readonly CellInput[]): Promise<void> {
    return writeCells({ tableId, row: 0, col: 0 }, writes);
  }

  async function saveCellChanges(
    pending: { tableId: string; changes: CellChange[] },
    stepId: string,
    writtenAt: number,
    appendRows: string[],
  ): Promise<void> {
    try {
      do {
        const batch = pending.changes.slice(0, LIMITS.cellsPerRequest);
        const change = await api.setCells(pending.tableId, batch, stepId, writtenAt, appendRows);
        pending.changes.splice(0, batch.length);
        await receiveChange(change);
        appendRows = [];
      } while (pending.changes.length > 0);
    } catch (cause) {
      failedSaves += 1;
      fail(cause, "The change could not be saved");
    } finally {
      unsavedChanges.delete(pending);
      pendingRows.delete(stepId);
      withStableSelection(syncStructure);
    }
  }

  /** Makes the selection a range from the selected cell to `address`. */
  function extendSelection(address: CellAddress): void {
    const anchor = selection.value;
    if (!anchor) return;
    const single = anchor.row === address.row && anchor.col === address.col;
    selectionEnd.value = single ? null : { row: address.row, col: address.col };
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
      engine.value.getInput({ tableId, row: view.storedRow(cell.row), col: cell.col });
    return setCells(tableId, fillWrites(source, target, inputAt, series, view.storedRow));
  }

  /** Empties the selected cells. */
  function clearSelection(): Promise<void> {
    const selected = selectedRange.value;
    const tableId = selection.value?.tableId;
    if (!selected || tableId === undefined || !canEdit.value) return Promise.resolve();
    const view = rowView(tableId);
    return setCells(
      tableId,
      clearWrites(
        selected,
        (cell) => engine.value.getInput({ tableId, row: view.storedRow(cell.row), col: cell.col }),
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
    const tableId = selection.value?.tableId;
    if (!selected || tableId === undefined) return "";
    const view = rowView(tableId);
    const at = (cell: CellAddress): CellId => ({
      tableId,
      row: view.storedRow(cell.row),
      col: cell.col,
    });
    const shown = inputsOf(selected, (cell) => formatValue(engine.value.getValue(at(cell))));
    const text = toClipboardText(shown);
    copied = {
      text,
      rows: inputsOf(selected, (cell) => engine.value.getInput(at(cell))),
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
    const at = selection.value;
    if (!at || !canEdit.value) return;
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
    await writeCells(at, writes, revision.value, true, selectTo);
  }

  /**
   * Puts rows read from a file into a table, with their top-left corner at
   * the table's first cell, and leaves them selected.
   */
  async function importRows(tableId: string, rows: readonly (readonly string[])[]): Promise<void> {
    if (!canEdit.value) return;
    const at = { tableId, row: 0, col: 0 };
    selection.value = at;
    selectionEnd.value = null;
    await writeCells(at, pasteWrites(rows, at), revision.value, true);
  }

  /** The values of every stored row, as text. */
  function cellTexts(table: TableRecord): string[][] {
    return Array.from({ length: table.rowCount }, (_, row) =>
      Array.from({ length: table.colCount }, (_, col) =>
        formatValue(engine.value.getValue({ tableId: table.id, row, col })),
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
        const input = engine.value.getInput({ tableId: table.id, row, col });
        if (input !== "") filled.push({ row, col, input });
      }
    }
    return filled;
  }

  /** The spreadsheet as a file that can be imported again. */
  function toFile(): SpreadsheetFile | undefined {
    if (!spreadsheet.value) return undefined;
    return toSpreadsheetFile(
      spreadsheet.value.name,
      pages.value,
      tables.value,
      views.value,
      filledCells,
    );
  }

  /**
   * Writes cells into a table that grows to fit them, up to its size limit,
   * and selects what was written, up to the stored cell `selectTo` when it is
   * given and otherwise the last row and column written.
   */
  async function writeCells(
    at: CellId,
    writes: readonly CellInput[],
    writtenAt = revision.value,
    selectWritten = false,
    selectTo?: CellAddress,
  ): Promise<void> {
    const table = tables.value.find((candidate) => candidate.id === at.tableId);
    if (!table || writes.length === 0) return;
    const rowCount = Math.min(LIMITS.tableRows, Math.max(...writes.map((write) => write.row + 1)));
    const colCount = Math.min(LIMITS.tableCols, Math.max(...writes.map((write) => write.col + 1)));
    const fitting = writes.filter((write) => write.row < rowCount && write.col < colCount);
    const selectionAnchor =
      selectWritten && selection.value ? identityOf(selection.value) : undefined;
    const stepId = crypto.randomUUID();
    const appendRows = Array.from({ length: Math.max(0, rowCount - table.rowCount) }, () =>
      crypto.randomUUID(),
    );
    pendingRows.set(stepId, { tableId: table.id, ids: appendRows });
    syncStructure();
    // Capture every existing row before a queued structural edit can move it.
    const rowIds = [...table.rows.map((row) => row.id), ...appendRows];
    const pending = {
      tableId: table.id,
      changes: showInputs(
        table.id,
        fitting.filter((write) => write.col < table.colCount),
      ),
    };
    if (!pending.changes.length && !appendRows.length && colCount <= table.colCount) {
      pendingRows.delete(stepId);
      return;
    }
    unsavedChanges.add(pending);
    syncStructure();
    const selectEnd = selectTo ?? { row: rowCount - 1, col: colCount - 1 };
    if (selectWritten) extendSelection(selectEnd);
    saves = enqueueWrite(async () => {
      try {
        const current = tables.value.find((candidate) => candidate.id === table.id);
        if (!current) throw new Error("The table was deleted");
        if (colCount > current.colCount) {
          const change = await api.updateTable(table.id, { colCount }, stepId);
          const grown = change.changed?.tables.find((record) => record.id === table.id)?.table;
          await receiveChange(change);
          if (!grown) throw new Error("The resized table was not returned");
          // Extending immediately can point into a column that does not have an
          // identity yet. Restore that endpoint after growth only if the user
          // still has the selection that this paste started from.
          const currentAnchor = selection.value && identityOf(selection.value);
          if (
            selectionAnchor &&
            currentAnchor &&
            cellIdentityKey(selectionAnchor) === cellIdentityKey(currentAnchor)
          ) {
            extendSelection(selectEnd);
          }
        }
        // A queued paste may have grown the table before this one ran. Use
        // the current identities for columns that had no id when this paste
        // was queued, including columns the earlier paste just created.
        const currentColumns = tables.value.find((candidate) => candidate.id === table.id)?.colIds;
        if (!currentColumns) throw new Error("The table was deleted");
        for (const write of fitting.filter((write) => write.col >= table.colCount)) {
          const rowId = rowIds[write.row];
          const colId = currentColumns[write.col];
          if (!rowId || !colId) throw new Error("The row or column being edited no longer exists");
          pending.changes.push({ rowId, colId, input: write.input });
        }
        await saveCellChanges(pending, stepId, writtenAt, appendRows);
        if (fitting.length < writes.length)
          notice.value = { kind: "error", text: "Some cells did not fit in the table" };
      } catch (cause) {
        unsavedChanges.delete(pending);
        pendingRows.delete(stepId);
        syncStructure();
        failedSaves += 1;
        fail(cause, "The change could not be saved");
      }
    });
    await saves;
  }

  /** Names a written cell, with its table when that is not the table the button is in. */
  function nameOf(cell: CellId, buttonTableId: string): string {
    const address = formatAddress(cell);
    if (cell.tableId === buttonTableId) return address;
    const table = tables.value.find((candidate) => candidate.id === cell.tableId);
    return table ? `${table.name}!${address}` : address;
  }

  function describe(result: ClickResult, buttonTableId: string): Notice {
    if (result.status === "failed") {
      return { kind: "error", text: result.error ?? "The action failed" };
    }
    if (result.emailsSent > 0) return { kind: "success", text: "Email sent" };
    const cells = result.change?.changed?.cells ?? [];
    if (cells.length === 0) return { kind: "success", text: "Done" };
    if (cells.length > MAX_NAMED_CELLS) {
      return { kind: "success", text: `Updated ${String(cells.length)} cells` };
    }
    const written = cells
      .flatMap((cell) => {
        const position = positionOf(cell);
        return position ? [nameOf(position, buttonTableId)] : [];
      })
      .join(", ");
    return { kind: "success", text: `Updated ${written}` };
  }

  /**
   * Sends a request that makes the server run what a cell asks for, then
   * shows the tables it resized and the cells it wrote.
   */
  async function run(
    id: CellId,
    request: () => Promise<ClickResult>,
  ): Promise<ClickResult | undefined> {
    const identity = identityOf(id);
    if (!identity) return undefined;
    const key = cellIdentityKey(identity);
    if (running.has(key) || !canEdit.value) return undefined;
    running.add(key);
    const queuedSaves = saves;
    const failedBefore = failedSaves;
    try {
      return await enqueueWrite(async () => {
        // The server evaluates stored inputs, so pending edits must be stored first. When one
        // could not be, the action would run on something other than what was typed.
        if (!(await stored(queuedSaves, failedBefore))) return undefined;
        const result = await request();
        if (result.change) await receiveChange(result.change);
        return result;
      });
    } catch (cause) {
      fail(cause, "The action could not be run");
      return undefined;
    } finally {
      running.delete(key);
    }
  }

  /** Asks the server to run the button in a cell. */
  async function click(id: CellId): Promise<void> {
    const identity = identityOf(id);
    if (!identity) return;
    const result = await run(id, () => api.click(identity));
    if (result) notice.value = describe(result, id.tableId);
  }

  /** Stores a value chosen through the checkbox or dropdown in a cell. Success is silent. */
  async function input(id: CellId, value: Scalar): Promise<void> {
    // JSON has no date, so a chosen date travels as its text and the server reads it back.
    const sent = isDate(value) ? formatDate(value) : value;
    const identity = identityOf(id);
    if (!identity) return;
    const result = await run(id, () => api.input(identity, sent));
    if (result?.status === "failed") notice.value = describe(result, id.tableId);
  }

  /** Runs a structure change and reports a failure as a notice. Returns whether it worked. */
  async function attempt(change: () => Promise<void>, fallback: string): Promise<boolean> {
    try {
      await enqueueWrite(change);
      return true;
    } catch (cause) {
      fail(cause, fallback);
      return false;
    }
  }

  async function renameSpreadsheet(name: string): Promise<void> {
    const current = spreadsheet.value;
    if (!current) return;
    await attempt(async () => {
      await api.renameSpreadsheet(current.id, name);
      spreadsheet.value = { ...current, name };
    }, "The spreadsheet could not be renamed");
  }

  async function addPage(): Promise<PageRecord | undefined> {
    const current = spreadsheet.value;
    if (!current) return undefined;
    let created: PageRecord | undefined;
    await attempt(async () => {
      const { page, change } = await api.createPage(current.id);
      await receiveChange(change);
      created = page;
    }, "The page could not be added");
    return created;
  }

  function renamePage(pageId: string, name: string): Promise<boolean> {
    return attempt(async () => {
      await receiveChange(await api.renamePage(pageId, name));
    }, "The page could not be renamed");
  }

  /** The ids of the blocks of a page, in the order they sit on it. */
  function blocksOn(pageId: string): string[] {
    return [...tables.value, ...views.value]
      .filter((block) => block.pageId === pageId)
      .sort((a, b) => a.position - b.position)
      .map((block) => block.id);
  }

  function rememberOrders(): void {
    acceptedPageOrder = pages.value.map((page) => page.id);
    for (const page of pages.value) acceptedBlockOrders.set(page.id, blocksOn(page.id));
    for (const pageId of acceptedBlockOrders.keys()) {
      if (!pages.value.some((page) => page.id === pageId)) acceptedBlockOrders.delete(pageId);
    }
  }

  function showPendingOrders(): void {
    if (optimisticPageOrder) showPageOrder(optimisticPageOrder);
    for (const order of optimisticBlockOrders.values()) showOrder(order);
  }

  /** The last request to reorder a page, which the next one waits for. */
  let reorders: Promise<void> = Promise.resolve();

  /** Shows the blocks of a page in the order of their ids. */
  function showOrder(order: readonly string[]): void {
    const position = new Map(order.map((id, index) => [id, index]));
    const placed = <T extends { id: string; position: number }>(block: T): T => ({
      ...block,
      position: position.get(block.id) ?? block.position,
    });
    tables.value = tables.value.map(placed);
    views.value = views.value.map(placed);
  }

  /**
   * Moves a block one place up or down its page. The
   * move shows at once, so a second click moves on from where the first left
   * the block, and it is undone if the server refuses.
   */
  function moveBlock(pageId: string, blockId: string, by: -1 | 1): Promise<boolean> {
    const before = blocksOn(pageId);
    const from = before.indexOf(blockId);
    const to = from + by;
    if (from === -1 || to < 0 || to >= before.length) return Promise.resolve(false);
    const order = before.with(from, before[to] ?? blockId).with(to, blockId);
    showOrder(order);
    optimisticBlockOrders.set(pageId, order);
    const previous = reorders;
    pendingBlockReorders.set(pageId, (pendingBlockReorders.get(pageId) ?? 0) + 1);
    const sent = attempt(async () => {
      await previous;
      const change = await api.reorderPage(pageId, order);
      await receiveChange(change);
      if (revision.value === change.revision) acceptedBlockOrders.set(pageId, order);
    }, "The page could not be rearranged").then((succeeded) => {
      const pending = (pendingBlockReorders.get(pageId) ?? 1) - 1;
      if (pending === 0) {
        pendingBlockReorders.delete(pageId);
        optimisticBlockOrders.delete(pageId);
        showOrder(acceptedBlockOrders.get(pageId) ?? before);
      } else pendingBlockReorders.set(pageId, pending);
      return succeeded;
    });
    // One request at a time, so the server ends on the order of the last click.
    reorders = sent.then(() => undefined);
    return sent;
  }

  /** The last request to reorder the pages, which the next one waits for. */
  let pageReorders: Promise<void> = Promise.resolve();

  /** Shows the pages in the order of their ids. */
  function showPageOrder(order: readonly string[]): void {
    const byId = new Map(pages.value.map((page) => [page.id, page]));
    pages.value = order.flatMap((id, position) => {
      const page = byId.get(id);
      return page ? [{ ...page, position }] : [];
    });
  }

  /**
   * Moves a page one place left or right among the tabs. As with a block,
   * the move shows at once and is undone if the server refuses.
   */
  function movePage(pageId: string, by: -1 | 1): Promise<boolean> {
    const current = spreadsheet.value;
    const before = pages.value.map((page) => page.id);
    const from = before.indexOf(pageId);
    const to = from + by;
    if (!current || from === -1 || to < 0 || to >= before.length) return Promise.resolve(false);
    const order = before.with(from, before[to] ?? pageId).with(to, pageId);
    showPageOrder(order);
    optimisticPageOrder = order;
    const previous = pageReorders;
    pendingPageReorders.set(current.id, (pendingPageReorders.get(current.id) ?? 0) + 1);
    const sent = attempt(async () => {
      await previous;
      const change = await api.reorderPages(current.id, order);
      await receiveChange(change);
      if (revision.value === change.revision) acceptedPageOrder = order;
    }, "The pages could not be rearranged").then((succeeded) => {
      const pending = (pendingPageReorders.get(current.id) ?? 1) - 1;
      if (pending === 0) {
        pendingPageReorders.delete(current.id);
        optimisticPageOrder = undefined;
        showPageOrder(acceptedPageOrder ?? before);
      } else pendingPageReorders.set(current.id, pending);
      return succeeded;
    });
    pageReorders = sent.then(() => undefined);
    return sent;
  }

  /**
   * Moves a block to the end of another page, and shows the formulas the
   * server rewrote so that each goes on reading the table it read.
   */
  function moveBlockToPage(blockId: string, pageId: string): Promise<boolean> {
    const queuedSaves = saves;
    return attempt(async () => {
      // The server rewrites stored formulas, so pending edits must be stored first.
      await queuedSaves;
      const name =
        [...tables.value, ...views.value].find((block) => block.id === blockId)?.name ?? "Block";
      await receiveChange(
        await (hasTable(blockId) ? api.moveTable(blockId, pageId) : api.moveView(blockId, pageId)),
      );
      if (selection.value?.tableId === blockId) selection.value = null;
      const page = pages.value.find((candidate) => candidate.id === pageId);
      notice.value = { kind: "success", text: `Moved ${name} to ${page?.name ?? "the page"}` };
    }, "The block could not be moved");
  }

  function deletePage(pageId: string): Promise<boolean> {
    return attempt(async () => {
      await receiveChange(await api.deletePage(pageId));
    }, "The page could not be deleted");
  }

  function addTable(pageId: string, position?: number): Promise<boolean> {
    return attempt(async () => {
      await receiveChange((await api.createTable(pageId, position)).change);
    }, "The table could not be added");
  }

  function updateTable(
    tableId: string,
    changes: { name?: string; rowCount?: number; colCount?: number },
  ): Promise<boolean> {
    const queuedSaves = saves;
    return attempt(async () => {
      // A smaller table loses cells, so pending edits must be stored first.
      await queuedSaves;
      await receiveChange(await api.updateTable(tableId, changes));
    }, "The table could not be changed");
  }

  /** Whether the table can grow to these dimensions under the shared limits. */
  function canResizeTableTo(
    tableId: string,
    size: { rowCount: number; colCount: number },
  ): boolean {
    const table = tables.value.find((candidate) => candidate.id === tableId);
    if (!canEdit.value || !table) return false;
    if (size.rowCount < table.rowCount || size.colCount < table.colCount) return false;
    if (size.rowCount === table.rowCount && size.colCount === table.colCount) return false;
    const otherRows = tables.value.reduce(
      (total, candidate) => total + (candidate.id === tableId ? 0 : candidate.rowCount),
      0,
    );
    return (
      size.rowCount <= Math.min(LIMITS.tableRows, LIMITS.spreadsheetRows - otherRows) &&
      size.colCount <= LIMITS.tableCols
    );
  }

  /** Grows a table through its existing resize endpoint after checking its row and column limits. */
  function resizeTableTo(
    tableId: string,
    size: { rowCount: number; colCount: number },
  ): Promise<boolean> {
    const queuedSaves = saves;
    return enqueueWrite(async () => {
      await queuedSaves;
      const table = tables.value.find((candidate) => candidate.id === tableId);
      if (!table) return false;
      const target = {
        rowCount: Math.max(table.rowCount, size.rowCount),
        colCount: Math.max(table.colCount, size.colCount),
      };
      if (!canResizeTableTo(tableId, target)) return false;
      await receiveChange(await api.updateTable(tableId, { ...target, grow: true }));
      return true;
    }).catch((cause: unknown) => {
      fail(cause, "The table could not be changed");
      return false;
    });
  }

  /** Names a table's columns, which makes it a data table. With `headerRow`, its first row gives the names. */
  function nameColumns(tableId: string, headerRow: boolean): Promise<boolean> {
    const queuedSaves = saves;
    return attempt(async () => {
      // The server may remove the header row, so pending edits must be stored first.
      await queuedSaves;
      await receiveChange(await api.nameColumns(tableId, headerRow));
    }, "The columns could not be named");
  }

  /** Makes a data table a plain table again. */
  function dropColumns(tableId: string): Promise<boolean> {
    return attempt(async () => {
      await receiveChange(await api.dropColumns(tableId));
    }, "The table could not be changed");
  }

  function updateColumn(
    tableId: string,
    col: number,
    changes: {
      name?: string;
      type?: ColumnType;
      formula?: string;
      choices?: string[];
      choicesFrom?: { tableId: string; colId: string };
    },
    writtenAt = revision.value,
  ): Promise<boolean> {
    const colId = tables.value.find((table) => table.id === tableId)?.colIds[col];
    if (!colId) return Promise.resolve(false);
    const queuedSaves = saves;
    return attempt(async () => {
      await queuedSaves;
      await receiveChange(
        await api.updateColumn(tableId, colId, { ...changes, revision: writtenAt }),
      );
    }, "The column could not be changed");
  }

  /** Inserts or deletes a row or column, and shows the cells the server moved and rewrote. */
  function editTable(tableId: string, edit: StructuralEditBody): Promise<boolean> {
    const layout = layouts.value.get(tableId);
    if (!layout) return Promise.resolve(false);
    const ids = edit.axis === "row" ? layout.rowIds : layout.colIds;
    const count = edit.count ?? 1;
    const request: IdentifiedStructuralEditBody =
      edit.kind === "insert"
        ? {
            axis: edit.axis,
            kind: "insert",
            beforeId: ids[edit.index] ?? null,
            ids: Array.from({ length: count }, () => crypto.randomUUID()),
          }
        : { axis: edit.axis, kind: "delete", ids: ids.slice(edit.index, edit.index + count) };
    const queuedSaves = saves;
    return attempt(async () => {
      // The server shifts stored cells, so pending edits must be stored first.
      await queuedSaves;
      await receiveChange(await api.editTable(tableId, request));
    }, "The table could not be changed");
  }

  /**
   * Deletes rows or columns by their stored positions, which need not sit next
   * to each other. The selection of a sorted or filtered table is such a set.
   */
  function deleteLines(
    tableId: string,
    axis: "row" | "col",
    indexes: readonly number[],
  ): Promise<boolean> {
    const layout = layouts.value.get(tableId);
    if (!layout) return Promise.resolve(false);
    const all = axis === "row" ? layout.rowIds : layout.colIds;
    const ids = [...new Set(indexes)].flatMap((index) => all[index] ?? []);
    if (ids.length === 0) return Promise.resolve(false);
    const queuedSaves = saves;
    return attempt(async () => {
      // The server shifts stored cells, so pending edits must be stored first.
      await queuedSaves;
      await receiveChange(await api.editTable(tableId, { axis, kind: "delete", ids }));
    }, "The table could not be changed");
  }

  function addView(pageId: string, kind: ViewRecord["kind"], position?: number): Promise<boolean> {
    return attempt(async () => {
      await receiveChange((await api.createView(pageId, kind, position)).change);
    }, "The view could not be added");
  }

  function updateView(
    viewId: string,
    changes: { name?: string; source?: string; chartType?: ChartType },
    writtenAt = revision.value,
  ): Promise<boolean> {
    const previous = viewUpdates.get(viewId) ?? Promise.resolve(true);
    const updated = attempt(async () => {
      await previous;
      await receiveChange(await api.updateView(viewId, { ...changes, revision: writtenAt }));
    }, "The view could not be changed");
    viewUpdates.set(viewId, updated);
    void updated.then(() => {
      if (viewUpdates.get(viewId) === updated) viewUpdates.delete(viewId);
    });
    return updated;
  }

  function deleteView(viewId: string): Promise<boolean> {
    return attempt(async () => {
      await receiveChange(await api.deleteView(viewId));
    }, "The view could not be deleted");
  }

  function deleteTable(tableId: string): Promise<boolean> {
    return attempt(async () => {
      await receiveChange(await api.deleteTable(tableId));
    }, "The table could not be deleted");
  }

  function appendCell(
    tableId: string,
    colId: string,
    input: string,
    writtenAt = revision.value,
  ): Promise<void> {
    const table = tables.value.find((table) => table.id === tableId);
    const col = table?.colIds.indexOf(colId) ?? -1;
    if (!table || col < 0) {
      fail(
        new Error("The column being edited was deleted. Your text was not saved."),
        "The cell could not be saved",
      );
      return Promise.resolve();
    }
    if (input === "") return Promise.resolve();
    return setCell({ tableId, row: table.rowCount, col }, input, writtenAt);
  }

  function isRunning(id: CellId): boolean {
    const identity = identityOf(id);
    return !!identity && running.has(cellIdentityKey(identity));
  }

  function restoreVersion(spreadsheetId: string, versionId: string): Promise<void> {
    return enqueueWrite(async () => {
      await receiveChange(await api.restoreVersion(spreadsheetId, versionId));
    });
  }

  return {
    revision,
    appendCell,
    rejectedDraft,
    receiveChange,
    isRunning,
    restoreVersion,
    spreadsheet,
    pages,
    tables,
    views,
    importRows,
    shownRows,
    toFile,
    evaluateOnPage,
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
