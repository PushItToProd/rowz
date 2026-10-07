import { wireSnapshot, changeWith } from "../testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import {
  appDialog,
  at,
  mountDialogHost,
  respondToDialog,
  snapshotWith,
  type MockedApi,
} from "../testing";
import ChartCard from "./ChartCard.vue";
import { EditorView } from "@codemirror/view";
import { useFormulaSessionStore } from "../formula/session";
import FormulaSessionHost from "./FormulaSessionHost.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

const CHART: ViewRecord = {
  id: "v1",
  pageId: "p1",
  kind: "chart",
  name: "Chart 1",
  position: 1,
  source: "'Table 1'!A1:B3",
  chartType: "bar",
};
const CELLS = { A1: "apples", B1: "3", A2: "pears", B2: "5", A3: "plums", B3: "=B1+B2" };

let wrapper: VueWrapper;
let dialogHost: VueWrapper;

/** Shows the store's first view, so the card follows changes the store makes to it. */
async function render(view: Partial<ViewRecord> = {}, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue(
    wireSnapshot({
      ...snapshotWith(CELLS, role),
      views: [{ ...CHART, ...view }],
    }),
  );
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(
    {
      components: { ChartCard, FormulaSessionHost },
      setup: () => ({ store }),
      template: `<ChartCard v-if="store.views[0]" :view="store.views[0]" /><FormulaSessionHost />`,
    },
    { attachTo: document.body },
  );
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  dialogHost = mountDialogHost();
  server.updateView.mockImplementation((_id, changes) =>
    Promise.resolve(changeWith({ ...CHART, ...changes })),
  );
});
afterEach(() => {
  wrapper.unmount();
  dialogHost.unmount();
});

async function editSource(text: string): Promise<EditorView> {
  const input = wrapper.find('input[aria-label="Chart data"]');
  if (input.exists()) {
    await input.trigger("focus");
    await flushPromises();
  }
  const editor = EditorView.findFromDOM(wrapper.get(".cm-editor").element as HTMLElement)!;
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text },
    selection: { anchor: text.length },
    userEvent: "input.type",
  });
  await wrapper.vm.$nextTick();
  return editor;
}

