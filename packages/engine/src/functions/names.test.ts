import { describe, expect, it } from "vitest";
import { formulasAfterEdit, inputsAfterRename } from "../rewrite";
import { at, evaluateFormula, STRUCTURE, workbookWith } from "../testing";
import { formatValue, isLambda, type CellValue } from "../values";

function expectError(formula: string, code: string, message?: string): void {
  const value = evaluateFormula(formula);
  expect(value, formula).toMatchObject({ kind: "error", code });
  if (message !== undefined) expect(value).toMatchObject({ message });
}

describe("LET", () => {
  it.each<[string, CellValue]>([
    ["=LET(x, 5, x * 2)", 10],
    ["=LET(x, 5, y, x + 1, x * y)", 30],
    ["=LET(total, SUM(A1:A3), total / 2)", 3],
    ["=LET(Rate, 0.5, rate * RATE)", 0.25],
    ["=LET(x, 1, LET(x, 2, x) + x)", 3],
    ["=LET(x, 1, x, x + 1, x)", 2],
    ['=LET(unused, 1/0, "fine")', "fine"],
    ['=LET(broken, 1/0, IFERROR(broken, "caught"))', "caught"],
    ["=LET(tax_rate, 0.1, A1 * tax_rate)", 0.1],
    ['=LET(blank, B9, IF(ISBLANK(blank), "empty", "full"))', "empty"],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, { A1: "1", A2: "2", A3: "3" })).toBe(expected);
  });

  it.each([
    ["=LET(x, 1/0, x + 1)", "#DIV/0!", "Division by zero"],
    ["=LET(x, 5, y)", "#NAME?", "Unknown name y"],
    ["=LET(x, y, y, 1, x)", "#NAME?", "Unknown name y"],
    ["=LET(x, 5)", "#ERROR!", "LET takes at least 3 arguments"],
    ["=LET(x, 5, y, 6)", "#ERROR!", "LET takes names and values in pairs, then a result"],
    ["=LET(x1, 5, x1)", "#ERROR!", "X1 is a cell address and cannot be used as a name"],
    ['=LET("x", 5, 1)', "#ERROR!", "LET needs a name here"],
    ["=LET(TRUE, 5, 1)", "#ERROR!", "LET needs a name here"],
  ])("%s is %s: %s", (formula, code, message) => {
    expectError(formula, code, message);
  });

  it("reports a name used outside any LET as unknown", () => {
    expectError("=total * 2", "#NAME?", "Unknown name total");
    expectError("=A", "#NAME?", "Unknown name A");
  });
});

describe("LAMBDA", () => {
  it.each<[string, CellValue]>([
    ["=LAMBDA(x, x * 2)(4)", 8],
    ["=LAMBDA(a, b, a & b)(1, 2)", "12"],
    ["=LAMBDA(5)()", 5],
    ["=LET(double, LAMBDA(x, x * 2), double(4) + double(1))", 10],
    ["=LET(k, 3, scale, LAMBDA(x, x * k), scale(2))", 6],
    ["=LET(k, 3, scale, LAMBDA(x, x * k), LET(k, 100, scale(2)))", 6],
    ["=LAMBDA(a, LAMBDA(b, a + b))(1)(2)", 3],
    ["=LET(apply, LAMBDA(f, v, f(v)), apply(LAMBDA(x, x + 1), 1))", 2],
    ["=LET(sum, LAMBDA(a, a + 100), sum(1))", 101],
    ["=LAMBDA(X, x + X)(2)", 4],
    ["=LAMBDA(v, SUM(v))(A1:A3)", 6],
    ["=LET(fact, LAMBDA(self, n, IF(n <= 1, 1, n * self(self, n - 1))), fact(fact, 5))", 120],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, { A1: "1", A2: "2", A3: "3" })).toBe(expected);
  });

  it.each([
    ["=LAMBDA(x, x)(1, 2)", "#ERROR!", "The function takes 1 argument"],
    ["=LAMBDA(a, b, a)(1)", "#ERROR!", "The function takes 2 arguments"],
    ["=LAMBDA(x, x, 1)", "#ERROR!", "LAMBDA has two parameters with one name"],
    ["=LAMBDA(a1, 1)", "#ERROR!", "A1 is a cell address and cannot be used as a name"],
    ["=LAMBDA(1, 2)", "#ERROR!", "LAMBDA needs a name here"],
    ["=LAMBDA(x, 1/x)(0)", "#DIV/0!", "Division by zero"],
    ["=LAMBDA(x, x)(1/0)", "#DIV/0!", "Division by zero"],
    ["=5(1)", "#VALUE!", "Only a function made with LAMBDA can be called"],
    ['=LET(f, "text", f(1))', "#VALUE!", "Only a function made with LAMBDA can be called"],
    ["=(1/0)(1)", "#DIV/0!", "Division by zero"],
    ["=nothing(1)", "#NAME?", "Unknown function NOTHING"],
    ["=LAMBDA(x, x) + 1", "#VALUE!", "Expected a single value"],
    [
      "=LET(loop, LAMBDA(self, n, self(self, n + 1)), loop(loop, 0))",
      "#ERROR!",
      "Function calls are nested too deeply",
    ],
  ])("%s is %s: %s", (formula, code, message) => {
    expectError(formula, code, message);
  });

  it("can be held by a cell, which shows its parameters", () => {
    const value = evaluateFormula("=LAMBDA(Price, qty, Price * qty)");
    expect(isLambda(value)).toBe(true);
    expect(formatValue(value)).toBe("LAMBDA(Price, qty)");
  });
});

