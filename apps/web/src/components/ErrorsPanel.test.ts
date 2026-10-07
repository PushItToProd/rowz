import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, identifiedAt, snapshotWith, TABLE, wireSnapshot, type MockedApi } from "../testing";
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

it("lists a repeated script definition and links to its line", async () => {
  const snapshot = snapshotWith({ A1: "=QtyTotal" });
  snapshot.views = [
    {
      id: "script-1",
      pageId: "p1",
      kind: "script",
      name: "Summary",
      position: 1,
      source: "QtyTotal = 3\nQtyTotal = 5",
      chartType: null,
    },
  ];
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshot));
  await useWorkbookStore().load("s1");
  const wrapper = mount(ErrorsPanel);
  try {
    const entry = wrapper.get("li button");
    expect(entry.find("strong").text()).toBe("Summary!QtyTotal");
    expect(entry.text()).toContain("QtyTotal is already defined on line 1 of this script");
    await entry.trigger("click");
    expect(wrapper.emitted("go")?.[0]?.[0]).toMatchObject({
      pageId: "p1",
      blockId: "script-1",
      line: 2,
    });
  } finally {
    wrapper.unmount();
  }
});

it("opens a cell error's manifestation and keeps the function trace target separate", async () => {
  const snapshot = snapshotWith({ A1: "Spa" });
  snapshot.pages = [
    { id: "p1", name: "Page 1", position: 0 },
    { id: "p2", name: "Page 2", position: 1 },
  ];
  const formulaTable = {
    ...TABLE,
    id: "t2",
    pageId: "p2",
    name: "Payout by duration",
    position: 0,
  };
  snapshot.tables = [TABLE, formulaTable];
  snapshot.cells.push({ ...identifiedAt("A1", formulaTable.id), input: "=PayoutByDuration()" });
  snapshot.views = [
    {
      id: "script-1",
      pageId: "p1",
      kind: "script",
      name: "Script 1",
      position: 1,
      source: "PayoutByDuration() = QUERY('Table 1', \"select Spa\")",
      chartType: null,
    },
  ];
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshot));
  await useWorkbookStore().load("s1");
  const wrapper = mount(ErrorsPanel);
  try {
    const locationButton = wrapper.get(".errors__location");
    expect(locationButton.attributes("aria-label")).toBe(
      "Go to #VALUE! in 'Payout by duration'!A1 on page Page 2: The data has no column Spa",
    );
    await locationButton.trigger("click");
    expect(wrapper.emitted("go")?.[0]?.[0]).toMatchObject({
      pageId: "p2",
      blockId: "t2",
      cell: at("A1", "t2"),
    });
    expect(wrapper.emitted("trace")).toBeUndefined();

    const traceLink = wrapper.get(".error-trace__link");
    expect(traceLink.text()).toBe("Raised in PayoutByDuration (Script 1, line 1)");
    expect(traceLink.attributes("aria-label")).toBe(
      "Go to where it was raised: PayoutByDuration, Script 1, line 1",
    );
    await traceLink.trigger("click");
    expect(wrapper.emitted("trace")?.[0]?.[0]).toMatchObject([
      {
        function: "PayoutByDuration",
        location: { scriptId: "script-1", line: 1 },
      },
    ]);
  } finally {
    wrapper.unmount();
  }
});
