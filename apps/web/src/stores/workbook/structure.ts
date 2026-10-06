import {
  type ChartType,
  type ColumnType,
  type SortKey,
  type TableName,
} from "@spreadsheet-app/engine";
import {
  LIMITS,
  type IdentifiedStructuralEditBody,
  type StructuralEditBody,
} from "@spreadsheet-app/shared";
import { api, type PageRecord, type ViewRecord } from "../../api/client";
import type { WorkbookContext } from "./context";

export function createStructure(context: WorkbookContext) {
  const pendingPageReorders = new Map<string, number>();

  const pendingBlockReorders = new Map<string, number>();

  const viewUpdates = new Map<string, Promise<boolean>>();

  /** The last request to reorder a page, which the next one waits for. */
  let reorders: Promise<void> = Promise.resolve();

  /** The last request to reorder the pages, which the next one waits for. */
  let pageReorders: Promise<void> = Promise.resolve();

  /**
   * Replaces how a data table's rows are shown. The sort and filter are
   * display settings, and the stored rows stay as they are.
   */
  function setTableDisplay(
    tableId: string,
    display: { sort: SortKey[]; filter?: string },
    writtenAt = context.revision.value,
  ): Promise<boolean> {
    if (!context.canEdit.value) return Promise.resolve(false);
    return context.attempt(async () => {
      await context.receiveChange(await api.setTableDisplay(tableId, display, writtenAt));
    }, "The sort and filter could not be saved");
  }

  /** Replaces the names a plain table holds. */
  function setTableNames(tableId: string, names: TableName[]): Promise<boolean> {
    if (!context.canEdit.value) return Promise.resolve(false);
    return context.attempt(async () => {
      await context.receiveChange(await api.setTableNames(tableId, names));
    }, "The names could not be saved");
  }

  async function renameSpreadsheet(name: string): Promise<void> {
    const current = context.spreadsheet.value;
    if (!current) return;
    await context.attempt(async () => {
      await api.renameSpreadsheet(current.id, name);
      context.spreadsheet.value = { ...current, name };
    }, "The document could not be renamed");
  }

  async function addPage(): Promise<PageRecord | undefined> {
    const current = context.spreadsheet.value;
    if (!current) return undefined;
    let created: PageRecord | undefined;
    await context.attempt(async () => {
      const { page, change } = await api.createPage(current.id);
      await context.receiveChange(change);
      created = page;
    }, "The page could not be added");
    return created;
  }

  function renamePage(pageId: string, name: string): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange(await api.renamePage(pageId, name));
    }, "The page could not be renamed");
  }

  /** The ids of the blocks of a page, in the order they sit on it. */
  function blocksOn(pageId: string): string[] {
    return [...context.tables.value, ...context.views.value]
      .filter((block) => block.pageId === pageId)
      .sort((a, b) => a.position - b.position)
      .map((block) => block.id);
  }

  function rememberOrders(): void {
    context.acceptedPageOrder = context.pages.value.map((page) => page.id);
    for (const page of context.pages.value)
      context.acceptedBlockOrders.set(page.id, blocksOn(page.id));
    for (const pageId of context.acceptedBlockOrders.keys()) {
      if (!context.pages.value.some((page) => page.id === pageId))
        context.acceptedBlockOrders.delete(pageId);
    }
  }

  function showPendingOrders(): void {
    if (context.optimisticPageOrder) showPageOrder(context.optimisticPageOrder);
    for (const order of context.optimisticBlockOrders.values()) showOrder(order);
  }

  /** Shows the blocks of a page in the order of their ids. */
  function showOrder(order: readonly string[]): void {
    const position = new Map(order.map((id, index) => [id, index]));
    const placed = <T extends { id: string; position: number }>(block: T): T => ({
      ...block,
      position: position.get(block.id) ?? block.position,
    });
    context.tables.value = context.tables.value.map(placed);
    context.views.value = context.views.value.map(placed);
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
    context.optimisticBlockOrders.set(pageId, order);
    const previous = reorders;
    pendingBlockReorders.set(pageId, (pendingBlockReorders.get(pageId) ?? 0) + 1);
    const sent = context
      .attempt(async () => {
        await previous;
        const change = await api.reorderPage(pageId, order);
        await context.receiveChange(change);
        if (context.revision.value === change.revision)
          context.acceptedBlockOrders.set(pageId, order);
      }, "The page could not be rearranged")
      .then((succeeded) => {
        const pending = (pendingBlockReorders.get(pageId) ?? 1) - 1;
        if (pending === 0) {
          pendingBlockReorders.delete(pageId);
          context.optimisticBlockOrders.delete(pageId);
          showOrder(context.acceptedBlockOrders.get(pageId) ?? before);
        } else pendingBlockReorders.set(pageId, pending);
        return succeeded;
      });
    // One request at a time, so the server ends on the order of the last click.
    reorders = sent.then(() => undefined);
    return sent;
  }

  /** Shows the pages in the order of their ids. */
  function showPageOrder(order: readonly string[]): void {
    const byId = new Map(context.pages.value.map((page) => [page.id, page]));
    context.pages.value = order.flatMap((id, position) => {
      const page = byId.get(id);
      return page ? [{ ...page, position }] : [];
    });
  }

  /**
   * Moves a page one place left or right among the tabs. As with a block,
   * the move shows at once and is undone if the server refuses.
   */
  function movePage(pageId: string, by: -1 | 1): Promise<boolean> {
    const current = context.spreadsheet.value;
    const before = context.pages.value.map((page) => page.id);
    const from = before.indexOf(pageId);
    const to = from + by;
    if (!current || from === -1 || to < 0 || to >= before.length) return Promise.resolve(false);
    const order = before.with(from, before[to] ?? pageId).with(to, pageId);
    showPageOrder(order);
    context.optimisticPageOrder = order;
    const previous = pageReorders;
    pendingPageReorders.set(current.id, (pendingPageReorders.get(current.id) ?? 0) + 1);
    const sent = context
      .attempt(async () => {
        await previous;
        const change = await api.reorderPages(current.id, order);
        await context.receiveChange(change);
        if (context.revision.value === change.revision) context.acceptedPageOrder = order;
      }, "The pages could not be rearranged")
      .then((succeeded) => {
        const pending = (pendingPageReorders.get(current.id) ?? 1) - 1;
        if (pending === 0) {
          pendingPageReorders.delete(current.id);
          context.optimisticPageOrder = undefined;
          showPageOrder(context.acceptedPageOrder ?? before);
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
    const queuedSaves = context.saves;
    return context.attempt(async () => {
      // The server rewrites stored formulas, so pending edits must be stored first.
      await queuedSaves;
      const name =
        [...context.tables.value, ...context.views.value].find((block) => block.id === blockId)
          ?.name ?? "Block";
      await context.receiveChange(
        await (context.hasTable(blockId)
          ? api.moveTable(blockId, pageId)
          : api.moveView(blockId, pageId)),
      );
      if (context.selection.value?.tableId === blockId) context.selection.value = null;
      const page = context.pages.value.find((candidate) => candidate.id === pageId);
      context.notice.value = {
        kind: "success",
        text: `Moved ${name} to ${page?.name ?? "the page"}`,
      };
    }, "The block could not be moved");
  }

  function deletePage(pageId: string): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange(await api.deletePage(pageId));
    }, "The page could not be deleted");
  }

  function addTable(pageId: string, position?: number): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange((await api.createTable(pageId, position)).change);
    }, "The table could not be added");
  }

  function updateTable(
    tableId: string,
    changes: { name?: string; rowCount?: number; colCount?: number },
  ): Promise<boolean> {
    const queuedSaves = context.saves;
    return context.attempt(async () => {
      // A smaller table loses cells, so pending edits must be stored first.
      await queuedSaves;
      await context.receiveChange(await api.updateTable(tableId, changes));
    }, "The table could not be changed");
  }

  /** Whether the table can grow to these dimensions under the shared limits. */
  function canResizeTableTo(
    tableId: string,
    size: { rowCount: number; colCount: number },
  ): boolean {
    const table = context.tables.value.find((candidate) => candidate.id === tableId);
    if (!context.canEdit.value || !table) return false;
    if (size.rowCount < table.rowCount || size.colCount < table.colCount) return false;
    if (size.rowCount === table.rowCount && size.colCount === table.colCount) return false;
    const otherRows = context.tables.value.reduce(
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
    const queuedSaves = context.saves;
    return context
      .enqueueWrite(async () => {
        await queuedSaves;
        const table = context.tables.value.find((candidate) => candidate.id === tableId);
        if (!table) return false;
        const target = {
          rowCount: Math.max(table.rowCount, size.rowCount),
          colCount: Math.max(table.colCount, size.colCount),
        };
        if (!canResizeTableTo(tableId, target)) return false;
        await context.receiveChange(await api.updateTable(tableId, { ...target, grow: true }));
        return true;
      })
      .catch((cause: unknown) => {
        context.fail(cause, "The table could not be changed");
        return false;
      });
  }

  /** Names a table's columns, which makes it a data table. With `headerRow`, its first row gives the names. */
  function nameColumns(tableId: string, headerRow: boolean): Promise<boolean> {
    const queuedSaves = context.saves;
    return context.attempt(async () => {
      // The server may remove the header row, so pending edits must be stored first.
      await queuedSaves;
      await context.receiveChange(await api.nameColumns(tableId, headerRow));
    }, "The columns could not be named");
  }

  /** Makes a data table a plain table again. */
  function dropColumns(tableId: string): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange(await api.dropColumns(tableId));
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
    writtenAt = context.revision.value,
  ): Promise<boolean> {
    const colId = context.tables.value.find((table) => table.id === tableId)?.colIds[col];
    if (!colId) return Promise.resolve(false);
    const queuedSaves = context.saves;
    return context.attempt(async () => {
      await queuedSaves;
      await context.receiveChange(
        await api.updateColumn(tableId, colId, { ...changes, revision: writtenAt }),
      );
    }, "The column could not be changed");
  }

  /** Inserts or deletes a row or column, and shows the cells the server moved and rewrote. */
  function editTable(tableId: string, edit: StructuralEditBody): Promise<boolean> {
    const layout = context.layouts.value.get(tableId);
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
    const queuedSaves = context.saves;
    return context.attempt(async () => {
      // The server shifts stored cells, so pending edits must be stored first.
      await queuedSaves;
      await context.receiveChange(await api.editTable(tableId, request));
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
    const layout = context.layouts.value.get(tableId);
    if (!layout) return Promise.resolve(false);
    const all = axis === "row" ? layout.rowIds : layout.colIds;
    const ids = [...new Set(indexes)].flatMap((index) => all[index] ?? []);
    if (ids.length === 0) return Promise.resolve(false);
    const queuedSaves = context.saves;
    return context.attempt(async () => {
      // The server shifts stored cells, so pending edits must be stored first.
      await queuedSaves;
      await context.receiveChange(await api.editTable(tableId, { axis, kind: "delete", ids }));
    }, "The table could not be changed");
  }

  function addView(pageId: string, kind: ViewRecord["kind"], position?: number): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange((await api.createView(pageId, kind, position)).change);
    }, "The view could not be added");
  }

  function updateView(
    viewId: string,
    changes: { name?: string; source?: string; chartType?: ChartType },
    writtenAt = context.revision.value,
  ): Promise<boolean> {
    const previous = viewUpdates.get(viewId) ?? Promise.resolve(true);
    const updated = context.attempt(async () => {
      await previous;
      await context.receiveChange(
        await api.updateView(viewId, { ...changes, revision: writtenAt }),
      );
    }, "The view could not be changed");
    viewUpdates.set(viewId, updated);
    void updated.then(() => {
      if (viewUpdates.get(viewId) === updated) viewUpdates.delete(viewId);
    });
    return updated;
  }

  function deleteView(viewId: string): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange(await api.deleteView(viewId));
    }, "The view could not be deleted");
  }

  function deleteTable(tableId: string): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange(await api.deleteTable(tableId));
    }, "The table could not be deleted");
  }

  function restoreVersion(spreadsheetId: string, versionId: string): Promise<void> {
    return context.enqueueWrite(async () => {
      await context.receiveChange(await api.restoreVersion(spreadsheetId, versionId));
    });
  }
  return {
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
  };
}
