import { z } from "zod";

export { keyBetween, keysAfter, rebalanceKeys, MAX_ORDER_KEY_LENGTH } from "./order-keys.ts";
export {
  layoutsOf,
  TableLayout,
  type RowIdentity,
  type CellIdentity,
  type CellPosition,
} from "./table-layout.ts";

export const LIMITS = {
  nameLength: 100,
  /** Characters in one cell's input. */
  inputLength: 8192,
  cellsPerRequest: 1000,
  tableRows: 1000,
  /** Stored rows across every table of one spreadsheet. */
  spreadsheetRows: 100_000,
  tableCols: 100,
  /** Characters in a chart's formula or a text view's template. */
  viewSourceLength: 50_000,
  /** Kept versions of one spreadsheet. Older ones are dropped. */
  versions: 50,
  /** Undo history entries kept for one spreadsheet. */
  journalEntries: 200,
  /** Age of undo history entries before they are pruned. */
  journalAgeMs: 24 * 60 * 60_000,
  /** Undo history data kept for one spreadsheet. */
  journalBytes: 64 * 1024 * 1024,
  /** Maximum undo history data kept for one change. */
  journalEntryBytes: 8 * 1024 * 1024,
} as const;

export interface JournalLimits {
  journalEntries: number;
  journalAgeMs: number;
  journalBytes: number;
  journalEntryBytes: number;
}

/** Names this tab to the server's change feed and undo journal. */
export const CLIENT_ID_HEADER = "x-client-id";
/** Groups requests into one undo step. */
export const STEP_ID_HEADER = "x-step-id";
/** Signals that the response added an undoable step for this tab. */
export const UNDOABLE_HEADER = "x-undoable";

/**
 * The name the app calls itself, in the browser tab and as the sender of its
 * email. `APP_NAME` in the environment sets it. Empty counts as unset.
 */
export function appName(env: { APP_NAME?: string | undefined }): string {
  return env.APP_NAME === undefined || env.APP_NAME === "" ? "rowz" : env.APP_NAME;
}

export const DEFAULT_TABLE_SIZE = { rowCount: 20, colCount: 8 } as const;

const name = z.string().trim().min(1).max(LIMITS.nameLength);

export const nameBody = z.object({ name });

/** Bodies for creating a page or table. Without a name the server picks the next free one. */
export const optionalNameBody = z.object({ name: name.optional() });

/** A size is counted from the start of the table: rows and columns are added or removed at its end. */
export const updateTableBody = z
  .object({
    name: name.optional(),
    /** A data table may have no rows. A plain table needs one, which the server checks. */
    rowCount: z.int().min(0).max(LIMITS.tableRows).optional(),
    colCount: z.int().min(1).max(LIMITS.tableCols).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Give at least one of name, rowCount, colCount",
  });

const cellIndex = z.int().min(0);

/** A column name goes between square brackets in a formula, so it cannot hold one. */
const columnName = name.refine((value) => !/[[\]]/.test(value), {
  message: "A column name cannot contain [ or ]",
});

export const COLUMN_TYPES = ["any", "text", "number", "date", "checkbox", "formula"] as const;

/** A named column of a data table. A formula column has the formula every row computes. */
export const columnDefinition = z.object({
  name: columnName,
  type: z.enum(COLUMN_TYPES),
  formula: z.string().max(LIMITS.inputLength).optional(),
});

export const FORMAT_COLORS = [
  "red",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "gray",
] as const;

/** A change to how cells are shown. A property set to `null` goes back to its default. */
export const formatPatch = z.strictObject({
  bold: z.boolean().nullable().optional(),
  italic: z.boolean().nullable().optional(),
  align: z.enum(["left", "center", "right"]).nullable().optional(),
  color: z.enum(FORMAT_COLORS).nullable().optional(),
  fill: z.enum(FORMAT_COLORS).nullable().optional(),
  /** A format in the notation `TEXT` takes. */
  numberFormat: z.string().min(1).max(100).nullable().optional(),
});

