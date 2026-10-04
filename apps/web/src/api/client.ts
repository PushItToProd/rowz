import type {
  AppType,
  ClickResult,
  ListedSpreadsheet,
  MemberRecord,
  PageRecord,
  Change,
  ChangedContent,
  SnapshotWithHistory,
  SpreadsheetSummary,
  TableRecord as StoredTable,
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
  IdentityConditionalRule,
  IdentityFormatRange,
  ResizeLinesBody,
  UpdateTableBody,
} from "@spreadsheet-app/shared";
import type {
  ChartType,
  ColumnType,
  FormatPatch,
  SortKey,
  TableName,
} from "@spreadsheet-app/engine";
import { hc } from "hono/client";

export type {
  ClickResult,
  MemberRecord,
  PageRecord,
  Change,
  ChangedContent,
  SnapshotWithHistory,
  UndoResult,
  ViewRecord,
};

/** A table projected into the positional grid and engine. Wire records have no counts. */
export type TableRecord = StoredTable & {
  rows: { id: string; orderKey: string }[];
  rowCount: number;
  colCount: number;
};

export type Snapshot = SnapshotWithHistory;

/** A value a control can send. A date is sent as the text it is written as. */
export type ControlInput = string | number | boolean | null;

/** `updatedAt` arrives as an ISO string: JSON has no date type. */
export type VersionListItem = Omit<VersionRecord, "createdAt"> & { createdAt: string };
export type SpreadsheetListItem = Omit<SpreadsheetSummary, "updatedAt"> & { updatedAt: string };
/** A spreadsheet in the list, with the viewer's role on it. */
export type ListedSpreadsheetItem = SpreadsheetListItem &
  Pick<ListedSpreadsheet, "role" | "hasErrors">;

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

