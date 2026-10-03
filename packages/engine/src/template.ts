import { rewriteBareNames, rewriteReferences, type Replace } from "./rewrite";
import {
  error,
  formatValue,
  isChart,
  isError,
  isMarkdown,
  isRange,
  isScalar,
  toBoolean,
  type CellValue,
  type ChartValue,
  type Evaluated,
} from "./values";

/**
 * A text view is Markdown with tags that put spreadsheet values into it.
 *
 *     {{ expression }}                          the value of a formula
 *     {% let name = expression %}               a name for a value
 *     {% for a, b in expression %} ... {% end %}   once per row, naming its cells
 *     {% if expression %} ... {% else %} ... {% end %}
 *     {# a comment #}
 *
 * An expression is a formula without the leading `=`. It is written on a
 * page, not in a table, so it names the table of every cell it reads.
 */
export type TemplateNode =
  | { type: "text"; text: string }
  | { type: "output"; expression: string }
  | { type: "let"; name: string; expression: string }
  | { type: "for"; names: string[]; expression: string; body: TemplateNode[] }
  | { type: "if"; expression: string; then: TemplateNode[]; otherwise: TemplateNode[] };

export class TemplateSyntaxError extends Error {
  constructor(
    message: string,
    /** The line of the template the problem is on, counting from 1. */
    readonly line: number,
  ) {
    super(message);
    this.name = "TemplateSyntaxError";
  }
}

/** One part of what a text view shows. Markdown runs until a table or chart interrupts it. */
export type TemplateBlock =
  | { type: "markdown"; text: string }
  | { type: "table"; rows: CellValue[][] }
  | { type: "chart"; chart: ChartValue }
  | { type: "error"; message: string };

interface Span {
  from: number;
  to: number;
}

interface FormulaSpan extends Span {
  bound: ReadonlySet<string>;
}

interface Tag extends Span {
  kind: "output" | "statement" | "comment";
  /** The text between the delimiters, and where it starts in the template. */
  inner: string;
  innerFrom: number;
}

const OPENERS = { "{{": "output", "{%": "statement", "{#": "comment" } as const;
const CLOSERS = { output: "}}", statement: "%}", comment: "#}" } as const;
const NAME = "[A-Za-z_][A-Za-z0-9_]*";
const LET = new RegExp(`^(\\s*let\\s+)(${NAME})(\\s*=\\s*)(\\S[\\s\\S]*)$`);
const FOR = new RegExp(`^(\\s*for\\s+)(${NAME}(?:\\s*,\\s*${NAME})*)(\\s+in\\s+)(\\S[\\s\\S]*)$`);
const IF = /^(\s*if\s+)(\S[\s\S]*)$/;
const CELL_LIKE = /^[A-Za-z]{1,3}[0-9]+$/;

// A view that loops more than this is almost certainly a mistake, and would freeze the page.
const MAX_ITERATIONS = 10_000;

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

/** Finds where a tag closes, skipping over quoted text, which may hold the closing characters. */
function closeOf(source: string, from: number, closer: string, quotes: boolean): number {
  let quote: string | undefined;
  for (let index = from; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (quotes && (char === '"' || char === "'")) {
      quote = char;
    } else if (source.startsWith(closer, index)) {
      return index;
    }
  }
  return -1;
}

function findTags(source: string): Tag[] {
  const tags: Tag[] = [];
  for (let index = source.indexOf("{"); index !== -1; index = source.indexOf("{", index)) {
    const opener = source.slice(index, index + 2);
    if (!(opener in OPENERS)) {
      index += 1;
      continue;
    }
    const kind = OPENERS[opener as keyof typeof OPENERS];
    const closer = CLOSERS[kind];
    const close = closeOf(source, index + 2, closer, kind !== "comment");
    if (close === -1)
      throw new TemplateSyntaxError(`${opener} is never closed`, lineAt(source, index));
    tags.push({
      kind,
      from: index,
      to: close + closer.length,
      inner: source.slice(index + 2, close),
      innerFrom: index + 2,
    });
    index = close + closer.length;
  }
  return tags;
}

/**
 * The text between tags. A statement or comment that has a line to itself
 * takes that whole line with it, so it leaves no blank line behind.
 */
function textBetween(source: string, tags: readonly Tag[]): string[] {
  const texts: string[] = [];
  let from = 0;
  for (const tag of tags) {
    let to = tag.from;
    let next = tag.to;
    if (tag.kind !== "output") {
      // Tested against the whole line, so a tag that shares its line with another keeps its spaces.
      const before = /(^|\n)[ \t]*$/.exec(source.slice(0, to));
      const after = /^[ \t]*(\n|$)/.exec(source.slice(next));
      if (before && after) {
        to -= before[0].length - (before[1] ?? "").length;
        next += after[0].length;
      }
    }
    texts.push(source.slice(from, to));
    from = next;
  }
  texts.push(source.slice(from));
  return texts;
}

type Statement =
  | { type: "let"; name: string; expression: Span }
  | { type: "for"; names: string[]; expression: Span }
  | { type: "if"; expression: Span }
  | { type: "else" }
  | { type: "end" };

