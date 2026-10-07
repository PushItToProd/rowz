import {
  formatAddress,
  renamedNames,
  scriptNames,
  viewSourceAfterRename,
} from "@spreadsheet-app/engine";
import {
  LIMITS,
  TableLayout,
  matchOffsets,
  type ReplaceBody,
  type SearchTarget,
  type SkippedReplacement,
} from "@spreadsheet-app/shared";
import { ApiFailure, conflict, notFound } from "../../errors";
import type { RepositoryContext } from "./context";
import { replacementParses, type ReplacementSyntax } from "./replacementSyntax";

/** Replaces literal text in stored inputs as one journaled content change. */
export async function replace(ctx: RepositoryContext, spreadsheetId: string, request: ReplaceBody) {
  await ctx.repository.findSpreadsheet(spreadsheetId, "write");
  if (!request.query) throw new ApiFailure(400, "empty_query", "Give a search query");
  const { change, result: skipped } = await ctx.change(spreadsheetId, async (tx, writer) => {
    const current = ctx.within(tx);
    const snapshot = await current.repository.getSnapshot(spreadsheetId);
    const scope = request.scope;
    const blocks = [...snapshot.tables, ...snapshot.views];
    if (scope.kind === "page" && !snapshot.pages.some((page) => page.id === scope.id))
      throw notFound("Page");
    if (scope.kind === "block" && !blocks.some((block) => block.id === scope.id))
      throw notFound("Block");
    const included = (block: { id: string; pageId: string }) =>
      scope.kind === "document" ||
      (scope.kind === "page" ? block.pageId === scope.id : block.id === scope.id);
    const foundOne = new Set<SearchTarget>();
    const skipped: SkippedReplacement[] = [];
    const edited = (
      text: string,
      target: SearchTarget,
      location: { pageId: string; label: string },
      syntax: ReplacementSyntax,
      limit: number = LIMITS.inputLength,
    ): string => {
      if (request.one && JSON.stringify(target) !== JSON.stringify(request.one.target)) return text;
      let offsets = matchOffsets(text, request.query, request);
      if (request.one) {
        if (text !== request.one.expected || !offsets.includes(request.one.offset))
          throw conflict("The match changed. Search again before replacing it");
        offsets = [request.one.offset];
        foundOne.add(target);
      }
      if (
        text.length + offsets.length * (request.replacement.length - request.query.length) >
        limit
      )
        throw new ApiFailure(400, "input_too_long", "Replacement exceeds the input length limit");
      const parts: string[] = [];
      let end = 0;
      for (const offset of offsets) {
        parts.push(text.slice(end, offset), request.replacement);
        end = offset + request.query.length;
      }
      parts.push(text.slice(end));
      const proposed = parts.join("");
      if (proposed !== text && !replacementParses(proposed, syntax)) {
        skipped.push({
          ...location,
          blockId: target.blockId,
          target,
          reason: "skipped: would not parse",
        });
        return text;
      }
      return proposed;
    };
    writer.setLabel(request.one ? "Replace match" : "Replace all");
    const cells = [];
    for (const table of snapshot.tables.filter(included)) {
      const layout = new TableLayout(
        snapshot.rows.filter((row) => row.tableId === table.id),
        table.colIds,
      );
      const location = (label: string) => ({
        pageId: table.pageId,
        label: `${snapshot.pages.find((page) => page.id === table.pageId)?.name ?? ""} > ${table.name} > ${label}`,
      });
      for (const cell of snapshot.cells.filter((cell) => cell.tableId === table.id)) {
        const col = table.colIds.indexOf(cell.colId);
        if (table.columns?.[col]?.type === "formula") continue;
        const position = layout.position(cell);
        if (!position) continue;
        const input = edited(
          cell.input,
          {
            kind: "cell",
            blockId: table.id,
            rowId: cell.rowId,
            colId: cell.colId,
          },
          location(formatAddress(position)),
          "cell",
        );
        if (input !== cell.input) cells.push({ ...cell, input });
      }
      const columns =
        table.columns?.map((column, col) => {
          const colId = table.colIds[col];
          return column.formula === undefined || colId === undefined
            ? column
            : {
                ...column,
                formula: edited(
                  column.formula,
                  { kind: "column", blockId: table.id, colId },
                  location(`${column.name} formula`),
                  "formula",
                ),
              };
        }) ?? null;
      const display =
        table.display.filter === undefined
          ? table.display
          : {
              ...table.display,
              filter: edited(
                table.display.filter,
                { kind: "filter", blockId: table.id },
                location("filter"),
                "formula",
              ),
            };
      const names = table.names.map((name) => ({
        ...name,
        formula: edited(
          name.formula,
          { kind: "name", blockId: table.id, name: name.name },
          location(`${name.name} formula`),
          "formula",
        ),
      }));
      if (
        JSON.stringify([columns, display, names]) !==
        JSON.stringify([table.columns, table.display, table.names])
      )
        await writer.updateTable(table.id, { columns, display, names });
    }
    await writer.setCells(cells);
    const scripts = [];
    for (const view of snapshot.views.filter(included)) {
      const source = edited(
        view.source,
        { kind: "source", blockId: view.id },
        {
          pageId: view.pageId,
          label: `${snapshot.pages.find((page) => page.id === view.pageId)?.name ?? ""} > ${view.name} > ${view.kind} source`,
        },
        view.kind,
        LIMITS.viewSourceLength,
      );
      if (source !== view.source) {
        if (view.kind === "script") scripts.push({ view, source });
        else await writer.updateView(view.id, { source });
      }
    }
    if (request.one && foundOne.size === 0)
      throw conflict("The match no longer exists in this scope");
    // Match replacements against one snapshot, then preserve the script editor's rename behavior.
    for (const script of scripts) {
      const { view } = script;
      const before = (await current.repository.getSnapshot(spreadsheetId)).views.find(
        (item) => item.id === view.id,
      );
      if (!before) throw notFound("Script");
      for (const rename of renamedNames(
        scriptNames(view.id, before.source),
        scriptNames(view.id, script.source),
      )) {
        const renameChange = { kind: "name" as const, holderId: view.id, ...rename };
        const contents = await current.rewriteFormulas(tx, writer, spreadsheetId, renameChange);
        for (const pending of scripts)
          pending.source = viewSourceAfterRename(
            contents.data,
            { ...pending.view, source: pending.source },
            renameChange,
          );
      }
      await writer.updateView(view.id, { source: script.source });
    }
    if (writer.recorded()?.data === null) {
      throw new ApiFailure(
        400,
        "replacement_too_large",
        "This replacement is too large to undo. Choose a smaller scope",
      );
    }
    return skipped;
  });
  return { ...change, skippedCount: skipped.length, skipped };
}
