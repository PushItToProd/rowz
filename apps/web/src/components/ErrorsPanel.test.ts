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

it("shows a function origin link in the document errors list", async () => {
  const snapshot = snapshotWith({ A1: "Spa" });
  const formulaTable = { ...TABLE, id: "t2", name: "Formula", position: 1 };
  snapshot.tables = [
    {
      ...TABLE,
      columns: [
        { name: "Race", type: "text" },
        { name: "Duration", type: "text" },
        { name: "Payout (40 hrs)", type: "any" },
      ],
    },
    formulaTable,
  ];
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
    const traceLink = wrapper.get(".error-trace__link");
    expect(traceLink.text()).toBe("Raised in PayoutByDuration (Script 1, line 1)");
    await traceLink.trigger("click");
    expect(wrapper.emitted("go")?.[0]?.[0]).toMatchObject({
      pageId: "p1",
      blockId: "t2",
      trace: [
        {
          function: "PayoutByDuration",
          location: { scriptId: "script-1", line: 1 },
        },
      ],
    });
  } finally {
    wrapper.unmount();
  }
});
