import { describe, expect, it } from "vitest";
import { printNode } from "./ast";
import { defaultFunctions } from "./functions";
import { refusedName } from "./names";
import { parseFormula } from "./parser";
import { namesOf } from "./scope";
import type { NameDefinition, WorkbookStructure } from "./structure";
import { at, STRUCTURE } from "./testing";
import { isButton, isError, isRange, type Evaluated } from "./values";
import { Workbook, type ActionPlan } from "./workbook";

/** The test structure with a script on each page. */
const WITH_SCRIPTS: WorkbookStructure = {
  ...STRUCTURE,
  scripts: [
    { id: "s1", pageId: "p1", name: "Summary", source: "" },
    { id: "s2", pageId: "p2", name: "Rates", source: "" },
  ],
};

function workbookWith(
  names: NameDefinition[],
  cells: Record<string, Record<string, string>> = {},
  structure: WorkbookStructure = WITH_SCRIPTS,
): Workbook {
  const workbook = new Workbook();
  workbook.setStructure({ ...structure, names });
  for (const [tableId, inputs] of Object.entries(cells)) {
    for (const [address, input] of Object.entries(inputs)) {
      workbook.setCell(at(address, tableId), input);
    }
  }
  return workbook;
}

function name(holderId: string, name: string, formula: string): NameDefinition {
  return { holderId, name, formula };
}

function messageOf(value: Evaluated | undefined): string | undefined {
  return isError(value) ? value.message : undefined;
}

function scriptWorkbook(
  source: string,
  cells: Record<string, Record<string, string>> = {},
): Workbook {
  const workbook = new Workbook();
  workbook.setStructure({
    ...WITH_SCRIPTS,
    tables: STRUCTURE.tables.map((table) =>
      table.id === "t1"
        ? {
            ...table,
            rowCount: 1,
            colCount: 1,
            columns: [{ name: "Race", type: "text" }],
          }
        : table,
    ),
    scripts: [
      { id: "s1", pageId: "p1", name: "Script 1", source },
      { id: "s2", pageId: "p2", name: "Rates", source: "" },
    ],
  });
  for (const [tableId, inputs] of Object.entries(cells)) {
    for (const [address, input] of Object.entries(inputs)) {
      workbook.setCell(at(address, tableId), input);
    }
  }
  return workbook;
}

describe("parsing names", () => {
  it("reads a word after ! that is not a cell as a qualified name", () => {
    expect(parseFormula("Summary!Total")).toEqual({
      type: "qualified",
      holder: "Summary",
      name: "Total",
    });
    expect(parseFormula("'Page 1'!Summary!'my total'")).toEqual({
      type: "qualified",
      page: "Page 1",
      holder: "Summary",
      name: "my total",
    });
  });

  it("reads a word that could be a column as a name unless a colon follows", () => {
    expect(parseFormula("Summary!Tax")).toMatchObject({ type: "qualified", name: "Tax" });
    expect(parseFormula("Summary!A:B")).toMatchObject({ type: "reference" });
    expect(parseFormula("Summary!A1")).toMatchObject({ type: "reference" });
  });

  it("reads a quoted name alone as a name", () => {
    expect(parseFormula("'Table 1'")).toEqual({ type: "name", name: "Table 1" });
  });

  it("calls a qualified name", () => {
    expect(parseFormula("Summary!WithTax(1)")).toMatchObject({
      type: "apply",
      target: { type: "qualified", holder: "Summary", name: "WithTax" },
    });
  });

  it.each(["Summary!Total", "'Page 1'!Summary!'my total'", "'Table 1'+1"])(
    "prints %s so that it parses to the same tree",
    (text) => {
      const ast = parseFormula(text);
      expect(parseFormula(printNode(ast))).toEqual(ast);
    },
  );
});

