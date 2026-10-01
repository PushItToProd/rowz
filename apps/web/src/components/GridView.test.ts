import { DOMWrapper, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, clickResult, snapshotWith, TABLE, type MockedApi } from "../testing";
import GridView from "./GridView.vue";

vi.mock("../api/client", async () => ({ api: (await import("../testing")).mockApi() }));
const server = api as unknown as MockedApi;

let wrapper: VueWrapper;

async function mountGrid(inputs: Record<string, string> = {}, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue(snapshotWith(inputs, role));
  await useWorkbookStore().load("s1");
  wrapper = mount(GridView, { props: { table: TABLE }, attachTo: document.body });
}

/** Replaces the mounted grid with one over other cells, within one test. */
async function mountGridAgain(inputs: Record<string, string>): Promise<void> {
  wrapper.unmount();
  setActivePinia(createPinia());
  await mountGrid(inputs);
}

function cellAt(address: string) {
  return wrapper.get(`[data-cell="${address}"]`);
}

function selectedAddress(): string | undefined {
  const selected = wrapper.find('[aria-selected="true"]');
  return selected.exists() ? selected.attributes("data-cell") : undefined;
}

async function press(
  key: string,
  options: { shiftKey?: boolean; ctrlKey?: boolean } = {},
): Promise<void> {
  const editor = wrapper.find(".grid__editor");
  await (editor.exists() ? editor : wrapper.get(".grid")).trigger("keydown", { key, ...options });
}

async function select(address: string): Promise<void> {
  await cellAt(address).trigger("mousedown");
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});
afterEach(() => {
  wrapper.unmount();
});

describe("rendering", () => {
  it("shows column letters, row numbers, and one cell per position", async () => {
    await mountGrid();
    expect(wrapper.findAll("thead th").map((th) => th.text())).toEqual(["", "A", "B", "C"]);
    expect(wrapper.findAll("tbody th").map((th) => th.text())).toEqual(["1", "2", "3", "4"]);
    expect(wrapper.findAll("td")).toHaveLength(12);
    expect(wrapper.get(".grid").attributes("aria-label")).toBe("Table 1");
  });

  it("shows computed values, not formulas", async () => {
    await mountGrid({ A1: "2", B1: "=A1*3", C1: "=1/0", A2: "hello" });
    expect(cellAt("B1").text()).toBe("6");
    expect(cellAt("C1").text()).toBe("#DIV/0!");
    expect(cellAt("A2").text()).toBe("hello");
    expect(cellAt("C4").text()).toBe("");
  });
});

describe("array results", () => {
  it("shows the values an array formula fills, and marks the filled cells", async () => {
    await mountGrid({ A1: "=SEQUENCE(2, 2)", C3: "=SUM(A1:B2)" });
    expect(["A1", "B1", "A2", "B2"].map((address) => cellAt(address).text())).toEqual([
      "1",
      "2",
      "3",
      "4",
    ]);
    expect(cellAt("C3").text()).toBe("10");
    expect(cellAt("A1").classes()).not.toContain("grid__cell--filled");
    expect(cellAt("B2").classes()).toContain("grid__cell--filled");
    expect(cellAt("C1").classes()).not.toContain("grid__cell--filled");
  });

  it("shows #SPILL! once something is typed into a filled cell, and recovers when it is cleared", async () => {
    await mountGrid({ A1: "=SEQUENCE(3)" });
    await select("A2");
    await press("x");
    await press("Enter");
    expect(cellAt("A1").text()).toBe("#SPILL!");
    expect(cellAt("A3").text()).toBe("");

    await select("A2");
    await press("Delete");
    expect(["A1", "A2", "A3"].map((address) => cellAt(address).text())).toEqual(["1", "2", "3"]);
  });
});

