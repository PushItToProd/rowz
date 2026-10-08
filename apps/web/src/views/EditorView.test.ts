import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { api, type ViewRecord } from "../api/client";
import { bodyFindAll, bodyGet, bodyHas } from "../testing/teleported";
import { takeQueuedListNotice } from "../notice";
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
  takeQueuedListNotice();
});

afterEach(() => {
  takeQueuedListNotice();
  if (matchMediaDescriptor) Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
  else Reflect.deleteProperty(window, "matchMedia");
});

async function render(
  role = "owner",
  empty = false,
  focusCards = false,
  inputs: Record<string, string> = {},
  realTableCard = false,
  extraViews: ViewRecord[] = [],
  initialPath = "/s/s1/p/p1",
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
            ...extraViews,
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
  await router.push(initialPath);
  const wrapper = mount(EditorView, {
    props: { spreadsheetId: "s1", pageId: "p1" },
    attachTo: focusCards || realTableCard ? document.body : undefined,
    global: {
      plugins: [router],
      stubs: {
        TableCard: realTableCard
          ? false
          : focusCards
            ? { template: '<div role="grid" tabindex="0" aria-label="Table grid"></div>' }
            : true,
        ChartCard: focusCards
          ? {
              template:
                '<div><button type="button">Collapse</button><span class="editable-name" role="button" tabindex="0">Card name</span></div>',
            }
          : true,
        ScriptCard: focusCards
          ? {
              template:
                '<div><button type="button">Collapse</button><span class="editable-name" role="button" tabindex="0">Card name</span></div>',
            }
          : true,
        TextCard: focusCards
          ? {
              template:
                '<div><button type="button">Collapse</button><span class="editable-name" role="button" tabindex="0">Card name</span></div>',
            }
          : true,
        FormulaBar: true,
        FormatBar: true,
        PageTabs: true,
      },
    },
  });
  await flushPromises();
  return wrapper;
}

it("opens a stored-identity cell deep link without changing its history URL", async () => {
  const wrapper = await render("owner", false, false, {}, false, [], "/s/s1/p/p1#cell=t1.r2.c2");

  expect(useWorkbookStore().selection).toEqual({ tableId: "t1", row: 2, col: 1 });
  expect(wrapper.vm.$route.fullPath).toBe("/s/s1/p/p1#cell=t1.r2.c2");

  wrapper.unmount();
});

it("routes an in-document app link once and leaves focus changes out of the URL", async () => {
  const wrapper = await render();
  const anchor = document.createElement("a");
  anchor.href = "/s/s1/p/p1#block=v1";
  const editor = wrapper.get(".editor").element as HTMLDivElement;
  editor.append(anchor);
  const click = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });

  anchor.dispatchEvent(click);
  await flushPromises();
  expect(click.defaultPrevented).toBe(true);
  expect(wrapper.vm.$route.fullPath).toBe("/s/s1/p/p1#block=v1");

  useWorkbookStore().selection = { tableId: "t1", row: 1, col: 0 };
  await flushPromises();
  expect(wrapper.vm.$route.fullPath).toBe("/s/s1/p/p1#block=v1");

  wrapper.vm.$router.back();
  await flushPromises();
  expect(wrapper.vm.$route.fullPath).toBe("/s/s1/p/p1");
  wrapper.unmount();
});

it("reveals a deep link again after navigating away and returning with Back", async () => {
  const wrapper = await render();
  const deepLink = "/s/s1/p/p1#cell=t1.r2.c2";

  await wrapper.vm.$router.push(deepLink);
  await flushPromises();
  expect(useWorkbookStore().selection).toEqual({ tableId: "t1", row: 2, col: 1 });

  await wrapper.vm.$router.push("/s/s1/p/p1");
  await flushPromises();
  useWorkbookStore().selection = { tableId: "t1", row: 0, col: 0 };

  wrapper.vm.$router.back();
  await flushPromises();
  expect(wrapper.vm.$route.fullPath).toBe(deepLink);
  expect(useWorkbookStore().selection).toEqual({ tableId: "t1", row: 2, col: 1 });
  wrapper.unmount();
});

