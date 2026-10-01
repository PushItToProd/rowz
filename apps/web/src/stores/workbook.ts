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
  api,
  type ClickResult,
  type PageRecord,
  type Rewritten,
  type TableRecord,
  type ViewRecord,
} from "../api/client";
import {
  blockOf,
  clearWrites,
  fillWrites,
  fromClipboardText,
  inputsOf,
  pasteWrites,
  toClipboardText,
  type Block,
} from "../formula/fill";

export interface Notice {
  kind: "success" | "error";
  text: string;
}

/** A notice names the cells an action wrote, up to this many. Past that it gives the count. */
const MAX_NAMED_CELLS = 3;
/** How many cell edits Ctrl+Z can take back. */
const MAX_UNDO = 100;

/** One change to cells of a table, as what each held before and after. */
interface CellEdit {
  tableId: string;
  cells: { row: number; col: number; before: string; after: string }[];
}
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
  const selectedBlock = computed<Block | null>(() =>
    selection.value ? blockOf(selection.value, selectionEnd.value ?? selection.value) : null,
  );
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
    // A rename or a moved row rewrites formulas and addresses, so what was
    // typed before it can no longer be put back where and as it was.
    forgetEdits();
  }

  /** Cell edits made in this session, oldest first, that Ctrl+Z takes back. */
  const undoable = shallowRef<CellEdit[]>([]);
  /** Edits taken back, most recent last, that Ctrl+Y makes again. */
  const redoable = shallowRef<CellEdit[]>([]);
  const canUndo = computed(() => canEdit.value && undoable.value.length > 0);
  const canRedo = computed(() => canEdit.value && redoable.value.length > 0);

  function forgetEdits(): void {
    undoable.value = [];
    redoable.value = [];
  }

  /** Puts the cells of an edit to their state before or after it, and selects them. */
  function replay(edit: CellEdit, to: "before" | "after"): Promise<void> {
    const [first] = edit.cells;
    if (first) {
      selection.value = { tableId: edit.tableId, row: first.row, col: first.col };
      selectionEnd.value = null;
    }
    const writes = edit.cells.map(({ row, col, ...states }) => ({ row, col, input: states[to] }));
    return setCells(edit.tableId, writes, false);
  }

  /** Takes back the last cell edit made in this session. */
  function undo(): Promise<void> {
    const edit = undoable.value.at(-1);
    if (!edit || !canEdit.value) return Promise.resolve();
    undoable.value = undoable.value.slice(0, -1);
    redoable.value = [...redoable.value, edit];
    return replay(edit, "before");
  }

  /** Makes again the edit that was last taken back. */
  function redo(): Promise<void> {
    const edit = redoable.value.at(-1);
    if (!edit || !canEdit.value) return Promise.resolve();
    redoable.value = redoable.value.slice(0, -1);
    undoable.value = [...undoable.value, edit];
    return replay(edit, "after");
  }

  async function load(spreadsheetId: string): Promise<void> {
    const snapshot = await api.getSnapshot(spreadsheetId);
    engine.value = createWorkbook(snapshot);
    spreadsheet.value = { id: snapshot.id, name: snapshot.name, role: snapshot.role };
    pages.value = snapshot.pages;
    tables.value = snapshot.tables;
    views.value = snapshot.views;
    selection.value = null;
    notice.value = null;
    forgetEdits();
  }

  /**
   * Reads the spreadsheet again after someone else changed it, and keeps the
   * selection where it still exists. Edits of this session can still be
   * taken back unless the pages or tables changed.
   */
  async function refresh(): Promise<void> {
    const open = spreadsheet.value;
    if (!open) return;
    // What was typed here is saved first, so that what comes back includes it.
    const queued = saves;
    await queued;
    const snapshot = await api.getSnapshot(open.id);
    // Something was typed while the spreadsheet was being read: read it again, with that in it.
    if (saves !== queued) return refresh();
    if (spreadsheet.value?.id !== open.id) return;

    const structure = (value: { pages: unknown; tables: unknown }): string =>
      JSON.stringify([value.pages, value.tables]);
    const restructured =
      structure(snapshot) !== structure({ pages: pages.value, tables: tables.value });
    engine.value = createWorkbook(snapshot);
    spreadsheet.value = { id: snapshot.id, name: snapshot.name, role: snapshot.role };
    pages.value = snapshot.pages;
    tables.value = snapshot.tables;
    views.value = snapshot.views;
    if (restructured) forgetEdits();

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
    const block = selectedBlock.value;
    const table = tables.value.find((candidate) => candidate.id === selection.value?.tableId);
    if (!block || !table || !canEdit.value) return Promise.resolve(false);
    const wholeRows = block.startRow === 0 && block.endRow >= table.rowCount - 1;
    const wholeCols = block.startCol === 0 && block.endCol >= table.colCount - 1;
    const range = {
      startRow: block.startRow,
      endRow: wholeRows ? null : block.endRow,
      startCol: block.startCol,
      endCol: wholeCols ? null : block.endCol,
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

  /**
   * Shows new inputs for cells of one table at once and saves them. Inputs
   * that fail to save are put back as they were. The change can be taken
   * back with `undo` unless `record` is false, as it is for an undo itself.
   */
  function setCells(tableId: string, writes: readonly CellInput[], record = true): Promise<void> {
    const changes = writes
      // A fill or paste that crosses a formula column leaves that column to its formula.
      .filter((write) => columnOf({ tableId, ...write })?.type !== "formula")
      .map((write) => ({ ...write, previous: engine.value.getInput({ tableId, ...write }) }))
      .filter((change) => change.previous !== change.input);
    if (changes.length === 0) return Promise.resolve();
    for (const { row, col, input } of changes) apply({ tableId, row, col }, input);
    if (record) {
      const cells = changes.map(({ row, col, previous, input }) => ({
        row,
        col,
        before: previous,
        after: input,
      }));
      undoable.value = [...undoable.value, { tableId, cells }].slice(-MAX_UNDO);
      redoable.value = [];
    }

    saves = saves.then(async () => {
      let saved = 0;
      try {
        // The server takes a limited number of cells per request.
        for (; saved < changes.length; saved += LIMITS.cellsPerRequest) {
          const batch = changes.slice(saved, saved + LIMITS.cellsPerRequest);
          await api.setCells(
            tableId,
            batch.map(({ row, col, input }) => ({ row, col, input })),
          );
        }
      } catch (cause) {
        for (const { row, col, input, previous } of changes.slice(saved)) {
          // A later edit to the same cell has its own save. Leave it alone.
          if (engine.value.getInput({ tableId, row, col }) === input) {
            apply({ tableId, row, col }, previous);
          }
        }
        fail(cause, "The change could not be saved");
      }
    });
    return saves;
  }

  /** Makes the selection a range from the selected cell to `address`. */
  function extendSelection(address: CellAddress): void {
    const anchor = selection.value;
    if (!anchor) return;
    const single = anchor.row === address.row && anchor.col === address.col;
    selectionEnd.value = single ? null : { row: address.row, col: address.col };
  }

  /** Fills `target` with the pattern of the cells in `source`, moving formula references. */
  function fill(tableId: string, source: Block, target: Block, series = false): Promise<void> {
    const inputAt = (cell: CellAddress): string => engine.value.getInput({ tableId, ...cell });
    return setCells(tableId, fillWrites(source, target, inputAt, series));
  }

  /** Empties the selected cells. */
  function clearSelection(): Promise<void> {
    const block = selectedBlock.value;
    const tableId = selection.value?.tableId;
    if (!block || tableId === undefined || !canEdit.value) return Promise.resolve();
    return setCells(
      tableId,
      clearWrites(block, (cell) => engine.value.getInput({ tableId, ...cell })),
    );
  }

  /**
   * Remembers the selected cells for pasting and returns the text to put on
   * the system clipboard: the values the cells show, which is what another
   * app can use. Pasting that text back here pastes the formulas.
   */
  function copySelection(): string {
    const block = selectedBlock.value;
    const tableId = selection.value?.tableId;
    if (!block || tableId === undefined) return "";
    const shown = inputsOf(block, (cell) =>
      formatValue(engine.value.getValue({ tableId, ...cell })),
    );
    const text = toClipboardText(shown);
    copied = {
      text,
      rows: inputsOf(block, (cell) => engine.value.getInput({ tableId, ...cell })),
      from: { row: block.startRow, col: block.startCol },
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
    await writeBlock(at, pasteWrites(own?.rows ?? fromClipboardText(text), at, own?.from));
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
    await writeBlock(at, pasteWrites(rows, at));
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
  async function writeBlock(at: CellId, writes: readonly CellInput[]): Promise<void> {
    const table = tables.value.find((candidate) => candidate.id === at.tableId);
    if (!table) return;
    if (writes.length === 0) return;
    const rowCount = Math.min(LIMITS.tableRows, Math.max(...writes.map((write) => write.row + 1)));
    const colCount = Math.min(LIMITS.tableCols, Math.max(...writes.map((write) => write.col + 1)));
    if (rowCount > table.rowCount || colCount > table.colCount) {
      const grown = await updateTable(table.id, {
        rowCount: Math.max(rowCount, table.rowCount),
        colCount: Math.max(colCount, table.colCount),
      });
      if (!grown) return;
    }

    const fitting = writes.filter((write) => write.row < rowCount && write.col < colCount);
    await setCells(table.id, fitting);
    // Leave what was pasted selected.
    extendSelection({ row: rowCount - 1, col: colCount - 1 });
    if (fitting.length < writes.length) {
      notice.value = { kind: "error", text: "Some cells did not fit in the table" };
    }
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

  /** Asks the server to run the button in a cell, then shows the cells it wrote. */
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
    try {
      // The server evaluates stored inputs, so pending edits must be stored first.
      await saves;
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
      await change();
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

  /** The ids of the tables, charts, and text views of a page, in the order they sit on it. */
  function itemsOn(pageId: string): string[] {
    return [...tables.value, ...views.value]
      .filter((item) => item.pageId === pageId)
      .sort((a, b) => a.position - b.position)
      .map((item) => item.id);
  }

  /** The last request to reorder a page, which the next one waits for. */
  let reorders: Promise<void> = Promise.resolve();

  /** Shows the items of a page in the order of their ids. */
  function showOrder(order: readonly string[]): void {
    const position = new Map(order.map((id, index) => [id, index]));
    const placed = <T extends { id: string; position: number }>(item: T): T => ({
      ...item,
      position: position.get(item.id) ?? item.position,
    });
    tables.value = tables.value.map(placed);
    views.value = views.value.map(placed);
  }

  /**
   * Moves a table, chart, or text view one place up or down its page. The
   * move shows at once, so a second click moves on from where the first left
   * the item, and it is undone if the server refuses.
   */
  function moveItem(pageId: string, itemId: string, by: -1 | 1): Promise<boolean> {
    const before = itemsOn(pageId);
    const from = before.indexOf(itemId);
    const to = from + by;
    if (from === -1 || to < 0 || to >= before.length) return Promise.resolve(false);
    const order = before.with(from, before[to] ?? itemId).with(to, itemId);
    showOrder(order);
    // One request at a time, so the server ends on the order of the last click.
    const sent = reorders.then(() => api.reorderPage(pageId, order));
    reorders = sent.catch(() => undefined);
    return attempt(async () => {
      try {
        await sent;
      } catch (cause) {
        showOrder(before);
        throw cause;
      }
    }, "The page could not be rearranged");
  }

  function deletePage(pageId: string): Promise<boolean> {
    return attempt(async () => {
      await api.deletePage(pageId);
      pages.value = pages.value.filter((page) => page.id !== pageId);
      tables.value = tables.value.filter((table) => table.pageId !== pageId);
      views.value = views.value.filter((view) => view.pageId !== pageId);
      if (selection.value && !hasTable(selection.value.tableId)) selection.value = null;
      syncStructure();
    }, "The page could not be deleted");
  }

  function addTable(pageId: string): Promise<boolean> {
    return attempt(async () => {
      tables.value = [...tables.value, await api.createTable(pageId)];
      syncStructure();
    }, "The table could not be added");
  }

  function updateTable(
    tableId: string,
    changes: { name?: string; rowCount?: number; colCount?: number },
  ): Promise<boolean> {
    return attempt(async () => {
      const { table: updated, ...rewritten } = await api.updateTable(tableId, changes);
      tables.value = tables.value.map((table) => (table.id === tableId ? updated : table));
      syncStructure();
      // After a rename, the server rewrote the formulas that named the table.
      applyRewritten(rewritten);
    }, "The table could not be changed");
  }

  /** Shows a table as the server now has it, with what the change rewrote elsewhere. */
  function showTable(updated: TableRecord, rewritten: Rewritten): void {
    tables.value = tables.value.map((table) => (table.id === updated.id ? updated : table));
    syncStructure();
    applyRewritten(rewritten);
  }

  /** Names a table's columns, which makes it a data table. With `headerRow`, its first row gives the names. */
  function nameColumns(tableId: string, headerRow: boolean): Promise<boolean> {
    return attempt(async () => {
      // The server may remove the header row, so pending edits must be stored first.
      await saves;
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
    return attempt(async () => {
      await saves;
      const { table, ...rewritten } = await api.updateColumn(tableId, col, changes);
      showTable(table, rewritten);
    }, "The column could not be changed");
  }

  /** Inserts or deletes a row or column, and shows the cells the server moved and rewrote. */
  function editTable(tableId: string, edit: StructuralEditBody): Promise<boolean> {
    return attempt(async () => {
      // The server shifts stored cells, so pending edits must be stored first.
      await saves;
      const { table: updated, ...rewritten } = await api.editTable(tableId, edit);
      tables.value = tables.value.map((table) => (table.id === tableId ? updated : table));
      syncStructure();
      applyRewritten(rewritten);

      const selected = selection.value;
      if (selected?.tableId === tableId) {
        selection.value = {
          tableId,
          row: Math.min(selected.row, updated.rowCount - 1),
          col: Math.min(selected.col, updated.colCount - 1),
        };
      }
    }, "The table could not be changed");
  }

  function addView(pageId: string, kind: ViewRecord["kind"]): Promise<boolean> {
    return attempt(async () => {
      views.value = [...views.value, await api.createView(pageId, kind)];
    }, "The view could not be added");
  }

  function updateView(
    viewId: string,
    changes: { name?: string; source?: string; chartType?: ChartType },
  ): Promise<boolean> {
    return attempt(async () => {
      const updated = await api.updateView(viewId, changes);
      views.value = views.value.map((view) => (view.id === viewId ? updated : view));
    }, "The view could not be changed");
  }

  function deleteView(viewId: string): Promise<boolean> {
    return attempt(async () => {
      await api.deleteView(viewId);
      views.value = views.value.filter((view) => view.id !== viewId);
    }, "The view could not be deleted");
  }

  function deleteTable(tableId: string): Promise<boolean> {
    return attempt(async () => {
      await api.deleteTable(tableId);
      tables.value = tables.value.filter((table) => table.id !== tableId);
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
    selectedBlock,
    extendSelection,
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
    itemsOn,
    moveItem,
    canUndo,
    canRedo,
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
