import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  isBlockCollapsed,
  loadCollapsedBlocks,
  setBlockCollapsed,
  toggleBlockCollapsed,
} from "./blockCollapse";

const key = "rowz:block-collapse:s1";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("block collapse preferences", () => {
  it("toggles a block and restores its preference from localStorage", () => {
    loadCollapsedBlocks("s1", ["table-1", "chart-1"]);
    expect(isBlockCollapsed("s1", "table-1")).toBe(false);

    toggleBlockCollapsed("s1", "table-1");
    expect(isBlockCollapsed("s1", "table-1")).toBe(true);
    expect(localStorage.getItem(key)).toBe('["table-1"]');

    loadCollapsedBlocks("s1", ["table-1", "chart-1"]);
    expect(isBlockCollapsed("s1", "table-1")).toBe(true);
    expect(isBlockCollapsed("s1", "chart-1")).toBe(false);
  });

  it("prunes IDs that are absent when the spreadsheet loads", () => {
    localStorage.setItem(key, '["existing","deleted"]');

    loadCollapsedBlocks("s1", ["existing"]);

    expect(isBlockCollapsed("s1", "existing")).toBe(true);
    expect(isBlockCollapsed("s1", "deleted")).toBe(false);
    expect(localStorage.getItem(key)).toBe('["existing"]');
  });

  it("keeps the in-memory preference usable when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("Storage unavailable");
    });

    loadCollapsedBlocks("s1", ["table-1"]);
    setBlockCollapsed("s1", "table-1", true);

    expect(isBlockCollapsed("s1", "table-1")).toBe(true);
  });
});
