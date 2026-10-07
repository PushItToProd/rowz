import { parseAddress, type CellId } from "./address";
import type { CellValue } from "./values";
import type { WorkbookStructure } from "./structure";
import { Workbook } from "./workbook";

/** Two tables on the first page and one on the second, enough to exercise every reference form. */
export const STRUCTURE: WorkbookStructure = {
  pages: [
    { id: "p1", name: "Page 1" },
    { id: "p2", name: "Archive" },
  ],
  tables: [
    { id: "t1", pageId: "p1", name: "Table1" },
    { id: "t2", pageId: "p1", name: "Other Table" },
    { id: "t3", pageId: "p2", name: "Table1" },
  ],
};

export function at(address: string, tableId = "t1"): CellId {
  const parsed = parseAddress(address);
  if (!parsed) throw new Error(`Bad test address ${address}`);
  return { tableId, ...parsed };
}

/** Builds a workbook from inputs keyed by address per table, using the default or supplied structure. */
export function workbookWith(
  cells: Record<string, Record<string, string>>,
  structure: WorkbookStructure = STRUCTURE,
): Workbook {
  const workbook = new Workbook();
  workbook.setStructure(structure);
  for (const [tableId, inputs] of Object.entries(cells)) {
    for (const [address, input] of Object.entries(inputs)) {
      workbook.setCell(at(address, tableId), input);
    }
  }
  return workbook;
}

/** Evaluates a formula in table t1, whose other cells are `cells`. */
export function evaluateFormula(formula: string, cells: Record<string, string> = {}): CellValue {
  const workbook = workbookWith({ t1: { ...cells, Z99: formula } });
  return workbook.getValue(at("Z99"));
}
