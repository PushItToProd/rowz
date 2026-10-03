import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { createMemoryHistory, createRouter } from "vue-router";
import { api } from "../api/client";
import { changeWith, snapshotWith, wireSnapshot, type MockedApi } from "../testing";
import EditorView from "./EditorView.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
vi.mock("../api/live", () => ({ watchSpreadsheet: () => vi.fn() }));
const server = api as unknown as MockedApi;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

async function render(role = "owner", empty = false) {
  const snapshot = snapshotWith({}, role);
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
      { path: "/", name: "editor", component: { template: "<div />" } },
      { path: "/spreadsheets", name: "spreadsheets", component: { template: "<div />" } },
      { path: "/help", name: "help", component: { template: "<div />" } },
    ],
  });
  await router.push("/");
  const wrapper = mount(EditorView, {
    props: { spreadsheetId: "s1", pageId: "p1" },
    global: {
      plugins: [router],
      stubs: { TableCard: true, TextCard: true, FormulaBar: true, FormatBar: true, PageTabs: true },
    },
  });
  await flushPromises();
  return wrapper;
}

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
