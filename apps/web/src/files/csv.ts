/**
 * CSV as RFC 4180 describes it: cells separated by commas, rows by line
 * breaks, and a cell that holds a comma, a quote, or a line break wrapped in
 * double quotes with its own quotes doubled.
 */

const NEEDS_QUOTES = /[",\r\n]/;

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((cells) =>
      cells
        .map((cell) => (NEEDS_QUOTES.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell))
        .join(","),
    )
    .join("\r\n");
}

const SEPARATORS = [",", ";", "\t"];
/** How many of the first rows the separator is judged from. */
const SAMPLE_ROWS = 5;

/**
 * Reads CSV text as rows of cells. A file with semicolons or tabs between
 * cells, as some locales and programs write them, is read the same way.
 */
export function parseCsv(text: string): string[][] {
  // A byte order mark, which Excel writes at the start of a UTF-8 file, is not part of the first cell.
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const readings = SEPARATORS.map((separator) => parseWith(source, separator));
  return readings.reduce((best, candidate) => (score(candidate) > score(best) ? candidate : best));
}

/**
 * How well a reading fits its separator. The right separator splits the
 * first rows into the same number of cells each. A file of decimal commas
 * separated by semicolons has commas in some rows and not others, and
 * semicolons evenly in all.
 */
function score(rows: readonly string[][]): number {
  const [first = 0, ...rest] = rows.slice(0, SAMPLE_ROWS).map((row) => row.length - 1);
  // An even split outranks any uneven one, however many separators that one has.
  return rest.every((count) => count === first) ? first * 1000 : first;
}

function parseWith(source: string, separator: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  /** Whether the current cell has begun, which tells a final empty line from a final empty cell. */
  let started = false;

  const endCell = (): void => {
    row.push(cell);
    cell = "";
    started = false;
  };
  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else quoted = false;
    } else if (char === '"' && cell === "") {
      quoted = true;
      started = true;
    } else if (char === separator) {
      endCell();
      started = true;
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      endRow();
    } else {
      cell += char;
      started = true;
    }
  }
  // A line break at the end of the file ends the last row and does not start another.
  if (started || cell !== "" || row.length > 0) endRow();
  return rows;
}
