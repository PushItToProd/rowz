/** Zero-based position of a cell within a table. */
export interface CellAddress {
  row: number;
  col: number;
}

/** A cell in a specific table. */
export interface CellId extends CellAddress {
  tableId: string;
}

/**
 * An inclusive rectangle of cells in a specific table, with start <= end. An
 * end is `Infinity` for a range with an open side, such as a whole column.
 */
export interface CellRange {
  tableId: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

const LETTERS = 26;
const CODE_A = 65;
const ADDRESS_PATTERN = /^([A-Za-z]{1,3})([1-9][0-9]*)$/;

/** Converts a zero-based column index to its label: 0 -> "A", 26 -> "AA". */
export function columnLabel(col: number): string {
  let label = "";
  for (let n = col; n >= 0; n = Math.floor(n / LETTERS) - 1) {
    label = String.fromCharCode(CODE_A + (n % LETTERS)) + label;
  }
  return label;
}

/** Converts a column label to its zero-based index: "A" -> 0, "AA" -> 26. */
export function columnIndex(label: string): number {
  let index = 0;
  for (const char of label.toUpperCase()) {
    index = index * LETTERS + (char.charCodeAt(0) - CODE_A + 1);
  }
  return index - 1;
}

export function formatAddress({ row, col }: CellAddress): string {
  return `${columnLabel(col)}${String(row + 1)}`;
}

export function parseAddress(text: string): CellAddress | undefined {
  const match = ADDRESS_PATTERN.exec(text);
  if (!match) return undefined;
  const [, letters = "", digits = ""] = match;
  return { row: Number(digits) - 1, col: columnIndex(letters) };
}

export function cellKey({ tableId, row, col }: CellId): string {
  return `${tableId}:${String(row)}:${String(col)}`;
}

export function rangeContains(range: CellRange, cell: CellId): boolean {
  return (
    range.tableId === cell.tableId &&
    cell.row >= range.startRow &&
    cell.row <= range.endRow &&
    cell.col >= range.startCol &&
    cell.col <= range.endCol
  );
}
