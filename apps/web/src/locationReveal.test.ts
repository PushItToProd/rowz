import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import type { useWorkbookStore } from "./stores/workbook";
import { isBlockCollapsed, loadCollapsedBlocks } from "./blockCollapse";
import { useLocationReveal } from "./locationReveal";

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
    const { revealLocation } = useLocationReveal(store, router, () => "s1");

    await revealLocation({ pageId: "p1", cell: { tableId: "t1", row: 1, col: 0 } });

    expect(isBlockCollapsed("s1", "t1")).toBe(false);
    expect(store.selection).toEqual({ tableId: "t1", row: 1, col: 0 });
  });
});