describe("a function in a cell", () => {
  it("is called from other cells by the cell's address", () => {
    const workbook = workbookWith({
      t1: { A1: "=LAMBDA(x, x * 2)", B1: "=A1(21)", B2: "=$A$1(1) + A1(2)" },
    });
    expect(workbook.getValue(at("B1"))).toBe(42);
    expect(workbook.getValue(at("B2"))).toBe(6);
  });

  it("is called from another table or page with a qualified address", () => {
    const workbook = workbookWith({
      t1: { A1: "=LAMBDA(x, x + 1)" },
      t2: { A1: "=Table1!A1(1)" },
      t3: { A1: "='Page 1'!Table1!A1(10)" },
    });
    expect(workbook.getValue(at("A1", "t2"))).toBe(2);
    expect(workbook.getValue(at("A1", "t3"))).toBe(11);
  });

  it("reads cells relative to the cell that defines it, not the cell that calls it", () => {
    const workbook = workbookWith({
      t1: { A1: "caller's A1", B1: "='Other Table'!B1()" },
      t2: { A1: "definer's A1", B1: "=LAMBDA(A1)" },
    });
    expect(workbook.getValue(at("B1"))).toBe("definer's A1");
  });

  it("makes its callers recalculate when a cell its body reads changes", () => {
    const workbook = workbookWith({
      t1: { A1: "10", B1: "=LAMBDA(x, x + A1)", C1: "=B1(1)", D1: "=C1 * 2" },
    });
    expect(workbook.getValue(at("D1"))).toBe(22);
    workbook.setCell(at("A1"), "100");
    expect(workbook.getValue(at("C1"))).toBe(101);
    expect(workbook.getValue(at("D1"))).toBe(202);
  });

  it("makes its callers recalculate when the function itself is replaced", () => {
    const workbook = workbookWith({ t1: { A1: "=LAMBDA(x, x + 1)", B1: "=A1(1)" } });
    expect(workbook.getValue(at("B1"))).toBe(2);
    workbook.setCell(at("A1"), "=LAMBDA(x, x * 10)");
    expect(workbook.getValue(at("B1"))).toBe(10);
  });

  it("reports a call of a cell that holds no function", () => {
    const workbook = workbookWith({
      t1: { A1: "5", B1: "=A1(1)", B2: "=A2(1)", A3: "=1/0", B3: "=A3(1)" },
    });
    expect(workbook.getValue(at("B1"))).toMatchObject({ code: "#VALUE!" });
    expect(workbook.getValue(at("B2"))).toMatchObject({ code: "#VALUE!" });
    expect(workbook.getValue(at("B3"))).toMatchObject({ code: "#DIV/0!" });
  });

  it("cannot call itself: that is a cycle", () => {
    const workbook = workbookWith({
      t1: { A1: "=LAMBDA(n, IF(n <= 1, 1, n * A1(n - 1)))", B1: "=A1(3)" },
    });
    expect(workbook.getValue(at("A1"))).toMatchObject({ code: "#CYCLE!" });
    expect(workbook.getValue(at("B1"))).toMatchObject({ code: "#CYCLE!" });
  });

  it("cannot be written by EXECUTE or sent as email text", () => {
    const workbook = workbookWith({
      t1: { A1: "=LAMBDA(x, x)", B1: '=BUTTON("go", EXECUTE(A1, C1))' },
    });
    const button = workbook.getValue(at("B1"));
    if (typeof button !== "object" || button?.kind !== "button") throw new Error("not a button");
    expect(workbook.planAction(button.action)).toMatchObject({
      ok: false,
      error: { code: "#VALUE!" },
    });
  });

  it("keeps working when its table is renamed or a row is inserted above it", () => {
    const cells = [
      { ...at("A1"), input: "=LAMBDA(x, x * 2)" },
      { ...at("A1", "t2"), input: "=Table1!A1(4) + 1" },
    ];
    const data = { ...STRUCTURE, cells };
    expect(inputsAfterRename(data, { kind: "table", tableId: "t1", name: "Lib" })).toEqual([
      { ...at("A1", "t2"), input: "=Lib!A1(4) + 1" },
    ]);
    expect(
      formulasAfterEdit(data, { tableId: "t1", axis: "row", kind: "insert", index: 0 }),
    ).toContainEqual({ ...at("A1", "t2"), input: "=Table1!A2(4) + 1" });
  });
});

describe("function names", () => {
  it("never look like a cell address, which would be read as a call of that cell", async () => {
    const { defaultFunctions } = await import("./index");
    for (const name of defaultFunctions.keys()) expect(name).not.toMatch(/^[A-Z]{1,3}[0-9]+$/);
  });
});