describe("selection", () => {
  it("selects the cell under the mouse", async () => {
    await mountGrid();
    expect(selectedAddress()).toBeUndefined();
    await select("B2");
    expect(selectedAddress()).toBe("B2");
    expect(useWorkbookStore().selection).toEqual(at("B2"));
  });

  it("shows no selection when another table holds it", async () => {
    await mountGrid();
    useWorkbookStore().selection = at("A1", "other");
    await wrapper.vm.$nextTick();
    expect(selectedAddress()).toBeUndefined();
  });

  it.each([
    ["ArrowDown", {}, "B3"],
    ["ArrowUp", {}, "B1"],
    ["ArrowLeft", {}, "A2"],
    ["ArrowRight", {}, "C2"],
    ["Tab", {}, "C2"],
    ["Tab", { shiftKey: true }, "A2"],
  ])("moves from B2 with %s %j to %s", async (key, options, expected) => {
    await mountGrid();
    await select("B2");
    await press(key, options);
    expect(selectedAddress()).toBe(expected);
  });

  it("stops at the edges of the table", async () => {
    await mountGrid();
    await select("A1");
    await press("ArrowUp");
    await press("ArrowLeft");
    expect(selectedAddress()).toBe("A1");

    await select("C4");
    await press("ArrowDown");
    await press("ArrowRight");
    expect(selectedAddress()).toBe("C4");
  });

  it("ignores keys when nothing is selected", async () => {
    await mountGrid();
    await press("ArrowDown");
    await press("x");
    expect(selectedAddress()).toBeUndefined();
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
  });
});

describe("editing", () => {
  it("starts with the typed character, replacing the content, and saves on Enter", async () => {
    await mountGrid({ A1: "old" });
    await select("A1");
    await press("7");

    const editor = wrapper.get<HTMLInputElement>(".grid__editor");
    expect(editor.element.value).toBe("7");
    expect(document.activeElement).toBe(editor.element);

    await editor.setValue("75");
    await press("Enter");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [
      { row: 0, col: 0, input: "75" },
    ]);
    expect(cellAt("A1").text()).toBe("75");
    expect(selectedAddress()).toBe("A2");
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });

  it.each(["Enter", "F2"])("opens the existing input for editing with %s", async (key) => {
    await mountGrid({ A1: "5", B1: "=A1*2" });
    await select("B1");
    await press(key);
    expect(wrapper.get<HTMLInputElement>(".grid__editor").element.value).toBe("=A1*2");
  });

  it("opens the existing input on double click", async () => {
    await mountGrid({ A1: "5" });
    await select("A1");
    await cellAt("A1").trigger("dblclick");
    expect(wrapper.get<HTMLInputElement>(".grid__editor").element.value).toBe("5");
  });

  it("saves and moves sideways on Tab", async () => {
    await mountGrid();
    await select("B1");
    await press("x");
    await press("Tab");
    expect(cellAt("B1").text()).toBe("x");
    expect(selectedAddress()).toBe("C1");

    await press("y");
    await press("Tab", { shiftKey: true });
    expect(cellAt("C1").text()).toBe("y");
    expect(selectedAddress()).toBe("B1");
  });

  it("discards the draft on Escape", async () => {
    await mountGrid({ A1: "keep" });
    await select("A1");
    await press("x");
    await press("Escape");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
    expect(cellAt("A1").text()).toBe("keep");
    expect(server.setCells).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });

  it("saves the draft when another cell is clicked", async () => {
    await mountGrid();
    await select("A1");
    await press("9");
    await select("B2");
    expect(cellAt("A1").text()).toBe("9");
    expect(selectedAddress()).toBe("B2");
  });

  it("saves the draft when the editor loses focus", async () => {
    await mountGrid();
    await select("A1");
    await press("9");
    await wrapper.get(".grid__editor").trigger("blur");
    expect(cellAt("A1").text()).toBe("9");
  });

  it("keeps editing when the cell being edited is clicked", async () => {
    await mountGrid();
    await select("A1");
    await press("9");
    await select("A1");
    expect(wrapper.find(".grid__editor").exists()).toBe(true);
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it.each(["ArrowLeft", "ArrowRight"])(
    "keeps editing on %s, which moves the caret",
    async (key) => {
      await mountGrid();
      await select("B2");
      await press("9");
      await press(key);
      expect(selectedAddress()).toBe("B2");
      expect(wrapper.find(".grid__editor").exists()).toBe(true);
      expect(server.setCells).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["ArrowDown", "B3"],
    ["ArrowUp", "B1"],
  ])("saves and moves to the next row on %s while editing", async (key, expected) => {
    await mountGrid();
    await select("B2");
    await press("9");
    await press(key);
    expect(cellAt("B2").text()).toBe("9");
    expect(selectedAddress()).toBe(expected);
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });

  it.each(["Delete", "Backspace"])("clears the selected cell with %s", async (key) => {
    await mountGrid({ A1: "gone" });
    await select("A1");
    await press(key);
    expect(cellAt("A1").text()).toBe("");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [{ row: 0, col: 0, input: "" }]);
  });

  it("does not start editing on a keyboard shortcut", async () => {
    await mountGrid();
    await select("A1");
    await press("c", { ctrlKey: true });
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
  });
});

