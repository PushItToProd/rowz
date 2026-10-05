import {
  analyzeSource,
  formulaAt,
  isColumnReference,
  type EditingMode,
  type Reference,
} from "@spreadsheet-app/engine";

export const referenceColors = ["#175cd3", "#b54708", "#027a48", "#9333a6", "#c11574", "#087e8b"];

export interface ReferenceContext {
  pageId: string | undefined;
  tableId?: string;
  row?: number;
  pages: readonly { id: string; name: string }[];
  tables: readonly {
    id?: string;
    pageId: string;
    name: string;
    rowCount?: number;
    colCount?: number;
    columns?: readonly { name: string }[] | null;
  }[];
}

export interface ReferenceHighlight {
  from: number;
  to: number;
  color: string;
  cells?: {
    tableId: string;
    startRow: number;
    endRow: number;
    startCol: number;
    endCol: number;
  };
}

/** Resolve only direct addresses and structured columns. Names are never evaluated. */
function referenceCells(
  reference: Reference,
  context: ReferenceContext,
): ReferenceHighlight["cells"] {
  const pageName = reference.page?.toLowerCase();
  const tableName = reference.table?.toLowerCase();
  const pageId =
    reference.page === undefined
      ? context.pageId
      : context.pages.find((page) => page.name.toLowerCase() === pageName)?.id;
  const table =
    reference.table === undefined
      ? context.tables.find((table) => table.id === context.tableId)
      : pageId === undefined
        ? undefined
        : context.tables.find(
            (table) => table.pageId === pageId && table.name.toLowerCase() === tableName,
          );
  if (!table?.id || !table.rowCount || !table.colCount) return undefined;
  if (isColumnReference(reference)) {
    const row = context.row ?? -1;
    const col =
      table.columns?.findIndex(
        (column) => column.name.toLowerCase() === reference.column.toLowerCase(),
      ) ?? -1;
    if (col < 0 || (reference.table === undefined && (row < 0 || row >= table.rowCount)))
      return undefined;
    return {
      tableId: table.id,
      startRow: reference.table === undefined ? row : 0,
      endRow: reference.table === undefined ? row : table.rowCount - 1,
      startCol: col,
      endCol: col,
    };
  }
  const end = reference.end ?? reference.start;
  const startRow = reference.start.row ?? 0;
  const endRow = end.row ?? table.rowCount - 1;
  const startCol = reference.start.col ?? 0;
  const endCol = end.col ?? table.colCount - 1;
  return {
    tableId: table.id,
    startRow: Math.min(startRow, endRow),
    endRow: Math.max(startRow, endRow),
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol),
  };
}

/** Outline visible portions using display neighbors while retaining stored coordinates. */
export function referenceOutlines(
  references: readonly ReferenceHighlight[],
  tableId: string,
  rows: readonly number[],
  colCount: number,
): Map<string, { boxShadow: string; color: string }> {
  const outlines = new Map<string, { boxShadow: string; color: string }>();
  const seen = new Set<string>();
  for (const { cells, color } of references) {
    if (cells?.tableId !== tableId) continue;
    const key = JSON.stringify(cells);
    if (seen.has(key)) continue;
    seen.add(key);
    const firstCol = Math.max(0, cells.startCol);
    const lastCol = Math.min(colCount - 1, cells.endCol);
    if (lastCol < firstCol) continue;
    const includes = (row: number | undefined) =>
      row !== undefined && row >= cells.startRow && row <= cells.endRow;
    rows.forEach((row, place) => {
      if (!includes(row)) return;
      const top = !includes(rows[place - 1]);
      const bottom = !includes(rows[place + 1]);
      for (let col = firstCol; col <= lastCol; col++) {
        const shadows = [
          ...(top ? [`inset 0 2px ${color}`] : []),
          ...(bottom ? [`inset 0 -2px ${color}`] : []),
          ...(col === firstCol ? [`inset 2px 0 ${color}`] : []),
          ...(col === lastCol ? [`inset -2px 0 ${color}`] : []),
        ];
        if (!shadows.length) continue;
        const id = `${String(place)}:${String(col)}`;
        const previous = outlines.get(id);
        outlines.set(id, {
          boxShadow: [...(previous ? [previous.boxShadow] : []), ...shadows].join(", "),
          color,
        });
      }
    });
  }
  return outlines;
}

export function referenceHighlights(
  source: string,
  mode: EditingMode,
  caret: number,
  context: ReferenceContext,
): ReferenceHighlight[] {
  const region = formulaAt(analyzeSource(source, mode), caret);
  if (!region) return [];
  const colors = new Map<string, string>();
  return region.references
    .filter((located) => !located.qualified)
    .map(({ from, to, reference }) => {
      const cells = referenceCells(reference, context);
      const key = cells
        ? JSON.stringify(cells)
        : JSON.stringify(
            isColumnReference(reference)
              ? {
                  ...reference,
                  page: reference.page?.toLowerCase(),
                  table: reference.table?.toLowerCase(),
                  column: reference.column.toLowerCase(),
                }
              : {
                  ...reference,
                  page: reference.page?.toLowerCase(),
                  table: reference.table?.toLowerCase(),
                  start: { row: reference.start.row, col: reference.start.col },
                  end: reference.end && { row: reference.end.row, col: reference.end.col },
                },
          );
      let color = colors.get(key);
      if (!color) {
        color = referenceColors[colors.size % referenceColors.length] ?? "#175cd3";
        colors.set(key, color);
      }
      return { from, to, color, cells };
    });
}
