import type { Reference } from "./ast";
import {
  editDecider,
  moveDecider,
  renameDecider,
  rewriteReferences,
  type Decide,
  type Move,
  type Rename,
  type Replacement,
  type StructuralEdit,
} from "./rewrite";
import { TableResolver, type WorkbookStructure } from "./structure";
import { rewriteTemplate } from "./template";

export type ViewKind = "chart" | "text";

/**
 * Something on a page that shows spreadsheet data without being a table. A
 * chart's source is the formula for its data. A text view's source is its
 * template.
 */
export interface ViewSource {
  id: string;
  pageId: string;
  kind: ViewKind;
  source: string;
}

/** Rewrites the references in a view's source, whichever kind of source it is. */
function rewriteSource(
  { kind, source }: ViewSource,
  replace: (reference: Reference) => Replacement | undefined,
): string {
  if (kind === "text") return rewriteTemplate(source, replace);
  // A chart's formula may be written with or without the leading `=`.
  const written = source.startsWith("=");
  const rewritten = rewriteReferences(written ? source : `=${source}`, replace);
  return written ? rewritten : rewritten.slice(1);
}

/** The views whose sources change under a rewrite, with their new sources. */
function rewriteViews(
  structure: WorkbookStructure,
  views: readonly ViewSource[],
  decide: Decide,
): { id: string; source: string }[] {
  const resolver = new TableResolver(structure);
  return views.flatMap((view) => {
    const origin = { pageId: view.pageId, viewId: view.id };
    const source = rewriteSource(view, (reference) =>
      decide(reference, resolver.findFromPage(reference, view.pageId), origin),
    );
    return source === view.source ? [] : [{ id: view.id, source }];
  });
}

/** The views that name a page or table being renamed, with the new name written in. */
export function viewsAfterRename(
  structure: WorkbookStructure,
  views: readonly ViewSource[],
  rename: Rename,
): { id: string; source: string }[] {
  return rewriteViews(structure, views, renameDecider(new TableResolver(structure), rename));
}

/**
 * The views whose sources must name a page for a table or view to move to
 * another page and every view to go on reading the tables it read.
 */
export function viewsAfterMove(
  structure: WorkbookStructure,
  views: readonly ViewSource[],
  move: Move,
): { id: string; source: string }[] {
  return rewriteViews(structure, views, moveDecider(structure, move));
}

/** The views that read a table whose row or column is being inserted or deleted, rewritten to follow. */
export function viewsAfterEdit(
  structure: WorkbookStructure,
  views: readonly ViewSource[],
  edit: StructuralEdit,
): { id: string; source: string }[] {
  return rewriteViews(structure, views, editDecider(edit));
}
