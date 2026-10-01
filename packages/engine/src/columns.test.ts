import { describe, expect, it } from "vitest";
import { at } from "./testing";
import { formatReference } from "./ast";
import { columnFormulasAfterEdit, columnFormulasAfterRename } from "./columns";
import { parseFormula, parseFormulaWithReferences } from "./parser";
import { inputsAfterRename, rewriteReferences, translateInput } from "./rewrite";
import type { ColumnDefinition, WorkbookStructure } from "./structure";
import { FormulaSyntaxError } from "./tokenizer";
import { isButton, isControl } from "./values";
import { Workbook } from "./workbook";

const SALES: ColumnDefinition[] = [
  { name: "Item", type: "text" },
  { name: "Price", type: "number" },
  { name: "Qty", type: "any" },
  { name: "Total", type: "formula", formula: "=[Price] * [Qty]" },
];

function structure(columns: ColumnDefinition[] = SALES, rowCount = 3): WorkbookStructure {
  return {
    pages: [
      { id: "p1", name: "Page 1" },
      { id: "p2", name: "Other Page" },
    ],
    tables: [
      { id: "t1", pageId: "p1", name: "Sales", rowCount, colCount: columns.length, columns },
      { id: "t2", pageId: "p1", name: "Notes", rowCount: 10, colCount: 5 },
      { id: "t3", pageId: "p2", name: "Far", rowCount: 10, colCount: 5 },
    ],
  };
}

const CELLS = { A1: "pen", B1: "2", C1: "10", A2: "ink", B2: "5", C2: "3", A3: "cap", B3: "1" };

function workbook(
  cells: Record<string, Record<string, string>> = { t1: CELLS },
  shape: WorkbookStructure = structure(),
): Workbook {
  const result = new Workbook();
  result.setStructure(shape);
  for (const [tableId, inputs] of Object.entries(cells)) {
    for (const [address, input] of Object.entries(inputs))
      result.setCell(at(address, tableId), input);
  }
  return result;
}

describe("parsing column references", () => {
  it.each([
    ["[Price]", { column: "Price" }],
    ["[ Unit Price ]", { column: "Unit Price" }],
    ["Sales[Price]", { table: "Sales", column: "Price" }],
    ["'Table 1'[Column Name]", { table: "Table 1", column: "Column Name" }],
    ["Data!Sales[Price]", { page: "Data", table: "Sales", column: "Price" }],
    [
      "'My Page'!'Table 1'[Unit Price]",
      { page: "My Page", table: "Table 1", column: "Unit Price" },
    ],
  ])("reads %s", (text, reference) => {
    expect(parseFormula(text)).toEqual({ type: "reference", reference });
  });

  it("writes a reference back the way it is typed", () => {
    for (const text of [
      "[Price]",
      "Sales[Price]",
      "'Table 1'[Column Name]",
      "Data!Sales[Unit Price]",
    ]) {
      const { references } = parseFormulaWithReferences(text);
      expect(formatReference(references[0]!.reference)).toBe(text);
    }
  });

  it("reads references among operators and functions, and reports where each is written", () => {
    const { references } = parseFormulaWithReferences("SUM(Sales[Price]) + [Qty]*2");
    expect(references.map(({ from, to }) => [from, to])).toEqual([
      [4, 16],
      [20, 25],
    ]);
  });

  it("takes a name before a space and a bracket to be a name, not a table", () => {
    expect(() => parseFormula("Sales [Price]")).toThrow(FormulaSyntaxError);
  });

  it.each(["[Price", "[]", "[ ]", "[a[b]]", "Sales![Price]"])("refuses %s", (text) => {
    expect(() => parseFormula(text)).toThrow(FormulaSyntaxError);
  });
});

