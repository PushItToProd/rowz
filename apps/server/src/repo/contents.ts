import type { CellId, StoredInput, WorkbookData } from "@spreadsheet-app/engine";
import {
  layoutsOf,
  type IdentifiedCell,
  type StoredCell,
  type TableLayout,
} from "@spreadsheet-app/shared";
import { columnDeleted, notFound, rowDeleted } from "../errors";
import type { Snapshot, TableRecord, ViewRecord } from "./spreadsheets";

/** A table with the size its rows and columns give it, as the engine and a file state it. */
export type SizedTable = TableRecord & { rowCount: number; colCount: number };

/**
 * One read of a spreadsheet, in both forms the server works with. Storage,
 * requests, and the journal name rows and columns by id. The formula engine
 * and the file format name them by position. This is where the server
 * translates, and because both forms come from the one read, they agree.
 */
export class Contents {
  private readonly layouts: ReadonlyMap<string, TableLayout>;
  /** What the engine reads: tables with their sizes, cells by position, and the views. */
  readonly data: Omit<WorkbookData, "tables"> & { tables: SizedTable[]; views: ViewRecord[] };

  constructor(readonly snapshot: Snapshot) {
    this.layouts = layoutsOf(snapshot.tables, snapshot.rows);
    this.data = {
      pages: snapshot.pages,
      tables: snapshot.tables.map((table) => ({
        ...table,
        rowCount: this.layout(table.id).rowIds.length,
        colCount: table.colIds.length,
      })),
      views: snapshot.views,
      cells: snapshot.cells.flatMap(({ tableId, input, ...identity }) => {
        const position = this.layouts.get(tableId)?.position(identity);
        return position ? [{ tableId, ...position, input }] : [];
      }),
    };
  }

  layout(tableId: string): TableLayout {
    const layout = this.layouts.get(tableId);
    if (!layout) throw notFound("Table");
    return layout;
  }

  /** Where a cell that a request named is now. Refuses a cell whose row or column is gone. */
  position({ tableId, rowId, colId }: IdentifiedCell): CellId {
    const layout = this.layout(tableId);
    const row = layout.rowIndex(rowId);
    if (row === undefined) throw rowDeleted();
    const col = layout.colIndex(colId);
    if (col === undefined) throw columnDeleted();
    return { tableId, row, col };
  }

  /** The ids of a cell the engine named by position, which must be inside its table. */
  identify({ tableId, row, col, input }: StoredInput): StoredCell {
    const identity = this.layout(tableId).identity({ row, col });
    if (!identity) throw new Error(`No cell at row ${String(row)}, column ${String(col)}`);
    return { tableId, ...identity, input };
  }
}