/** Names this tab to the server, for its undo journal and change notifications. */
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

  copySpreadsheet: (spreadsheetId: string): Promise<SpreadsheetListItem> =>
    body(routes.spreadsheets[":spreadsheetId"].copy.$post({ param: { spreadsheetId } })),

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
  restoreVersion: (spreadsheetId: string, versionId: string): Promise<Change> =>
    body(
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

  createPage: (
    spreadsheetId: string,
  ): Promise<{ page: PageRecord; table: StoredTable; change: Change }> =>
    body(routes.spreadsheets[":spreadsheetId"].pages.$post({ param: { spreadsheetId }, json: {} })),

  /** Resolves to the cells and views whose formulas named the page and were rewritten. */
  renamePage: (pageId: string, name: string): Promise<Change> =>
    body(routes.pages[":pageId"].$patch({ param: { pageId }, json: { name } })),

  /** Puts the blocks of a page in the order of their ids. */
  reorderPage: (pageId: string, blocks: string[]): Promise<Change> =>
    body(routes.pages[":pageId"].order.$put({ param: { pageId }, json: { blocks } })),

  /** Puts the pages of a spreadsheet in the order of their ids. */
  reorderPages: (spreadsheetId: string, pages: string[]): Promise<Change> =>
    body(
      routes.spreadsheets[":spreadsheetId"].pages.order.$put({
        param: { spreadsheetId },
        json: { pages },
      }),
    ),

  /** Moves a table to the end of another page. Resolves to the table and the formulas rewritten to keep reading what they read. */
  moveTable: (tableId: string, pageId: string): Promise<Change> =>
    body(routes.tables[":tableId"].page.$put({ param: { tableId }, json: { pageId } })),

  /** Moves a chart or text view to the end of another page. */
  moveView: (viewId: string, pageId: string): Promise<Change> =>
    body(routes.views[":viewId"].page.$put({ param: { viewId }, json: { pageId } })),

  deletePage: (pageId: string): Promise<Change> =>
    body(routes.pages[":pageId"].$delete({ param: { pageId } })),

  createTable: (
    pageId: string,
    position?: number,
  ): Promise<{ table: StoredTable; change: Change }> =>
    body(routes.pages[":pageId"].tables.$post({ param: { pageId }, json: { position } })),

  updateTable: (tableId: string, changes: UpdateTableBody, stepId?: string): Promise<Change> =>
    body(
      routes.tables[":tableId"].$patch({
        param: { tableId },
        json: changes,
        ...(stepId === undefined ? {} : { headers: { [STEP_ID_HEADER]: stepId } }),
      }),
    ),

  /** Inserts or deletes a row or column. Returns the resulting content change. */
  editTable: (tableId: string, edit: IdentifiedStructuralEditBody): Promise<Change> =>
    body(routes.tables[":tableId"].edits.$post({ param: { tableId }, json: edit })),

  /** Changes how a range of cells is shown. With `reset`, the cells first lose every format they had. */
  formatCells: (
    tableId: string,
    range: IdentityFormatRange,
    format: FormatPatch,
    reset = false,
  ): Promise<Change> =>
    body(
      routes.tables[":tableId"].formats.$post({
        param: { tableId },
        json: { range, format, ...(reset ? { reset } : {}) },
      }),
    ),

  /** Replaces how a data table's rows are sorted and filtered for display. */
  resizeLines: (tableId: string, request: ResizeLinesBody): Promise<Change> =>
    body(routes.tables[":tableId"]["grid-sizes"].$put({ param: { tableId }, json: request })),

  setTableDisplay: (
    tableId: string,
    display: { sort: SortKey[]; filter?: string },
    revision: number,
  ): Promise<Change> =>
    body(
      routes.tables[":tableId"].display.$put({
        param: { tableId },
        json: {
          sort: display.sort,
          ...(display.filter === undefined ? {} : { filter: display.filter, revision }),
        },
      }),
    ),

  /** Replaces the formats cells get when their value meets a condition. */
  setConditionalFormats: (tableId: string, rules: IdentityConditionalRule[]): Promise<Change> =>
    body(
      routes.tables[":tableId"]["conditional-formats"].$put({
        param: { tableId },
        json: { rules },
      }),
    ),

  /** Replaces the names a plain table holds. */
  setTableNames: (tableId: string, names: TableName[]): Promise<Change> =>
    body(routes.tables[":tableId"].names.$put({ param: { tableId }, json: { names } })),

  /** Names a table's columns, which makes it a data table. With `headerRow`, the first row supplies the names. */
  nameColumns: (tableId: string, headerRow: boolean): Promise<Change> =>
    body(routes.tables[":tableId"].columns.$post({ param: { tableId }, json: { headerRow } })),

  /** Makes a data table a plain table again. */
  dropColumns: (tableId: string): Promise<Change> =>
    body(routes.tables[":tableId"].columns.$delete({ param: { tableId } })),

  /** Changes a column's name, type, or formula. Resolves to the table and what a rename rewrote. */
  updateColumn: (
    tableId: string,
    colId: string,
    changes: {
      name?: string;
      type?: ColumnType;
      formula?: string;
      choices?: string[];
      choicesFrom?: { tableId: string; colId: string };
      revision?: number;
    },
  ): Promise<Change> =>
    body(
      routes.tables[":tableId"].columns[":colId"].$patch({
        param: { tableId, colId },
        json: changes,
      }),
    ),

  /** Adds a view at an index, defaulting to the end of a page. */
  createView: (
    pageId: string,
    kind: ViewRecord["kind"],
    position?: number,
  ): Promise<{ view: ViewRecord; change: Change }> =>
    body(routes.pages[":pageId"].views.$post({ param: { pageId }, json: { kind, position } })),

  updateView: (
    viewId: string,
    changes: { name?: string; source?: string; chartType?: ChartType; revision?: number },
  ): Promise<Change> => body(routes.views[":viewId"].$patch({ param: { viewId }, json: changes })),

  deleteView: (viewId: string): Promise<Change> =>
    body(routes.views[":viewId"].$delete({ param: { viewId } })),

  deleteTable: (tableId: string): Promise<Change> =>
    body(routes.tables[":tableId"].$delete({ param: { tableId } })),

  setCells: (
    tableId: string,
    cells: IdentityCellInput[],
    stepId?: string,
    revision?: number,
    appendRows?: string[],
  ): Promise<Change> =>
    body(
      routes.tables[":tableId"].cells.$put({
        param: { tableId },
        json: { cells, revision, appendRows },
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
