import { describe, expect, it } from "vitest";
import { parseDate } from "./dates";
import { evaluateFormula } from "./testing";
import { formatValue, isError, isRange, type CellValue } from "./values";

function message(value: CellValue): string | undefined {
  return isError(value) ? value.message : undefined;
}

describe("results that a cell cannot hold", () => {
  it.each([
    ["=FACT(170)", "7.2574156153080e+306"],
    ["=FACT(171)", "#VALUE!"],
    // Counting down from here never reaches 1, because 1e16 - 1 is 1e16.
    ["=FACT(1e16)", "#VALUE!"],
    ["=FACT(1e300)", "#VALUE!"],
  ])("%s is %s", (formula, shown) => {
    const value = evaluateFormula(formula);
    expect(typeof value === "number" ? value.toExponential(13) : formatValue(value)).toBe(shown);
  });

  it.each([
    "=SUM(1e308, 1e308)",
    "=PRODUCT(1e308, 10)",
    "=AVERAGE(1e308, 1e308)",
    "=SUMPRODUCT(A1:A2, A1:A2)",
    "=EXP(1000)",
    "=SQRT(-1)",
  ])("%s is an error and not infinity", (formula) => {
    const value = evaluateFormula(formula, { A1: "1e200", A2: "1e200" });
    expect(message(value)).toBe("The result is not a number");
  });

  it("makes an error of each cell of an array that is not finite", () => {
    expect(evaluateFormula("=ROWS(SEQUENCE(2, 1, 1e308, 1e308))")).toBe(2);
    expect(formatValue(evaluateFormula("=INDEX(SEQUENCE(2, 1, 1e308, 1e308), 1)"))).toBe("1e+308");
    expect(formatValue(evaluateFormula("=INDEX(SEQUENCE(2, 1, 1e308, 1e308), 2)"))).toBe("#VALUE!");
  });

  it.each([
    ['=TEXT(1, "0." & REPT("0", 101))', "A format can show at most 100 decimals"],
    ['=TEXT(1e308, "0%")', "The number is too large to show as a percentage"],
    ['=REPT("x", 1e10)', "The result is too large to compute"],
    ['=LEN(REPT(REPT("x", 1e5), 1e5))', "The result is too large to compute"],
  ])("%s is an error", (formula, why) => {
    expect(message(evaluateFormula(formula))).toBe(why);
  });

  it("does not write infinity for a number too large to round at the format's decimals", () => {
    expect(evaluateFormula('=TEXT(1e300, "0." & REPT("0", 100))')).not.toContain("Infinity");
  });
});

describe("arrays larger than the largest table", () => {
  const TOO_LARGE = "An array can hold at most 100,000 cells";

  it.each([
    "=SEQUENCE(100001)",
    "=SEQUENCE(1e200, 1e200)",
    "=ROWS(VSTACK(SEQUENCE(60000), SEQUENCE(60000)))",
    "=COLUMNS(HSTACK(SEQUENCE(1, 60000), SEQUENCE(1, 60000)))",
    // The shorter one is padded to the height of the taller.
    "=ROWS(HSTACK(SEQUENCE(60000), 1))",
    "=COLUMNS(VSTACK(SEQUENCE(1, 60000), 1))",
    "=ROWS(FLATTEN(SEQUENCE(60000), SEQUENCE(60000)))",
    "=ROWS(LET(a, SEQUENCE(100000), VSTACK(a, a, a, a, a, a, a, a, a, a)))",
    // A column and a row pair into a cell for each combination.
    "=ROWS(SEQUENCE(1000) + SEQUENCE(1, 1000))",
    "=ROWS(-SEQUENCE(1000) = SEQUENCE(1, 101))",
    '=COLUMNS(SPLIT(REPT("a,", 100000), ","))',
    '=ROWS(QUERY(SEQUENCE(50000), "select A, A, A"))',
    '=ROWS(QUERY(SEQUENCE(50000), "select A, sum(A), count(A), max(A) group by A"))',
    '=ROWS(QUERY(HSTACK(SEQUENCE(400), SEQUENCE(400)), "select A, sum(B) group by A pivot B"))',
  ])("%s is an error", (formula) => {
    expect(message(evaluateFormula(formula))).toBe(TOO_LARGE);
  });

  it.each([
    ["=ROWS(SEQUENCE(100000))", 100000],
    ["=ROWS(VSTACK(SEQUENCE(50000), SEQUENCE(50000)))", 100000],
    ["=COLUMNS(HSTACK(SEQUENCE(1, 50000), SEQUENCE(1, 50000)))", 100000],
    ["=ROWS(FLATTEN(SEQUENCE(250, 200), SEQUENCE(250, 200)))", 100000],
    ["=SUM(SEQUENCE(1000) * SEQUENCE(1, 100))", 2527525000],
    ['=COLUMNS(SPLIT(REPT("a,", 99999), ","))', 100000],
    ['=ROWS(QUERY(SEQUENCE(50000), "select A, A, A limit 10"))', 10],
  ])("%s is %d", (formula, value) => {
    expect(evaluateFormula(formula)).toBe(value);
  });
});

describe("dates outside the calendar", () => {
  it.each([
    "=DATE(10000, 1, 1)",
    "=DATE(-1, 12, 31)",
    "=DATE(300000, 1, 1)",
    "=YEAR(DATE(300000, 1, 1))",
    "=DATE(2020, 1, 1) + 1e300",
    "=DATE(2020, 1, 1) - 1e7",
    "=EDATE(DATE(9999, 12, 1), 1)",
    "=MAX(DATE(9999, 12, 31)) + 1",
  ])("%s is an error", (formula) => {
    expect(message(evaluateFormula(formula))).toBe("The date is outside the years 0 to 9999");
  });

  it.each([
    ["=DATE(0, 1, 1)", "0000-01-01"],
    ["=DATE(9999, 12, 31)", "9999-12-31"],
  ])("%s is the date %s", (formula, shown) => {
    expect(formatValue(evaluateFormula(formula))).toBe(shown);
  });

  it("reads text that carries past the last year as text", () => {
    expect(parseDate("9999-12-32")).toBeUndefined();
    expect(parseDate("9999-12-31 23:59:59")).toBeDefined();
  });
});

describe("telling numbers apart", () => {
  const cells = {
    A1: "1",
    A2: "1.0000000000000002",
    A3: "=0",
    A4: "=-0",
    A5: "0.1",
    A6: "=0.3-0.2",
  };

  it("counts numbers that differ only in the last digit as different", () => {
    expect(evaluateFormula("=A1=A2", cells)).toBe(false);
    expect(evaluateFormula("=COUNTUNIQUE(A1:A2)", cells)).toBe(2);
    expect(evaluateFormula("=ROWS(UNIQUE(A1:A2))", cells)).toBe(2);
    // 0.3 - 0.2 is not quite 0.1, though both show as 0.1.
    expect(evaluateFormula("=A5=A6", cells)).toBe(false);
    expect(evaluateFormula("=COUNTUNIQUE(A5:A6)", cells)).toBe(2);
  });

  it("counts 0 and -0 as one number", () => {
    expect(evaluateFormula("=COUNTUNIQUE(A3:A4)", cells)).toBe(1);
    const unique = evaluateFormula("=ROWS(UNIQUE(A3:A4))", cells);
    expect(isRange(unique) ? unique.rows.length : unique).toBe(1);
  });
});
