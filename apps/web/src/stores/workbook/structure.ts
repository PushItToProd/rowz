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
  type UpdateTableBody,
} from "@spreadsheet-app/shared";
import { api, type PageRecord, type ViewRecord } from "../../api/client";
import type { PageLayout, WorkbookContext } from "./context";

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

  /**
   * The ids of what sits on a page itself, in order: its rows of blocks, and
   * the tables and views that are in no row.
   */
  function blocksOn(pageId: string): string[] {
    return layoutOf(pageId).blocks;
  }

  /** Where everything on a page sits: on the page itself, or in one of its rows of blocks. */
  function layoutOf(pageId: string): PageLayout {
    const inOrder = (blocks: { id: string; position: number }[]): string[] =>
      blocks.sort((a, b) => a.position - b.position).map((block) => block.id);
    const leaves = [...context.tables.value, ...context.views.value].filter(
      (block) => block.pageId === pageId,
    );
    const rows = context.blockRows.value.filter((row) => row.pageId === pageId);
    const held = new Set(rows.map((row) => row.id));
    return {
      // A block whose row is gone sits on the page.
      blocks: inOrder([
        ...leaves.filter((leaf) => leaf.blockRowId === null || !held.has(leaf.blockRowId)),
        ...rows,
      ]),
      rows: rows.map((row) => ({
        id: row.id,
        blocks: inOrder(leaves.filter((leaf) => leaf.blockRowId === row.id)),
      })),
    };
  }

  function rememberOrders(): void {
    context.acceptedPageOrder = context.pages.value.map((page) => page.id);
    for (const page of context.pages.value)
      context.acceptedBlockOrders.set(page.id, layoutOf(page.id));
    for (const pageId of context.acceptedBlockOrders.keys()) {
      if (!context.pages.value.some((page) => page.id === pageId))
        context.acceptedBlockOrders.delete(pageId);
    }
  }

  function showPendingOrders(): void {
    if (context.optimisticPageOrder) showPageOrder(context.optimisticPageOrder);
    for (const layout of context.optimisticBlockOrders.values()) showLayout(layout);
  }

  /** Shows the blocks of a page where a layout puts them. A block the layout leaves out stays put. */
  function showLayout(layout: PageLayout): void {
    const places = new Map<string, { position: number; blockRowId: string | null }>();
    for (const [position, id] of layout.blocks.entries())
      places.set(id, { position, blockRowId: null });
    for (const row of layout.rows) {
      for (const [position, id] of row.blocks.entries())
        places.set(id, { position, blockRowId: row.id });
    }
    const placed = <T extends { id: string }>(block: T): T => ({
      ...block,
      ...places.get(block.id),
    });
    context.tables.value = context.tables.value.map(placed);
    context.views.value = context.views.value.map(placed);
    context.blockRows.value = context.blockRows.value.map((row) => ({
      ...row,
      position: places.get(row.id)?.position ?? row.position,
    }));
  }

  /**
   * Puts the blocks of a page where a layout says. The layout shows at once,
   * so a second click moves on from where the first left a block, and it is
   * undone if the server refuses.
   */
  function arrange(pageId: string, layout: PageLayout): Promise<boolean> {
    const before = layoutOf(pageId);
    showLayout(layout);
    context.optimisticBlockOrders.set(pageId, layout);
    const previous = reorders;
    pendingBlockReorders.set(pageId, (pendingBlockReorders.get(pageId) ?? 0) + 1);
    const sent = context
      .attempt(async () => {
        await previous;
        const change = await api.reorderPage(pageId, layout);
        await context.receiveChange(change);
        if (context.revision.value === change.revision)
          context.acceptedBlockOrders.set(pageId, layout);
      }, "The page could not be rearranged")
      .then((succeeded) => {
        const pending = (pendingBlockReorders.get(pageId) ?? 1) - 1;
        if (pending === 0) {
          pendingBlockReorders.delete(pageId);
          context.optimisticBlockOrders.delete(pageId);
          showLayout(context.acceptedBlockOrders.get(pageId) ?? before);
        } else pendingBlockReorders.set(pageId, pending);
        return succeeded;
      });
    // One request at a time, so the server ends on the arrangement of the last click.
    reorders = sent.then(() => undefined);
    return sent;
  }

  /** A layout with the blocks of one row, or of the page itself for `null`, replaced. */
  function withBlocks(layout: PageLayout, blockRowId: string | null, blocks: string[]): PageLayout {
    if (blockRowId === null) return { ...layout, blocks };
    return {
      ...layout,
      rows: layout.rows.map((row) => (row.id === blockRowId ? { ...row, blocks } : row)),
    };
  }

  /** The row of blocks a block sits in, or `null` for one that sits on its page. */
  function blockRowOf(layout: PageLayout, blockId: string): string | null {
    return layout.rows.find((row) => row.blocks.includes(blockId))?.id ?? null;
  }

  /**
   * Moves a block one place among the blocks beside it: up or down its page,
   * or left or right in its row of blocks.
   */
  function moveBlock(pageId: string, blockId: string, by: -1 | 1): Promise<boolean> {
    const layout = layoutOf(pageId);
    const blockRowId = blockRowOf(layout, blockId);
    const beside =
      blockRowId === null
        ? layout.blocks
        : (layout.rows.find((row) => row.id === blockRowId)?.blocks ?? []);
    const from = beside.indexOf(blockId);
    const to = from + by;
    if (from === -1 || to < 0 || to >= beside.length) return Promise.resolve(false);
    const order = beside.with(from, beside[to] ?? blockId).with(to, blockId);
    return arrange(pageId, withBlocks(layout, blockRowId, order));
  }

  /**
   * Moves a block to a gap on its page: before the block at `index` among
   * those on the page itself, or among those of a row of blocks. `index`
   * counts the blocks as they are now, the moved one included. A row of
   * blocks moves on the page only.
   */
  function placeBlock(
    pageId: string,
    blockId: string,
    blockRowId: string | null,
    index: number,
  ): Promise<boolean> {
    const layout = layoutOf(pageId);
    const blocksOf = (from: PageLayout, rowId: string | null): string[] | undefined =>
      rowId === null ? from.blocks : from.rows.find((row) => row.id === rowId)?.blocks;
    const from = blockRowOf(layout, blockId);
    const was = blocksOf(layout, from)?.indexOf(blockId) ?? -1;
    const isRow = layout.rows.some((row) => row.id === blockId);
    if (was === -1 || (isRow && blockRowId !== null)) return Promise.resolve(false);
    const without: PageLayout = {
      blocks: layout.blocks.filter((id) => id !== blockId),
      rows: layout.rows.map((row) => ({
        id: row.id,
        blocks: row.blocks.filter((id) => id !== blockId),
      })),
    };
    const beside = blocksOf(without, blockRowId);
    if (!beside) return Promise.resolve(false);
    // Taking the block out of its place shifts the gaps after it by one.
    const gap = from === blockRowId && was < index ? index - 1 : index;
    const at = Math.max(0, Math.min(beside.length, gap));
    if (from === blockRowId && at === was) return Promise.resolve(false);
    return arrange(pageId, withBlocks(without, blockRowId, beside.toSpliced(at, 0, blockId)));
  }

  /** Moves a table or view to the end of a row of blocks on its page. */
  function moveBlockIntoRow(pageId: string, blockId: string, blockRowId: string): Promise<boolean> {
    const layout = layoutOf(pageId);
    const from = blockRowOf(layout, blockId);
    const target = layout.rows.find((row) => row.id === blockRowId);
    const placed = [...layout.blocks, ...layout.rows.flatMap((row) => row.blocks)];
    const isRow = layout.rows.some((row) => row.id === blockId);
    if (!target || from === blockRowId || isRow || !placed.includes(blockId))
      return Promise.resolve(false);
    const without = (blocks: string[]): string[] => blocks.filter((id) => id !== blockId);
    return arrange(pageId, {
      blocks: without(layout.blocks),
      rows: layout.rows.map((row) => ({
        id: row.id,
        blocks: row.id === blockRowId ? [...row.blocks, blockId] : without(row.blocks),
      })),
    });
  }

  /** Moves a table or view out of its row of blocks, to the place on the page just after the row. */
  function moveBlockOutOfRow(pageId: string, blockId: string): Promise<boolean> {
    const layout = layoutOf(pageId);
    const blockRowId = blockRowOf(layout, blockId);
    if (blockRowId === null) return Promise.resolve(false);
    const after = layout.blocks.indexOf(blockRowId) + 1;
    return arrange(pageId, {
      blocks: layout.blocks.toSpliced(after, 0, blockId),
      rows: layout.rows.map((row) => ({
        id: row.id,
        blocks: row.blocks.filter((id) => id !== blockId),
      })),
    });
  }

  function addBlockRow(pageId: string, position?: number): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange((await api.createBlockRow(pageId, position)).change);
    }, "The row of blocks could not be added");
  }

  function renameBlockRow(blockRowId: string, name: string): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange(await api.renameBlockRow(blockRowId, name));
    }, "The row of blocks could not be renamed");
  }

  /** Removes a row of blocks and leaves what it held in its place on the page. */
  function ungroupBlockRow(blockRowId: string): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange(await api.ungroupBlockRow(blockRowId));
    }, "The row of blocks could not be ungrouped");
  }

  /** Deletes a row of blocks and the tables and views in it. */
  function deleteBlockRow(blockRowId: string): Promise<boolean> {
    const queuedSaves = context.saves;
    return context.attempt(async () => {
      // The row's tables go with it, so pending edits to them must be stored first.
      await queuedSaves;
      await context.receiveChange(await api.deleteBlockRow(blockRowId));
    }, "The row of blocks could not be deleted");
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

  /** Adds a table at a place on a page, or in one of its rows of blocks. */
  function addTable(pageId: string, position?: number, blockRowId?: string): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange((await api.createTable(pageId, position, blockRowId)).change);
    }, "The table could not be added");
  }

  function updateTable(tableId: string, changes: UpdateTableBody): Promise<boolean> {
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

  /** Adds a view at a place on a page, or in one of its rows of blocks. */
  function addView(
    pageId: string,
    kind: ViewRecord["kind"],
    position?: number,
    blockRowId?: string,
  ): Promise<boolean> {
    return context.attempt(async () => {
      await context.receiveChange(
        (await api.createView(pageId, kind, position, blockRowId)).change,
      );
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
      const change = await api.restoreVersion(spreadsheetId, versionId);
      if (context.notice.value?.dismissOnHistoryChange) context.notice.value = null;
      await context.receiveChange(change);
    });
  }
  return {
    setTableDisplay,
    setTableNames,
    renameSpreadsheet,
    addPage,
    renamePage,
    blocksOn,
    layoutOf,
    rememberOrders,
    showPendingOrders,
    showLayout,
    moveBlock,
    moveBlockIntoRow,
    moveBlockOutOfRow,
    placeBlock,
    addBlockRow,
    renameBlockRow,
    ungroupBlockRow,
    deleteBlockRow,
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
