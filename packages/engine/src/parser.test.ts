import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { printNode, type BinaryOperator, type Node, type ReferenceCell } from "./ast";
import { parseFormula, parseFormulaWithReferences } from "./parser";
import { FormulaSyntaxError } from "./tokenizer";
import { ERROR_CODES } from "./values";

function cell(row: number, col: number, absolute = false): ReferenceCell {
  return { row, col, rowAbsolute: absolute, colAbsolute: absolute };
}

const number = (value: number): Node => ({ type: "number", value });
const binary = (operator: BinaryOperator, left: Node, right: Node): Node => ({
  type: "binary",
  operator,
  left,
  right,
});

describe("literals", () => {
  it.each<[string, Node]>([
    ["42", number(42)],
    ['"hi"', { type: "string", value: "hi" }],
    ["TRUE", { type: "boolean", value: true }],
    ["#REF!", { type: "error", code: "#REF!" }],
    ["false", { type: "boolean", value: false }],
  ])("parses %s", (text, node) => {
    expect(parseFormula(text)).toEqual(node);
  });
});

describe("operators", () => {
  it("gives multiplication precedence over addition", () => {
    expect(parseFormula("1+2*3")).toEqual(
      binary("+", number(1), binary("*", number(2), number(3))),
    );
  });

  it("gives exponentiation precedence over multiplication", () => {
    expect(parseFormula("2*3^2")).toEqual(
      binary("*", number(2), binary("^", number(3), number(2))),
    );
  });

  it("gives arithmetic precedence over concatenation, and concatenation over comparison", () => {
    expect(parseFormula("1&2+3=4")).toEqual(
      binary("=", binary("&", number(1), binary("+", number(2), number(3))), number(4)),
    );
  });

  it.each<BinaryOperator>(["-", "/", "^", "&"])("makes %s left-associative", (operator) => {
    expect(parseFormula(`1${operator}2${operator}3`)).toEqual(
      binary(operator, binary(operator, number(1), number(2)), number(3)),
    );
  });

  it("lets parentheses override precedence", () => {
    expect(parseFormula("(1+2)*3")).toEqual(
      binary("*", binary("+", number(1), number(2)), number(3)),
    );
  });

  it("binds unary minus tighter than exponentiation", () => {
    expect(parseFormula("-2^2")).toEqual(
      binary("^", { type: "unary", operator: "-", operand: number(2) }, number(2)),
    );
  });

  it("accepts a unary operator after a binary one", () => {
    expect(parseFormula("2^-3")).toEqual(
      binary("^", number(2), { type: "unary", operator: "-", operand: number(3) }),
    );
  });

  it("stacks unary operators", () => {
    expect(parseFormula("-+1")).toEqual({
      type: "unary",
      operator: "-",
      operand: { type: "unary", operator: "+", operand: number(1) },
    });
  });
});

