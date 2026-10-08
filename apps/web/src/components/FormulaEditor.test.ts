import { markRaw } from "vue";
import { createPinia } from "pinia";
import { mount, type VueWrapper } from "@vue/test-utils";
import { EditorState, Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { redo, undo } from "@codemirror/commands";
import { startCompletion, completionStatus } from "@codemirror/autocomplete";
import { afterEach, describe, expect, it, vi } from "vitest";
import FormulaEditor from "./FormulaEditor.vue";
import { useReferencePickingStore } from "../formula/picking";

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

function render(text: string, extra = {}) {
  const wrapper = mount(FormulaEditor, {
    global: { plugins: [createPinia()] },
    attachTo: document.body,
    props: {
      state: EditorState.create({ doc: text, selection: { anchor: text.length } }),
      mode: "cell",
      context: { pages: [], tables: [], pageId: "p" },
      label: "Formula in Sales!A1",
      maxLength: 50_000,
      ...extra,
    },
  });
  mounted.push(wrapper);
  const view = EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
  return { wrapper, view };
}

function type(view: EditorView, text: string): void {
  for (const character of text) {
    const { from, to } = view.state.selection.main;
    const insert = () =>
      view.state.update({
        changes: { from, to, insert: character },
        selection: { anchor: from + character.length },
        userEvent: "input.type",
      });
    const handled = view.state
      .facet(EditorView.inputHandler)
      .some((handler) => handler(view, from, to, character, insert));
    if (!handled) view.dispatch(insert());
  }
}

async function complete(view: EditorView) {
  startCompletion(view);
  await vi.waitFor(() => {
    expect(completionStatus(view.state)).toBe("active");
  });
}

describe("shared formula editor", () => {
  it("highlights boolean keywords as operators while keeping calls and names", () => {
    const { wrapper } = render("=AND(A1, TRUE) AnD (not B2 oR not[or])");
    expect(wrapper.findAll(".formula-token--operator").map((token) => token.text())).toEqual([
      "AnD",
      "not",
      "oR",
    ]);
    expect(wrapper.findAll(".formula-token--identifier").map((token) => token.text())).toContain(
      "AND",
    );
    expect(wrapper.findAll(".formula-token--identifier").map((token) => token.text())).toContain(
      "not",
    );
  });

  it("exposes an accessible label and highlights formulas without highlighting literal cells", async () => {
    const { wrapper } = render("=SUM(A1, 2)");
    expect(wrapper.get(".cm-content").attributes("aria-label")).toBe("Formula in Sales!A1");
    expect(wrapper.find(".formula-token--number").text()).toBe("2");
    const literal = render("SUM(A1, 2)").wrapper;
    expect(literal.find('[class*="formula-token--"]').exists()).toBe(false);
    const formula = render("SUM(A1, 2)", { mode: "formula" }).wrapper;
    expect(formula.find(".formula-token--number").text()).toBe("2");
    await wrapper.setProps({ label: "Editing formula for every row in Sales[Amount]" });
    expect(wrapper.get(".cm-content").attributes("aria-label")).toBe(
      "Editing formula for every row in Sales[Amount]",
    );
  });

  it("publishes completion-only state changes and accepts external replacement states", async () => {
    const { wrapper, view } = render("=sq");
    await complete(view);
    const emitted = wrapper.emitted<[EditorState]>("update:state")!;
    expect(emitted.at(-1)![0]).toBe(view.state);
    const completed = view.state;
    await wrapper.setProps({ state: markRaw(completed) });
    expect(view.state).toBe(completed);
    expect(completionStatus(view.state)).toBe("active");
    await wrapper.setProps({ state: EditorState.create({ doc: "=B2" }) });
    expect(view.state.doc.toString()).toBe("=B2");
  });

  it("retains caret and local undo when mounted into a different component", async () => {
    const first = render("=B2");
    first.view.dispatch({
      changes: { from: 3, insert: "+1" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    const transferred = first.view.state;
    first.wrapper.unmount();
    mounted.splice(mounted.indexOf(first.wrapper), 1);
    const second = render("ignored", { state: transferred });
    expect(second.view.state.doc.toString()).toBe("=B2+1");
    expect(second.view.state.selection.main.head).toBe(2);
    expect(undo(second.view)).toBe(true);
    expect(second.view.state.doc.toString()).toBe("=B2");
    await second.wrapper.vm.$nextTick();
    expect(second.wrapper.emitted("update:state")).toBeDefined();
  });

  it.each([0, 1000])(
    "isolates literal/formula transitions across transfers with %i ms between edits",
    (delay) => {
      const first = render("1");
      first.view.dispatch({
        changes: { from: 0, to: 1, insert: "=" },
        selection: { anchor: 1 },
        userEvent: "input.type",
        annotations: Transaction.time.of(1000),
      });
      const transferred = first.view.state;
      first.wrapper.unmount();
      mounted.splice(mounted.indexOf(first.wrapper), 1);
      const second = render("ignored", { state: transferred });
      second.view.dispatch({
        changes: { from: 0, to: 1, insert: "=B2" },
        selection: { anchor: 3 },
        userEvent: "input.type",
        annotations: Transaction.time.of(1000 + delay),
      });
      expect(undo(second.view)).toBe(true);
      expect(second.view.state.doc.toString()).toBe("=");
      expect(undo(second.view)).toBe(true);
      expect(second.view.state.doc.toString()).toBe("1");
      expect(redo(second.view)).toBe(true);
      expect(second.view.state.doc.toString()).toBe("=");
      expect(redo(second.view)).toBe(true);
      expect(second.view.state.doc.toString()).toBe("=B2");
    },
  );

  it("groups rapid formula typing and isolates switching back to literal input", () => {
    const { view } = render("=");
    for (const [index, character] of ["B", "2"].entries()) {
      view.dispatch({
        changes: { from: view.state.doc.length, insert: character },
        userEvent: "input.type",
        annotations: Transaction.time.of(1000 + index),
      });
    }
    view.dispatch({
      changes: { from: 0, to: 3, insert: "1" },
      userEvent: "input.type",
      annotations: Transaction.time.of(1002),
    });
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("=B2");
    expect(undo(view)).toBe(true);
    expect(view.state.doc.toString()).toBe("=");
  });

  it("keeps arrows in the editor after an unfinished operand and isolates keyboard events from the grid", async () => {
    const { wrapper, view } = render("=B3+");
    const gridKey = vi.fn();
    document.body.addEventListener("keydown", gridKey);
    await wrapper.get(".cm-content").trigger("keydown", { key: "ArrowLeft", keyCode: 37 });
    expect(view.state.selection.main.head).toBe(3);
    expect(wrapper.emitted("commit")).toBeUndefined();
    document.body.removeEventListener("keydown", gridKey);
    expect(gridKey).not.toHaveBeenCalled();
  });

  it("uses Enter to commit until arrows select a completion, and lets Tab accept", async () => {
    const first = render("=rou");
    await complete(first.view);
    await first.wrapper.get(".cm-content").trigger("keydown", { key: "Enter", keyCode: 13 });
    expect(first.wrapper.emitted("commit")).toEqual([["Enter", false]]);
    expect(first.view.state.doc.toString()).toBe("=rou");
    await first.wrapper.get(".cm-content").trigger("keydown", { key: "ArrowDown", keyCode: 40 });
    await first.wrapper.get(".cm-content").trigger("keydown", { key: "Enter", keyCode: 13 });
    expect(first.view.state.doc.toString()).toBe("=ROUNDDOWN()");
    expect(first.view.state.selection.main.head).toBe(first.view.state.doc.length - 1);
    type(first.view, ")");
    expect(first.view.state.doc.toString()).toBe("=ROUNDDOWN()");
    expect(first.wrapper.emitted("commit")).toHaveLength(1);

    const second = render("=rou");
    await complete(second.view);
    await second.wrapper.get(".cm-content").trigger("keydown", { key: "Tab", keyCode: 9 });
    expect(second.view.state.doc.toString()).toMatch(/^=ROUND/);
    expect(second.wrapper.emitted("commit")).toBeUndefined();
  });

  it.each([
    ["an operator", "+1", "=ROUND()+1"],
    ["a comma", ", next", "=ROUND(), next"],
    ["the end of the formula", "", "=ROUND()"],
    ["an existing closer", ")", "=ROUND()"],
  ])("closes function completion before %s", async (_context, suffix, expected) => {
    const { wrapper, view } = render(`=rou${suffix}`);
    view.dispatch({ selection: { anchor: 4 } });
    await complete(view);
    await wrapper.get(".cm-content").trigger("keydown", { key: "Tab", keyCode: 9 });
    expect(view.state.doc.toString()).toBe(expected);
    expect(view.state.selection.main.head).toBe(expected.indexOf(")"));
  });

  it("pairs formula brackets, wraps selected text, skips closers, and deletes empty pairs", () => {
    const { view } = render("=");
    type(view, "(");
    expect(view.state.doc.toString()).toBe("=()");
    expect(view.state.selection.main.head).toBe(2);
    type(view, "A1)");
    expect(view.state.doc.toString()).toBe("=(A1)");
    expect(view.state.selection.main.head).toBe(view.state.doc.length);

    const wrapped = render("=A1");
    wrapped.view.dispatch({ selection: { anchor: 1, head: 3 } });
    type(wrapped.view, "(");
    expect(wrapped.view.state.doc.toString()).toBe("=(A1)");
    expect(wrapped.view.state.selection.main.from).toBe(2);
    expect(wrapped.view.state.selection.main.to).toBe(4);

    const empty = render("=");
    type(empty.view, "(");
    const backspace = new KeyboardEvent("keydown", {
      key: "Backspace",
      bubbles: true,
      cancelable: true,
    });
    empty.view.contentDOM.dispatchEvent(backspace);
    expect(backspace.defaultPrevented).toBe(true);
    expect(empty.view.state.doc.toString()).toBe("=");
  });

  it("does not recurse through language data when typing in an existing formula", () => {
    const { view } = render("=rou");
    type(view, "x");
    expect(view.state.doc.toString()).toBe("=roux");
    type(view, "(");
    expect(view.state.doc.toString()).toBe("=roux()");
  });

  it("pairs column brackets and quotes, follows doubled quote rules, and leaves braces alone", () => {
    const column = render("=Sales");
    type(column.view, "[");
    expect(column.view.state.doc.toString()).toBe("=Sales[]");
    expect(column.view.state.selection.main.head).toBe(7);
    type(column.view, "Price]");
    expect(column.view.state.doc.toString()).toBe("=Sales[Price]");

    const text = render("=");
    type(text.view, '"hello"');
    expect(text.view.state.doc.toString()).toBe('="hello"');
    expect(text.view.state.selection.main.head).toBe(text.view.state.doc.length);

    const escaped = render('="x y"');
    escaped.view.dispatch({ selection: { anchor: 3 } });
    type(escaped.view, '""');
    expect(escaped.view.state.doc.toString()).toBe('="x"" y"');

    const escapedAtEnd = render("=");
    type(escapedAtEnd.view, '"say ""hi"""');
    expect(escapedAtEnd.view.state.doc.toString()).toBe('="say ""hi"""');

    const braces = render("=");
    type(braces.view, "{");
    expect(braces.view.state.doc.toString()).toBe("={");
  });

  it("pairs apostrophes for quoted names, never inside double-quoted strings", () => {
    const name = render("=");
    type(name.view, "'Page 1'!A1");
    expect(name.view.state.doc.toString()).toBe("='Page 1'!A1");

    const escapedName = render("=");
    type(escapedName.view, "'Joe''s Table'!A1");
    expect(escapedName.view.state.doc.toString()).toBe("='Joe''s Table'!A1");

    const string = render('="dont"');
    string.view.dispatch({ selection: { anchor: 5 } });
    type(string.view, "'");
    expect(string.view.state.doc.toString()).toBe('="don\'t"');
  });

  it("inserts apostrophes literally in script comments", () => {
    const comment = render("// A note ", { mode: "script" });
    type(comment.view, "'");
    expect(comment.view.state.doc.toString()).toBe("// A note '");
  });

  it("wraps a selected name in apostrophes in either selection direction", () => {
    const forward = render("=Foo");
    forward.view.dispatch({ selection: { anchor: 1, head: 4 } });
    type(forward.view, "'");
    expect(forward.view.state.doc.toString()).toBe("='Foo'");
    expect(forward.view.state.selection.main).toMatchObject({ anchor: 2, head: 5 });

    const backward = render("=Foo");
    backward.view.dispatch({ selection: { anchor: 4, head: 1 } });
    type(backward.view, "'");
    expect(backward.view.state.doc.toString()).toBe("='Foo'");
    expect(backward.view.state.selection.main).toMatchObject({ anchor: 5, head: 2 });
  });

  it("keeps bracket behavior deliberate in cell, script, and Markdown editors", () => {
    const literal = render("value", { mode: "cell" });
    type(literal.view, "(");
    expect(literal.view.state.doc.toString()).toBe("value(");

    const formula = render("=", { mode: "cell" });
    type(formula.view, "(");
    expect(formula.view.state.doc.toString()).toBe("=()");

    const formulaField = render("SUM", { mode: "formula" });
    type(formulaField.view, "(");
    expect(formulaField.view.state.doc.toString()).toBe("SUM()");

    const script = render("", { mode: "script" });
    type(script.view, "(");
    expect(script.view.state.doc.toString()).toBe("()");

    const markdown = render("", { mode: "markdown" });
    type(markdown.view, "(");
    expect(markdown.view.state.doc.toString()).toBe("()");
    const markdownColumn = render("", { mode: "markdown" });
    type(markdownColumn.view, "[");
    expect(markdownColumn.view.state.doc.toString()).toBe("[");
    const markdownTag = render("", { mode: "markdown" });
    type(markdownTag.view, "{");
    expect(markdownTag.view.state.doc.toString()).toBe("{");
  });

  it("dismisses completion before Escape cancels and does not commit during composition", async () => {
    const { wrapper, view } = render("=rou");
    await complete(view);
    await wrapper.get(".cm-content").trigger("keydown", { key: "Escape", keyCode: 27 });
    expect(wrapper.emitted("cancel")).toBeUndefined();
    await wrapper.get(".cm-content").trigger("keydown", { key: "Escape", keyCode: 27 });
    expect(wrapper.emitted("cancel")).toHaveLength(1);
    await wrapper
      .get(".cm-content")
      .trigger("keydown", { key: "Enter", keyCode: 13, isComposing: true });
    expect(wrapper.emitted("commit")).toBeUndefined();
  });

  it("enforces the length limit and prevents read-only edits and completion", async () => {
    const { wrapper, view } = render("=B2", { maxLength: 4 });
    view.dispatch({ changes: { from: 3, insert: "+12" } });
    expect(view.state.doc.toString()).toBe("=B2");
    view.dispatch({ changes: { from: 3, insert: "\n" } });
    expect(view.state.doc.toString()).toBe("=B2");
    view.dispatch({ changes: { from: 3, insert: "+" } });
    expect(view.state.doc.toString()).toBe("=B2+");
    await wrapper.setProps({ readonly: true });
    view.dispatch({ changes: { from: 0, to: 4, insert: "=rou" } });
    expect(view.state.doc.toString()).toBe("=B2+");
    await wrapper.get(".cm-content").trigger("keydown", { key: "Enter", keyCode: 13 });
    expect(wrapper.emitted("commit")).toBeUndefined();
    expect(wrapper.get(".cm-content").attributes("contenteditable")).toBe("false");
  });

  it("keeps configuration when a mounted editor starts another target", async () => {
    const { wrapper, view } = render("=B2", { maxLength: 4 });
    await wrapper.setProps({
      state: EditorState.create({ doc: "=C3", selection: { anchor: 3 } }),
      label: "Formula in Sales!A2",
    });
    expect(wrapper.get(".cm-content").attributes("aria-label")).toBe("Formula in Sales!A2");
    expect(wrapper.find(".formula-token--identifier").text()).toBe("C3");
    view.dispatch({ changes: { from: 3, insert: "+12" } });
    expect(view.state.doc.toString()).toBe("=C3");
    await wrapper.get(".cm-content").trigger("keydown", { key: "Enter", keyCode: 13 });
    expect(wrapper.emitted("commit")).toEqual([["Enter", false]]);
  });

  it("binds Mod-D to select the next occurrence and leaves it to the browser when handled nowhere", () => {
    const { view } = render("word word");
    expect(view.state.facet(EditorState.allowMultipleSelections)).toBe(true);
    view.dispatch({ selection: { anchor: 0, head: 4 } });

    const handled = new KeyboardEvent("keydown", {
      key: "d",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(handled);
    expect(handled.defaultPrevented).toBe(true);
    expect(view.state.selection.ranges.map(({ from, to }) => [from, to])).toEqual([
      [0, 4],
      [5, 9],
    ]);

    const unhandled = new KeyboardEvent("keydown", {
      key: "d",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    view.contentDOM.dispatchEvent(unhandled);
    expect(unhandled.defaultPrevented).toBe(false);
  });
});

describe("multiline keyboard behavior", () => {
  it.each(["script", "markdown"] as const)(
    "inserts newlines, retains Escape drafts, and explicitly commits %s",
    async (mode) => {
      const { wrapper, view } = render(mode === "script" ? "Value = 1" : "# Heading", { mode });
      expect(view.contentDOM.getAttribute("aria-multiline")).toBe("true");
      await wrapper.get(".cm-content").trigger("keydown", { key: "Enter" });
      expect(view.state.doc.toString()).toContain("\n");
      expect(wrapper.emitted("commit")).toBeUndefined();
      await wrapper.get(".cm-content").trigger("keydown", { key: "Escape" });
      expect(wrapper.emitted("cancel")).toBeUndefined();
      await wrapper.get(".cm-content").trigger("keydown", { key: "Enter", ctrlKey: true });
      expect(wrapper.emitted("commit")).toEqual([["Enter", false]]);
      await wrapper.get(".cm-content").trigger("keydown", { key: "Tab", shiftKey: true });
      expect(wrapper.emitted("commit")?.at(-1)).toEqual(["Tab", true]);
    },
  );

  it("highlights script definitions and comments and template delimiters independently of formulas", () => {
    const script = render("// comment\nScale(amount) = SUM(amount, 2)", { mode: "script" }).wrapper;
    expect(script.get(".formula-token--comment").text()).toBe("// comment");
    expect(script.get(".formula-token--definition").text()).toContain("Scale(amount)");
    const template = render("Prose {% let Count = 2 %}{{ Count + 1 }}", {
      mode: "markdown",
    }).wrapper;
    expect(template.get(".formula-token--keyword").text()).toBe("let");
    expect(template.findAll(".formula-token--delimiter").map((span) => span.text())).toEqual([
      "{%",
      "%}",
      "{{",
      "}}",
    ]);
  });

  it.each(["script", "markdown"] as const)(
    "accepts a 50,000-character %s draft and refuses larger changes",
    (mode) => {
      const { view } = render("", { mode });
      const source =
        mode === "script" ? "// comment\n".repeat(4_545) + "     " : "# Heading\n".repeat(5_000);
      expect(source.length).toBe(50_000);
      view.dispatch({ changes: { from: 0, insert: source } });
      expect(view.state.doc.length).toBe(50_000);
      view.dispatch({ changes: { from: view.state.doc.length, insert: "x" } });
      expect(view.state.doc.length).toBe(50_000);
    },
  );

  it("highlights Markdown prose but excludes template tags inside code and emphasis", async () => {
    const { wrapper, view } = render(
      "# Heading\n**bold** *italic* [link](https://example.com)\n`{{ A1 + 2 }}`\n```\n{{ B2 }}\n```\n**{% let Value = 3 %}**",
      { mode: "markdown" },
    );
    expect(
      wrapper
        .findAll(".formula-prose--heading")
        .map((span) => span.text())
        .join(""),
    ).toContain("Heading");
    expect(
      wrapper.findAll(".formula-prose--strong").some((span) => span.text().includes("bold")),
    ).toBe(true);
    expect(
      wrapper.findAll(".formula-prose--emphasis").some((span) => span.text().includes("italic")),
    ).toBe(true);
    expect(wrapper.findAll(".formula-prose--link").length).toBeGreaterThan(0);
    expect(
      wrapper
        .findAll('[class*="formula-prose--"]')
        .every(
          (span) =>
            !span.text().includes("A1") &&
            !span.text().includes("B2") &&
            !span.text().includes("Value"),
        ),
    ).toBe(true);
    expect(wrapper.findAll(".formula-token--identifier").map((span) => span.text())).toContain(
      "B2",
    );
    await wrapper.setProps({ mode: "script" });
    expect(wrapper.find('[class*="formula-prose--"]').exists()).toBe(false);
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "Value = 2" } });
    expect(wrapper.get(".formula-token--definition").text()).toContain("Value");
  });

  it("colors only direct references in the active expression and updates after caret movement", () => {
    const { wrapper, view } = render("{{ A1 + A1 }}\n{{ B2 }}", { mode: "markdown" });
    expect(wrapper.findAll(".formula-reference").map((span) => span.text())).toEqual([]);
    view.dispatch({ selection: { anchor: 5 } });
    const references = wrapper.findAll(".formula-reference");
    expect(references.map((span) => span.text())).toEqual(["A1", "A1"]);
    expect(references[0]!.attributes("data-reference-color")).toBe(
      references[1]!.attributes("data-reference-color"),
    );
    view.dispatch({ selection: { anchor: 18 } });
    expect(wrapper.findAll(".formula-reference").map((span) => span.text())).toEqual(["B2"]);
  });

  it("does not publish another editor state when context objects change without changing their contents", async () => {
    const context = { pages: [], tables: [], pageId: "p" };
    const { wrapper } = render("=A1", { context });
    const count = wrapper.emitted("update:state")!.length;
    await wrapper.setProps({ context: { ...context, pages: [], tables: [] } });
    expect(wrapper.emitted("update:state")!).toHaveLength(count);
    await wrapper.setProps({ context: { ...context, pageId: "other" } });
    expect(wrapper.emitted("update:state")!).toHaveLength(count + 1);
  });

  it("uses the active editor history for draft controls even while completion is open", async () => {
    const { wrapper, view } = render("=r", { pickingKey: "session" });
    view.dispatch({
      changes: { from: 2, insert: "ou" },
      selection: { anchor: 4 },
      userEvent: "input.type",
    });
    await complete(view);
    const picking = useReferencePickingStore();
    expect(picking.canUndo).toBe(true);
    picking.draftHistory("undo");
    expect(view.state.doc.toString()).toBe("=r");
    expect(picking.canRedo).toBe(true);
    picking.draftHistory("redo");
    expect(view.state.doc.toString()).toBe("=rou");
    expect(wrapper.emitted("commit")).toBeUndefined();
  });
});

it("applies keyboard characters through editor selection while retaining native composition and fill", async () => {
  const { wrapper, view } = render('="ab"');
  view.dispatch({ selection: { anchor: 3 } });
  await wrapper.get(".cm-content").trigger("keydown", { key: "X" });
  const input = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: "X",
  });
  view.contentDOM.dispatchEvent(input);
  expect(input.defaultPrevented).toBe(true);
  expect(view.state.doc.toString()).toBe('="aXb"');
  expect(view.state.selection.main.anchor).toBe(4);
  await wrapper.get(".cm-content").trigger("keydown", { key: "Y" });
  const composing = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: "Y",
    isComposing: true,
  });
  view.contentDOM.dispatchEvent(composing);
  expect(composing.defaultPrevented).toBe(false);
  expect(view.state.doc.toString()).toBe('="aXb"');
  const fill = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    inputType: "insertText",
    data: "Z",
  });
  view.contentDOM.dispatchEvent(fill);
  expect(fill.defaultPrevented).toBe(false);
});
