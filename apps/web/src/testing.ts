import {
  keysAfter,
  type IdentifiedCell,
  type IdentityCellInput,
  type IdentityFormatRange,
} from "@spreadsheet-app/shared";
import { parseAddress, type CellId } from "@spreadsheet-app/engine";
import { vi, expect, beforeEach, type Mock } from "vitest";
import type {
  api,
  Change,
  ChangedContent,
  ClickResult,
  Snapshot,
  TableRecord,
  PageRecord,
  ViewRecord,
} from "./api/client";

let onJournaled: () => void = () => undefined;

export function setJournaledHandler(handler: () => void): void {
  onJournaled = handler;
}

export function notifyJournaled(): void {
  onJournaled();
}

export const TABLE: TableRecord = {
  id: "t1",
  pageId: "p1",
  name: "Table 1",
  position: 0,
  rowCount: 4,
  colCount: 3,
  colIds: ["c1", "c2", "c3"],
  rows: Array.from({ length: 4 }, (_, row) => ({
    id: `r${String(row)}`,
    orderKey: `a${String(row)}`,
  })),
  columns: null,
  formats: [],
  display: { sort: [] },
  conditionalFormats: [],
  names: [],
};

/** A spreadsheet with one page and one 4x3 table holding `inputs`, keyed by address. */
export function snapshotWith(
  inputs: Record<string, string> = {},
  role = "owner",
): Snapshot & { tables: TableRecord[] } {
  return {
    revision: nextRevision,
    rows: TABLE.rows.map((row) => ({ ...row, tableId: TABLE.id })),
    id: "s1",
    name: "Budget",
    role: role as Snapshot["role"],
    pages: [{ id: "p1", name: "Page 1", position: 0 }],
    tables: [TABLE],
    views: [],
    cells: Object.entries(inputs).map(([address, input]) => ({ ...identifiedAt(address), input })),
    undoable: false,
    redoable: false,
  };
}

export function at(address: string, tableId = "t1"): CellId {
  const parsed = parseAddress(address);
  if (!parsed) throw new Error(`Bad test address ${address}`);
  return { tableId, ...parsed };
}

export function identifiedAt(address: string, tableId = "t1"): IdentifiedCell {
  const { row, col } = at(address, tableId);
  return { tableId, rowId: `r${String(row)}`, colId: `c${String(col + 1)}` };
}

/** A resized fixture with stable IDs for the rows and columns that survive. */
export function sizedTable(changes: Partial<TableRecord>): TableRecord {
  const table = { ...TABLE, ...changes };
  return {
    ...table,
    colIds: Array.from({ length: table.colCount }, (_, col) => `c${String(col + 1)}`),
    rows: keysAfter(null, table.rowCount).map((orderKey, row) => ({
      id: `r${String(row)}`,
      orderKey,
    })),
  };
}

export function positionalFormatRange(range: IdentityFormatRange) {
  return {
    startRow: Number(range.startRowId.slice(1)),
    endRow: range.endRowId === null ? null : Number(range.endRowId.slice(1)),
    startCol: Number(range.startColId.slice(1)) - 1,
    endCol: range.endColId === null ? null : Number(range.endColId.slice(1)) - 1,
  };
}

export function expectedEdit(edit: { axis: string; kind: string; index: number; count?: number }) {
  const size = edit.axis === "row" ? TABLE.rowCount : TABLE.colCount;
  const id = (index: number) =>
    edit.axis === "row" ? `r${String(index)}` : `c${String(index + 1)}`;
  const count = edit.count ?? 1;
  return edit.kind === "insert"
    ? {
        axis: edit.axis,
        kind: edit.kind,
        beforeId: edit.index === size ? null : id(edit.index),
        ids: Array.from({ length: count }, () => expect.any(String) as unknown),
      }
    : {
        axis: edit.axis,
        kind: edit.kind,
        ids: Array.from({ length: count }, (_, i) => id(edit.index + i)),
      };
}

let nextRevision = 0;
beforeEach(() => {
  nextRevision = 0;
});

type CellFixture = (CellId | IdentifiedCell) & { input: string };
interface ContentFixture {
  cells?: CellFixture[];
  pages?: ChangedContent["pages"];
  tables?: (TableRecord | ChangedContent["tables"][number])[];
  views?: ((Partial<ViewRecord> & { id: string }) | ChangedContent["views"][number])[];
  rows?: ChangedContent["rows"];
  table?: TableRecord;
  view?: ViewRecord;
}

/** Builds wire content from compact positional fixtures. */
export function changeWith(
  fixture: ContentFixture | TableRecord | ViewRecord | undefined = {},
  revision?: number,
): Change {
  const content: ContentFixture =
    "colIds" in fixture ? { table: fixture } : "kind" in fixture ? { view: fixture } : fixture;
  const tables = [...(content.tables ?? []), ...(content.table ? [content.table] : [])].map(
    (record) => ("table" in record ? record : { id: record.id, table: record }),
  );
  const views = [...(content.views ?? []), ...(content.view ? [content.view] : [])].map((record) =>
    "view" in record
      ? record
      : {
          id: record.id,
          view: {
            pageId: "p1",
            kind: "text" as const,
            name: "View",
            position: 1,
            chartType: null,
            source: "",
            ...record,
          },
        },
  );
  const rows =
    content.rows ??
    tables.flatMap(({ table }) => {
      if (!table || !("rows" in table)) return [];
      const kept = (table as TableRecord).rows;
      return [
        ...kept.map((row) => ({ ...row, tableId: table.id })),
        ...TABLE.rows
          .filter((row) => !kept.some((other) => other.id === row.id))
          .map((row) => ({ id: row.id, tableId: table.id, orderKey: null })),
      ];
    });
  return {
    get revision() {
      return (revision ??= ++nextRevision);
    },
    changed: {
      pages: content.pages ?? [],
      tables,
      views,
      rows,
      cells: (content.cells ?? []).map((cell) =>
        "rowId" in cell
          ? cell
          : {
              tableId: cell.tableId,
              rowId: `r${String(cell.row)}`,
              colId: `c${String(cell.col + 1)}`,
              input: cell.input,
            },
      ),
    },
  };
}

