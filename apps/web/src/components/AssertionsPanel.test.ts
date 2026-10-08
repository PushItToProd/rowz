import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, wireSnapshot, type MockedApi } from "../testing";
import AssertionsPanel from "./AssertionsPanel.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

it("keeps assertion details selectable and copies them separately from navigation", async () => {
  server.getSnapshot.mockResolvedValue(
    wireSnapshot(
      snapshotWith({
        A1: "-1",
        A2: '=ASSERT(A1 > 0, "Cell fails")',
        B2: '=ASSERT(A1 = 0, "Cell also fails")',
      }),
    ),
  );
  const store = useWorkbookStore();
  await store.load("s1");
  const wrapper = mount(AssertionsPanel);
  const clipboard = vi.fn().mockResolvedValue(undefined);
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  try {
    const content = wrapper.get(".assertions__content");
    expect(content.element.closest("button")).toBeNull();
    await wrapper.get(".assertions__copy").trigger("click");
    await flushPromises();
    expect(clipboard).toHaveBeenCalledWith("Table 1!A2 (page Page 1): Cell fails");
    const allAssertions = store.assertions
      .map((failure) => `${failure.label} (page Page 1): ${failure.message}`)
      .join("\n\n");
    await wrapper.get(".assertions__copy-all").trigger("click");
    await flushPromises();
    expect(clipboard).toHaveBeenLastCalledWith(allAssertions);
    expect(allAssertions).toContain("\n\n");
    await wrapper.get(".assertions__go").trigger("click");
    expect(wrapper.emitted("go")?.[0]?.[0]).toMatchObject({
      pageId: "p1",
      blockId: "t1",
      label: "Table 1!A2",
    });
  } finally {
    wrapper.unmount();
    if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});

it("keeps a later assertion's text selection when an earlier assertion disappears", async () => {
  server.getSnapshot.mockResolvedValue(
    wireSnapshot(
      snapshotWith({
        A1: "-1",
        A2: '=ASSERT(A1 > 0, "Cell fails")',
        B2: '=ASSERT(A1 = 0, "Cell also fails")',
      }),
    ),
  );
  const store = useWorkbookStore();
  await store.load("s1");
  const wrapper = mount(AssertionsPanel, { attachTo: document.body });
  try {
    const label = wrapper.findAll(".assertions__content strong")[1]!.element;
    const range = document.createRange();
    range.selectNodeContents(label);
    const selection = document.getSelection();
    expect(selection).not.toBeNull();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(selection?.toString()).toBe("Table 1!B2");

    await store.setCell(at("A2"), "1");
    await flushPromises();

    expect(wrapper.get(".assertions__content strong").element).toBe(label);
    expect(selection?.toString()).toBe("Table 1!B2");
  } finally {
    document.getSelection()?.removeAllRanges();
    wrapper.unmount();
  }
});

it("shows, copies, and opens the definition from an assertion's error trace", async () => {
  const snapshot = snapshotWith();
  snapshot.views = [
    {
      id: "v1",
      pageId: "p1",
      kind: "script",
      name: "Summary",
      position: 1,
      source: ['Broken() = ASSERT(FALSE, "The check failed")', "Result = Broken()"].join("\n"),
      chartType: null,
    },
  ];
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshot));
  const store = useWorkbookStore();
  await store.load("s1");
  const wrapper = mount(AssertionsPanel);
  const clipboard = vi.fn().mockResolvedValue(undefined);
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboard },
  });
  try {
    const failure = store.assertions[0]!;
    expect(failure.trace).toMatchObject([
      {
        function: "Broken",
        location: { scriptId: "v1", scriptName: "Summary", line: 1 },
      },
    ]);
    expect(wrapper.get(".error-trace__text").text()).toBe("Raised in Broken (Summary, line 1)");
    expect(wrapper.get(".error-trace__callers").text()).toBe(
      "Called from Result (Summary, line 2)",
    );

    await wrapper.get(".assertions__go").trigger("click");
    expect(wrapper.emitted("go")?.[0]?.[0]).toMatchObject({
      blockId: "v1",
      name: "Result",
      line: 2,
    });

    await wrapper.get(".assertions__copy").trigger("click");
    await flushPromises();
    expect(clipboard).toHaveBeenCalledWith(
      "Summary!Result (page Page 1): The check failed\n" +
        "Raised in Broken (Summary, line 1)\n" +
        "Called from Result (Summary, line 2)",
    );

    await wrapper.get(".error-trace__link").trigger("click");
    expect(wrapper.emitted("trace")?.[0]?.[0]).toEqual(failure.trace);
  } finally {
    wrapper.unmount();
    if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
});
