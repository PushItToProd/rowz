import { describe, expect, it } from "vitest";
import { defaultFunctions } from "./functions";
import type { FunctionRegistry, PureFunction } from "./functions/registry";
import { at, evaluateFormula, STRUCTURE, workbookWith } from "./testing";
import type { CellValue } from "./values";
import { createWorkbook, inputFitsColumnType, Workbook } from "./workbook";

function expectError(value: CellValue, code: string): void {
  expect(value).toMatchObject({ kind: "error", code });
}

describe("column input acceptance", () => {
  it.each([
    ["", "number", true],
    [" TRUE ", "checkbox", true],
    ["yes", "checkbox", false],
    ["=[", "any", false],
    ["=[", "text", true],
    ["arbitrary input", "formula", true],
  ] as const)("matches engine coercion for %j in %s columns", (input, type, expected) => {
    expect(inputFitsColumnType(input, type)).toBe(expected);
  });

  it("counts text inputs that become formulas with errors in Anything and Choice columns", () => {
    const structure = {
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) =>
        table.id === "t1"
          ? {
              ...table,
              rowCount: 2,
              colCount: 1,
              columns: [{ name: "Value", type: "text" as const }],
            }
          : table,
      ),
    };
    const workbook = workbookWith({ t1: { A1: "=1/0", A2: "=1+1" } }, structure);

    expect(workbook.getValue(at("A1"))).toBe("=1/0");
    expect(inputFitsColumnType("=1/0", "any", evaluateFormula("=1/0"))).toBe(false);
    expect(workbook.countColumnTypeMisfits("t1", 0, "any")).toBe(1);
    expect(workbook.countColumnTypeMisfits("t1", 0, "choice")).toBe(1);
  });
});

describe("volatile recalculation", () => {
  it("refreshes clock formulas and dependents while retaining unrelated cached values", () => {
    let now = Date.UTC(2026, 9, 6, 12);
    let calls = 0;
    const functions = new Map(defaultFunctions);
    functions.set("COUNT_CALLS", {
      kind: "pure",
      minArgs: 0,
      maxArgs: 0,
      callableAsValue: true,
      call: () => ++calls,
    });
    const workbook = new Workbook({ now: () => now, functions });
    workbook.setStructure(STRUCTURE);
    workbook.setCell(at("A1"), "=NOW()");
    workbook.setCell(at("B1"), "=A1");
    workbook.setCell(at("A2"), "=TODAY()");
    workbook.setCell(at("B2"), "=A2");
    workbook.setCell(at("C1"), "=COUNT_CALLS()");
    expect(workbook.getValue(at("B1"))).toEqual({ kind: "date", ms: now });
    expect(workbook.getValue(at("C1"))).toBe(1);
    now += 86_400_000;
    workbook.recalculateVolatile();
    expect(workbook.getValue(at("A1"))).toEqual({ kind: "date", ms: now });
    expect(workbook.getValue(at("B1"))).toEqual({ kind: "date", ms: now });
    expect(workbook.getValue(at("B2"))).toEqual({ kind: "date", ms: Date.UTC(2026, 9, 7) });
    expect(workbook.getValue(at("C1"))).toBe(1);
  });

  it("tracks cached names, named functions, formula columns, and relative-date spills", () => {
    let now = Date.UTC(2026, 9, 6, 12);
    const workbook = new Workbook({ now: () => now });
    workbook.setStructure({
      ...STRUCTURE,
      names: [
        { holderId: "t1", name: "Stamp", formula: "=NOW()" },
        { holderId: "t1", name: "Clock", formula: "=LAMBDA(NOW())" },
      ],
      tables: [
        ...STRUCTURE.tables,
        {
          id: "computed",
          pageId: "p1",
          name: "Computed",
          rowCount: 1,
          columns: [{ name: "Time", type: "formula", formula: "=NOW()" }],
        },
      ],
    });
    expect(workbook.getName("t1", "Stamp")).toEqual({ kind: "date", ms: now });
    workbook.setCell(at("A1"), "=Stamp");
    workbook.setCell(at("A2"), "=Stamp");
    workbook.setCell(at("B1"), "=Clock()");
    workbook.setCell(at("C3"), "=LASTXDAYS(2)");
    workbook.setCell(at("E3"), "=D3");
    expect(workbook.getValue(at("A2"))).toEqual({ kind: "date", ms: now });
    now += 86_400_000;
    workbook.recalculateVolatile();
    for (const address of ["A1", "A2", "B1"]) {
      expect(workbook.getValue(at(address))).toEqual({ kind: "date", ms: now });
    }
    expect(workbook.getValue(at("A1", "computed"))).toEqual({ kind: "date", ms: now });
    expect(workbook.getValue(at("E3"))).toEqual({ kind: "date", ms: Date.UTC(2026, 9, 7) });
    workbook.setCell(at("A1"), "42");
    workbook.setCell(at("A2"), "");
    workbook.setStructure(STRUCTURE);
    workbook.recalculateVolatile();
    expect(workbook.getValue(at("A1"))).toBe(42);
    expect(workbook.getValue(at("A2"))).toBeNull();
  });
});

