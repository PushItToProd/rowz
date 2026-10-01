export type Token =
  | { type: "number"; value: number; position: number }
  | { type: "string"; value: string; position: number }
  /** A bare word: function name, cell address, boolean, or unquoted table name. */
  | { type: "identifier"; value: string; position: number }
  /** A single-quoted page or table name. */
  | { type: "quotedName"; value: string; position: number }
  | { type: "operator"; value: Operator; position: number }
  | { type: "punctuation"; value: Punctuation; position: number }
  | { type: "end"; position: number };

export type Operator = "+" | "-" | "*" | "/" | "^" | "&" | "=" | "<>" | "<" | ">" | "<=" | ">=";
export type Punctuation = "(" | ")" | "," | ":" | "!";

export class FormulaSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
    /** The error a cell shows for this failure. */
    readonly code: "#ERROR!" | "#NAME?" = "#ERROR!",
  ) {
    super(message);
    this.name = "FormulaSyntaxError";
  }
}

const WHITESPACE = /\s+/y;
const NUMBER = /(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const IDENTIFIER = /[$A-Za-z_][$A-Za-z0-9_.]*/y;
// Longest operators first so `<=` is not read as `<` then `=`.
const OPERATORS: readonly Operator[] = [
  "<>",
  "<=",
  ">=",
  "+",
  "-",
  "*",
  "/",
  "^",
  "&",
  "=",
  "<",
  ">",
];
const PUNCTUATION: readonly Punctuation[] = ["(", ")", ",", ":", "!"];

function matchAt(pattern: RegExp, text: string, position: number): string | undefined {
  pattern.lastIndex = position;
  return pattern.exec(text)?.[0];
}

/**
 * Reads a quoted literal starting at `position`. The quote character is
 * escaped by doubling it.
 */
function readQuoted(text: string, position: number, quote: string): { value: string; end: number } {
  let value = "";
  let index = position + 1;
  while (index < text.length) {
    if (text[index] !== quote) {
      value += text.charAt(index);
      index += 1;
    } else if (text[index + 1] === quote) {
      value += quote;
      index += 2;
    } else {
      return { value, end: index + 1 };
    }
  }
  throw new FormulaSyntaxError(`Missing closing ${quote}`, position);
}

/** Splits formula text (without the leading `=`) into tokens, ending with an `end` token. */
export function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let position = 0;

  while (position < text.length) {
    const whitespace = matchAt(WHITESPACE, text, position);
    if (whitespace !== undefined) {
      position += whitespace.length;
      continue;
    }

    const char = text.charAt(position);
    if (char === '"' || char === "'") {
      const { value, end } = readQuoted(text, position, char);
      tokens.push({ type: char === '"' ? "string" : "quotedName", value, position });
      position = end;
      continue;
    }

    const number = matchAt(NUMBER, text, position);
    if (number !== undefined) {
      const value = Number(number);
      if (!Number.isFinite(value)) {
        throw new FormulaSyntaxError(`Number out of range: ${number}`, position);
      }
      tokens.push({ type: "number", value, position });
      position += number.length;
      continue;
    }

    const identifier = matchAt(IDENTIFIER, text, position);
    if (identifier !== undefined) {
      tokens.push({ type: "identifier", value: identifier, position });
      position += identifier.length;
      continue;
    }

    const operator = OPERATORS.find((candidate) => text.startsWith(candidate, position));
    if (operator !== undefined) {
      tokens.push({ type: "operator", value: operator, position });
      position += operator.length;
      continue;
    }

    const punctuation = PUNCTUATION.find((candidate) => candidate === char);
    if (punctuation !== undefined) {
      tokens.push({ type: "punctuation", value: punctuation, position });
      position += 1;
      continue;
    }

    throw new FormulaSyntaxError(`Unexpected character ${char}`, position);
  }

  tokens.push({ type: "end", position });
  return tokens;
}
