import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditorView } from "@codemirror/view";
import { undo } from "@codemirror/commands";
import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { useFormulaSessionStore } from "../formula/session";
import { at, changeWith, snapshotWith, TABLE, type MockedApi, wireSnapshot } from "../testing";
import FormulaBar from "./FormulaBar.vue";
import GridView from "./GridView.vue";
import FormulaSessionHost from "./FormulaSessionHost.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;
let wrapper: VueWrapper;
async function render(inputs: Record<string, string> = {}, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith(inputs, role)));
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(
    {
      components: { FormulaBar, GridView, FormulaSessionHost },
      setup: () => ({ store }),
      template:
        '<FormulaBar /><GridView v-if="store.tables[0]" :table="store.tables[0]" /><FormulaSessionHost />',
    },
    { attachTo: document.body },
  );
}
const field = () => wrapper.get<HTMLInputElement>(".formula-bar input");
function editor(): EditorView {
  return EditorView.findFromDOM(wrapper.get(".formula-bar .cm-content").element as HTMLElement)!;
}
async function select(address: string): Promise<void> {
  useWorkbookStore().selection = at(address);
  await flushPromises();
}
async function focus(): Promise<EditorView> {
  field().element.focus();
  await flushPromises();
  return editor();
}
async function edit(text: string): Promise<EditorView> {
  const view = wrapper.find(".formula-bar .cm-content").exists() ? editor() : await focus();
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
    userEvent: "input.type",
  });
  await flushPromises();
  return view;
}
async function press(key: string, shiftKey = false): Promise<void> {
  await wrapper.get(".formula-bar .cm-content").trigger("keydown", { key, shiftKey });
  await flushPromises();
}
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
afterEach(() => {
  wrapper.unmount();
});