describe("cell contents", () => {
  it("returns null and an empty input for a cell never set", () => {
    const workbook = workbookWith({});
    expect(workbook.getValue(at("A1"))).toBeNull();
    expect(workbook.getInput(at("A1"))).toBe("");
  });

  it("keeps the input as typed and parses the literal value", () => {
    const workbook = workbookWith({ t1: { A1: " 42 ", A2: "hello", A3: "true" } });
    expect(workbook.getInput(at("A1"))).toBe(" 42 ");
    expect(workbook.getValue(at("A1"))).toBe(42);
    expect(workbook.getValue(at("A2"))).toBe("hello");
    expect(workbook.getValue(at("A3"))).toBe(true);
  });

  it("clears a cell when set to an empty input", () => {
    const workbook = workbookWith({ t1: { A1: "5", B1: "=A1+1" } });
    expect(workbook.getValue(at("B1"))).toBe(6);
    workbook.setCell(at("A1"), "");
    expect(workbook.getValue(at("A1"))).toBeNull();
    expect(workbook.getValue(at("B1"))).toBe(1);
  });

  it("rejects a cell in a table that does not exist", () => {
    expect(() => {
      workbookWith({}).setCell(at("A1", "nope"), "1");
    }).toThrow("Unknown table nope");
  });

  it("reports a syntax error with its message", () => {
    expect(evaluateFormula("=1+")).toEqual({
      kind: "error",
      code: "#ERROR!",
      message: "Unexpected end of formula",
    });
  });

  it("evaluates an error written in a formula to that error", () => {
    expectError(evaluateFormula("=#REF!+1"), "#REF!");
    expect(evaluateFormula('=IFERROR(#DIV/0!, "caught")')).toBe("caught");
  });

  it("reports unknown words and unknown functions as name errors", () => {
    expectError(evaluateFormula("=total"), "#NAME?");
    expectError(evaluateFormula("=NOPE(1)"), "#NAME?");
  });
});

describe("operators", () => {
  it.each<[string, CellValue]>([
    ["=1+2*3", 7],
    ["=(1+2)*3", 9],
    ["=10/4", 2.5],
    ["=2^10", 1024],
    ["=-2^2", 4],
    ["=-A1", -5],
    ["=+A1", 5],
    ['="3"+4', 7],
    ["=TRUE+1", 2],
    ["=A9+1", 1],
    ['="a"&"b"&1', "ab1"],
    ['=A9&"x"', "x"],
    ["=1=1", true],
    ["=1<>1", false],
    ["=1!=1", false],
    ["=1!=2", true],
    ["=2>1", true],
    ["=2<1", false],
    ["=2>=2", true],
    ["=2<=1", false],
    ['="abc"="ABC"', true],
    ['="a"<"b"', true],
    ['="b"<"a"', false],
    ["=FALSE<TRUE", true],
    ['=1<"a"', true],
    ['="a"<TRUE', true],
    ["=TRUE>999", true],
    ["=A9=0", true],
    ['=A9=""', true],
    ["=A9=FALSE", true],
    ["=A9=A8", true],
    ['=1="1"', false],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, { A1: "5" })).toBe(expected);
  });

  it.each([
    ["=1/0", "#DIV/0!"],
    ['="a"+1', "#VALUE!"],
    ['=1+"a"', "#VALUE!"],
    ['=-"a"', "#VALUE!"],
    ["=10^400", "#VALUE!"],
    ["=(-1)^0.5", "#VALUE!"],
    ["=1/0+1", "#DIV/0!"],
    ["=1+1/0", "#DIV/0!"],
    ["=-(1/0)", "#DIV/0!"],
    ['=SEND_EMAIL("a@b.co", "s", "b")+1', "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expectError(evaluateFormula(formula), code);
  });
});