describe("namesOf", () => {
  const uses = (text: string): unknown[] => namesOf(parseFormula(text), defaultFunctions);

  it("lists bare words, called names, and qualified names", () => {
    expect(uses("Total + WithTax(1) + Summary!Rate")).toEqual([
      { name: "Total" },
      { name: "WITHTAX" },
      { type: "qualified", holder: "Summary", name: "Rate" },
    ]);
  });

  it("leaves out built-in functions and words that LET and LAMBDA bound", () => {
    expect(uses("SUM(LET(x, Rate, y, x + 1, x + y + Other))")).toEqual([
      { name: "Rate" },
      { name: "Other" },
    ]);
    expect(uses("LAMBDA(x, x + Rate)(Total)")).toEqual([{ name: "Rate" }, { name: "Total" }]);
  });

  it("lists a word used in a LET value before the LET binds it", () => {
    expect(uses("LET(x, x + 1, x)")).toEqual([{ name: "x" }]);
  });

  it("leaves out the arguments of an action", () => {
    expect(uses('BUTTON("Go", EXECUTE(Rate, A1))')).toEqual([]);
  });
});

describe("refusedName", () => {
  it.each(["AB12", "true", "sum"])("refuses %s", (word) => {
    expect(refusedName(word, defaultFunctions)).toBeDefined();
  });
  it.each(["Total", "tax_rate", "my total", "ABCD1"])("accepts %s", (word) => {
    expect(refusedName(word, defaultFunctions)).toBeUndefined();
  });
});

