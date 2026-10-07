import { formatAddress, type CellId } from "@spreadsheet-app/engine";
import type { Router } from "vue-router";
import { nextTick } from "vue";
import type { useWorkbookStore } from "./stores/workbook";

export interface RevealLocationTarget {
  pageId: string;
  blockId?: string;
  label?: string;
  cell?: CellId;
  line?: number;
  name?: string;
  column?: number;
  scriptId?: string;
}

const BLOCK_HIGHLIGHT = "editor__block--location-flash";
const CELL_HIGHLIGHT = "grid__cell--location-flash";
const HIGHLIGHT_MS = 1100;

function scrollElementIntoView(
  element: HTMLElement | null | undefined,
  options: ScrollIntoViewOptions,
): void {
  if (!element) return;
  const method = Reflect.get(element, "scrollIntoView");
  if (typeof method === "function") Reflect.apply(method, element, [options]);
}

function focusWithoutScrolling(element: HTMLElement | null | undefined): void {
  if (!element) return;
  const method = Reflect.get(element, "focus");
  if (typeof method === "function") Reflect.apply(method, element, [{ preventScroll: true }]);
}

function prefersReducedMotion(): boolean {
  const matchMedia = Reflect.get(window, "matchMedia");
  if (typeof matchMedia !== "function") return false;
  const query: unknown = Reflect.apply(matchMedia, window, ["(prefers-reduced-motion: reduce)"]);
  return typeof query === "object" && query !== null && Reflect.get(query, "matches") === true;
}

/** Opens a location's page, scrolls it into view, and focuses its cell or block. */
export function useLocationReveal(
  store: ReturnType<typeof useWorkbookStore>,
  router: Router,
  spreadsheetId: () => string,
) {
  const highlightTimers = new WeakMap<HTMLElement, number>();

  async function highlight(element: HTMLElement, className: string): Promise<void> {
    const previous = highlightTimers.get(element);
    if (previous !== undefined) window.clearTimeout(previous);
    element.classList.remove(className);
    await nextTick();
    element.classList.add(className);
    highlightTimers.set(
      element,
      window.setTimeout(() => {
        element.classList.remove(className);
        highlightTimers.delete(element);
      }, HIGHLIGHT_MS),
    );
  }

  async function revealLocation(target: RevealLocationTarget): Promise<void> {
    const cellIsVisible =
      target.cell !== undefined &&
      store.rowView(target.cell.tableId).place(target.cell.row) !== undefined;
    if (target.cell && cellIsVisible) store.selection = target.cell;

    await router.push({
      name: "editor",
      params: { spreadsheetId: spreadsheetId(), pageId: target.pageId },
    });
    await nextTick();

    const blockId = target.blockId ?? target.cell?.tableId ?? target.scriptId;
    const block = blockId ? document.getElementById(`block-${blockId}`) : null;
    const behavior: ScrollBehavior = prefersReducedMotion() ? "instant" : "smooth";
    scrollElementIntoView(block, { block: "center", behavior });

    if (target.cell) {
      if (cellIsVisible) {
        store.focusGrid();
        await nextTick();
        const cell = block?.querySelector<HTMLElement>(
          `[data-cell="${formatAddress(target.cell)}"]`,
        );
        scrollElementIntoView(cell, { block: "center", inline: "center", behavior });
        if (block) await highlight(block, BLOCK_HIGHLIGHT);
        if (cell) await highlight(cell, CELL_HIGHLIGHT);
      } else {
        focusWithoutScrolling(block);
        if (block) await highlight(block, BLOCK_HIGHLIGHT);
        store.notice = {
          kind: "error",
          text: `${target.label ?? "This cell"} is hidden by the table filter. Edit or clear the filter to show it.`,
        };
      }
      return;
    }

    if (target.name && target.line === undefined) {
      const toggle = block?.querySelector<HTMLButtonElement>("[data-open-names]");
      if (toggle?.getAttribute("aria-expanded") === "false") {
        toggle.click();
        await nextTick();
      }
    }

    const location =
      target.line !== undefined
        ? block?.querySelector<HTMLElement>(`[data-script-line="${String(target.line)}"]`)
        : target.name
          ? [...(block?.querySelectorAll<HTMLElement>("[data-name]") ?? [])].find(
              (element) => element.dataset.name === target.name,
            )
          : target.column !== undefined
            ? block?.querySelector<HTMLElement>(`thead th:nth-child(${String(target.column + 2)})`)
            : undefined;
    focusWithoutScrolling(block);
    scrollElementIntoView(location ?? block, { block: "center", behavior });
    if (block) await highlight(block, BLOCK_HIGHLIGHT);
  }

  return { revealLocation };
}