describe("reading named columns", () => {
  it("reads the cell of a column in the formula's own row", () => {
    const book = workbook({ t1: { ...CELLS, C3: "=[Price] + 100" } });
    expect(book.getValue(at("C3"))).toBe(101);
  });

  it("reads a whole column of another table by the table's name", () => {
    const book = workbook({
      t1: CELLS,
      t2: { A1: "=SUM(Sales[Price])", A2: "=COUNTA(sales[ item ])", A3: "='Page 1'!Sales[Price]" },
      t3: { A1: "=SUM('Page 1'!Sales[Price])", A2: "=SUM(Sales[Price])" },
    });
    expect(book.getValue(at("A1", "t2"))).toBe(8);
    expect(book.getValue(at("A2", "t2"))).toBe(3);
    expect(book.getArray(at("A3", "t2"))).toEqual([[2], [5], [1]]);
    expect(book.getValue(at("A1", "t3"))).toBe(8);
    expect(book.getValue(at("A2", "t3"))).toMatchObject({ code: "#REF!" });
  });

  it("means this row of a whole column when it is an operand, as A:A does", () => {
    const book = workbook({
      t1: CELLS,
      t2: { A2: "=Sales[Price] * 10", B2: "=SUM(Sales[Price] * 10)" },
    });
    expect(book.getValue(at("A2", "t2"))).toBe(50);
    expect(book.getValue(at("B2", "t2"))).toBe(50);
  });

  it("follows a change to a cell it reads", () => {
    const book = workbook({ t1: CELLS, t2: { A1: "=SUM(Sales[Price])" } });
    book.setCell(at("B2"), "50");
    expect(book.getValue(at("A1", "t2"))).toBe(53);
  });

  it.each([
    ["=[Missing]", "t1", "This table has no column named Missing"],
    ["=Sales[Missing]", "t2", "There is no table Sales with a column named Missing"],
    ["=Nowhere[Price]", "t2", "There is no table Nowhere with a column named Price"],
    ["=[Price]", "t2", "This table has no column named Price"],
    ["=Notes[Price]", "t1", "There is no table Notes with a column named Price"],
  ])("gives #REF! for %s", (formula, tableId, message) => {
    const book = workbook({
      t1: CELLS,
      [tableId]: { ...(tableId === "t1" ? CELLS : {}), C3: formula },
    });
    expect(book.getValue(at("C3", tableId))).toMatchObject({ code: "#REF!", message });
  });

  it("cannot name a column in a formula that is on a page and not in a table", () => {
    const book = workbook();
    expect(book.evaluateOnPage("p1", "SUM(Sales[Price])")).toBe(8);
    expect(book.evaluateOnPage("p1", "[Price]")).toMatchObject({ code: "#REF!" });
  });
});

