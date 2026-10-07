import { describe, expect, it } from "vitest";
import { countMisfits } from "./columnTypes";

describe("countMisfits", () => {
  it("uses checkbox coercion for true, false, text, formulas, and empty cells", () => {
    expect(countMisfits("checkbox", ["true", " FALSE ", "yes", "=TRUE", ""])).toBe(2);
  });

  it("uses finite-number coercion and accepts a forced-text numeric input", () => {
    expect(countMisfits("number", ["12.5", "'12", "Infinity", "=1+1", ""])).toBe(2);
  });

  it("uses date parsing, including its calendar validation", () => {
    expect(
      countMisfits("date", ["2026-02-28", "2026-02-30", "2026-01-01 10:30", "=TODAY()", ""]),
    ).toBe(2);
  });

  it("accepts all inputs as text, including formula-like and malformed formulas", () => {
    expect(countMisfits("text", ["plain text", "=1+1", "=[", ""])).toBe(0);
  });

  it("uses ordinary formula parsing for Anything and Choice without enforcing dropdown options", () => {
    const inputs = ["plain text", "outside the choices", "=1+1", "=[", ""];
    expect(countMisfits("any", inputs)).toBe(1);
    expect(countMisfits("choice", inputs)).toBe(1);
  });

  it("does not count cells in formula columns", () => {
    expect(countMisfits("formula", ["invalid input", "=["])).toBe(0);
  });
});
