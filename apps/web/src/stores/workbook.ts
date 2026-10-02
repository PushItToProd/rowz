import {
  cellKey,
  createWorkbook,
  formatAddress,
  formatDate,
  formatAt,
  formatValue,
  isFormulaInput,
  isDate,
  Workbook,
  type CellAddress,
  type CellId,
  type CellFormat,
  type CellValue,
  type ChartType,
  type ColumnDefinition,
  type ColumnType,
  type Evaluated,
  type FormatPatch,
  type Scalar,
} from "@spreadsheet-app/engine";
import {
  LIMITS,
  type CellInput,
  type SpreadsheetFile,
  type StructuralEditBody,
} from "@spreadsheet-app/shared";
import { defineStore } from "pinia";
import { toSpreadsheetFile } from "../files/spreadsheetFile";
import { computed, reactive, ref, shallowRef, triggerRef, watch } from "vue";
import {
  setJournaledHandler,
  api,
  type ClickResult,
  type PageRecord,
  type Rewritten,
  type Snapshot,
  type TableRecord,
  type UndoResult,
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
} from "../formula/fill";

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
 * The spreadsheet open in the editor.
 *
 * The formula engine runs here in the browser, so a typed value shows up at
 * once. The server stores what was typed, and it alone runs button actions.
 */
