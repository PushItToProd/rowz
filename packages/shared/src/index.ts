import { z } from "zod";

export const LIMITS = {
  nameLength: 100,
  /** Characters in one cell's input. */
  inputLength: 8192,
  cellsPerRequest: 1000,
  tableRows: 1000,
  tableCols: 100,
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
