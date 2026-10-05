import { describe, expect, it } from "vitest";
import { Failure } from "../errors";
import { criterion } from "./criteria";

describe("wildcards in a criterion", () => {
  it.each([
    ["apple", "apple", true],
    ["apple", "APPLE", true],
    ["apple", "apples", false],
    ["a*", "apple", true],
    ["a*", "a", true],
    ["a*", "banana", false],
    ["*", "anything", true],
    ["*e", "apple", true],
    ["*p*e", "apple", true],
    ["*p*x", "apple", false],
    ["a**e", "apple", true],
    ["a*e*", "apple", true],
    ["*ab*ab", "abab", true],
    ["*ab*ab", "ab", false],
    ["*aab", "aaab", true],
    ["?pple", "apple", true],
    ["?pple", "pple", false],
    ["appl?", "apple", true],
    ["appl?", "appl", false],
    ["a?*", "a", false],
    ["a?*", "ab", true],
    ["a.c", "abc", false],
    ["a.c", "a.c", true],
    ["(a|b)+", "(a|b)+", true],
    ["a*c", "a\nc", true],
    // `?` is one character, however many code units hold it.
    ["?", "😀", true],
    ["?", "İ", true],
    ["i", "İ", false],
  ])("%j against %j is %j", (pattern, text, matches) => {
    expect(criterion(pattern)(text)).toBe(matches);
    expect(criterion(`<>${pattern}`)(text)).toBe(!matches);
  });

  it("matches text only", () => {
    expect(criterion("*")(12)).toBe(false);
    expect(criterion("*")(null)).toBe(false);
  });

  it("answers quickly for a pattern of many * against long text that nearly matches", () => {
    const test = criterion(`${"*a".repeat(100)}*b`);
    const started = performance.now();
    expect(test("a".repeat(50_000))).toBe(false);
    expect(test(`${"a".repeat(50_000)}b`)).toBe(true);
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it("refuses a pattern with * longer than 255 characters", () => {
    expect(criterion("a".repeat(300))("A".repeat(300))).toBe(true);
    expect(criterion(`${"a".repeat(254)}*`)("a".repeat(400))).toBe(true);
    expect(() => criterion(`${"a".repeat(255)}*`)).toThrow(Failure);
  });
});

describe("quoted text criteria", () => {
  it("matches a quoted string equality criterion like the formula equality operator", () => {
    const matches = criterion('="foobar"');
    expect(matches("foobar")).toBe(true);
    expect(matches("FOOBAR")).toBe(true);
    expect(matches("foo")).toBe(false);
    expect(criterion('="foo""bar"')('foo"bar')).toBe(true);
    expect(criterion('="foo*"')("foo*")).toBe(true);
    expect(criterion('="foo*"')("foobar")).toBe(false);
  });

  it("does not coerce a number to the same text", () => {
    const matches = criterion('="12"');
    expect(matches(12)).toBe(false);
    expect(matches("12")).toBe(true);
  });
});
