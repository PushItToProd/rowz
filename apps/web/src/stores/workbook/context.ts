import type {
  Workbook,
  CellAddress,
  CellId,
  ColumnDefinition,
  ColumnType,
} from "@spreadsheet-app/engine";
import type {
  TableLayout,
  CellInput,
  IdentifiedCell,
  IdentityCellInput,
} from "@spreadsheet-app/shared";
import type { ComputedRef, Ref, ShallowRef } from "vue";
import {
  type Change,
  type PageRecord,
  type Snapshot,
  type TableRecord,
  type ViewRecord,
} from "../../api/client";
import { type GridRange } from "../../formula/fill";
import { type EditingTarget } from "../../formula/session";
import type { Notice, RowView } from "../workbook";
/** Private store dependencies. Mutable queue state is accessed through getters and setters. */
export interface WorkbookContext {
  selection: Ref<CellId | null>;
  tables: Ref<TableRecord[]>;
  gridFocusRequests: Ref<number, number>;
  selectionEnd: Ref<CellAddress | null>;
  engine: ShallowRef<Workbook>;
  setCells: (tableId: string, writes: readonly CellInput[]) => Promise<void>;
  selectedRange: ComputedRef<GridRange | null>;
  canEdit: ComputedRef<boolean>;
  writeCells: (
    at: CellId,
    writes: readonly CellInput[],
    writtenAt?: number,
    selectWritten?: boolean,
    selectTo?: CellAddress,
  ) => Promise<void>;
  revision: Ref<number, number>;
  attempt: (change: () => Promise<void>, fallback: string) => Promise<boolean>;
  receiveChange: (change: Change) => Promise<void>;
  rowView: (tableId: string) => RowView;
  notice: Ref<Notice | null>;
  identityOf: (id: CellId) => IdentifiedCell | undefined;
  layouts: ComputedRef<Map<string, TableLayout>>;
  positionOf: (id: IdentifiedCell) => CellId | undefined;
  cellIdentityKey: (id: IdentifiedCell) => string;
  running: Set<string>;
  saves: Promise<void>;
  failedSaves: number;
  enqueueWrite: <T>(change: () => Promise<T>, draftWrite?: boolean) => Promise<T>;
  stored: (queue?: Promise<void>, before?: number) => Promise<boolean>;
  fail: (cause: unknown, fallback: string) => void;
  views: Ref<ViewRecord[]>;
  rows: Map<string, Snapshot["rows"][number]>;
  pendingRows: Map<string, { tableId: string; ids: string[] }>;
  inputs: Map<string, Snapshot["cells"][number]>;
  unsavedChanges: Set<{ tableId: string; changes: IdentityCellInput[] }>;
  pages: Ref<PageRecord[]>;
  spreadsheet: Ref<{ id: string; name: string; role: string } | null>;
  undoable: Ref<boolean, boolean>;
  redoable: Ref<boolean, boolean>;
  rememberOrders: () => void;
  showPendingOrders: () => void;
  unanswered: Set<Promise<unknown>>;
  begun: number;
  optimisticPageOrder: string[] | undefined;
  acceptedPageOrder: string[] | undefined;
  showPageOrder: (order: readonly string[]) => void;
  optimisticBlockOrders: Map<string, string[]>;
  showOrder: (order: readonly string[]) => void;
  acceptedBlockOrders: Map<string, string[]>;
  inputOf: (id: CellId) => string;
  columnOf: (id: CellId) => ColumnDefinition | undefined;
  updateColumn: (
    tableId: string,
    col: number,
    changes: {
      name?: string;
      type?: ColumnType;
      formula?: string;
      choices?: string[];
      choicesFrom?: { tableId: string; colId: string };
    },
    writtenAt?: number,
  ) => Promise<boolean>;
  rejectedDraft: Ref<{ id: IdentifiedCell; input: string; revision: number } | null>;
  withStableSelection: (change: () => void) => void;
  syncStructure: () => void;
  extendSelection: (address: CellAddress) => void;
  hasTable: (tableId: string) => boolean;
  unansweredCount: Ref<number, number>;
  submitFormulaDraft: (target: EditingTarget, text: string) => Promise<"saved" | "deleted">;
}