it("shows a notice for a deleted deep-link target and leaves its page open", async () => {
  const wrapper = await render("owner", false, false, {}, false, [], "/s/s1/p/p1#block=deleted");

  expect(wrapper.vm.$route.fullPath).toBe("/s/s1/p/p1#block=deleted");
  expect(useWorkbookStore().notice).toEqual({
    kind: "error",
    text: "That link points to something that no longer exists.",
  });

  wrapper.unmount();
});

it.each([403, 404])("returns to the document list after a %i load response", async (status) => {
  const wrapper = await render();
  server.getSnapshot.mockRejectedValueOnce(
    Object.assign(new Error("Private document details"), { status }),
  );

  await wrapper.setProps({ spreadsheetId: "missing" });
  await flushPromises();

  expect(wrapper.vm.$route.name).toBe("spreadsheets");
  expect(takeQueuedListNotice()).toEqual({
    kind: "error",
    text: "That document was not found, or you do not have access to it.",
  });
  expect(wrapper.text()).not.toContain("Private document details");
  wrapper.unmount();
});

it.each([
  new Error("Offline"),
  Object.assign(new Error("The server is unavailable"), { status: 500 }),
])("keeps non-404 load failures on the editor", async (error) => {
  const wrapper = await render();
  server.getSnapshot.mockRejectedValueOnce(error);

  await wrapper.setProps({ spreadsheetId: "unavailable" });
  await flushPromises();

  expect(wrapper.vm.$route.name).toBe("editor");
  expect(wrapper.get('[role="alert"]').text()).toBe(error.message);
  expect(takeQueuedListNotice()).toBeNull();
  wrapper.unmount();
});

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

it("replaces the open side pane when another one opens", async () => {
  const wrapper = await render("owner", false, false, { A1: "=1/0" });
  const historyButton = wrapper.findAll("button").find((button) => button.text() === "History");
  await historyButton!.trigger("click");
  expect(wrapper.find('[role="dialog"][aria-label="History"]').exists()).toBe(true);

  await wrapper.get(".editor__errors").trigger("click");
  expect(wrapper.find('[role="dialog"][aria-label="Document errors"]').exists()).toBe(true);
  expect(wrapper.find('[role="dialog"][aria-label="History"]').exists()).toBe(false);
  wrapper.unmount();
});

it.each([true, false])(
  "closes error, trace, and assertion panes on narrow screens (%s)",
  async (narrow) => {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: vi.fn((query: string) => ({ matches: narrow && query === "(max-width: 640px)" })),
    });
    const wrapper = await render(
      "viewer",
      false,
      true,
      { A1: "=PayoutByDuration()", B1: '=ASSERT(1=2, "broken")' },
      false,
      [
        {
          id: "script-1",
          pageId: "p1",
          kind: "script",
          name: "Script 1",
          position: 3,
          source: "PayoutByDuration() = 1/0",
          chartType: null,
        },
      ],
    );

    await wrapper.get(".editor__errors").trigger("click");
    let errors = wrapper.get('[role="dialog"][aria-label="Document errors"]');
    await errors.get(".errors__location").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="dialog"][aria-label="Document errors"]').exists()).toBe(!narrow);

    if (narrow) await wrapper.get(".editor__errors").trigger("click");
    errors = wrapper.get('[role="dialog"][aria-label="Document errors"]');
    await errors.get(".error-trace__link").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="dialog"][aria-label="Document errors"]').exists()).toBe(!narrow);

    await wrapper.get(".editor__assertions").trigger("click");
    const assertions = wrapper.get('[role="dialog"][aria-label="Failing assertions"]');
    await assertions.get(".assertions__go").trigger("click");
    await flushPromises();
    expect(wrapper.find('[role="dialog"][aria-label="Failing assertions"]').exists()).toBe(!narrow);
    expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 640px)");
    wrapper.unmount();
  },
);

