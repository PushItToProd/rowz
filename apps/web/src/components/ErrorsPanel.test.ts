import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, TABLE, wireSnapshot, type MockedApi } from "../testing";
import ErrorsPanel from "./ErrorsPanel.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;
beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

it.each([
  ["Sales", "Sales!A1"],
  ["Table 1", "'Table 1'!A1"],
  ["Joe's Table", "'Joe''s Table'!A1"],
])("formats cell errors in %j as formula references", async (name, address) => {
  const snapshot = snapshotWith({ A1: "=1/0" });
  snapshot.tables = [{ ...TABLE, name }];
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshot));
  await useWorkbookStore().load("s1");
  const wrapper = mount(ErrorsPanel);
  try {
    expect(wrapper.get("li strong").text()).toBe(address);
  } finally {
    wrapper.unmount();
  }
});

it("lists errors with destinations and updates while open", async () => {
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith({ A1: "=1/0", B1: "=Missing" })));
  const store = useWorkbookStore();
  await store.load("s1");
  const wrapper = mount(ErrorsPanel, { attachTo: document.body });
  try {
    const entries = wrapper.findAll("li button");
    expect(entries).toHaveLength(2);
    expect(entries[0]!.find("strong").text()).toBe("'Table 1'!A1");
    await entries[0]!.trigger("click");
    expect(wrapper.emitted("go")?.[0]?.[0]).toMatchObject({
      pageId: "p1",
      blockId: "t1",
      cell: at("A1"),
    });
    await store.setCell(at("A1"), "1");
    await store.setCell(at("B1"), "2");
    await flushPromises();
    expect(wrapper.findAll("li")).toHaveLength(0);
    expect(wrapper.text()).toContain("No errors in this document.");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(wrapper.emitted("close")).toHaveLength(1);
  } finally {
    wrapper.unmount();
  }
});
