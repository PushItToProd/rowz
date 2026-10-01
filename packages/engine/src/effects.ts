/**
 * A side effect an action asks for. The engine only describes effects. The
 * caller applies them, so the engine itself never performs I/O.
 */
export type Effect = SetCellEffect | SendEmailEffect;

export interface SetCellEffect {
  type: "setCell";
  tableId: string;
  row: number;
  col: number;
  /** Cell input to store, in the same form a user would type it. */
  input: string;
}

export interface SendEmailEffect {
  type: "sendEmail";
  to: string[];
  cc: string[];
  subject: string;
  body: string;
}
