import { describe, expect, it } from "vitest";
import { defaultFunctions } from "./functions";
import type { FunctionRegistry, PureFunction } from "./functions/registry";
import { at, evaluateFormula, STRUCTURE, workbookWith } from "./testing";
import { Workbook } from "./workbook";

function evaluateArray(formula: string) {
  const workbook = workbookWith({ t1: { Z99: formula } });
  return workbook.getArray(at("Z99"));
}

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

  it("short-circuits the operators and AND and OR functions", () => {
    expect(evaluateFormula("=FALSE and 1/0")).toBe(false);
    expect(evaluateFormula("=TRUE or 1/0")).toBe(true);
    expect(evaluateFormula("=TRUE and 1/0")).toEqual(evaluateFormula("=1/0"));
    expect(evaluateFormula("=FALSE or 1/0")).toEqual(evaluateFormula("=1/0"));
    expect(evaluateFormula("=AND(FALSE, 1/0)")).toBe(false);
    expect(evaluateFormula("=OR(TRUE, 1/0)")).toBe(true);
    expect(evaluateFormula("=AND(TRUE, 1/0)")).toEqual(evaluateFormula("=1/0"));
    expect(evaluateFormula("=OR(FALSE, 1/0)")).toEqual(evaluateFormula("=1/0"));
    expect(evaluateFormula("=ALL(FALSE, 1/0)")).toEqual(evaluateFormula("=1/0"));
    expect(evaluateFormula("=ANY(TRUE, 1/0)")).toEqual(evaluateFormula("=1/0"));

    const workbook = workbookWith({
      t1: {
        A1: "20",
        B1: "0",
        C1: "=B1 <> 0 and A1 / B1 > 2",
        D1: "=AND(B1 <> 0, A1 / B1 > 2)",
      },
    });
    expect(workbook.getValue(at("C1"))).toBe(false);
    expect(workbook.getValue(at("D1"))).toBe(false);
    workbook.setCell(at("B1"), "5");
    expect(workbook.getValue(at("C1"))).toBe(true);
    expect(workbook.getValue(at("D1"))).toBe(true);
  });

  it("does not call a later argument after AND or OR decides the result", () => {
    let calls = 0;
    const probe: PureFunction = {
      kind: "pure",
      minArgs: 0,
      maxArgs: 0,
      callableAsValue: true,
      call() {
        calls += 1;
        return true;
      },
    };
    const functions: FunctionRegistry = new Map([...defaultFunctions, ["PROBE", probe]]);
    const workbook = new Workbook({ functions });
    workbook.setStructure(STRUCTURE);
    workbook.setCell(at("A1"), "=AND(FALSE, PROBE())");
    workbook.setCell(at("A2"), "=OR(TRUE, PROBE())");

    expect(workbook.getValue(at("A1"))).toBe(false);
    expect(workbook.getValue(at("A2"))).toBe(true);
    expect(calls).toBe(0);
  });

  it("uses AND and OR as built-in values and inside LAMBDAs", () => {
    const matrix = "VSTACK(HSTACK(TRUE, FALSE), HSTACK(TRUE, TRUE))";
    expect(evaluateArray(`=BYROW(${matrix}, AND)`)).toEqual([[false], [true]]);
    expect(evaluateArray("=MAP(HSTACK(TRUE, FALSE), OR)")).toEqual([[true, false]]);
    expect(evaluateArray(`=BYCOL(${matrix}, AND)`)).toEqual([[true, false]]);
    expect(evaluateArray(`=BYCOL(${matrix}, OR)`)).toEqual([[true, true]]);
    expect(evaluateArray("=REDUCE(TRUE, HSTACK(TRUE, FALSE), AND)")).toEqual([[false]]);
    expect(evaluateArray("=REDUCE(FALSE, HSTACK(TRUE, FALSE), OR)")).toEqual([[true]]);
    expect(evaluateArray(`=BYROW(${matrix}, LAMBDA(row, AND(row, FALSE, 1/0)))`)).toEqual([
      [false],
      [false],
    ]);
    expect(evaluateArray(`=MAP(${matrix}, LAMBDA(value, OR(value, TRUE, 1/0)))`)).toEqual([
      [true, true],
      [true, true],
    ]);
  });

  it("keeps range and array handling for AND, OR, ALL, and ANY", () => {
    const cells = { A1: "TRUE", A2: "FALSE", A3: "1" };
    expect(evaluateFormula("=AND(A1:A3)", cells)).toBe(false);
    expect(evaluateFormula("=OR(A1:A3)", cells)).toBe(true);
    expect(evaluateFormula("=ALL(A1:A3)", cells)).toBe(false);
    expect(evaluateFormula("=ANY(A2:A3)", cells)).toBe(false);

    expect(evaluateFormula("=AND(HSTACK(TRUE, FALSE))")).toBe(false);
    expect(evaluateFormula("=OR(HSTACK(FALSE, TRUE))")).toBe(true);
    expect(evaluateFormula("=ALL(HSTACK(TRUE, FALSE))")).toBe(false);
    expect(evaluateFormula("=ANY(HSTACK(FALSE, TRUE))")).toBe(true);
    expect(evaluateFormula('=ALL("true", 1)')).toBe(true);
    expect(evaluateFormula('=ANY("true", 0)')).toBe(true);

    // An evaluated range or array still propagates errors anywhere inside it.
    expect(evaluateFormula("=AND(HSTACK(FALSE, 1/0))")).toEqual(evaluateFormula("=1/0"));
  });

  it("tracks references in skipped arguments and recalculates when they change", () => {
    let calls = 0;
    const probe: PureFunction = {
      kind: "pure",
      minArgs: 0,
      maxArgs: 0,
      callableAsValue: true,
      call() {
        calls += 1;
        return false;
      },
    };
    const functions: FunctionRegistry = new Map([...defaultFunctions, ["PROBE", probe]]);
    const workbook = new Workbook({ functions });
    workbook.setStructure(STRUCTURE);
    workbook.setCell(at("A1"), "TRUE");
    workbook.setCell(at("B1"), "=AND(PROBE(), A1)");

    expect(workbook.getValue(at("B1"))).toBe(false);
    expect(calls).toBe(1);
    workbook.setCell(at("A1"), "FALSE");
    expect(workbook.getValue(at("B1"))).toBe(false);
    expect(calls).toBe(2);
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
        F1: "=ALL(A:A, TRUE)",
        G1: "=ANY(A:A, FALSE)",
      },
    });
    expect(workbook.getValue(at("B1"))).toEqual(workbook.getValue(at("D1")));
    expect(workbook.getValue(at("C1"))).toEqual(workbook.getValue(at("E1")));
    expect(workbook.getValue(at("D1"))).toBe(false);
    expect(workbook.getValue(at("E1"))).toBe(true);
    expect(workbook.getValue(at("F1"))).toBe(false);
    expect(workbook.getValue(at("G1"))).toBe(true);
    workbook.setCell(at("A1"), "FALSE");
    expect(workbook.getValue(at("C1"))).toBe(false);
    workbook.setCell(at("A2"), "TRUE");
    expect(workbook.getValue(at("C1"))).toBe(true);
    workbook.setCell(at("A1"), "TRUE");
    expect(workbook.getValue(at("B1"))).toBe(true);
    expect(workbook.getValue(at("D1"))).toBe(true);
    expect(workbook.getValue(at("F1"))).toBe(true);
    expect(workbook.getValue(at("G1"))).toBe(true);
  });
});
