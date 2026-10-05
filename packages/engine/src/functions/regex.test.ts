import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../testing";
import type { ErrorValue } from "../values";

function expectError(formula: string, code: ErrorValue["code"], message?: string): void {
  const value = evaluateFormula(formula);
  expect(value, formula).toMatchObject({ kind: "error", code });
  if (message) expect((value as ErrorValue).message).toContain(message);
}

describe("regular expression functions", () => {
  it.each([
    ['=REGEXMATCH("Order 123", "[0-9]+")', true],
    ['=REGEXMATCH("Order", "[0-9]+")', false],
    ['=REGEXMATCH("AB-123", "^[A-Z]{2}-[0-9]{3}$")', true],
    ['=REGEXMATCH("ab-123", "^[A-Z]{2}-[0-9]{3}$")', false],
    ['=REGEXMATCH("abc", "b.")', true],
    ['=REGEXMATCH("x9", "\\w\\d")', true],
    ['=REGEXMATCH("x ", "\\w\\s")', true],
    ['=REGEXMATCH("!", "\\W")', true],
    ['=REGEXMATCH(" ", "\\D")', true],
    ['=REGEXMATCH("a", "\\S")', true],
    ['=REGEXMATCH(" ", "\\S")', false],
    ['=REGEXMATCH("abc", "\\bcat\\b")', false],
    ['=REGEXMATCH("a cat!", "\\bcat\\b")', true],
    ['=REGEXMATCH("cat", "[^a-z]+")', false],
    ['=REGEXMATCH("A", "[A-Z]")', true],
    ['=REGEXMATCH("B", "[\\dA-Z]")', true],
    ['=REGEXMATCH("aaa", "a{2,3}")', true],
  ] as [string, boolean][])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula)).toBe(expected);
  });

  it("does not let dot match a line break", () => {
    expect(evaluateFormula('=REGEXMATCH(A1, "a.b")', { A1: "a\nb" })).toBe(false);
  });

  it.each([
    ['=REGEXEXTRACT("Order 123 shipped", "[0-9]+")', "123"],
    ['=REGEXEXTRACT("Ada Lovelace", "([A-Z][a-z]+) ([A-Z][a-z]+)")', "Ada"],
    ['=REGEXEXTRACT("ab", "a|ab")', "a"],
    ['=REGEXEXTRACT("aaa", "a+")', "aaa"],
    ['=REGEXEXTRACT("aaa", "a+?")', "a"],
    ['=REGEXEXTRACT("aa", "a{1,2}?")', "a"],
    ['=REGEXEXTRACT("abc", "(?:b.)")', "bc"],
    ['=REGEXEXTRACT("ab", "(a)?b")', "a"],
  ] as [string, string][])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula)).toBe(expected);
  });

  it("returns an empty string when its first capture did not participate", () => {
    expect(evaluateFormula('=REGEXEXTRACT("b", "(a)?b")')).toBe("");
  });

  it.each([
    ['=REGEXREPLACE("one 2 two 34", "[0-9]+", "#")', "one # two #"],
    ['=REGEXREPLACE("Ada Lovelace", "([A-Z][a-z]+) ([A-Z][a-z]+)", "$2, $1")', "Lovelace, Ada"],
    ['=REGEXREPLACE("a", "a", "$$$&")', "$a"],
    ['=REGEXREPLACE("ab", "^|$", "-")', "-ab-"],
    ['=REGEXREPLACE("ab", "", "-")', "-a-b-"],
    ['=REGEXREPLACE("abc", "b", "")', "ac"],
  ] as [string, string][])("%s is %j", (formula, expected) => {
    expect(evaluateFormula(formula)).toBe(expected);
  });

  it.each([
    ['=REGEXEXTRACT("Order", "[0-9]+")', "#N/A", "did not match"],
    ['=REGEXMATCH("a", "(")', "#VALUE!", "unclosed"],
    ['=REGEXMATCH("a", "[z-a]")', "#VALUE!", "descending"],
    ['=REGEXMATCH("a", "[a-\\d]")', "#VALUE!", "literal endpoints"],
    ['=REGEXMATCH("a", "(a)\\1")', "#VALUE!", "Backreferences"],
    ['=REGEXMATCH("a", "(?=a)")', "#VALUE!", "Lookaround"],
    ['=REGEXMATCH("a", "\\q")', "#VALUE!", "not supported"],
  ] as [string, ErrorValue["code"], string][])("%s reports %s", (formula, code, message) => {
    expectError(formula, code, message);
  });

  it("rejects patterns longer than the documented limit", () => {
    const pattern = "a".repeat(257);
    expectError('=REGEXMATCH("a", "' + pattern + '")', "#VALUE!", "256 characters");
  });

  it("rejects repeat counts that would make an oversized NFA", () => {
    expectError('=REGEXMATCH("a", "a{1000000}")', "#VALUE!", "too complex");
  });

  it("limits replacement output before it grows too large", () => {
    const value = evaluateFormula('=REGEXREPLACE(A1, "", "xxxxxxxxxxxxxxxxxxxx")', {
      A1: "a".repeat(100_000),
    });
    expect(value).toMatchObject({
      kind: "error",
      code: "#VALUE!",
      message: expect.stringContaining("2,000,000 characters"),
    });
  });

  it("enforces a total step budget on patterns with many live NFA states", () => {
    const pattern = "(?:a|aa|aaa|aaaa|aaaaa|aaaaaa|aaaaaaa|aaaaaaaa|aaaaaaaaa|aaaaaaaaaa)*z";
    const formula = '=REGEXREPLACE(A1, "' + pattern + '", "x")';
    const value = evaluateFormula(formula, { A1: "a".repeat(50_000) });
    expect(value).toMatchObject({
      kind: "error",
      code: "#VALUE!",
      message: expect.stringContaining("step limit"),
    });
  });

  it("finishes the classic nested-quantifier failure case quickly", () => {
    const source = "a".repeat(50_000) + "b";
    const started = performance.now();
    expect(evaluateFormula('=REGEXMATCH(A1, "(a+)+$")', { A1: source })).toBe(false);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
