import { flushPromises, mount } from "@vue/test-utils";
import { Workbook } from "@spreadsheet-app/engine";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { changeWith, snapshotWith, TABLE, type MockedApi } from "../testing";
import { useWorkbookStore } from "../stores/workbook";
import FindPanel from "./FindPanel.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
async function render() {
  server.getSnapshot.mockResolvedValue(
    snapshotWith({ A1: "Cat cat", A2: '=UPPER("cat")', B1: "cat", B2: "a.b", C1: "cat\n" }),
  );
  const store = useWorkbookStore();
  await store.load("s1");
  const wrapper = mount(FindPanel, {
    props: { pageId: "p1", blockId: "t1" },
    attachTo: document.body,
  });
  await flushPromises();
  return { wrapper, store };
}
it("lists occurrences, navigates in both directions, and applies literal case/whole options", async () => {
  const { wrapper } = await render();
  await wrapper.get('[aria-label="Find text"]').setValue("cat");
  expect(wrapper.get('[role="status"]').text()).toBe("5 matches");
  expect(wrapper.get("li strong").text()).toBe("Page 1 > Table 1 > A1");
  await wrapper.get('[aria-label="Find text"]').trigger("keydown", { key: "Enter" });
  expect(wrapper.emitted("go")?.[0]?.[0]).toMatchObject({ cell: { row: 0, col: 0 }, offset: 0 });
  await wrapper.trigger("keydown", { key: "Enter", shiftKey: true });
  expect(wrapper.emitted("go")?.[1]?.[0]).toMatchObject({ cell: { row: 1, col: 0 }, offset: 8 });
  await wrapper.findAll('input[type="checkbox"]')[0]!.setValue(true);
  expect(wrapper.get('[role="status"]').text()).toBe("4 matches");
  await wrapper.findAll('input[type="checkbox"]')[1]!.setValue(true);
  expect(wrapper.get('[role="status"]').text()).toBe("1 match");
  await wrapper.get('[aria-label="Find text"]').setValue("a.b");
  expect(wrapper.get('[role="status"]').text()).toBe("1 match");
  wrapper.unmount();
});
it("searches displayed values, disables replacement there, and sends one/all stored-input requests", async () => {
  const { wrapper } = await render();
  await wrapper.get('[aria-label="Find text"]').setValue("UPPER");
  expect(wrapper.get('[role="status"]').text()).toBe("1 match");
  await wrapper.get('[aria-label="Search mode"]').setValue("values");
  expect(wrapper.get('[role="status"]').text()).toBe("0 matches");
  await wrapper.get('[aria-label="Find text"]').setValue("CAT");
  expect(wrapper.get('[role="status"]').text()).toBe("5 matches");
  const replaceAll = wrapper.findAll("button").find((button) => button.text() === "Replace all")!;
  expect(replaceAll.attributes("disabled")).toBeDefined();
  await wrapper.get('[aria-label="Search mode"]').setValue("inputs");
  await wrapper.get('[aria-label="Replace with"]').setValue("$&");
  server.replace.mockResolvedValue({ ...changeWith(), skippedCount: 0, skipped: [] });
  await wrapper.get('[aria-label="Find text"]').trigger("keydown", { key: "Enter" });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Replace one")!
    .trigger("click");
  await flushPromises();
  expect(server.replace).toHaveBeenLastCalledWith(
    "s1",
    expect.objectContaining({
      query: "CAT",
      replacement: "$&",
      one: expect.objectContaining({ offset: 0, expected: "Cat cat" }),
    }),
  );
  await replaceAll.trigger("click");
  await flushPromises();
  expect(server.replace).toHaveBeenLastCalledWith("s1", {
    query: "CAT",
    replacement: "$&",
    scope: { kind: "document" },
    caseSensitive: false,
    whole: false,
  });
  wrapper.unmount();
});
it("filters by page and block and searches every stored source", async () => {
  const { wrapper, store } = await render();
  store.pages.push({ id: "p2", name: "Other", position: 1 });
  store.views = ["text", "chart", "script"].map((kind, index) => ({
    id: `v${String(index)}`,
    pageId: index === 2 ? "p2" : "p1",
    kind: kind as "text" | "chart" | "script",
    name: kind,
    position: index + 1,
    source: "cat",
    chartType: null,
  }));
  await wrapper.get('[aria-label="Find text"]').setValue("cat");
  expect(wrapper.get('[role="status"]').text()).toBe("8 matches");
  await wrapper.get('[aria-label="Search scope"]').setValue("page");
  expect(wrapper.get('[role="status"]').text()).toBe("7 matches");
  await wrapper.get('[aria-label="Search scope"]').setValue("block");
  expect(wrapper.get('[role="status"]').text()).toBe("5 matches");
  wrapper.unmount();
});

it("finds stored metadata and formatted/computed values, including filtered rows", async () => {
  const snapshot = snapshotWith({ A1: "hidden", A2: "1234.5" });
  snapshot.tables[0] = {
    ...snapshot.tables[0]!,
    columns: [
      { name: "Input", type: "text" },
      { name: "Computed", type: "formula", formula: '="needle"' },
      { name: "Third", type: "text" },
    ],
    display: { sort: [], filter: '=[Input] <> "hidden"' },
    formats: [
      { startRow: 1, endRow: 1, startCol: 0, endCol: 0, format: { numberFormat: "#,##0.00" } },
    ],
  };
  server.getSnapshot.mockResolvedValue(snapshot);
  const store = useWorkbookStore();
  await store.load("s1");
  const options = { whole: false, caseSensitive: false };
  const scope = { kind: "document" as const };
  expect(
    store.find("needle", scope, options, "inputs").matches.map((match) => match.target.kind),
  ).toEqual(["column"]);
  const values = store.find("needle", scope, options, "values").matches;
  expect(values.filter((match) => match.cell)).toHaveLength(4);
  expect(values.filter((match) => match.cell).every((match) => !match.replaceable)).toBe(true);
  expect(
    store.find("hidden", scope, options, "inputs").matches.map((match) => match.target.kind),
  ).toEqual(["cell", "filter"]);
  // Number formatting uses the same formatter as CellView.
  snapshot.tables[0].columns = null;
  snapshot.tables[0].display = { sort: [] };
  snapshot.tables[0].names = [{ name: "Greeting", formula: '"needle"' }];
  server.getSnapshot.mockResolvedValue(snapshot);
  await store.load("s1");
  expect(store.find("1,234.50", scope, options, "values").matches).toHaveLength(1);
  expect(store.find("needle", scope, options, "inputs").matches[0]?.target.kind).toBe("name");
});

