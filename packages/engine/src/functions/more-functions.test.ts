import { describe, expect, it } from "vitest";
import { at, evaluateFormula, workbookWith } from "../testing";
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
    ['=TEXT(1234.5, "#,##0.00")', "1,234.50"],
    ['=TEXT(1e21, "#,##0.00")', "1,000,000,000,000,000,000,000.00"],
    ['=TEXT(9007199254740993, "#,##0")', "9,007,199,254,740,992"],
    ['=TEXT(A1 / A3, "0.0%")', "33.3%"],
    ['=TEXT(A2, "$0.00")', "$2.00"],
    ['=TEXT("already text", "0.00")', "already text"],
    ['=TEXT(TRUE, "0.00")', "TRUE"],
    ['=TEXT(B9, "0.00")', ""],
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
    ['=TEXT(5, "no digits")', "#VALUE!"],
    ['=TEXT(1/0, "0")', "#DIV/0!"],
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
    ["=ISERROR(nope)", true],
    ["=ISERROR(A1)", false],
    ["=ISNUMBER(1/0)", false],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, { A1: "1", A2: "2" })).toBe(expected);
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
  const lookupCells = {
    ...cells,
    I1: "10",
    J1: "20",
    K1: "30",
    I2: "one",
    J2: "two",
    K2: "three",
    L1: "10",
    M1: "20",
    L2: "30",
    M2: "40",
    L3: "50",
    M3: "60",
    N1: "first",
    O1: "second",
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
    ["=LOOKUP(25, A1:A3, B1:B3)", "twenty"],
    ["=LOOKUP(25, A1:A3)", 20],
    ["=LOOKUP(25, A1:C3)", 2.5],
    ["=LOOKUP(25, I1:K1, I2:K2)", "two"],
    ["=LOOKUP(25, I1:K2)", "two"],
    ["=LOOKUP(35, L1:M3)", 40],
    ["=LOOKUP(25, L1:M3, N1:O1)", "second"],
    ["=VLOOKUP(20, A1:C3, 2, FALSE)", "twenty"],
    ["=VLOOKUP(20, A1:C3, 3, FALSE)", 2.5],
    ["=VLOOKUP(25, A1:C3, 2)", "twenty"],
    ["=VLOOKUP(25, A1:C3, 2, TRUE)", "twenty"],
    ["=VLOOKUP(99, A1:C3, 1)", 30],
    ["=HLOOKUP(20, TRANSPOSE(A1:C3), 2, FALSE)", "twenty"],
    ["=HLOOKUP(25, TRANSPOSE(A1:C3), 2)", "twenty"],
    ["=XLOOKUP(30, A1:A3, B1:B3)", "thirty"],
    ['=XLOOKUP("fig", E1:G1, E2:G2)', 10],
    ['=XLOOKUP(99, A1:A3, B1:B3, "none")', "none"],
    ["=XLOOKUP(10, A1:A3, B1:B3, 1/0)", "ten"],
    ["=XLOOKUP(20, A1:A3, D1:D3)", null],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, lookupCells)).toBe(expected);
  });

  it("finds the intersection of exact row and column keys with XYLOOKUP", () => {
    const xyCells = {
      A1: "",
      B1: "Q1",
      C1: "Q2",
      A2: "East",
      B2: "10",
      C2: "20",
      A3: "West",
      B3: "30",
      C3: "40",
    };
    expect(evaluateFormula('=XYLOOKUP("West", "Q2", A1:C3)', xyCells)).toBe(40);
    expect(evaluateFormula('=XYLOOKUP("WEST", "q1", A1:C3)', xyCells)).toBe(30);
  });

  it("takes a whole row or column with INDEX when a position is left out or 0", () => {
    const rows = (formula: string): CellValue[][] =>
      workbookWith({ t1: { ...cells, I1: formula } }).getArray(at("I1"));
    expect(rows("=INDEX(A1:C3, 2)")).toEqual([[20, "twenty", 2.5]]);
    expect(rows("=INDEX(A1:C3, 2, 0)")).toEqual([[20, "twenty", 2.5]]);
    expect(rows("=INDEX(A1:C3, 0, 2)")).toEqual([["ten"], ["twenty"], ["thirty"]]);
    expect(rows("=INDEX(A1:B2, 0, 0)")).toEqual([
      [10, "ten"],
      [20, "twenty"],
    ]);
    expect(rows("=SUM(INDEX(A1:C3, 0, 1))")).toEqual([[60]]);
  });

  it("gives a whole row or column with XLOOKUP when the results are wider than the keys", () => {
    const rows = (formula: string): CellValue[][] =>
      workbookWith({ t1: { ...cells, I1: formula } }).getArray(at("I1"));
    expect(rows("=XLOOKUP(20, A1:A3, B1:C3)")).toEqual([["twenty", 2.5]]);
    expect(rows('=XLOOKUP("plum", E1:G1, E1:G2)')).toEqual([["plum"], [20]]);
    expect(rows('=XLOOKUP(99, A1:A3, B1:C3, "none")')).toEqual([["none"]]);
  });

  it.each([
    ["=MATCH(15, A1:A3, 0)", "#N/A"],
    ["=MATCH(5, A1:A3)", "#N/A"],
    ['=MATCH("20", A1:A3, 0)', "#N/A"],
    ["=MATCH(20, A1:C3, 0)", "#VALUE!"],
    ["=LOOKUP(5, A1:A3)", "#N/A"],
    ["=LOOKUP(25, A1:A3, B1:B2)", "#VALUE!"],
    ["=LOOKUP(25, A1:A3, B1:C3)", "#VALUE!"],
    ["=INDEX(A1:C3, 4, 1)", "#REF!"],
    ["=INDEX(A1:C3, 1, 4)", "#REF!"],
    ["=INDEX(A1:C3, -1, 1)", "#VALUE!"],
    ["=VLOOKUP(15, A1:C3, 2, FALSE)", "#N/A"],
    ["=VLOOKUP(5, A1:C3, 2)", "#N/A"],
    ["=VLOOKUP(20, A1:C3, 4, FALSE)", "#REF!"],
    ["=VLOOKUP(20, A1:C3, 0, FALSE)", "#VALUE!"],
    ["=HLOOKUP(20, TRANSPOSE(A1:C3), 0, FALSE)", "#VALUE!"],
    ["=HLOOKUP(20, TRANSPOSE(A1:C3), 4, FALSE)", "#REF!"],
    ["=HLOOKUP(5, TRANSPOSE(A1:C3), 2)", "#N/A"],
    ["=XLOOKUP(99, A1:A3, B1:B3)", "#N/A"],
    ["=XLOOKUP(10, A1:A3, B1:B2)", "#VALUE!"],
    ["=XLOOKUP(10, A1:C3, B1:B3)", "#VALUE!"],
    ["=XLOOKUP(99, A1:A3, B1:B3, 1/0)", "#DIV/0!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code, lookupCells);
  });

  it.each([
    ['=XYLOOKUP("missing", "Q1", A1:C3)', "#N/A"],
    ['=XYLOOKUP("East", "missing", A1:C3)', "#N/A"],
    ['=XYLOOKUP("East", "Q1", A1:A3)', "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code, {
      A1: "",
      B1: "Q1",
      C1: "Q2",
      A2: "East",
      B2: "10",
      C2: "20",
      A3: "West",
      B3: "30",
      C3: "40",
    });
  });
});

