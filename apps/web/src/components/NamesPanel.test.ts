import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { changeWith, snapshotWith, wireSnapshot, type MockedApi } from "../testing";
import { EditorView } from "@codemirror/view";
import { useFormulaSessionStore } from "../formula/session";
import FormulaSessionHost from "./FormulaSessionHost.vue";
import NamesPanel from "./NamesPanel.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

let wrapper: VueWrapper;

async function render(
  names: { name: string; formula: string }[],
  cells: Record<string, string> = {},
  suggestion?: string,
): Promise<void> {
  const snapshot = wireSnapshot(snapshotWith(cells));
  server.getSnapshot.mockResolvedValue({
    ...snapshot,
    tables: snapshot.tables.map((table) => ({ ...table, names })),
  });
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(
    {
      components: { NamesPanel, FormulaSessionHost },
      setup: () => ({ store, suggestion }),
      template: `<NamesPanel v-if="store.tables[0]" :table="store.tables[0]" :suggestion="suggestion" /><FormulaSessionHost />`,
    },
    { attachTo: document.body },
  );
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
afterEach(() => {
  wrapper.unmount();
});

function editor(label: string): EditorView {
  return EditorView.findFromDOM(wrapper.get(`[aria-label="${label}"]`).element as HTMLElement)!;
}
async function edit(label: string, text: string): Promise<EditorView> {
  const input = wrapper.find(`input[aria-label="${label}"]`);
  if (input.exists()) {
    (input.element as HTMLInputElement).focus();
    await flushPromises();
  }
  const view = editor(label);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
    userEvent: "input.type",
  });
  await flushPromises();
  return view;
}

