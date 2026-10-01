import { z } from "zod";

export const LIMITS = {
  nameLength: 100,
  /** Characters in one cell's input. */
  inputLength: 8192,
  cellsPerRequest: 1000,
  tableRows: 1000,
  tableCols: 100,
  /** Characters in a chart's formula or a text view's template. */
  viewSourceLength: 50_000,
} as const;

export const DEFAULT_TABLE_SIZE = { rowCount: 20, colCount: 8 } as const;

const name = z.string().trim().min(1).max(LIMITS.nameLength);

export const nameBody = z.object({ name });

/** Bodies for creating a page or table. Without a name the server picks the next free one. */
export const optionalNameBody = z.object({ name: name.optional() });

export const updateTableBody = z
  .object({
    name: name.optional(),
    rowCount: z.int().min(1).max(LIMITS.tableRows).optional(),
    colCount: z.int().min(1).max(LIMITS.tableCols).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Give at least one of name, rowCount, colCount",
  });

const cellIndex = z.int().min(0);

/** Inserting or deleting one row or column. An insert puts the new one at `index`. */
export const structuralEditBody = z.object({
  axis: z.enum(["row", "col"]),
  kind: z.enum(["insert", "delete"]),
  index: cellIndex,
});
export type StructuralEditBody = z.infer<typeof structuralEditBody>;

export const cellInput = z.object({
  row: cellIndex,
  col: cellIndex,
  /** What the user typed. An empty string clears the cell. */
  input: z.string().max(LIMITS.inputLength),
});

export const setCellsBody = z.object({
  cells: z.array(cellInput).min(1).max(LIMITS.cellsPerRequest),
});

/** A value chosen through a checkbox or dropdown. */
export const controlInputBody = z.object({
  value: z.union([z.string().max(LIMITS.inputLength), z.number(), z.boolean(), z.null()]),
});

export const createViewBody = z.object({ kind: z.enum(["chart", "text"]) });

export const updateViewBody = z
  .object({
    name: name.optional(),
    source: z.string().max(LIMITS.viewSourceLength).optional(),
    chartType: z.enum(["bar", "line", "pie", "scatter"]).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "Give at least one of name, source, chartType",
  });

export const viewParam = z.object({ viewId: z.uuid() });

/** Limits on a spreadsheet file, which a person can write by hand or another program can produce. */
export const FILE_LIMITS = {
  pages: 50,
  itemsPerPage: 50,
  /** Cells across the whole file. */
  cells: 100_000,
  /** The size of a request body the server reads, which bounds a file. */
  bytes: 32 * 1024 * 1024,
} as const;

export const FILE_FORMAT = "spreadsheet-app";

const fileTable = z.object({
  type: z.literal("table"),
  name,
  rowCount: z.int().min(1).max(LIMITS.tableRows),
  colCount: z.int().min(1).max(LIMITS.tableCols),
  /** Cells that hold something. Empty cells are left out. */
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
        /** Tables, charts, and text views, in their order on the page. */
        items: z
          .array(z.discriminatedUnion("type", [fileTable, fileChart, fileText]))
          .max(FILE_LIMITS.itemsPerPage),
      }),
    )
    .min(1)
    .max(FILE_LIMITS.pages),
});
export type SpreadsheetFile = z.infer<typeof spreadsheetFile>;

export const spreadsheetParam = z.object({ spreadsheetId: z.uuid() });
export const pageParam = z.object({ pageId: z.uuid() });
export const tableParam = z.object({ tableId: z.uuid() });
export const cellParam = z.object({
  tableId: z.uuid(),
  row: z.coerce.number().pipe(cellIndex),
  col: z.coerce.number().pipe(cellIndex),
});

export type CellInput = z.infer<typeof cellInput>;

/** A stored cell, as sent between server and client. */
export interface StoredCell extends CellInput {
  tableId: string;
}

/** The body of every error response. */
export interface ApiError {
  error: { code: string; message: string };
}
