import { translateInput, type CellAddress } from "@spreadsheet-app/engine";
import type { CellInput } from "@spreadsheet-app/shared";

/** An inclusive rectangle of cells within one table. */
export interface Block {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export function blockOf(a: CellAddress, b: CellAddress = a): Block {
  return {
    startRow: Math.min(a.row, b.row),
    startCol: Math.min(a.col, b.col),
    endRow: Math.max(a.row, b.row),
    endCol: Math.max(a.col, b.col),
  };
}

export function contains(block: Block, { row, col }: CellAddress): boolean {
  return (
    row >= block.startRow && row <= block.endRow && col >= block.startCol && col <= block.endCol
  );
}

function cellsOf(block: Block): CellAddress[] {
  const cells: CellAddress[] = [];
  for (let row = block.startRow; row <= block.endRow; row += 1) {
    for (let col = block.startCol; col <= block.endCol; col += 1) cells.push({ row, col });
  }
  return cells;
}

/** A remainder that is never negative, for stepping backward through a repeating pattern. */
function wrap(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/**
 * The block a fill covers when the fill handle of `source` is dragged to
 * `to`. A fill goes one way: down or up when the pointer has left the
 * source's rows, otherwise right or left.
 */
export function fillTarget(source: Block, to: CellAddress): Block {
  if (to.row > source.endRow) return { ...source, endRow: to.row };
  if (to.row < source.startRow) return { ...source, startRow: to.row };
  if (to.col > source.endCol) return { ...source, endCol: to.col };
  if (to.col < source.startCol) return { ...source, startCol: to.col };
  return source;
}

/**
 * The inputs that fill `target` with the pattern of `source`: the source
 * cells repeat in every direction, and each copy of a formula has its
 * relative references moved by the distance it was copied. Cells of the
 * source itself are left alone.
 */
export function fillWrites(
  source: Block,
  target: Block,
  inputAt: (cell: CellAddress) => string,
): CellInput[] {
  const height = source.endRow - source.startRow + 1;
  const width = source.endCol - source.startCol + 1;
  return cellsOf(target)
    .filter((cell) => !contains(source, cell))
    .map(({ row, col }) => {
      const from = {
        row: source.startRow + wrap(row - source.startRow, height),
        col: source.startCol + wrap(col - source.startCol, width),
      };
      return { row, col, input: translateInput(inputAt(from), row - from.row, col - from.col) };
    });
}

/** The inputs that empty every cell of a block that holds something. */
export function clearWrites(block: Block, inputAt: (cell: CellAddress) => string): CellInput[] {
  return cellsOf(block)
    .filter((cell) => inputAt(cell) !== "")
    .map((cell) => ({ ...cell, input: "" }));
}

/** The inputs of a block as rows, for copying. */
export function inputsOf(block: Block, inputAt: (cell: CellAddress) => string): string[][] {
  const rows: string[][] = [];
  for (let row = block.startRow; row <= block.endRow; row += 1) {
    const cells: string[] = [];
    for (let col = block.startCol; col <= block.endCol; col += 1) cells.push(inputAt({ row, col }));
    rows.push(cells);
  }
  return rows;
}

/**
 * The inputs that paste rows of cells with their top-left corner at `at`.
 * When the rows were copied from this app, `copiedFrom` is where their
 * top-left corner was, and formulas move their relative references by the
 * distance between the two places.
 */
export function pasteWrites(
  rows: readonly (readonly string[])[],
  at: CellAddress,
  copiedFrom?: CellAddress,
): CellInput[] {
  const rowShift = copiedFrom ? at.row - copiedFrom.row : 0;
  const colShift = copiedFrom ? at.col - copiedFrom.col : 0;
  return rows.flatMap((cells, rowOffset) =>
    cells.map((input, colOffset) => ({
      row: at.row + rowOffset,
      col: at.col + colOffset,
      input: copiedFrom ? translateInput(input, rowShift, colShift) : input,
    })),
  );
}

// Tab between cells and a line break between rows: what spreadsheet apps put on the clipboard.
const CELL_SEPARATOR = "\t";
const ROW_SEPARATOR = /\r\n|\n|\r/;

export function toClipboardText(rows: readonly (readonly string[])[]): string {
  return rows.map((cells) => cells.join(CELL_SEPARATOR)).join("\n");
}

/** Reads clipboard text as rows of cells. A trailing line break, which other apps add, is not a row. */
export function fromClipboardText(text: string): string[][] {
  const lines = text.split(ROW_SEPARATOR);
  if (lines.length > 1 && lines.at(-1) === "") lines.pop();
  return lines.map((line) => line.split(CELL_SEPARATOR));
}
