import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../testing";
import type { CellValue } from "../values";

// A column of mixed content: numbers, text, a boolean, a blank (A5), and a numeric string.
const MIXED = { A1: "1", A2: "2.5", A3: "header", A4: "TRUE", A6: "'7" };
const WITH_ERROR = { A1: "1", A2: "=1/0" };

function expectError(value: CellValue, code: string): void {
  expect(value).toMatchObject({ kind: "error", code });
}

describe("math functions", () => {
  it.each<[string, CellValue]>([
    ["=SUM(1, 2, 3)", 6],
    ["=SUM(A1:A6)", 3.5],
    ["=SUM(A1:A6, 10)", 13.5],
    ['=SUM("3", TRUE)', 4],
    ["=SUM(B1:B5)", 0],
    ["=SUM(A5)", 0],
    ["=AVERAGE(1, 2, 6)", 3],
    ["=AVERAGE(A1:A6)", 1.75],
    ["=MIN(3, 1, 2)", 1],
    ["=MIN(A1:A6)", 1],
    ["=MIN(B1:B5)", 0],
    ["=MAX(3, 1, 2)", 3],
    ["=MAX(A1:A6, 9)", 9],
    ["=MAX(B1:B5)", 0],
    ["=COUNT(A1:A6)", 2],
    ['=COUNT(1, "x", A1)', 2],
    ["=COUNTA(A1:A6)", 5],
    ["=COUNTA(B1:B5)", 0],
    ["=ROUND(2.5)", 3],
    ["=ROUND(-2.5)", -3],
    ["=ROUND(3.14159, 2)", 3.14],
    ["=ROUND(1234, -2)", 1200],
    ['=ROUND("2.4")', 2],
    ["=ABS(-4)", 4],
    ["=ABS(4)", 4],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, MIXED)).toBe(expected);
  });

  it.each([
    ["=SUM(A1:A2)", "#DIV/0!"],
    ["=SUM(1, A2)", "#DIV/0!"],
    ["=AVERAGE(A1:A2)", "#DIV/0!"],
    ["=MIN(A1:A2)", "#DIV/0!"],
    ["=ROUND(A2)", "#DIV/0!"],
    ["=ROUND(1, A2)", "#DIV/0!"],
    ["=ABS(A2)", "#DIV/0!"],
    ['=SUM("abc")', "#VALUE!"],
    ['=ABS("abc")', "#VALUE!"],
    ['=ROUND("abc")', "#VALUE!"],
    ['=ROUND(1, "abc")', "#VALUE!"],
    ["=ABS(A1:A2)", "#VALUE!"],
    ["=AVERAGE(C1:C3)", "#DIV/0!"],
  ])("%s is %s", (formula, code) => {
    expectError(evaluateFormula(formula, WITH_ERROR), code);
  });

  it("COUNT skips errors and COUNTA counts them", () => {
    expect(evaluateFormula("=COUNT(A1:A2)", WITH_ERROR)).toBe(1);
    expect(evaluateFormula("=COUNTA(A1:A2)", WITH_ERROR)).toBe(2);
  });
});

describe("logic functions", () => {
  it.each<[string, CellValue]>([
    ['=IF(TRUE, "yes", "no")', "yes"],
    ['=IF(FALSE, "yes", "no")', "no"],
    ['=IF(1, "yes", "no")', "yes"],
    ['=IF(A5, "yes", "no")', "no"],
    ['=IF(FALSE, "yes")', false],
    ['=IF(A1 > 0, "positive", "other")', "positive"],
    ["=IF(TRUE, A5)", null],
    ['=IFERROR(1/0, "oops")', "oops"],
    ['=IFERROR(5, "oops")', 5],
    ["=AND(TRUE, 1)", true],
    ["=AND(TRUE, FALSE)", false],
    ["=AND(A4:A4)", true],
    ["=OR(FALSE, 0)", false],
    ["=OR(FALSE, A4)", true],
    ['=OR("true", FALSE)', true],
    ["=NOT(TRUE)", false],
    ["=NOT(0)", true],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, MIXED)).toBe(expected);
  });

  it("IF does not evaluate the branch it skips", () => {
    expect(evaluateFormula("=IF(TRUE, 1, 1/0)")).toBe(1);
    expect(evaluateFormula("=IF(FALSE, 1/0, 2)")).toBe(2);
  });

  it("IFERROR does not evaluate the fallback when the value is fine", () => {
    expect(evaluateFormula("=IFERROR(1, 1/0)")).toBe(1);
  });

  it("IFERROR passes a range through", () => {
    expect(evaluateFormula("=SUM(IFERROR(A1:A2, 0))", { A1: "1", A2: "2" })).toBe(3);
  });

  it.each([
    ["=IF(1/0, 1, 2)", "#DIV/0!"],
    ['=IF("maybe", 1, 2)', "#VALUE!"],
    ["=IF(A1:A2, 1, 2)", "#VALUE!"],
    ["=IF(TRUE, 1/0, 2)", "#DIV/0!"],
    ["=AND(TRUE, 1/0)", "#DIV/0!"],
    ['=AND("x")', "#VALUE!"],
    ["=OR(A1:A2)", "#DIV/0!"],
    ["=NOT(1/0)", "#DIV/0!"],
    ['=NOT("x")', "#VALUE!"],
    ["=IFERROR(1/0, 1/0)", "#DIV/0!"],
  ])("%s is %s", (formula, code) => {
    expectError(evaluateFormula(formula, WITH_ERROR), code);
  });
});

describe("text functions", () => {
  it.each<[string, CellValue]>([
    ['=CONCATENATE("a", "b", 1, TRUE)', "ab1TRUE"],
    ["=CONCATENATE(A1:A6)", "12.5headerTRUE7"],
    ['=LEN("hello")', 5],
    ["=LEN(A5)", 0],
    ["=LEN(123)", 3],
    ['=UPPER("abc")', "ABC"],
    ['=LOWER("ABC")', "abc"],
    ['=TRIM("  a   b  ")', "a b"],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, MIXED)).toBe(expected);
  });

  it.each([
    ["=CONCATENATE(A1:A2)", "#DIV/0!"],
    ["=LEN(A2)", "#DIV/0!"],
    ["=UPPER(A1:A2)", "#VALUE!"],
    ['=CONCATENATE(SEND_EMAIL("a@b.co", "s", "b"))', "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expectError(evaluateFormula(formula, WITH_ERROR), code);
  });
});

describe("argument counts", () => {
  it.each([
    ["=SUM()", "SUM takes at least 1 argument"],
    ["=ABS(1, 2)", "ABS takes 1 argument"],
    ["=IF(TRUE)", "IF takes 2 to 3 arguments"],
    ["=ROUND(1, 2, 3)", "ROUND takes 1 to 2 arguments"],
    ['=SEND_EMAIL("a@b.co")', "SEND_EMAIL takes 3 to 4 arguments"],
  ])("%s reports %j", (formula, message) => {
    expect(evaluateFormula(formula)).toEqual({ kind: "error", code: "#ERROR!", message });
  });
});
