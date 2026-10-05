import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxTree } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";
import { highlightTree, tags } from "@lezer/highlight";
import type { SourceAnalysis } from "@spreadsheet-app/engine";
import { Decoration } from "@codemirror/view";

export const markdownLanguage = markdown({ addKeymap: false, completeHTMLTags: false });

const proseStyle = HighlightStyle.define([
  { tag: tags.heading, class: "formula-prose--heading" },
  { tag: tags.strong, class: "formula-prose--strong" },
  { tag: tags.emphasis, class: "formula-prose--emphasis" },
  { tag: tags.link, class: "formula-prose--link" },
  { tag: tags.url, class: "formula-prose--link" },
  { tag: tags.monospace, class: "formula-prose--code" },
  { tag: tags.quote, class: "formula-prose--quote" },
  { tag: tags.list, class: "formula-prose--list" },
  { tag: tags.processingInstruction, class: "formula-prose--punctuation" },
  { tag: tags.contentSeparator, class: "formula-prose--punctuation" },
]);

/** Markdown parsing never takes styling precedence over an engine-recognized tag. */
export function markdownDecorations(state: EditorState, analysis: SourceAnalysis) {
  const marks: ReturnType<Decoration["range"]>[] = [];
  const excluded = analysis.templateTags ?? [];
  let index = 0;
  highlightTree(syntaxTree(state), proseStyle, (from, to, classes) => {
    while ((excluded[index]?.to ?? Infinity) <= from) index++;
    let start = from;
    for (let at = index; at < excluded.length; at++) {
      const span = excluded[at];
      if (!span || span.from >= to) break;
      if (start < span.from)
        marks.push(Decoration.mark({ class: classes }).range(start, Math.min(to, span.from)));
      start = Math.max(start, span.to);
    }
    if (start < to) marks.push(Decoration.mark({ class: classes }).range(start, to));
  });
  return marks;
}
