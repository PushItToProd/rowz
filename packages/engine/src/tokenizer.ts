import { ERROR_CODES, type ErrorCode } from "./values";

/** Where a token sits in the formula text: `position` is its first character and `end` is one past its last. */
interface Span {
  position: number;
  end: number;
}

export type Token = Span &
  (
    | { type: "number"; value: number }
    | { type: "string"; value: string }
    /** A bare word: function name, cell address, boolean, or unquoted table name. */
    | { type: "identifier"; value: string }
    /** A single-quoted page or table name. */
    | { type: "quotedName"; value: string }
    /** A column name in square brackets, as in `[Price]`. */
    | { type: "column"; value: string }
    /** An error written out in a formula, such as the `#REF!` left where a deleted cell was named. */
    | { type: "error"; value: ErrorCode }
    | { type: "operator"; value: Operator }
    | { type: "punctuation"; value: Punctuation }
    | { type: "end" }
  );

export type Operator =
  | "+"
  | "-"
  | "*"
  | "/"
  | "^"
  | "&"
  | "="
  | "<>"
  | "!="
  | "<"
  | ">"
  | "<="
  | ">="
  | "and"
  | "or"
  | "not";
export type Punctuation = "(" | ")" | "," | ":" | "!";

/** Editor tokens retain unfinished literals and invalid characters without changing evaluation. */
export type EditingToken = Token | (Span & { type: "invalid"; value: string });

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
  "!=",
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
function readQuoted(
  text: string,
  position: number,
  quote: string,
  tolerant = false,
): { value: string; end: number } {
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
  if (tolerant) return { value, end: text.length };
  throw new FormulaSyntaxError(`Missing closing ${quote}`, position);
}

/** Splits formula text (without the leading `=`) into tokens, ending with an `end` token. */
export function tokenize(text: string): Token[] {
  return scanTokens(text, false) as Token[];
}

/** Reads formula fragments for editing, including text after an invalid character. */
export function tokenizeForEditing(text: string): EditingToken[] {
  return scanTokens(text, true);
}

function scanTokens(text: string, tolerant: boolean): EditingToken[] {
  const tokens: EditingToken[] = [];
  let position = 0;

  while (position < text.length) {
    const whitespace = matchAt(WHITESPACE, text, position);
    if (whitespace !== undefined) {
      position += whitespace.length;
      continue;
    }

    const char = text.charAt(position);
    if (char === '"' || char === "'") {
      const { value, end } = readQuoted(text, position, char, tolerant);
      tokens.push({ type: char === '"' ? "string" : "quotedName", value, position, end });
      position = end;
      continue;
    }

    if (char === "[") {
      const close = text.indexOf("]", position);
      const end = close === -1 ? text.length : close + 1;
      const name = text.slice(position + 1, close === -1 ? text.length : close).trim();
      if (close === -1 && !tolerant) throw new FormulaSyntaxError("Missing closing ]", position);
      if (name === "" || name.includes("[")) {
        if (!tolerant)
          throw new FormulaSyntaxError("Expected a column name between [ and ]", position);
      }
      tokens.push({ type: "column", value: name, position, end });
      position = end;
      continue;
    }

    const errorCode = ERROR_CODES.find((code) => text.startsWith(code, position));
    if (errorCode !== undefined) {
      tokens.push({ type: "error", value: errorCode, position, end: position + errorCode.length });
      position += errorCode.length;
      continue;
    }

    const number = matchAt(NUMBER, text, position);
    if (number !== undefined) {
      const value = Number(number);
      if (!Number.isFinite(value) && !tolerant) {
        throw new FormulaSyntaxError(`Number out of range: ${number}`, position);
      }
      tokens.push({ type: "number", value, position, end: position + number.length });
      position += number.length;
      continue;
    }

    const identifier = matchAt(IDENTIFIER, text, position);
    if (identifier !== undefined) {
      tokens.push({
        type: "identifier",
        value: identifier,
        position,
        end: position + identifier.length,
      });
      position += identifier.length;
      continue;
    }

    const operator = OPERATORS.find((candidate) => text.startsWith(candidate, position));
    if (operator !== undefined) {
      tokens.push({ type: "operator", value: operator, position, end: position + operator.length });
      position += operator.length;
      continue;
    }

    const punctuation = PUNCTUATION.find((candidate) => candidate === char);
    if (punctuation !== undefined) {
      tokens.push({ type: "punctuation", value: punctuation, position, end: position + 1 });
      position += 1;
      continue;
    }

    if (!tolerant) throw new FormulaSyntaxError(`Unexpected character ${char}`, position);
    tokens.push({ type: "invalid", value: char, position, end: position + 1 });
    position += 1;
  }

  tokens.push({ type: "end", position, end: position });
  return booleanOperators(tokens, text, tolerant);
}

/** Keywords are contextual so calls, qualifiers, range corners, and columns keep their names. */
function booleanOperators(tokens: EditingToken[], text: string, tolerant: boolean): EditingToken[] {
  let expectsValue = true;
  const punctuation = (token: EditingToken | undefined, value: string): boolean =>
    token?.type === "punctuation" && token.value === value;
  return tokens.map((token, index) => {
    const previous = tokens[index - 1];
    const next = tokens[index + 1];
    if (token.type === "identifier") {
      const keyword = token.value.toLowerCase();
      const qualified =
        punctuation(previous, "!") ||
        punctuation(previous, ":") ||
        punctuation(next, "!") ||
        punctuation(next, ":") ||
        (next?.type === "column" && next.position === token.end);
      const separated = next !== undefined && /\s/.test(text.slice(token.end, next.position));
      const beginsOperand =
        next !== undefined &&
        (["identifier", "number", "string", "quotedName", "column", "error"].includes(next.type) ||
          punctuation(next, "(") ||
          (tolerant && next.type === "end"));
      const prefix = keyword === "not" && expectsValue && separated && beginsOperand;
      if (!qualified && ((!expectsValue && (keyword === "and" || keyword === "or")) || prefix)) {
        expectsValue = true;
        return { ...token, type: "operator", value: keyword as Operator };
      }
    }
    expectsValue =
      token.type === "operator" || (token.type === "punctuation" && token.value !== ")");
    return token;
  });
}
