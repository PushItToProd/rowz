import { columnIndex } from "./address";
import type { BinaryOperator, Node } from "./ast";

/**
 * The language of `QUERY`: SQL's `SELECT` over the columns of a range.
 *
 *     SELECT A, SUM(C) WHERE B = "Fruit" GROUP BY A ORDER BY SUM(C) DESC LIMIT 3
 *
 * A query is parsed into the formula engine's own expression nodes, so a
 * query expression can call any function a formula can. A column becomes a
 * name that the caller binds to that column's cell for each row.
 */
export class QuerySyntaxError extends Error {}

export interface SelectItem {
  expression: Node;
  /** The item as written, which names its column when nothing better does. */
  text: string;
  alias?: string;
}

export interface Query {
  /** `null` for `SELECT *` or no `SELECT` clause: every column. */
  select: SelectItem[] | null;
  where?: Node;
  groupBy: Node[];
  pivot: Node[];
  having?: Node;
  orderBy: { expression: Node; descending: boolean }[];
  limit?: number;
  offset: number;
  labels: { expression: Node; label: string }[];
}

/** Query functions that combine the rows of a group, and the formula function each one uses. */
export const AGGREGATES: Readonly<Record<string, string>> = {
  SUM: "SUM",
  AVG: "AVERAGE",
  AVERAGE: "AVERAGE",
  // As in SQL, COUNT counts the rows that have a value, of any kind.
  COUNT: "COUNTA",
  COUNTA: "COUNTA",
  MIN: "MIN",
  MAX: "MAX",
  MEDIAN: "MEDIAN",
  MODE: "MODE",
  STDEV: "STDEV",
  STDEVP: "STDEVP",
  VAR_S: "VAR_S",
  VAR_P: "VAR_P",
  COUNTUNIQUE: "COUNTUNIQUE",
};

/** The name a column's cell is bound to while a row is evaluated. `$` keeps it apart from names a formula can write. */
export function columnName(index: number): string {
  return `$${String(index)}`;
}

/** The column a node names, if it is a plain column. */
export function columnOf(node: Node): number | undefined {
  return node.type === "name" && /^\$\d+$/.test(node.name) ? Number(node.name.slice(1)) : undefined;
}

/** Whether a node is a call that combines the rows of a group. `MAX(A, B)` with two arguments is the ordinary function. */
export function isAggregate(node: Node): boolean {
  return node.type === "call" && node.name in AGGREGATES && node.args.length <= 1;
}

export function children(node: Node): readonly Node[] {
  switch (node.type) {
    case "unary":
      return [node.operand];
    case "binary":
      return [node.left, node.right];
    case "call":
      return node.args;
    case "apply":
      return [node.target, ...node.args];
    default:
      return [];
  }
}

export function hasAggregate(node: Node): boolean {
  return isAggregate(node) || children(node).some(hasAggregate);
}

type TokenKind = "word" | "number" | "string" | "quoted" | "symbol" | "end";

interface Token {
  kind: TokenKind;
  /** A word in upper case, the content of a string or quoted name, or the symbol. */
  value: string;
  from: number;
  to: number;
}

const SYMBOLS = ["<=", ">=", "<>", "!=", "(", ")", ",", "*", "+", "-", "/", "=", "<", ">", "&"];
const WORD = /[A-Za-z_][A-Za-z0-9_.]*/y;
const NUMBER = /\d+(?:\.\d+)?|\.\d+/y;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  const match = (pattern: RegExp): string | undefined => {
    pattern.lastIndex = index;
    return pattern.exec(source)?.[0];
  };
  while (index < source.length) {
    const char = source[index] ?? "";
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const from = index;
    if (char === "'" || char === '"') {
      // A doubled quote inside the text stands for one quote.
      let value = "";
      index += 1;
      for (;;) {
        if (index >= source.length) throw new QuerySyntaxError(`${char} is never closed`);
        if (source[index] === char) {
          if (source[index + 1] !== char) break;
          index += 1;
        }
        value += source[index] ?? "";
        index += 1;
      }
      index += 1;
      tokens.push({ kind: char === "'" ? "quoted" : "string", value, from, to: index });
      continue;
    }
    const number = match(NUMBER);
    const word = number === undefined ? match(WORD) : undefined;
    const symbol = SYMBOLS.find((candidate) => source.startsWith(candidate, index));
    const found = number ?? word ?? symbol;
    if (found === undefined) throw new QuerySyntaxError(`The query cannot contain ${char}`);
    index += found.length;
    tokens.push({
      kind: number !== undefined ? "number" : word !== undefined ? "word" : "symbol",
      value: word !== undefined ? found.toUpperCase() : found,
      from,
      to: index,
    });
  }
  tokens.push({ kind: "end", value: "", from: source.length, to: source.length });
  return tokens;
}