describe("more math", () => {
  const cells = { A1: "1", A2: "2", A3: "3", B1: "4", B2: "x", B3: "6", C1: "a", C2: "b", C3: "a" };

  it.each<[string, CellValue]>([
    ["=SUMPRODUCT(A1:A3, B1:B3)", 22],
    ["=SUMPRODUCT(A1:A3)", 6],
    ["=SUMPRODUCT(A1:A3, A1:A3, A1:A3)", 36],
    ["=TRUNC(2.78)", 2],
    ["=TRUNC(-2.78)", -2],
    ["=TRUNC(2.78, 1)", 2.7],
    ["=SIGN(-4)", -1],
    ["=SIGN(0)", 0],
    ["=MROUND(17, 5)", 15],
    ["=MROUND(18, 5)", 20],
    ["=MROUND(7.5, 5)", 10],
    ["=MROUND(4, 0)", 0],
    ["=QUOTIENT(7, 2)", 3],
    ["=QUOTIENT(-7, 2)", -3],
    ["=EXP(0)", 1],
    ["=LN(EXP(2))", 2],
    ["=LOG(1000)", 3],
    ["=LOG(8, 2)", 3],
    ["=ROUND(PI(), 5)", 3.14159],
    ["=EVEN(3)", 4],
    ["=EVEN(2)", 2],
    ["=EVEN(-1.5)", -2],
    ["=EVEN(0)", 0],
    ["=ODD(4)", 5],
    ["=ODD(3)", 3],
    ["=ODD(-2)", -3],
    ["=ODD(0)", 1],
    ["=ISEVEN(4)", true],
    ["=ISEVEN(-3)", false],
    ["=ISEVEN(2.9)", true],
    ["=ISODD(3)", true],
    ["=ISODD(-3)", true],
    ["=GCD(12, 18)", 6],
    ["=GCD(A1:A3)", 1],
    ["=GCD(0, 5)", 5],
    ["=LCM(4, 6)", 12],
    ["=LCM(A1:A3)", 6],
    ["=LCM(3, 0)", 0],
    ["=FACT(5)", 120],
    ["=FACT(0)", 1],
    ['=MAXIFS(A1:A3, C1:C3, "a")', 3],
    ['=MINIFS(A1:A3, C1:C3, "a")', 1],
    ['=MAXIFS(B1:B3, C1:C3, "a", A1:A3, "<3")', 4],
    ['=MAXIFS(A1:A3, C1:C3, "none")', 0],
    ['=MINIFS(A1:A3, C1:C3, "none")', 0],
    ['=MAXIFS(0 - A1:A3, C1:C3, "a")', -1],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, cells)).toBe(expected);
  });

  it.each([
    ["=SUMPRODUCT(A1:A3, B1:B2)", "#VALUE!"],
    ["=QUOTIENT(1, 0)", "#DIV/0!"],
    ["=LN(0)", "#VALUE!"],
    ["=LOG(-1)", "#VALUE!"],
    ["=LOG(8, 1)", "#VALUE!"],
    ["=EXP(1000)", "#VALUE!"],
    ["=GCD(-4, 2)", "#VALUE!"],
    ["=FACT(-1)", "#VALUE!"],
    ["=FACT(200)", "#VALUE!"],
    ["=MAXIFS(A1:A3, C1:C3)", "#ERROR!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code, cells);
  });
});

