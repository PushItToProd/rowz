import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { api } from "../api/client";
import { changeWith, snapshotWith, wireSnapshot, type MockedApi } from "../testing";
import EditorView from "./EditorView.vue";
import { useWorkbookStore } from "../stores/workbook";
import { useFormulaSessionStore } from "../formula/session";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
vi.mock("../api/live", () => ({ watchSpreadsheet: () => vi.fn() }));
const server = api as unknown as MockedApi;
const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

afterEach(() => {
  if (matchMediaDescriptor) Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
  else Reflect.deleteProperty(window, "matchMedia");
});

async function render(
  role = "owner",
  empty = false,
  focusCards = false,
  inputs: Record<string, string> = {},
) {
  const snapshot = snapshotWith(inputs, role);
  server.getSnapshot.mockResolvedValue(
    wireSnapshot({
      ...snapshot,
      tables: empty ? [] : snapshot.tables,
      views: empty
        ? []
        : [
            {
              id: "v1",
              pageId: "p1",
              kind: "text",
              name: "Text",
              position: 2,
              source: "",
              chartType: null,
            },
          ],
    }),
  );
  server.createTable.mockResolvedValue({ table: snapshot.tables[0]!, change: changeWith() });
  server.createView.mockResolvedValue({
    view: {
      id: "v2",
      pageId: "p1",
      kind: "text",
      name: "Text",
      position: 1,
      source: "",
      chartType: null,
    },
    change: changeWith(),
  });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/s/:spreadsheetId/p/:pageId?", name: "editor", component: { template: "<div />" } },
      { path: "/spreadsheets", name: "spreadsheets", component: { template: "<div />" } },
      { path: "/help", name: "help", component: { template: "<div />" } },
    ],
  });
  await router.push({ name: "editor", params: { spreadsheetId: "s1" } });
  const wrapper = mount(EditorView, {
    props: { spreadsheetId: "s1", pageId: "p1" },
    attachTo: focusCards ? document.body : undefined,
    global: {
      plugins: [router],
      stubs: {
        TableCard: focusCards
          ? { template: '<div role="grid" tabindex="0" aria-label="Table grid"></div>' }
          : true,
        ChartCard: focusCards ? { template: '<button type="button">Card control</button>' } : true,
        ScriptCard: focusCards ? { template: '<button type="button">Card control</button>' } : true,
        TextCard: focusCards ? { template: '<button type="button">Card control</button>' } : true,
        FormulaBar: true,
        FormatBar: true,
        PageTabs: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

it("captures Ctrl/Cmd+F only inside the editor and F3 navigates an open find panel", async () => {
  const wrapper = await render("owner", false, true, { A1: "needle", A2: "needle" });
  const store = useWorkbookStore();
  const outside = new KeyboardEvent("keydown", {
    key: "f",
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(outside);
  expect(outside.defaultPrevented).toBe(false);
  const grid = wrapper.get('[role="grid"]');
  await grid.trigger("keydown", { key: "f", metaKey: true });
  await flushPromises();
  expect(wrapper.find('[aria-label="Find and replace"]').exists()).toBe(true);
  const findInput = wrapper.get('[aria-label="Find text"]');
  await findInput.setValue("needle");
  expect(document.activeElement).toBe(findInput.element);
  expect(wrapper.get('[aria-label="Find and replace"] [role="status"]').text()).toBe("2 matches");
  // The leading template comment gives EditorView a fragment root. Its wrapper
  // targets the mount container, outside .editor; keyboard events start at the focused input.
  await findInput.trigger("keydown", { key: "F3" });
  await flushPromises();
  expect(wrapper.get('[aria-label="Find and replace"] [role="status"]').text()).toBe(
    "2 matches · 1 of 2",
  );
  expect(store.selection).toEqual({ tableId: "t1", row: 0, col: 0 });
  await findInput.trigger("keydown", { key: "F3" });
  await flushPromises();
  expect(store.selection).toEqual({ tableId: "t1", row: 1, col: 0 });
  await findInput.trigger("keydown", { key: "F3", shiftKey: true });
  await flushPromises();
  expect(store.selection).toEqual({ tableId: "t1", row: 0, col: 0 });
  await wrapper.get('[aria-label="Find text"]').trigger("keydown", { key: "Escape" });
  expect(wrapper.find('[aria-label="Find and replace"]').exists()).toBe(false);
  wrapper.unmount();
});

it("blocks page-control clicks on save failure, and cancel does not replay them", async () => {
  const wrapper = await render();
  const store = useWorkbookStore();
  store.views = [
    {
      id: "chart",
      pageId: "p1",
      name: "Chart",
      kind: "chart",
      source: "1",
      chartType: "bar",
      position: 1,
    },
  ];
  const formulas = useFormulaSessionStore();
  await formulas.start(
    {
      target: { kind: "chart", viewId: "chart" },
      context: { pageId: "p1" },
      mode: "formula",
      text: "draft",
    },
    store.submitFormulaDraft,
  );
  server.updateView.mockRejectedValueOnce(new Error("Offline"));
  const button = wrapper.findAll("button").find((item) => item.text() === "Save a copy")!;
  await button.trigger("click");
  await flushPromises();
  expect(server.copySpreadsheet).not.toHaveBeenCalled();
  expect(formulas.active?.state.doc.toString()).toBe("draft");
  formulas.cancel();
  await flushPromises();
  expect(server.copySpreadsheet).not.toHaveBeenCalled();
  wrapper.unmount();
});

it("lets a viewer save a copy and navigate to it", async () => {
  const wrapper = await render("viewer");
  server.copySpreadsheet.mockResolvedValue({ id: "copy", name: "Budget (copy)", updatedAt: "" });
  server.getSnapshot.mockResolvedValue(
    wireSnapshot({ ...snapshotWith({}, "owner"), id: "copy", name: "Budget (copy)" }),
  );
  const push = vi.spyOn(wrapper.vm.$router, "push");
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Save a copy")!
    .trigger("click");
  await flushPromises();
  expect(server.copySpreadsheet).toHaveBeenCalledWith("s1");
  expect(push).toHaveBeenCalledWith({ name: "editor", params: { spreadsheetId: "copy" } });
  await wrapper.setProps({ spreadsheetId: "copy" });
  await flushPromises();
  expect(wrapper.get('[role="status"]').text()).toContain(
    "Copy saved. You are now editing “Budget (copy)”.",
  );
  expect(wrapper.get(".notice__action").text()).toBe("Back to original");
  expect(wrapper.get(".notice__action").attributes("href")).toBe("/s/s1/p/p1");
  wrapper.unmount();
});

it("reports a failed copy and leaves the document open", async () => {
  const wrapper = await render();
  server.copySpreadsheet.mockRejectedValue(new Error("Copy failed"));
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Save a copy")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.text()).toContain("Copy failed");
  expect(
    wrapper
      .findAll("button")
      .find((button) => button.text() === "Save a copy")!
      .attributes("disabled"),
  ).toBeUndefined();
  wrapper.unmount();
});

it("places insertion controls before, between, and after blocks and sends their indices", async () => {
  const wrapper = await render();
  expect(wrapper.get("main").element.children.length).toBe(5);
  expect(
    Array.from(wrapper.get("main").element.children).map((element) => element.className),
  ).toEqual(["editor__add", "editor__block", "editor__add", "editor__block", "editor__add"]);
  const rows = wrapper.findAll("[data-insert-position]");
  expect(rows.map((row) => row.attributes("data-insert-position"))).toEqual(["0", "1", "2"]);
  await rows[0]!.findAll("button")[0]!.trigger("click");
  await rows[1]!.findAll("button")[1]!.trigger("click");
  await rows[2]!.findAll("button")[2]!.trigger("click");
  await flushPromises();
  expect(server.createTable).toHaveBeenCalledWith("p1", 0);
  expect(server.createView).toHaveBeenCalledWith("p1", "chart", 1);
  expect(server.createView).toHaveBeenCalledWith("p1", "text", 2);
  expect(rows[0]!.findAll("button").every((button) => button.attributes("tabindex") !== "-1")).toBe(
    true,
  );
  wrapper.unmount();
});

it("scrolls to and focuses each kind of block after it is added", async () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  const wrapper = await render("owner", true, true);
  const store = useWorkbookStore();
  const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
  vi.spyOn(store, "addTable").mockImplementation((pageId, position) => {
    store.tables.push({
      ...snapshotWith().tables[0]!,
      id: "added-table",
      pageId,
      name: "Added Table",
      position: position ?? 0,
    });
    return Promise.resolve(true);
  });
  vi.spyOn(store, "addView").mockImplementation((pageId, kind, position) => {
    store.views.push({
      id: `added-${kind}`,
      pageId,
      name: `Added ${kind}`,
      kind,
      source: "",
      chartType: kind === "chart" ? "bar" : null,
      position: position ?? 0,
    });
    return Promise.resolve(true);
  });

  for (const name of ["Add table", "Add chart", "Add text", "Add script"]) {
    const row = wrapper.findAll("[data-insert-position]").at(-1)!;
    const button = row.findAll("button").find((candidate) => candidate.text() === name)!;
    expect(document.activeElement).not.toBe(button.element);
    await button.trigger("click");
    await flushPromises();

    const card = wrapper.findAll(".editor__block").at(-1)!;
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest", behavior: "smooth" });
    expect(card.element.contains(document.activeElement)).toBe(true);
    const focused = name === "Add table" ? card.find('[role="grid"]') : card.find("button");
    expect(document.activeElement).toBe(focused.element);
    if (name === "Add table")
      expect(store.selection).toEqual({ tableId: "added-table", row: 0, col: 0 });
  }
  wrapper.unmount();
});

it("does not take focus back when the user moves while a block is being added", async () => {
  const wrapper = await render("owner", false, true);
  const store = useWorkbookStore();
  const tableGrid = wrapper.find<HTMLElement>('[role="grid"]');
  store.selection = { tableId: "t1", row: 0, col: 0 };
  let finishAdd: ((success: boolean) => void) | undefined;
  vi.spyOn(store, "addTable").mockImplementation((pageId, position) => {
    return new Promise((resolve) => {
      finishAdd = (success) => {
        if (success)
          store.tables.push({
            ...snapshotWith().tables[0]!,
            id: "pending-table",
            pageId,
            name: "Pending Table",
            position: position ?? 0,
          });
        resolve(success);
      };
    });
  });

  const addButton = wrapper.findAll("button").find((button) => button.text() === "Add table")!;
  addButton.element.focus();
  await addButton.trigger("click");
  tableGrid.element.focus();
  finishAdd!(true);
  await flushPromises();

  expect(document.activeElement).toBe(tableGrid.element);
  expect(store.selection).toEqual({ tableId: "t1", row: 0, col: 0 });
  wrapper.unmount();
});

it("shows one insertion row on an empty page", async () => {
  const wrapper = await render("owner", true);
  expect(wrapper.findAll("[data-insert-position]")).toHaveLength(1);
  expect(wrapper.get("[data-insert-position]").attributes("data-insert-position")).toBe("0");
  wrapper.unmount();
});

it("hides insertion controls for readers", async () => {
  const wrapper = await render("viewer");
  expect(wrapper.findAll("[data-insert-position]")).toHaveLength(0);
  wrapper.unmount();
});
