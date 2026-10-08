import { describe, expect, it } from "vitest";
import { at, evaluateFormula, workbookWith } from "./testing";

describe("boolean operators", () => {
  it.each<[string, number | boolean]>([
    ["=LET(Not, 2, Not + 1)", 3],
    ["=LET(Not, 2, Not - 1)", 1],
    ["=LET(Not, 2, Not = 1)", false],
    ["=LET(Not, 1, Not = 1)", true],
    ["=NOT(0) + 1", 2],
    ["=NOT (0) + 1", false],
  ])("preserves name expressions and distinguishes NOT spellings in %s", (formula, expected) => {
    expect(evaluateFormula(formula)).toBe(expected);
  });

  it.each<[string, boolean]>([
    ["=1 > 0 and 2 < 3", true],
    ["=TRUE or TRUE and FALSE", true],
    ["=not 2 > 1", false],
    ["=not not 2 > 1", true],
    ["=TRUE and (not FALSE or FALSE)", true],
    ["=NOT(FALSE) AND OR(FALSE, TRUE)", true],
  ])("evaluates %s", (formula, expected) => {
    expect(evaluateFormula(formula)).toBe(expected);
  });

  it.each([
    ['"text" and TRUE', 'AND("text", TRUE)'],
    ['"text" or FALSE', 'OR("text", FALSE)'],
    ['not "text"', 'NOT("text")'],
    ["2 and -1", "AND(2, -1)"],
    ["0 or A1", "OR(0, A1)"],
    ["not A1", "NOT(A1)"],
    ["A1:A3 and TRUE", "AND(A1:A3, TRUE)"],
    ["A1:A3 or FALSE", "OR(A1:A3, FALSE)"],
    ["not A1:A3", "NOT(A1:A3)"],
    ["#REF! and #N/A", "AND(#REF!, #N/A)"],
    ["not #N/A", "NOT(#N/A)"],
  ])("matches built-in coercion and errors for %s", (expression, call) => {
    expect(evaluateFormula(`=${expression}`)).toEqual(evaluateFormula(`=${call}`));
  });

  it("short-circuits operators but leaves AND and OR functions eager", () => {
    expect(evaluateFormula("=FALSE and 1/0")).toBe(false);
    expect(evaluateFormula("=TRUE or 1/0")).toBe(true);
    expect(evaluateFormula("=TRUE and 1/0")).toEqual(evaluateFormula("=1/0"));
    expect(evaluateFormula("=FALSE or 1/0")).toEqual(evaluateFormula("=1/0"));
    expect(evaluateFormula("=AND(FALSE, 1/0)")).toEqual(evaluateFormula("=1/0"));
    expect(evaluateFormula("=OR(TRUE, 1/0)")).toEqual(evaluateFormula("=1/0"));

    const workbook = workbookWith({
      t1: { A1: "20", B1: "0", C1: "=B1 <> 0 and A1 / B1 > 2" },
    });
    expect(workbook.getValue(at("C1"))).toBe(false);
    workbook.setCell(at("B1"), "5");
    expect(workbook.getValue(at("C1"))).toBe(true);
  });

  it("reads whole ranges as AND and OR do, and tracks dependencies", () => {
    const workbook = workbookWith({
      t1: { A1: "TRUE", A2: "FALSE", B1: "=A1:A2 and TRUE", B2: "=not A1 or A2" },
    });
    expect(workbook.getValue(at("B1"))).toBe(false);
    expect(workbook.getValue(at("B2"))).toBe(false);
    workbook.setCell(at("A2"), "TRUE");
    expect(workbook.getValue(at("B1"))).toBe(true);
    expect(workbook.getValue(at("B2"))).toBe(true);
  });

  it("does not allow bindings to override operators", () => {
    expect(evaluateFormula("=LET(AND, LAMBDA(x, y, FALSE), TRUE and TRUE)")).toBe(true);
    expect(evaluateFormula("=LET(OR, LAMBDA(x, y, FALSE), TRUE or FALSE)")).toBe(true);
    expect(evaluateFormula("=LET(NOT, LAMBDA(x, FALSE), not FALSE)")).toBe(true);
    expect(evaluateFormula("=LET(and, TRUE, or, FALSE, not, TRUE, and and ('not' or or))")).toBe(
      true,
    );
  });

  it("tracks every cell of a whole-column boolean operand", () => {
    const workbook = workbookWith({
      t1: {
        A1: "TRUE",
        A2: "FALSE",
        B1: "=A:A and TRUE",
        C1: "=A:A or FALSE",
        D1: "=AND(A:A, TRUE)",
        E1: "=OR(A:A, FALSE)",
      },
    });
    expect(workbook.getValue(at("B1"))).toEqual(workbook.getValue(at("D1")));
    expect(workbook.getValue(at("C1"))).toEqual(workbook.getValue(at("E1")));
    workbook.setCell(at("A1"), "FALSE");
    expect(workbook.getValue(at("C1"))).toBe(false);
    workbook.setCell(at("A2"), "TRUE");
    expect(workbook.getValue(at("C1"))).toBe(true);
    workbook.setCell(at("A1"), "TRUE");
    expect(workbook.getValue(at("B1"))).toBe(true);
  });
});
