import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { selectNextOccurrence } from "./selectNextOccurrence";

const views: EditorView[] = [];

function editor(doc: string, selection: { anchor: number; head?: number }): EditorView {
  const parent = document.createElement("div");
  document.body.append(parent);
  const view = new EditorView({
    state: EditorState.create({
      doc,
      selection,
      extensions: [EditorState.allowMultipleSelections.of(true)],
    }),
    parent,
  });
  views.push(view);
  return view;
}

afterEach(() => {
  for (const view of views.splice(0)) view.destroy();
  document.body.replaceChildren();
});

describe("select next occurrence", () => {
  it("adds the next exact occurrence as the main selection", () => {
    const view = editor("one two one one", { anchor: 0, head: 3 });

    expect(selectNextOccurrence(view)).toBe(true);
    expect(view.state.selection.ranges.map(({ from, to }) => [from, to])).toEqual([
      [0, 3],
      [8, 11],
    ]);
    expect(view.state.selection.main).toMatchObject({ from: 8, to: 11 });
  });

  it("wraps to the first unselected occurrence and stops when all are selected", () => {
    const view = editor("foo x foo y foo", { anchor: 12, head: 15 });

    expect(selectNextOccurrence(view)).toBe(true);
    expect(view.state.selection.ranges.map(({ from, to }) => [from, to])).toEqual([
      [0, 3],
      [12, 15],
    ]);
    expect(view.state.selection.main).toMatchObject({ from: 0, to: 3 });

    expect(selectNextOccurrence(view)).toBe(true);
    expect(view.state.selection.ranges.map(({ from, to }) => [from, to])).toEqual([
      [0, 3],
      [6, 9],
      [12, 15],
    ]);
    expect(view.state.selection.main).toMatchObject({ from: 6, to: 9 });
    expect(selectNextOccurrence(view)).toBe(false);
  });

  it("selects the word under an empty cursor first", () => {
    const view = editor("alpha beta", { anchor: 8 });

    expect(selectNextOccurrence(view)).toBe(true);
    expect(view.state.selection.ranges.map(({ from, to }) => [from, to])).toEqual([[6, 10]]);
  });

  it("returns false when no word or later occurrence can be selected", () => {
    const empty = editor("alpha + beta", { anchor: 6 });
    expect(selectNextOccurrence(empty)).toBe(false);

    const single = editor("only", { anchor: 0, head: 4 });
    expect(selectNextOccurrence(single)).toBe(false);
    expect(single.state.selection.ranges.map(({ from, to }) => [from, to])).toEqual([[0, 4]]);
  });
});