/** Words that begin a clause, and so end the expression before them. */
const CLAUSES = [
  "SELECT",
  "WHERE",
  "GROUP",
  "PIVOT",
  "HAVING",
  "ORDER",
  "LIMIT",
  "OFFSET",
  "LABEL",
];
/** Words that are part of the language and cannot name a column without single quotes. */
const RESERVED = new Set([
  ...CLAUSES,
  ...["BY", "AND", "OR", "NOT", "AS", "ASC", "DESC", "IN", "IS", "NULL", "CONTAINS", "STARTS"],
  ...["ENDS", "WITH", "LIKE", "MATCHES", "TRUE", "FALSE", "DATE"],
]);

const COMPARISONS: Readonly<Record<string, BinaryOperator>> = {
  "=": "=",
  "!=": "<>",
  "<>": "<>",
  "<": "<",
  ">": ">",
  "<=": "<=",
  ">=": ">=",
};

function call(name: string, ...args: Node[]): Node {
  return { type: "call", name, args };
}

function binary(operator: BinaryOperator, left: Node, right: Node): Node {
  return { type: "binary", operator, left, right };
}

/**
 * A comparison that an empty cell never passes, as in SQL. A formula would
 * count the empty cell as 0, and `WHERE C < 5` would then keep rows with no
 * value in C.
 */
function compared(operator: BinaryOperator, left: Node, right: Node): Node {
  const filled = [left, right]
    .filter((side) => side.type !== "number" && side.type !== "string" && side.type !== "boolean")
    .map((side) => call("NOT", call("ISBLANK", side)));
  const comparison = binary(operator, left, right);
  return filled.length === 0 ? comparison : call("AND", ...filled, comparison);
}

export interface Columns {
  count: number;
  /** The column with a header, compared without regard to case, or `undefined`. */
  byHeader(name: string): number | undefined;
}

class Parser {
  private index = 0;
  private readonly tokens: Token[];
  private readonly aliases = new Map<string, Node>();

  constructor(
    private readonly source: string,
    private readonly columns: Columns,
  ) {
    this.tokens = tokenize(source);
  }

  parse(): Query {
    const query: Query = {
      select: null,
      groupBy: [],
      pivot: [],
      orderBy: [],
      offset: 0,
      labels: [],
    };
    // Any clause may use a name that SELECT gives with AS, and clauses come in
    // any order, so a SELECT written after another clause is read before it.
    const selectAt = this.tokens.findIndex(
      (token) => token.kind === "word" && token.value === "SELECT",
    );
    let afterSelect = selectAt;
    if (selectAt > 0) {
      this.index = selectAt + 1;
      query.select = this.select();
      afterSelect = this.index;
      this.index = 0;
    }

    const seen = new Set<string>();
    while (this.peek().kind !== "end") {
      const clause = this.peek();
      if (clause.kind !== "word" || !CLAUSES.includes(clause.value)) {
        throw new QuerySyntaxError(
          `Expected a clause such as SELECT or WHERE, not ${this.written(clause)}`,
        );
      }
      if (seen.has(clause.value)) throw new QuerySyntaxError(`${clause.value} appears twice`);
      seen.add(clause.value);
      if (selectAt > 0 && this.index === selectAt) {
        this.index = afterSelect;
        continue;
      }
      this.index += 1;
      this.clause(clause.value, query);
    }
    return query;
  }

  private clause(name: string, query: Query): void {
    switch (name) {
      case "SELECT":
        query.select = this.select();
        break;
      case "WHERE":
        query.where = this.expression();
        break;
      case "GROUP":
        this.expect("BY");
        query.groupBy = this.list(() => this.expression());
        break;
      case "PIVOT":
        query.pivot = this.list(() => this.expression());
        break;
      case "HAVING":
        query.having = this.expression();
        break;
      case "ORDER":
        this.expect("BY");
        query.orderBy = this.list(() => {
          const expression = this.expression();
          const descending = this.word("DESC");
          if (!descending) this.word("ASC");
          return { expression, descending };
        });
        break;
      case "LIMIT":
        query.limit = this.count("LIMIT");
        break;
      case "OFFSET":
        query.offset = this.count("OFFSET");
        break;
      case "LABEL":
        query.labels = this.list(() => {
          const expression = this.expression();
          const label = this.next();
          if (label.kind !== "string") {
            throw new QuerySyntaxError("LABEL needs text in double quotes after each column");
          }
          return { expression, label: label.value };
        });
        break;
    }
  }