describe("references", () => {
  it("reads other cells in the same table", () => {
    expect(evaluateFormula("=A1+$B$2", { A1: "1", B2: "2" })).toBe(3);
  });

  it("reads a range written with its corners in any order", () => {
    expect(evaluateFormula("=SUM(B2:A1)", { A1: "1", B1: "2", A2: "3", B2: "4" })).toBe(10);
  });

  it("reads another table on the same page by name, ignoring case", () => {
    const workbook = workbookWith({
      t1: { A1: "='Other Table'!A1 * 2", A2: "=SUM('other table'!A1:A2)" },
      t2: { A1: "21", A2: "1" },
    });
    expect(workbook.getValue(at("A1"))).toBe(42);
    expect(workbook.getValue(at("A2"))).toBe(22);
  });

  it("resolves an unqualified table name on the formula's own page", () => {
    const workbook = workbookWith({
      t1: { A1: "on page 1" },
      t2: { A1: "=Table1!A1" },
      t3: { A1: "on archive", B1: "=Table1!A1" },
    });
    expect(workbook.getValue(at("A1", "t2"))).toBe("on page 1");
    expect(workbook.getValue(at("B1", "t3"))).toBe("on archive");
  });

  it("reads a table on another page with a page qualifier", () => {
    const workbook = workbookWith({
      t1: { A1: "=Archive!Table1!A1", A2: "='page 1'!'Other Table'!A1" },
      t2: { A1: "other" },
      t3: { A1: "archived" },
    });
    expect(workbook.getValue(at("A1"))).toBe("archived");
    expect(workbook.getValue(at("A2"))).toBe("other");
  });

  it.each([
    "=Missing!A1",
    "=Archive!'Other Table'!A1",
    "=Nowhere!Table1!A1",
    "=SUM(Missing!A1:A2)",
  ])("%s is #REF!", (formula) => {
    expectError(evaluateFormula(formula), "#REF!");
  });

  it("passes a referenced cell's error along", () => {
    expectError(evaluateFormula("=A1+1", { A1: "=1/0" }), "#DIV/0!");
    expectError(evaluateFormula("=A1", { A1: "=nope" }), "#NAME?");
  });
});

describe("ranges with an open side", () => {
  const cells = { A1: "1", A2: "2", A3: "3", B1: "10", B2: "20", C2: "200" };

  it.each<[string, CellValue]>([
    ["=SUM(A:A)", 6],
    ["=SUM(A:B)", 36],
    ["=SUM(2:2)", 222],
    ["=SUM(1:2)", 233],
    ["=SUM(A2:A)", 5],
    ["=SUM(B2:C)", 220],
    ["=SUM(A1:2)", 233],
    ["=SUM(B:B2)", 30],
    ["=SUM(2:B3)", 25],
    ["=SUM($A:$A)", 6],
    ["=COUNTA(A:C)", 6],
    ["=COUNTA(D:D)", 0],
    ["=SUM(A9:A)", 0],
  ])("%s is %j", (formula, expected) => {
    // The formula sits outside every range it reads.
    const workbook = workbookWith({
      t1: cells,
      t2: { A1: formula.replaceAll(/([(,])/g, "$1Table1!") },
    });
    expect(workbook.getValue(at("A1", "t2"))).toBe(expected);
  });

  it("reads to the last row and column that hold a cell when the table has no declared size", () => {
    const workbook = workbookWith({ t1: { A1: "1", C5: "5" }, t2: { A1: "=COUNTA(Table1!A:C)" } });
    expect(workbook.getValue(at("A1", "t2"))).toBe(2);
  });

  it("stops at the table's declared size", () => {
    const workbook = workbookWith({});
    workbook.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) => ({ ...table, rowCount: 3, colCount: 2 })),
    });
    for (const [address, input] of Object.entries({ A1: "1", A3: "3", B2: "20" })) {
      workbook.setCell(at(address), input);
    }
    workbook.setCell(at("A1", "t2"), '=SUM(Table1!A:B) & "/" & SUM(Table1!1:3)');
    expect(workbook.getValue(at("A1", "t2"))).toBe("24/24");
  });

  it("recalculates when a cell far down an open column gets a value", () => {
    const workbook = workbookWith({ t1: { A1: "1", B1: "=SUM(A:A)", C1: "=SUM(A2:A)" } });
    expect(workbook.getValue(at("B1"))).toBe(1);
    expect(workbook.getValue(at("C1"))).toBe(0);
    workbook.setCell(at("A500"), "5");
    expect(workbook.getValue(at("B1"))).toBe(6);
    expect(workbook.getValue(at("C1"))).toBe(5);
  });

  it("reports a cycle for a formula inside the column or row it reads", () => {
    expectError(workbookWith({ t1: { A5: "=SUM(A:A)" } }).getValue(at("A5")), "#CYCLE!");
    expectError(workbookWith({ t1: { C2: "=SUM(2:2)" } }).getValue(at("C2")), "#CYCLE!");
    expect(workbookWith({ t1: { A1: "4", B1: "=SUM(A:A)" } }).getValue(at("B1"))).toBe(4);
  });

  it("fills cells like any range when a formula's result is the range itself", () => {
    const workbook = workbookWith({ t1: { A1: "1", A2: "2", C1: "=A:A" } });
    expect(workbook.getArray(at("C1"))).toEqual([[1], [2]]);
  });
});