describe("ChartCard", () => {
  it("draws the cells its data names, computing formulas among them", async () => {
    await render();
    expect(wrapper.get(".chart").attributes("data-chart")).toBe("bar");
    expect(wrapper.findAll("[data-chart-value]").map((title) => title.text())).toEqual([
      "apples: 3",
      "pears: 5",
      "plums: 8",
    ]);
  });

  it("redraws when a cell changes", async () => {
    await render();
    await useWorkbookStore().setCell(at("B1"), "10");
    await flushPromises();
    expect(wrapper.findAll("[data-chart-value]").map((title) => title.text())).toEqual([
      "apples: 10",
      "pears: 5",
      "plums: 15",
    ]);
  });

  it("draws the kind of chart that is chosen, and saves a new choice", async () => {
    await render({ chartType: "pie" });
    expect(wrapper.findAll("[data-chart-value]")).toHaveLength(3);

    await wrapper.get("select").setValue("line");
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledWith("v1", {
      revision: expect.any(Number),
      chartType: "line",
    });
    expect(wrapper.get(".chart").attributes("data-chart")).toBe("line");
  });

  it("saves new data on Enter and on leaving the box, but not when nothing changed", async () => {
    await render();
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Chart data"]');
    await input.trigger("blur");
    expect(server.updateView).not.toHaveBeenCalled();

    await editSource("'Table 1'!A1:B2");
    await wrapper.get(".cm-content").trigger("keydown", { key: "Enter", keyCode: 13 });
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledWith("v1", {
      source: "'Table 1'!A1:B2",
    });
    expect(wrapper.findAll("[data-chart-value]")).toHaveLength(2);

    await wrapper.get('input[aria-label="Chart data"]').trigger("blur");
    expect(server.updateView).toHaveBeenCalledTimes(1);
  });

  it("accepts a formula that gives a range, with or without the leading =", async () => {
    await render({ source: "=FILTER('Table 1'!A1:B3, 'Table 1'!B1:B3 > 4)" });
    expect(wrapper.findAll("[data-chart-value]").map((title) => title.text())).toEqual([
      "pears: 5",
      "plums: 8",
    ]);
  });

  it("asks for data when it has none", async () => {
    await render({ source: "" });
    expect(wrapper.find(".chart").exists()).toBe(false);
    expect(wrapper.get(".view-card__problem").text()).toContain("Enter the cells to chart");
  });

  it.each([
    ["Missing!A1:B2", "#REF!"],
    ["SUM(", "#ERROR!"],
    ["A1:B2", "#REF!"],
  ])("shows the error when its data %s cannot be read", async (source, code) => {
    await render({ source });
    expect(wrapper.find(".chart").exists()).toBe(false);
    expect(wrapper.get(".view-card__problem").text()).toContain(code);
  });

  it("follows a source the server rewrote", async () => {
    await render();
    const store = useWorkbookStore();
    server.updateTable.mockResolvedValue(
      changeWith({
        table: { ...store.tables[0]!, name: "Fruit" },
        cells: [],
        views: [{ id: "v1", source: "Fruit!A1:B3" }],
        tables: [],
      }),
    );
    await store.updateTable("t1", { name: "Fruit" });
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Chart data"]').element.value).toBe(
      "Fruit!A1:B3",
    );
    expect(wrapper.findAll("[data-chart-value]")).toHaveLength(3);
  });

  it("keeps the source draft while the input has focus", async () => {
    await render();
    const store = useWorkbookStore();
    const editor = await editSource("draft source");

    store.views = store.views.map((view) => ({ ...view, source: "source from undo" }));
    await flushPromises();
    expect(editor.state.doc.toString()).toBe("draft source");
  });

  it("saves on blur, cancels without saving, and preserves failed drafts and focus", async () => {
    await render();
    const editor = await editSource("'Table 1'!A1:B2");
    editor.contentDOM.blur();
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledExactlyOnceWith("v1", { source: "'Table 1'!A1:B2" });
    await editSource("discard me");
    await wrapper.get(".cm-content").trigger("keydown", { key: "Escape", keyCode: 27 });
    await flushPromises();
    expect(useFormulaSessionStore().active).toBeUndefined();
    expect(server.updateView).toHaveBeenCalledTimes(1);

    await editSource("retain me");
    server.updateView.mockRejectedValueOnce(new Error("Offline"));
    await wrapper.get(".cm-content").trigger("keydown", { key: "Enter", keyCode: 13 });
    await flushPromises();
    expect(useFormulaSessionStore().active!.state.doc.toString()).toBe("retain me");
    expect(wrapper.get('[role="alert"]').text()).toBe("Offline");
    expect(document.activeElement).toBe(wrapper.get(".cm-content").element);
    await wrapper.get(".cm-content").trigger("keydown", { key: "Enter", keyCode: 13 });
    await flushPromises();
    expect(useFormulaSessionStore().active).toBeUndefined();
  });

  it("does not run a requested chart-control action after a failed source save", async () => {
    await render();
    await editSource("retain me");
    server.updateView.mockRejectedValue(new Error("Offline"));
    await wrapper.get("select").setValue("pie");
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledExactlyOnceWith("v1", { source: "retain me" });
    expect(wrapper.get("select").element).toHaveProperty("value", "bar");
    await wrapper.get("button.danger").trigger("click");
    await flushPromises();
    expect(server.deleteView).not.toHaveBeenCalled();
    expect(appDialog()).toBeNull();
  });

  it("keeps a draft when its chart unmounts and reports deletion only on submission", async () => {
    await render();
    await editSource('SUM(1, "copy me")');
    useWorkbookStore().views = [];
    await flushPromises();
    const session = useFormulaSessionStore();
    expect(session.active!.state.doc.toString()).toBe('SUM(1, "copy me")');
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(wrapper.find(".formula-session-fallback").exists()).toBe(true);
    await wrapper
      .get(".formula-session-fallback .cm-content")
      .trigger("keydown", { key: "Enter", keyCode: 13 });
    await flushPromises();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("Your input was not saved");
    expect(dialog.querySelector(".cm-content")?.textContent).toBe('SUM(1, "copy me")');
    expect(dialog.querySelector(".cm-content")?.getAttribute("contenteditable")).toBe("false");
    expect(server.updateView).not.toHaveBeenCalled();
  });

  it("deletes the chart after confirming", async () => {
    await render();
    await wrapper.get("button.danger").trigger("click");
    await flushPromises();
    expect(appDialog()?.textContent).toContain("Delete Chart 1?");
    await respondToDialog("cancel");
    expect(server.deleteView).not.toHaveBeenCalled();

    await wrapper.get("button.danger").trigger("click");
    await flushPromises();
    await respondToDialog("confirm");
    expect(server.deleteView).toHaveBeenCalledWith("v1");
  });

  it("shows a viewer the chart without the means to change it", async () => {
    await render({}, "viewer");
    expect(wrapper.findAll("[data-chart-value]")).toHaveLength(3);
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.findAll("button").map((button) => button.attributes("aria-label"))).toEqual([
      "Collapse Chart 1",
      "Block actions for Chart 1",
    ]);
  });
});
