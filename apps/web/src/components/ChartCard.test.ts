import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, type MockedApi } from "../testing";
import ChartCard from "./ChartCard.vue";

vi.mock("../api/client", async () => ({ api: (await import("../testing")).mockApi() }));
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
const confirm = vi.spyOn(window, "confirm");

/** Shows the store's first view, so the card follows changes the store makes to it. */
async function render(view: Partial<ViewRecord> = {}, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue({
    ...snapshotWith(CELLS, role),
    views: [{ ...CHART, ...view }],
  });
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(
    {
      components: { ChartCard },
      setup: () => ({ store }),
      template: `<ChartCard v-if="store.views[0]" :view="store.views[0]" />`,
    },
    { attachTo: document.body },
  );
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  confirm.mockReturnValue(true);
  server.updateView.mockImplementation((_id, changes) => Promise.resolve({ ...CHART, ...changes }));
});
afterEach(() => {
  wrapper.unmount();
});

describe("ChartCard", () => {
  it("draws the cells its data names, computing formulas among them", async () => {
    await render();
    expect(wrapper.get(".chart").attributes("data-chart")).toBe("bar");
    expect(wrapper.findAll(".chart__bar title").map((title) => title.text())).toEqual([
      "apples: 3",
      "pears: 5",
      "plums: 8",
    ]);
  });

  it("redraws when a cell changes", async () => {
    await render();
    await useWorkbookStore().setCell(at("B1"), "10");
    await flushPromises();
    expect(wrapper.findAll(".chart__bar title").map((title) => title.text())).toEqual([
      "apples: 10",
      "pears: 5",
      "plums: 15",
    ]);
  });

  it("draws the kind of chart that is chosen, and saves a new choice", async () => {
    await render({ chartType: "pie" });
    expect(wrapper.findAll(".chart__slice")).toHaveLength(3);

    await wrapper.get("select").setValue("line");
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledWith("v1", { chartType: "line" });
    expect(wrapper.findAll(".chart__line")).toHaveLength(1);
  });

  it("saves new data on Enter and on leaving the box, but not when nothing changed", async () => {
    await render();
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Chart data"]');
    await input.trigger("blur");
    expect(server.updateView).not.toHaveBeenCalled();

    await input.setValue("'Table 1'!A1:B2");
    await input.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledWith("v1", { source: "'Table 1'!A1:B2" });
    expect(wrapper.findAll(".chart__bar")).toHaveLength(2);

    await input.trigger("blur");
    expect(server.updateView).toHaveBeenCalledTimes(1);
  });

  it("accepts a formula that gives a range, with or without the leading =", async () => {
    await render({ source: "=FILTER('Table 1'!A1:B3, 'Table 1'!B1:B3 > 4)" });
    expect(wrapper.findAll(".chart__bar title").map((title) => title.text())).toEqual([
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
    server.updateTable.mockResolvedValue({
      table: { ...store.tables[0]!, name: "Fruit" },
      cells: [],
      views: [{ id: "v1", source: "Fruit!A1:B3" }],
      tables: [],
    });
    await store.updateTable("t1", { name: "Fruit" });
    await flushPromises();
    expect(wrapper.get<HTMLInputElement>('input[aria-label="Chart data"]').element.value).toBe(
      "Fruit!A1:B3",
    );
    expect(wrapper.findAll(".chart__bar")).toHaveLength(3);
  });

  it("deletes the chart after confirming", async () => {
    await render();
    confirm.mockReturnValue(false);
    await wrapper.get("button.danger").trigger("click");
    expect(server.deleteView).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await wrapper.get("button.danger").trigger("click");
    expect(server.deleteView).toHaveBeenCalledWith("v1");
  });

  it("shows a viewer the chart without the means to change it", async () => {
    await render({}, "viewer");
    expect(wrapper.findAll(".chart__bar")).toHaveLength(3);
    expect(wrapper.find("select").exists()).toBe(false);
    expect(wrapper.find("input").exists()).toBe(false);
    expect(wrapper.find("button").exists()).toBe(false);
  });
});