  private select(): SelectItem[] | null {
    if (this.symbol("*")) return null;
    return this.list(() => {
      const from = this.peek().from;
      const expression = this.expression();
      const text = this.source.slice(from, this.tokens[this.index - 1]?.to ?? from);
      if (!this.word("AS")) return { expression, text };
      const name = this.next();
      if (name.kind !== "word" && name.kind !== "quoted") {
        throw new QuerySyntaxError("AS needs a name after it");
      }
      const alias = name.kind === "word" ? this.source.slice(name.from, name.to) : name.value;
      this.aliases.set(alias.toLowerCase(), expression);
      return { expression, text, alias };
    });
  }

  private list<T>(item: () => T): T[] {
    const items = [item()];
    while (this.symbol(",")) items.push(item());
    return items;
  }

  private count(clause: string): number {
    const token = this.next();
    const value = Number(token.value);
    if (token.kind !== "number" || !Number.isInteger(value)) {
      throw new QuerySyntaxError(`${clause} needs a whole number`);
    }
    return value;
  }

  private expression(): Node {
    let left = this.conjunction();
    while (this.word("OR")) left = call("OR", left, this.conjunction());
    return left;
  }

  private conjunction(): Node {
    let left = this.negation();
    while (this.word("AND")) left = call("AND", left, this.negation());
    return left;
  }

  private negation(): Node {
    return this.word("NOT") ? call("NOT", this.negation()) : this.comparison();
  }

  private comparison(): Node {
    const left = this.sum();
    const token = this.peek();
    if (token.kind === "symbol" && token.value in COMPARISONS) {
      this.index += 1;
      return compared(COMPARISONS[token.value] ?? "=", left, this.sum());
    }
    if (token.kind !== "word") return left;
    if (this.word("IS")) {
      const negated = this.word("NOT");
      this.expect("NULL");
      const blank = call("ISBLANK", left);
      return negated ? call("NOT", blank) : blank;
    }
    // `a NOT IN (...)` and `a NOT LIKE ...` put the NOT after the left side.
    const negated = this.word("NOT");
    const test = this.textTest(left);
    if (!test) {
      if (negated) throw new QuerySyntaxError("Expected IN, LIKE, or CONTAINS after NOT");
      return left;
    }
    return negated ? call("NOT", test) : test;
  }

  /** The tests written as words: `IN`, `CONTAINS`, `STARTS WITH`, `ENDS WITH`, `LIKE`. */
  private textTest(left: Node): Node | undefined {
    if (this.word("IN")) {
      this.expectSymbol("(");
      const choices = this.list(() => this.sum());
      this.expectSymbol(")");
      return call("OR", ...choices.map((choice) => binary("=", left, choice)));
    }
    // SEARCH fails when the text is absent, and ISNUMBER turns that failure into FALSE.
    if (this.word("CONTAINS")) return call("ISNUMBER", call("SEARCH", this.sum(), left));
    if (this.word("STARTS")) {
      this.expect("WITH");
      const prefix = this.sum();
      return binary("=", call("LEFT", left, call("LEN", prefix)), prefix);
    }
    if (this.word("ENDS")) {
      this.expect("WITH");
      const suffix = this.sum();
      return binary("=", call("RIGHT", left, call("LEN", suffix)), suffix);
    }
    if (this.word("LIKE")) {
      const pattern = this.next();
      if (pattern.kind !== "string")
        throw new QuerySyntaxError("LIKE needs a pattern in double quotes");
      // SQL's `%` and `_` are the `*` and `?` that COUNTIF matches with.
      const wildcard = pattern.value.replaceAll("%", "*").replaceAll("_", "?");
      return binary(">", call("COUNTIF", left, { type: "string", value: wildcard }), {
        type: "number",
        value: 0,
      });
    }
    if (this.word("MATCHES")) {
      throw new QuerySyntaxError("MATCHES is not supported. Use LIKE, CONTAINS, or STARTS WITH");
    }
    return undefined;
  }

