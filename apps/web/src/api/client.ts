import type {
  AppType,
  ClickResult,
  ListedSpreadsheet,
  MemberRecord,
  PageRecord,
  Rewritten,
  SnapshotWithHistory,
  SpreadsheetSummary,
  TableRecord,
  UndoResult,
  VersionRecord,
  ViewRecord,
} from "@spreadsheet-app/server";
import { CLIENT_ID_HEADER, STEP_ID_HEADER, UNDOABLE_HEADER } from "@spreadsheet-app/shared";
import type {
  ApiError,
  IdentityCellInput,
  IdentifiedCell,
  SpreadsheetFile,
  IdentifiedStructuralEditBody,
  IdentityFormatRange,
} from "@spreadsheet-app/shared";
import type { ChartType, ColumnType, FormatPatch } from "@spreadsheet-app/engine";
import { hc } from "hono/client";

export type {
  ClickResult,
  MemberRecord,
  PageRecord,
  Rewritten,
  SnapshotWithHistory,
  TableRecord,
  UndoResult,
  ViewRecord,
};

export type Snapshot = SnapshotWithHistory;

/** A value a control can send. A date is sent as the text it is written as. */
export type ControlInput = string | number | boolean | null;

/** `updatedAt` arrives as an ISO string: JSON has no date type. */
export type VersionListItem = Omit<VersionRecord, "createdAt"> & { createdAt: string };
export type SpreadsheetListItem = Omit<SpreadsheetSummary, "updatedAt"> & { updatedAt: string };
/** A spreadsheet in the list, with the viewer's role on it. */
export type ListedSpreadsheetItem = SpreadsheetListItem & Pick<ListedSpreadsheet, "role">;

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
let onJournaled: () => void = () => undefined;

/** Registers what to do when the server says the session is gone. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

/** Registers what to do when a response adds a step to this tab's undo journal. */
export function setJournaledHandler(handler: () => void): void {
  onJournaled = handler;
}

