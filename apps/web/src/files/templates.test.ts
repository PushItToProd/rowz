import {
  createWorkbook,
  documentErrors,
  isButton,
  type NameDefinition,
  type ScriptDefinition,
  type TableDefinition,
  type ViewSource,
} from "@spreadsheet-app/engine";
import type { SpreadsheetFile } from "@spreadsheet-app/shared";
import { describe, expect, it } from "vitest";
import { readSpreadsheetFile } from "./spreadsheetFile";
import { DOCUMENT_TEMPLATES } from "./templates";

function load(file: SpreadsheetFile): {
  workbook: ReturnType<typeof createWorkbook>;
  tables: TableDefinition[];
  views: (ViewSource & { name: string })[];
} {
  const pages = file.pages.map((page, index) => ({ id: `p${String(index)}`, name: page.name }));
  const tables: TableDefinition[] = [];
  const scripts: ScriptDefinition[] = [];
  const names: NameDefinition[] = [];
  const cells: { tableId: string; row: number; col: number; input: string }[] = [];
  const views: (ViewSource & { name: string })[] = [];

  file.pages.forEach((page, pageIndex) => {
    const pageId = `p${String(pageIndex)}`;
    page.blocks.forEach((block, blockIndex) => {
      const id = `b${String(pageIndex)}-${String(blockIndex)}`;
      if (block.type === "table") {
        tables.push({
          id,
          pageId,
          name: block.name,
          rowCount: block.rowCount,
          colCount: block.colCount,
          ...(block.columns
            ? {
                columns: block.columns.map(({ name, type, formula }) => ({
                  name,
                  type,
                  ...(formula === undefined ? {} : { formula }),
                })),
              }
            : {}),
          ...(block.display?.filter === undefined ? {} : { filter: block.display.filter }),
        });
        names.push(...(block.names ?? []).map((name) => ({ holderId: id, ...name })));
        cells.push(...block.cells.map((cell) => ({ tableId: id, ...cell })));
        return;
      }

      views.push({ id, pageId, name: block.name, kind: block.type, source: block.source });
      if (block.type === "script")
        scripts.push({ id, pageId, name: block.name, source: block.source });
    });
  });

  return { workbook: createWorkbook({ pages, tables, scripts, names, cells }), tables, views };
}

describe("document templates", () => {
  for (const template of DOCUMENT_TEMPLATES) {
    it(`imports and recalculates ${template.name} without errors`, () => {
      const file = readSpreadsheetFile(JSON.stringify(template.document));
      const { workbook, tables, views } = load(file);

      workbook.recalculateVolatile();
      for (const table of tables) {
        for (let row = 0; row < (table.rowCount ?? 0); row += 1) {
          for (let col = 0; col < (table.colCount ?? 0); col += 1) {
            workbook.getValue({ tableId: table.id, row, col });
          }
        }
      }

      expect(documentErrors(workbook, tables, views)).toEqual([]);
    });
  }

  it("plans the inventory form's append-row action when complete", () => {
    const inventory = DOCUMENT_TEMPLATES.find(({ name }) => name === "Inventory");
    if (!inventory) throw new Error("The Inventory template is missing");
    const file = readSpreadsheetFile(JSON.stringify(inventory.document));
    const { workbook, tables, views } = load(file);
    const form = tables.find(({ name }) => name === "Movement form");
    const movements = tables.find(({ name }) => name === "Movements");
    if (!form || !movements) throw new Error("The Inventory tables are missing");

    workbook.setCell({ tableId: form.id, row: 0, col: 2 }, "2026-10-06");
    workbook.setCell({ tableId: form.id, row: 1, col: 2 }, "Arabica beans");
    workbook.setCell({ tableId: form.id, row: 2, col: 2 }, "Cycle count");
    workbook.setCell({ tableId: form.id, row: 3, col: 2 }, "5");
    workbook.recalculateVolatile();

    const button = workbook.getValue({ tableId: form.id, row: 4, col: 1 });
    expect(isButton(button)).toBe(true);
    if (!isButton(button)) throw new Error("The completed form did not show its button");
    const plan = workbook.planAction(button.action);
    expect(plan.ok).toBe(true);
    if (!plan.ok) throw new Error(`${plan.error.code}: ${plan.error.message ?? ""}`);

    expect(plan.effects).toContainEqual({
      type: "ensureRows",
      tableId: movements.id,
      rowCount: 5,
    });
    expect(plan.effects).toContainEqual({
      type: "setCell",
      tableId: movements.id,
      row: 4,
      col: 1,
      input: "Arabica beans",
    });
    expect(documentErrors(workbook, tables, views)).toEqual([]);
  });
});
