import type {
  AppType,
  ClickResult,
  PageRecord,
  Rewritten,
  Snapshot,
  SpreadsheetSummary,
  TableRecord,
  ViewRecord,
} from "@spreadsheet-app/server";
import type {
  ApiError,
  CellInput,
  SpreadsheetFile,
  StructuralEditBody,
} from "@spreadsheet-app/shared";
import type {
  CellId,
  ChartType,
  ColumnType,
  FormatPatch,
  FormatRule,
} from "@spreadsheet-app/engine";
import { hc } from "hono/client";

export type { ClickResult, PageRecord, Rewritten, Snapshot, TableRecord, ViewRecord };

/** A value a control can send. A date is sent as the text it is written as. */
export type ControlInput = string | number | boolean | null;

/** `updatedAt` arrives as an ISO string: JSON has no date type. */
export type SpreadsheetListItem = Omit<SpreadsheetSummary, "updatedAt"> & { updatedAt: string };

/** A response with an error status. `message` is written for the person using the app. */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

let onUnauthenticated: () => void = () => undefined;

/** Registers what to do when the server says the session is gone. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

async function check(response: Response): Promise<void> {
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as ApiError | null;
  if (response.status === 401) onUnauthenticated();
  throw new ApiRequestError(
    response.status,
    body?.error.code ?? "unknown",
    body?.error.message ?? "The server could not be reached",
  );
}

async function body<T>(request: Promise<{ json(): Promise<T> } & Response>): Promise<T> {
  const response = await request;
  await check(response);
  return response.json();
}

async function done(request: Promise<Response>): Promise<void> {
  await check(await request);
}

const { api: routes } = hc<AppType>("/");

/**
 * Tells the server what time it is here, so `TODAY` and `NOW` in an action it
 * runs mean this person's day and not the server's.
 */
function clock(): { headers: Record<string, string> } {
  return { headers: { "x-utc-offset-minutes": String(new Date().getTimezoneOffset()) } };
}

/**
 * Every call the app makes to the server. Each returns the parsed body or
 * throws `ApiRequestError`.
 */
export const api = {
  listSpreadsheets: (): Promise<SpreadsheetListItem[]> => body(routes.spreadsheets.$get()),

  /** Creates a spreadsheet from a file an export wrote. */
  importSpreadsheet: (file: SpreadsheetFile): Promise<SpreadsheetListItem> =>
    body(routes.spreadsheets.import.$post({ json: file })),

  createSpreadsheet: (name: string): Promise<SpreadsheetListItem> =>
    body(routes.spreadsheets.$post({ json: { name } })),

  getSnapshot: (spreadsheetId: string): Promise<Snapshot> =>
    body(routes.spreadsheets[":spreadsheetId"].$get({ param: { spreadsheetId } })),

  renameSpreadsheet: (spreadsheetId: string, name: string): Promise<void> =>
    done(
      routes.spreadsheets[":spreadsheetId"].$patch({ param: { spreadsheetId }, json: { name } }),
    ),

  deleteSpreadsheet: (spreadsheetId: string): Promise<void> =>
    done(routes.spreadsheets[":spreadsheetId"].$delete({ param: { spreadsheetId } })),

  createPage: (spreadsheetId: string): Promise<{ page: PageRecord; table: TableRecord }> =>
    body(routes.spreadsheets[":spreadsheetId"].pages.$post({ param: { spreadsheetId }, json: {} })),

  /** Resolves to the cells and views whose formulas named the page and were rewritten. */
  renamePage: (pageId: string, name: string): Promise<Rewritten> =>
    body(routes.pages[":pageId"].$patch({ param: { pageId }, json: { name } })),

  /** Puts the tables, charts, and text views of a page in the order of their ids. */
  reorderPage: (pageId: string, items: string[]): Promise<void> =>
    done(routes.pages[":pageId"].order.$put({ param: { pageId }, json: { items } })),

  deletePage: (pageId: string): Promise<void> =>
    done(routes.pages[":pageId"].$delete({ param: { pageId } })),

  createTable: (pageId: string): Promise<TableRecord> =>
    body(routes.pages[":pageId"].tables.$post({ param: { pageId }, json: {} })),

  updateTable: (
    tableId: string,
    changes: { name?: string; rowCount?: number; colCount?: number },
  ): Promise<Rewritten & { table: TableRecord }> =>
    body(routes.tables[":tableId"].$patch({ param: { tableId }, json: changes })),

  /** Inserts or deletes a row or column. Resolves to the resized table and every cell that changed. */
  editTable: (
    tableId: string,
    edit: StructuralEditBody,
  ): Promise<Rewritten & { table: TableRecord }> =>
    body(routes.tables[":tableId"].edits.$post({ param: { tableId }, json: edit })),

  /** Changes how a block of cells is shown. With `reset`, the cells first lose every format they had. */
  formatCells: (
    tableId: string,
    range: Pick<FormatRule, "startRow" | "endRow" | "startCol" | "endCol">,
    format: FormatPatch,
    reset = false,
  ): Promise<TableRecord> =>
    body(
      routes.tables[":tableId"].formats.$post({
        param: { tableId },
        json: { range, format, ...(reset ? { reset } : {}) },
      }),
    ),

  /** Names a table's columns, which makes it a data table. With `headerRow`, the first row supplies the names. */
  nameColumns: (tableId: string, headerRow: boolean): Promise<Rewritten & { table: TableRecord }> =>
    body(routes.tables[":tableId"].columns.$post({ param: { tableId }, json: { headerRow } })),

  /** Makes a data table a plain table again. */
  dropColumns: (tableId: string): Promise<TableRecord> =>
    body(routes.tables[":tableId"].columns.$delete({ param: { tableId } })),

  /** Changes a column's name, type, or formula. Resolves to the table and what a rename rewrote. */
  updateColumn: (
    tableId: string,
    col: number,
    changes: { name?: string; type?: ColumnType; formula?: string },
  ): Promise<Rewritten & { table: TableRecord }> =>
    body(
      routes.tables[":tableId"].columns[":col"].$patch({
        param: { tableId, col: String(col) },
        json: changes,
      }),
    ),

  /** Adds a chart or a text view to the end of a page. */
  createView: (pageId: string, kind: ViewRecord["kind"]): Promise<ViewRecord> =>
    body(routes.pages[":pageId"].views.$post({ param: { pageId }, json: { kind } })),

  updateView: (
    viewId: string,
    changes: { name?: string; source?: string; chartType?: ChartType },
  ): Promise<ViewRecord> =>
    body(routes.views[":viewId"].$patch({ param: { viewId }, json: changes })),

  deleteView: (viewId: string): Promise<void> =>
    done(routes.views[":viewId"].$delete({ param: { viewId } })),

  deleteTable: (tableId: string): Promise<void> =>
    done(routes.tables[":tableId"].$delete({ param: { tableId } })),

  setCells: (tableId: string, cells: CellInput[]): Promise<void> =>
    done(routes.tables[":tableId"].cells.$put({ param: { tableId }, json: { cells } })),

  /** Stores a value chosen through the checkbox or dropdown in a cell. */
  input: ({ tableId, row, col }: CellId, value: ControlInput): Promise<ClickResult> =>
    body(
      routes.tables[":tableId"].cells[":row"][":col"].input.$post(
        { param: { tableId, row: String(row), col: String(col) }, json: { value } },
        clock(),
      ),
    ),

  click: ({ tableId, row, col }: CellId): Promise<ClickResult> =>
    body(
      routes.tables[":tableId"].cells[":row"][":col"].click.$post(
        { param: { tableId, row: String(row), col: String(col) } },
        clock(),
      ),
    ),
};
