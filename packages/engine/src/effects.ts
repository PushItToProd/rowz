/**
 * A side effect an action asks for. The engine only describes effects. The
 * caller applies them, so the engine itself never performs I/O.
 */
export type Effect = SetCellEffect | EnsureRowsEffect | DeleteRowsEffect | SendEmailEffect;

export interface SetCellEffect {
  type: "setCell";
  tableId: string;
  row: number;
  col: number;
  /** Cell input to store, in the same form a user would type it. */
  input: string;
}

/** Grows a table so it has at least this many rows. A table that is already as tall is left alone. */
export interface EnsureRowsEffect {
  type: "ensureRows";
  tableId: string;
  rowCount: number;
}

/** Deletes `count` rows of a table, from `startRow` on. Formulas that read the table follow, as for any deleted row. */
export interface DeleteRowsEffect {
  type: "deleteRows";
  tableId: string;
  startRow: number;
  count: number;
}

export interface SendEmailEffect {
  type: "sendEmail";
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}
