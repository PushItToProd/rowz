import { isDate } from "./dates";
import { formatValue, isScalar, toNumber, type CellValue } from "./values";

export interface ChartSeries {
  name: string;
  /** One value per label. `null` where the cell held no number. */
  values: (number | null)[];
}

/** Rows of cells read as chart data: a label per point, and one or more series of numbers. */
export interface ChartData {
  labels: string[];
  /** The labels as numbers, for a chart that places points along a number line. */
  x: (number | null)[];
  /** Whether those numbers are dates, counted in days, which decides how the axis is labeled. */
  xIsDate: boolean;
  series: ChartSeries[];
}

/** A cell as a plotted number. Dates plot as their day count. Text, blanks, and errors do not plot. */
function plotted(cell: CellValue): number | null {
  if (typeof cell !== "number" && !isDate(cell)) return null;
  const value = isScalar(cell) ? toNumber(cell) : null;
  return typeof value === "number" ? value : null;
}

/**
 * Reads rows of cells as chart data.
 *
 * The first column holds the labels and each other column is a series. A
 * single column is one series, labeled by position. The first row names the
 * series when none of its series cells is a number and a later row has one.
 * Rows with nothing in them are left out.
 */
export function chartData(given: readonly (readonly CellValue[])[]): ChartData {
  // A whole column, such as `A:B` or `Sales[Total]`, brings the table's empty rows with it.
  const rows = given.filter((cells) => cells.some((cell) => cell !== null && cell !== ""));
  const width = Math.max(0, ...rows.map((cells) => cells.length));
  const seriesColumns = Array.from({ length: Math.max(width - 1, 1) }, (_, index) =>
    width === 1 ? 0 : index + 1,
  );
  const numbersIn = (cells: readonly CellValue[]): boolean =>
    seriesColumns.some((col) => plotted(cells[col] ?? null) !== null);

  const [first = [], ...rest] = rows;
  const hasHeader = !numbersIn(first) && rest.some(numbersIn);
  const body = hasHeader ? rest : rows;

  const labelCells = width === 1 ? [] : body.map((cells) => cells[0] ?? null);
  return {
    xIsDate: labelCells.some(isDate) && labelCells.every((cell) => cell === null || isDate(cell)),
    labels: body.map((cells, index) =>
      width === 1 ? String(index + 1) : formatValue(cells[0] ?? null),
    ),
    x: body.map((cells, index) => (width === 1 ? index + 1 : plotted(cells[0] ?? null))),
    series: seriesColumns.map((col, index) => ({
      name: hasHeader ? formatValue(first[col] ?? null) : `Series ${String(index + 1)}`,
      values: body.map((cells) => plotted(cells[col] ?? null)),
    })),
  };
}
