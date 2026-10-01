import {
  editDecider,
  renameDecider,
  rewriteReferences,
  type Decide,
  type Rename,
  type StructuralEdit,
} from "./rewrite";
import { TableResolver, type WorkbookStructure } from "./structure";

/** The formula of one formula column, identified by its table and its position there. */
export interface ColumnFormula {
  tableId: string;
  col: number;
  formula: string;
}

/**
 * The formula columns whose formulas change under a rewrite. A column's
 * formula is written in its table, so a reference in it with no table name
 * means that table.
 */
function rewriteColumns(structure: WorkbookStructure, decide: Decide): ColumnFormula[] {
  const resolver = new TableResolver(structure);
  return structure.tables.flatMap((table) =>
    (table.columns ?? []).flatMap((column, col) => {
      if (column.formula === undefined) return [];
      const formula = rewriteReferences(column.formula, (reference) =>
        decide(reference, resolver.find(reference, table.id)),
      );
      return formula === column.formula ? [] : [{ tableId: table.id, col, formula }];
    }),
  );
}

/** The column formulas that name a page, table, or column being renamed, with the new name written in. */
export function columnFormulasAfterRename(
  structure: WorkbookStructure,
  rename: Rename,
): ColumnFormula[] {
  return rewriteColumns(structure, renameDecider(new TableResolver(structure), rename));
}

/**
 * The column formulas that read a table whose row or column is being
 * inserted or deleted, rewritten to follow. `col` is the column's position
 * before the edit.
 */
export function columnFormulasAfterEdit(
  structure: WorkbookStructure,
  edit: StructuralEdit,
): ColumnFormula[] {
  return rewriteColumns(structure, editDecider(edit));
}
