import {
  editDecider,
  bareNamesAfterRename,
  moveDecider,
  renameDecider,
  rewriteBareNames,
  rewriteReferences,
  targetOf,
  type Decide,
  type Move,
  type Rename,
  type StructuralEdit,
} from "./rewrite";
import { TableResolver, type TableDefinition, type WorkbookStructure } from "./structure";

/** The formula of one name a table holds, identified by its table and its place in the table's list. */
export interface NameFormula {
  tableId: string;
  index: number;
  formula: string;
}

/** The formula of one formula column, identified by its table and its position there. */
export interface ColumnFormula {
  tableId: string;
  col: number;
  formula: string;
}

/** The formula of one table's filter, identified by its table. */
export interface FilterFormula {
  tableId: string;
  formula: string;
}

/**
 * A formula written in a table, rewritten. A reference in it with no table
 * name means that table. `formula` has its leading `=`.
 */
function rewriteInTable(
  resolver: TableResolver,
  structure: WorkbookStructure,
  table: TableDefinition,
  formula: string,
  decide: Decide,
  replaceBare?: (name: string) => string | undefined,
): string {
  const origin = { pageId: table.pageId, tableId: table.id };
  const rewritten = rewriteReferences(formula, (reference, qualified) =>
    decide(reference, targetOf(resolver, reference, qualified, origin, structure), origin),
  );
  if (!replaceBare || !rewritten.startsWith("=")) return rewritten;
  return `=${rewriteBareNames(rewritten.slice(1), replaceBare)}`;
}

/**
 * The formula columns whose formulas change under a rewrite. A column's
 * formula is written in its table, so a reference in it with no table name
 * means that table.
 */
function rewriteColumns(
  structure: WorkbookStructure,
  decide: Decide,
  replaceBare?: (name: string) => string | undefined,
): ColumnFormula[] {
  const resolver = new TableResolver(structure);
  return structure.tables.flatMap((table) =>
    (table.columns ?? []).flatMap((column, col) => {
      if (column.formula === undefined) return [];
      const formula = rewriteInTable(
        resolver,
        structure,
        table,
        column.formula,
        decide,
        replaceBare,
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
  return rewriteColumns(
    structure,
    renameDecider(new TableResolver(structure), rename),
    bareNamesAfterRename(structure, rename),
  );
}

/**
 * The column formulas that must name a page for a table to move to another
 * page and every formula to go on reading the tables it read.
 */
export function columnFormulasAfterMove(structure: WorkbookStructure, move: Move): ColumnFormula[] {
  return rewriteColumns(structure, moveDecider(structure, move));
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

/**
 * The names tables hold whose formulas change under a rewrite. Like a
 * column's formula, a name's formula is written in its table. A table's names
 * are in `structure.names`, in the order the table lists them.
 */
function rewriteNames(
  structure: WorkbookStructure,
  decide: Decide,
  replaceBare?: (name: string) => string | undefined,
): NameFormula[] {
  const resolver = new TableResolver(structure);
  const seen = new Map<string, number>();
  return (structure.names ?? []).flatMap(({ holderId, formula }) => {
    const index = seen.get(holderId) ?? 0;
    seen.set(holderId, index + 1);
    const table = structure.tables.find((candidate) => candidate.id === holderId);
    if (!table) return [];
    // A name's formula may be written without the `=` that rewriting looks for.
    const written = formula.startsWith("=") ? formula : `=${formula}`;
    const rewritten = rewriteInTable(resolver, structure, table, written, decide, replaceBare);
    if (rewritten === written) return [];
    return [
      {
        tableId: holderId,
        index,
        formula: formula.startsWith("=") ? rewritten : rewritten.slice(1),
      },
    ];
  });
}

/** The names of tables whose formulas name a page, table, or column being renamed. */
export function nameFormulasAfterRename(
  structure: WorkbookStructure,
  rename: Rename,
): NameFormula[] {
  return rewriteNames(
    structure,
    renameDecider(new TableResolver(structure), rename),
    bareNamesAfterRename(structure, rename),
  );
}

/** Rewrites a new or changed table-name formula as part of the same name rename. */
export function nameFormulaAfterRename(
  structure: WorkbookStructure,
  holderId: string,
  formula: string,
  rename: Rename,
): string {
  const table = structure.tables.find((candidate) => candidate.id === holderId);
  if (!table) return formula;
  const origin = { pageId: table.pageId, tableId: table.id };
  const resolver = new TableResolver(structure);
  const written = formula.startsWith("=") ? formula : `=${formula}`;
  let rewritten = rewriteReferences(written, (reference, qualified) =>
    renameDecider(resolver, rename)(
      reference,
      targetOf(resolver, reference, qualified, origin, structure),
      origin,
    ),
  );
  rewritten = `=${rewriteBareNames(rewritten.slice(1), bareNamesAfterRename(structure, rename))}`;
  return formula.startsWith("=") ? rewritten : rewritten.slice(1);
}

/** The names of tables whose formulas must name a page for a table to move to another page. */
export function nameFormulasAfterMove(structure: WorkbookStructure, move: Move): NameFormula[] {
  return rewriteNames(structure, moveDecider(structure, move));
}

/** The names of tables whose formulas read a table whose row or column is being inserted or deleted. */
export function nameFormulasAfterEdit(
  structure: WorkbookStructure,
  edit: StructuralEdit,
): NameFormula[] {
  return rewriteNames(structure, editDecider(edit));
}

/**
 * The filters of tables whose formulas change under a rewrite. A filter is
 * written in its table, like a formula column's formula, and may lack the `=`.
 */
function rewriteFilters(
  structure: WorkbookStructure,
  decide: Decide,
  replaceBare?: (name: string) => string | undefined,
): FilterFormula[] {
  const resolver = new TableResolver(structure);
  return structure.tables.flatMap((table) => {
    if (table.filter === undefined) return [];
    const written = table.filter.startsWith("=") ? table.filter : `=${table.filter}`;
    const rewritten = rewriteInTable(resolver, structure, table, written, decide, replaceBare);
    if (rewritten === written) return [];
    return [
      { tableId: table.id, formula: table.filter.startsWith("=") ? rewritten : rewritten.slice(1) },
    ];
  });
}

/** The filters that name a page, table, or column being renamed, with the new name written in. */
export function filterFormulasAfterRename(
  structure: WorkbookStructure,
  rename: Rename,
): FilterFormula[] {
  return rewriteFilters(
    structure,
    renameDecider(new TableResolver(structure), rename),
    bareNamesAfterRename(structure, rename),
  );
}

/** The filters that must name a page for a table to move to another page. */
export function filterFormulasAfterMove(structure: WorkbookStructure, move: Move): FilterFormula[] {
  return rewriteFilters(structure, moveDecider(structure, move));
}

/** The filters that read a table whose row or column is being inserted or deleted, rewritten to follow. */
export function filterFormulasAfterEdit(
  structure: WorkbookStructure,
  edit: StructuralEdit,
): FilterFormula[] {
  return rewriteFilters(structure, editDecider(edit));
}
