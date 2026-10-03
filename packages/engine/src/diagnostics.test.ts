import { describe, expect, it } from "vitest";
import { documentErrors } from "./diagnostics";
import { createWorkbook } from "./workbook";
import type { WorkbookData } from "./structure";
import type { ViewSource } from "./views";

const data: WorkbookData = {
  pages: [
    { id: "p1", name: "Main" },
    { id: "p2", name: "Other" },
  ],
  tables: [
    {
      id: "t",
      pageId: "p2",
      name: "Data",
      rowCount: 2,
      colCount: 2,
      columns: [
        { name: "Input", type: "any" },
        { name: "Computed", type: "formula", formula: "=1/0" },
      ],
      filter: "=FALSE",
    },
  ],
  scripts: [
    { id: "s", pageId: "p1", name: "Logic", source: "Broken = Missing\n1/0\nASSERT(FALSE)" },
  ],
  cells: [{ tableId: "t", row: 0, col: 0, input: "=1/0" }],
};
const script = { ...data.scripts![0]!, kind: "script" as const };
const view = (id: string, kind: ViewSource["kind"], source: string) => ({
  id,
  name: id,
  pageId: "p1",
  kind,
  source,
});

describe("document errors", () => {
  it("includes hidden cells, formula columns, names, statements, and assertions across pages", () => {
    const workbook = createWorkbook(data);
    const errors = documentErrors(workbook, data.tables, [script]);
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pageId: "p2", label: "Data!A1", code: "#DIV/0!" }),
        expect.objectContaining({ label: "Data!B1", code: "#DIV/0!" }),
        expect.objectContaining({ label: "Data!B2", code: "#DIV/0!" }),
        expect.objectContaining({ label: "Logic!Broken", code: "#NAME?", line: 1 }),
        expect.objectContaining({ label: "Logic line 2", code: "#DIV/0!" }),
        expect.objectContaining({ label: "Logic line 3", code: "#ASSERT!" }),
      ]),
    );
    expect(errors).toHaveLength(6);
    expect(workbook.failedAssertions()).toHaveLength(1);
  });

  it("finds chart, template expression, template syntax, and condition errors", () => {
    const workbook = createWorkbook(data);
    const views = [
      view("Chart", "chart", "Missing"),
      view("Text", "text", "{{ 1/0 }} {{ Missing }}"),
      view("Condition", "text", "{% if SEQUENCE(2) %}yes{% end %}"),
      view("Syntax", "text", "{% if %}"),
      view("Unused", "text", "{% let x = Missing %}"),
      view("Caught", "text", "{{ IFERROR(1/0, 0) }}"),
      view("Empty", "chart", ""),
    ];
    const errors = documentErrors(workbook, [], views);
    expect(errors.map((failure) => failure.blockId)).toEqual([
      "Chart",
      "Text",
      "Text",
      "Condition",
      "Syntax",
      "Unused",
    ]);
  });

  it("finds filter syntax errors even in an empty table", () => {
    const tables = [{ ...data.tables[0]!, rowCount: 0, filter: "=1+" }];
    const errors = documentErrors(createWorkbook({ ...data, tables, cells: [] }), tables, []);
    expect(errors).toEqual([expect.objectContaining({ label: "Data filter", filter: true })]);
  });

  it("reports errors in spilled cells even when the formula's own cell succeeds", () => {
    const tables = [{ ...data.tables[0]!, columns: null }];
    const workbook = createWorkbook({
      ...data,
      tables,
      scripts: [],
      cells: [{ tableId: "t", row: 0, col: 0, input: "=MAP(SEQUENCE(2), LAMBDA(x, 1/(2-x)))" }],
    });
    expect(workbook.getValue({ tableId: "t", row: 0, col: 0 })).toBe(1);
    expect(documentErrors(workbook, tables, [])).toEqual([
      expect.objectContaining({ label: "Data!A2", code: "#DIV/0!" }),
    ]);
  });

  it("removes cell errors after correction and does not execute actions", () => {
    const workbook = createWorkbook({
      ...data,
      tables: [{ ...data.tables[0]!, columns: null }],
      scripts: [],
    });
    workbook.setCell({ tableId: "t", row: 0, col: 0 }, "=IFERROR(1/0, 5)");
    workbook.setCell({ tableId: "t", row: 1, col: 0 }, '=BUTTON("Run", CLEAR(A1))');
    expect(
      documentErrors(
        workbook,
        data.tables.map((table) => ({ ...table, columns: null })),
        [],
      ),
    ).toEqual([]);
    expect(workbook.getValue({ tableId: "t", row: 0, col: 0 })).toBe(5);
  });
});
