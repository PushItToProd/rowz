import { columnIndex } from "./address";
import type { BinaryOperator, Node, Reference, ReferenceCell } from "./ast";
import { FormulaSyntaxError, tokenize, type Punctuation, type Token } from "./tokenizer";

// Boolean operators bind below Excel's comparison, concatenation, and arithmetic. All
// binary operators are left-associative, and unary minus binds tighter than
// `^`, so `-2^2` is 4.
const BINARY_PRECEDENCE: Record<BinaryOperator, number> = {
  or: 1,
  and: 2,
  "=": 4,
  "<>": 4,
  "!=": 4,
  "<": 4,
  ">": 4,
  "<=": 4,
  ">=": 4,
  "&": 5,
  "+": 6,
  "-": 6,
  "*": 7,
  "/": 7,
  "^": 8,
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
  /**
   * Set for a qualified name such as `Summary!Total`, which is recorded as a
   * column reference whose table is what holds the name: `{ table: "Summary",
   * column: "Total" }`. A rename or a move rewrites its page and holder as it
   * rewrites a reference's page and table.
   */
  qualified?: true;
}

/** A bare name or function name and the span of the token that writes it. */
export interface LocatedName {
  node: Node;
  from: number;
  to: number;
}

class Parser {
  /** Every reference in the formula, in the order written. */
  readonly references: LocatedReference[] = [];
  /** Every bare name token, including names that may be bound by LET or LAMBDA. */
  readonly names: LocatedName[] = [];
  private index = 0;
  /** Where the most recently consumed token ends. */
  private consumedTo = 0;

  constructor(
    private readonly tokens: readonly Token[],
    private readonly text: string,
  ) {}

  parse(): Node {
    try {
      const node = this.expression(0);
      const token = this.peek();
      if (token.type !== "end") throw this.unexpected(token);
      return node;
    } catch (cause) {
      if (!(cause instanceof FormulaSyntaxError)) throw cause;
      const hint = this.unquotedNameAt(cause.position);
      if (hint === undefined) throw cause;
      throw new FormulaSyntaxError(
        `${cause.message} — If ${hint.name} is a table or page name, put it in single quotes: ${hint.example}`,
        cause.position,
        cause.code,
      );
    }
  }

  /** Only suggest quotes for a run of words at the failure that ends in a reference qualifier. */
  private unquotedNameAt(position: number): { name: string; example: string } | undefined {
    const isWord = (token: Token): boolean =>
      token.type === "identifier" || token.type === "number";
    let start = 0;
    for (const [index, token] of this.tokens.entries()) {
      if (isWord(token)) continue;
      const words = this.tokens.slice(start, index);
      const first = words[0];
      const last = words.at(-1);
      const before = this.tokens[start - 1];
      if (
        words.length > 1 &&
        first?.type === "identifier" &&
        last &&
        (before === undefined ||
          before.type === "operator" ||
          (before.type === "punctuation" && (before.value === "(" || before.value === ","))) &&
        position >= first.position &&
        position <= token.position &&
        token.position === last.end &&
        (token.type === "column" || (token.type === "punctuation" && token.value === "!")) &&
        /\s/.test(this.text.slice(first.position, last.end)) &&
        words.slice(1).every((word, offset) => {
          const previous = words[offset];
          return (
            previous !== undefined &&
            (/^\s+$/.test(this.text.slice(previous.end, word.position)) ||
              (previous.type === "number" &&
                word.type === "identifier" &&
                previous.end === word.position))
          );
        })
      ) {
        const name = this.text.slice(first.position, last.end);
        const end =
          token.type === "column" ? token.end : (this.tokens[index + 1]?.end ?? token.end);
        return { name, example: `'${name}'${this.text.slice(token.position, end)}` };
      }
      start = index + 1;
    }
    return undefined;
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
    const first = this.peek();
    let left: Node;
    if (first.type === "operator" && first.value === "not") {
      this.next();
      left = { type: "unary", operator: "not", operand: this.expression(3) };
    } else left = this.unary();
    for (;;) {
      const token = this.peek();
      if (token.type !== "operator" || token.value === "not") return left;
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
        if (!this.isPunctuation("!")) {
          const node: Node = { type: "name", name: token.value };
          this.locatedName(node, token.position, token.end);
          return node;
        }
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
      const node: Node = { type: "call", name: name.toUpperCase(), args: this.arguments() };
      this.locatedName(node, position, token.end);
      return node;
    }

    const upper = name.toUpperCase();
    if (upper === "TRUE") return { type: "boolean", value: true };
    if (upper === "FALSE") return { type: "boolean", value: false };

    // A lone column such as `A` is only a reference as the start of a range.
    if (!start || (!isCell && !this.isPunctuation(":"))) {
      const node: Node = { type: "name", name };
      this.locatedName(node, position, token.end);
      return node;
    }
    return this.located(this.rangeFrom(start, token), position);
  }

  private locatedName(node: Node, from: number, to: number): void {
    this.names.push({ node, from, to });
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
      const where = page === undefined ? {} : { page };
      this.references.push({
        reference: { ...where, table: holder, column: token.value },
        from: position,
        to: this.consumedTo,
        qualified: true,
      });
      return { type: "qualified", ...where, holder, name: token.value };
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
  names: LocatedName[];
} {
  const parser = new Parser(tokenize(text), text);
  const ast = parser.parse();
  return { ast, references: parser.references, names: parser.names };
}
