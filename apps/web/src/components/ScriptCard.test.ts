import { EditorView } from "@codemirror/view";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type ViewRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, changeWith, snapshotWith, wireSnapshot, TABLE, type MockedApi } from "../testing";
import ScriptCard from "./ScriptCard.vue";
import GridView from "./GridView.vue";

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
async function editorView(): Promise<EditorView> {
  await flushPromises();
  return EditorView.findFromDOM(wrapper.get(".cm-content").element as HTMLElement)!;
}
async function replaceDraft(text: string): Promise<void> {
  const editor = await editorView();
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text },
    selection: { anchor: text.length },
    userEvent: "input.type",
  });
  await flushPromises();
}

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

  it("says why a name is refused", async () => {
    await render("Sum = 1");
    const cell = wrapper.get("td");
    expect(cell.text()).toMatch(/^#NAME\?/);
    expect(cell.get(".script__reason").text()).toMatch(/SUM/i);
  });

  it.each([
    {
      kind: "value",
      source: "QtyTotal = 3\nQtyTotal = 5",
      formula: "=QtyTotal",
      value: 3,
      firstLine: "3",
      message: "QtyTotal is already defined on line 1 of this script",
    },
    {
      kind: "function",
      source: "Double(x) = x * 2\nDouble(y) = y * 3",
      formula: "=Double(4)",
      value: 8,
      firstLine: "function (x)",
      message: "Double is already defined on line 1 of this script",
    },
  ])(
    "marks a repeated script $kind on the later line",
    async ({ source, formula, value, firstLine, message }) => {
      await render(source, { A1: formula });

      expect(rows()[0]?.[1]).toBe(firstLine);
      expect(wrapper.get('tr[data-script-line="2"] .script__reason').text()).toBe(message);
      expect(useWorkbookStore().valueOf(at("A1"))).toBe(value);
      expect(useWorkbookStore().errors).toContainEqual(
        expect.objectContaining({ line: 2, code: "#NAME?", message }),
      );
    },
  );

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
    await replaceDraft("Total = 2");
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

  it("shows what an assertion gives, and lists the ones that fail", async () => {
    await render(
      ["ASSERT('Table 1'!A1 > 0, \"A1 must be positive\")", "ASSERT(1 = 1)"].join("\n"),
      {
        A1: "-1",
        A2: '=ASSERT(A1 > 0, "Cell fails")',
      },
    );
    const shown = rows();
    expect(shown[0]?.[1]).toMatch(/^#ASSERT!\s*A1 must be positive/);
    expect(shown[1]?.[1]).toBe("TRUE");
    expect(useWorkbookStore().assertions.map(({ label, message }) => [label, message])).toEqual([
      ["Table 1!A2", "Cell fails"],
      ["Summary line 1", "A1 must be positive"],
    ]);
  });
});

it("saving on blur preserves the selected cell without scrolling to it", async () => {
  await render("Total = 1");
  const store = useWorkbookStore();
  const grid = mount(GridView, { props: { table: TABLE }, attachTo: document.body });
  try {
    store.selection = at("A1");
    await wrapper.vm.$nextTick();
    await wrapper.get("table").trigger("dblclick");
    await replaceDraft("Total = 2");
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    (await editorView()).contentDOM.blur();
    await flushPromises();
    expect(rows()).toEqual([["Total", "2"]]);
    expect(store.selection).toEqual(at("A1"));
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(grid.get(".grid").element);
  } finally {
    grid.unmount();
  }
});

it("retains a failed source save and Cancel discards without retrying", async () => {
  await render("Total = 1");
  await wrapper.get("table").trigger("dblclick");
  await replaceDraft("Total = 9");
  server.updateView.mockRejectedValueOnce(new Error("Offline"));
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Done")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.get('[role="alert"]').text()).toBe("Offline");
  expect((await editorView()).state.doc.toString()).toBe("Total = 9");
  expect(document.activeElement).toBe((await editorView()).contentDOM);
  await wrapper
    .findAll("button")
    .find((button) => button.text() === "Cancel")!
    .trigger("click");
  await flushPromises();
  expect(wrapper.find(".cm-editor").exists()).toBe(false);
  expect(rows()).toEqual([["Total", "1"]]);
  expect(server.updateView).toHaveBeenCalledOnce();
});