describe("names in a workbook", () => {
  it("traces a built-in failure to its script function and calling cell", () => {
    const workbook = scriptWorkbook('Broken() = QUERY(Table1, "select Spa")', {
      t1: { A1: "Spa", B1: "=Broken()" },
    });

    expect(workbook.getValue(at("B1"))).toMatchObject({
      kind: "error",
      trace: [
        {
          function: "Broken",
          location: { scriptId: "s1", scriptName: "Script 1", line: 1, name: "Broken" },
          callSite: { kind: "cell", cell: at("B1") },
        },
      ],
    });
  });

  it("traces an error value returned by a lazy built-in inside a script function", () => {
    const workbook = scriptWorkbook("Broken() = IF(TRUE, 1 / 0, 1)", {
      t1: { B1: "=Broken()" },
    });

    expect(workbook.getValue(at("B1"))).toMatchObject({
      kind: "error",
      code: "#DIV/0!",
      trace: [
        {
          function: "Broken",
          location: { scriptId: "s1", scriptName: "Script 1", line: 1, name: "Broken" },
        },
      ],
    });
  });

  it("does not reattribute an unchanged cell error read by a script function", () => {
    const workbook = scriptWorkbook("Forward() = 'Other Table'!A1", {
      t2: { A1: "=1/0", B1: "=Forward()" },
    });

    expect(workbook.getValue(at("B1", "t2"))).toMatchObject({
      kind: "error",
      code: "#DIV/0!",
    });
    expect(workbook.getValue(at("B1", "t2"))).not.toHaveProperty("trace");
  });

  it("traces the innermost failing function and keeps its nested call chain", () => {
    const workbook = scriptWorkbook(
      'Broken() = QUERY(Table1, "select Spa")\nPayoutByDuration() = Broken()',
      { t1: { A1: "Spa", B1: "=PayoutByDuration()" } },
    );

    expect(workbook.getValue(at("B1"))).toMatchObject({
      kind: "error",
      trace: [
        {
          function: "Broken",
          location: { scriptId: "s1", line: 1, name: "Broken" },
          callSite: {
            kind: "script",
            scriptId: "s1",
            scriptName: "Script 1",
            line: 2,
            name: "PayoutByDuration",
            parent: { kind: "cell", cell: at("B1") },
          },
        },
      ],
    });
  });

  it("bounds recursive traces to five callers and counts the omitted calls", () => {
    const workbook = scriptWorkbook(
      "Recurse(n) = IF(n > 0, Recurse(n - 1), QUERY('Page 1'!Table1, \"select Spa\"))",
      { t2: { A1: "=Recurse(190)" } },
    );

    const value = workbook.getValue(at("A1", "t2"));
    expect(value).toMatchObject({
      kind: "error",
      code: "#VALUE!",
      trace: [
        {
          function: "Recurse",
          location: { scriptId: "s1", line: 1, name: "Recurse" },
        },
      ],
    });
    if (!isError(value)) throw new Error("Expected a traced error");
    const callers = [];
    let site = value.trace?.[0]?.callSite;
    while (site && site.kind !== "more") {
      callers.push(site);
      site = site.parent;
    }
    expect(callers).toHaveLength(5);
    expect(callers.every((caller) => caller.kind === "script")).toBe(true);
    expect(site).toEqual({ kind: "more", count: 186 });
  });

  it("preserves an existing trace when two functions pass the error through", () => {
    const workbook = scriptWorkbook(
      [
        'Broken() = QUERY(Table1, "select Spa")',
        "Pass(value) = value",
        "Relay(value) = Pass(value)",
      ].join("\n"),
      { t1: { A1: "Spa", B1: "=Broken()", C1: "=Relay(B1)" } },
    );

    expect(workbook.getValue(at("C1"))).toMatchObject({
      kind: "error",
      trace: [
        {
          function: "Broken",
          location: { scriptId: "s1", scriptName: "Script 1", line: 1, name: "Broken" },
          callSite: { kind: "cell", cell: at("B1") },
        },
      ],
    });
    expect(workbook.getValue(at("C1"))).not.toMatchObject({
      trace: expect.arrayContaining([
        expect.objectContaining({ function: "Pass" }),
        expect.objectContaining({ function: "Relay" }),
      ]),
    });
  });

  it("does not trace an error from a plain cell formula", () => {
    const workbook = scriptWorkbook("Broken() = 1 / 0", { t2: { A1: "=1/0" } });

    expect(workbook.getValue(at("A1", "t2"))).toMatchObject({
      kind: "error",
      code: "#DIV/0!",
    });
    expect(workbook.getValue(at("A1", "t2"))).not.toHaveProperty("trace");
  });

  it("reads a name a script holds, bare and qualified, from any page", () => {
    const workbook = workbookWith([name("s1", "Total", "=SUM(Table1!A1:A2)")], {
      t1: { A1: "1", A2: "2", B1: "=Total", B2: "=Summary!Total", B3: "=total * 2" },
      t3: { A1: "=Total", A2: "='Page 1'!Summary!Total", A3: "=Summary!Total" },
    });
    expect(workbook.getValue(at("B1"))).toBe(3);
    expect(workbook.getValue(at("B2"))).toBe(3);
    expect(workbook.getValue(at("B3"))).toBe(6);
    expect(workbook.getValue(at("A1", "t3"))).toBe(3);
    expect(workbook.getValue(at("A2", "t3"))).toBe(3);
    // Summary is on page 1, so page 2 must name the page.
    expect(workbook.getValue(at("A3", "t3"))).toMatchObject({ code: "#NAME?" });
  });

  it("reads a name a table holds, whose formula means that table's cells", () => {
    const workbook = workbookWith([name("t2", "TaxRate", "B2")], {
      t1: { A1: "=TaxRate * 100", A2: "='Other Table'!TaxRate" },
      t2: { B2: "0.2" },
    });
    expect(workbook.getValue(at("A1"))).toBe(20);
    expect(workbook.getValue(at("A2"))).toBe(0.2);
  });

  it("reads a unique bare table name as its whole grid from any page", () => {
    const workbook = workbookWith([], {
      t1: { A1: "=SUM('Other Table')", A2: "=ROWS('Other Table')" },
      t2: { A1: "2", B1: "3", A2: "4" },
      t3: { A1: "=SUM('Page 1'!'Other Table')" },
    });
    expect(workbook.getValue(at("A1"))).toBe(9);
    expect(workbook.getValue(at("A2"))).toBe(2);
    expect(workbook.getValue(at("A1", "t3"))).toBe(9);
  });

  it("makes a bare table name ambiguous when another table has that name", () => {
    const workbook = workbookWith([], { t1: { A1: "=Table1" } });
    expect(workbook.getValue(at("A1"))).toMatchObject({ code: "#NAME?" });
  });

  it("treats Page!Table as a whole-table value when no held name also matches", () => {
    const workbook = workbookWith([], {
      t1: { A1: "=SUM('Page 1'!'Other Table')" },
      t2: { A1: "2", A2: "4" },
    });
    expect(workbook.getValue(at("A1"))).toBe(6);
  });

  it("makes Page!Table ambiguous when it also names a value held on the formula's page", () => {
    const structure: WorkbookStructure = {
      pages: [
        { id: "p1", name: "Summary" },
        { id: "p2", name: "Archive" },
      ],
      tables: [
        { id: "t1", pageId: "p2", name: "Main", rowCount: 1, colCount: 1 },
        { id: "t2", pageId: "p1", name: "Total", rowCount: 1, colCount: 1 },
      ],
      scripts: [{ id: "s1", pageId: "p2", name: "Summary", source: "" }],
    };
    const workbook = workbookWith(
      [name("s1", "Total", "1")],
      {
        t1: { A1: "=Summary!Total" },
      },
      structure,
    );

    const value = workbook.getValue(at("A1", "t1"));
    expect(value).toMatchObject({ code: "#NAME?" });
    expect(messageOf(value)).toBe(
      "Summary!Total has more than one meaning: Archive!Summary!Total, Summary!Total. Use one of these qualified names.",
    );
  });

  it("recalculates a whole-table use when a cell in that table changes", () => {
    const workbook = workbookWith([], {
      t1: { A1: "=SUM('Other Table')" },
      t2: { A1: "2", A2: "4" },
    });
    expect(workbook.getValue(at("A1"))).toBe(6);
    workbook.setCell(at("A2", "t2"), "10");
    expect(workbook.getValue(at("A1"))).toBe(12);
  });

  it("uses data-table column names as QUERY headers without dropping the first record", () => {
    const workbook = new Workbook();
    workbook.setStructure({
      pages: [
        { id: "p1", name: "Main" },
        { id: "p2", name: "Archive" },
      ],
      tables: [
        {
          id: "sales",
          pageId: "p1",
          name: "Sales",
          rowCount: 3,
          colCount: 3,
          columns: [
            { name: "Category", type: "text" },
            { name: "Account", type: "text" },
            { name: "Amount", type: "number" },
          ],
        },
      ],
    });
    for (const [row, values] of [
      ["Food", "Checking", "30"],
      ["Utilities", "Checking", "50"],
      ["Food", "Card", "12"],
    ].entries()) {
      values.forEach((input, col) => {
        workbook.setCell({ tableId: "sales", row, col }, input);
      });
    }

    const whole = workbook.evaluateOnPage("p2", "Sales");
    expect(isRange(whole) && whole.columnNames).toEqual(["Category", "Account", "Amount"]);
    const report = workbook.evaluateOnPage(
      "p2",
      'QUERY(Sales, "select Category, sum(Amount) group by Category")',
    );
    expect(isRange(report) && report.rows).toEqual([
      ["Category", "sum Amount"],
      ["Food", 42],
      ["Utilities", 50],
    ]);
    const qualified = workbook.evaluateOnPage(
      "p2",
      'QUERY(Main!Sales!A:C, "select Category, sum(Amount) group by Category")',
    );
    expect(isRange(qualified) && qualified.rows).toEqual([
      ["Category", "sum Amount"],
      ["Food", 42],
      ["Utilities", 50],
    ]);
  });

  it("recalculates a cell when a cell its name reads changes", () => {
    const workbook = workbookWith(
      [name("s1", "Total", "SUM(Table1!A1:A2)"), name("s1", "Double", "Total * 2")],
      { t1: { A1: "1", A2: "2", B1: "=Double" } },
    );
    expect(workbook.getValue(at("B1"))).toBe(6);
    workbook.setCell(at("A2"), "10");
    expect(workbook.getValue(at("B1"))).toBe(22);
    expect(workbook.getName("s1", "Double")).toBe(22);
  });

  it("holds a range in a name without filling cells", () => {
    const workbook = workbookWith([name("s1", "Prices", "Table1!A1:A3")], {
      t1: { A1: "1", A2: "2", A3: "3", B1: "=SUM(Prices)", B2: "=4" },
    });
    expect(workbook.getValue(at("B1"))).toBe(6);
    const prices = workbook.getName("s1", "Prices");
    expect(isRange(prices) && prices.rows).toEqual([[1], [2], [3]]);
    expect(workbook.getValue(at("B2"))).toBe(4);
  });

  it("calls a function a name holds, which reads cells where it was written", () => {
    const workbook = workbookWith(
      [name("s1", "Fee", "Table1!A1"), name("s1", "WithTax", "LAMBDA(amount, amount * (1 + Fee))")],
      { t1: { A1: "0.5", B1: "=WithTax(10)", B2: "=Summary!WithTax(20)" } },
    );
    expect(workbook.getValue(at("B1"))).toBe(15);
    expect(workbook.getValue(at("B2"))).toBe(30);
    workbook.setCell(at("A1"), "1");
    expect(workbook.getValue(at("B1"))).toBe(20);
  });

  it("prefers a LET binding to a name of the document", () => {
    const workbook = workbookWith([name("s1", "Total", "5")], {
      t1: { A1: "=LET(Total, 1, Total + 1)" },
    });
    expect(workbook.getValue(at("A1"))).toBe(2);
  });

  it("shows #CYCLE! for a cell that a name it uses reads", () => {
    const workbook = workbookWith([name("s1", "Next", "Table1!A1 + 1")], { t1: { A1: "=Next" } });
    expect(workbook.getValue(at("A1"))).toMatchObject({ code: "#CYCLE!" });
  });

  it("shows #CYCLE! for names that use each other", () => {
    const workbook = workbookWith([name("s1", "A_", "B_ + 1"), name("s1", "B_", "A_ + 1")], {
      t1: { A1: "=A_" },
    });
    expect(workbook.getValue(at("A1"))).toMatchObject({ code: "#CYCLE!" });
  });

  it("shows #NAME? for a word nothing defines", () => {
    const workbook = workbookWith([], { t1: { A1: "=Nothing", A2: "=Nothing(1)" } });
    expect(workbook.getValue(at("A1"))).toMatchObject({ code: "#NAME?" });
    expect(workbook.getValue(at("A2"))).toMatchObject({ code: "#NAME?" });
  });

  it("requires a script's formula to name the table of a cell it reads", () => {
    const workbook = workbookWith([name("s1", "First", "A1")], { t1: { A1: "1", B1: "=First" } });
    expect(workbook.getValue(at("B1"))).toMatchObject({ code: "#REF!" });
  });
});