describe("more text", () => {
  it.each<[string, CellValue]>([
    ['=CONCAT("a", 1, TRUE)', "a1TRUE"],
    ['=ISTEXT(MARKDOWN("**x**"))', false],
    ['=ISNONTEXT(BUTTON("Go", EXECUTE(1, A1)))', true],
    ["=ISBLANK(PIE_CHART(A1:A3))", false],
    ['=JOIN("-", A1:A3)', "1-2-3"],
    ['=JOIN(", ", "a", "", "b")', "a, , b"],
    ['=PROPER("ada LOVELACE")', "Ada Lovelace"],
    ['=PROPER("o\'neil-smith jr.")', "O'neil-Smith Jr."],
    ['=PROPER("élan vital")', "Élan Vital"],
    ['=PROPER("2nd place")', "2nd Place"],
    ["=CHAR(65)", "A"],
    ["=CHAR(128512)", "😀"],
    ['=CODE("A")', 65],
    ['=CODE("😀")', 128512],
    ['=ENCODEURL("a b&c/d?")', "a%20b%26c%2Fd%3F"],
    ['=SLICE("abcdef", 1, 4)', "bcd"],
    ['=SLICE("abcdef", -3)', "def"],
    ['=SLUGIFY("Crème brûlée: Foo & Bar!")', "creme-brulee-foo-bar"],
    ['=SLUGIFY("東京 カフェ")', "東京-カフェ"],
    ['=DECODEURL("a%20b%26c")', "a b&c"],
    ['=BASE64("hello")', "aGVsbG8="],
    ['=BASE64("café 😀")', "Y2Fmw6kg8J+YgA=="],
    ['=BASE64DECODE("Y2Fmw6kg8J+YgA==")', "café 😀"],
    ['=BASE64DECODE("Y2Fmw6k")', "café"],
    ['=DOMAIN("https://www.example.com:8443/a")', "www.example.com"],
    ['=RELATIVE_URL("https://example.com/a%20b?q=x#top")', "/a%20b?q=x#top"],
    ["=FIXED(1234.567)", "1,234.57"],
    ["=FIXED(1234.567, 0)", "1,235"],
    ["=FIXED(1234.567, 1, TRUE)", "1234.6"],
    ["=FIXED(-0.5, 3)", "-0.500"],
    ['=INDEX(SPLIT("a,b,c", ","), 2)', "b"],
    ['=SUM(SPLIT("1;2;3.5", ";"))', 6.5],
    ['=COLUMNS(SPLIT("a--b--c", "--"))', 3],
    ['=COLUMNS(SPLIT("abc", ","))', 1],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, { A1: "1", A2: "2", A3: "3" })).toBe(expected);
  });

  it.each([
    ['=SPLIT("abc", "")', "#VALUE!"],
    ['=SLICE("abc", "start")', "#VALUE!"],
    ['=DECODEURL("%ZZ")', "#VALUE!"],
    ['=BASE64DECODE("not base64!")', "#VALUE!"],
    ['=BASE64DECODE("////")', "#VALUE!"],
    ['=DOMAIN("/relative/path")', "#VALUE!"],
    ['=RELATIVE_URL("mailto:user@example.com")', "#VALUE!"],
    ['=MARKDOWN("a") & "b"', "#VALUE!"],
    ["=MARKDOWN(1/0)", "#DIV/0!"],
    ["=CHAR(0)", "#VALUE!"],
    ["=CHAR(1114112)", "#VALUE!"],
    ['=CODE("")', "#VALUE!"],
    ["=FIXED(1, -1)", "#VALUE!"],
    ['=FIXED("x")', "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code);
  });
});

