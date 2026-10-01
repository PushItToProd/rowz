import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../testing";
import type { CellValue } from "../values";

// A holds 2, 4, 4, 4, 5, 5, 7, 9: mean 5, population standard deviation 2.
const CELLS = {
  A1: "2",
  A2: "4",
  A3: "4",
  A4: "4",
  A5: "5",
  A6: "5",
  A7: "7",
  A8: "9",
  B1: "1",
  B2: "2",
  B3: "3",
  B4: "label",
  C1: "10",
  C2: "20",
  C3: "30",
  C4: "40",
  D1: "x",
  D2: "X",
  D3: "y",
  D5: "1",
  D6: "TRUE",
};

describe("statistics", () => {
  it.each<[string, CellValue]>([
    ["=STDEVP(A1:A8)", 2],
    ["=VAR_P(A1:A8)", 4],
    ["=ROUND(STDEV(A1:A8), 4)", 2.1381],
    ["=ROUND(VAR_S(A1:A8), 4)", 4.5714],
    ["=STDEV(1, 3)", Math.SQRT2],
    ["=VAR_P(5)", 0],
    ["=MODE(A1:A8)", 4],
    ["=MODE(3, 3, 1, 1)", 3],
    ["=PERCENTILE(A1:A8, 0)", 2],
    ["=PERCENTILE(A1:A8, 1)", 9],
    ["=PERCENTILE(A1:A8, 0.5)", 4.5],
    ["=PERCENTILE(B1:B3, 0.25)", 1.5],
    ["=QUARTILE(A1:A8, 2)", 4.5],
    ["=QUARTILE(B1:B4, 4)", 3],
    ["=RANK(9, A1:A8)", 1],
    ["=RANK(4, A1:A8)", 5],
    ["=RANK(4, A1:A8, TRUE)", 2],
    ["=CORREL(B1:B3, C1:C3)", 1],
    ["=ROUND(CORREL(B1:B4, C1:C4), 6)", 1],
    ["=COUNTUNIQUE(A1:A8)", 5],
    ["=COUNTUNIQUE(D1:D6)", 4],
    ['=COUNTUNIQUE(1, "1")', 2],
    ["=COUNTBLANK(D1:D6)", 1],
    ["=COUNTBLANK(A1:A8)", 0],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, CELLS)).toBe(expected);
  });

  it("gives a correlation of -1 for ranges that move in opposite directions", () => {
    expect(evaluateFormula("=CORREL(B1:B3, 0 - C1:C3)", CELLS)).toBeCloseTo(-1);
  });

  it.each([
    ["=STDEV(5)", "#DIV/0!"],
    ["=VAR_S(D1:D3)", "#DIV/0!"],
    ["=VAR_P(D1:D3)", "#DIV/0!"],
    ["=MODE(B1:B3)", "#N/A"],
    ["=PERCENTILE(A1:A8, 1.5)", "#VALUE!"],
    ["=PERCENTILE(D1:D3, 0.5)", "#VALUE!"],
    ["=QUARTILE(A1:A8, 1.5)", "#VALUE!"],
    ["=QUARTILE(A1:A8, 5)", "#VALUE!"],
    ["=RANK(3, A1:A8)", "#N/A"],
    ["=CORREL(B1:B3, C1:C4)", "#VALUE!"],
    ["=CORREL(B1:B1, C1:C1)", "#DIV/0!"],
    ["=CORREL(B1:B3, A2:A4)", "#DIV/0!"],
    ["=STDEV(A1:A8, 1/0)", "#DIV/0!"],
  ])("%s is %s", (formula, code) => {
    expect(evaluateFormula(formula, CELLS), formula).toMatchObject({ kind: "error", code });
  });
});