describe("ambiguous names", () => {
  const twice = [name("s1", "Total", "1"), name("s2", "Total", "2")];

  it("makes a bare word that two names share an error that lists both", () => {
    const workbook = workbookWith(twice, { t1: { A1: "=Total" } });
    const value = workbook.getValue(at("A1"));
    expect(value).toMatchObject({ code: "#NAME?" });
    expect(messageOf(value)).toBe(
      "Total has more than one meaning: 'Page 1'!Summary!Total, Archive!Rates!Total. Use one of these qualified names.",
    );
  });

  it("still reads each of them qualified", () => {
    const workbook = workbookWith(twice, {
      t1: { A1: "=Summary!Total", A2: "=Archive!Rates!Total" },
    });
    expect(workbook.getValue(at("A1"))).toBe(1);
    expect(workbook.getValue(at("A2"))).toBe(2);
  });

  it("does not prefer the name in the formula's own script", () => {
    const workbook = workbookWith([...twice, name("s1", "Mine", "Total + 1")]);
    expect(workbook.getName("s1", "Mine")).toMatchObject({ code: "#NAME?" });
  });

  it("makes a word that a name and a table share an error, whatever page the table is on", () => {
    const structure: WorkbookStructure = {
      ...WITH_SCRIPTS,
      tables: [...WITH_SCRIPTS.tables, { id: "t4", pageId: "p2", name: "Fee" }],
    };
    const workbook = workbookWith(
      [name("s1", "Fee", "1")],
      { t1: { A1: "=Fee", A2: "=Summary!Fee" } },
      structure,
    );
    expect(messageOf(workbook.getValue(at("A1")))).toBe(
      "Fee has more than one meaning: 'Page 1'!Summary!Fee, Archive!Fee. Use one of these qualified names.",
    );
    expect(workbook.getValue(at("A2"))).toBe(1);
  });
});

