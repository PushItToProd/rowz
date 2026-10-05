import { onBeforeUnmount } from "vue";
import type { TableRecord } from "../api/client";
import { useReferencePickingStore, type GridPick } from "./picking";

function isPointer(event: MouseEvent | PointerEvent): event is PointerEvent {
  return "pointerId" in event;
}

function point(element: Element | null, includeEditor = false): GridPick | undefined {
  if (!includeEditor && element?.closest(".formula-editor, [data-formula-field]")) return undefined;
  const target = element?.closest<HTMLElement>("[data-pick-kind]");
  if (!target) return undefined;
  const kind = target.dataset.pickKind;
  if (kind === "cells")
    return { kind, row: Number(target.dataset.pickRow), col: Number(target.dataset.pickCol) };
  if (kind === "row" || kind === "col") return { kind, index: Number(target.dataset.pickIndex) };
  return undefined;
}

/** Runs before native cell controls, selection, resizing, and blur behavior. */
export function useGridPicking(table: () => TableRecord, rows: () => readonly number[]) {
  const picking = useReferencePickingStore();
  let first: GridPick | undefined;
  let pointerId: number | undefined;

  function remove(): void {
    first = undefined;
    pointerId = undefined;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", finish);
    window.removeEventListener("pointercancel", cancelPointer);
    window.removeEventListener("mousemove", move);
    window.removeEventListener("mouseup", finish);
    window.removeEventListener("blur", cancel);
  }
  function cancel(): void {
    if (first) {
      picking.cancel();
      picking.suppressClick = false;
    }
    remove();
  }
  function finish(event: MouseEvent | PointerEvent): void {
    if (isPointer(event) && event.pointerId !== pointerId) return;
    if (first && typeof document.elementFromPoint === "function") move(event);
    if (first) picking.finish();
    remove();
    setTimeout(() => {
      picking.suppressClick = false;
    }, 0);
  }
  function cancelPointer(event: PointerEvent): void {
    if (event.pointerId === pointerId) cancel();
  }
  function move(event: MouseEvent | PointerEvent): void {
    if (!first || !picking.drag) return;
    if (isPointer(event) && event.pointerId !== pointerId) return;
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (element?.closest("[data-pick-table]")?.getAttribute("data-pick-table") !== table().id) {
      picking.preview({ error: "Keep the drag within one table." });
      return;
    }
    const last = point(element, true);
    if (last) picking.pick(first, last, table(), rows());
    else picking.preview({ error: "End the drag on a cell or matching header." });
  }
  function start(event: MouseEvent | PointerEvent): void {
    if (event.button !== 0 || !(event.target instanceof Element)) return;
    const target = point(event.target);
    if (!target || !picking.available) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (first || !picking.begin()) return;
    first = target;
    picking.pick(first, first, table(), rows());
    if (isPointer(event)) {
      pointerId = event.pointerId;
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", cancelPointer);
    } else {
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", finish);
    }
    window.addEventListener("blur", cancel);
  }
  function click(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    if (picking.suppressClick || (point(event.target) && picking.available)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  onBeforeUnmount(cancel);
  return { start, click };
}
