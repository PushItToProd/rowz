import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { useWorkbookStore } from "./stores/workbook";
import { isBlockCollapsed, loadCollapsedBlocks } from "./blockCollapse";
import { useLocationReveal } from "./locationReveal";
import type { ActiveSidePane } from "./sidePane";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("location reveal", () => {
  it("expands a collapsed table before revealing a cell inside it", async () => {
    loadCollapsedBlocks("s1", ["t1"]);
    const store = {
      selection: undefined,
      rowView: () => ({ place: () => 1 }),
      focusGrid: vi.fn(),
      notice: undefined,
    } as unknown as ReturnType<typeof useWorkbookStore>;
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { name: "editor", path: "/s/:spreadsheetId/p/:pageId", component: { template: "<div />" } },
      ],
    });
    const activeSidePane = { open: vi.fn() } as unknown as ActiveSidePane;
    const { revealLocation } = useLocationReveal(store, router, () => "s1", activeSidePane);

    await revealLocation({ pageId: "p1", cell: { tableId: "t1", row: 1, col: 0 } });

    expect(isBlockCollapsed("s1", "t1")).toBe(false);
    expect(store.selection).toEqual({ tableId: "t1", row: 1, col: 0 });
  });

  it("opens the table's Names pane before revealing a named formula", async () => {
    const store = {
      selection: undefined,
      rowView: () => ({ place: () => 1 }),
      focusGrid: vi.fn(),
      notice: undefined,
    } as unknown as ReturnType<typeof useWorkbookStore>;
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { name: "editor", path: "/s/:spreadsheetId/p/:pageId", component: { template: "<div />" } },
      ],
    });
    const activeSidePane = { open: vi.fn() } as unknown as ActiveSidePane;
    const { revealLocation } = useLocationReveal(store, router, () => "s1", activeSidePane);

    await revealLocation({ pageId: "p1", blockId: "t1", name: "Total" });

    expect(activeSidePane.open).toHaveBeenCalledExactlyOnceWith("names:t1");
  });
});
