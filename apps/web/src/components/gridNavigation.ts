import type { CellAddress } from "@spreadsheet-app/engine";

/** Finds the spreadsheet-style Ctrl/Cmd+Arrow destination along one axis. */
export function dataRegionDestination(
  from: CellAddress,
  direction: CellAddress,
  rowCount: number,
  colCount: number,
  isNonEmpty: (cell: CellAddress) => boolean,
): CellAddress {
  const vertical = direction.row !== 0;
  const step = vertical ? direction.row : direction.col;
  const size = vertical ? rowCount : colCount;
  const edge = step < 0 ? 0 : Math.max(0, size - 1);
  if (size <= 0 || step === 0) return { row: 0, col: 0 };

  const start = Math.min(Math.max(vertical ? from.row : from.col, 0), size - 1);
  const fixed = vertical ? from.col : from.row;
  const at = (position: number): CellAddress =>
    vertical ? { row: position, col: fixed } : { row: fixed, col: position };
  const inside = (position: number): boolean => position >= 0 && position < size;
  const next = start + step;

  if (isNonEmpty(at(start)) && inside(next) && isNonEmpty(at(next))) {
    let last = next;
    while (inside(last + step) && isNonEmpty(at(last + step))) last += step;
    return at(last);
  }

  for (let position = next; inside(position); position += step) {
    if (isNonEmpty(at(position))) return at(position);
  }
  return at(edge);
}

/** Finds the bottom-right extent of the cells that contain data, defaulting to A1. */
export function usedRangeDestination(
  rowCount: number,
  colCount: number,
  isNonEmpty: (cell: CellAddress) => boolean,
): CellAddress {
  let lastRow = 0;
  let lastCol = 0;

  for (let row = rowCount - 1; row >= 0; row--) {
    let found = false;
    for (let col = colCount - 1; col >= 0; col--) {
      if (isNonEmpty({ row, col })) {
        lastRow = row;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  for (let col = colCount - 1; col >= 0; col--) {
    let found = false;
    for (let row = rowCount - 1; row >= 0; row--) {
      if (isNonEmpty({ row, col })) {
        lastCol = col;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  return { row: lastRow, col: lastCol };
}

/** Counts table rows that intersect the visible part of the browser viewport. */
export function countVisibleRows(
  rowOffsets: readonly number[],
  top: number,
  bottom: number,
): number {
  let visible = 0;
  for (let row = 0; row < rowOffsets.length - 1; row++) {
    const rowTop = rowOffsets[row] ?? 0;
    const rowBottom = rowOffsets[row + 1] ?? rowTop;
    if (rowBottom > top && rowTop < bottom) visible++;
  }
  return visible;
}
