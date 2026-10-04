import { describe, expect, it } from "vitest";
import { callFunction } from "../evaluate";
import { formulasAfterEdit, inputsAfterRename } from "../rewrite";
import { at, evaluateFormula, STRUCTURE, workbookWith } from "../testing";
import { formatValue, isFunction, isLambda, type CellValue } from "../values";
import { Workbook } from "../workbook";
import { defaultFunctions } from "./index";

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
    ["=LET(x, 5, y)", "#NAME?", "Unknown name 'y'"],
    ["=LET(x, y, y, 1, x)", "#NAME?", "Unknown name 'y'"],
    ["=LET(x, 5)", "#ERROR!", "LET takes at least 3 arguments"],
    ["=LET(x, 5, y, 6)", "#ERROR!", "LET takes names and values in pairs, then a result"],
    ["=LET(x1, 5, x1)", "#ERROR!", "X1 is a cell address and cannot be used as a name"],
    ['=LET("x", 5, 1)', "#ERROR!", "LET needs a name here"],
    ["=LET(TRUE, 5, 1)", "#ERROR!", "LET needs a name here"],
  ])("%s is %s: %s", (formula, code, message) => {
    expectError(formula, code, message);
  });

  it("reports a name used outside any LET as unknown", () => {
    expectError("=total * 2", "#NAME?", "Unknown name 'total'");
    expectError("=A", "#NAME?", "Unknown name 'A'");
  });

  it("keeps the unknown name in a cell error message", () => {
    const workbook = workbookWith({ t1: { A1: "=nonexistentvar" } });
    expect(workbook.getValue(at("A1"))).toMatchObject({
      kind: "error",
      code: "#NAME?",
      message: "Unknown name 'nonexistentvar'",
    });
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
    ['=LET(f, UPPER, f("word"))', "WORD"],
    ["=LET(f, ROUND, f(3.14159))", 3],
    ["=LET(f, SUM, f(1, 2))", 3],
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
    ["=5(1)", "#VALUE!", "Only a LAMBDA or built-in function can be called"],
    ['=LET(f, "text", f(1))', "#VALUE!", "Only a LAMBDA or built-in function can be called"],
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

  it("evaluates a bare pure built-in name to a function value", () => {
    const value = evaluateFormula("=UPPER");
    expect(isFunction(value)).toBe(true);
    expect(formatValue(value)).toBe("UPPER");
  });

  it("does not expose lazy built-ins as function values", () => {
    for (const [name, definition] of defaultFunctions) {
      if (definition.kind === "pure" && !definition.callableAsValue) {
        expectError(`=${name}`, "#NAME?", `Unknown name '${name}'`);
      }
    }
    expectError("=LET(f, IFERROR, f(1/0, 2))", "#NAME?", "Unknown name 'IFERROR'");
  });

  it("counts calls to a built-in function value toward the call-depth limit", () => {
    const value = evaluateFormula("=UPPER");
    if (!isFunction(value)) throw new Error("UPPER did not evaluate to a function value");
    expect(() => callFunction(value, ["word"], { ...value.context, depth: 200 })).toThrow(
      "Function calls are nested too deeply",
    );
  });

  it("lets a LET binding shadow a built-in function name", () => {
    expect(evaluateFormula('=LET(UPPER, "local", UPPER)')).toBe("local");
    const workbook = workbookWith({
      t1: {
        B1: "apple",
        B2: "banana",
        D1: '=LET(UPPER, LAMBDA(value, value & "!"), MAP(B1:B2, UPPER))',
      },
    });
    expect(workbook.getArray(at("D1"))).toEqual([["apple!"], ["banana!"]]);
  });

  it("resolves a table named after a built-in before making a function value", () => {
    const workbook = new Workbook();
    workbook.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) =>
        table.id === "t1" ? { ...table, name: "UPPER" } : table,
      ),
    });
    workbook.setCell(at("A1"), "one");
    workbook.setCell(at("A2"), "two");
    workbook.setCell(at("A1", "t2"), "=ROWS(UPPER)");
    workbook.setCell(at("A2", "t2"), "=MAP(SEQUENCE(2), UPPER)");
    expect(workbook.getValue(at("A1", "t2"))).toBe(2);
    expect(workbook.getValue(at("A2", "t2"))).toMatchObject({
      kind: "error",
      code: "#VALUE!",
      message: "Expected a function made with LAMBDA or a built-in function name",
    });
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