describe("formula columns", () => {
  it("compute the column's formula in every row", () => {
    const book = workbook();
    expect(["D1", "D2", "D3"].map((address) => book.getValue(at(address)))).toEqual([20, 15, 0]);
    expect(book.getInput(at("D2"))).toBe("=[Price] * [Qty]");
    expect(book.columnOf(at("D2"))).toMatchObject({ name: "Total", type: "formula" });
    expect(book.columnOf(at("A1", "t2"))).toBeUndefined();
  });

  it("compute only in rows that hold something, so empty rows stay empty", () => {
    const book = workbook({
      t1: { A1: "pen", B1: "2", C1: "10" },
      t2: { A1: "=COUNTA(Sales[Total])" },
    });
    expect(book.getValue(at("D1"))).toBe(20);
    expect(book.getValue(at("D2"))).toBeNull();
    expect(book.getInput(at("D2"))).toBe("");
    expect(book.getValue(at("A1", "t2"))).toBe(1);

    // Typing into a row gives it its computed cells, and clearing the row takes them away.
    book.setCell(at("B2"), "3");
    expect(book.getValue(at("D2"))).toBe(0);
    expect(book.getValue(at("A1", "t2"))).toBe(2);
    book.setCell(at("C2"), "4");
    expect(book.getValue(at("D2"))).toBe(12);
    book.setCell(at("B2"), "");
    expect(book.getValue(at("D2"))).toBe(0);
    book.setCell(at("C2"), "");
    expect(book.getValue(at("D2"))).toBeNull();
    expect(book.getValue(at("A1", "t2"))).toBe(1);
  });

  it("follow the cells they read, and feed other formulas", () => {
    const book = workbook({ t1: CELLS, t2: { A1: "=SUM(Sales[Total])" } });
    expect(book.getValue(at("A1", "t2"))).toBe(35);
    book.setCell(at("C3"), "4");
    expect(book.getValue(at("D3"))).toBe(4);
    expect(book.getValue(at("A1", "t2"))).toBe(39);
  });

  it("ignore what is typed into their cells", () => {
    const book = workbook();
    book.setCell(at("D1"), "999");
    book.setCell(at("D2"), "");
    expect(book.getValue(at("D1"))).toBe(20);
    expect(book.getValue(at("D2"))).toBe(15);
  });

  it("cover new rows when the table grows, and change when the formula does", () => {
    const book = workbook();
    book.setStructure(structure(SALES, 4));
    book.setCell(at("B4"), "7");
    book.setCell(at("C4"), "2");
    expect(book.getValue(at("D4"))).toBe(14);

    const changed = SALES.with(3, { name: "Total", type: "formula", formula: "=[Price] + 1" });
    book.setStructure(structure(changed, 4));
    expect(book.getValue(at("D4"))).toBe(8);
    expect(book.getValue(at("D1"))).toBe(3);
  });

  it("stop computing when the column stops being a formula column", () => {
    const book = workbook();
    book.setStructure(structure(SALES.with(3, { name: "Total", type: "number" })));
    expect(book.getValue(at("D1"))).toBeNull();
    expect(book.getInput(at("D1"))).toBe("");
    book.setCell(at("D1"), "5");
    expect(book.getValue(at("D1"))).toBe(5);
  });

  it("can read ordinary cell addresses and other tables", () => {
    const columns = SALES.with(3, {
      name: "Total",
      type: "formula",
      formula: "=[Price] * Notes!$A$1 + B1",
    });
    const book = workbook({ t1: CELLS, t2: { A1: "10" } }, structure(columns));
    expect(book.getValue(at("D2"))).toBe(52);
  });

  it("show the error of a formula that does not parse or cannot be computed", () => {
    const broken = workbook(
      undefined,
      structure(SALES.with(3, { name: "Total", type: "formula", formula: "=[Price] *" })),
    );
    expect(broken.getValue(at("D1"))).toMatchObject({ code: "#ERROR!" });
    const cyclic = workbook(
      undefined,
      structure(SALES.with(3, { name: "Total", type: "formula", formula: "=[Total] + 1" })),
    );
    expect(cyclic.getValue(at("D1"))).toMatchObject({ code: "#CYCLE!" });
  });

  it("can hold a control bound to a cell of the same row", () => {
    const columns: ColumnDefinition[] = [
      { name: "Done", type: "checkbox" },
      { name: "Tick", type: "formula", formula: '=CHECKBOX([Done], "done")' },
      { name: "Go", type: "formula", formula: '=BUTTON("Finish", EXECUTE(TRUE, [Done]))' },
    ];
    const book = workbook({ t1: { A2: "TRUE" } }, structure(columns));
    const tick = book.getValue(at("B2"));
    expect(isControl(tick) && tick.target).toEqual(at("A2"));
    expect(isControl(tick) && tick.value).toBe(true);
    const go = book.getValue(at("C2"));
    expect(isButton(go) && book.planAction(go.action)).toEqual({
      ok: true,
      effects: [{ type: "setCell", tableId: "t1", row: 1, col: 0, input: "TRUE" }],
    });
    // A row with nothing typed into it has no button.
    expect(book.getValue(at("C1"))).toBeNull();
  });

  it("are skipped by actions that look for typed cells, and refuse to be written to", () => {
    const book = workbook({
      t1: CELLS,
      t2: {
        A1: '=BUTTON("Add", APPEND_ROW(Sales!A:C, "nib", 4, 2))',
        A2: '=BUTTON("Clear", CLEAR(Sales!A1:D1))',
        A3: '=BUTTON("Bad", EXECUTE(1, Sales!D1))',
      },
    });
    const plan = (address: string) => {
      const value = book.getValue(at(address, "t2"));
      return isButton(value) ? book.planAction(value.action) : undefined;
    };
    expect(plan("A1")).toMatchObject({
      ok: true,
      effects: [
        { type: "ensureRows", tableId: "t1", rowCount: 4 },
        { type: "setCell", row: 3, col: 0, input: "nib" },
        { type: "setCell", row: 3, col: 1, input: "4" },
        { type: "setCell", row: 3, col: 2, input: "2" },
      ],
    });
    expect(plan("A2")).toMatchObject({
      ok: true,
      effects: [
        { type: "setCell", row: 0, col: 0, input: "" },
        { type: "setCell", row: 0, col: 1, input: "" },
        { type: "setCell", row: 0, col: 2, input: "" },
      ],
    });
    expect(plan("A3")).toMatchObject({
      ok: false,
      error: { code: "#VALUE!", message: "Total is a formula column and cannot be written to" },
    });
  });
});

