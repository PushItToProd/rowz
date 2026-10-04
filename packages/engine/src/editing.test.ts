import { describe, expect, it } from "vitest";
import { analyzeFormula, bindingsAt, expectsOperand } from "./editing";
import { tokenize, tokenizeForEditing } from "./tokenizer";

describe("tolerant formula analysis", () => {
  it("keeps strict tokenization unchanged for complete syntax", () => {
    const source = `SUM('Joe''s'!A1:B2, [Paid on], "a""b", 1e3) <> #REF!`;
    expect(tokenizeForEditing(source)).toEqual(tokenize(source));
  });

  it.each(['SUM(A1, "unfinished', "'unfinished", "[unfinished", "[", "1e999", "A1 + @ + B2"])(
    "accepts incomplete or invalid text %s without changing evaluation",
    (source) => {
      expect(() => analyzeFormula(source)).not.toThrow();
      expect(() => tokenize(source)).toThrow();
    },
  );

  it("keeps original offsets and references around invalid and unfinished operands", () => {
    const source = `=A1 + @ + 'Raw Data'!Sales!$B2:C$4 + SUM(D5,`;
    const analysis = analyzeFormula(source, { from: 1, to: source.length });
    expect(analysis.references.map(({ from, to }) => source.slice(from, to))).toEqual([
      "A1",
      "'Raw Data'!Sales!$B2:C$4",
      "D5",
    ]);
    expect(analysis.tokens[0]).toMatchObject({ position: 1, end: 3 });
    expect(analysis.tokens.at(-1)).toMatchObject({ type: "end", position: source.length });
  });

  it("does not treat strings, qualified names, or incomplete ranges as direct references", () => {
    const source = `"A1" + Summary!Total + A1: + B2 + Sales[Price]`;
    expect(analyzeFormula(source).references.map(({ from, to }) => source.slice(from, to))).toEqual(
      ["B2", "Sales[Price]"],
    );
  });

  it("reports lexical LET scope without inventing bindings from free words or text", () => {
    const source = `LET(total, rate, rate, total + 1, total + rate) + total`;
    const analysis = analyzeFormula(source);
    expect(bindingsAt(analysis, source.indexOf("rate"))).toEqual([]);
    expect(bindingsAt(analysis, source.indexOf("total + 1"))).toEqual(["total"]);
    expect(bindingsAt(analysis, source.indexOf("total + rate"))).toEqual(["total", "rate"]);
    expect(bindingsAt(analysis, source.length)).toEqual([]);
    expect(bindingsAt(analyzeFormula('"total" + other + to'), 20)).toEqual([]);
  });

  it("keeps bindings in unfinished bodies and handles nested shadowing", () => {
    const source = "LET(outer, 1, LAMBDA(OUTER, qty, OUT";
    expect(bindingsAt(analyzeFormula(source), source.length)).toEqual(["OUTER", "qty"]);
    expect(bindingsAt(analyzeFormula("LET(total, 1, to"), 16)).toEqual(["total"]);
    expect(bindingsAt(analyzeFormula("LAMBDA(price, qty, pr"), 20)).toEqual(["price", "qty"]);
    expect(bindingsAt(analyzeFormula("LET(A1, 1, A"), 12)).toEqual([]);
  });

  it("finds operand positions while suppressing picking inside tokens and strings", () => {
    for (const source of ["", "B3+", "SUM(", "SUM(A1, "]) {
      expect(expectsOperand(analyzeFormula(source), source.length)).toBe(true);
    }
    for (const source of ["B3", '"unfinished', "[Price", "'Sales", "SUM(A1)"]) {
      expect(expectsOperand(analyzeFormula(source), source.length)).toBe(false);
    }
    expect(expectsOperand(analyzeFormula("B3+"), 1)).toBe(false);
    expect(expectsOperand(analyzeFormula("=B3+", { from: 1, to: 4 }), 0)).toBe(false);
  });

  it("analyzes a 50,000-character fragment without allocating a workbook", () => {
    const source = "A1+".repeat(16_666) + "B2";
    expect(source).toHaveLength(50_000);
    expect(analyzeFormula(source).references).toHaveLength(16_667);
  });
});
