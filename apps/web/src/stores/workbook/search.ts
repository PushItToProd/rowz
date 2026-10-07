import { formatAddress, formatValue, type CellId, type CellFormat } from "@spreadsheet-app/engine";
import {
  createLiteralMatcher,
  type ReplaceReport,
  type ReplaceBody,
  type SearchOptions,
  type SearchScope,
  type SearchTarget,
} from "@spreadsheet-app/shared";
import { api } from "../../api/client";
import { formattedText } from "../../formatStyle";
import { computed } from "vue";
import type { WorkbookContext } from "./context";

export interface SearchMatch {
  pageId: string;
  blockId: string;
  label: string;
  text: string;
  offset: number;
  target: SearchTarget;
  cell?: CellId;
  replaceable: boolean;
}
export const MAX_SEARCH_MATCHES = 1000;
export interface SearchResults {
  matches: SearchMatch[];
  total: number;
}
export function createSearch(context: WorkbookContext, formatOf: (cell: CellId) => CellFormat) {
  // Stored-input search visits populated cells, including pending edits, instead of empty grid slots.
  const inputPositions = computed(() => {
    const engine = context.engine.value;
    const inputs = new Map(context.inputs);
    for (const pending of context.unsavedChanges) {
      for (const cell of pending.changes) {
        const input = { tableId: pending.tableId, ...cell };
        inputs.set(context.cellIdentityKey(input), input);
      }
    }
    const positions = new Map<string, CellId[]>();
    for (const input of inputs.values()) {
      if (!input.input) continue;
      const position = context.positionOf(input);
      if (!position || engine.columnOf(position)?.type === "formula") continue;
      const cells = positions.get(input.tableId) ?? [];
      cells.push(position);
      positions.set(input.tableId, cells);
    }
    for (const cells of positions.values()) cells.sort((a, b) => a.row - b.row || a.col - b.col);
    return positions;
  });
  function find(
    query: string,
    scope: SearchScope,
    options: SearchOptions,
    mode: "inputs" | "values",
  ): SearchResults {
    if (!query) return { matches: [], total: 0 };
    const results: SearchMatch[] = [];
    let total = 0;
    const offsets = createLiteralMatcher(query, options);
    const blocks = [...context.tables.value, ...context.views.value];
    for (const page of context.pages.value) {
      if (scope.kind === "page" && page.id !== scope.id) continue;
      for (const block of blocks
        .filter((block) => block.pageId === page.id)
        .sort((a, b) => a.position - b.position)) {
        if (scope.kind === "block" && block.id !== scope.id) continue;
        const add = (
          text: string,
          target: SearchTarget,
          location: string,
          cell?: CellId,
          replaceable = true,
        ) => {
          for (const offset of offsets(text)) {
            total += 1;
            if (results.length >= MAX_SEARCH_MATCHES) continue;
            results.push({
              pageId: page.id,
              blockId: block.id,
              label: `${page.name} > ${block.name} > ${location}`,
              text,
              offset,
              target,
              ...(cell ? { cell } : {}),
              replaceable,
            });
          }
        };
        if ("source" in block) {
          add(block.source, { kind: "source", blockId: block.id }, `${block.kind} source`);
          continue;
        }
        const layout = context.layouts.value.get(block.id);
        if (!layout) continue;
        const { rowCount, colCount } = block;
        function* cells(): Generator<CellId> {
          if (mode === "inputs") yield* inputPositions.value.get(block.id) ?? [];
          else {
            for (let row = 0; row < rowCount; row++) {
              for (let col = 0; col < colCount; col++) yield { tableId: block.id, row, col };
            }
          }
        }
        for (const cell of cells()) {
          const { col } = cell;
          const formulaColumn = block.columns?.[col]?.type === "formula";
          if (mode === "inputs" && formulaColumn) continue;
          let text = context.inputOf(cell);
          if (mode === "values") {
            const value = context.engine.value.getValue(cell);
            text = formattedText(value, formatOf(cell)) ?? formatValue(value);
          }
          const identity = layout.identity(cell);
          if (!identity) continue;
          add(
            text,
            { kind: "cell", blockId: block.id, ...identity },
            formatAddress(cell),
            cell,
            mode === "inputs" && !formulaColumn,
          );
        }
        for (const [col, column] of (block.columns ?? []).entries()) {
          const colId = block.colIds[col];
          if (column.formula !== undefined && colId)
            add(
              column.formula,
              { kind: "column", blockId: block.id, colId },
              `${column.name} formula`,
            );
        }
        if (block.display.filter !== undefined)
          add(block.display.filter, { kind: "filter", blockId: block.id }, "filter");
        for (const name of block.names)
          add(
            name.formula,
            { kind: "name", blockId: block.id, name: name.name },
            `${name.name} formula`,
          );
      }
    }
    return { matches: results, total };
  }
  async function replace(request: ReplaceBody): Promise<ReplaceReport | undefined> {
    const spreadsheet = context.spreadsheet.value;
    if (!spreadsheet || !context.canEdit.value) return undefined;
    const failedBefore = context.failedSaves;
    let report: ReplaceReport | undefined;
    await context.attempt(async () => {
      if (context.failedSaves !== failedBefore)
        throw new Error("Save pending edits before replacing");
      const change = await api.replace(spreadsheet.id, request);
      if (context.spreadsheet.value?.id === spreadsheet.id) {
        await context.receiveChange(change);
        report = { skippedCount: change.skippedCount, skipped: change.skipped };
      }
    }, "Could not replace matches");
    return report;
  }
  return { find, replace };
}
