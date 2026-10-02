import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, changeWith, snapshotWith, wireSnapshot, type MockedApi } from "../testing";
import ScriptCard from "./ScriptCard.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

const SCRIPT: ViewRecord = {
  id: "v1",
  pageId: "p1",
  kind: "script",
  name: "Summary",
  position: 1,
  source: "",
  chartType: null,
};

let wrapper: VueWrapper;

async function render(source: string, cells: Record<string, string> = {}): Promise<void> {
  server.getSnapshot.mockResolvedValue(
    wireSnapshot({ ...snapshotWith(cells), views: [{ ...SCRIPT, source }] }),
  );
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(
    {
      components: { ScriptCard },
      setup: () => ({ store }),
      template: `<ScriptCard v-if="store.views[0]" :view="store.views[0]" />`,
    },
    { attachTo: document.body },
  );
}

/** Each row of the card: the statement and what it shows. */
const rows = () => wrapper.findAll("tr").map((row) => [row.get("th").text(), row.get("td").text()]);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  server.updateView.mockImplementation((_id, changes) =>
    Promise.resolve(changeWith({ ...SCRIPT, ...changes })),
  );
});
afterEach(() => {
  wrapper.unmount();
});

describe("ScriptCard", () => {
  it("shows each name with its value", async () => {
    await render(
      [
        "// A comment shows nothing",
        "Total = SUM('Table 1'!A1:A2)",
        "Amounts = 'Table 1'!A1:A2",
        "Double(x) = x * 2",
        "Broken = 1 +",
      ].join("\n"),
      { A1: "1", A2: "2" },
    );
    const shown = rows();
    expect(shown.slice(0, 3)).toEqual([
      ["Total", "3"],
      ["Amounts", "2 × 1 values"],
      ["Double(x)", "function (x)"],
    ]);
    expect(shown[3]?.[0]).toBe("Broken");
    expect(shown[3]?.[1]).toMatch(/^#/);
  });

  it("follows the cells its names read", async () => {
    await render("Total = 'Table 1'!A1 * 2", { A1: "1" });
    expect(rows()).toEqual([["Total", "2"]]);
    await useWorkbookStore().setCell(at("A1"), "5");
    expect(rows()).toEqual([["Total", "10"]]);
  });

  it("gives its names to the formulas in cells", async () => {
    await render("Fee = 3", { A1: "=Fee * 2", A2: "=Summary!Fee" });
    const store = useWorkbookStore();
    expect(store.valueOf(at("A1"))).toBe(6);
    expect(store.valueOf(at("A2"))).toBe(3);
  });

  it("saves the source when the edit ends", async () => {
    await render("Total = 1");
    await wrapper.get("table").trigger("dblclick");
    await wrapper.get("textarea").setValue("Total = 2");
    await wrapper
      .findAll("button")
      .find((button) => button.text() === "Done")!
      .trigger("click");
    await flushPromises();
    expect(server.updateView).toHaveBeenCalledWith(
      "v1",
      expect.objectContaining({ source: "Total = 2" }),
    );
    expect(rows()).toEqual([["Total", "2"]]);
  });
});