describe("names that cannot be defined", () => {
  it.each([
    ["a cell address", name("s1", "AB12", "1"), "=Summary!AB12"],
    ["a built-in function", name("s1", "Sum", "1"), "=Summary!Sum"],
  ])("refuses a name that is %s", (_, definition, formula) => {
    const workbook = workbookWith([definition], { t1: { A1: formula } });
    expect(workbook.getName("s1", definition.name)).toMatchObject({ code: "#NAME?" });
    // A cell address after ! is a cell of a table named Summary, which does not exist.
    expect(isError(workbook.getValue(at("A1")))).toBe(true);
  });

  it("refuses the second of two names of one spelling in one script", () => {
    const workbook = workbookWith([name("s1", "Total", "1"), name("s1", "total", "2")], {
      t1: { A1: "=Summary!Total" },
    });
    // The first definition stands, and the second holds the reason it was refused.
    expect(workbook.getValue(at("A1"))).toBe(1);
  });

  it("refuses a name in a table with named columns", () => {
    const structure: WorkbookStructure = {
      ...WITH_SCRIPTS,
      tables: [
        ...WITH_SCRIPTS.tables,
        { id: "t4", pageId: "p1", name: "Sales", columns: [{ name: "Price", type: "number" }] },
      ],
    };
    const workbook = workbookWith([name("t4", "First", "A1")], {}, structure);
    expect(messageOf(workbook.getName("t4", "First"))).toContain("named columns");
  });

  it("keeps a syntax error as the name's value", () => {
    const workbook = workbookWith([name("s1", "Broken", "1 +")], { t1: { A1: "=Broken" } });
    expect(isError(workbook.getValue(at("A1")))).toBe(true);
  });
});

describe("a name as the target of an action", () => {
  function click(workbook: Workbook, address: string): ActionPlan {
    const button = workbook.getValue(at(address));
    if (!isButton(button)) throw new Error(`${address} is not a button`);
    return workbook.planAction(button.action);
  }

  it("writes to the cell a name stands for", () => {
    const workbook = workbookWith([name("t2", "Counter", "B2")], {
      t1: { A1: '=BUTTON("Add", EXECUTE(Counter + 1, Counter))' },
      t2: { B2: "4" },
    });
    expect(click(workbook, "A1")).toEqual({
      ok: true,
      effects: [{ type: "setCell", tableId: "t2", row: 1, col: 1, input: "5" }],
    });
  });

  it("refuses a name whose formula is not one reference", () => {
    const workbook = workbookWith([name("s1", "Two", "1 + 1")], {
      t1: { A1: '=BUTTON("Go", CLEAR(Two))' },
    });
    expect(click(workbook, "A1")).toMatchObject({ ok: false });
  });
});