/** A range of cells. A `null` end runs to the edge of the table, however far it grows. */
export const identityFormatRange = z.object({
  startRowId: z.uuid(),
  endRowId: z.uuid().nullable(),
  startColId: z.uuid(),
  endColId: z.uuid().nullable(),
});
export type IdentityFormatRange = z.infer<typeof identityFormatRange>;

/** Formatting a range of cells. With `reset`, the cells first lose every format they had. */
export const formatCellsBody = z.object({
  range: identityFormatRange,
  format: formatPatch,
  reset: z.boolean().optional(),
});

const formatRule = z.object({
  startRow: cellIndex,
  endRow: cellIndex.nullable(),
  startCol: cellIndex,
  endCol: cellIndex.nullable(),
  format: formatPatch,
  reset: z.boolean().optional(),
});

/** More format rules than a person makes by hand. */
export const MAX_FORMAT_RULES = 500;

/** Turning a plain table into a data table. With `headerRow`, its first row becomes the column names. */
export const makeColumnsBody = z.object({ headerRow: z.boolean() });

/**
 * The revision of the spreadsheet a tab had applied when the person began to
 * write a formula. The server refuses the formula when rows or columns have
 * been inserted or deleted, or something renamed or moved, since then: its
 * references were written against a spreadsheet that has changed.
 */
const writtenAt = z.int().min(0).optional();

export const updateColumnBody = z
  .object({
    name: columnName.optional(),
    type: z.enum(COLUMN_TYPES).optional(),
    formula: z.string().max(LIMITS.inputLength).optional(),
    revision: writtenAt,
  })
  .refine((body) => [body.name, body.type, body.formula].some((given) => given !== undefined), {
    message: "Give at least one of name, type, formula",
  })
  .superRefine((body, context) => {
    if (body.formula !== undefined && body.revision === undefined) {
      context.addIssue({
        code: "custom",
        path: ["revision"],
        message: "A revision is required when writing a formula",
      });
    }
  });

/**
 * An insert or delete of rows or columns as the editor asks for it, by
 * position. The store turns it into the ids it names before it is queued.
 */
export interface StructuralEditBody {
  axis: "row" | "col";
  kind: "insert" | "delete";
  index: number;
  count?: number;
}
const editIds = z
  .array(z.uuid())
  .min(1)
  .max(LIMITS.tableRows)
  .refine((ids) => new Set(ids).size === ids.length, { message: "IDs must be unique" });
/**
 * Inserting or deleting rows or columns. An insert gives the ids of the new
 * ones and the id of the one they go before, or `null` for the end. A delete
 * gives the ids to delete, which need not sit next to each other.
 */
export const structuralEditBody = z.discriminatedUnion("kind", [
  z.object({
    axis: z.enum(["row", "col"]),
    kind: z.literal("insert"),
    beforeId: z.uuid().nullable(),
    ids: editIds,
  }),
  z.object({ axis: z.enum(["row", "col"]), kind: z.literal("delete"), ids: editIds }),
]);
export type IdentifiedStructuralEditBody = z.infer<typeof structuralEditBody>;

/** A cell of a spreadsheet file, which names cells by position. */
export const cellInput = z.object({
  row: cellIndex,
  col: cellIndex,
  /** What the user typed. An empty string clears the cell. */
  input: z.string().max(LIMITS.inputLength),
});

export const identityCellInput = z.object({
  rowId: z.uuid(),
  colId: z.uuid(),
  /** What the user typed. An empty string clears the cell. */
  input: z.string().max(LIMITS.inputLength),
});
export type IdentityCellInput = z.infer<typeof identityCellInput>;
export interface IdentifiedCell {
  tableId: string;
  rowId: string;
  colId: string;
}