export const useWorkbookStore = defineStore("workbook", () => {
  const spreadsheet = ref<{ id: string; name: string; role: string } | null>(null);
  const pages = ref<PageRecord[]>([]);
  const tables = ref<TableRecord[]>([]);
  /** Charts and text views: the things on a page that are not tables. */
  const views = ref<ViewRecord[]>([]);
  /** The selected cell: the one the keyboard edits and the formula bar shows. */
  const selection = ref<CellId | null>(null);
  /** The far corner of a selected range, when more than one cell is selected. */
  const selectionEnd = ref<CellAddress | null>(null);
  // Selecting another cell selects just that cell.
  watch(selection, () => (selectionEnd.value = null), { flush: "sync" });
  /** The selected cells as a rectangle within the selected cell's table. */
  const selectedRange = computed<GridRange | null>(() =>
    selection.value ? rangeOf(selection.value, selectionEnd.value ?? selection.value) : null,
  );
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
  let copied: { text: string; rows: string[][]; from: CellAddress } | undefined;
  const notice = ref<Notice | null>(null);
  /** Keys of the button cells whose click is in flight. */
  const running = reactive(new Set<string>());

  // The engine is a plain object and Vue cannot see inside it. It sits in a
  // shallow ref that is triggered by hand after every change, so anything
  // that read a value through `engine.value` is recomputed.
  const engine = shallowRef(new Workbook());

  // Saves run one at a time so the server applies edits in the order typed.
  let saves: Promise<void> = Promise.resolve();
  /** How many saves have failed, which `stored` compares across a wait. */
  let failedSaves = 0;

  /** New writes wait for an undo or redo that started before them. */
  let writeBarrier: Promise<void> = Promise.resolve();
  const pendingWrites = new Set<Promise<unknown>>();
  let historyActions: Promise<void> = Promise.resolve();
  let acceptedPageOrder: string[] | undefined;
  const acceptedBlockOrders = new Map<string, string[]>();
  const pendingPageReorders = new Map<string, number>();
  const pendingBlockReorders = new Map<string, number>();
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

  function trackWrite<T>(write: Promise<T>): Promise<T> {
    pendingWrites.add(write);
    void write.then(
      () => pendingWrites.delete(write),
      () => pendingWrites.delete(write),
    );
    return countUnanswered(write);
  }

  function enqueueWrite<T>(change: () => Promise<T>): Promise<T> {
    const barrier = writeBarrier;
    return trackWrite(barrier.then(change));
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

  function apply(id: CellId, input: string): void {
    if (!hasTable(id.tableId)) return;
    engine.value.setCell(id, input);
    triggerRef(engine);
  }

  function syncStructure(): void {
    engine.value.setStructure({ pages: pages.value, tables: tables.value });
    triggerRef(engine);
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
    engine.value = createWorkbook(snapshot);
    spreadsheet.value = { id: snapshot.id, name: snapshot.name, role: snapshot.role };
    pages.value = snapshot.pages;
    tables.value = snapshot.tables;
    views.value = snapshot.views;
    undoable.value = snapshot.undoable;
    redoable.value = snapshot.redoable;
    acceptedPageOrder = snapshot.pages.map((page) => page.id);
    acceptedBlockOrders.clear();
    for (const page of snapshot.pages) acceptedBlockOrders.set(page.id, blocksOn(page.id));
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
    const snapshot = await readSettled(
      open.id,
      () => turn === refreshes && loaded === loads && spreadsheet.value?.id === open.id,
    );
    if (!snapshot) return;

    engine.value = createWorkbook(snapshot);
    spreadsheet.value = { id: snapshot.id, name: snapshot.name, role: snapshot.role };
    pages.value = snapshot.pages;
    tables.value = snapshot.tables;
    views.value = snapshot.views;
    undoable.value = snapshot.undoable;
    redoable.value = snapshot.redoable;
    acceptedPageOrder = snapshot.pages.map((page) => page.id);
    acceptedBlockOrders.clear();
    for (const page of snapshot.pages) acceptedBlockOrders.set(page.id, blocksOn(page.id));

    const selected = selection.value;
    const table = snapshot.tables.find((candidate) => candidate.id === selected?.tableId);
    const inside =
      table && selected && selected.row < table.rowCount && selected.col < table.colCount;
    if (!inside) {
      selection.value = null;
      selectionEnd.value = null;
    }
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

  /** Shows what the server rewrote after a rename or a row or column edit. */
  function applyRewritten({ cells, views: sources, tables: changed }: Rewritten): void {
    if (changed.length > 0) {
      // Other tables' formula columns named what was renamed or moved.
      const byId = new Map(changed.map((table) => [table.id, table]));
      tables.value = tables.value.map((table) => byId.get(table.id) ?? table);
      syncStructure();
    }
    for (const cell of cells) apply(cell, cell.input);
    if (sources.length === 0) return;
    const rewritten = new Map(sources.map(({ id, source }) => [id, source]));
    views.value = views.value.map((view) => ({
      ...view,
      source: rewritten.get(view.id) ?? view.source,
    }));
  }

  /** Applies the content the server restored, then keeps or moves the selection. */
  function applyChanged(changed: UndoResult["changed"]): void {
    const pageRecords = new Map(changed.pages.map(({ id, page }) => [id, page]));
    pages.value = [
      ...pages.value.filter((page) => !pageRecords.has(page.id)),
      ...[...pageRecords.values()].filter((page): page is PageRecord => page !== null),
    ].sort((left, right) => left.position - right.position);

    const tableRecords = new Map(changed.tables.map(({ id, table }) => [id, table]));
    tables.value = [
      ...tables.value.filter((table) => !tableRecords.has(table.id)),
      ...[...tableRecords.values()].filter((table): table is TableRecord => table !== null),
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

    if (changed.pages.length > 0 || changed.tables.length > 0) syncStructure();
    for (const cell of changed.cells) apply(cell, cell.input);

    acceptedPageOrder = pages.value.map((page) => page.id);
    for (const page of pages.value) acceptedBlockOrders.set(page.id, blocksOn(page.id));
    for (const pageId of acceptedBlockOrders.keys()) {
      if (!pages.value.some((page) => page.id === pageId)) acceptedBlockOrders.delete(pageId);
    }

    const selected = selection.value;
    const selectedTable = tables.value.find((table) => table.id === selected?.tableId);
    const selectedInside =
      selectedTable !== undefined &&
      selected !== null &&
      selected.row < selectedTable.rowCount &&
      selected.col < selectedTable.colCount;
    if (!selectedInside) {
      const first = changed.cells.find((cell) => {
        const table = tables.value.find((candidate) => candidate.id === cell.tableId);
        return table !== undefined && cell.row < table.rowCount && cell.col < table.colCount;
      });
      selection.value = first ? { tableId: first.tableId, row: first.row, col: first.col } : null;
      selectionEnd.value = null;
      return;
    }
    const end = selectionEnd.value;
    if (end && (end.row >= selectedTable.rowCount || end.col >= selectedTable.colCount)) {
      selectionEnd.value = null;
    }
  }

  /**
   * Shows again the cell changes typed while an undo or redo was on its way,
   * where its result wrote over them. Their saves waited for it and store
   * them after it, so they are what the server ends up holding.
   */
  function showUnsavedOver(restored: readonly CellId[]): void {
    const written = new Set(restored.map(cellKey));
    for (const { tableId, changes } of unsavedChanges) {
      if (!hasTable(tableId)) continue;
      for (const change of changes) {
        const id = { tableId, row: change.row, col: change.col };
        if (!written.has(cellKey(id))) continue;
        // A save that fails puts back what the cell holds on the server.
        change.previous = engine.value.getInput(id);
        apply(id, change.input);
      }
    }
  }

  async function runHistory(direction: "undo" | "redo"): Promise<void> {
    const current = spreadsheet.value;
    if (!current || !canEdit.value) return;
    const waiting = [...pendingWrites];
    if (waiting.length === 0 && !(direction === "undo" ? undoable.value : redoable.value)) {
      return;
    }

    const previousBarrier = writeBarrier;
    let release!: () => void;
    writeBarrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await Promise.allSettled(waiting);
      await previousBarrier;
      if (!(direction === "undo" ? undoable.value : redoable.value)) return;
      const result = await (direction === "undo" ? api.undo(current.id) : api.redo(current.id));
      // The answer is about the spreadsheet that was open when it was asked for.
      if (spreadsheet.value?.id !== current.id) return;
      undoable.value = result.undoable;
      redoable.value = result.redoable;
      if (result.outcome === "done") {
        applyChanged(result.changed);
        showUnsavedOver(result.changed.cells);
        if (
          result.changed.pages.length > 0 ||
          result.changed.tables.length > 0 ||
          result.changed.views.length > 0
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
    } finally {
      release();
    }
  }

  function undo(): Promise<void> {
    const queued = historyActions.then(() => runHistory("undo"));
    historyActions = queued.catch(() => undefined);
    return countUnanswered(queued);
  }

  function redo(): Promise<void> {
    const queued = historyActions.then(() => runHistory("redo"));
    historyActions = queued.catch(() => undefined);
    return countUnanswered(queued);
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

  /** How a cell is shown: the formats its table gives it. */
  function formatOf(id: CellId): CellFormat {
    const rules = tables.value.find((table) => table.id === id.tableId)?.formats ?? [];
    return rules.length === 0 ? NO_FORMAT : formatAt(rules, id.row, id.col);
  }

  /**
   * Changes how the selected cells are shown. A selection that reaches the
   * last row or column is taken to mean the rest of the table, so rows and
   * columns added later are shown the same way.
   */
  function formatSelection(patch: FormatPatch, reset = false): Promise<boolean> {
    const selected = selectedRange.value;
    const table = tables.value.find((candidate) => candidate.id === selection.value?.tableId);
    if (!selected || !table || !canEdit.value) return Promise.resolve(false);
    const wholeRows = selected.startRow === 0 && selected.endRow >= table.rowCount - 1;
    const wholeCols = selected.startCol === 0 && selected.endCol >= table.colCount - 1;
    const range = {
      startRow: selected.startRow,
      endRow: wholeRows ? null : selected.endRow,
      startCol: selected.startCol,
      endCol: wholeCols ? null : selected.endCol,
    };
    return attempt(async () => {
      const updated = await api.formatCells(table.id, range, patch, reset);
      tables.value = tables.value.map((other) => (other.id === updated.id ? updated : other));
    }, "The format could not be changed");
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
  async function setCell(id: CellId, input: string): Promise<void> {
    if (columnOf(id)?.type !== "formula") {
      return setCells(id.tableId, [{ row: id.row, col: id.col, input }]);
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
    await updateColumn(id.tableId, id.col, { formula: input });
  }

  /** A cell write that changes what the cell holds, with what it held. */
  type CellChange = CellInput & { previous: string };

  /** Shows new inputs for cells of one table, and returns the ones that changed a cell. */
  function showInputs(tableId: string, writes: readonly CellInput[]): CellChange[] {
    const changes = writes
      // A fill or paste that crosses a formula column leaves that column to its formula.
      .filter((write) => columnOf({ tableId, ...write })?.type !== "formula")
      .map((write) => ({ ...write, previous: engine.value.getInput({ tableId, ...write }) }))
      .filter((change) => change.previous !== change.input);
    for (const { row, col, input } of changes) apply({ tableId, row, col }, input);
    return changes;
  }

  /** The cell changes shown here that the server has not answered, oldest first. */
  const unsavedChanges = new Set<{ tableId: string; changes: readonly CellChange[] }>();

  /** Keeps shown changes in `unsavedChanges` until their save settles. */
  function untilSaved<T>(
    tableId: string,
    changes: readonly CellChange[],
    save: Promise<T>,
  ): Promise<T> {
    const unsaved = { tableId, changes };
    unsavedChanges.add(unsaved);
    const forget = (): void => {
      unsavedChanges.delete(unsaved);
    };
    void save.then(forget, forget);
    return save;
  }

  /** Puts cells back as they were before changes that could not be saved. */
  function putBack(tableId: string, changes: readonly CellChange[]): void {
    for (const { row, col, input, previous } of changes) {
      // A later edit to the same cell has its own save. Leave it alone.
      if (engine.value.getInput({ tableId, row, col }) === input) {
        apply({ tableId, row, col }, previous);
      }
    }
  }

  /**
   * Shows new inputs for cells of one table at once and saves them as one
   * undo step. Inputs that fail to save are put back as they were.
   */
  function setCells(tableId: string, writes: readonly CellInput[]): Promise<void> {
    const changes = showInputs(tableId, writes);
    if (changes.length === 0) return Promise.resolve();
    const stepId = crypto.randomUUID();
    const previous = saves;
    saves = untilSaved(
      tableId,
      changes,
      enqueueWrite(async () => {
        await previous;
        await saveCellChanges(tableId, changes, stepId);
      }),
    );
    return saves;
  }

  /** Saves shown changes under one undo step. A failure is reported here and counted in `failedSaves`. */
  async function saveCellChanges(
    tableId: string,
    changes: readonly CellChange[],
    stepId: string,
  ): Promise<void> {
    let saved = 0;
    try {
      // The server takes a limited number of cells per request.
      for (; saved < changes.length; saved += LIMITS.cellsPerRequest) {
        const batch = changes.slice(saved, saved + LIMITS.cellsPerRequest);
        await api.setCells(
          tableId,
          batch.map(({ row, col, input }) => ({ row, col, input })),
          stepId,
        );
      }
    } catch (cause) {
      putBack(tableId, changes.slice(saved));
      failedSaves += 1;
      fail(cause, "The change could not be saved");
    }
  }

  /** Makes the selection a range from the selected cell to `address`. */
  function extendSelection(address: CellAddress): void {
    const anchor = selection.value;
    if (!anchor) return;
    const single = anchor.row === address.row && anchor.col === address.col;
    selectionEnd.value = single ? null : { row: address.row, col: address.col };
  }

  /** Fills `target` with the pattern of the cells in `source`, moving formula references. */
  function fill(
    tableId: string,
    source: GridRange,
    target: GridRange,
    series = false,
  ): Promise<void> {
    const inputAt = (cell: CellAddress): string => engine.value.getInput({ tableId, ...cell });
    return setCells(tableId, fillWrites(source, target, inputAt, series));
  }

  /** Empties the selected cells. */
  function clearSelection(): Promise<void> {
    const selected = selectedRange.value;
    const tableId = selection.value?.tableId;
    if (!selected || tableId === undefined || !canEdit.value) return Promise.resolve();
    return setCells(
      tableId,
      clearWrites(selected, (cell) => engine.value.getInput({ tableId, ...cell })),
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
    const shown = inputsOf(selected, (cell) =>
      formatValue(engine.value.getValue({ tableId, ...cell })),
    );
    const text = toClipboardText(shown);
    copied = {
      text,
      rows: inputsOf(selected, (cell) => engine.value.getInput({ tableId, ...cell })),
      from: { row: selected.startRow, col: selected.startCol },
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
    // Text this app put on the clipboard stands for the cells it was copied from.
    const own = copied?.text === text ? copied : undefined;
    await writeCells(at, pasteWrites(own?.rows ?? fromClipboardText(text), at, own?.from));
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
    await writeCells(at, pasteWrites(rows, at));
  }

  /** The values a table shows, row by row, for writing to a file. Rows and columns that are empty at the end are left out. */
  function shownRows(table: TableRecord): string[][] {
    const rows = Array.from({ length: table.rowCount }, (_, row) =>
      Array.from({ length: table.colCount }, (_, col) =>
        formatValue(engine.value.getValue({ tableId: table.id, row, col })),
      ),
    );
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

  /** Writes cells into a table that grows to fit them, up to its size limit, and selects what was written. */
  async function writeCells(at: CellId, writes: readonly CellInput[]): Promise<void> {
    const table = tables.value.find((candidate) => candidate.id === at.tableId);
    if (!table) return;
    if (writes.length === 0) return;
    const rowCount = Math.min(LIMITS.tableRows, Math.max(...writes.map((write) => write.row + 1)));
    const colCount = Math.min(LIMITS.tableCols, Math.max(...writes.map((write) => write.col + 1)));
    const fitting = writes.filter((write) => write.row < rowCount && write.col < colCount);
    // The growth and the cells are one undo step.
    const stepId = crypto.randomUUID();
    const changes = showInputs(table.id, fitting);

    const queuedSaves = saves;
    const operation = enqueueWrite(async () => {
      await queuedSaves;
      const currentTable = tables.value.find((candidate) => candidate.id === table.id);
      if (!currentTable) {
        putBack(table.id, changes);
        return;
      }
      if (rowCount > currentTable.rowCount || colCount > currentTable.colCount) {
        const { table: grown, ...rewritten } = await api.updateTable(
          table.id,
          {
            rowCount: Math.max(rowCount, currentTable.rowCount),
            colCount: Math.max(colCount, currentTable.colCount),
          },
          stepId,
        );
        tables.value = tables.value.map((other) => (other.id === grown.id ? grown : other));
        syncStructure();
        applyRewritten(rewritten);
      }
      await saveCellChanges(table.id, changes, stepId);
      // Leave what was pasted selected.
      extendSelection({ row: rowCount - 1, col: colCount - 1 });
      if (fitting.length < writes.length) {
        notice.value = { kind: "error", text: "Some cells did not fit in the table" };
      }
    }).catch((cause: unknown) => {
      // The table could not grow, so none of the cells were sent.
      putBack(table.id, changes);
      failedSaves += 1;
      fail(cause, "The change could not be saved");
    });
    saves = untilSaved(table.id, changes, operation);
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
    if (result.cells.length === 0) return { kind: "success", text: "Done" };
    if (result.cells.length > MAX_NAMED_CELLS) {
      return { kind: "success", text: `Updated ${String(result.cells.length)} cells` };
    }
    const written = result.cells.map((cell) => nameOf(cell, buttonTableId)).join(", ");
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
    const key = cellKey(id);
    if (running.has(key) || !canEdit.value) return undefined;
    running.add(key);
    const queuedSaves = saves;
    const failedBefore = failedSaves;
    return enqueueWrite(async () => {
      try {
        // The server evaluates stored inputs, so pending edits must be stored first. When one
        // could not be, the action would run on something other than what was typed.
        if (!(await stored(queuedSaves, failedBefore))) return undefined;
        const result = await request();
        if (result.tables.length > 0) {
          const resized = new Map(result.tables.map((table) => [table.id, table]));
          tables.value = tables.value.map((table) => resized.get(table.id) ?? table);
          syncStructure();
        }
        for (const cell of result.cells) apply(cell, cell.input);
        return result;
      } catch (cause) {
        fail(cause, "The action could not be run");
        return undefined;
      } finally {
        running.delete(key);
      }
    });
  }

  /** Asks the server to run the button in a cell. */
  async function click(id: CellId): Promise<void> {
    const result = await run(id, () => api.click(id));
    if (result) notice.value = describe(result, id.tableId);
  }

  /** Stores a value chosen through the checkbox or dropdown in a cell. Success is silent. */
  async function input(id: CellId, value: Scalar): Promise<void> {
    // JSON has no date, so a chosen date travels as its text and the server reads it back.
    const sent = isDate(value) ? formatDate(value) : value;
    const result = await run(id, () => api.input(id, sent));
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
      const { page, table } = await api.createPage(current.id);
      pages.value = [...pages.value, page];
      tables.value = [...tables.value, table];
      rememberOrders();
      syncStructure();
      created = page;
    }, "The page could not be added");
    return created;
  }

  function renamePage(pageId: string, name: string): Promise<boolean> {
    return attempt(async () => {
      const rewritten = await api.renamePage(pageId, name);
      pages.value = pages.value.map((page) => (page.id === pageId ? { ...page, name } : page));
      syncStructure();
      // The server rewrote the formulas that named the page.
      applyRewritten(rewritten);
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
    const previous = reorders;
    pendingBlockReorders.set(pageId, (pendingBlockReorders.get(pageId) ?? 0) + 1);
    const sent = attempt(async () => {
      await previous;
      await api.reorderPage(pageId, order);
      acceptedBlockOrders.set(pageId, order);
    }, "The page could not be rearranged").then((succeeded) => {
      const pending = (pendingBlockReorders.get(pageId) ?? 1) - 1;
      if (pending === 0) pendingBlockReorders.delete(pageId);
      else pendingBlockReorders.set(pageId, pending);
      if (!succeeded && pending === 0) showOrder(acceptedBlockOrders.get(pageId) ?? before);
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
    const previous = pageReorders;
    pendingPageReorders.set(current.id, (pendingPageReorders.get(current.id) ?? 0) + 1);
    const sent = attempt(async () => {
      await previous;
      await api.reorderPages(current.id, order);
      acceptedPageOrder = order;
    }, "The pages could not be rearranged").then((succeeded) => {
      const pending = (pendingPageReorders.get(current.id) ?? 1) - 1;
      if (pending === 0) pendingPageReorders.delete(current.id);
      else pendingPageReorders.set(current.id, pending);
      if (!succeeded && pending === 0) showPageOrder(acceptedPageOrder ?? before);
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
      let name: string;
      if (hasTable(blockId)) {
        const { table, ...rewritten } = await api.moveTable(blockId, pageId);
        showTable(table, rewritten);
        rememberOrders();
        // The selected cell is no longer on the page being shown.
        if (selection.value?.tableId === blockId) selection.value = null;
        ({ name } = table);
      } else {
        const { view, ...rewritten } = await api.moveView(blockId, pageId);
        views.value = views.value.map((other) => (other.id === view.id ? view : other));
        applyRewritten(rewritten);
        rememberOrders();
        ({ name } = view);
      }
      const page = pages.value.find((candidate) => candidate.id === pageId);
      notice.value = { kind: "success", text: `Moved ${name} to ${page?.name ?? "the page"}` };
    }, "The block could not be moved");
  }

  function deletePage(pageId: string): Promise<boolean> {
    return attempt(async () => {
      await api.deletePage(pageId);
      pages.value = pages.value.filter((page) => page.id !== pageId);
      tables.value = tables.value.filter((table) => table.pageId !== pageId);
      views.value = views.value.filter((view) => view.pageId !== pageId);
      rememberOrders();
      if (selection.value && !hasTable(selection.value.tableId)) selection.value = null;
      syncStructure();
    }, "The page could not be deleted");
  }

  function addTable(pageId: string): Promise<boolean> {
    return attempt(async () => {
      tables.value = [...tables.value, await api.createTable(pageId)];
      rememberOrders();
      syncStructure();
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
      const { table: updated, ...rewritten } = await api.updateTable(tableId, changes);
      tables.value = tables.value.map((table) => (table.id === tableId ? updated : table));
      syncStructure();
      // The server rewrote the formulas that named a renamed table, or that read rows and
      // columns a smaller table no longer has.
      applyRewritten(rewritten);
      keepSelectionInside(updated);
    }, "The table could not be changed");
  }

  /** Leaves the selection where it was in a table that changed size, as far as the table still reaches. */
  function keepSelectionInside(table: TableRecord): void {
    const [selected, end] = [selection.value, selectionEnd.value];
    if (selected?.tableId !== table.id) return;
    const inside = ({ row, col }: CellAddress): CellAddress => ({
      row: Math.min(row, table.rowCount - 1),
      col: Math.min(col, table.colCount - 1),
    });
    if (selected.row >= table.rowCount || selected.col >= table.colCount) {
      selection.value = { tableId: table.id, ...inside(selected) };
    }
    if (end) extendSelection(inside(end));
  }

  /** Shows a table as the server now has it, with what the change rewrote elsewhere. */
  function showTable(updated: TableRecord, rewritten: Rewritten): void {
    tables.value = tables.value.map((table) => (table.id === updated.id ? updated : table));
    syncStructure();
    applyRewritten(rewritten);
  }

  /** Names a table's columns, which makes it a data table. With `headerRow`, its first row gives the names. */
  function nameColumns(tableId: string, headerRow: boolean): Promise<boolean> {
    const queuedSaves = saves;
    return attempt(async () => {
      // The server may remove the header row, so pending edits must be stored first.
      await queuedSaves;
      const { table, ...rewritten } = await api.nameColumns(tableId, headerRow);
      showTable(table, rewritten);
    }, "The columns could not be named");
  }

  /** Makes a data table a plain table again. */
  function dropColumns(tableId: string): Promise<boolean> {
    return attempt(async () => {
      showTable(await api.dropColumns(tableId), { cells: [], views: [], tables: [] });
    }, "The table could not be changed");
  }

  function updateColumn(
    tableId: string,
    col: number,
    changes: { name?: string; type?: ColumnType; formula?: string },
  ): Promise<boolean> {
    const queuedSaves = saves;
    return attempt(async () => {
      await queuedSaves;
      const { table, ...rewritten } = await api.updateColumn(tableId, col, changes);
      showTable(table, rewritten);
    }, "The column could not be changed");
  }

  /** Inserts or deletes a row or column, and shows the cells the server moved and rewrote. */
  function editTable(tableId: string, edit: StructuralEditBody): Promise<boolean> {
    const queuedSaves = saves;
    return attempt(async () => {
      // The server shifts stored cells, so pending edits must be stored first.
      await queuedSaves;
      const { table: updated, ...rewritten } = await api.editTable(tableId, edit);
      tables.value = tables.value.map((table) => (table.id === tableId ? updated : table));
      syncStructure();
      applyRewritten(rewritten);

      keepSelectionInside(updated);
    }, "The table could not be changed");
  }

  function addView(pageId: string, kind: ViewRecord["kind"]): Promise<boolean> {
    return attempt(async () => {
      views.value = [...views.value, await api.createView(pageId, kind)];
      rememberOrders();
    }, "The view could not be added");
  }

  function updateView(
    viewId: string,
    changes: { name?: string; source?: string; chartType?: ChartType },
  ): Promise<boolean> {
    const previous = viewUpdates.get(viewId) ?? Promise.resolve(true);
    const updated = attempt(async () => {
      await previous;
      const updated = await api.updateView(viewId, changes);
      views.value = views.value.map((view) => (view.id === viewId ? updated : view));
    }, "The view could not be changed");
    viewUpdates.set(viewId, updated);
    void updated.then(() => {
      if (viewUpdates.get(viewId) === updated) viewUpdates.delete(viewId);
    });
    return updated;
  }

  function deleteView(viewId: string): Promise<boolean> {
    return attempt(async () => {
      await api.deleteView(viewId);
      views.value = views.value.filter((view) => view.id !== viewId);
      rememberOrders();
    }, "The view could not be deleted");
  }

  function deleteTable(tableId: string): Promise<boolean> {
    return attempt(async () => {
      await api.deleteTable(tableId);
      tables.value = tables.value.filter((table) => table.id !== tableId);
      rememberOrders();
      if (selection.value?.tableId === tableId) selection.value = null;
      syncStructure();
    }, "The table could not be deleted");
  }

  return {
    spreadsheet,
    pages,
    tables,
    views,
    importRows,
    shownRows,
    toFile,
    evaluateOnPage,
    addView,
    updateView,
    deleteView,
    selection,
    selectionEnd,
    selectedRange,
    extendSelection,
    gridFocusRequests,
    focusGrid,
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
    editTable,
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
    formatOf,
    formatSelection,
    nameColumns,
    dropColumns,
    updateColumn,
  };
});
