import { columnIndex } from "./address";
import type { Node, Reference, ReferenceCell } from "./ast";
import {
  FormulaSyntaxError,
  tokenize,
  type Operator,
  type Punctuation,
  type Token,
} from "./tokenizer";

// Excel's ordering: comparison, then concatenation, then arithmetic. All
// binary operators are left-associative, and unary minus binds tighter than
// `^`, so `-2^2` is 4.
const BINARY_PRECEDENCE: Record<Operator, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};

const CELL_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)([1-9][0-9]*)$/;

function parseReferenceCell(text: string): ReferenceCell | undefined {
  const match = CELL_PATTERN.exec(text);
  if (!match) return undefined;
  const [, colMarker, letters = "", rowMarker, digits = ""] = match;
  return {
    row: Number(digits) - 1,
    col: columnIndex(letters),
    rowAbsolute: rowMarker === "$",
    colAbsolute: colMarker === "$",
  };
}

class Parser {
  private index = 0;

  constructor(private readonly tokens: readonly Token[]) {}

  parse(): Node {
    const node = this.expression(0);
    const token = this.peek();
    if (token.type !== "end") throw this.unexpected(token);
    return node;
  }

  private peek(offset = 0): Token {
    const token = this.tokens[this.index + offset] ?? this.tokens.at(-1);
    if (!token) throw new FormulaSyntaxError("Empty formula", 0);
    return token;
  }

  private next(): Token {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private isPunctuation(value: Punctuation, offset = 0): boolean {
    const token = this.peek(offset);
    return token.type === "punctuation" && token.value === value;
  }

  private expectPunctuation(value: Punctuation): void {
    const token = this.next();
    if (token.type !== "punctuation" || token.value !== value) {
      throw new FormulaSyntaxError(`Expected ${value}`, token.position);
    }
  }

  private unexpected(token: Token): FormulaSyntaxError {
    const text = token.type === "end" ? "end of formula" : String(token.value);
    return new FormulaSyntaxError(`Unexpected ${text}`, token.position);
  }

  private expression(minPrecedence: number): Node {
    let left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token.type !== "operator") return left;
      const precedence = BINARY_PRECEDENCE[token.value];
      if (precedence <= minPrecedence) return left;
      this.index += 1;
      left = { type: "binary", operator: token.value, left, right: this.expression(precedence) };
    }
  }

  private unary(): Node {
    const token = this.peek();
    if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
      this.index += 1;
      return { type: "unary", operator: token.value, operand: this.unary() };
    }
    return this.primary();
  }

  private primary(): Node {
    const token = this.next();
    switch (token.type) {
      case "number":
        return { type: "number", value: token.value };
      case "string":
        return { type: "string", value: token.value };
      case "quotedName":
        if (!this.isPunctuation("!")) {
          throw new FormulaSyntaxError("Expected ! after a quoted name", token.position);
        }
        return this.qualifiedReference(token.value);
      case "identifier":
        return this.identifier(token.value, token.position);
      case "punctuation":
        if (token.value === "(") {
          const node = this.expression(0);
          this.expectPunctuation(")");
          return node;
        }
        throw this.unexpected(token);
      case "operator":
      case "end":
        throw this.unexpected(token);
    }
  }

  private identifier(name: string, position: number): Node {
    if (this.isPunctuation("(")) return this.call(name);
    if (this.isPunctuation("!")) return this.qualifiedReference(name);

    const upper = name.toUpperCase();
    if (upper === "TRUE") return { type: "boolean", value: true };
    if (upper === "FALSE") return { type: "boolean", value: false };

    const start = parseReferenceCell(name);
    if (!start) throw new FormulaSyntaxError(`Unknown name ${name}`, position, "#NAME?");
    return { type: "reference", reference: this.rangeFrom(start) };
  }

  private call(name: string): Node {
    this.expectPunctuation("(");
    const args: Node[] = [];
    if (!this.isPunctuation(")")) {
      do {
        args.push(this.expression(0));
      } while (this.consumePunctuation(","));
    }
    this.expectPunctuation(")");
    return { type: "call", name: name.toUpperCase(), args };
  }

  private consumePunctuation(value: Punctuation): boolean {
    if (!this.isPunctuation(value)) return false;
    this.index += 1;
    return true;
  }

  /** Parses `Table!A1` or `Page!Table!A1`, positioned at the first `!`. */
  private qualifiedReference(firstName: string): Node {
    this.expectPunctuation("!");
    const names = [firstName];
    const candidate = this.peek();
    if (
      (candidate.type === "identifier" || candidate.type === "quotedName") &&
      this.isPunctuation("!", 1)
    ) {
      names.push(candidate.value);
      this.index += 2;
    }

    const start = this.referenceCell();
    const qualifier =
      names.length === 2 ? { page: names[0], table: names[1] } : { table: names[0] };
    return { type: "reference", reference: { ...qualifier, ...this.rangeFrom(start) } };
  }

  private referenceCell(): ReferenceCell {
    const token = this.next();
    const cell = token.type === "identifier" ? parseReferenceCell(token.value) : undefined;
    if (!cell) throw new FormulaSyntaxError("Expected a cell address", token.position);
    return cell;
  }

  private rangeFrom(start: ReferenceCell): Reference {
    if (!this.consumePunctuation(":")) return { start };
    return { start, end: this.referenceCell() };
  }
}

/**
 * Parses formula text (without the leading `=`) into an AST.
 * @throws FormulaSyntaxError when the text is not a valid formula.
 */
export function parseFormula(text: string): Node {
  return new Parser(tokenize(text)).parse();
}
