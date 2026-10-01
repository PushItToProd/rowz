import { formatDate, parseDate, translateInput, type CellAddress } from "@spreadsheet-app/engine";
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

const PLAIN_NUMBER = /^-?\d+(?:\.\d+)?$/;
// Text that ends in a whole number, such as `Week 1` or `Q3`.
const NUMBERED_TEXT = /^(.*\D)(\d+)$/s;
const DAY_MS = 86_400_000;

/** The step between every two neighbors when it is the same throughout, or `undefined`. */
function constantStep(values: readonly number[]): number | undefined {
  const [first = 0, second = 0] = values;
  const step = second - first;
  const even = values.every(
    (value, index) => index === 0 || Math.abs(value - (values[index - 1] ?? 0) - step) < 1e-9,
  );
  return even ? step : undefined;
}

/**
 * Finds the series a line of source cells begins, and gives the input at any
 * position along it, counting from the first source cell. Positions before
 * the first are negative.
 *
 * Two or more numbers or dates an even step apart continue by that step. One
 * date continues a day at a time. Text ending in a number, such as `Week 1`,
 * counts up. Anything else is not a series.
 */
export function seriesOf(inputs: readonly string[]): ((position: number) => string) | undefined {
  // A formula is copied with its references moved, however its text ends.
  if (inputs.length === 0 || inputs.some((input) => input.startsWith("="))) return undefined;

  if (inputs.length >= 2 && inputs.every((input) => PLAIN_NUMBER.test(input))) {
    const numbers = inputs.map(Number);
    const step = constantStep(numbers);
    if (step === undefined) return undefined;
    // Rounded so that steps of 0.1 do not show the noise of binary fractions.
    return (position) => String(Number(((numbers[0] ?? 0) + step * position).toFixed(10)));
  }

  const dates = inputs.map((input) => parseDate(input));
  if (dates.every((date) => date !== undefined)) {
    const step = dates.length === 1 ? DAY_MS : constantStep(dates.map((date) => date.ms));
    if (step === undefined) return undefined;
    return (position) => formatDate({ kind: "date", ms: (dates[0]?.ms ?? 0) + step * position });
  }

  const numbered = inputs.map((input) => NUMBERED_TEXT.exec(input));
  const [first] = numbered;
  if (first && numbered.every((match) => match?.[1] === first[1])) {
    const counts = numbered.map((match) => Number(match?.[2]));
    const step = counts.length === 1 ? 1 : constantStep(counts);
    if (step === undefined) return undefined;
    return (position) => {
      const count = (counts[0] ?? 0) + step * position;
      // A count below zero has no place in a name, so the pattern repeats there instead.
      return count < 0
        ? (inputs[wrap(position, inputs.length)] ?? "")
        : `${first[1] ?? ""}${String(count)}`;
    };
  }
  return undefined;
}

/**
 * The inputs that fill `target` with the pattern of `source`: the source
 * cells repeat in every direction, and each copy of a formula has its
 * relative references moved by the distance it was copied. Cells of the
 * source itself are left alone.
 *
 * With `series`, a line of source cells that begins a series is continued
 * instead of repeated: `1, 2` goes on to `3, 4`.
 */
export function fillWrites(
  source: Block,
  target: Block,
  inputAt: (cell: CellAddress) => string,
  series = false,
): CellInput[] {
  const height = source.endRow - source.startRow + 1;
  const width = source.endCol - source.startCol + 1;
  // A fill runs along one axis: down or up when the target has more rows, otherwise across.
  const vertical = target.startRow !== source.startRow || target.endRow !== source.endRow;
  const found = new Map<number, ReturnType<typeof seriesOf>>();
  /** The series of the source line that a cell continues: its column for a vertical fill, its row otherwise. */
  const seriesAt = ({ row, col }: CellAddress): ReturnType<typeof seriesOf> => {
    if (!series) return undefined;
    const line = vertical ? col : row;
    if (!found.has(line)) {
      const inputs = Array.from({ length: vertical ? height : width }, (_, index) =>
        inputAt(
          vertical ? { row: source.startRow + index, col } : { row, col: source.startCol + index },
        ),
      );
      found.set(line, seriesOf(inputs));
    }
    return found.get(line);
  };

  return cellsOf(target)
    .filter((cell) => !contains(source, cell))
    .map(({ row, col }) => {
      const continued = seriesAt({ row, col });
      if (continued) {
        const position = vertical ? row - source.startRow : col - source.startCol;
        return { row, col, input: continued(position) };
      }
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
