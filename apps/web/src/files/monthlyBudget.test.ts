import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  createWorkbook,
  isError,
  type NameDefinition,
  type ScriptDefinition,
  type TableDefinition,
} from "@spreadsheet-app/engine";
import { describe, expect, it } from "vitest";
import { readSpreadsheetFile } from "./spreadsheetFile";

describe("monthly budget reference file", () => {
  it("imports and computes its script totals and named-column reports", () => {
    const file = readSpreadsheetFile(
      readFileSync(resolve(process.cwd(), "docs/reference/monthly-budget.json"), "utf8"),
    );
    const pages = file.pages.map((page, index) => ({ id: `p${String(index)}`, name: page.name }));
    const tables: TableDefinition[] = [];
    const scripts: ScriptDefinition[] = [];
    const names: NameDefinition[] = [];
    const cells: { tableId: string; row: number; col: number; input: string }[] = [];
    let reportsPageId = "";
    let summaryId = "";

    file.pages.forEach((page, pageIndex) => {
      const pageId = `p${String(pageIndex)}`;
      if (page.name === "Reports") reportsPageId = pageId;
      page.blocks.forEach((block, blockIndex) => {
        if (block.type === "table") {
          const id = `t${String(pageIndex)}-${String(blockIndex)}`;
          tables.push({
            id,
            pageId,
            name: block.name,
            rowCount: block.rowCount,
            colCount: block.colCount,
            // The engine reads a dropdown column's cells as it reads any cell, so its choices are left out.
            ...(block.columns
              ? {
                  columns: block.columns.map(({ name, type, formula }) => ({
                    name,
                    type,
                    ...(formula === undefined ? {} : { formula }),
                  })),
                }
              : {}),
          });
          names.push(...(block.names ?? []).map((name) => ({ holderId: id, ...name })));
          cells.push(...block.cells.map((cell) => ({ tableId: id, ...cell })));
        } else if (block.type === "script") {
          const id = `v${String(pageIndex)}-${String(blockIndex)}`;
          scripts.push({ id, pageId, name: block.name, source: block.source });
          if (block.name === "Summary") summaryId = id;
        }
      });
    });

    const workbook = createWorkbook({ pages, tables, scripts, names, cells });
    expect(workbook.getName(summaryId, "Income")).toBe(4204);
    expect(workbook.getName(summaryId, "Expenses")).toBe(1995);
    expect(workbook.getName(summaryId, "Net")).toBe(2209);
    expect(workbook.failedAssertions()).toEqual([]);

    const report = workbook.evaluateOnPage(
      reportsPageId,
      "QUERY(Transactions, \"select Category, sum(Amount) where Type = 'Expense' and `Date` >= date '2026-10-01' and `Date` <= date '2026-10-31' group by Category order by sum(Amount) desc\")",
    );
    if (isError(report)) throw new Error(`${report.code}: ${report.message ?? ""}`);
    expect(report).toMatchObject({
      kind: "range",
      rows: [
        ["Category", "sum Amount"],
        ["Housing", 1600],
        ["Groceries", 175],
        ["Utilities", 140],
        ["Transportation", 65],
        ["Subscriptions", 15],
      ],
    });
  });
});
