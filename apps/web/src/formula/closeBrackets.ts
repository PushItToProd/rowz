import { EditorState, Prec, StateField, type Extension, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { FormulaMode } from "./session";

type QuoteContext = "string" | "name" | undefined;
interface QuoteSpan {
  from: number;
  to: number;
  context: Exclude<QuoteContext, undefined>;
}
interface QuoteInputState {
  escaped?: { position: number; quote: string };
  skipped?: { position: number; quote: string };
}

function quoteSpans(doc: Text, mode: FormulaMode): QuoteSpan[] {
  const source = doc.toString();
  if (mode === "markdown" || (mode === "cell" && !source.startsWith("="))) return [];

  const spans: QuoteSpan[] = [];
  let quote: '"' | "'" | undefined;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character !== quote) continue;
      if (source[index + 1] === quote) {
        index += 1;
        continue;
      }
      spans.push({
        from: start + 1,
        to: index + 1,
        context: quote === '"' ? "string" : "name",
      });
      quote = undefined;
      continue;
    }

    if (mode === "script" && character === "/" && source[index + 1] === "/") {
      const newline = source.indexOf("\n", index + 2);
      if (newline === -1) break;
      index = newline;
      continue;
    }

    if (character === '"') {
      quote = '"';
      start = index;
    } else if (character === "'" && !isWordCharacter(source[index - 1])) {
      quote = "'";
      start = index;
    }
  }

  if (quote)
    spans.push({
      from: start + 1,
      to: source.length + 1,
      context: quote === '"' ? "string" : "name",
    });
  return spans;
}

function isWordCharacter(character: string | undefined): boolean {
  return character !== undefined && /[\p{L}\p{N}_$]/u.test(character);
}

function quoteContext(spans: readonly QuoteSpan[], position: number): QuoteContext {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    const span = spans[middle];
    if (span && span.from <= position) low = middle + 1;
    else high = middle;
  }
  const candidate = spans[low - 1];
  return candidate && position < candidate.to ? candidate.context : undefined;
}

function quoteFor(context: QuoteContext): string | undefined {
  return context === "string" ? '"' : context === "name" ? "'" : undefined;
}

function quoteContextField(mode: FormulaMode): StateField<QuoteSpan[]> {
  return StateField.define<QuoteSpan[]>({
    create: (state) => quoteSpans(state.doc, mode),
    update: (spans, transaction) =>
      transaction.docChanged ? quoteSpans(transaction.newDoc, mode) : spans,
  });
}

function quoteInputField(
  mode: FormulaMode,
  quotes: StateField<QuoteSpan[]>,
): StateField<QuoteInputState | undefined> {
  return StateField.define<QuoteInputState | undefined>({
    create: () => undefined,
    update: (input, transaction) => {
      const selection = transaction.startState.selection.main;
      const next = transaction.newSelection.main;
      if (
        mode !== "markdown" &&
        selection.empty &&
        transaction.selection &&
        next.head === selection.head + 1 &&
        transaction.isUserEvent("input.type")
      ) {
        const quote = quoteFor(quoteContext(transaction.startState.field(quotes), selection.head));
        if (
          quote &&
          transaction.startState.sliceDoc(selection.head, selection.head + 1) === quote &&
          transaction.newDoc.toString() === transaction.startState.doc.toString()
        )
          return { skipped: { position: next.head, quote } };
      }

      if (mode !== "markdown" && selection.empty && transaction.isUserEvent("input.type")) {
        const quote = quoteFor(quoteContext(transaction.startState.field(quotes), selection.head));
        const before = transaction.startState.doc;
        const after = transaction.newDoc;
        const typedQuote =
          quote !== undefined &&
          after.length === before.length + 1 &&
          after.sliceString(selection.head, selection.head + 1) === quote &&
          after.sliceString(0, selection.head) === before.sliceString(0, selection.head) &&
          after.sliceString(selection.head + 1) === before.sliceString(selection.head);
        if (typedQuote) return { escaped: { position: next.head, quote } };
      }

      if (transaction.docChanged) return undefined;
      return transaction.selection && next.head !== input?.escaped?.position ? undefined : input;
    },
  });
}

const extensions = new Map<FormulaMode, Extension>();

/** Supplies mode-specific close-bracket rules to CodeMirror's closeBrackets extension. */
export function closeBracketLanguageData(mode: FormulaMode): Extension {
  const existing = extensions.get(mode);
  if (existing) return existing;

  const quotes = quoteContextField(mode);
  const quoteInput = quoteInputField(mode, quotes);
  const languageData = Prec.highest(
    EditorState.languageData.of((state, position) => {
      const source = state.doc.toString();
      if (mode === "cell" && !source.startsWith("=")) return [{ closeBrackets: { brackets: [] } }];

      if (mode === "markdown") return [{ closeBrackets: { brackets: ["(", '"'] } }];

      const context = quoteContext(state.field(quotes), position);
      const next = state.sliceDoc(position, position + 1);
      const quote = quoteFor(context);
      const input = state.field(quoteInput);
      if (context) {
        const brackets =
          input?.escaped?.position === position && input.escaped.quote === quote
            ? []
            : quote !== undefined && next === quote
              ? [quote]
              : [];
        return [{ closeBrackets: { brackets } }];
      }

      const brackets = ["(", "[", '"'];
      const before = source[position - 1];
      if (!isWordCharacter(before)) brackets.push("'");
      if (input?.escaped?.position === position) {
        const index = brackets.indexOf(input.escaped.quote);
        if (index !== -1) brackets.splice(index, 1);
      }
      return [{ closeBrackets: { brackets } }];
    }),
  );
  const escapedQuote = Prec.highest(
    EditorView.inputHandler.of((view, from, to, text) => {
      if (mode === "markdown" || from !== to || text.length !== 1) return false;
      const skipped = view.state.field(quoteInput)?.skipped;
      if (skipped?.position !== from || skipped.quote !== text) return false;

      const closing = from - 1;
      if (view.state.sliceDoc(closing, from) !== text) return false;
      view.dispatch({
        changes: { from: closing, insert: text + text },
        selection: { anchor: closing + 2 },
        userEvent: "input.type",
        scrollIntoView: true,
      });
      return true;
    }),
  );
  const result: Extension = [quotes, quoteInput, languageData, escapedQuote];
  extensions.set(mode, result);
  return result;
}