describe("selecting a range", () => {
  function rangeAddresses(): (string | undefined)[] {
    return wrapper.findAll(".grid__cell--in-range").map((cell) => cell.attributes("data-cell"));
  }

  it("extends from the selected cell with Shift and the arrows, and shrinks back", async () => {
    await mountGrid();
    await select("B2");
    await press("ArrowDown", { shiftKey: true });
    await press("ArrowRight", { shiftKey: true });
    expect(rangeAddresses()).toEqual(["B2", "C2", "B3", "C3"]);
    expect(selectedAddress()).toBe("B2");

    await press("ArrowUp", { shiftKey: true });
    expect(rangeAddresses()).toEqual(["B2", "C2"]);
    // Past the table's edge the range stops growing.
    await press("ArrowRight", { shiftKey: true });
    await press("ArrowRight", { shiftKey: true });
    expect(rangeAddresses()).toEqual(["B2", "C2"]);
  });

  it("extends to a cell clicked with Shift, and to cells the mouse is dragged over", async () => {
    await mountGrid();
    await select("A1");
    await cellAt("B3").trigger("mousedown", { shiftKey: true });
    expect(rangeAddresses()).toHaveLength(6);
    window.dispatchEvent(new MouseEvent("mouseup"));

    await select("C1");
    await cellAt("C2").trigger("mouseenter");
    await cellAt("B4").trigger("mouseenter");
    expect(rangeAddresses()).toEqual(["B1", "C1", "B2", "C2", "B3", "C3", "B4", "C4"]);
    expect(selectedAddress()).toBe("C1");

    // After the button is released, moving the mouse changes nothing.
    window.dispatchEvent(new MouseEvent("mouseup"));
    await cellAt("A1").trigger("mouseenter");
    expect(rangeAddresses()).toHaveLength(8);
  });

  it("goes back to one cell when another cell is selected or the arrows move", async () => {
    await mountGrid();
    await select("A1");
    await press("ArrowDown", { shiftKey: true });
    await press("ArrowRight");
    expect(rangeAddresses()).toEqual(["B1"]);
    expect(selectedAddress()).toBe("B1");
  });

  it("selects the selected cell alone when it is clicked as part of a range", async () => {
    await mountGrid();
    await select("A1");
    await press("ArrowDown", { shiftKey: true });
    window.dispatchEvent(new MouseEvent("mouseup"));
    await select("A1");
    expect(rangeAddresses()).toEqual(["A1"]);
  });

  it("clears every cell of the range with Delete, in one save", async () => {
    await mountGrid({ A1: "1", A2: "2", B1: "3", C3: "kept" });
    await select("A1");
    await cellAt("B2").trigger("mousedown", { shiftKey: true });
    await press("Delete");
    expect(["A1", "A2", "B1", "C3"].map((address) => cellAt(address).text())).toEqual([
      "",
      "",
      "",
      "kept",
    ]);
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [
      { row: 0, col: 0, input: "" },
      { row: 0, col: 1, input: "" },
      { row: 1, col: 0, input: "" },
    ]);
  });

  it("ignores the right mouse button", async () => {
    await mountGrid();
    await cellAt("B2").trigger("mousedown", { button: 2 });
    expect(selectedAddress()).toBeUndefined();
  });
});