export const setCellsBody = z
  .object({
    cells: z.array(identityCellInput).max(LIMITS.cellsPerRequest),
    /**
     * Ids the client made for rows to add at the end of the table, in order.
     * The ones that exist already are left as they are, so a repeated request
     * adds each row once.
     */
    appendRows: z
      .array(z.uuid())
      .max(LIMITS.tableRows)
      .refine((ids) => new Set(ids).size === ids.length, { message: "IDs must be unique" })
      .optional(),
    revision: writtenAt,
  })
  .refine((body) => body.cells.length + (body.appendRows?.length ?? 0) > 0, {
    message: "Give at least one cell or row",
  })
  .superRefine((body, context) => {
    // Keep the shared request schema independent of the formula engine.
    const writesFormula = body.cells.some(({ input }) => input.startsWith("=") && input.length > 1);
    if (writesFormula && body.revision === undefined) {
      context.addIssue({
        code: "custom",
        path: ["revision"],
        message: "A revision is required when writing a formula",
      });
    }
  });

/** A value chosen through a checkbox or dropdown. */
export const controlInputBody = z.object({
  value: z.union([z.string().max(LIMITS.inputLength), z.number(), z.boolean(), z.null()]),
});

/** The blocks of a page (its tables, charts, and text views), by id, in the order they are to sit on it. */
export const reorderBody = z.object({ blocks: z.array(z.uuid()).min(1).max(1000) });

export const createViewBody = z.object({ kind: z.enum(["chart", "text"]) });

export const updateViewBody = z
  .object({
    name: name.optional(),
    source: z.string().max(LIMITS.viewSourceLength).optional(),
    chartType: z.enum(["bar", "line", "pie", "scatter"]).optional(),
    revision: writtenAt,
  })
  .refine((body) => [body.name, body.source, body.chartType].some((given) => given !== undefined), {
    message: "Give at least one of name, source, chartType",
  })
  .superRefine((body, context) => {
    if (body.source !== undefined && body.revision === undefined) {
      context.addIssue({
        code: "custom",
        path: ["revision"],
        message: "A revision is required when changing a view source",
      });
    }
  });

export const viewParam = z.object({ viewId: z.uuid() });

/** Limits on a spreadsheet file, which a person can write by hand or another program can produce. */
export const FILE_LIMITS = {
  pages: 50,
  blocksPerPage: 50,
  /** Cells across the whole file. */
  cells: 100_000,
  /** The size of a request body the server reads, which bounds a file. */
  bytes: 32 * 1024 * 1024,
} as const;

/** The pages of a spreadsheet, by id, in the order their tabs are to sit in. */
export const reorderPagesBody = z.object({
  pages: z.array(z.uuid()).min(1).max(FILE_LIMITS.pages),
});

/** Moving a block to another page of its spreadsheet. */
export const moveBlockBody = z.object({ pageId: z.uuid() });

export const FILE_FORMAT = "spreadsheet-app";

const fileTable = z.object({
  type: z.literal("table"),
  name,
  /** A data table may have no rows. A plain table has at least one. */
  rowCount: z.int().min(0).max(LIMITS.tableRows),
  colCount: z.int().min(1).max(LIMITS.tableCols),
  /** The named columns of a data table, one for each column. Left out for a plain table. */
  columns: z.array(columnDefinition).max(LIMITS.tableCols).optional(),
  /** How cells are shown: rules applied in order. Left out when nothing is formatted. */
  formats: z.array(formatRule).max(MAX_FORMAT_RULES).optional(),
  /** Cells that hold something. Empty cells and the cells of formula columns are left out. */
  cells: z.array(cellInput).max(FILE_LIMITS.cells),
});

const fileChart = z.object({
  type: z.literal("chart"),
  name,
  source: z.string().max(LIMITS.viewSourceLength),
  chartType: z.enum(["bar", "line", "pie", "scatter"]),
});

const fileText = z.object({
  type: z.literal("text"),
  name,
  source: z.string().max(LIMITS.viewSourceLength),
});

/**
 * A whole spreadsheet as a file: what an export writes and an import reads.
 * Things are identified by name and order, as formulas identify them, so a
 * file carries no ids and can be imported any number of times.
 */
