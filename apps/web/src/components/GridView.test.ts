import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, TABLE, type MockedApi } from "../testing";
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
    server.click.mockResolvedValue({
      runId: "r",
      status: "succeeded",
      error: null,
      cells: [{ ...at("A1"), input: "2" }],
      emailsSent: 0,
    });

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

describe("a viewer", () => {
  it("can select but not edit, clear, or run buttons", async () => {
    await mountGrid({ A1: "1", B1: '=BUTTON("Go", EXECUTE(1, C1))' }, "viewer");
    await select("A1");
    expect(selectedAddress()).toBe("A1");

    await press("x");
    await press("Enter");
    await cellAt("A1").trigger("dblclick");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);

    await press("Delete");
    expect(cellAt("A1").text()).toBe("1");
    expect(cellAt("B1").get("button").attributes("disabled")).toBeDefined();
    expect(server.setCells).not.toHaveBeenCalled();
  });
});
