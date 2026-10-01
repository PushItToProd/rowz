import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../testing";
import type { CellValue } from "../values";

function expectError(formula: string, code: string, cells: Record<string, string> = {}): void {
  expect(evaluateFormula(formula, cells), formula).toMatchObject({ kind: "error", code });
}

describe("math", () => {
  it.each<[string, CellValue]>([
    ["=PRODUCT(2, 3, 4)", 24],
    ["=PRODUCT(A1:A3)", 6],
    ["=PRODUCT(B1:B3)", 1],
    ["=MEDIAN(3, 1, 2)", 2],
    ["=MEDIAN(4, 1, 2, 3)", 2.5],
    ["=MEDIAN(7)", 7],
    ["=MOD(7, 3)", 1],
    ["=MOD(-1, 3)", 2],
    ["=MOD(7, -3)", -2],
    ["=MOD(5.5, 2)", 1.5],
    ["=POWER(2, 10)", 1024],
    ["=SQRT(16)", 4],
    ["=INT(2.7)", 2],
    ["=INT(-2.1)", -3],
    ["=FLOOR(7.8)", 7],
    ["=FLOOR(17, 5)", 15],
    ["=FLOOR(-7.2)", -8],
    ["=CEILING(7.1)", 8],
    ["=CEILING(17, 5)", 20],
    ["=CEILING(7, 0)", 0],
    ["=ROUNDUP(2.01)", 3],
    ["=ROUNDUP(-2.01)", -3],
    ["=ROUNDUP(3.141, 2)", 3.15],
    ["=ROUNDDOWN(2.99)", 2],
    ["=ROUNDDOWN(-2.99)", -2],
    ["=ROUNDDOWN(1299, -2)", 1200],
    ["=ROUND(2.5, 0.9)", 3],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, { A1: "1", A2: "2", A3: "3" })).toBe(expected);
  });

  it.each([
    ["=MOD(1, 0)", "#DIV/0!"],
    ["=SQRT(-1)", "#VALUE!"],
    ["=POWER(10, 400)", "#VALUE!"],
    ["=MEDIAN(B1:B3)", "#VALUE!"],
    ['=INT("x")', "#VALUE!"],
    ["=FLOOR(1/0)", "#DIV/0!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code);
  });
});

describe("text", () => {
  it.each<[string, CellValue]>([
    ['=LEFT("hello")', "h"],
    ['=LEFT("hello", 3)', "hel"],
    ['=LEFT("hello", 0)', ""],
    ['=LEFT("hello", 99)', "hello"],
    ['=RIGHT("hello")', "o"],
    ['=RIGHT("hello", 3)', "llo"],
    ['=RIGHT("hello", 0)', ""],
    ['=MID("hello", 2, 3)', "ell"],
    ['=MID("hello", 4, 99)', "lo"],
    ['=MID("hello", 9, 2)', ""],
    ["=LEFT(12345, 2)", "12"],
    ['=FIND("l", "hello")', 3],
    ['=FIND("l", "hello", 4)', 4],
    ['=FIND("", "hello")', 1],
    ['=SEARCH("L", "hello")', 3],
    ['=SUBSTITUTE("a-b-c", "-", "+")', "a+b+c"],
    ['=SUBSTITUTE("abc", "", "x")', "abc"],
    ['=SUBSTITUTE("a.b", ".", "")', "ab"],
    ['=REPT("ab", 3)', "ababab"],
    ['=REPT("ab", 0)', ""],
    ['=TEXTJOIN(", ", TRUE, "a", "", "b")', "a, b"],
    ['=TEXTJOIN(", ", FALSE, "a", "", "b")', "a, , b"],
    ['=TEXTJOIN("-", TRUE, A1:A3, "end")', "1-2-3-end"],
    ['=VALUE("12.5")', 12.5],
    ['=VALUE(" 3 ")', 3],
    ["=VALUE(7)", 7],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, { A1: "1", A2: "2", A3: "3" })).toBe(expected);
  });

  it.each([
    ['=FIND("L", "hello")', "#VALUE!"],
    ['=FIND("l", "hello", 0)', "#VALUE!"],
    ['=LEFT("hello", -1)', "#VALUE!"],
    ['=MID("hello", 0, 2)', "#VALUE!"],
    ['=REPT("a", -1)', "#VALUE!"],
    ['=VALUE("twelve")', "#VALUE!"],
    ["=VALUE(TRUE)", "#VALUE!"],
    ['=TEXTJOIN(",", TRUE, 1/0)', "#DIV/0!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code);
  });
});

