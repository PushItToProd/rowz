import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../testing";

const CELLS = {
  A1: "-1000",
  A2: "300",
  A3: "420",
  A4: "680",
  B1: "1",
  B2: "2",
  B3: "3",
  C1: "3",
  C2: "5",
  C3: "7",
};

describe("loans and savings", () => {
  // A 20,000 loan at 5% a year over 60 months costs 377.42 a month.
  it.each<[string, number]>([
    ["=PMT(0.05 / 12, 60, 20000)", -377.42],
    ["=PMT(0.05 / 12, 60, 20000, 0, 1)", -375.86],
    ["=PMT(0, 10, 1000)", -100],
    ["=PMT(0.05 / 12, 60, 0, 10000)", -147.05],
    ["=FV(0.04 / 12, 120, -100)", 14724.98],
    ["=FV(0, 12, -100, -500)", 1700],
    ["=FV(0.05, 10, 0, -1000)", 1628.89],
    ["=PV(0.05 / 12, 60, -377.42)", 19999.75],
    ["=PV(0, 10, -100)", 1000],
    ["=PV(0.05, 10, 0, 1628.89)", -1000],
    ["=NPER(0.05 / 12, -377.42, 20000)", 60],
    ["=NPER(0, -100, 1000)", 10],
    ["=RATE(60, -377.42, 20000) * 12", 0.05],
    ["=RATE(10, 0, -1000, 1628.89)", 0.05],
    ["=NPV(0.1, 100, 100, 100)", 248.69],
    ["=NPV(0.08, A2:A4) + A1", 177.67],
    ["=IRR(A1:A4)", 0.1634],
    ["=IRR(VSTACK(-100, 60, 60))", 0.1307],
    ["=IRR(VSTACK(-100, 110))", 0.1],
  ])("%s is about %d", (formula, expected) => {
    expect(evaluateFormula(formula, CELLS)).toBeCloseTo(expected, 2);
  });

  it("gives back the loan when its payment is put into PV, and the payment from FV of zero", () => {
    expect(evaluateFormula("=PV(0.01, 24, PMT(0.01, 24, 5000))")).toBeCloseTo(5000, 6);
    expect(evaluateFormula("=FV(0.01, 24, PMT(0.01, 24, 5000), 5000)")).toBeCloseTo(0, 6);
  });

  it.each([
    ["=PMT(0.05, 0, 1000)", "#VALUE!"],
    ["=NPER(0, 0, 1000)", "#DIV/0!"],
    ["=NPER(0.1, -10, 1000)", "#VALUE!"],
    ["=RATE(0, -100, 1000)", "#VALUE!"],
    ["=NPV(-1, 100)", "#DIV/0!"],
    ["=IRR(A2:A4)", "#VALUE!"],
    ["=IRR(B1:B3)", "#VALUE!"],
    ['=PMT("x", 1, 1)', "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expect(evaluateFormula(formula, CELLS), formula).toMatchObject({ kind: "error", code });
  });
});

describe("angles", () => {
  it.each<[string, number]>([
    ["=SIN(PI() / 2)", 1],
    ["=COS(PI())", -1],
    ["=TAN(PI() / 4)", 1],
    ["=DEGREES(ASIN(1))", 90],
    ["=DEGREES(ACOS(0.5))", 60],
    ["=DEGREES(ATAN(1))", 45],
    ["=SINH(0)", 0],
    ["=COSH(0)", 1],
    ["=TANH(100)", 1],
    ["=DEGREES(PI())", 180],
    ["=RADIANS(180)", Math.PI],
  ])("%s is about %d", (formula, expected) => {
    expect(evaluateFormula(formula)).toBeCloseTo(expected, 10);
  });

  it.each(["=ASIN(1.5)", "=ACOS(-2)", "=SINH(1000)"])("%s is #VALUE!", (formula) => {
    expect(evaluateFormula(formula)).toMatchObject({ code: "#VALUE!" });
  });
});

describe("fitting a line", () => {
  // C is 2 * B + 1.
  it.each<[string, number]>([
    ["=SLOPE(C1:C3, B1:B3)", 2],
    ["=INTERCEPT(C1:C3, B1:B3)", 1],
    ["=FORECAST(10, C1:C3, B1:B3)", 21],
    ["=SLOPE(B1:B3, C1:C3)", 0.5],
    ["=COVARIANCE_S(B1:B3, C1:C3)", 2],
    ["=COVARIANCE_P(B1:B3, C1:C3)", 4 / 3],
  ])("%s is about %d", (formula, expected) => {
    expect(evaluateFormula(formula, CELLS)).toBeCloseTo(expected, 10);
  });

  it.each([
    ["=SLOPE(C1:C3, B1:B2)", "#VALUE!"],
    ["=SLOPE(C1:C1, B1:B1)", "#DIV/0!"],
    ["=SLOPE(C1:C2, VSTACK(4, 4))", "#DIV/0!"],
    ["=COVARIANCE_S(B1:B1, C1:C1)", "#DIV/0!"],
  ])("%s is %s", (formula, code) => {
    expect(evaluateFormula(formula, CELLS), formula).toMatchObject({ kind: "error", code });
  });
});
