import { createWorkbook, type CellId } from "@spreadsheet-app/engine";
import { keyBetween, type IdentifiedCell } from "@spreadsheet-app/shared";
import {
  api,
  type Change,
  type ChangedContent,
  type PageRecord,
  type Snapshot,
  type ViewRecord,
} from "../../api/client";
import type { WorkbookContext } from "./context";

export function createSync(context: WorkbookContext) {
  // The server answers reads in any order. Each read takes a number, and one
  // that ends after a later read began is dropped, so the editor ends on the
  // newest. A refresh is also dropped when a load began after it did.
  let loads = 0;

  let refreshes = 0;

  function hasTable(tableId: string): boolean {
    return context.tables.value.some((table) => table.id === tableId);
  }

  function identityOf(id: CellId): IdentifiedCell | undefined {
    const table = context.tables.value.find((candidate) => candidate.id === id.tableId);
    if (!table?.rows) return undefined;
    const identity = context.layouts.value.get(id.tableId)?.identity(id);
    return identity && { tableId: table.id, ...identity };
  }

  function positionOf(id: IdentifiedCell): CellId | undefined {
    const table = context.tables.value.find((candidate) => candidate.id === id.tableId);
    if (!table?.rows) return undefined;
    const position = context.layouts.value.get(id.tableId)?.position(id);
    return position && position.row < table.rowCount && position.col < table.colCount
      ? { tableId: table.id, ...position }
      : undefined;
  }

  function withStableSelection(change: () => void): void {
    const anchor = context.selection.value && identityOf(context.selection.value);
    const end =
      context.selection.value &&
      context.selectionEnd.value &&
      identityOf({ tableId: context.selection.value.tableId, ...context.selectionEnd.value });
    change();
    if (anchor) {
      context.selection.value = positionOf(anchor) ?? null;
      context.selectionEnd.value =
        context.selection.value && end ? (positionOf(end) ?? null) : null;
    }
  }

  /** Rebuild positions from identities, then overlay edits whose requests have not settled. */
  function syncStructure(): void {
    context.tables.value = context.tables.value.map((table) => {
      const ordered = [...context.rows.values()]
        .filter((row) => row.tableId === table.id)
        .sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0));
      const present = new Set(ordered.map((row) => row.id));
      for (const pending of context.pendingRows.values()) {
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
    const visible = new Map(context.inputs);
    for (const { tableId, changes } of context.unsavedChanges) {
      for (const change of changes) {
        const cell = { tableId, ...change };
        visible.set(context.cellIdentityKey(cell), cell);
      }
    }
    const cells = [...visible.values()].flatMap((cell) => {
      const position = positionOf(cell);
      return position ? [{ ...position, input: cell.input }] : [];
    });
    context.engine.value = createWorkbook({
      pages: context.pages.value,
      tables: context.tables.value,
      scripts: context.views.value.filter((view) => view.kind === "script"),
      names: context.tables.value.flatMap((table) =>
        table.names.map(({ name, formula }) => ({ holderId: table.id, name, formula })),
      ),
      cells,
    });
  }

  function installSnapshot(snapshot: Snapshot): void {
    context.revision.value = snapshot.revision;
    context.inputs.clear();
    for (const cell of snapshot.cells) context.inputs.set(context.cellIdentityKey(cell), cell);
    context.rows.clear();
    for (const row of snapshot.rows) context.rows.set(`${row.tableId}:${row.id}`, row);
    context.spreadsheet.value = { id: snapshot.id, name: snapshot.name, role: snapshot.role };
    context.pages.value = snapshot.pages;
    context.tables.value = snapshot.tables.map((table) => ({
      ...table,
      rows: [],
      rowCount: 0,
      colCount: table.colIds.length,
    }));
    context.views.value = snapshot.views;
    context.undoable.value = snapshot.undoable;
    context.redoable.value = snapshot.redoable;
    syncStructure();
    context.rememberOrders();
    context.showPendingOrders();
  }

  /** Responses and events share this path. A missing revision requires a fresh snapshot. */
  async function receiveChange(change: Change): Promise<void> {
    if (change.revision <= context.revision.value) return;
    if (change.revision !== context.revision.value + 1 || change.changed === null) {
      await refresh();
      return;
    }
    const content = change.changed;
    withStableSelection(() => {
      applyChanged(content);
      context.revision.value = change.revision;
    });
  }

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
      while (context.unanswered.size > 0) await Promise.allSettled(context.unanswered);
      const before = context.begun;
      const snapshot = await api.getSnapshot(spreadsheetId);
      if (!wanted()) return undefined;
      // Something was changed, undone, or redone here while the spreadsheet was
      // being read, and its result may be newer than what was read: read again.
      if (context.begun === before) return snapshot;
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
    context.selection.value = null;
    context.notice.value = null;
  }

  /**
   * Reads the spreadsheet again after someone else changed it, and keeps the
   * selection where it still exists, and refreshes this tab's undo state.
   */
  async function refresh(): Promise<void> {
    const open = context.spreadsheet.value;
    if (!open) return;
    const [turn, loaded] = [++refreshes, loads];
    const snapshot = await api.getSnapshot(open.id);
    if (
      turn !== refreshes ||
      loaded !== loads ||
      context.spreadsheet.value?.id !== open.id ||
      snapshot.revision < context.revision.value
    )
      return;

    const anchored = context.selection.value && identityOf(context.selection.value);
    const end =
      context.selection.value &&
      context.selectionEnd.value &&
      identityOf({ tableId: context.selection.value.tableId, ...context.selectionEnd.value });
    installSnapshot(snapshot);

    const selected = anchored && positionOf(anchored);
    context.selection.value = selected ?? null;
    context.selectionEnd.value = selected && end ? (positionOf(end) ?? null) : null;
  }

  /** Applies the content the server restored, then keeps or moves the selection. */
  function applyChanged(changed: ChangedContent): void {
    // Start from confirmed positions before merging an earlier reorder response.
    if (context.optimisticPageOrder && context.acceptedPageOrder)
      context.showPageOrder(context.acceptedPageOrder);
    for (const pageId of context.optimisticBlockOrders.keys())
      context.showOrder(context.acceptedBlockOrders.get(pageId) ?? []);
    const pageRecords = new Map(changed.pages.map(({ id, page }) => [id, page]));
    context.pages.value = [
      ...context.pages.value.filter((page) => !pageRecords.has(page.id)),
      ...[...pageRecords.values()].filter((page): page is PageRecord => page !== null),
    ].sort((left, right) => left.position - right.position);

    const tableRecords = new Map(changed.tables.map(({ id, table }) => [id, table]));
    context.tables.value = [
      ...context.tables.value.filter((table) => !tableRecords.has(table.id)),
      ...[...tableRecords.values()].flatMap((table) =>
        table ? [{ ...table, rows: [], rowCount: 0, colCount: table.colIds.length }] : [],
      ),
    ].sort(
      (left, right) => left.pageId.localeCompare(right.pageId) || left.position - right.position,
    );

    const viewRecords = new Map(changed.views.map(({ id, view }) => [id, view]));
    context.views.value = [
      ...context.views.value.filter((view) => !viewRecords.has(view.id)),
      ...[...viewRecords.values()].filter((view): view is ViewRecord => view !== null),
    ].sort(
      (left, right) => left.pageId.localeCompare(right.pageId) || left.position - right.position,
    );

    for (const row of changed.rows) {
      if (row.orderKey === null) context.rows.delete(`${row.tableId}:${row.id}`);
      else context.rows.set(`${row.tableId}:${row.id}`, { ...row, orderKey: row.orderKey });
    }
    for (const cell of changed.cells) {
      if (cell.input === "") context.inputs.delete(context.cellIdentityKey(cell));
      else context.inputs.set(context.cellIdentityKey(cell), cell);
    }
    for (const [key, cell] of context.inputs) {
      const table = context.tables.value.find((table) => table.id === cell.tableId);
      if (!context.rows.has(`${cell.tableId}:${cell.rowId}`) || !table?.colIds.includes(cell.colId))
        context.inputs.delete(key);
    }
    syncStructure();

    context.rememberOrders();
    context.showPendingOrders();
  }
  return {
    hasTable,
    identityOf,
    positionOf,
    withStableSelection,
    syncStructure,
    receiveChange,
    load,
    refresh,
  };
}
