import { bareNameEdits, referenceEdits, type Replace } from "./rewrite";
import type { NameDefinition } from "./structure";

/**
 * A script is a block of statements, one per line:
 *
 *     // A comment runs to the end of its line.
 *     Total = SUM(Sales[Amount])
 *     WithTax(amount) = amount * (1 + Rate)
 *     ASSERT(Total >= 0, "Sales cannot be negative")
 *
 * A statement starts on a line with no indentation, and an indented line
 * continues the statement above it, so a long formula can wrap. A statement
 * is a name and its formula, a function and its body, or a bare formula. A
 * line that starts like a function definition is one, so a bare comparison
 * such as `F(x) = 3` cannot be written; `(F(x) = 3)` can.
 */
export type ScriptStatement = { line: number } & (
  | {
      kind: "name";
      name: string;
      /** Set for a function: `WithTax(amount) = ...`. */
      params?: string[];
      /** The formula with comments blanked out, and where it starts in the source. */
      formula: string;
      from: number;
    }
  | { kind: "expression"; formula: string; from: number }
  | { kind: "error"; message: string }
);

const WORD = "[A-Za-z_][A-Za-z0-9_]*";
const QUOTED = "'(?:[^']|'')*'";
const HEAD = new RegExp(
  `^(${WORD}|${QUOTED})\\s*(\\(\\s*(${WORD}(?:\\s*,\\s*${WORD})*)?\\s*\\))?\\s*=`,
);

/**
 * Replaces each comment with spaces of the same length, so that offsets in
 * the result are offsets in the source. `//` inside text in double quotes or
 * a name in single quotes is not a comment.
 */
export function scanScriptComments(source: string): {
  text: string;
  comments: { from: number; to: number }[];
} {
  const comments: { from: number; to: number }[] = [];
  let result = "";
  let quote: string | undefined;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] ?? "";
    if (quote) {
      if (char === quote) quote = undefined;
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "/" && source[index + 1] === "/") {
      const end = source.indexOf("\n", index);
      const stop = end === -1 ? source.length : end;
      comments.push({ from: index, to: stop });
      result += " ".repeat(stop - index);
      index = stop - 1;
      continue;
    }
    // A quote left open ends with its line, so it cannot hide the comments after it.
    if (char === "\n") quote = undefined;
    result += char;
  }
  return { text: result, comments };
}

function unquote(name: string): string {
  return name.startsWith("'") ? name.slice(1, -1).replaceAll("''", "'") : name;
}

/** Splits a script into its statements. A statement's formula is not parsed here. */
export function parseScript(source: string): ScriptStatement[] {
  const { text } = scanScriptComments(source);
  const statements: ScriptStatement[] = [];
  let start: { line: number; offset: number } | undefined;
  let offset = 0;
  const lines = text.split("\n");

  const finish = (end: number): void => {
    if (!start) return;
    const body = text.slice(start.offset, end);
    statements.push(statement(body, start.offset, start.line));
    start = undefined;
  };

  lines.forEach((line, index) => {
    const indented = /^\s/.test(line);
    if (line.trim() !== "" && !indented) {
      finish(offset);
      start = { line: index + 1, offset };
    } else if (line.trim() !== "" && !start) {
      statements.push({
        kind: "error",
        line: index + 1,
        message: "An indented line continues the statement above it, and there is none",
      });
    }
    offset += line.length + 1;
  });
  finish(text.length);
  return statements;
}

function statement(body: string, from: number, line: number): ScriptStatement {
  const head = HEAD.exec(body);
  if (!head) {
    const formula = body.trimEnd();
    return { kind: "expression", line, formula, from };
  }
  const [matched, written = "", parens, params] = head;
  const formula = body.slice(matched.length);
  const lead = formula.length - formula.trimStart().length;
  const name = unquote(written);
  const base = {
    kind: "name" as const,
    line,
    name,
    formula: formula.trim(),
    from: from + matched.length + lead,
  };
  if (parens !== undefined) {
    return {
      ...base,
      params: params === undefined ? [] : params.split(",").map((param) => param.trim()),
    };
  }
  return base;
}

/**
 * The names a script defines. A function is defined as a `LAMBDA` of its
 * parameters, so `WithTax(amount) = ...` means `WithTax = LAMBDA(amount, ...)`.
 */
export function scriptNames(scriptId: string, source: string): NameDefinition[] {
  return parseScript(source).flatMap((statement) => {
    if (statement.kind !== "name") return [];
    const { name, params, formula } = statement;
    const defined =
      params === undefined ? formula : `LAMBDA(${[...params, `(${formula})`].join(", ")})`;
    return [{ holderId: scriptId, name, formula: defined }];
  });
}

/** The bare formulas of a script, such as an `ASSERT`, and the lines they are on. */
export function scriptStatements(
  scriptId: string,
  source: string,
): { holderId: string; line: number; formula: string }[] {
  return parseScript(source).flatMap((statement) =>
    statement.kind === "expression"
      ? [{ holderId: scriptId, line: statement.line, formula: statement.formula }]
      : [],
  );
}

/**
 * Rewrites the references in each statement of a script and leaves every
 * other character, comments included, as the user typed it.
 */
export function rewriteScript(
  source: string,
  replace: Replace,
  replaceBare?: (name: string) => string | undefined,
): string {
  const edits = parseScript(source).flatMap((statement) =>
    statement.kind === "error"
      ? []
      : [
          ...referenceEdits(statement.formula, replace),
          ...(replaceBare
            ? bareNameEdits(
                statement.formula,
                replaceBare,
                new Set(
                  statement.kind === "name"
                    ? (statement.params ?? []).map((name) => name.toLowerCase())
                    : [],
                ),
              )
            : []),
        ].map((edit) => ({
          ...edit,
          from: edit.from + statement.from,
          to: edit.to + statement.from,
        })),
  );
  let result = source;
  for (const { from, to, text } of edits.toReversed()) {
    result = result.slice(0, from) + text + result.slice(to);
  }
  return result;
}