describe("references", () => {
  it("parses a cell", () => {
    expect(parseFormula("b3")).toEqual({ type: "reference", reference: { start: cell(2, 1) } });
  });

  it("keeps absolute markers per axis", () => {
    expect(parseFormula("$B3")).toEqual({
      type: "reference",
      reference: { start: { row: 2, col: 1, rowAbsolute: false, colAbsolute: true } },
    });
    expect(parseFormula("B$3")).toEqual({
      type: "reference",
      reference: { start: { row: 2, col: 1, rowAbsolute: true, colAbsolute: false } },
    });
  });

  it("parses a range", () => {
    expect(parseFormula("A1:$C$2")).toEqual({
      type: "reference",
      reference: { start: cell(0, 0), end: cell(1, 2, true) },
    });
  });

  it.each<[string, Partial<ReferenceCell>, Partial<ReferenceCell>]>([
    ["A:C", { row: null, col: 0 }, { row: null, col: 2 }],
    ["2:5", { row: 1, col: null }, { row: 4, col: null }],
    ["A2:A", { row: 1, col: 0 }, { row: null, col: 0 }],
    ["A1:4", { row: 0, col: 0 }, { row: 3, col: null }],
    ["B:C9", { row: null, col: 1 }, { row: 8, col: 2 }],
    ["3:D8", { row: 2, col: null }, { row: 7, col: 3 }],
    ["$A:$C", { row: null, col: 0, colAbsolute: true }, { row: null, col: 2, colAbsolute: true }],
    ["$2:$5", { row: 1, col: null, rowAbsolute: true }, { row: 4, col: null, rowAbsolute: true }],
  ])("parses the open-sided range %s", (text, start, end) => {
    expect(parseFormula(text)).toMatchObject({ type: "reference", reference: { start, end } });
  });

  it("parses an open-sided range after a qualifier and inside a call", () => {
    expect(parseFormula("SUM(Sales!B:B, 'Page 2'!Sales!1:1)")).toMatchObject({
      args: [
        { reference: { table: "Sales", start: { row: null, col: 1 }, end: { row: null, col: 1 } } },
        { reference: { page: "Page 2", table: "Sales", start: { row: 0, col: null } } },
      ],
    });
  });

  it("reads a number as a number unless a colon follows it", () => {
    expect(parseFormula("1+4")).toEqual(binary("+", number(1), number(4)));
    expect(parseFormula("SUM(1, 4)")).toMatchObject({ args: [number(1), number(4)] });
  });

  it.each(["A", "AB", "abc"])("reports the lone column %s as an unknown name", (text) => {
    try {
      parseFormula(text);
      expect.unreachable();
    } catch (cause) {
      expect((cause as FormulaSyntaxError).code).toBe("#NAME?");
    }
  });

  it("parses a table qualifier, quoted or not", () => {
    const expected = { type: "reference", reference: { table: "Table2", start: cell(0, 0) } };
    expect(parseFormula("Table2!A1")).toEqual(expected);
    expect(parseFormula("'Table2'!A1")).toEqual(expected);
  });

  it("parses a page and table qualifier with a range", () => {
    expect(parseFormula("'Page 1'!'Joe''s Table'!A1:B2")).toEqual({
      type: "reference",
      reference: { page: "Page 1", table: "Joe's Table", start: cell(0, 0), end: cell(1, 1) },
    });
  });

  it("treats a table named like a cell address as a table when followed by !", () => {
    expect(parseFormula("AB12!C3")).toEqual({
      type: "reference",
      reference: { table: "AB12", start: cell(2, 2) },
    });
  });
});

describe("parseFormulaWithReferences", () => {
  function located(text: string): string[] {
    return parseFormulaWithReferences(text).references.map(({ from, to }) => text.slice(from, to));
  }

  it("reports the text of each reference, in the order written", () => {
    expect(located("A1 + SUM( b2:C3 ,'My Table'!$A$1) & Page!Table!A1:B2")).toEqual([
      "A1",
      "b2:C3",
      "'My Table'!$A$1",
      "Page!Table!A1:B2",
    ]);
  });

  it("includes references inside action arguments", () => {
    expect(located('BUTTON("x", EXECUTE(A1+1, Log!B2))')).toEqual(["A1", "Log!B2"]);
  });

  it("allows spaces inside a reference and reports the whole of it", () => {
    expect(located("1 + Sales ! A1 : B2 + 2")).toEqual(["Sales ! A1 : B2"]);
  });

  it("reports nothing for a formula with no references", () => {
    expect(located('SUM(1, 2) & "A1"')).toEqual([]);
  });
});

describe("calls", () => {
  it("parses a call with no arguments", () => {
    expect(parseFormula("NOW()")).toEqual({ type: "call", name: "NOW", args: [] });
  });

  it("uppercases the function name and parses nested arguments", () => {
    expect(parseFormula("sum(A1, max(1, 2))")).toEqual({
      type: "call",
      name: "SUM",
      args: [
        { type: "reference", reference: { start: cell(0, 0) } },
        { type: "call", name: "MAX", args: [number(1), number(2)] },
      ],
    });
  });
});