describe("logic and information", () => {
  it.each<[string, CellValue]>([
    ['=IFS(A1 > 5, "big", A1 > 0, "small")', "small"],
    ['=IFS(TRUE, "first", 1/0, "never evaluated")', "first"],
    ['=SWITCH(A1, 1, "one", 2, "two")', "one"],
    ['=SWITCH(A2, 1, "one", 2, "two", "other")', "two"],
    ['=SWITCH(9, 1, "one", "other")', "other"],
    ['=SWITCH("B", "a", 1, "b", 2)', 2],
    ['=SWITCH(1, 1, "hit", 1/0, "never evaluated")', "hit"],
    ["=ISBLANK(B9)", true],
    ["=ISBLANK(A1)", false],
    ['=ISBLANK("")', false],
    ["=ISNUMBER(A1)", true],
    ['=ISNUMBER("1")', false],
    ['=ISTEXT("1")', true],
    ["=ISTEXT(A1)", false],
    ["=ISLOGICAL(A1 > 0)", true],
    ["=ISLOGICAL(1)", false],
    ["=ISERROR(1/0)", true],
    ["=ISERROR(nope)", false],
    ["=ISERROR(A1)", false],
    ["=ISNUMBER(1/0)", false],
  ])("%s is %j", (formula, expected) => {
    const value = evaluateFormula(formula, { A1: "1", A2: "2" });
    // `=ISERROR(nope)` does not parse, so the cell itself is an error.
    if (formula.includes("nope")) expect(value).toMatchObject({ code: "#NAME?" });
    else expect(value).toBe(expected);
  });

  it.each([
    ['=IFS(FALSE, "a", 0, "b")', "#N/A"],
    ['=IFS(TRUE, "a", FALSE)', "#ERROR!"],
    ['=IFS("maybe", 1)', "#VALUE!"],
    ['=SWITCH(9, 1, "one", 2, "two")', "#N/A"],
    ['=SWITCH(1/0, 1, "one")', "#DIV/0!"],
    ["=ISBLANK(A1:A2)", "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code);
  });
});

describe("conditional aggregates", () => {
  // Rows: fruit, color, quantity, price.
  const cells = {
    A1: "apple",
    B1: "red",
    C1: "5",
    D1: "1.5",
    A2: "banana",
    B2: "yellow",
    C2: "12",
    D2: "0.5",
    A3: "Apple",
    B3: "green",
    C3: "8",
    D3: "2",
    A4: "cherry",
    B4: "red",
    C4: "40",
    D4: "9",
    A5: "",
    B5: "red",
    C5: "n/a",
    D5: "1",
    A6: "apricot",
    B6: "",
    C6: "3",
    D6: "=1/0",
  };

  it.each<[string, CellValue]>([
    ['=COUNTIF(A1:A6, "apple")', 2],
    ['=COUNTIF(A1:A6, "a*")', 3],
    ['=COUNTIF(A1:A6, "?pple")', 2],
    ['=COUNTIF(A1:A6, "<>apple")', 4],
    ['=COUNTIF(A1:A6, "")', 1],
    ['=COUNTIF(A1:A6, "<>")', 5],
    ["=COUNTIF(C1:C6, 12)", 1],
    ['=COUNTIF(C1:C6, ">5")', 3],
    ['=COUNTIF(C1:C6, ">=8")', 3],
    ['=COUNTIF(C1:C6, "<8")', 2],
    ['=COUNTIF(C1:C6, "<=5")', 2],
    ['=COUNTIF(C1:C6, "<>12")', 5],
    ['=COUNTIF(C1:C6, "=40")', 1],
    ['=COUNTIF(A1:A6, ">b")', 2],
    ["=COUNTIF(D1:D6, 1)", 1],
    ['=COUNTIF(A1:A6, "a.c")', 0],
    ['=SUMIF(A1:A6, "apple", C1:C6)', 13],
    ['=SUMIF(C1:C6, ">5")', 60],
    ['=SUMIF(B1:B6, "red", C1:C6)', 45],
    ['=SUMIF(B1:B6, "red", D1:D6)', 11.5],
    ['=SUMIF(A1:A6, "zzz", C1:C6)', 0],
    ['=AVERAGEIF(B1:B6, "red", C1:C6)', 22.5],
    ['=AVERAGEIF(C1:C6, "<10")', 5 + 1 / 3],
    ['=COUNTIFS(A1:A6, "a*", B1:B6, "red")', 1],
    ['=COUNTIFS(B1:B6, "red", C1:C6, ">5")', 1],
    ['=SUMIFS(C1:C6, B1:B6, "red", D1:D6, ">1")', 45],
    ['=SUMIFS(C1:C6, A1:A6, "apple", B1:B6, "green")', 8],
    ['=SUMIFS(C1:C6, A1:A6, "apple", B1:B6, "blue")', 0],
    ['=COUNTIF("apple", "a*")', 1],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, cells)).toBeCloseTo(expected as number, 10);
  });

  it.each([
    ['=AVERAGEIF(A1:A6, "zzz", C1:C6)', "#DIV/0!"],
    ['=COUNTIFS(A1:A6, "a*", B1:B6)', "#ERROR!"],
    ["=SUMIFS(C1:C6, A1:A6)", "#ERROR!"],
    ["=COUNTIF(A1:A6, 1/0)", "#DIV/0!"],
    ["=COUNTIF(A1:A6, A1:A2)", "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code, cells);
  });

  it("skips errors in the range being tested, and in the sum range where no row matches them", () => {
    expect(evaluateFormula('=COUNTIF(D1:D6, ">0")', cells)).toBe(5);
    expect(evaluateFormula('=SUMIF(B1:B6, "red", D1:D6)', cells)).toBe(11.5);
  });
});