/** Supplies the separate row records for a snapshot fixture. */
export function wireSnapshot(
  snapshot: Omit<Snapshot, "tables"> & { tables: (Snapshot["tables"][number] | TableRecord)[] },
): Snapshot {
  return {
    ...snapshot,
    rows: snapshot.tables.flatMap((table) =>
      "rows" in table
        ? table.rows.map((row) => ({ ...row, tableId: table.id }))
        : snapshot.rows.filter((row) => row.tableId === table.id),
    ),
  };
}
export function createdTable(table: TableRecord) {
  return { table, change: changeWith({ table }) };
}
export function createdView(view: ViewRecord) {
  return { view, change: changeWith({ view }) };
}
export function createdPage(result: { page: PageRecord; table: TableRecord }) {
  return {
    ...result,
    change: changeWith({ pages: [{ id: result.page.id, page: result.page }], table: result.table }),
  };
}

export function clickResult(overrides: Partial<ClickResult> & ContentFixture = {}): ClickResult {
  const { cells, tables, views, rows, ...rest } = overrides;
  return {
    runId: "r1",
    status: "succeeded",
    error: null,
    emailsSent: 0,
    change: cells || tables || views || rows ? changeWith({ cells, tables, views, rows }) : null,
    ...rest,
  };
}

export function savedCells(
  tableId: string,
  cells: IdentityCellInput[],
  _step?: string,
  _revision?: number,
  appendRows: string[] = [],
): Promise<Change> {
  return Promise.resolve(
    changeWith({
      cells: cells.map((cell) => ({ ...cell, tableId })),
      rows: appendRows.map((id, index) => ({
        id,
        tableId,
        orderKey: `b${String(index).padStart(4, "0")}`,
      })),
    }),
  );
}

export type MockedApi = { [K in keyof typeof api]: Mock<(typeof api)[K]> };

/** A stand-in for the API module in which every call succeeds with an empty result. */
export function mockApi(): MockedApi {
  return {
    listSpreadsheets: vi.fn().mockResolvedValue([]),
    createSpreadsheet: vi.fn(),
    importSpreadsheet: vi.fn(),
    getSnapshot: vi.fn().mockResolvedValue(snapshotWith()),
    listMembers: vi.fn().mockResolvedValue([]),
    share: vi.fn(),
    unshare: vi.fn().mockResolvedValue(undefined),
    listVersions: vi.fn().mockResolvedValue([]),
    restoreVersion: vi
      .fn()
      .mockImplementation(() => Promise.resolve({ revision: ++nextRevision, changed: null })),
    copyVersion: vi.fn(),
    renameSpreadsheet: vi.fn().mockResolvedValue(undefined),
    deleteSpreadsheet: vi.fn().mockResolvedValue(undefined),
    createPage: vi.fn(),
    renamePage: vi
      .fn()
      .mockImplementation((id: string, name: string) =>
        Promise.resolve(changeWith({ pages: [{ id, page: { id, name, position: 0 } }] })),
      ),
    createView: vi.fn(),
    updateView: vi.fn(),
    deleteView: vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(changeWith({ views: [{ id, view: null }] })),
      ),
    deletePage: vi.fn().mockImplementation(() => Promise.resolve(changeWith())),
    reorderPage: vi.fn().mockImplementation(() => Promise.resolve(changeWith())),
    reorderPages: vi.fn().mockImplementation(() => Promise.resolve(changeWith())),
    moveTable: vi.fn(),
    moveView: vi.fn(),
    createTable: vi.fn(),
    updateTable: vi.fn(),
    editTable: vi.fn(),
    formatCells: vi.fn(),
    setTableDisplay: vi.fn(),
    setConditionalFormats: vi.fn(),
    setTableNames: vi.fn(),
    nameColumns: vi.fn(),
    dropColumns: vi.fn(),
    updateColumn: vi.fn(),
    deleteTable: vi
      .fn()
      .mockImplementation((id: string) =>
        Promise.resolve(changeWith({ tables: [{ id, table: null }] })),
      ),
    setCells: vi.fn().mockImplementation(savedCells),
    undo: vi.fn().mockResolvedValue({
      outcome: "nothing",
      label: null,
      error: null,
      change: null,
      undoable: false,
      redoable: false,
    }),
    redo: vi.fn().mockResolvedValue({
      outcome: "nothing",
      label: null,
      error: null,
      change: null,
      undoable: false,
      redoable: false,
    }),
    click: vi.fn().mockResolvedValue(clickResult()),
    input: vi.fn().mockResolvedValue(clickResult()),
  };
}