describe("typed columns", () => {
  const TYPED: ColumnDefinition[] = [
    { name: "Text", type: "text" },
    { name: "Number", type: "number" },
    { name: "Date", type: "date" },
    { name: "Check", type: "checkbox" },
    { name: "Any", type: "any" },
  ];
  const typed = (cells: Record<string, string>): Workbook =>
    workbook({ t1: cells }, structure(TYPED));

  it("keep text as typed, even when it reads as a number, a date, or a formula", () => {
    const book = typed({ A1: "007", A2: "2026-01-01", A3: "=1+1", A4: "TRUE", A5: "'quoted" });
    expect(["A1", "A2", "A3", "A4", "A5"].map((address) => book.getValue(at(address)))).toEqual([
      "007",
      "2026-01-01",
      "=1+1",
      "TRUE",
      "quoted",
    ]);
  });

  it("read numbers, dates, and TRUE or FALSE in their columns", () => {
    const book = typed({ B1: " 12.5 ", C1: "2026-03-04", D1: "true", D2: "FALSE" });
    expect(book.getValue(at("B1"))).toBe(12.5);
    expect(book.getValue(at("C1"))).toMatchObject({ kind: "date" });
    expect(book.getValue(at("D1"))).toBe(true);
    expect(book.getValue(at("D2"))).toBe(false);
    expect(book.getValue(at("D3"))).toBeNull();
  });

  it.each([
    ["B1", "twelve", "twelve is not a number"],
    ["B1", "=1+1", "=1+1 is not a number"],
    ["C1", "tomorrow", "tomorrow is not a date"],
    ["C1", "5", "5 is not a date"],
    ["D1", "yes", "yes is not TRUE or FALSE"],
  ])("show an error in %s for %s", (address, input, message) => {
    expect(typed({ [address]: input }).getValue(at(address))).toMatchObject({
      code: "#VALUE!",
      message,
    });
  });

  it("read a column of any type as an ordinary cell, formulas included", () => {
    const book = typed({ B1: "4", E1: "=[Number] * 2", E2: "text", E3: "7" });
    expect(book.getValue(at("E1"))).toBe(8);
    expect(book.getValue(at("E2"))).toBe("text");
    expect(book.getValue(at("E3"))).toBe(7);
  });

  it("read cells again when a column's type changes", () => {
    const book = typed({ A1: "007", B1: "12" });
    const swapped: ColumnDefinition[] = [
      { name: "Text", type: "number" },
      { name: "Number", type: "text" },
      ...TYPED.slice(2),
    ];
    book.setStructure(structure(swapped));
    expect(book.getValue(at("A1"))).toBe(7);
    expect(book.getValue(at("B1"))).toBe("12");

    // Without named columns the table is a plain grid again.
    book.setStructure({
      ...structure(),
      tables: structure().tables.map(({ columns: _, ...table }) => table),
    });
    expect(book.getValue(at("B1"))).toBe(12);
  });
});

