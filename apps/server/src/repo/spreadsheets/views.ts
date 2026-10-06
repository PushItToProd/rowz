import {
  renamedNames,
  scriptNames,
  viewSourceAfterRename,
  type ChartType,
} from "@spreadsheet-app/engine";
import { and, eq } from "drizzle-orm";
import { type Change } from "../journal";
import { views, type ViewKind } from "../../db/schema";
import { unprocessable } from "../../errors";
import { type ViewRecord, type Created } from "./records";
import { nextName } from "./helpers";
import type { RepositoryContext } from "./context";

export const VIEW_LABELS: Record<ViewKind, string> = {
  chart: "Add chart",
  text: "Add text view",
  script: "Add script",
};

/** What a new script holds: an example of each kind of statement, as comments. */
export const STARTER_SCRIPT = `// Each line names a formula. Formulas anywhere in the document can use the name.
// Total = SUM(Sales[Amount])
// WithTax(amount) = amount * 1.2
`;

export const STARTER_TEMPLATE = `## New text view

Write Markdown here. A formula in double braces puts its value into the text: {{ 1 + 1 }}
`;

/** Adds a view at an index, defaulting to the end of a page. */
export async function createView(
  ctx: RepositoryContext,
  pageId: string,
  kind: ViewKind,
  insertAt?: number,
): Promise<Created<{ view: ViewRecord }>> {
  const { result, change } = await ctx.changePage(pageId, async (_page, tx, writer) => {
    writer.setLabel(VIEW_LABELS[kind]);
    const position = await ctx.within(tx).insertPosition(pageId, writer, insertAt);
    if (kind === "script") {
      const name = nextName("Script", await ctx.holderNames(tx, pageId));
      return writer.insertView({ pageId, kind, position, name, source: STARTER_SCRIPT });
    }
    const siblings = await tx
      .select({ name: views.name })
      .from(views)
      .where(and(eq(views.pageId, pageId), eq(views.kind, kind)));
    const names = siblings.map((view) => view.name);
    return writer.insertView({
      pageId,
      kind,
      position,
      ...(kind === "chart"
        ? { name: nextName("Chart", names), source: "", chartType: "bar" as const }
        : { name: nextName("Text", names), source: STARTER_TEMPLATE }),
    });
  });
  return { view: result, change };
}

export async function updateView(
  ctx: RepositoryContext,
  viewId: string,
  {
    revision: _revision,
    ...changes
  }: {
    name?: string | undefined;
    source?: string | undefined;
    chartType?: ChartType | undefined;
    revision?: number | undefined;
  },
): Promise<Change> {
  const { change } = await ctx.changeView(viewId, async (view, tx, writer) => {
    writer.setLabel(`Update ${view.kind} ${view.name}`);
    if (changes.chartType !== undefined && view.kind !== "chart") {
      throw unprocessable("not_a_chart", `${view.name} is not a chart`);
    }
    let source = changes.source;
    if (view.kind === "script" && source !== undefined && source !== view.source) {
      const renames = renamedNames(scriptNames(viewId, view.source), scriptNames(viewId, source));
      for (const rename of renames) {
        const change = {
          kind: "name" as const,
          holderId: viewId,
          ...rename,
        };
        const contents = await ctx.rewriteFormulas(tx, writer, view.spreadsheetId, change);
        source = viewSourceAfterRename(contents.data, { ...view, source }, change);
      }
    }
    if (view.kind === "script" && changes.name !== undefined && changes.name !== view.name) {
      await ctx.checkHolderName(tx, view.pageId, changes.name, { kind: "script", id: viewId });
      await ctx.rewriteFormulas(tx, writer, view.spreadsheetId, {
        kind: "script",
        scriptId: viewId,
        name: changes.name,
      });
    }
    await writer.updateView(viewId, {
      ...changes,
      ...(source === undefined ? {} : { source }),
    });
  });
  return change;
}

export async function deleteView(ctx: RepositoryContext, viewId: string): Promise<Change> {
  const { change } = await ctx.changeView(viewId, async (view, tx, writer) => {
    writer.setLabel(`Delete ${view.kind} ${view.name}`);
    await ctx.keepVersion(tx, view.spreadsheetId, `Before deleting ${view.name}`);
    await writer.deleteView(viewId);
  });
  return change;
}
