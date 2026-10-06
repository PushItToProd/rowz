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

async function complete(view: EditorView) {
  startCompletion(view);
  await vi.waitFor(() => {
    expect(completionStatus(view.state)).toBe("active");
  });
}

describe("shared formula editor", () => {
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
    expect(first.view.state.doc.toString()).toMatch(/^=ROUND/);
    expect(first.wrapper.emitted("commit")).toHaveLength(1);

    const second = render("=rou");
    await complete(second.view);
    await second.wrapper.get(".cm-content").trigger("keydown", { key: "Tab", keyCode: 9 });
    expect(second.view.state.doc.toString()).toMatch(/^=ROUND/);
    expect(second.wrapper.emitted("commit")).toBeUndefined();
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
