import { formatAddress, type CellId } from "@spreadsheet-app/engine";
import { LIMITS } from "@spreadsheet-app/shared";
import { useWorkbookStore } from "../stores/workbook";
import type { EditingTarget, StartEditing } from "./session";

export function cellEditingRequest(id: CellId, initial?: string): StartEditing | undefined {
  const store = useWorkbookStore();
  const table = store.tables.find((table) => table.id === id.tableId);
  const colId = table?.colIds[id.col];
  if (!table || !colId) return;
  const identity = store.identityOf(id);
  const column = table.columns?.[id.col];
  const target: EditingTarget | undefined =
    column?.type === "formula"
      ? { kind: "column", tableId: table.id, colId }
      : identity
        ? { kind: "cell", ...identity }
        : table.columns && id.row === table.rowCount
          ? { kind: "append", tableId: table.id, colId }
          : undefined;
  if (!target) return;
  const context = { pageId: table.pageId, tableId: table.id, rowId: identity?.rowId };
  return {
    target,
    context,
    mode: target.kind === "column" ? "formula" : "cell",
    text: initial ?? store.inputOf(id),
    label: editingLabel(target),
    maxLength: LIMITS.inputLength,
  };
}

export function editingLabel(target: EditingTarget): string | undefined {
  const store = useWorkbookStore();
  if ("viewId" in target) {
    const view = store.views.find((view) => view.id === target.viewId);
    if (!view) return;
    const page = store.pages.find((page) => page.id === view.pageId)?.name ?? "Page";
    const label =
      target.kind === "script"
        ? "Script source"
        : target.kind === "markdown"
          ? "Text view source"
          : "Chart data";
    return `${page} · ${view.name} · ${label}`;
  }
  const table = store.tables.find((table) => table.id === target.tableId);
  if (!table) return;
  const page = store.pages.find((page) => page.id === table.pageId)?.name ?? "Page";
  if (target.kind === "column") {
    const column = table.columns?.[table.colIds.indexOf(target.colId)];
    return `Editing formula for every row in ${table.name}[${column?.name ?? "deleted column"}]`;
  }
  if (target.kind === "cell") {
    const position = store.positionOf(target);
    return position ? `${page} · ${table.name} · ${formatAddress(position)}` : undefined;
  }
  if (target.kind === "append") return `${page} · ${table.name} · New row`;
}
