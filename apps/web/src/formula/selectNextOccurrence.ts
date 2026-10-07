import { EditorSelection } from "@codemirror/state";
import { type KeyBinding, type EditorView } from "@codemirror/view";

/** Selects the word under the cursor, or adds the next occurrence of the selected text. */
export function selectNextOccurrence(view: EditorView): boolean {
  const { state } = view;
  const { main, ranges } = state.selection;

  if (main.empty) {
    const word = state.wordAt(main.head);
    if (!word) return false;
    view.dispatch({
      selection: EditorSelection.range(word.from, word.to),
      scrollIntoView: true,
      userEvent: "select",
    });
    return true;
  }

  const needle = state.sliceDoc(main.from, main.to);
  if (!needle) return false;

  const last = ranges.reduce((end, range) => Math.max(end, range.to), 0);
  const docLength = state.doc.length;
  const isAlreadySelected = (from: number, to: number): boolean =>
    ranges.some((range) =>
      range.empty ? range.from >= from && range.from < to : from < range.to && to > range.from,
    );

  function find(from: number, to: number): number | undefined {
    const text = state.sliceDoc(from, to);
    let index = text.indexOf(needle);
    while (index >= 0) {
      const position = from + index;
      if (!isAlreadySelected(position, position + needle.length)) return position;
      index = text.indexOf(needle, index + 1);
    }
    return undefined;
  }

  const start = Math.min(last, docLength);
  const next = find(start, docLength) ?? find(0, start);
  if (next === undefined) return false;

  const added = EditorSelection.range(next, next + needle.length);
  const selections = [...ranges, added].sort((a, b) => a.from - b.from || a.to - b.to);
  view.dispatch({
    selection: EditorSelection.create(selections, selections.indexOf(added)),
    scrollIntoView: true,
    userEvent: "select",
  });
  return true;
}

export const selectNextOccurrenceKeymap: readonly KeyBinding[] = [
  { key: "Mod-d", run: selectNextOccurrence },
];