describe("filling", () => {
  async function selectRange(from: string, to: string): Promise<void> {
    await select(from);
    await cellAt(to).trigger("mousedown", { shiftKey: true });
    window.dispatchEvent(new MouseEvent("mouseup"));
  }

  it("fills down from the handle, moving formula references, and leaves the filled cells selected", async () => {
    await mountGrid({ A1: "1", A2: "2", A3: "3", B1: "=A1*10" });
    await select("B1");
    window.dispatchEvent(new MouseEvent("mouseup"));

    await wrapper.get(".grid__fill-handle").trigger("mousedown");
    await cellAt("B2").trigger("mouseenter");
    await cellAt("B3").trigger("mouseenter");
    expect(
      wrapper.findAll(".grid__cell--fill-preview").map((cell) => cell.attributes("data-cell")),
    ).toEqual(["B1", "B2", "B3"]);
    // Nothing is written until the mouse is released.
    expect(server.setCells).not.toHaveBeenCalled();

    window.dispatchEvent(new MouseEvent("mouseup"));
    await wrapper.vm.$nextTick();
    expect(["B1", "B2", "B3"].map((address) => cellAt(address).text())).toEqual(["10", "20", "30"]);
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [
      { row: 1, col: 1, input: "=A2*10" },
      { row: 2, col: 1, input: "=A3*10" },
    ]);
    expect(wrapper.findAll(".grid__cell--in-range")).toHaveLength(3);
    expect(wrapper.find(".grid__cell--fill-preview").exists()).toBe(false);
  });

  it("fills across when the handle is dragged sideways", async () => {
    await mountGrid({ A1: "=A2+1", A2: "1", B2: "5", C2: "9" });
    await select("A1");
    window.dispatchEvent(new MouseEvent("mouseup"));
    await wrapper.get(".grid__fill-handle").trigger("mousedown");
    await cellAt("C1").trigger("mouseenter");
    window.dispatchEvent(new MouseEvent("mouseup"));
    await wrapper.vm.$nextTick();
    expect(["A1", "B1", "C1"].map((address) => cellAt(address).text())).toEqual(["2", "6", "10"]);
  });

  it("writes nothing when the handle is released where it started", async () => {
    await mountGrid({ A1: "1" });
    await select("A1");
    window.dispatchEvent(new MouseEvent("mouseup"));
    await wrapper.get(".grid__fill-handle").trigger("mousedown");
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("puts the handle on the last cell of a range", async () => {
    await mountGrid();
    await selectRange("A1", "B2");
    expect(wrapper.findAll(".grid__fill-handle")).toHaveLength(1);
    expect(cellAt("B2").find(".grid__fill-handle").exists()).toBe(true);
  });

  it("copies the first row down with Ctrl+D and the first column across with Ctrl+R", async () => {
    await mountGrid({ A1: "=B1+1", B1: "5", B2: "6", B3: "7" });
    await selectRange("A1", "A3");
    await press("d", { ctrlKey: true });
    expect(["A1", "A2", "A3"].map((address) => cellAt(address).text())).toEqual(["6", "7", "8"]);

    await mountGridAgain({ A1: "x", A2: "y" });
    await selectRange("A1", "C2");
    await press("r", { ctrlKey: true });
    expect(["B1", "C1", "B2", "C2"].map((address) => cellAt(address).text())).toEqual([
      "x",
      "x",
      "y",
      "y",
    ]);
  });

  it("offers no handle and fills nothing for a viewer", async () => {
    await mountGrid({ A1: "1" }, "viewer");
    await selectRange("A1", "A3");
    expect(wrapper.find(".grid__fill-handle").exists()).toBe(false);
    await press("d", { ctrlKey: true });
    await press("Delete");
    expect(server.setCells).not.toHaveBeenCalled();
  });
});

describe("copy and paste", () => {
  /** Fires a clipboard event at the document, as the browser does when the grid has focus. */
  function clipboard(
    type: "copy" | "cut" | "paste",
    text = "",
  ): { text: string; prevented: boolean } {
    const data = new Map<string, string>([["text/plain", text]]);
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, {
      clipboardData: {
        getData: (format: string) => data.get(format) ?? "",
        setData: (format: string, value: string) => data.set(format, value),
      },
    });
    document.dispatchEvent(event);
    return { text: data.get("text/plain") ?? "", prevented: event.defaultPrevented };
  }

  async function focusAndSelect(from: string, to = from): Promise<void> {
    await select(from);
    if (to !== from) await cellAt(to).trigger("mousedown", { shiftKey: true });
    window.dispatchEvent(new MouseEvent("mouseup"));
    wrapper.get<HTMLElement>(".grid").element.focus();
  }

  it("copies the values the cells show, for other apps to use", async () => {
    await mountGrid({ A1: "2", B1: "=A1*3", A2: "text" });
    await focusAndSelect("A1", "B2");
    expect(clipboard("copy")).toEqual({ text: "2\t6\ntext\t", prevented: true });
  });

  it("pastes its own copy as formulas, moved to the new place", async () => {
    await mountGrid({ A1: "2", A2: "5", B1: "=A1*3" });
    await focusAndSelect("B1");
    const { text } = clipboard("copy");

    await focusAndSelect("B2");
    clipboard("paste", text);
    await vi.waitFor(() => {
      expect(cellAt("B2").text()).toBe("15");
    });
    expect(useWorkbookStore().inputOf(at("B2"))).toBe("=A2*3");
  });

  it("pastes text from another app as typed values, and selects what it pasted", async () => {
    await mountGrid();
    await focusAndSelect("B2");
    clipboard("paste", "a\tb\r\n1\t=B2\r\n");
    await vi.waitFor(() => {
      expect(cellAt("C3").text()).toBe("a");
    });
    expect(["B2", "C2", "B3"].map((address) => cellAt(address).text())).toEqual(["a", "b", "1"]);
    expect(wrapper.findAll(".grid__cell--in-range")).toHaveLength(4);
  });

  it("grows the table when what is pasted does not fit", async () => {
    await mountGrid();
    server.updateTable.mockResolvedValue({
      table: { ...TABLE, rowCount: 6 },
      cells: [],
      views: [],
      tables: [],
    });
    await focusAndSelect("C4");
    clipboard("paste", "one\ntwo\nthree");
    await vi.waitFor(() => {
      expect(server.updateTable).toHaveBeenCalledExactlyOnceWith("t1", {
        rowCount: 6,
        colCount: 3,
      });
    });
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledOnce();
    });
  });

  it("cuts by copying and then clearing", async () => {
    await mountGrid({ A1: "moved" });
    await focusAndSelect("A1");
    expect(clipboard("cut").text).toBe("moved");
    await wrapper.vm.$nextTick();
    expect(cellAt("A1").text()).toBe("");
  });

  it("leaves the clipboard to the browser while a cell is being edited or the grid lacks focus", async () => {
    await mountGrid({ A1: "x" });
    await focusAndSelect("A1");
    await press("y");
    expect(clipboard("copy").prevented).toBe(false);
    expect(clipboard("paste", "z").prevented).toBe(false);
    await press("Escape");

    wrapper.get<HTMLElement>(".grid").element.blur();
    expect(clipboard("copy").prevented).toBe(false);
    expect(clipboard("paste", "z").prevented).toBe(false);
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("does not paste for a viewer", async () => {
    await mountGrid({}, "viewer");
    await focusAndSelect("A1");
    clipboard("paste", "x");
    await wrapper.vm.$nextTick();
    expect(server.setCells).not.toHaveBeenCalled();
  });
});

