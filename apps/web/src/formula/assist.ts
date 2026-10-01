import { functionDocs, isFormulaInput, type FunctionDoc } from "@spreadsheet-app/engine";

export interface Suggestion {
  kind: "function" | "table" | "page" | "name";
  /** What the list shows. */
  label: string;
  /** What replaces the word being typed. */
  insert: string;
  /** A short description shown beside the label. */
  detail: string;
}

export interface Suggestions {
  /** Where the word being typed starts. The suggestion replaces the text from here to the caret. */
  from: number;
  items: Suggestion[];
}

/** The pages and tables a formula in one table can name. */
export interface NamingContext {
  pages: readonly { id: string; name: string }[];
  tables: readonly { pageId: string; name: string }[];
  /** The page of the table that holds the formula. */
  pageId: string | undefined;
}

const MAX_SUGGESTIONS = 8;
const BARE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const WORD_AT_END = /[A-Za-z_][A-Za-z0-9_.]*$/;
const QUALIFIER_AT_END = /(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_]*))!$/;
const CELL_LIKE = /^\$?[A-Za-z]{1,3}\$?[0-9]*$/;
const WORD = /[A-Za-z_][A-Za-z0-9_.]*/g;

const functionNames = new Set(functionDocs.map((doc) => doc.name));

interface Scan {
  /** The index after the quote that opened the string or quoted name the caret is in. */
  quoteStart: number | undefined;
  quote: '"' | "'" | undefined;
  /** The names of the calls the caret is inside, innermost last. Empty for plain parentheses. */
  calls: string[];
}

/** Walks the formula up to the caret, tracking quotes and open parentheses. */
function scan(text: string, caret: number): Scan {
  const calls: string[] = [];
  let quote: Scan["quote"];
  let quoteStart: number | undefined;
  for (let index = 0; index < caret; index += 1) {
    const char = text[index];
    if (quote) {
      if (char !== quote) continue;
      // A doubled quote is one quote character inside the text.
      if (text[index + 1] === quote && index + 1 < caret) index += 1;
      else [quote, quoteStart] = [undefined, undefined];
    } else if (char === '"' || char === "'") {
      [quote, quoteStart] = [char, index + 1];
    } else if (char === "(") {
      calls.push(WORD_AT_END.exec(text.slice(0, index).trimEnd())?.[0].toUpperCase() ?? "");
    } else if (char === ")") {
      calls.pop();
    }
  }
  return { quote, quoteStart, calls };
}

function quoteName(name: string): string {
  return BARE_NAME.test(name) ? name : `'${name.replaceAll("'", "''")}'`;
}

function startsWith(name: string, typed: string): boolean {
  return name.toLowerCase().startsWith(typed.toLowerCase());
}

function qualifier(name: string, kind: "table" | "page", detail: string): Suggestion {
  return { kind, label: name, insert: `${quoteName(name)}!`, detail };
}

/** The words a formula already uses as names, such as those bound by LET, other than the one being typed. */
function namesIn(text: string, typedFrom: number): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(WORD)) {
    const [word] = match;
    const next = text.slice(match.index + word.length).trimStart()[0];
    const isName =
      match.index !== typedFrom &&
      next !== "(" &&
      next !== "!" &&
      !CELL_LIKE.test(word) &&
      !["TRUE", "FALSE"].includes(word.toUpperCase());
    if (isName) names.add(word);
  }
  return [...names];
}

/**
 * What could complete the word being typed at the caret: function names,
 * the names of tables and pages, and names the formula already uses.
 * Nothing is offered outside a formula, inside quoted text, or after a number.
 */
