import type {
  AppType,
  ClickResult,
  PageRecord,
  Snapshot,
  SpreadsheetSummary,
  TableRecord,
} from "@spreadsheet-app/server";
import type { ApiError, CellInput } from "@spreadsheet-app/shared";
import type { CellId } from "@spreadsheet-app/engine";
import { hc } from "hono/client";

export type { ClickResult, PageRecord, Snapshot, TableRecord };

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
 * Every call the app makes to the server. Each returns the parsed body or
 * throws `ApiRequestError`.
 */
export const api = {
  listSpreadsheets: (): Promise<SpreadsheetListItem[]> => body(routes.spreadsheets.$get()),

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

  renamePage: (pageId: string, name: string): Promise<void> =>
    done(routes.pages[":pageId"].$patch({ param: { pageId }, json: { name } })),

  deletePage: (pageId: string): Promise<void> =>
    done(routes.pages[":pageId"].$delete({ param: { pageId } })),

  createTable: (pageId: string): Promise<TableRecord> =>
    body(routes.pages[":pageId"].tables.$post({ param: { pageId }, json: {} })),

  updateTable: (
    tableId: string,
    changes: { name?: string; rowCount?: number; colCount?: number },
  ): Promise<TableRecord> =>
    body(routes.tables[":tableId"].$patch({ param: { tableId }, json: changes })),

  deleteTable: (tableId: string): Promise<void> =>
    done(routes.tables[":tableId"].$delete({ param: { tableId } })),

  setCells: (tableId: string, cells: CellInput[]): Promise<void> =>
    done(routes.tables[":tableId"].cells.$put({ param: { tableId }, json: { cells } })),

  click: ({ tableId, row, col }: CellId): Promise<ClickResult> =>
    body(
      routes.tables[":tableId"].cells[":row"][":col"].click.$post({
        param: { tableId, row: String(row), col: String(col) },
      }),
    ),
};
