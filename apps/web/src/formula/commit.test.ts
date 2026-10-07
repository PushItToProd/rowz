import { describe, expect, it } from "vitest";
import { closeOpenFormulaParentheses } from "./commit";

describe("closeOpenFormulaParentheses", () => {
  it("leaves balanced formulas unchanged", () => {
    expect(closeOpenFormulaParentheses("=SUM(A1, 2)")).toBe("=SUM(A1, 2)");
  });

  it("closes one or several parentheses left open at the end", () => {
    expect(closeOpenFormulaParentheses("=SUM(D2:D4")).toBe("=SUM(D2:D4)");
    expect(closeOpenFormulaParentheses("=IF(A1, SUM(B1, C1")).toBe("=IF(A1, SUM(B1, C1))");
  });

  it("does not append inside an unterminated string", () => {
    expect(closeOpenFormulaParentheses('=SUM(A1, "unfinished')).toBe('=SUM(A1, "unfinished');
  });

  it("does not append inside an unterminated quoted name", () => {
    expect(closeOpenFormulaParentheses("=SUM(A1, 'unfinished")).toBe("=SUM(A1, 'unfinished");
  });

  it("does not append inside an unterminated column bracket", () => {
    expect(closeOpenFormulaParentheses("=SUM(A1, [unfinished")).toBe("=SUM(A1, [unfinished");
  });

  it("does not append inside an unterminated brace group", () => {
    expect(closeOpenFormulaParentheses("=SUM({A1")).toBe("=SUM({A1");
  });

  it("ignores parentheses inside strings, quoted names, and column brackets", () => {
    expect(closeOpenFormulaParentheses("=SUM(\"(\", 'Page )old'!A1, [Cost (USD]")).toBe(
      "=SUM(\"(\", 'Page )old'!A1, [Cost (USD])",
    );
  });

  it("ignores parentheses inside brace groups", () => {
    expect(closeOpenFormulaParentheses("=SUM({(1}")).toBe("=SUM({(1})");
  });

  it("leaves an extra closing parenthesis untouched", () => {
    expect(closeOpenFormulaParentheses("=SUM(A1))")).toBe("=SUM(A1))");
  });

  it("does not change text that does not start with an equals sign", () => {
    expect(closeOpenFormulaParentheses("a (b")).toBe("a (b");
  });
});