function parseStatement(source: string, tag: Tag): Statement {
  const line = lineAt(source, tag.from);
  const word = tag.inner.trim();
  if (word === "else") return { type: "else" };
  if (word === "end" || word === "endfor" || word === "endif") return { type: "end" };

  /** The place in the template of the expression that ends a tag whose earlier parts are `before`. */
  const tail = (before: readonly string[]): Span => {
    const from = tag.innerFrom + before.join("").length;
    return { from, to: tag.innerFrom + tag.inner.trimEnd().length };
  };
  const checked = (names: string[]): string[] => {
    const cell = names.find((name) => CELL_LIKE.test(name));
    if (cell !== undefined) {
      throw new TemplateSyntaxError(`${cell} is a cell address and cannot be used as a name`, line);
    }
    return names;
  };

  const bind = LET.exec(tag.inner);
  if (bind) {
    const [, keyword = "", name = "", equals = ""] = bind;
    return {
      type: "let",
      name: checked([name])[0] ?? name,
      expression: tail([keyword, name, equals]),
    };
  }
  const loop = FOR.exec(tag.inner);
  if (loop) {
    const [, keyword = "", names = "", separator = ""] = loop;
    return {
      type: "for",
      names: checked(names.split(",").map((name) => name.trim())),
      expression: tail([keyword, names, separator]),
    };
  }
  const condition = IF.exec(tag.inner);
  if (condition) return { type: "if", expression: tail([condition[1] ?? ""]) };
  throw new TemplateSyntaxError(`{% ${word} %} is not a tag this view understands`, line);
}

/** Where each formula expression sits, with the template variables bound at its point. */
function expressionSpans(source: string): FormulaSpan[] {
  const spans: FormulaSpan[] = [];
  let bound = new Set<string>();
  const open: { type: "for" | "if"; outer: Set<string> }[] = [];
  for (const tag of findTags(source)) {
    if (tag.kind === "comment") continue;
    if (tag.kind === "output") {
      spans.push({
        from: tag.innerFrom,
        to: tag.innerFrom + tag.inner.length,
        bound: new Set(bound),
      });
      continue;
    }
    const statement = parseStatement(source, tag);
    if ("expression" in statement) {
      spans.push({ ...statement.expression, bound: new Set(bound) });
    }
    switch (statement.type) {
      case "let":
        bound.add(statement.name.toLowerCase());
        break;
      case "for":
        open.push({ type: "for", outer: bound });
        bound = new Set(bound);
        for (const name of statement.names) bound.add(name.toLowerCase());
        break;
      case "if":
        open.push({ type: "if", outer: bound });
        bound = new Set(bound);
        break;
      case "else": {
        const block = open.at(-1);
        if (block?.type === "if") bound = new Set(block.outer);
        break;
      }
      case "end": {
        const block = open.pop();
        if (block) bound = new Set(block.outer);
        break;
      }
    }
  }
  return spans;
}

/**
 * Parses a text view's source.
 * @throws TemplateSyntaxError when a tag is malformed or a block is not closed.
 */
export function parseTemplate(source: string): TemplateNode[] {
  const tags = findTags(source);
  const texts = textBetween(source, tags);
  const root: TemplateNode[] = [];
  /** The blocks the parser is inside, innermost last. `into` is where nodes go now. */
  const open: {
    node: TemplateNode & { type: "for" | "if" };
    into: TemplateNode[];
    line: number;
  }[] = [];
  const target = (): TemplateNode[] => open.at(-1)?.into ?? root;
  const addText = (text: string): void => {
    if (text !== "") target().push({ type: "text", text });
  };

  addText(texts[0] ?? "");
  tags.forEach((tag, index) => {
    const line = lineAt(source, tag.from);
    if (tag.kind === "output") {
      target().push({ type: "output", expression: tag.inner.trim() });
    } else if (tag.kind === "statement") {
      const statement = parseStatement(source, tag);
      const expression =
        "expression" in statement
          ? source.slice(statement.expression.from, statement.expression.to)
          : "";
      switch (statement.type) {
        case "let":
          target().push({ type: "let", name: statement.name, expression });
          break;
        case "for": {
          const node = { type: "for" as const, names: statement.names, expression, body: [] };
          target().push(node);
          open.push({ node, into: node.body, line });
          break;
        }
        case "if": {
          const node = { type: "if" as const, expression, then: [], otherwise: [] };
          target().push(node);
          open.push({ node, into: node.then, line });
          break;
        }
        case "else": {
          const block = open.at(-1);
          if (block?.node.type !== "if" || block.into !== block.node.then) {
            throw new TemplateSyntaxError("{% else %} has no {% if %} to belong to", line);
          }
          block.into = block.node.otherwise;
          break;
        }
        case "end":
          if (!open.pop()) throw new TemplateSyntaxError("{% end %} has nothing to close", line);
          break;
      }
    }
    addText(texts[index + 1] ?? "");
  });

  const unclosed = open.at(-1);
  if (unclosed) {
    throw new TemplateSyntaxError(
      `{% ${unclosed.node.type} %} is never closed with {% end %}`,
      unclosed.line,
    );
  }
  return root;
}

