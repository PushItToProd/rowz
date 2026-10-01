import {
  cellKey,
  createWorkbook,
  formatAddress,
  Workbook,
  type CellId,
  type CellValue,
} from "@spreadsheet-app/engine";
import type { StructuralEditBody } from "@spreadsheet-app/shared";
import { defineStore } from "pinia";
import { computed, reactive, ref, shallowRef, triggerRef } from "vue";
import { api, type ClickResult, type PageRecord, type TableRecord } from "../api/client";

export interface Notice {
  kind: "success" | "error";
  text: string;
}

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
  const selection = ref<CellId | null>(null);
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
  }

  async function load(spreadsheetId: string): Promise<void> {
    const snapshot = await api.getSnapshot(spreadsheetId);
    engine.value = createWorkbook(snapshot);
    spreadsheet.value = { id: snapshot.id, name: snapshot.name, role: snapshot.role };
    pages.value = snapshot.pages;
    tables.value = snapshot.tables;
    selection.value = null;
    notice.value = null;
  }

  function valueOf(id: CellId): CellValue {
    return engine.value.getValue(id);
  }

  function inputOf(id: CellId): string {
    return engine.value.getInput(id);
  }

  /** Shows the new input at once and saves it. A failed save puts the old input back. */
  function setCell(id: CellId, input: string): Promise<void> {
    const previous = engine.value.getInput(id);
    if (previous === input) return Promise.resolve();
    apply(id, input);

    saves = saves.then(async () => {
      try {
        await api.setCells(id.tableId, [{ row: id.row, col: id.col, input }]);
      } catch (cause) {
        // A later edit to the same cell has its own save. Leave it alone.
        if (engine.value.getInput(id) === input) apply(id, previous);
        fail(cause, "The change could not be saved");
      }
    });
    return saves;
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
    const written = result.cells.map((cell) => nameOf(cell, buttonTableId)).join(", ");
    return { kind: "success", text: written === "" ? "Done" : `Updated ${written}` };
  }

  /** Asks the server to run the button in a cell, then shows the cells it wrote. */
  async function click(id: CellId): Promise<void> {
    const key = cellKey(id);
    if (running.has(key) || !canEdit.value) return;
    running.add(key);
    try {
      // The server evaluates stored inputs, so pending edits must be stored first.
      await saves;
      const result = await api.click(id);
      for (const cell of result.cells) apply(cell, cell.input);
      notice.value = describe(result, id.tableId);
    } catch (cause) {
      fail(cause, "The action could not be run");
    } finally {
      running.delete(key);
    }
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
      const { cells } = await api.renamePage(pageId, name);
      pages.value = pages.value.map((page) => (page.id === pageId ? { ...page, name } : page));
      syncStructure();
      // The server rewrote the formulas that named the page.
      for (const cell of cells) apply(cell, cell.input);
    }, "The page could not be renamed");
  }

  function deletePage(pageId: string): Promise<boolean> {
    return attempt(async () => {
      await api.deletePage(pageId);
      pages.value = pages.value.filter((page) => page.id !== pageId);
      tables.value = tables.value.filter((table) => table.pageId !== pageId);
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
      const { table: updated, cells } = await api.updateTable(tableId, changes);
      tables.value = tables.value.map((table) => (table.id === tableId ? updated : table));
      syncStructure();
      // After a rename, the server rewrote the formulas that named the table.
      for (const cell of cells) apply(cell, cell.input);
    }, "The table could not be changed");
  }

  /** Inserts or deletes a row or column, and shows the cells the server moved and rewrote. */
  function editTable(tableId: string, edit: StructuralEditBody): Promise<boolean> {
    return attempt(async () => {
      // The server shifts stored cells, so pending edits must be stored first.
      await saves;
      const { table: updated, cells } = await api.editTable(tableId, edit);
      tables.value = tables.value.map((table) => (table.id === tableId ? updated : table));
      syncStructure();
      for (const cell of cells) apply(cell, cell.input);

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
    selection,
    notice,
    running,
    canEdit,
    load,
    valueOf,
    inputOf,
    setCell,
    click,
    renameSpreadsheet,
    addPage,
    renamePage,
    deletePage,
    addTable,
    updateTable,
    editTable,
    deleteTable,
  };
});
