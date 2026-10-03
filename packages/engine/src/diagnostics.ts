import { formatAddress, type CellId } from "./address";
import { parseScript } from "./script";
import type { TableDefinition } from "./structure";
import { renderTemplate } from "./template";
import { isChart, isError, isRange, type Evaluated } from "./values";
import type { ViewSource } from "./views";
import type { Workbook } from "./workbook";

export interface DocumentError {
  pageId: string;
  blockId: string;
  label: string;
  code: string;
  message: string;
  cell?: CellId;
  line?: number;
  name?: string;
  filter?: boolean;
}

/** Collect errors across the entire document, independent of the displayed page or rows. */
export function documentErrors(
  workbook: Workbook,
  tables: readonly TableDefinition[],
  views: readonly (ViewSource & { name: string })[],
): DocumentError[] {
  const errors: DocumentError[] = [];
  const blocks = new Map([...tables, ...views].map((block) => [block.id, block]));
  const scripts = new Map(
    views
      .filter((view) => view.kind === "script")
      .map((view) => [view.id, parseScript(view.source)]),
  );
  for (const failure of workbook.errors()) {
    const blockId = failure.kind === "cell" ? failure.cell.tableId : failure.holderId;
    const block = blocks.get(blockId);
    if (!block) continue;
    errors.push({
      pageId: block.pageId,
      blockId,
      code: failure.code,
      message: failure.message,
      label:
        failure.kind === "cell"
          ? `${block.name}!${formatAddress(failure.cell)}`
          : failure.kind === "name"
            ? `${block.name}!${failure.name}`
            : `${block.name} line ${String(failure.line)}`,
      ...(failure.kind === "name"
        ? {
            line: scripts
              .get(blockId)
              ?.find((statement) => statement.kind === "name" && statement.name === failure.name)
              ?.line,
          }
        : {}),
      ...(failure.kind === "cell"
        ? { cell: failure.cell }
        : failure.kind === "statement"
          ? { line: failure.line }
          : { name: failure.name }),
    });
  }
  for (const table of tables) {
    if (!table.filter) continue;
    const failure = workbook.filterRows(table.id, table.filter).error;
    if (failure)
      errors.push({
        pageId: table.pageId,
        blockId: table.id,
        label: `${table.name} filter`,
        code: failure.code,
        message: failure.message ?? failure.code,
        filter: true,
      });
  }
  for (const view of views) {
    const found = new Set<string>();
    const report = (code: string, message: string, line?: number, expression?: string): void => {
      const key = JSON.stringify([code, message, line, expression]);
      if (found.has(key)) return;
      found.add(key);
      errors.push({
        pageId: view.pageId,
        blockId: view.id,
        label:
          line !== undefined
            ? `${view.name} line ${String(line)}`
            : expression
              ? `${view.name}: ${expression}`
              : view.name,
        code,
        message,
        ...(line === undefined ? {} : { line }),
      });
    };
    const inspect = (value: Evaluated, expression?: string): void => {
      if (isError(value)) report(value.code, value.message ?? value.code, undefined, expression);
      else if (isRange(value) || isChart(value))
        for (const row of value.rows) for (const cell of row) inspect(cell, expression);
    };
    if (view.kind === "script") {
      for (const statement of scripts.get(view.id) ?? [])
        if (statement.kind === "error") report("#ERROR!", statement.message, statement.line);
    } else if (view.kind === "chart") {
      if (view.source.trim()) inspect(workbook.evaluateOnPage(view.pageId, view.source));
    } else {
      const parts = renderTemplate(
        view.source,
        (formula, names) => {
          const value = workbook.evaluateOnPage(view.pageId, formula, names);
          inspect(value, formula);
          return value;
        },
        (failure) => {
          report(failure.code, failure.message ?? failure.code);
        },
      );
      for (const part of parts) if (part.type === "error") report("#ERROR!", part.message);
    }
  }
  return errors;
}