describe("more lookups and information", () => {
  const cells = {
    A1: "id",
    B1: "name",
    C1: "qty",
    A2: "1",
    B2: "apple",
    C2: "5",
    A3: "2",
    B3: "pear",
    C3: "7",
  };

  it.each<[string, CellValue]>([
    ['=HLOOKUP("name", A1:C3, 2, FALSE)', "apple"],
    ['=HLOOKUP("QTY", A1:C3, 3, FALSE)', 7],
    ["=HLOOKUP(2, TRANSPOSE(A2:B3), 2)", "pear"],
    ["=ROW(B3)", 3],
    ["=COLUMN(B3)", 2],
    ["=ROW(B2:C3)", 2],
    ["=COLUMN(C:C)", 3],
    ["=ROW()", 99],
    ["=COLUMN()", 26],
    ["=ROW($C$3) + COLUMN($C$3)", 6],
    ['=IFNA(HLOOKUP("none", A1:C3, 2, FALSE), "missing")', "missing"],
    ['=IFNA("fine", "missing")', "fine"],
    ['=ISNA(HLOOKUP("none", A1:C3, 2, FALSE))', true],
    ["=ISNA(1/0)", false],
    ["=ISNA(1)", false],
    ["=ISERR(1/0)", true],
    ['=ISERR(HLOOKUP("none", A1:C3, 2, FALSE))', false],
    ["=ISERR(1)", false],
    ["=ISNONTEXT(A2)", true],
    ["=ISNONTEXT(B2)", false],
    ["=ISNONTEXT(Z1)", true],
    ["=ROWS(FLATTEN(A1:C3))", 9],
    ["=INDEX(FLATTEN(A1:C3), 4)", 1],
    ["=INDEX(FLATTEN(A2:A3, C2:C3), 3)", 5],
    ["=COLUMNS(FLATTEN(A1:C3))", 1],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, cells)).toBe(expected);
  });

  it.each([
    ['=HLOOKUP("none", A1:C3, 2, FALSE)', "#N/A"],
    ['=HLOOKUP("name", A1:C3, 4, FALSE)', "#REF!"],
    ['=HLOOKUP("name", A1:C3, 0, FALSE)', "#VALUE!"],
    ["=IFNA(1/0, 0)", "#DIV/0!"],
    ["=ROW(5)", "#VALUE!"],
    ["=ROW(Missing!A1)", "#REF!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code, cells);
  });
});

