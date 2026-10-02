export interface RowIdentity {
  id: string;
  orderKey: string;
}

export interface CellIdentity {
  rowId: string;
  colId: string;
}

export interface CellPosition {
  row: number;
  col: number;
}

/** One immutable translation between stored identities and engine positions. */
export class TableLayout {
  readonly rowIds: readonly string[];
  readonly colIds: readonly string[];
  private readonly rowPositions: Map<string, number>;
  private readonly colPositions: Map<string, number>;

  constructor(rows: readonly RowIdentity[], colIds: readonly string[]) {
    const ordered = rows.toSorted((a, b) =>
      a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0,
    );
    this.rowIds = Object.freeze(ordered.map(({ id }) => id));
    this.colIds = Object.freeze([...colIds]);
    this.rowPositions = new Map(this.rowIds.map((id, position) => [id, position]));
    this.colPositions = new Map(this.colIds.map((id, position) => [id, position]));
    if (
      this.rowPositions.size !== rows.length ||
      this.colPositions.size !== colIds.length ||
      new Set(rows.map(({ orderKey }) => orderKey)).size !== rows.length
    )
      throw new RangeError("Duplicate table identity or order key");
  }

  rowIndex(rowId: string): number | undefined {
    return this.rowPositions.get(rowId);
  }

  colIndex(colId: string): number | undefined {
    return this.colPositions.get(colId);
  }

  position({ rowId, colId }: CellIdentity): CellPosition | undefined {
    const row = this.rowIndex(rowId);
    const col = this.colIndex(colId);
    return row === undefined || col === undefined ? undefined : { row, col };
  }

  identity({ row, col }: CellPosition): CellIdentity | undefined {
    if (!Number.isInteger(row) || !Number.isInteger(col)) return undefined;
    const rowId = this.rowIds[row];
    const colId = this.colIds[col];
    return rowId === undefined || colId === undefined ? undefined : { rowId, colId };
  }
}
