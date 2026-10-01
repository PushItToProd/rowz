import { parseAddress, type CellId } from "@spreadsheet-app/engine";
import { vi, type Mock } from "vitest";
import type { api, ClickResult, Snapshot, TableRecord } from "./api/client";

export const TABLE: TableRecord = {
  id: "t1",
  pageId: "p1",
  name: "Table 1",
  position: 0,
  rowCount: 4,
  colCount: 3,
};

/** A spreadsheet with one page and one 4x3 table holding `inputs`, keyed by address. */
export function snapshotWith(inputs: Record<string, string> = {}, role = "owner"): Snapshot {
  return {
    id: "s1",
    name: "Budget",
    role: role as Snapshot["role"],
    pages: [{ id: "p1", name: "Page 1", position: 0 }],
    tables: [TABLE],
    views: [],
    cells: Object.entries(inputs).map(([address, input]) => ({ ...at(address), input })),
  };
}

export function at(address: string, tableId = "t1"): CellId {
  const parsed = parseAddress(address);
  if (!parsed) throw new Error(`Bad test address ${address}`);
  return { tableId, ...parsed };
}

export function clickResult(overrides: Partial<ClickResult> = {}): ClickResult {
  return {
    runId: "r1",
    status: "succeeded",
    error: null,
    cells: [],
    tables: [],
    emailsSent: 0,
    ...overrides,
  };
}

export type MockedApi = { [K in keyof typeof api]: Mock<(typeof api)[K]> };

/** A stand-in for the API module in which every call succeeds with an empty result. */
export function mockApi(): MockedApi {
  return {
    listSpreadsheets: vi.fn().mockResolvedValue([]),
    createSpreadsheet: vi.fn(),
    importSpreadsheet: vi.fn(),
    getSnapshot: vi.fn().mockResolvedValue(snapshotWith()),
    renameSpreadsheet: vi.fn().mockResolvedValue(undefined),
    deleteSpreadsheet: vi.fn().mockResolvedValue(undefined),
    createPage: vi.fn(),
    renamePage: vi.fn().mockResolvedValue({ cells: [], views: [] }),
    createView: vi.fn(),
    updateView: vi.fn(),
    deleteView: vi.fn().mockResolvedValue(undefined),
    deletePage: vi.fn().mockResolvedValue(undefined),
    createTable: vi.fn(),
    updateTable: vi.fn(),
    editTable: vi.fn(),
    deleteTable: vi.fn().mockResolvedValue(undefined),
    setCells: vi.fn().mockResolvedValue(undefined),
    click: vi.fn().mockResolvedValue(clickResult()),
    input: vi.fn().mockResolvedValue(clickResult()),
  };
}