describe("recalculation", () => {
  it("updates dependents when a cell changes", () => {
    const workbook = workbookWith({ t1: { A1: "1", B1: "=A1*2", C1: "=B1+1", D1: "=SUM(A1:C1)" } });
    expect(workbook.getValue(at("D1"))).toBe(6);
    workbook.setCell(at("A1"), "10");
    expect(workbook.getValue(at("B1"))).toBe(20);
    expect(workbook.getValue(at("C1"))).toBe(21);
    expect(workbook.getValue(at("D1"))).toBe(51);
  });

  it("updates a range formula when an empty cell in the range gets a value", () => {
    const workbook = workbookWith({ t1: { A1: "1", B1: "=SUM(A1:A3)" } });
    expect(workbook.getValue(at("B1"))).toBe(1);
    workbook.setCell(at("A3"), "5");
    expect(workbook.getValue(at("B1"))).toBe(6);
  });

  it("updates dependents in other tables", () => {
    const workbook = workbookWith({ t1: { A1: "1" }, t3: { A1: "='Page 1'!Table1!A1+1" } });
    expect(workbook.getValue(at("A1", "t3"))).toBe(2);
    workbook.setCell(at("A1"), "5");
    expect(workbook.getValue(at("A1", "t3"))).toBe(6);
  });

  it("follows the new references after a formula is replaced", () => {
    const workbook = workbookWith({ t1: { A1: "1", A2: "2", B1: "=A1" } });
    expect(workbook.getValue(at("B1"))).toBe(1);
    workbook.setCell(at("B1"), "=A2");
    workbook.setCell(at("A1"), "100");
    expect(workbook.getValue(at("B1"))).toBe(2);
    workbook.setCell(at("A2"), "3");
    expect(workbook.getValue(at("B1"))).toBe(3);
  });

  it("recomputes only the cells that depend on the change", () => {
    const calls: string[] = [];
    const probe: PureFunction = {
      kind: "pure",
      minArgs: 2,
      maxArgs: 2,
      callableAsValue: true,
      call([label, value]) {
        calls.push(label?.() as string);
        return value?.() ?? null;
      },
    };
    const functions: FunctionRegistry = new Map([...defaultFunctions, ["PROBE", probe]]);
    const workbook = new Workbook({ functions });
    workbook.setStructure(STRUCTURE);
    workbook.setCell(at("A1"), "1");
    workbook.setCell(at("A2"), "2");
    workbook.setCell(at("B1"), '=PROBE("b1", A1)');
    workbook.setCell(at("B2"), '=PROBE("b2", A2)');
    workbook.setCell(at("C1"), '=PROBE("c1", B1 + B2)');

    expect(workbook.getValue(at("C1"))).toBe(3);
    expect(calls.sort()).toEqual(["b1", "b2", "c1"]);

    calls.length = 0;
    expect(workbook.getValue(at("C1"))).toBe(3);
    expect(calls).toEqual([]);

    workbook.setCell(at("A1"), "10");
    expect(workbook.getValue(at("C1"))).toBe(12);
    expect(workbook.getValue(at("B2"))).toBe(2);
    expect(calls.sort()).toEqual(["b1", "c1"]);
  });

  it("evaluates a dependency chain longer than the call stack allows for recursion", () => {
    const length = 20_000;
    const workbook = workbookWith({ t1: { A1: "1" } });
    for (let row = 1; row < length; row += 1) {
      workbook.setCell({ tableId: "t1", row, col: 0 }, `=A${String(row)}+1`);
    }
    expect(workbook.getValue({ tableId: "t1", row: length - 1, col: 0 })).toBe(length);
  });

  it("finds formulas inside a range far larger than the table's contents", () => {
    const workbook = workbookWith({ t1: { C3: "=1+1", A1: "=SUM(B1:ZZ9999)" } });
    expect(workbook.getValue(at("A1"))).toBe(2);
  });
});