describe("lookups", () => {
  // Sorted keys in column A with a label in B and a price in C.
  const cells = {
    A1: "10",
    B1: "ten",
    C1: "1.5",
    A2: "20",
    B2: "twenty",
    C2: "2.5",
    A3: "30",
    B3: "thirty",
    C3: "3.5",
    E1: "pear",
    F1: "plum",
    G1: "fig",
    E2: "30",
    F2: "20",
    G2: "10",
  };

  it.each<[string, CellValue]>([
    ["=MATCH(20, A1:A3, 0)", 2],
    ["=MATCH(25, A1:A3)", 2],
    ["=MATCH(25, A1:A3, 1)", 2],
    ["=MATCH(99, A1:A3)", 3],
    ["=MATCH(15, E2:G2, -1)", 2],
    ['=MATCH("PLUM", E1:G1, 0)', 2],
    ["=INDEX(B1:B3, 2)", "twenty"],
    ["=INDEX(E1:G1, 3)", "fig"],
    ["=INDEX(A1:C3, 2, 3)", 2.5],
    ["=INDEX(A1:C3, 3)", 30],
    ["=INDEX(A1:C3, 1, 1)", 10],
    ["=INDEX(B1:B3, MATCH(30, A1:A3, 0))", "thirty"],
    ["=VLOOKUP(20, A1:C3, 2, FALSE)", "twenty"],
    ["=VLOOKUP(20, A1:C3, 3, FALSE)", 2.5],
    ["=VLOOKUP(25, A1:C3, 2)", "twenty"],
    ["=VLOOKUP(25, A1:C3, 2, TRUE)", "twenty"],
    ["=VLOOKUP(99, A1:C3, 1)", 30],
    ["=XLOOKUP(30, A1:A3, B1:B3)", "thirty"],
    ['=XLOOKUP("fig", E1:G1, E2:G2)', 10],
    ['=XLOOKUP(99, A1:A3, B1:B3, "none")', "none"],
    ["=XLOOKUP(10, A1:A3, B1:B3, 1/0)", "ten"],
    ["=XLOOKUP(20, A1:A3, D1:D3)", null],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, cells)).toBe(expected);
  });

  it.each([
    ["=MATCH(15, A1:A3, 0)", "#N/A"],
    ["=MATCH(5, A1:A3)", "#N/A"],
    ['=MATCH("20", A1:A3, 0)', "#N/A"],
    ["=MATCH(20, A1:C3, 0)", "#VALUE!"],
    ["=INDEX(A1:C3, 4, 1)", "#REF!"],
    ["=INDEX(A1:C3, 1, 4)", "#REF!"],
    ["=INDEX(A1:C3, 0, 1)", "#VALUE!"],
    ["=VLOOKUP(15, A1:C3, 2, FALSE)", "#N/A"],
    ["=VLOOKUP(5, A1:C3, 2)", "#N/A"],
    ["=VLOOKUP(20, A1:C3, 4, FALSE)", "#REF!"],
    ["=VLOOKUP(20, A1:C3, 0, FALSE)", "#VALUE!"],
    ["=XLOOKUP(99, A1:A3, B1:B3)", "#N/A"],
    ["=XLOOKUP(10, A1:A3, B1:B2)", "#VALUE!"],
    ["=XLOOKUP(10, A1:C3, B1:B3)", "#VALUE!"],
    ["=XLOOKUP(99, A1:A3, B1:B3, 1/0)", "#DIV/0!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code, cells);
  });
});