it("opens block actions from card margins and leaves grid cell menus to the table", async () => {
  const wrapper = await render("owner", false, false, {}, true);
  const block = wrapper.get(".editor__block");
  await block.trigger("contextmenu", { button: 2, clientX: 90, clientY: 110 });
  await flushPromises();

  const menu = bodyGet('[role="menu"][aria-label="Actions for Table 1"]');
  const labels = menu.findAll('[role="menuitem"]').map((item) => item.text());
  expect(labels).toContain("Export CSV");
  expect(labels).toContain("Freeze rows and columns");
  expect(labels).toContain("Delete table");
  expect(labels).toContain("Move up");
  expect(labels).toContain("Add table below");
  const deleteTable = menu
    .findAll('[role="menuitem"]')
    .find((item) => item.text() === "Delete table");
  expect(deleteTable?.classes()).toContain("danger");

  await menu.trigger("keydown", { key: "Escape" });
  await flushPromises();
  await wrapper.get('[data-table="Table 1"] .editable-name').trigger("contextmenu", {
    button: 2,
    clientX: 90,
    clientY: 110,
  });
  await flushPromises();
  expect(bodyHas('[role="menu"][aria-label="Actions for Table 1"]')).toBe(true);

  await bodyGet('[role="menu"]').trigger("keydown", { key: "Escape" });
  await flushPromises();
  await wrapper.get('button[aria-label="Block actions for Table 1"]').trigger("click");
  await flushPromises();
  expect(bodyHas('[role="menu"][aria-label="Actions for Table 1"]')).toBe(true);

  await bodyGet('[role="menu"]').trigger("keydown", { key: "Escape" });
  await flushPromises();
  await wrapper.get('[data-table="Table 1"] [data-cell="A1"]').trigger("contextmenu", {
    button: 2,
    clientX: 90,
    clientY: 110,
  });
  await flushPromises();
  expect(bodyHas('[role="menu"][aria-label="Actions for Table 1"]')).toBe(false);
  expect(bodyHas('[role="menu"][aria-label="Actions for A1"]')).toBe(true);
  wrapper.unmount();
});

it("opens the block menu from header controls and keeps the browser menu on the name input", async () => {
  const wrapper = await render("owner", false, false, {}, true);
  const header = wrapper.get('[data-table="Table 1"] .table-card__header');
  const menuSelector = '[role="menu"][aria-label="Actions for Table 1"]';
  const openBlockMenu = async (target: Element): Promise<void> => {
    const event = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      button: 2,
      clientX: 90,
      clientY: 110,
    });
    target.dispatchEvent(event);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(bodyHas(menuSelector)).toBe(true);
    await bodyGet(menuSelector).trigger("keydown", { key: "Escape" });
    await flushPromises();
  };

  await openBlockMenu(header.get('button[aria-label="Collapse Table 1"]').element);

  const select = document.createElement("select");
  header.element.append(select);
  await openBlockMenu(select);

  const link = document.createElement("a");
  link.href = "#block=t1";
  header.element.append(link);
  await openBlockMenu(link);

  await header.get(".editable-name").trigger("dblclick");
  await flushPromises();
  const nameInput = header.get(".editable-name--editing");
  const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
  nameInput.element.dispatchEvent(event);
  await flushPromises();

  expect(event.defaultPrevented).toBe(false);
  expect((nameInput.element as HTMLInputElement).selectionStart).toBe(0);
  expect((nameInput.element as HTMLInputElement).selectionEnd).toBe("Table 1".length);
  expect(bodyHas(menuSelector)).toBe(false);
  wrapper.unmount();
});

