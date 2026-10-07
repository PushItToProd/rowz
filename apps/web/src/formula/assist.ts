import {
  analyzeFormula,
  analyzeSource,
  formulaAt,
  type EditingMode,
  bindingsAt,
  functionDocs,
  isFormulaInput,
  quoteName,
  type FunctionDoc,
} from "@spreadsheet-app/engine";

export type FunctionSignature = Pick<FunctionDoc, "name" | "syntax" | "summary">;

export interface Suggestion {
  kind: "function" | "table" | "page" | "name" | "column";
  /** What the list shows. */
  label: string;
  /** What replaces the word being typed. */
  insert: string;
  /** A short description shown beside the label. */
  detail: string;
}

export interface Suggestions {
  /** Where the token being completed starts. Acceptance replaces its suffix too. */
  from: number;
  items: Suggestion[];
}

/** The pages and tables a formula in one table can name. */
export interface NamingContext {
  pages: readonly { id: string; name: string }[];
  tables: readonly {
    id?: string;
    pageId: string;
    name: string;
    rowCount?: number;
    colCount?: number;
    /** The named columns of a data table. */
    columns?: readonly { name: string }[] | null;
  }[];
  /** The page of the table that holds the formula. */
  pageId: string | undefined;
  tableId?: string;
  row?: number;
  /** The named columns of the table that holds the formula, which `[Name]` reads. */
  columns?: readonly { name: string }[] | null;
  /** The names the document defines, each with the name and page of the script that holds it. */
  names?: readonly {
    name: string;
    holder: string;
    pageId: string;
    holderId?: string;
    params?: string[];
  }[];
  holderId?: string;
  holder?: string;
  locals?: readonly { name: string; params?: string[] }[];
}

const MAX_SUGGESTIONS = 8;
const WORD_AT_END = /[A-Za-z_][A-Za-z0-9_.]*$/;
// An open `[` with a table name before it, or none: `Sales[Pr`, `'Table 1'[`, `[Pr`.
const COLUMN_AT_END = /(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_]*))?\[([^[\]]*)$/;

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

function startsWith(name: string, typed: string): boolean {
  return name.toLowerCase().startsWith(typed.toLowerCase());
}

function qualifier(name: string, kind: "table" | "page", detail: string): Suggestion {
  return { kind, label: name, insert: `${quoteName(name)}!`, detail };
}

/** The qualifier chain immediately before a token, including its source offset. */
function qualifierChain(before: string): { names: string[]; from: number } | undefined {
  const chain = /(?:(?:'(?:[^']|'')*'|[A-Za-z_][A-Za-z0-9_]*)!){1,2}$/.exec(before);
  if (!chain) return;
  const names = [...chain[0].matchAll(/(?:'((?:[^']|'')*)'|([A-Za-z_][A-Za-z0-9_]*))!/g)].map(
    (part) => part[1]?.replaceAll("''", "'") ?? part[2] ?? "",
  );
  return { names, from: chain.index };
}

function writtenName(
  named: NonNullable<NamingContext["names"]>[number],
  context: NamingContext,
  occurrences: ReadonlyMap<string, number>,
): string {
  const page = context.pages.find((page) => page.id === named.pageId);
  const ambiguous = (occurrences.get(named.name.toLowerCase()) ?? 0) > 1;
  return (named.pageId !== context.pageId || ambiguous) && page
    ? [page.name, named.holder, named.name].map(quoteName).join("!")
    : quoteName(named.name);
}

/**
 * What could complete the word being typed at the caret: function names,
 * the names of tables and pages, and names the formula already uses.
 * Nothing is offered outside a formula, inside quoted text, or after a number.
 */