describe("cycles", () => {
  it("marks a cell that references itself", () => {
    expectError(workbookWith({ t1: { A1: "=A1+1" } }).getValue(at("A1")), "#CYCLE!");
  });

  it("marks a cell inside its own range", () => {
    expectError(workbookWith({ t1: { A2: "=SUM(A1:A3)" } }).getValue(at("A2")), "#CYCLE!");
  });

  it("marks every cell in a loop and passes the error to cells that read them", () => {
    const workbook = workbookWith({
      t1: { A1: "=B1", B1: "=C1", C1: "=A1", D1: "=A1+1", E1: "7" },
    });
    for (const address of ["A1", "B1", "C1", "D1"]) {
      expectError(workbook.getValue(at(address)), "#CYCLE!");
    }
    expect(workbook.getValue(at("E1"))).toBe(7);
  });

  it("lets a cell outside the loop catch the error", () => {
    const workbook = workbookWith({ t1: { A1: "=B1", B1: "=A1", C1: '=IFERROR(A1, "loop")' } });
    expect(workbook.getValue(at("C1"))).toBe("loop");
  });

  // C1 is on the loop A1 -> C1 -> D1 -> A1. IFERROR must not let it escape,
  // whichever cell is read first.
  it.each(["A1", "B1", "C1", "D1"])("gives the same result when %s is read first", (first) => {
    const workbook = workbookWith({
      t1: { A1: "=B1+C1", B1: "=D1", C1: "=IFERROR(D1, 5)", D1: "=A1" },
    });
    workbook.getValue(at(first));
    for (const address of ["A1", "B1", "C1", "D1"]) {
      expectError(workbook.getValue(at(address)), "#CYCLE!");
    }
  });

  it("treats a loop through a branch that is never taken as a loop", () => {
    expectError(workbookWith({ t1: { A1: "=IF(TRUE, 1, A1)" } }).getValue(at("A1")), "#CYCLE!");
  });

  it("recovers when the loop is broken", () => {
    const workbook = workbookWith({ t1: { A1: "=B1", B1: "=A1" } });
    expectError(workbook.getValue(at("A1")), "#CYCLE!");
    workbook.setCell(at("B1"), "3");
    expect(workbook.getValue(at("A1"))).toBe(3);
  });

  it("detects a loop that spans tables", () => {
    const workbook = workbookWith({ t1: { A1: "='Other Table'!A1" }, t2: { A1: "=Table1!A1" } });
    expectError(workbook.getValue(at("A1")), "#CYCLE!");
    expectError(workbook.getValue(at("A1", "t2")), "#CYCLE!");
  });
});

describe("setStructure", () => {
  it("re-resolves references when a table is renamed", () => {
    const workbook = workbookWith({ t1: { A1: "='Other Table'!A1" }, t2: { A1: "9" } });
    expect(workbook.getValue(at("A1"))).toBe(9);

    workbook.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) =>
        table.id === "t2" ? { ...table, name: "Renamed" } : table,
      ),
    });
    expectError(workbook.getValue(at("A1")), "#REF!");

    workbook.setCell(at("A1"), "=Renamed!A1");
    expect(workbook.getValue(at("A1"))).toBe(9);
  });

  it("resolves a reference once the table it names is added", () => {
    const workbook = workbookWith({ t1: { A1: "=New!A1" } });
    expectError(workbook.getValue(at("A1")), "#REF!");

    workbook.setStructure({
      ...STRUCTURE,
      tables: [...STRUCTURE.tables, { id: "t4", pageId: "p1", name: "New" }],
    });
    workbook.setCell(at("A1", "t4"), "8");
    expect(workbook.getValue(at("A1"))).toBe(8);

    workbook.setCell(at("A1", "t4"), "80");
    expect(workbook.getValue(at("A1"))).toBe(80);
  });

  it("drops the cells of a removed table and keeps the rest", () => {
    const workbook = workbookWith({ t1: { A1: "='Other Table'!A1", B1: "kept" }, t2: { A1: "9" } });
    workbook.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.filter((table) => table.id !== "t2"),
    });
    expectError(workbook.getValue(at("A1")), "#REF!");
    expect(workbook.getValue(at("B1"))).toBe("kept");
    expect(workbook.getValue(at("A1", "t2"))).toBeNull();
    expect(() => {
      workbook.setCell(at("A1", "t2"), "1");
    }).toThrow("Unknown table t2");
  });
});

describe("createWorkbook", () => {
  it("loads structure and cells, ignoring extra fields on tables", () => {
    const workbook = createWorkbook({
      pages: STRUCTURE.pages,
      tables: STRUCTURE.tables.map((table) => ({ ...table, rowCount: 20 })),
      cells: [
        { tableId: "t1", row: 0, col: 0, input: "2" },
        { tableId: "t2", row: 0, col: 0, input: "=Table1!A1*2" },
      ],
    });
    expect(workbook.getValue(at("A1", "t2"))).toBe(4);
    expect(workbook.getInput(at("A1"))).toBe("2");
  });
});