describe("FormulaBar", () => {
  it("is empty and disabled without a selected cell", async () => {
    await render();
    expect(field().element.value).toBe("");
    expect(field().attributes("disabled")).toBeDefined();
    expect(wrapper.get(".formula-bar__cell").text()).toBe("");
  });
  it("shows the selected cell input and follows selection and stored updates", async () => {
    await render({ A1: "2", B1: "=A1*3" });
    await select("B1");
    expect(wrapper.get(".formula-bar__cell").text()).toBe("Table 1 · B1");
    expect(field().element.value).toBe("=A1*3");
    await select("A1");
    await useWorkbookStore().setCell(at("A1"), "50");
    await flushPromises();
    expect(field().element.value).toBe("50");
  });
  it("saves once on Enter and hands focus to the next grid cell", async () => {
    await render({ A1: "2", A2: "7" });
    await select("A1");
    await edit("=1+1");
    await press("Enter");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ rowId: "r0", colId: "c1", input: "=1+1" }],
      expect.any(String),
      expect.any(Number),
      [],
    );
    expect(useWorkbookStore().selection).toEqual(at("A2"));
    expect(field().element.value).toBe("7");
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });
  it.each([false, true])("saves on Tab and navigates with Shift=%s", async (shift) => {
    await render();
    await select("B2");
    await edit("42");
    await press("Tab", shift);
    expect(useWorkbookStore().selection).toEqual(at(shift ? "A2" : "C2"));
    expect(useWorkbookStore().inputOf(at("B2"))).toBe("42");
    expect(server.setCells).toHaveBeenCalledTimes(1);
  });
  it("keeps Enter on the last row", async () => {
    await render();
    await select("B4");
    await edit("end");
    await press("Enter");
    expect(useWorkbookStore().selection).toEqual(at("B4"));
    expect(useWorkbookStore().inputOf(at("B4"))).toBe("end");
  });
  it("saves on blur and sends nothing when unchanged", async () => {
    await render({ A1: "2" });
    await select("A1");
    await focus();
    (wrapper.get(".grid").element as HTMLElement).focus();
    await flushPromises();
    expect(server.setCells).not.toHaveBeenCalled();
    await edit("3");
    (wrapper.get(".grid").element as HTMLElement).focus();
    await flushPromises();
    expect(server.setCells).toHaveBeenCalledOnce();
  });
  it("saves to the captured target before a grid click changes selection", async () => {
    await render({ A1: "2", B1: "5" });
    await select("A1");
    await edit("typed for A1");
    await wrapper.get('[data-cell="B1"]').trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(useWorkbookStore().inputOf(at("A1"))).toBe("typed for A1");
    expect(useWorkbookStore().selection).toEqual(at("B1"));
    expect(field().element.value).toBe("5");
  });
  it("blocks navigation on failure and keeps the draft focused for retry", async () => {
    await render({ A1: "2" });
    await select("A1");
    const view = await edit("99");
    server.setCells.mockRejectedValueOnce(new Error("Offline"));
    await press("Enter");
    expect(useWorkbookStore().selection).toEqual(at("A1"));
    expect(view.state.doc.toString()).toBe("99");
    expect(document.activeElement).toBe(view.contentDOM);
    expect(wrapper.get('[role="alert"]').text()).toBe("Offline");
    await press("Enter");
    expect(useWorkbookStore().selection).toEqual(at("A2"));
    expect(server.setCells).toHaveBeenCalledTimes(2);
  });
  it("discards with Escape without writing", async () => {
    await render({ A1: "2" });
    await select("A1");
    await edit("999");
    await press("Escape");
    expect(field().element.value).toBe("2");
    expect(server.setCells).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });
  it("shares text, caret, context, and undo history with the inline editor without saves", async () => {
    await render({ A1: "=B2" });
    await select("A1");
    await wrapper.get(".grid").trigger("keydown", { key: "F2" });
    await flushPromises();
    const inline = EditorView.findFromDOM(
      wrapper.get(".grid__editor .cm-content").element as HTMLElement,
    )!;
    inline.dispatch({
      changes: { from: 3, insert: "+1" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    await flushPromises();
    await field().trigger("mousedown", { button: 0 });
    await flushPromises();
    const view = editor();
    expect(wrapper.findAll(".cm-editor")).toHaveLength(1);
    expect(view.state.doc.toString()).toBe("=B2+1");
    expect(view.state.selection.main.anchor).toBe(2);
    expect(undo(view)).toBe(true);
    await flushPromises();
    expect(view.state.doc.toString()).toBe("=B2");
    expect(server.setCells).not.toHaveBeenCalled();
    await wrapper.get('[data-cell="A1"]').trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(wrapper.find(".grid__editor .cm-content").exists()).toBe(true);
    expect(server.setCells).not.toHaveBeenCalled();
  });
  it("retains exact draft text and identity through a remote row insertion", async () => {
    await render({ A2: "old" });
    await select("A2");
    await edit("=B2");
    const store = useWorkbookStore();
    await store.receiveChange(
      changeWith({
        table: { ...TABLE, rowCount: 5, rows: [{ id: "new", orderKey: "Zz" }, ...TABLE.rows] },
      }),
    );
    await flushPromises();
    expect(editor().state.doc.toString()).toBe("=B2");
    expect(wrapper.get(".formula-bar__cell").text()).toBe("Table 1 · A3");
    await press("Enter");
    expect(server.setCells).toHaveBeenCalledWith(
      "t1",
      [{ rowId: "r1", colId: "c1", input: "=B2" }],
      expect.any(String),
      expect.any(Number),
      [],
    );
  });
  it("does not discard a deleted target before submit and offers the exact draft for copying", async () => {
    await render();
    await select("A1");
    await edit("=B2 + 1");
    const store = useWorkbookStore();
    await store.receiveChange(
      changeWith({ table: { ...TABLE, rowCount: 3, rows: TABLE.rows.slice(1) } }),
    );
    await flushPromises();
    expect(useFormulaSessionStore().active?.deleted).toBeUndefined();
    await press("Enter");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "The editing target was deleted",
    );
    const copy = EditorView.findFromDOM(
      document.querySelector<HTMLElement>('[aria-label="Unsaved formula for copying"]')!,
    )!;
    expect(copy.state.doc.toString()).toBe("=B2 + 1");
    expect(server.setCells).not.toHaveBeenCalled();
  });
  it("gives completion keys precedence over saving", async () => {
    await render();
    await select("A1");
    const view = await edit("=round");
    startCompletion(view);
    await vi.waitFor(() => {
      expect(completionStatus(view.state)).toBe("active");
    });
    await press("ArrowDown");
    await press("Tab");
    expect(view.state.doc.toString()).toBe("=ROUNDDOWN(");
    expect(server.setCells).not.toHaveBeenCalled();
  });
  it("identifies an array's spill anchor in the placeholder", async () => {
    await render({ A1: "=SEQUENCE(3)" });
    await select("A2");
    expect(field().element.value).toBe("");
    expect(field().attributes("placeholder")).toBe("Filled by the formula in A1");
  });
  it("is disabled for viewers", async () => {
    await render({ A1: "2" }, "viewer");
    await select("A1");
    expect(field().element.value).toBe("2");
    expect(field().attributes("disabled")).toBeDefined();
  });
});
