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

function mockClipboard() {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return {
    writeText,
    restore() {
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    },
  };
}

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
    const entries = wrapper.findAll(".errors__location");
    expect(entries).toHaveLength(2);
    expect(wrapper.get(".errors__content strong").text()).toBe("'Table 1'!A1");
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

it("keeps a later error's text selection when an earlier error disappears", async () => {
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith({ A1: "=1/0", B1: "=1/0" })));
  const store = useWorkbookStore();
  await store.load("s1");
  const wrapper = mount(ErrorsPanel, { attachTo: document.body });
  try {
    const label = wrapper.findAll(".errors__content strong")[1]!.element;
    const range = document.createRange();
    range.selectNodeContents(label);
    const selection = document.getSelection();
    expect(selection).not.toBeNull();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe("'Table 1'!B1");

    await store.setCell(at("A1"), "1");
    await flushPromises();

    expect(wrapper.get(".errors__content strong").element).toBe(label);
    expect(selection?.toString()).toBe("'Table 1'!B1");
  } finally {
    document.getSelection()?.removeAllRanges();
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
    const entry = wrapper.get(".errors__location");
    expect(wrapper.get(".errors__content strong").text()).toBe("Summary!QtyTotal");
    expect(wrapper.get(".errors__content").text()).toContain(
      "QtyTotal is already defined on line 1 of this script",
    );
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
  const clipboard = mockClipboard();
  try {
    expect(wrapper.get(".errors__content").element.closest("button")).toBeNull();
    expect(wrapper.get(".error-trace__text").element.closest("button")).toBeNull();
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

    expect(wrapper.get(".error-trace__text").text()).toBe(
      "Raised in PayoutByDuration (Script 1, line 1)",
    );
    const traceLink = wrapper.get(".error-trace__link");
    expect(traceLink.text()).toBe("Open definition");
    expect(traceLink.attributes("aria-label")).toBe(
      "Go to where it was raised: PayoutByDuration, Script 1, line 1",
    );

    await wrapper.get(".errors__copy").trigger("click");
    await flushPromises();
    expect(clipboard.writeText).toHaveBeenCalledWith(
      "#VALUE! in 'Payout by duration'!A1 (page Page 2): The data has no column Spa\n" +
        "Raised in PayoutByDuration (Script 1, line 1)\n" +
        "Called from 'Payout by duration'!A1",
    );
    expect(wrapper.get('[role="status"]').text()).toBe("Copied");

    await traceLink.trigger("click");
    expect(wrapper.emitted("trace")?.[0]?.[0]).toMatchObject([
      {
        function: "PayoutByDuration",
        location: { scriptId: "script-1", line: 1 },
      },
    ]);
  } finally {
    wrapper.unmount();
    clipboard.restore();
  }
});

it("copies all errors with a blank line between entries", async () => {
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith({ A1: "=1/0", B1: "=1/0" })));
  const store = useWorkbookStore();
  await store.load("s1");
  const wrapper = mount(ErrorsPanel);
  const clipboard = mockClipboard();
  try {
    const expected = store.errors
      .map((failure) => {
        const page = store.pages.find(({ id }) => id === failure.pageId)?.name ?? "Unknown page";
        const message = failure.message === failure.code ? "" : `: ${failure.message}`;
        return `${failure.code} in ${failure.label} (page ${page})${message}`;
      })
      .join("\n\n");
    await wrapper.get(".errors__copy-all").trigger("click");
    await flushPromises();
    expect(clipboard.writeText).toHaveBeenCalledWith(expected);
    expect(expected).toContain("\n\n");
  } finally {
    wrapper.unmount();
    clipboard.restore();
  }
});

it("uses a hidden textarea when the Clipboard API is unavailable", async () => {
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith({ A1: "=1/0" })));
  const store = useWorkbookStore();
  await store.load("s1");
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  const commandDescriptor = Object.getOwnPropertyDescriptor(document, "execCommand");
  const failure = store.errors[0]!;
  const message = failure.message === failure.code ? "" : `: ${failure.message}`;
  const expected = `${failure.code} in ${failure.label} (page Page 1)${message}`;
  const execCommand = vi.fn((command: string) => {
    expect(command).toBe("copy");
    expect(document.querySelector("textarea")?.value).toBe(expected);
    return true;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
  const wrapper = mount(ErrorsPanel);
  try {
    await wrapper.get(".errors__copy").trigger("click");
    await flushPromises();
    expect(execCommand).toHaveBeenCalledOnce();
    expect(document.querySelector("textarea")).toBeNull();
    expect(wrapper.get('[role="status"]').text()).toBe("Copied");
  } finally {
    wrapper.unmount();
    if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
    if (commandDescriptor) Object.defineProperty(document, "execCommand", commandDescriptor);
    else Reflect.deleteProperty(document, "execCommand");
  }
});
