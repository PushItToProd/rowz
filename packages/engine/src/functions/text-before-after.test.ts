import { describe, expect, it } from "vitest";
import { at, evaluateFormula, workbookWith } from "../testing";
import type { ErrorValue } from "../values";

function expectError(formula: string, code: ErrorValue["code"]): void {
  expect(evaluateFormula(formula), formula).toMatchObject({ kind: "error", code });
}

describe("TEXTBEFORE and TEXTAFTER", () => {
  it.each([
    ['=TEXTBEFORE("one::two::three", "::")', "one"],
    ['=TEXTBEFORE("one::two::three", "::", 2)', "one::two"],
    ['=TEXTBEFORE("one::two::three", "::", -1)', "one::two"],
    ['=TEXTBEFORE("one::two::three", "::", -2)', "one"],
    ['=TEXTAFTER("one::two::three", "::")', "two::three"],
    ['=TEXTAFTER("one::two::three", "::", 2)', "three"],
    ['=TEXTAFTER("one::two::three", "::", -1)', "three"],
    ['=TEXTAFTER("one::two::three", "::", -2)', "two::three"],
  ] as [string, string][])("%s returns %j", (formula, expected) => {
    expect(evaluateFormula(formula)).toBe(expected);
  });

  it("matches letter case by default and ignores it when match_mode is 1", () => {
    expectError('=TEXTBEFORE("aBAb", "ab")', "#N/A");
    expect(evaluateFormula('=TEXTBEFORE("aBAb", "ab", 1, 1)')).toBe("");
    expect(evaluateFormula('=TEXTAFTER("aBAb", "ab", 1, 1)')).toBe("Ab");
  });

  it("treats the end of the search direction as one delimiter when match_end is 1", () => {
    expect(evaluateFormula('=TEXTBEFORE("standalone", "/", 1, 0, 1)')).toBe("standalone");
    expect(evaluateFormula('=TEXTAFTER("standalone", "/", 1, 0, 1)')).toBe("");
    expect(evaluateFormula('=TEXTBEFORE("one/two", "/", 2, 0, 1)')).toBe("one/two");
    expect(evaluateFormula('=TEXTAFTER("one/two", "/", 2, 0, 1)')).toBe("");
    expect(evaluateFormula('=TEXTBEFORE("standalone", "/", -1, 0, 1)')).toBe("");
    expect(evaluateFormula('=TEXTAFTER("standalone", "/", -1, 0, 1)')).toBe("standalone");
    expect(evaluateFormula('=TEXTBEFORE("one/two", "/", -2, 0, 1)')).toBe("");
    expect(evaluateFormula('=TEXTAFTER("one/two", "/", -2, 0, 1)')).toBe("one/two");
    expect(evaluateFormula('=TEXTBEFORE("one/", "/", 2, 0, 1)')).toBe("one/");
    expect(evaluateFormula('=TEXTAFTER("one/", "/", 2, 0, 1)')).toBe("");
    expect(evaluateFormula('=TEXTBEFORE("one/", "/", -1, 0, 1)')).toBe("one");
    expect(evaluateFormula('=TEXTAFTER("one/", "/", -1, 0, 1)')).toBe("");
  });

  it("matches an empty delimiter at the front or end according to the search direction", () => {
    expect(evaluateFormula('=TEXTBEFORE("abc", "")')).toBe("");
    expect(evaluateFormula('=TEXTAFTER("abc", "")')).toBe("abc");
    expect(evaluateFormula('=TEXTBEFORE("abc", "", -1)')).toBe("abc");
    expect(evaluateFormula('=TEXTAFTER("abc", "", -1)')).toBe("");
    expect(evaluateFormula('=TEXTBEFORE("abc", "", 2)')).toBe("a");
    expect(evaluateFormula('=TEXTAFTER("abc", "", -2)')).toBe("c");
  });

  it("uses if_not_found for missing delimiters and propagates errors in every argument", () => {
    expectError('=TEXTBEFORE("one/two", "-")', "#N/A");
    expectError('=TEXTAFTER("one/two", "-")', "#N/A");
    expect(evaluateFormula('=TEXTBEFORE("one/two", "-", 1, 0, 0, "missing")')).toBe("missing");
    expect(evaluateFormula('=TEXTAFTER("one/two", "-", 1, 0, 0, 17)')).toBe(17);
    expectError('=TEXTBEFORE("one/two", "/", 1, 0, 0, 1/0)', "#DIV/0!");
  });

  it.each([
    ['=TEXTBEFORE("abc", "b", 0)', "#VALUE!"],
    ['=TEXTAFTER("abc", "b", 0)', "#VALUE!"],
    ['=TEXTBEFORE("abc", "b", 4)', "#VALUE!"],
    ['=TEXTAFTER("abc", "b", -4)', "#VALUE!"],
    ['=TEXTBEFORE("abc", "b", 2)', "#N/A"],
    ['=TEXTAFTER("abc", "b", 2)', "#N/A"],
    ['=TEXTBEFORE("abc", "b", 1, 2)', "#VALUE!"],
    ['=TEXTAFTER("abc", "b", 1, 0, 2)', "#VALUE!"],
  ] as [string, ErrorValue["code"]][])("%s returns %s", (formula, code) => {
    expectError(formula, code);
  });

  it("accepts one delimiter, not an array of delimiters", () => {
    expectError('=TEXTBEFORE("one/two", A1:A2)', "#VALUE!");
  });

  it("broadcasts over the text range and keeps cell errors in the matching positions", () => {
    const workbook = workbookWith({
      t1: {
        A1: "one-two-three",
        A2: "left/right",
        A3: "no delimiter",
        A4: "=1/0",
        B1: '=TEXTBEFORE(A1:A4, "-")',
        C1: '=TEXTAFTER(A1:A4, "-")',
      },
    });

    expect(workbook.getArray(at("B1"))).toMatchObject([
      ["one"],
      [{ kind: "error", code: "#N/A" }],
      [{ kind: "error", code: "#N/A" }],
      [{ kind: "error", code: "#DIV/0!" }],
    ]);
    expect(workbook.getArray(at("C1"))).toMatchObject([
      ["two-three"],
      [{ kind: "error", code: "#N/A" }],
      [{ kind: "error", code: "#N/A" }],
      [{ kind: "error", code: "#DIV/0!" }],
    ]);
  });
});