export function suggestionsAt(
  text: string,
  caret: number,
  context: NamingContext,
  mode: EditingMode = "cell",
): Suggestions {
  const none = { from: caret, items: [] };
  if (mode === "script" || mode === "markdown") {
    const analysis = analyzeSource(text, mode);
    const formula = formulaAt(analysis, caret);
    if (!formula) return none;
    const locals = [
      ...(context.holder ? [] : analysis.definitions),
      ...bindingsAt(formula, caret).map((name) => ({ name })),
    ];
    const currentNames =
      mode === "script" && context.holderId
        ? context.names?.filter((named) => named.holderId !== context.holderId)
        : context.names;
    const names =
      context.holder && context.pageId
        ? [
            ...(currentNames ?? []),
            ...analysis.definitions.map((definition) => ({
              ...definition,
              holder: context.holder ?? "",
              holderId: context.holderId,
              pageId: context.pageId ?? "",
            })),
          ]
        : currentNames;
    const found = suggestionsAt(
      analysis.text.slice(formula.region.from, formula.region.to),
      caret - formula.region.from,
      {
        ...context,
        locals,
        names,
      },
      "formula",
    );
    return { ...found, from: found.from + formula.region.from };
  }

  if (mode === "cell" && !isFormulaInput(text) && text !== "=") return none;
  const occurrences = new Map<string, number>();
  for (const item of [...(context.names ?? []), ...context.tables]) {
    const key = item.name.toLowerCase();
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const before = text.slice(0, caret);
  const { quote, quoteStart } = scan(text, caret);
  if (quote === '"') return none;

  const tablesOn = (pageId: string | undefined): Suggestion[] =>
    context.tables
      .filter((table) => table.pageId === pageId)
      .map((table) => qualifier(table.name, "table", "table"));

  // A quoted token may name a document definition as well as a page or table.
  if (quote === "'" && quoteStart !== undefined) {
    const typed = before.slice(quoteStart).replaceAll("''", "'");
    const chain = qualifierChain(before.slice(0, quoteStart - 1));
    const [first = "", second] = chain?.names ?? [];
    const page = chain ? pageNamed(context, first) : undefined;
    const held = (context.names ?? [])
      .filter(
        (named) =>
          !chain ||
          (named.pageId === (second ? page?.id : context.pageId) &&
            named.holder.toLowerCase() === (second ?? first).toLowerCase()),
      )
      .map((named): Suggestion => ({
        kind: "name",
        label: named.name,
        insert: second ? quoteName(named.name) : writtenName(named, context, occurrences),
        detail: `name in ${named.holder}`,
      }));
    const candidates = [
      ...held,
      ...(chain
        ? second
          ? []
          : tablesOn(page?.id)
        : [
            ...tablesOn(context.pageId),
            ...context.pages.map((p) => qualifier(p.name, "page", "page")),
          ]),
    ].filter((item) => startsWith(item.label, typed));
    const replaceChain =
      chain && candidates.some((item) => item.kind === "name" && item.insert.includes("!"));
    return {
      from: replaceChain ? chain.from : quoteStart - 1,
      items: candidates
        .map((item) => ({
          ...item,
          insert:
            replaceChain && !item.insert.includes("!")
              ? before.slice(chain.from, quoteStart - 1) + item.insert
              : item.insert,
        }))
        .slice(0, MAX_SUGGESTIONS),
    };
  }

  // Inside square brackets only a column can be meant.
  const bracket = COLUMN_AT_END.exec(before);
  if (bracket) {
    const [, quotedTable, bareTable, typedColumn = ""] = bracket;
    const tableName = quotedTable?.replaceAll("''", "'") ?? bareTable;
    const pageQualifier = qualifierChain(before.slice(0, bracket.index));
    const columnPage = pageQualifier
      ? pageNamed(context, pageQualifier.names.at(-1) ?? "")?.id
      : context.pageId;
    const columns =
      tableName === undefined
        ? context.columns
        : context.tables.find(
            (table) =>
              table.pageId === columnPage && table.name.toLowerCase() === tableName.toLowerCase(),
          )?.columns;
    const detail = tableName === undefined ? "this row's value" : `column of ${tableName}`;
    return {
      from: caret - typedColumn.length - 1,
      items: (columns ?? [])
        .filter((column) => startsWith(column.name, typedColumn.trimStart()))
        .map((column): Suggestion => ({
          kind: "column",
          label: column.name,
          insert: `[${column.name}]`,
          detail,
        }))
        .slice(0, MAX_SUGGESTIONS),
    };
  }

  const typed = WORD_AT_END.exec(before)?.[0] ?? "";
  if (typed === "") return none;
  const from = caret - typed.length;
  // A word glued to a digit or a quote, as in `1e5` or `'x'y`, is not a new word.
  if (/[0-9.'"]/.test(before[from - 1] ?? "")) return none;

  const qualified = qualifierChain(before.slice(0, from));
  if (qualified) {
    const [first = "", second] = qualified.names;
    const page = pageNamed(context, first);
    const holder = second ?? first;
    const held = (context.names ?? [])
      .filter(
        (named) =>
          named.pageId === (second ? page?.id : context.pageId) &&
          named.holder.toLowerCase() === holder.toLowerCase(),
      )
      .map((named): Suggestion => ({
        kind: "name",
        label: named.name,
        insert: second ? quoteName(named.name) : writtenName(named, context, occurrences),
        detail: `name in ${named.holder}`,
      }));
    const candidates = [...held, ...(second ? [] : page ? tablesOn(page.id) : [])];
    // A completed qualified name can replace the whole prefix when disambiguation needs a page.
    const replaceChain = held.some((item) => item.insert.includes("!"));
    return {
      from: replaceChain ? qualified.from : from,
      items: candidates
        .filter((item) => startsWith(item.label, typed))
        .map((item) => ({
          ...item,
          insert:
            replaceChain && !item.insert.includes("!")
              ? before.slice(qualified.from, from) + item.insert
              : item.insert,
        }))
        .slice(0, MAX_SUGGESTIONS),
    };
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
  const scoped = new Map((context.locals ?? []).map((local) => [local.name.toLowerCase(), local]));
  for (const name of bindingsAt(
    analyzeFormula(text, { from: mode === "cell" ? 1 : 0, to: text.length }),
    caret,
  ))
    scoped.set(name.toLowerCase(), { name });
  const bound = [...scoped.values()];
  const boundNames = new Set(bound.map(({ name }) => name.toLowerCase()));
  const defined = (context.names ?? [])
    .filter((named) => startsWith(named.name, typed) && !boundNames.has(named.name.toLowerCase()))
    .map((named): Suggestion => ({
      kind: named.params ? "function" : "name",
      label: named.name,
      insert: writtenName(named, context, occurrences) + (named.params ? "(" : ""),
      detail: named.params
        ? `${named.name}(${named.params.join(", ")})`
        : `name in ${named.holder}`,
    }));
  const names = [
    ...bound
      .filter(({ name }) => startsWith(name, typed))
      .map(({ name, params }): Suggestion => ({
        kind: params ? "function" : "name",
        label: name,
        insert: params ? `${quoteName(name)}(` : quoteName(name),
        detail: params ? `${name}(${params.join(", ")})` : "name",
      })),
    ...defined,
  ];
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
export function signatureAt(
  text: string,
  caret: number,
  mode: EditingMode = "cell",
): FunctionSignature | undefined {
  if (mode === "script" || mode === "markdown") {
    const analysis = analyzeSource(text, mode);
    const formula = formulaAt(analysis, caret);
    if (!formula) return undefined;
    const fragment = analysis.text.slice(formula.region.from, formula.region.to);
    const localCaret = caret - formula.region.from;
    const { quote, calls } = scan(fragment, localCaret);
    if (quote === '"') return undefined;
    const called = calls.findLast((name) => name !== "");
    const definition = analysis.definitions.find(
      (definition) => definition.params !== undefined && definition.name.toUpperCase() === called,
    );
    return definition
      ? {
          name: definition.name,
          syntax: `${definition.name}(${definition.params?.join(", ") ?? ""})`,
          summary: "Function defined in this script.",
        }
      : signatureAt(fragment, localCaret, "formula");
  }
  if (mode === "cell" && !isFormulaInput(text)) return undefined;
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
  // Accepting `[Price]` after typing `[Pr` must not leave `[Price]]` when the bracket is already closed.
  let end = caret;
  if (text[from] === "[") {
    const close = text.indexOf("]", caret);
    if (close !== -1 && !/[()[\]]/.test(text.slice(caret, close))) end = close + 1;
  } else {
    const token = analyzeFormula(text).tokens.findLast(
      (token) => token.position <= caret && token.end >= caret && token.end > token.position,
    );
    if (token?.type === "quotedName") end = token.end;
    else end += /^[A-Za-z0-9_.]*/.exec(text.slice(caret))?.[0].length ?? 0;
  }

  const after = text.slice(end);
  const insert =
    suggestion.insert.endsWith("(") && after.startsWith("(")
      ? suggestion.insert.slice(0, -1)
      : suggestion.insert;
  return { text: text.slice(0, from) + insert + after, caret: from + insert.length };
}