async function check(response: Response): Promise<void> {
  if (response.headers.get(UNDOABLE_HEADER) === "1") onJournaled();
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

/** Names this tab to the server, so that the tab can tell its own changes from other people's. */
export const CLIENT_ID = crypto.randomUUID();

const { api: routes } = hc<AppType>("/", { headers: { [CLIENT_ID_HEADER]: CLIENT_ID } });

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
  listSpreadsheets: (): Promise<ListedSpreadsheetItem[]> => body(routes.spreadsheets.$get()),

  /** Everyone who can open a spreadsheet. */
  listMembers: (spreadsheetId: string): Promise<MemberRecord[]> =>
    body(routes.spreadsheets[":spreadsheetId"].members.$get({ param: { spreadsheetId } })),

  /** Shares a spreadsheet with the account that has an email, or changes a share's role. Resolves to everyone who can open it. */
  share: (
    spreadsheetId: string,
    email: string,
    role: "editor" | "viewer",
  ): Promise<MemberRecord[]> =>
    body(
      routes.spreadsheets[":spreadsheetId"].members.$put({
        param: { spreadsheetId },
        json: { email, role },
      }),
    ),

  unshare: (spreadsheetId: string, userId: string): Promise<void> =>
    done(
      routes.spreadsheets[":spreadsheetId"].members[":userId"].$delete({
        param: { spreadsheetId, userId },
      }),
    ),

  /** Creates a spreadsheet from a file an export wrote. */
  importSpreadsheet: (file: SpreadsheetFile): Promise<SpreadsheetListItem> =>
    body(routes.spreadsheets.import.$post({ json: file })),

  createSpreadsheet: (name: string): Promise<SpreadsheetListItem> =>
    body(routes.spreadsheets.$post({ json: { name } })),

  getSnapshot: (spreadsheetId: string): Promise<SnapshotWithHistory> =>
    body(routes.spreadsheets[":spreadsheetId"].$get({ param: { spreadsheetId } })),

  undo: (spreadsheetId: string): Promise<UndoResult> =>
    body(routes.spreadsheets[":spreadsheetId"].undo.$post({ param: { spreadsheetId } })),

  redo: (spreadsheetId: string): Promise<UndoResult> =>
    body(routes.spreadsheets[":spreadsheetId"].redo.$post({ param: { spreadsheetId } })),

  /** The kept versions of a spreadsheet, newest first. */
  listVersions: (spreadsheetId: string): Promise<VersionListItem[]> =>
    body(routes.spreadsheets[":spreadsheetId"].versions.$get({ param: { spreadsheetId } })),

  /** Puts a spreadsheet back as a kept version has it. */
  restoreVersion: (spreadsheetId: string, versionId: string): Promise<void> =>
    done(
      routes.spreadsheets[":spreadsheetId"].versions[":versionId"].restore.$post({
        param: { spreadsheetId, versionId },
      }),
    ),

  /** Makes a new spreadsheet of a kept version. */
  copyVersion: (spreadsheetId: string, versionId: string): Promise<SpreadsheetListItem> =>
    body(
      routes.spreadsheets[":spreadsheetId"].versions[":versionId"].copy.$post({
        param: { spreadsheetId, versionId },
      }),
    ),

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

  /** Puts the blocks of a page in the order of their ids. */
  reorderPage: (pageId: string, blocks: string[]): Promise<void> =>
    done(routes.pages[":pageId"].order.$put({ param: { pageId }, json: { blocks } })),

  /** Puts the pages of a spreadsheet in the order of their ids. */
  reorderPages: (spreadsheetId: string, pages: string[]): Promise<void> =>
    done(
      routes.spreadsheets[":spreadsheetId"].pages.order.$put({
        param: { spreadsheetId },
        json: { pages },
      }),
    ),

  /** Moves a table to the end of another page. Resolves to the table and the formulas rewritten to keep reading what they read. */
  moveTable: (tableId: string, pageId: string): Promise<Rewritten & { table: TableRecord }> =>
    body(routes.tables[":tableId"].page.$put({ param: { tableId }, json: { pageId } })),

  /** Moves a chart or text view to the end of another page. */
  moveView: (viewId: string, pageId: string): Promise<Rewritten & { view: ViewRecord }> =>
    body(routes.views[":viewId"].page.$put({ param: { viewId }, json: { pageId } })),

  deletePage: (pageId: string): Promise<void> =>
    done(routes.pages[":pageId"].$delete({ param: { pageId } })),

  createTable: (pageId: string): Promise<TableRecord> =>
    body(routes.pages[":pageId"].tables.$post({ param: { pageId }, json: {} })),

  updateTable: (
    tableId: string,
    changes: { name?: string; rowCount?: number; colCount?: number },
    stepId?: string,
  ): Promise<Rewritten & { table: TableRecord }> =>
    body(
      routes.tables[":tableId"].$patch({
        param: { tableId },
        json: changes,
        ...(stepId === undefined ? {} : { headers: { [STEP_ID_HEADER]: stepId } }),
      }),
    ),

  /** Inserts or deletes a row or column. Resolves to the resized table and every cell that changed. */
  editTable: (
    tableId: string,
    edit: IdentifiedStructuralEditBody,
  ): Promise<Rewritten & { table: TableRecord }> =>
    body(routes.tables[":tableId"].edits.$post({ param: { tableId }, json: edit })),

  /** Changes how a range of cells is shown. With `reset`, the cells first lose every format they had. */
  formatCells: (
    tableId: string,
    range: IdentityFormatRange,
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
    colId: string,
    changes: { name?: string; type?: ColumnType; formula?: string },
  ): Promise<Rewritten & { table: TableRecord }> =>
    body(
      routes.tables[":tableId"].columns[":colId"].$patch({
        param: { tableId, colId },
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

  setCells: (tableId: string, cells: IdentityCellInput[], stepId?: string): Promise<void> =>
    done(
      routes.tables[":tableId"].cells.$put({
        param: { tableId },
        json: { cells },
        ...(stepId === undefined ? {} : { headers: { [STEP_ID_HEADER]: stepId } }),
      }),
    ),

  /** Stores a value chosen through the checkbox or dropdown in a cell. */
  input: ({ tableId, rowId, colId }: IdentifiedCell, value: ControlInput): Promise<ClickResult> =>
    body(
      routes.tables[":tableId"].cells[":rowId"][":colId"].input.$post(
        { param: { tableId, rowId, colId }, json: { value } },
        clock(),
      ),
    ),

  click: ({ tableId, rowId, colId }: IdentifiedCell): Promise<ClickResult> =>
    body(
      routes.tables[":tableId"].cells[":rowId"][":colId"].click.$post(
        { param: { tableId, rowId, colId } },
        clock(),
      ),
    ),
};