export function suggestionsAt(text: string, caret: number, context: NamingContext): Suggestions {
  const none = { from: caret, items: [] };
  if (!isFormulaInput(text) && text !== "=") return none;
  const before = text.slice(0, caret);
  const { quote, quoteStart } = scan(text, caret);
  if (quote === '"') return none;

  const tablesOn = (pageId: string | undefined): Suggestion[] =>
    context.tables
      .filter((table) => table.pageId === pageId)
      .map((table) => qualifier(table.name, "table", "table"));

  // Inside a quoted name only pages and tables can be meant.
  if (quote === "'" && quoteStart !== undefined) {
    const typed = before.slice(quoteStart);
    const page = QUALIFIER_AT_END.exec(before.slice(0, quoteStart - 1));
    const named = page
      ? pageNamed(context, page[1]?.replaceAll("''", "'") ?? page[2] ?? "")
      : undefined;
    const candidates = page
      ? tablesOn(named?.id)
      : [
          ...tablesOn(context.pageId),
          ...context.pages.map((p) => qualifier(p.name, "page", "page")),
        ];
    return {
      from: quoteStart - 1,
      items: candidates.filter((item) => startsWith(item.label, typed)).slice(0, MAX_SUGGESTIONS),
    };
  }

  const typed = WORD_AT_END.exec(before)?.[0] ?? "";
  if (typed === "") return none;
  const from = caret - typed.length;
  // A word glued to a digit or a quote, as in `1e5` or `'x'y`, is not a new word.
  if (/[0-9.'"]/.test(before[from - 1] ?? "")) return none;

  const qualified = QUALIFIER_AT_END.exec(before.slice(0, from));
  if (qualified) {
    const page = pageNamed(context, qualified[1]?.replaceAll("''", "'") ?? qualified[2] ?? "");
    const items = page ? tablesOn(page.id).filter((item) => startsWith(item.label, typed)) : [];
    return { from, items: items.slice(0, MAX_SUGGESTIONS) };
  }

  const functions = functionDocs
    .filter((doc) => startsWith(doc.name, typed))
    .map((doc): Suggestion => ({
      kind: "function",
      label: doc.name,
      insert: `${doc.name}(`,
      detail: doc.syntax,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const names = namesIn(text, from)
    .filter((name) => startsWith(name, typed) && !functionNames.has(name.toUpperCase()))
    .map((name): Suggestion => ({ kind: "name", label: name, insert: name, detail: "name" }));
  const places = [
    ...tablesOn(context.pageId),
    ...context.pages.map((page) => qualifier(page.name, "page", "page")),
  ].filter((item) => startsWith(item.label, typed));

  const items = [...names, ...functions, ...places];
  // A lone exact match that would insert nothing new is noise.
  const [only] = items;
  if (items.length === 1 && only?.insert === typed) return none;
  return { from, items: items.slice(0, MAX_SUGGESTIONS) };
}

function pageNamed(context: NamingContext, name: string): { id: string; name: string } | undefined {
  return context.pages.find((page) => page.name.toLowerCase() === name.toLowerCase());
}

/** The function whose parentheses the caret is inside, for showing what it expects. */
export function signatureAt(text: string, caret: number): FunctionDoc | undefined {
  if (!isFormulaInput(text)) return undefined;
  const { quote, calls } = scan(text, caret);
  if (quote === '"') return undefined;
  // Plain parentheses, as in `ROUND((1 + 2) * 3`, are skipped to reach the call around them.
  const name = calls.findLast((call) => call !== "");
  return functionDocs.find((doc) => doc.name === name);
}

/** Replaces the word being typed with a suggestion. Returns the new text and where the caret goes. */
export function applySuggestion(
  text: string,
  { from }: Suggestions,
  caret: number,
  suggestion: Suggestion,
): { text: string; caret: number } {
  // Typing `SUM` then accepting `SUM(` must not leave `SUM((` when a parenthesis already follows.
  const after = text.slice(caret);
  const insert =
    suggestion.insert.endsWith("(") && after.startsWith("(")
      ? suggestion.insert.slice(0, -1)
      : suggestion.insert;
  return { text: text.slice(0, from) + insert + after, caret: from + insert.length };
}