  private sum(): Node {
    let left = this.product();
    for (;;) {
      const operator = this.symbol("+")
        ? "+"
        : this.symbol("-")
          ? "-"
          : this.symbol("&")
            ? "&"
            : "";
      if (operator === "") return left;
      left = binary(operator, left, this.product());
    }
  }

  private product(): Node {
    let left = this.unary();
    for (;;) {
      const operator = this.symbol("*") ? "*" : this.symbol("/") ? "/" : "";
      if (operator === "") return left;
      left = binary(operator, left, this.unary());
    }
  }

  private unary(): Node {
    return this.symbol("-")
      ? { type: "unary", operator: "-", operand: this.unary() }
      : this.primary();
  }

  private primary(): Node {
    const token = this.next();
    switch (token.kind) {
      case "number":
        return { type: "number", value: Number(token.value) };
      case "string":
        return { type: "string", value: token.value };
      case "quoted":
        return this.column(token.value, token);
      case "symbol": {
        if (token.value !== "(") break;
        const inner = this.expression();
        this.expectSymbol(")");
        return inner;
      }
      case "word":
        return this.named(token);
      case "end":
        throw new QuerySyntaxError("The query ends where a value was expected");
    }
    throw new QuerySyntaxError(`${this.written(token)} cannot start a value`);
  }

  private named(token: Token): Node {
    if (token.value === "TRUE" || token.value === "FALSE") {
      return { type: "boolean", value: token.value === "TRUE" };
    }
    if (token.value === "DATE" && this.peek().kind === "string") {
      return call("DATEVALUE", { type: "string", value: this.next().value });
    }
    if (this.symbol("(")) {
      // `COUNT(*)` counts rows, which is an aggregate with no argument.
      if (this.symbol("*")) {
        this.expectSymbol(")");
        return call(token.value);
      }
      const args = this.symbol(")") ? [] : this.list(() => this.expression());
      if (args.length > 0) this.expectSymbol(")");
      return call(token.value, ...args);
    }
    if (RESERVED.has(token.value)) {
      throw new QuerySyntaxError(`${this.written(token)} cannot be used as a value here`);
    }
    return this.column(this.written(token), token);
  }

  /** Reads a column: a name given with AS, `Col1`, a header, or a column letter counted from the range's first column. */
  private column(name: string, token: Token): Node {
    const alias = this.aliases.get(name.toLowerCase());
    if (alias) return alias;
    const numbered = token.kind === "word" ? /^col(\d+)$/i.exec(name) : null;
    const letter =
      token.kind === "word" && /^[A-Za-z]{1,3}$/.test(name)
        ? columnIndex(name.toUpperCase())
        : undefined;
    const index =
      (numbered ? Number(numbered[1]) - 1 : undefined) ?? this.columns.byHeader(name) ?? letter;
    if (index === undefined || index < 0 || index >= this.columns.count) {
      throw new QuerySyntaxError(`The data has no column ${name}`);
    }
    return { type: "name", name: columnName(index) };
  }

  private peek(ahead = 0): Token {
    const token = this.tokens[this.index + ahead] ?? this.tokens.at(-1);
    if (!token) throw new QuerySyntaxError("The query is empty");
    return token;
  }

  private next(): Token {
    const token = this.peek();
    if (token.kind !== "end") this.index += 1;
    return token;
  }

  private word(value: string): boolean {
    const token = this.peek();
    if (token.kind !== "word" || token.value !== value) return false;
    this.index += 1;
    return true;
  }

  private symbol(value: string): boolean {
    const token = this.peek();
    if (token.kind !== "symbol" || token.value !== value) return false;
    this.index += 1;
    return true;
  }

  private expect(value: string): void {
    if (!this.word(value)) {
      throw new QuerySyntaxError(`Expected ${value}, not ${this.written(this.peek())}`);
    }
  }

  private expectSymbol(value: string): void {
    if (!this.symbol(value)) {
      throw new QuerySyntaxError(`Expected ${value}, not ${this.written(this.peek())}`);
    }
  }

  private written(token: Token): string {
    return token.kind === "end" ? "the end of the query" : this.source.slice(token.from, token.to);
  }
}

export function parseQuery(source: string, columns: Columns): Query {
  return new Parser(source, columns).parse();
}