describe("MARKDOWN", () => {
  it("gives a value that holds the text to format, and shows as that text", () => {
    expect(evaluateFormula('=MARKDOWN("**" & A1 & "**")', { A1: "hi" })).toEqual({
      kind: "markdown",
      text: "**hi**",
    });
    expect(evaluateFormula("=MARKDOWN(12)")).toEqual({ kind: "markdown", text: "12" });
  });
});

describe("SUBTOTAL", () => {
  const values = { A1: "1", A2: "2", A3: "3" };
  const expected: readonly [number, number][] = [
    [1, 2],
    [2, 3],
    [3, 3],
    [4, 3],
    [5, 1],
    [6, 6],
    [7, 1],
    [8, Math.sqrt(2 / 3)],
    [9, 6],
    [10, 1],
    [11, 2 / 3],
  ];

  it.each(expected)("uses function code %i", (code, result) => {
    expect(evaluateFormula(`=SUBTOTAL(${String(code)}, A1:A3)`, values)).toBeCloseTo(result, 10);
    expect(evaluateFormula(`=SUBTOTAL(${String(code + 100)}, A1:A3)`, values)).toBeCloseTo(
      result,
      10,
    );
  });

  it("keeps the aggregate functions' handling of text, blanks, and errors", () => {
    const cells = { A1: "1", A2: "word", A3: "=1/0", A4: "" };
    expect(evaluateFormula("=SUBTOTAL(2, A1:A4)", cells)).toBe(1);
    expect(evaluateFormula("=SUBTOTAL(3, A1:A4)", cells)).toBe(3);
    expect(evaluateFormula("=SUBTOTAL(9, A1:A4)", cells)).toMatchObject({
      kind: "error",
      code: "#DIV/0!",
    });
  });

  it.each([0, 12, 100, 112, 1.5])("rejects unsupported function code %s", (code) => {
    expectError(`=SUBTOTAL(${String(code)}, A1:A3)`, "#VALUE!", values);
  });
});

describe("RANGE_CONTAINS", () => {
  const cells = { A1: "apple", A2: "1", A3: "'1", A4: "=1/0", A5: "" };

  it.each<[string, CellValue]>([
    ['=RANGE_CONTAINS(A1:A4, "APPLE")', true],
    ["=RANGE_CONTAINS(A1:A4, 1)", true],
    ['=RANGE_CONTAINS(A1:A4, "1")', true],
    ['=RANGE_CONTAINS(A2:A2, "1")', false],
    ['=RANGE_CONTAINS(A1:A4, "missing")', false],
    ["=RANGE_CONTAINS(A1:A5, A5)", false],
  ])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula, cells)).toBe(expected);
  });
});
