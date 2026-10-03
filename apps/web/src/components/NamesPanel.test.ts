import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { changeWith, snapshotWith, wireSnapshot, type MockedApi } from "../testing";
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
      components: { NamesPanel },
      setup: () => ({ store, suggestion }),
      template: `<NamesPanel v-if="store.tables[0]" :table="store.tables[0]" :suggestion="suggestion" />`,
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

describe("NamesPanel", () => {
  it("shows each name with its formula and value", async () => {
    await render([{ name: "Fee", formula: "A1 * 2" }], { A1: "4" });
    expect(wrapper.get("th").text()).toBe("Fee");
    expect(wrapper.get(".names-panel__formula").element).toHaveProperty("value", "A1 * 2");
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
    expect(inputs[1]?.element).toHaveProperty("value", "B2:B4");
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
});