describe("rewriting column references", () => {
  const data = (cells: { tableId: string; address: string; input: string }[]) => ({
    ...structure(),
    cells: cells.map(({ tableId, address, input }) => ({ ...at(address, tableId), input })),
  });

  it("writes a column's new name wherever the column is named", () => {
    const rewritten = inputsAfterRename(
      data([
        { tableId: "t1", address: "C1", input: "=[price] * 2" },
        { tableId: "t1", address: "C2", input: "=[Qty] + Sales[ Price ]" },
        { tableId: "t2", address: "A1", input: "=SUM(Sales[Price], 'Page 1'!Sales[Price])" },
        { tableId: "t2", address: "A2", input: "=[Price] + Other[Price]" },
        { tableId: "t3", address: "A1", input: "=SUM(Sales[Price])" },
      ]),
      { kind: "column", tableId: "t1", from: "Price", name: "Unit Price" },
    );
    expect(rewritten.map((cell) => cell.input)).toEqual([
      "=[Unit Price] * 2",
      "=[Qty] + Sales[Unit Price]",
      "=SUM(Sales[Unit Price], 'Page 1'!Sales[Unit Price])",
    ]);
  });

  it("writes a table's or page's new name into column references", () => {
    const cells = data([
      { tableId: "t2", address: "A1", input: "=SUM(Sales[Price]) + 'Page 1'!Sales[Qty]" },
    ]);
    expect(
      inputsAfterRename(cells, { kind: "table", tableId: "t1", name: "All Sales" })[0]?.input,
    ).toBe("=SUM('All Sales'[Price]) + 'Page 1'!'All Sales'[Qty]");
    expect(inputsAfterRename(cells, { kind: "page", pageId: "p1", name: "Data" })[0]?.input).toBe(
      "=SUM(Sales[Price]) + Data!Sales[Qty]",
    );
  });

  it("leaves column references alone when a formula is filled or a row is inserted", () => {
    expect(translateInput("=[Price] * A1 + Sales[Qty]", 2, 1)).toBe("=[Price] * B3 + Sales[Qty]");
    expect(rewriteReferences("=[Price]", () => undefined)).toBe("=[Price]");
  });

  it("rewrites the formulas of formula columns as it rewrites cells", () => {
    const columns: ColumnDefinition[] = [
      ...SALES.slice(0, 3),
      { name: "Total", type: "formula", formula: "=[Price] * [Qty] + Notes!A2 + B1" },
    ];
    const shape = structure(columns);
    expect(
      columnFormulasAfterRename(shape, {
        kind: "column",
        tableId: "t1",
        from: "qty",
        name: "Count",
      }),
    ).toEqual([{ tableId: "t1", col: 3, formula: "=[Price] * [Count] + Notes!A2 + B1" }]);
    expect(
      columnFormulasAfterRename(shape, { kind: "table", tableId: "t2", name: "Memo" }),
    ).toEqual([{ tableId: "t1", col: 3, formula: "=[Price] * [Qty] + Memo!A2 + B1" }]);
    expect(columnFormulasAfterRename(shape, { kind: "table", tableId: "t3", name: "X" })).toEqual(
      [],
    );
    expect(
      columnFormulasAfterEdit(shape, { tableId: "t2", axis: "row", kind: "insert", index: 0 }),
    ).toEqual([{ tableId: "t1", col: 3, formula: "=[Price] * [Qty] + Notes!A3 + B1" }]);
    expect(
      columnFormulasAfterEdit(shape, { tableId: "t1", axis: "col", kind: "delete", index: 1 }),
    ).toEqual([{ tableId: "t1", col: 3, formula: "=[Price] * [Qty] + Notes!A2 + #REF!" }]);
  });
});