export const spreadsheetFile = z.object({
  format: z.literal(FILE_FORMAT),
  version: z.literal(1),
  name,
  pages: z
    .array(
      z.object({
        name,
        /** The page's blocks: its tables, charts, and text views, in their order on the page. */
        blocks: z
          .array(z.discriminatedUnion("type", [fileTable, fileChart, fileText]))
          .max(FILE_LIMITS.blocksPerPage),
      }),
    )
    .min(1)
    .max(FILE_LIMITS.pages),
});
export type SpreadsheetFile = z.infer<typeof spreadsheetFile>;

type FileBlock = SpreadsheetFile["pages"][number]["blocks"][number];
type FileTable = Extract<FileBlock, { type: "table" }>;

/** What `toSpreadsheetFile` needs to know of a table or a view: where it sits, and what it holds. */
interface Placed {
  pageId: string;
  name: string;
  position: number;
}
interface PlacedTable extends Placed {
  rowCount: number;
  colCount: number;
  columns: FileTable["columns"] | null;
  formats: NonNullable<FileTable["formats"]>;
}
interface PlacedView extends Placed {
  kind: "chart" | "text";
  source: string;
  chartType: "bar" | "line" | "pie" | "scatter" | null;
}

/**
 * Writes a spreadsheet as a file: what an export saves and what a version in
 * a spreadsheet's history holds. `cellsOf` gives the filled cells of a table.
 */
export function toSpreadsheetFile<Table extends PlacedTable>(
  name: string,
  pages: readonly { id: string; name: string; position: number }[],
  tables: readonly Table[],
  views: readonly PlacedView[],
  cellsOf: (table: Table) => CellInput[],
): SpreadsheetFile {
  const blocksOf = (pageId: string): FileBlock[] =>
    [
      ...tables.map((table) => ({
        pageId: table.pageId,
        position: table.position,
        block: {
          type: "table",
          name: table.name,
          rowCount: table.rowCount,
          colCount: table.colCount,
          ...(table.columns ? { columns: table.columns } : {}),
          ...(table.formats.length > 0 ? { formats: table.formats } : {}),
          cells: cellsOf(table),
        } satisfies FileBlock,
      })),
      ...views.map((view) => ({
        pageId: view.pageId,
        position: view.position,
        block: (view.kind === "chart"
          ? {
              type: "chart",
              name: view.name,
              source: view.source,
              chartType: view.chartType ?? "bar",
            }
          : { type: "text", name: view.name, source: view.source }) satisfies FileBlock,
      })),
    ]
      .filter((entry) => entry.pageId === pageId)
      .sort((a, b) => a.position - b.position)
      .map(({ block }) => block);

  return {
    format: FILE_FORMAT,
    version: 1,
    name,
    pages: pages
      .toSorted((a, b) => a.position - b.position)
      .map((page) => ({ name: page.name, blocks: blocksOf(page.id) })),
  };
}

export const spreadsheetParam = z.object({ spreadsheetId: z.uuid() });
/** Opening the stream of a spreadsheet's changes. `client` is the name the session makes its own changes under. */
export const eventsQuery = z.object({ client: z.string().min(1).max(100).optional() });
/** Sharing a spreadsheet with the account that has this email address. */
export const shareBody = z.object({
  email: z.email().max(320),
  role: z.enum(["editor", "viewer"]),
});

export const memberParam = z.object({
  spreadsheetId: z.uuid(),
  userId: z.string().min(1).max(200),
});
export const versionParam = z.object({ spreadsheetId: z.uuid(), versionId: z.uuid() });
export const pageParam = z.object({ pageId: z.uuid() });
export const tableParam = z.object({ tableId: z.uuid() });
export const columnParam = z.object({
  tableId: z.uuid(),
  colId: z.uuid(),
});
export const cellParam = z.object({
  tableId: z.uuid(),
  rowId: z.uuid(),
  colId: z.uuid(),
});

export type CellInput = z.infer<typeof cellInput>;

/** A stored cell, as sent between server and client: named by the ids of its row and column. */
export interface StoredCell extends IdentityCellInput {
  tableId: string;
}

/** A row of a table: its id, and the key that places it among the table's rows. */
export interface RowRecord {
  id: string;
  tableId: string;
  orderKey: string;
}

/** The body of every error response. */
export interface ApiError {
  error: { code: string; message: string };
}
