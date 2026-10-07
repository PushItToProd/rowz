import {
  type ChartType,
  type ColumnDefinition,
  type ConditionalRule,
  type FormatRule,
  type TableDisplay,
  type TableName,
} from "@spreadsheet-app/engine";
import {
  type JournalLimits,
  type GridSizes,
  type RowRecord,
  type StoredCell,
} from "@spreadsheet-app/shared";
import { type Change } from "../journal";
import { type Role, type RunKind, type RunStatus, type ViewKind } from "../../db/schema";

/** What a caller means to do: read, change the contents, or do what only the owner may. */
export type Access = "read" | "write" | "own";

/** Someone who can open a spreadsheet, as the Share panel lists them. */
export interface MemberRecord {
  userId: string;
  name: string;
  email: string;
  role: Role;
  /** Whether the person has the spreadsheet through a share, which the owner can change or remove. */
  shared: boolean;
}

export interface SpreadsheetSummary {
  id: string;
  name: string;
  updatedAt: Date;
}

/** A spreadsheet in the caller's list, with the caller's role on it. */
export interface ListedSpreadsheet extends SpreadsheetSummary {
  role: Role;
  hasErrors: boolean;
  folderId: string | null;
}

export interface FolderRecord {
  id: string;
  name: string;
}

export interface DocumentList {
  folders: FolderRecord[];
  documents: ListedSpreadsheet[];
}

export interface PageRecord {
  id: string;
  name: string;
  position: number;
}

/**
 * A table without its rows, which are records of their own. Holding no row
 * count keeps one person's added row from making the table another person
 * recorded look changed.
 */
export interface TableRecord {
  id: string;
  pageId: string;
  name: string;
  position: number;
  /** The ids of the table's columns, in order. */
  colIds: string[];
  gridSizes: GridSizes;
  /** The named columns of a data table, one for each column. `null` for a plain table. */
  columns: ColumnDefinition[] | null;
  /** How cells are shown: rules applied in order, later ones over earlier ones. */
  formats: FormatRule[];
  /** How the table is shown, including its sort, filter, and frozen rows and columns. */
  display: TableDisplay;
  /** Formats a cell gets when its value meets a condition, laid over `formats`. */
  conditionalFormats: ConditionalRule[];
  /** The names a plain table holds. Always empty for a data table. */
  names: TableName[];
}

export interface ViewRecord {
  id: string;
  pageId: string;
  kind: ViewKind;
  name: string;
  position: number;
  source: string;
  /** `null` for a text view. */
  chartType: ChartType | null;
}

/** A page, table, or view as a lookup returns it: with its spreadsheet and the caller's role there. */
export type Found<T> = T & { spreadsheetId: string; role: Role };

/** A kept version of a spreadsheet, as the history lists it. */
export interface VersionRecord {
  id: string;
  createdAt: Date;
  /** What was about to happen when the version was kept. `null` for one kept as time passed. */
  reason: string | null;
  /** The name of whoever made the change that kept it. */
  createdBy: string | null;
}

/** A recent action run, with only the effect counts needed by the Runs panel. */
export interface ActionRunRecord {
  id: string;
  createdAt: Date;
  kind: RunKind;
  user: { name: string; email: string } | null;
  target:
    | {
        type: "cell";
        id: string;
        pageName: string | null;
        name: string | null;
        cell: string;
      }
    | {
        type: "view";
        id: string;
        pageName: string | null;
        name: string | null;
        occurrence: number;
      };
  cellsWritten: number;
  tablesExpanded: number;
  rowsDeleted: number;
  emails: number;
  status: RunStatus;
  error: string | null;
}

/** A whole spreadsheet: everything the editor and the formula engine need. */
export interface Snapshot {
  id: string;
  name: string;
  role: Role;
  /** How many changes have been made to what the spreadsheet holds. A change carries the revision it made. */
  revision: number;
  pages: PageRecord[];
  tables: TableRecord[];
  /** The rows of every table. Their order within a table is the order of their keys. */
  rows: RowRecord[];
  views: ViewRecord[];
  cells: StoredCell[];
}

/** The spreadsheet snapshot and the undo state of the requesting tab. */
export interface SnapshotWithHistory extends Snapshot {
  undoable: boolean;
  redoable: boolean;
}

export interface UndoResult {
  outcome: "done" | "refused" | "nothing";
  label: string | null;
  error: string | null;
  /** What the undo or redo wrote. `null` when it wrote nothing. */
  change: Change | null;
  undoable: boolean;
  redoable: boolean;
}

export interface RepositoryOptions {
  /**
   * Whether a spreadsheet can be shared only with an account that has
   * confirmed its email address. Set when the server makes new accounts
   * confirm theirs, so that a share by address reaches the person who reads
   * mail at it and not whoever signed up with it first.
   */
  sharesNeedVerifiedEmail?: boolean;
  /** Overrides the journal limits for tests. Production uses the shared defaults. */
  journalLimits?: Partial<JournalLimits>;
}

/** What a change made, with what the work inside it returned. */
export interface Outcome<T> {
  result: T;
  change: Change;
}

/** What a request created, with the change that created it. */
export type Created<Records> = Records & { change: Change };