describe("syntax errors", () => {
  it.each([
    ["", "Unexpected end of formula"],
    ["1+", "Unexpected end of formula"],
    ["1 2", "Unexpected 2"],
    ["(1", "Expected )"],
    ["SUM(1", "Expected )"],
    ["SUM(1,)", "Unexpected )"],
    ["*2", "Unexpected *"],
    [",", "Unexpected ,"],
    ["'Table'", "Expected ! after a quoted name"],
    ["Table1!5", "Expected a cell address"],
    ["A!B!C!D1", "Expected a cell address"],
    ["A1:", "Expected a cell address"],
    ["A1:total", "Expected a cell address"],
    ["A1:1.5", "Expected a cell address"],
    ["Sales!B", "Expected a cell address"],
    ["Sales!7", "Expected a cell address"],
    ["1.5:2", "Unexpected :"],
  ])("rejects %j with %j", (text, message) => {
    expect(() => parseFormula(text)).toThrow(FormulaSyntaxError);
    expect(() => parseFormula(text)).toThrow(message);
  });

  it("reports an unknown bare word as a name error", () => {
    try {
      parseFormula("1+total");
      expect.unreachable();
    } catch (cause) {
      expect(cause).toBeInstanceOf(FormulaSyntaxError);
      expect((cause as FormulaSyntaxError).code).toBe("#NAME?");
      expect((cause as FormulaSyntaxError).position).toBe(2);
    }
  });
});

describe("printNode", () => {
  const referenceCell = fc.record({
    row: fc.nat(9999),
    col: fc.nat(18_277),
    rowAbsolute: fc.boolean(),
    colAbsolute: fc.boolean(),
  });
  // A corner of a range may name only a column or only a row. The `$` marker
  // of the side left out cannot be written, so it is always false.
  const corner = fc.oneof(
    referenceCell,
    referenceCell.map((cell) => ({ ...cell, row: null, rowAbsolute: false })),
    referenceCell.map((cell) => ({ ...cell, col: null, colAbsolute: false })),
  );
  const cells = fc.oneof(
    fc.record({ start: referenceCell }),
    fc.record({ start: corner, end: corner }),
  );
  const reference = fc.oneof(
    cells,
    fc.tuple(fc.string(), cells).map(([table, rest]) => ({ table, ...rest })),
    fc
      .tuple(fc.string(), fc.string(), cells)
      .map(([page, table, rest]) => ({ page, table, ...rest })),
  );

  const { node: anyNode } = fc.letrec<{ node: Node }>((tie) => ({
    node: fc.oneof(
      { depthSize: "small" },
      // Negative numbers are written with unary minus, so literals are never negative.
      fc
        .double({ min: 0, noNaN: true, noDefaultInfinity: true })
        .map((value) => number(Math.abs(value))),
      fc.string().map((value): Node => ({ type: "string", value })),
      fc.boolean().map((value): Node => ({ type: "boolean", value })),
      fc.constantFrom(...ERROR_CODES).map((code): Node => ({ type: "error", code })),
      reference.map((value): Node => ({ type: "reference", reference: value })),
      fc
        .tuple(fc.constantFrom<"+" | "-">("+", "-"), tie("node"))
        .map(([operator, operand]): Node => ({ type: "unary", operator, operand })),
      fc
        .tuple(
          fc.constantFrom<BinaryOperator>(
            "+",
            "-",
            "*",
            "/",
            "^",
            "&",
            "=",
            "<>",
            "<",
            ">",
            "<=",
            ">=",
          ),
          tie("node"),
          tie("node"),
        )
        .map(([operator, left, right]) => binary(operator, left, right)),
      fc
        .tuple(fc.stringMatching(/^[A-Z][A-Z0-9_]{0,8}$/), fc.array(tie("node"), { maxLength: 3 }))
        .map(([name, args]): Node => ({ type: "call", name, args })),
    ),
  }));

  it("prints text that parses back to the same AST", () => {
    fc.assert(
      fc.property(anyNode, (node) => {
        expect(parseFormula(printNode(node))).toEqual(node);
      }),
    );
  });

  it("prints a readable formula", () => {
    expect(printNode(parseFormula('sum(\'My Table\'!$A1:B$2, -1) & "a""b"'))).toBe(
      '(SUM(\'My Table\'!$A1:B$2,(-1))&"a""b")',
    );
  });
});