describe("NamesPanel", () => {
  it("shows each name with its formula and value", async () => {
    await render([{ name: "Fee", formula: "A1 * 2" }], { A1: "4" });
    expect(wrapper.get("th").text()).toBe("Fee");
    expect(wrapper.get('input[aria-label="Formula of the name"]').element).toHaveProperty(
      "value",
      "A1 * 2",
    );
    expect(wrapper.get(".names-panel__value").text()).toBe("8");
  });

  it("shows why a name has an error", async () => {
    await render([{ name: "Broken", formula: "1 +" }]);
    expect(wrapper.get(".names-panel__value").text()).toMatch(/^#/);
    expect(wrapper.find(".script__reason").exists()).toBe(true);
  });

  it("adds a name to the list the table holds", async () => {
    server.setTableNames.mockResolvedValue(changeWith());
    await render([{ name: "Fee", formula: "3" }], {}, "B2:B4");
    const inputs = wrapper.findAll(".names-panel__add input");
    expect(editor("Formula of the new name").state.doc.toString()).toBe("B2:B4");
    await inputs[0]!.setValue("Amounts");
    await wrapper.get(".names-panel__add").trigger("submit");
    await flushPromises();
    expect(server.setTableNames).toHaveBeenCalledWith("t1", [
      { name: "Fee", formula: "3" },
      { name: "Amounts", formula: "B2:B4" },
    ]);
  });

  it("removes a name", async () => {
    server.setTableNames.mockResolvedValue(changeWith());
    await render([
      { name: "Fee", formula: "3" },
      { name: "Tax", formula: "4" },
    ]);
    await wrapper.get('button[aria-label="Remove Fee"]').trigger("click");
    await flushPromises();
    expect(server.setTableNames).toHaveBeenCalledWith("t1", [{ name: "Tax", formula: "4" }]);
  });
  it("saves an existing name once on Enter, with exact text and a captured name target", async () => {
    await render([{ name: "Fee", formula: "3" }]);
    server.updateNamedFormula.mockResolvedValue(changeWith());
    await edit("Formula of the name", " 1 + 2 ");
    await wrapper.get('[aria-label="Formula of the name"]').trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(server.updateNamedFormula).toHaveBeenCalledExactlyOnceWith("t1", "Fee", " 1 + 2 ");
    expect(server.setTableNames).not.toHaveBeenCalled();
  });

  it("blocks removing a name and closing its panel on failure, then permits retry or cancel", async () => {
    await render([{ name: "Fee", formula: "3" }]);
    server.updateNamedFormula.mockRejectedValue(new Error("Offline"));
    const view = await edit("Formula of the name", "1 + 2");
    await wrapper.get('button[aria-label="Remove Fee"]').trigger("click");
    await flushPromises();
    expect(server.setTableNames).not.toHaveBeenCalled();
    const close = wrapper.findAll("button").find((button) => button.text() === "Close")!;
    await close.trigger("click");
    await flushPromises();
    expect(wrapper.findComponent(NamesPanel).emitted("close")).toBeUndefined();
    expect(document.activeElement).toBe(view.contentDOM);
    expect(useFormulaSessionStore().active?.state.doc.toString()).toBe("1 + 2");
    await wrapper.get('[aria-label="Formula of the name"]').trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(useFormulaSessionStore().active).toBeUndefined();
    expect(server.setTableNames).not.toHaveBeenCalled();
  });

  it("retains a remotely removed name until submission and recovers its exact draft", async () => {
    await render([{ name: "Fee", formula: "3" }]);
    await edit("Formula of the name", "1 + 2");
    const store = useWorkbookStore();
    store.tables = store.tables.map((table) => ({
      ...table,
      names: [{ name: "Replacement", formula: "keep" }],
    }));
    await flushPromises();
    expect(useFormulaSessionStore().active?.deleted).toBeUndefined();
    server.updateNamedFormula.mockRejectedValue(
      Object.assign(new Error("Name not found"), { code: "not_found" }),
    );
    await useFormulaSessionStore().submit(store.submitFormulaDraft);
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "The editing target was deleted",
    );
    const copy = EditorView.findFromDOM(
      document.querySelector<HTMLElement>('[aria-label="Unsaved formula for copying"]')!,
    )!;
    expect(copy.state.doc.toString()).toBe("1 + 2");
    expect(server.setTableNames).not.toHaveBeenCalled();
  });

  it("moves through the new-name controls without creating a name or losing the formula", async () => {
    await render([]);
    await wrapper.get('[aria-label="New name"]').setValue("Amounts");
    const view = await edit("Formula of the new name", "1 + 2");
    view.focus();
    await wrapper.get('[aria-label="Formula of the new name"]').trigger("keydown", { key: "Tab" });
    await flushPromises();
    expect(document.activeElement?.textContent.trim()).toBe("Add name");
    expect(server.setTableNames).not.toHaveBeenCalled();
    expect(useFormulaSessionStore().active).toBeUndefined();
    view.focus();
    await wrapper
      .get('[aria-label="Formula of the new name"]')
      .trigger("keydown", { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(wrapper.get('[aria-label="New name"]').element);
    expect(view.state.doc.toString()).toBe("1 + 2");
    server.setTableNames.mockResolvedValueOnce(changeWith());
    await wrapper
      .get('[aria-label="Formula of the new name"]')
      .trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(server.setTableNames).toHaveBeenCalledExactlyOnceWith("t1", [
      { name: "Amounts", formula: "1 + 2" },
    ]);
    expect(view.state.doc.toString()).toBe("");
  });

  it("keeps both new-name fields after a failed save and discards them on Cancel", async () => {
    await render([]);
    await wrapper.get('[aria-label="New name"]').setValue("Amounts");
    const view = await edit("Formula of the new name", "1 + 2");
    server.setTableNames.mockRejectedValueOnce(new Error("Offline"));
    await wrapper.get("form").trigger("submit");
    await flushPromises();
    expect(wrapper.get('[aria-label="New name"]').element).toHaveProperty("value", "Amounts");
    expect(view.state.doc.toString()).toBe("1 + 2");
    expect(document.activeElement).toBe(view.contentDOM);
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Cancel")!
      .trigger("click");
    await flushPromises();
    expect(view.state.doc.toString()).toBe("");
    expect(wrapper.get('[aria-label="New name"]').element).toHaveProperty("value", "");
    expect(server.setTableNames).toHaveBeenCalledTimes(1);
  });
});
