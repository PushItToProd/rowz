import { mount, type VueWrapper } from "@vue/test-utils";
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
