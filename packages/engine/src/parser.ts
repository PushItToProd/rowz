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

// A column, a row, or both: `A`, `$7`, `$A$7`.
const CORNER_PATTERN = /^(?:(\$?)([A-Za-z]{1,3}))?(?:(\$?)([1-9][0-9]*))?$/;

/** Reads one corner of a reference. The result may lack a row or a column, never both. */
function parseCorner(text: string): ReferenceCell | undefined {
  const match = CORNER_PATTERN.exec(text);
  if (!match || text === "") return undefined;
  const [, colMarker, letters, rowMarker, digits] = match;
  if (letters === undefined && digits === undefined) return undefined;
  return {
    row: digits === undefined ? null : Number(digits) - 1,
    col: letters === undefined ? null : columnIndex(letters),
    rowAbsolute: rowMarker === "$",
    colAbsolute: colMarker === "$",
  };
}

function isWholeCell(corner: ReferenceCell): boolean {
  return corner.row !== null && corner.col !== null;
}

/** A reference and where it is written in the formula text. */
export interface LocatedReference {
  reference: Reference;
  /** Offset of the reference's first character. */
  from: number;
  /** Offset one past its last character. */
  to: number;
}

class Parser {
  /** Every reference in the formula, in the order written. */
  readonly references: LocatedReference[] = [];
  private index = 0;
  /** Where the most recently consumed token ends. */
  private consumedTo = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly text: string,
  ) {}

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
    this.consumedTo = token.end;
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
      this.next();
      left = { type: "binary", operator: token.value, left, right: this.expression(precedence) };
    }
  }

  private unary(): Node {
    const token = this.peek();
    if (token.type === "operator" && (token.value === "+" || token.value === "-")) {
      this.next();
      return { type: "unary", operator: token.value, operand: this.unary() };
    }
    // Parentheses after a value call it: `A1(5)`, `LAMBDA(x, x+1)(5)`.
    let node = this.primary();
    while (this.isPunctuation("(")) node = { type: "apply", target: node, args: this.arguments() };
    return node;
  }

  private primary(): Node {
    const token = this.next();
    switch (token.type) {
      case "number": {
        // A whole number before a colon is a row: `1:4` is rows 1 to 4.
        const row = this.isPunctuation(":") ? this.cornerOf(token) : undefined;
        if (row) return this.located(this.rangeFrom(row, token), token.position);
        return { type: "number", value: token.value };
      }
      case "string":
        return { type: "string", value: token.value };
      case "error":
        return { type: "error", code: token.value };
      case "quotedName":
        if (this.columnFollows(token)) return this.columnOf({ table: token.value }, token.position);
        // Single quotes always write a name, so a quoted name alone is a name with spaces in it.
        if (!this.isPunctuation("!")) return { type: "name", name: token.value };
        return this.qualifiedReference(token.value, token.position);
      case "column":
        return this.located({ column: token.value }, token.position);
      case "identifier":
        return this.identifier(token);
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

  private identifier(token: Token & { type: "identifier" }): Node {
    const { value: name, position } = token;
    if (this.columnFollows(token)) return this.columnOf({ table: name }, position);
    if (this.isPunctuation("!")) return this.qualifiedReference(name, position);

    // A cell address before `(` is a call of the function in that cell, so a
    // function cannot be named like a cell address.
    const start = this.cornerOf(token);
    const isCell = start !== undefined && isWholeCell(start);
    if (this.isPunctuation("(") && !isCell) {
      return { type: "call", name: name.toUpperCase(), args: this.arguments() };
    }

    const upper = name.toUpperCase();
    if (upper === "TRUE") return { type: "boolean", value: true };
    if (upper === "FALSE") return { type: "boolean", value: false };

    // A lone column such as `A` is only a reference as the start of a range.
    if (!start || (!isCell && !this.isPunctuation(":"))) return { type: "name", name };
    return this.located(this.rangeFrom(start, token), position);
  }

  private located(reference: Reference, from: number): Node {
    this.references.push({ reference, from, to: this.consumedTo });
    return { type: "reference", reference };
  }

  /** Parses a parenthesized, comma-separated argument list, positioned at the `(`. */
  private arguments(): Node[] {
    this.expectPunctuation("(");
    const args: Node[] = [];
    if (!this.isPunctuation(")")) {
      do {
        args.push(this.expression(0));
      } while (this.consumePunctuation(","));
    }
    this.expectPunctuation(")");
    return args;
  }

  private consumePunctuation(value: Punctuation): boolean {
    if (!this.isPunctuation(value)) return false;
    this.next();
    return true;
  }

  /** Whether a `[Column]` is written directly after a table name, with no space between. */
  private columnFollows(name: Token): boolean {
    const next = this.peek();
    return next.type === "column" && next.position === name.end;
  }

  /** Finishes `Table[Column]`, positioned at the `[Column]`. */
  private columnOf(qualifier: { page?: string; table: string }, position: number): Node {
    const column = this.next();
    if (column.type !== "column") throw this.unexpected(column);
    return this.located({ ...qualifier, column: column.value }, position);
  }

  /**
   * Parses `Table!A1`, `Page!Table!A1`, or `Page!Table[Column]`, positioned at
   * the first `!`. A last part that is not a cell or a range makes a qualified
   * name: `Summary!Total`, `Page!Summary!Total`.
   */
  private qualifiedReference(firstName: string, position: number): Node {
    this.expectPunctuation("!");
    const names = [firstName];
    const candidate = this.peek();
    if (candidate.type === "identifier" || candidate.type === "quotedName") {
      const after = this.peek(1);
      if (after.type === "column" && after.position === candidate.end) {
        this.next();
        return this.columnOf({ page: firstName, table: candidate.value }, position);
      }
    }
    if (
      (candidate.type === "identifier" || candidate.type === "quotedName") &&
      this.isPunctuation("!", 1)
    ) {
      names.push(candidate.value);
      this.next();
      this.next();
    }

    const token = this.next();
    const [page, holder = firstName] = names.length === 2 ? names : [undefined, ...names];
    if (this.isName(token)) {
      return {
        type: "qualified",
        ...(page === undefined ? {} : { page }),
        holder,
        name: token.value,
      };
    }
    const start = this.corner(token);
    const qualifier =
      names.length === 2 ? { page: names[0], table: names[1] } : { table: names[0] };
    return this.located({ ...qualifier, ...this.rangeFrom(start, token) }, position);
  }

  /**
   * Whether a token after `!` is a name and not the start of a cell or range.
   * A word that reads as a column, such as `Tax`, is a name unless a `:` follows.
   */
  private isName(token: Token): token is Token & { type: "identifier" | "quotedName" } {
    if (token.type === "quotedName") return true;
    if (token.type !== "identifier") return false;
    const corner = this.cornerOf(token);
    return !corner || (!isWholeCell(corner) && !this.isPunctuation(":"));
  }

  /** Reads a token as a corner: an identifier such as `A1` or `B`, or a whole number as a row. */
  private cornerOf(token: Token): ReferenceCell | undefined {
    if (token.type !== "identifier" && token.type !== "number") return undefined;
    return parseCorner(this.text.slice(token.position, token.end));
  }

  private corner(token: Token): ReferenceCell {
    const corner = this.cornerOf(token);
    if (!corner) throw new FormulaSyntaxError("Expected a cell address", token.position);
    return corner;
  }

  /** Finishes a reference whose first corner, read from `startToken`, is `start`. */
  private rangeFrom(start: ReferenceCell, startToken: Token): Reference {
    if (this.consumePunctuation(":")) return { start, end: this.corner(this.next()) };
    if (!isWholeCell(start)) {
      throw new FormulaSyntaxError("Expected a cell address", startToken.position);
    }
    return { start };
  }
}

/**
 * Parses formula text (without the leading `=`) into an AST.
 * @throws FormulaSyntaxError when the text is not a valid formula.
 */
export function parseFormula(text: string): Node {
  return parseFormulaWithReferences(text).ast;
}

/** Parses like `parseFormula`, and also reports where each reference is written. */
export function parseFormulaWithReferences(text: string): {
  ast: Node;
  references: LocatedReference[];
} {
  const parser = new Parser(tokenize(text), text);
  return { ast: parser.parse(), references: parser.references };
}