it("tracks the current page and block in both matches and replace-all requests", async () => {
  const { wrapper, store } = await render();
  store.pages.push({ id: "p2", name: "Other page", position: 1 });
  store.views.push({
    id: "v2",
    pageId: "p2",
    name: "Other block",
    position: 0,
    kind: "text",
    source: "cat",
    chartType: null,
  });
  server.replace.mockResolvedValue({ ...changeWith(), skippedCount: 0, skipped: [] });
  await wrapper.get('[aria-label="Find text"]').setValue("cat");
  await wrapper.get('[aria-label="Search scope"]').setValue("page");
  expect(wrapper.get('[role="status"]').text()).toBe("5 matches");
  await wrapper.setProps({ pageId: "p2", blockId: "v2" });
  expect(wrapper.get('[role="status"]').text()).toBe("1 match");
  const all = wrapper.findAll("button").find((button) => button.text() === "Replace all")!;
  await all.trigger("click");
  await flushPromises();
  expect(server.replace).toHaveBeenLastCalledWith(
    "s1",
    expect.objectContaining({ scope: { kind: "page", id: "p2" } }),
  );
  await wrapper.get('[aria-label="Search scope"]').setValue("block");
  await wrapper.setProps({ pageId: "p1", blockId: "t1" });
  expect(wrapper.get('[role="status"]').text()).toBe("5 matches");
  await all.trigger("click");
  await flushPromises();
  expect(server.replace).toHaveBeenLastCalledWith(
    "s1",
    expect.objectContaining({ scope: { kind: "block", id: "t1" } }),
  );
  await wrapper.setProps({ blockId: undefined });
  expect(wrapper.get('[role="status"]').text()).toBe("0 matches");
  expect(all.attributes("disabled")).toBeDefined();
  wrapper.unmount();
});

it("reports syntax skips after replace all", async () => {
  const { wrapper } = await render();
  await wrapper.get('[aria-label="Find text"]').setValue("cat");
  await wrapper.get('[aria-label="Replace with"]').setValue('"');
  server.replace.mockResolvedValue({
    ...changeWith(),
    skippedCount: 1,
    skipped: [
      {
        pageId: "p1",
        blockId: "t1",
        target: { kind: "cell", blockId: "t1", rowId: "r1", colId: "c1" },
        label: "Page 1 > Table 1 > A2",
        reason: "skipped: would not parse",
      },
    ],
  });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Replace all")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.get('[aria-label="Skipped replacements"]').text()).toContain(
    "1 item skipped: would not parse",
  );
  expect(wrapper.get('[aria-label="Skipped replacements"]').text()).toContain(
    "Page 1 > Table 1 > A2",
  );
  wrapper.unmount();
});

it("counts every occurrence but constructs and renders only the first 1000 matches", async () => {
  const { wrapper, store } = await render();
  store.views.push({
    id: "many",
    pageId: "p1",
    name: "Many",
    position: 1,
    kind: "text",
    source: "needle ".repeat(1200),
    chartType: null,
  });
  await wrapper.get('[aria-label="Find text"]').setValue("needle");
  expect(wrapper.get('[role="status"]').text()).toBe("1200 matches, showing first 1000");
  expect(wrapper.findAll(".assertions__list li")).toHaveLength(1000);
  expect(
    store.find("needle", { kind: "document" }, { caseSensitive: false, whole: false }, "inputs"),
  ).toMatchObject({ total: 1200, matches: expect.any(Array) });
  server.replace.mockResolvedValue({ ...changeWith(), skippedCount: 0, skipped: [] });
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Replace all")!
    .trigger("click");
  await flushPromises();
  expect(server.replace).toHaveBeenLastCalledWith("s1", {
    query: "needle",
    replacement: "",
    scope: { kind: "document" },
    caseSensitive: false,
    whole: false,
  });
  wrapper.unmount();
});

it("does not visit empty cells when searching stored inputs in a large sparse table", async () => {
  const snapshot = snapshotWith({ A1: "needle" });
  snapshot.tables[0] = {
    ...TABLE,
    colIds: Array.from({ length: 100 }, (_, index) => `c${String(index + 1)}`),
  };
  snapshot.rows = Array.from({ length: 1000 }, (_, index) => ({
    id: `r${String(index)}`,
    tableId: "t1",
    orderKey: String(index).padStart(4, "0"),
  }));
  server.getSnapshot.mockResolvedValue(snapshot);
  const store = useWorkbookStore();
  await store.load("s1");
  const getInput = vi.spyOn(Workbook.prototype, "getInput");
  expect(
    store.find("needle", { kind: "document" }, { caseSensitive: false, whole: false }, "inputs")
      .total,
  ).toBe(1);
  expect(getInput).toHaveBeenCalledTimes(1);
  getInput.mockRestore();
});