describe("formula suggestions", () => {
  function options(): (string | undefined)[] {
    return [...document.querySelectorAll('.formula-assist [role="option"]')].map(
      (option) => option.querySelector(".formula-assist__label")?.textContent,
    );
  }

  function editor() {
    return wrapper.get<HTMLInputElement>(".grid__editor");
  }

  /** Starts editing A1 and types the text. */
  async function type(text: string): Promise<void> {
    await select("A1");
    await press(text.charAt(0));
    await editor().setValue(text);
  }

  it("lists matching functions while a formula is typed, and completes with Tab", async () => {
    await mountGrid();
    await type("=rou");
    expect(options()).toEqual(["ROUND", "ROUNDDOWN", "ROUNDUP"]);
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
      "ROUND(number, [digits])",
    );

    await press("Tab");
    expect(editor().element.value).toBe("=ROUND(");
    expect(selectedAddress()).toBe("A1");
    expect(options()).toEqual([]);
    expect(document.querySelector('.formula-assist [role="note"]')?.textContent).toContain(
      "ROUND(number, [digits])",
    );
  });

  it("saves the cell on Enter while the list has not been touched", async () => {
    await mountGrid();
    await type("=ab");
    expect(options()).toEqual(["ABS"]);
    await press("Enter");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [
      { row: 0, col: 0, input: "=ab" },
    ]);
    expect(selectedAddress()).toBe("A2");
    expect(document.querySelector(".formula-assist")).toBeNull();
  });

  it("moves the highlight with the arrows, then accepts it with Enter", async () => {
    await mountGrid();
    await type("=rou");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowUp");
    expect(selectedAddress()).toBe("A1");
    await press("Enter");
    expect(editor().element.value).toBe("=ROUNDDOWN(");
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("wraps the highlight around the ends of the list", async () => {
    await mountGrid();
    await type("=rou");
    await press("ArrowUp");
    await press("Enter");
    expect(editor().element.value).toBe("=ROUNDUP(");
  });

  it("closes the list on Escape, and cancels the edit on a second Escape", async () => {
    await mountGrid({ A1: "kept" });
    await type("=rou");
    await press("Escape");
    expect(options()).toEqual([]);
    expect(editor().element.value).toBe("=rou");

    await press("Escape");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
    expect(cellAt("A1").text()).toBe("kept");
  });

  it("accepts a clicked suggestion without ending the edit", async () => {
    await mountGrid();
    await type("=rou");
    const option = document.querySelectorAll('.formula-assist [role="option"]')[2];
    await new DOMWrapper(option).trigger("mousedown");
    expect(editor().element.value).toBe("=ROUNDUP(");
    // The editor keeps focus, so the click did not end the edit.
    expect(document.activeElement).toBe(editor().element);
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("offers tables of the cell's page and completes one with its qualifier", async () => {
    await mountGrid();
    await type("=tab");
    expect(options()).toEqual(["Table 1"]);
    await press("Tab");
    expect(editor().element.value).toBe("='Table 1'!");
  });

  it("shows what the function at the caret expects", async () => {
    await mountGrid();
    await type("=IF(A2 > 1, ");
    expect(options()).toEqual([]);
    expect(document.querySelector('.formula-assist [role="note"]')?.textContent).toContain(
      "IF(condition, then, [else])",
    );
  });

  it("offers nothing while plain text is typed, and nothing when not editing", async () => {
    await mountGrid();
    expect(document.querySelector(".formula-assist")).toBeNull();
    await type("sum");
    expect(document.querySelector(".formula-assist")).toBeNull();
  });
});

describe("buttons", () => {
  const BUTTON = '=BUTTON("Add one", EXECUTE(A1+1, A1))';

  it("runs the action when the button is clicked and shows the written value", async () => {
    await mountGrid({ A1: "1", B1: BUTTON });
    server.click.mockResolvedValue(clickResult({ cells: [{ ...at("A1"), input: "2" }] }));

    const button = cellAt("B1").get("button");
    expect(button.text()).toBe("Add one");
    await button.trigger("click");
    await vi.waitFor(() => {
      expect(cellAt("A1").text()).toBe("2");
    });
    expect(server.click).toHaveBeenCalledExactlyOnceWith(at("B1"));
  });

  it("keeps keyboard focus on the grid after a button is clicked", async () => {
    await mountGrid({ A1: "1", B1: BUTTON });
    await select("B1");
    const button = cellAt("B1").get<HTMLButtonElement>("button");
    button.element.focus();
    await button.trigger("click");
    expect(document.activeElement).toBe(wrapper.get(".grid").element);

    await press("ArrowLeft");
    expect(selectedAddress()).toBe("A1");
  });

  it("scrolls the selected cell into view when the selection moves", async () => {
    await mountGrid();
    await select("B2");
    await press("ArrowDown");
    await wrapper.vm.$nextTick();
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts;
    expect(scrolled.at(-1)).toBe(cellAt("B3").element);
  });

  it("opens the button's formula for editing with Enter", async () => {
    await mountGrid({ B1: BUTTON });
    await select("B1");
    await press("Enter");
    expect(wrapper.get<HTMLInputElement>(".grid__editor").element.value).toBe(BUTTON);
  });
});

describe("controls", () => {
  it("shows a checkbox for the cell it is bound to, and sends a change to the server", async () => {
    await mountGrid({ A1: "FALSE", B1: '=CHECKBOX(A1, "Done")' });
    server.input.mockResolvedValue(clickResult({ cells: [{ ...at("A1"), input: "TRUE" }] }));

    const box = cellAt("B1").get<HTMLInputElement>('input[type="checkbox"]');
    expect(cellAt("B1").text()).toBe("Done");
    expect(box.element.checked).toBe(false);

    await box.setValue(true);
    await vi.waitFor(() => {
      expect(cellAt("A1").text()).toBe("TRUE");
    });
    expect(server.input).toHaveBeenCalledExactlyOnceWith(at("B1"), true);
    expect(cellAt("B1").get<HTMLInputElement>("input").element.checked).toBe(true);
    expect(useWorkbookStore().notice).toBeNull();
  });

  it("shows a dropdown of the choices, with the bound cell's value chosen", async () => {
    await mountGrid({ A1: "low", A2: "high", B1: "high", C1: "=DROPDOWN(A1:A2, B1)" });
    server.input.mockResolvedValue(clickResult({ cells: [{ ...at("B1"), input: "low" }] }));

    const select = cellAt("C1").get<HTMLSelectElement>("select");
    expect(select.findAll("option").map((option) => option.text())).toEqual(["", "low", "high"]);
    expect(select.element.selectedOptions[0]?.text).toBe("high");

    await select.setValue("0");
    await vi.waitFor(() => {
      expect(cellAt("B1").text()).toBe("low");
    });
    expect(server.input).toHaveBeenCalledExactlyOnceWith(at("C1"), "low");
  });

  it("sends an empty value when the blank choice is picked", async () => {
    await mountGrid({ B1: "x", C1: '=DROPDOWN("x, y", B1)' });
    await cellAt("C1").get("select").setValue("-1");
    await vi.waitFor(() => {
      expect(server.input).toHaveBeenCalledExactlyOnceWith(at("C1"), null);
    });
  });

  it("leaves arrow keys to a focused dropdown, so they change the choice and not the selection", async () => {
    await mountGrid({ C1: '=DROPDOWN("x, y", B1)' });
    await select("C1");
    await cellAt("C1").get("select").trigger("keydown", { key: "ArrowDown" });
    expect(selectedAddress()).toBe("C1");
  });

  it("reports a refused choice", async () => {
    await mountGrid({ B1: "=CHECKBOX(A1)" });
    server.input.mockResolvedValue(
      clickResult({ status: "failed", error: "A1 is outside the table" }),
    );
    await cellAt("B1").get("input").setValue(true);
    await vi.waitFor(() => {
      expect(useWorkbookStore().notice).toEqual({ kind: "error", text: "A1 is outside the table" });
    });
  });
});

describe("a viewer", () => {
  it("can select but not edit, clear, or run buttons", async () => {
    await mountGrid(
      {
        A1: "1",
        B1: '=BUTTON("Go", EXECUTE(1, C1))',
        A2: "=CHECKBOX(A3)",
        B2: '=DROPDOWN("x", B3)',
      },
      "viewer",
    );
    await select("A1");
    expect(selectedAddress()).toBe("A1");

    await press("x");
    await press("Enter");
    await cellAt("A1").trigger("dblclick");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);

    await press("Delete");
    expect(cellAt("A1").text()).toBe("1");
    expect(cellAt("B1").get("button").attributes("disabled")).toBeDefined();
    expect(cellAt("A2").get("input").attributes("disabled")).toBeDefined();
    expect(cellAt("B2").get("select").attributes("disabled")).toBeDefined();
    expect(server.setCells).not.toHaveBeenCalled();
  });
});

describe("row and column headers, and the menu", () => {
  const block = () => useWorkbookStore().selectedBlock;

  it("selects a whole row or column from its header", async () => {
    await mountGrid();
    await wrapper.findAll("tbody th")[1]!.trigger("mousedown");
    expect(block()).toEqual({ startRow: 1, endRow: 1, startCol: 0, endCol: 2 });
    await wrapper.findAll("thead th")[2]!.trigger("mousedown");
    expect(block()).toEqual({ startRow: 0, endRow: 3, startCol: 1, endCol: 1 });
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });

  it("selects every cell with Ctrl+A", async () => {
    await mountGrid();
    await select("B2");
    await press("a", { ctrlKey: true });
    expect(block()).toEqual({ startRow: 0, endRow: 3, startCol: 0, endCol: 2 });
  });

  it("asks for the menu where a cell is right-clicked, and selects that cell", async () => {
    await mountGrid();
    await select("A1");
    await cellAt("B3").trigger("contextmenu", { clientX: 120, clientY: 80 });
    expect(selectedAddress()).toBe("B3");
    expect(wrapper.emitted("menu")).toEqual([[{ x: 120, y: 80 }]]);
  });

  it("keeps a selected range when the right-click is inside it", async () => {
    await mountGrid();
    await select("A1");
    await cellAt("B2").trigger("mousedown", { shiftKey: true });
    await cellAt("B1").trigger("contextmenu");
    expect(block()).toEqual({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(wrapper.emitted("menu")).toHaveLength(1);
  });

  it("asks for the menu from a header after selecting its row or column", async () => {
    await mountGrid();
    await wrapper.findAll("tbody th")[2]!.trigger("contextmenu", { clientX: 5, clientY: 6 });
    expect(block()).toEqual({ startRow: 2, endRow: 2, startCol: 0, endCol: 2 });
    expect(wrapper.emitted("menu")).toEqual([[{ x: 5, y: 6 }]]);
  });

  it.each([
    ["ContextMenu", {}],
    ["F10", { shiftKey: true }],
  ])("asks for the menu at the selected cell on %s", async (key, options) => {
    await mountGrid();
    await select("B2");
    await press(key, options);
    expect(wrapper.emitted("menu")).toHaveLength(1);
  });

  it("leaves a viewer the browser's own menu", async () => {
    await mountGrid({}, "viewer");
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    cellAt("A1").element.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(wrapper.emitted("menu")).toBeUndefined();
  });
});

describe("touch", () => {
  async function tap(address: string): Promise<void> {
    const cell = cellAt(address);
    // jsdom has no PointerEvent, so a plain event carries the one field the grid reads.
    const down = new Event("pointerdown", { bubbles: true });
    Object.assign(down, { pointerType: "touch" });
    cell.element.dispatchEvent(down);
    await cell.trigger("mousedown");
    await cell.trigger("click");
  }

  it("selects a cell on the first tap and edits it on the second", async () => {
    await mountGrid({ A1: "hello" });
    await tap("A1");
    expect(selectedAddress()).toBe("A1");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);

    await tap("A1");
    const editor = wrapper.get<HTMLInputElement>(".grid__editor");
    expect(editor.element.value).toBe("hello");
    expect(document.activeElement).toBe(editor.element);
  });

  it("does not start editing when a mouse clicks the selected cell", async () => {
    await mountGrid({ A1: "hello" });
    await select("A1");
    await cellAt("A1").trigger("mousedown");
    await cellAt("A1").trigger("click");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
  });

  it("does not start editing for a viewer", async () => {
    await mountGrid({ A1: "hello" }, "viewer");
    await tap("A1");
    await tap("A1");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
  });
});