it("saves an active formula draft before running a teleported block menu action", async () => {
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
  await wrapper.vm.$nextTick();

  const order: string[] = [];
  server.updateView.mockImplementationOnce(() => {
    order.push("save");
    return Promise.resolve(changeWith());
  });
  vi.spyOn(store, "moveBlock").mockImplementation(() => {
    order.push("menu action");
    return Promise.resolve(true);
  });

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

  await wrapper.get("#block-t1").trigger("contextmenu", {
    button: 2,
    clientX: 90,
    clientY: 110,
  });
  await flushPromises();
  await bodyFindAll('[role="menuitem"]')
    .find((item) => item.text() === "Move down")!
    .trigger("click");
  await flushPromises();

  expect(server.updateView).toHaveBeenCalledExactlyOnceWith("chart", { source: "draft" });
  expect(order).toEqual(["save", "menu action"]);
  expect(formulas.active).toBeUndefined();
  wrapper.unmount();
});

it("collapses a block to its header and restores its body from the block menu", async () => {
  const wrapper = await render("owner", false, false, {}, true);

  await wrapper.get('button[aria-label="Collapse Table 1"]').trigger("click");
  await flushPromises();
  expect(wrapper.get('button[aria-label="Expand Table 1"]').attributes("aria-expanded")).toBe(
    "false",
  );
  expect(wrapper.find('[data-table="Table 1"] .table-card__header').exists()).toBe(true);
  expect(wrapper.find('[data-table="Table 1"] .table-card__menu-trigger').exists()).toBe(true);
  expect(wrapper.get('[data-table="Table 1"] .table-card__grid').isVisible()).toBe(false);

  await wrapper.get(".editor__block").trigger("contextmenu", {
    button: 2,
    clientX: 90,
    clientY: 110,
  });
  await flushPromises();
  const menu = bodyGet('[role="menu"][aria-label="Actions for Table 1"]');
  expect(menu.findAll('[role="menuitem"]').map((item) => item.text())).toContain("Expand");
  await bodyFindAll('[role="menuitem"]')
    .find((item) => item.text() === "Expand")!
    .trigger("click");
  await flushPromises();

  expect(wrapper.get('button[aria-label="Collapse Table 1"]').attributes("aria-expanded")).toBe(
    "true",
  );
  expect(wrapper.get('[data-table="Table 1"] .table-card__grid').isVisible()).toBe(true);
  wrapper.unmount();
});

it("expands a collapsed table before revealing one of its errors", async () => {
  const wrapper = await render("owner", false, false, { A1: "=1/0" }, true);
  await wrapper.get('button[aria-label="Collapse Table 1"]').trigger("click");
  await flushPromises();
  expect(wrapper.get(".table-card__grid").isVisible()).toBe(false);

  await wrapper.get(".editor__errors").trigger("click");
  await flushPromises();
  await wrapper.get(".errors__location").trigger("click");
  await flushPromises();

  expect(wrapper.get('button[aria-label="Collapse Table 1"]').attributes("aria-expanded")).toBe(
    "true",
  );
  expect(wrapper.get(".table-card__grid").isVisible()).toBe(true);
  wrapper.unmount();
});

it.each([
  ["Names", '[aria-label="Names in Table 1"]'],
  ["Conditional formats", '[aria-label="Conditional formats of Table 1"]'],
])("closes the %s pane when its page is left", async (label, paneSelector) => {
  const wrapper = await render("owner", false, false, {}, true);
  const store = useWorkbookStore();
  store.pages = [...store.pages, { id: "p2", name: "Page 2", position: 1 }];
  const paneButton = wrapper
    .findAll(".table-card__actions button")
    .find((button) => button.text().startsWith(label));
  await paneButton!.trigger("click");
  expect(wrapper.find(paneSelector).exists()).toBe(true);

  await wrapper.setProps({ pageId: "p2" });
  await flushPromises();
  await wrapper.setProps({ pageId: "p1" });
  await flushPromises();
  expect(wrapper.find(paneSelector).exists()).toBe(false);
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
    const focused =
      name === "Add table" ? card.find('[role="grid"]') : card.find(".editable-name:not(input)");
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