// Every ASCII punctuation character can be escaped in Markdown, and escaping one that needs no escape is harmless.
const MARKDOWN_PUNCTUATION = /[!-/:-@[-`{-~]/g;

/** Writes a value's text so Markdown shows it as written: `*` stays a star and does not start emphasis. */
function escapeMarkdown(text: string): string {
  return text.replace(MARKDOWN_PUNCTUATION, "\\$&");
}

/** The cells of a value as rows. A single value is one row of one cell. */
function rowsOf(value: Evaluated): CellValue[][] {
  return isRange(value) ? value.rows : [[value]];
}

/**
 * Turns a parsed template into what the view shows. `evaluate` computes an
 * expression given the names bound around it, keyed in lower case.
 */
export function renderNodes(
  nodes: readonly TemplateNode[],
  evaluate: (expression: string, names: ReadonlyMap<string, Evaluated>) => Evaluated,
): TemplateBlock[] {
  const blocks: TemplateBlock[] = [];
  let markdown = "";
  let iterations = 0;
  const flush = (): void => {
    if (markdown.trim() !== "") blocks.push({ type: "markdown", text: markdown });
    markdown = "";
  };

  const output = (value: Evaluated): void => {
    const rows = rowsOf(value);
    const [[single = null] = []] = rows;
    if (rows.length <= 1 && (rows[0]?.length ?? 0) <= 1) {
      // Markdown made by a formula is meant to be formatted, so it goes in as written.
      if (isMarkdown(single)) markdown += single.text;
      else if (!isChart(single)) markdown += escapeMarkdown(formatValue(single));
      else {
        flush();
        blocks.push({ type: "chart", chart: single });
      }
      return;
    }
    flush();
    blocks.push({ type: "table", rows });
  };

  const run = (body: readonly TemplateNode[], names: Map<string, Evaluated>): void => {
    for (const node of body) {
      switch (node.type) {
        case "text":
          markdown += node.text;
          break;
        case "output":
          output(evaluate(node.expression, names));
          break;
        case "let":
          names.set(node.name.toLowerCase(), evaluate(node.expression, names));
          break;
        case "if": {
          const value = evaluate(node.expression, names);
          const test = isScalar(value)
            ? toBoolean(value)
            : error("#VALUE!", "Expected a single value");
          // A condition that cannot be decided shows its error where the block would be.
          if (isError(value) || isError(test)) output(isError(value) ? value : test);
          else run(test ? node.then : node.otherwise, new Map(names));
          break;
        }
        case "for": {
          const value = evaluate(node.expression, names);
          if (isError(value)) {
            output(value);
            break;
          }
          for (const cells of rowsOf(value)) {
            iterations += 1;
            if (iterations > MAX_ITERATIONS) {
              throw new TemplateSyntaxError(
                `The view repeats more than ${String(MAX_ITERATIONS)} times`,
                1,
              );
            }
            const scope = new Map(names);
            // One name takes the whole row. Several names take a cell each.
            const [only] = node.names;
            if (node.names.length === 1 && only !== undefined) {
              scope.set(
                only.toLowerCase(),
                cells.length === 1 ? (cells[0] ?? null) : { kind: "range", rows: [cells] },
              );
            } else {
              node.names.forEach((name, index) =>
                scope.set(name.toLowerCase(), cells[index] ?? null),
              );
            }
            run(node.body, scope);
          }
          break;
        }
      }
    }
  };

  run(nodes, new Map());
  flush();
  return blocks;
}

/**
 * Renders a text view's source. A template that cannot be parsed renders as
 * one block that says what is wrong and on which line.
 */
export function renderTemplate(
  source: string,
  evaluate: (expression: string, names: ReadonlyMap<string, Evaluated>) => Evaluated,
): TemplateBlock[] {
  try {
    return renderNodes(parseTemplate(source), evaluate);
  } catch (cause) {
    if (!(cause instanceof TemplateSyntaxError)) throw cause;
    return [{ type: "error", message: `Line ${String(cause.line)}: ${cause.message}` }];
  }
}

/**
 * Rewrites the references in every expression of a template and leaves the
 * rest of the text alone. A template that does not parse is returned unchanged.
 */
export function rewriteTemplate(
  source: string,
  replace: Replace,
  replaceBare?: (name: string) => string | undefined,
): string {
  let spans: FormulaSpan[];
  try {
    spans = expressionSpans(source);
  } catch (cause) {
    if (cause instanceof TemplateSyntaxError) return source;
    throw cause;
  }
  let text = source;
  // Last to first, so earlier offsets stay valid while later text changes length.
  for (const { from, to, bound } of spans.toReversed()) {
    let rewritten = rewriteReferences(`=${text.slice(from, to)}`, replace).slice(1);
    if (replaceBare) rewritten = rewriteBareNames(rewritten, replaceBare, bound);
    text = text.slice(0, from) + rewritten + text.slice(to);
  }
  return text;
}
