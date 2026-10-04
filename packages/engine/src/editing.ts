import { parseFormulaWithReferences, type LocatedReference } from "./parser";
import { tokenizeForEditing, type EditingToken } from "./tokenizer";

export interface EditingSpan {
  from: number;
  to: number;
}

/** A lexical binding is offered only inside its scope, including an unfinished body. */
export interface EditingBinding extends EditingSpan {
  name: string;
}

export interface FormulaAnalysis {
  region: EditingSpan;
  tokens: EditingToken[];
  references: LocatedReference[];
  bindings: EditingBinding[];
}

/**
 * Analyzes a formula fragment without evaluating it or requiring valid syntax.
 * All offsets refer to the original source, including when the fragment is a cell formula.
 * Script and template callers can supply the offsets of an embedded expression.
 */
export function analyzeFormula(
  source: string,
  region: EditingSpan = { from: 0, to: source.length },
): FormulaAnalysis {
  const fragment = source.slice(region.from, region.to);
  const tokens = tokenizeForEditing(fragment).map((token) => ({
    ...token,
    position: token.position + region.from,
    end: token.end + region.from,
  }));
  return {
    region,
    tokens,
    references: directReferences(source, tokens),
    bindings: lexicalBindings(tokens, region.to),
  };
}

function punctuation(token: EditingToken | undefined, value: string): boolean {
  return token?.type === "punctuation" && token.value === value;
}

function referencePart(token: EditingToken): boolean {
  return (
    ["identifier", "quotedName", "number", "column"].includes(token.type) ||
    (token.type === "punctuation" && ["!", ":"].includes(token.value))
  );
}

/** Parse isolated reference candidates with the real grammar so quoting and addresses agree. */
function directReferences(source: string, tokens: readonly EditingToken[]): LocatedReference[] {
  const references: LocatedReference[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const first = tokens[index];
    if (!first || !referencePart(first)) continue;
    let end = index + 1;
    let next = tokens[end];
    while (next && referencePart(next)) {
      end += 1;
      next = tokens[end];
    }
    const last = tokens[end - 1];
    if (!last) continue;
    // A malformed qualifier or range is one candidate; never color just its suffix.
    // Calls such as A1(...) are references too; named functions produce no reference.
    try {
      const parsed = parseFormulaWithReferences(source.slice(first.position, last.end));
      if (parsed.ast.type === "reference" && parsed.references.length === 1) {
        const reference = parsed.references[0];
        if (!reference) continue;
        references.push({
          ...reference,
          from: first.position + reference.from,
          to: first.position + reference.to,
        });
      }
    } catch {
      // An incomplete candidate does not hide valid references in later operands.
    }
    index = end - 1;
  }
  return references;
}

interface Call {
  name: string;
  starts: number[];
  separators: number[];
}

function lexicalBindings(tokens: readonly EditingToken[], end: number): EditingBinding[] {
  const bindings: EditingBinding[] = [];
  const calls: Call[] = [];
  const finish = (call: Call, to: number): void => {
    if (call.name !== "LET" && call.name !== "LAMBDA") return;
    const count = call.starts.length;
    for (let argument = 0; argument < count - 1; argument += call.name === "LET" ? 2 : 1) {
      const start = call.starts[argument];
      const stop = call.separators[argument];
      if (start === undefined || stop === undefined) continue;
      const name = tokens[start];
      // A declaration must be one bare name, never a cell address or expression.
      if (
        stop !== start + 1 ||
        name?.type !== "identifier" ||
        /^\$?[A-Za-z]{1,3}\$?[1-9][0-9]*$/.test(name.value)
      )
        continue;
      const visible = call.name === "LET" ? argument + 2 : count - 1;
      const from = tokens[call.starts[visible] ?? tokens.length - 1]?.position ?? end;
      if (visible < count) bindings.push({ name: name.value, from, to });
    }
  };
  tokens.forEach((token, index) => {
    if (punctuation(token, "(")) {
      const previous = tokens[index - 1];
      calls.push({
        name: previous?.type === "identifier" ? previous.value.toUpperCase() : "",
        starts: [index + 1],
        separators: [],
      });
    } else if (punctuation(token, ",")) {
      const call = calls.at(-1);
      if (call) {
        call.separators.push(index);
        call.starts.push(index + 1);
      }
    } else if (punctuation(token, ")")) {
      const call = calls.pop();
      if (call) finish(call, token.position);
    }
  });
  for (const call of calls) finish(call, end);
  return bindings;
}

/** Names available at this caret. Inner declarations override outer spellings. */
export function bindingsAt(analysis: FormulaAnalysis, caret: number): string[] {
  const names = new Map<string, EditingBinding>();
  for (const binding of analysis.bindings) {
    if (binding.from <= caret && caret <= binding.to) {
      const key = binding.name.toLowerCase();
      const previous = names.get(key);
      if (!previous || binding.from > previous.from) names.set(key, binding);
    }
  }
  return [...names.values()].map((binding) => binding.name);
}

/** Whether a grid click can supply an operand without repairing surrounding syntax. */
export function expectsOperand(analysis: FormulaAnalysis, caret: number): boolean {
  if (caret < analysis.region.from || caret > analysis.region.to) return false;
  const containing = analysis.tokens.find((token) => token.position < caret && caret < token.end);
  if (containing) return false;
  const previous = analysis.tokens.findLast((token) => token.type !== "end" && token.end <= caret);
  if (!previous) return true;
  if (previous.type === "string" || previous.type === "column" || previous.type === "quotedName")
    return false;
  return previous.type === "operator" || punctuation(previous, "(") || punctuation(previous, ",");
}
