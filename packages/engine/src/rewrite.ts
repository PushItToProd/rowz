import type { CellId } from "./address";
import { formatReference, type Reference } from "./ast";
import { parseFormulaWithReferences, type LocatedReference } from "./parser";
import { FormulaSyntaxError } from "./tokenizer";
import { isFormulaInput } from "./values";
import type { WorkbookData } from "./workbook";

/** What to write in place of a reference: a new reference, or `#REF!` when its target is gone. */
export type Replacement = Reference | "#REF!";

/**
 * Rewrites the references in a cell input and leaves every other character
 * as the user typed it. `replace` returns the new reference, or `undefined`
 * to keep the one written. An input that is not a formula, or that does not
 * parse, is returned unchanged.
 */
export function rewriteReferences(
  input: string,
  replace: (reference: Reference) => Replacement | undefined,
): string {
  if (!isFormulaInput(input)) return input;
  let text = input.slice(1);
  let references: LocatedReference[];
  try {
    ({ references } = parseFormulaWithReferences(text));
  } catch (cause) {
    if (cause instanceof FormulaSyntaxError) return input;
    throw cause;
  }

  // Last to first, so earlier offsets stay valid while later text changes length.
  for (const { reference, from, to } of references.toReversed()) {
    const replacement = replace(reference);
    if (replacement === undefined) continue;
    const written = replacement === "#REF!" ? replacement : formatReference(replacement);
    text = text.slice(0, from) + written + text.slice(to);
  }
  return `=${text}`;
}

export type Rename =
  { kind: "page"; pageId: string; name: string } | { kind: "table"; tableId: string; name: string };

export type StoredInput = CellId & { input: string };

function sameName(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The cells whose formulas name a page or table that is being renamed, with
 * the new name written in. `data` is the workbook before the rename.
 */
export function inputsAfterRename(data: WorkbookData, rename: Rename): StoredInput[] {
  const pageOfTable = new Map(data.tables.map((table) => [table.id, table.pageId]));
  const pageName = new Map(data.pages.map((page) => [page.id, page.name]));
  const renamedTable =
    rename.kind === "table" ? data.tables.find((table) => table.id === rename.tableId) : undefined;
  const oldPageName = rename.kind === "page" ? pageName.get(rename.pageId) : undefined;

  /** Decides, for a formula in `originTableId`, whether a reference names what is being renamed. */
  const replace =
    (originTableId: string) =>
    (reference: Reference): Replacement | undefined => {
      if (rename.kind === "page") {
        const named = reference.page !== undefined && oldPageName !== undefined;
        return named && sameName(reference.page ?? "", oldPageName)
          ? { ...reference, page: rename.name }
          : undefined;
      }
      if (!renamedTable || reference.table === undefined) return undefined;
      if (!sameName(reference.table, renamedTable.name)) return undefined;
      // Without a page qualifier, a table name refers to the formula's own page.
      const referencedPage =
        reference.page === undefined
          ? pageOfTable.get(originTableId) === renamedTable.pageId
          : sameName(reference.page, pageName.get(renamedTable.pageId) ?? "");
      return referencedPage ? { ...reference, table: rename.name } : undefined;
    };

  return data.cells.flatMap(({ input, ...cell }) => {
    const rewritten = rewriteReferences(input, replace(cell.tableId));
    return rewritten === input ? [] : [{ ...cell, input: rewritten }];
  });
}
