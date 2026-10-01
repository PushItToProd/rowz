import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { download } from "../files/download";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, TABLE, type MockedApi } from "../testing";
import TableCard from "./TableCard.vue";

vi.mock("../api/client", async () => ({ api: (await import("../testing")).mockApi() }));
vi.mock("../files/download", () => ({
  download: vi.fn(),
  fileName: (name: string, extension: string) => `${name}.${extension}`,
}));
const server = api as unknown as MockedApi;

let wrapper: VueWrapper;
const confirm = vi.spyOn(window, "confirm");

async function render(inputs: Record<string, string> = {}, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue(snapshotWith(inputs, role));
  await useWorkbookStore().load("s1");
  wrapper = mount(TableCard, { props: { table: TABLE }, attachTo: document.body });
}

async function select(address: string): Promise<void> {
  useWorkbookStore().selection = at(address);
  await wrapper.vm.$nextTick();
}

function button(name: string) {
  const found = wrapper.findAll("button").find((candidate) => candidate.text() === name);
  if (!found) throw new Error(`No button named ${name}`);
  return found;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  confirm.mockReturnValue(true);
  server.editTable.mockResolvedValue({ table: TABLE, cells: [], views: [], tables: [] });
});
afterEach(() => {
  wrapper.unmount();
});

describe("row and column actions", () => {
  it("appear only while a cell of the table is selected, and name its row and column", async () => {
    await render();
    expect(wrapper.get(".table-card__lines").text()).toBe(
      "Select a cell to insert or delete its row or column.",
    );

    await select("B3");
    expect(wrapper.get(".table-card__lines").text()).toContain("Row 3");
    expect(wrapper.get(".table-card__lines").text()).toContain("Column B");

    useWorkbookStore().selection = at("B3", "another-table");
    await wrapper.vm.$nextTick();
    expect(wrapper.get(".table-card__lines").findAll("button")).toEqual([]);
  });

  it.each([
    ["Insert row above", { axis: "row", kind: "insert", index: 2 }],
    ["Delete row", { axis: "row", kind: "delete", index: 2 }],
    ["Insert column left", { axis: "col", kind: "insert", index: 1 }],
    ["Delete column", { axis: "col", kind: "delete", index: 1 }],
  ])("%s edits the selected cell's row or column", async (name, edit) => {
    await render();
    await select("B3");
    await button(name).trigger("click");
    await vi.waitFor(() => {
      expect(server.editTable).toHaveBeenCalledExactlyOnceWith("t1", edit);
    });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("asks before deleting a row or column that holds content, and stops if refused", async () => {
    await render({ A3: "keep me" });
    await select("B3");
    confirm.mockReturnValue(false);

    await button("Delete row").trigger("click");
    expect(confirm).toHaveBeenCalledExactlyOnceWith("Delete row 3 and what it holds?");
    expect(server.editTable).not.toHaveBeenCalled();

    await select("A1");
    await button("Delete column").trigger("click");
    expect(confirm).toHaveBeenLastCalledWith("Delete column A and what it holds?");
    expect(server.editTable).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await button("Delete column").trigger("click");
    await vi.waitFor(() => {
      expect(server.editTable).toHaveBeenCalledOnce();
    });
  });

  it("are hidden from a viewer", async () => {
    await render({}, "viewer");
    await select("B3");
    expect(wrapper.find(".table-card__lines").exists()).toBe(false);
    expect(wrapper.findAll(".table-card__actions button").map((found) => found.text())).toEqual([
      "Export CSV",
    ]);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
  });
});

describe("table actions", () => {
  it("adds a row and a column at the end", async () => {
    await render();
    server.updateTable.mockResolvedValue({ table: TABLE, cells: [], views: [], tables: [] });
    await button("Add row").trigger("click");
    await button("Add column").trigger("click");
    expect(server.updateTable.mock.calls).toEqual([
      ["t1", { rowCount: 5 }],
      ["t1", { colCount: 4 }],
    ]);
  });

  it("deletes the table after confirmation", async () => {
    await render();
    confirm.mockReturnValue(false);
    await button("Delete table").trigger("click");
    expect(server.deleteTable).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await button("Delete table").trigger("click");
    expect(server.deleteTable).toHaveBeenCalledExactlyOnceWith("t1");
  });
});

describe("the menu of row, column, and cell actions", () => {
  async function open(address: string) {
    await render({ A1: "x", B2: "y" });
    await wrapper
      .get(`[data-cell="${address}"]`)
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    return wrapper.get('[role="menu"]');
  }

  function item(name: string) {
    const found = wrapper
      .findAll('[role="menuitem"]')
      .find((candidate) => candidate.text() === name);
    if (!found) throw new Error(`No menu item named ${name}`);
    return found;
  }

  it("opens on a right-click and names the cell it acts on", async () => {
    const menu = await open("B2");
    expect(menu.attributes("aria-label")).toBe("Actions for B2");
    expect(menu.findAll('[role="menuitem"]').map((entry) => entry.text())).toEqual([
      "Insert row above",
      "Insert row below",
      "Delete row 2",
      "Insert column left",
      "Insert column right",
      "Delete column B",
      "Clear cells",
    ]);
  });

  it.each([
    ["Insert row above", { axis: "row", kind: "insert", index: 1 }],
    ["Insert row below", { axis: "row", kind: "insert", index: 2 }],
    ["Insert column left", { axis: "col", kind: "insert", index: 1 }],
    ["Insert column right", { axis: "col", kind: "insert", index: 2 }],
    ["Delete column B", { axis: "col", kind: "delete", index: 1 }],
    ["Delete row 2", { axis: "row", kind: "delete", index: 1 }],
  ])("%s edits the table and closes the menu", async (name, edit) => {
    await open("B2");
    await item(name).trigger("click");
    expect(server.editTable).toHaveBeenCalledWith("t1", edit);
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  it("clears the selected cells", async () => {
    await open("B2");
    await item("Clear cells").trigger("click");
    expect(server.setCells).toHaveBeenCalledWith("t1", [{ row: 1, col: 1, input: "" }]);
  });

  it("closes on Escape and leaves the table alone", async () => {
    const menu = await open("B2");
    await menu.trigger("keydown", { key: "Escape" });
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
    expect(server.editTable).not.toHaveBeenCalled();
  });
});

describe("files", () => {
  /** Chooses a file in the table's file input, as picking one in the browser's dialog does. */
  async function choose(name: string, content: string): Promise<void> {
    const input = wrapper.get<HTMLInputElement>('input[type="file"]');
    Object.defineProperty(input.element, "files", {
      configurable: true,
      value: [new File([content], name, { type: "text/csv" })],
    });
    await input.trigger("change");
    await flushPromises();
  }

  it("exports the values the table shows as CSV, without the empty rows and columns at its end", async () => {
    await render({ A1: "name", B1: "total", A2: "a, b", B2: "=1+2" });
    await button("Export CSV").trigger("click");
    expect(download).toHaveBeenCalledExactlyOnceWith(
      "Table 1.csv",
      'name,total\r\n"a, b",3',
      "text/csv",
    );
  });

  it("imports a CSV file into the table from its first cell", async () => {
    await render();
    await choose("data.csv", 'x,"y, z"\n1,=A2*2\n');
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [
      { row: 0, col: 0, input: "x" },
      { row: 0, col: 1, input: "y, z" },
      { row: 1, col: 0, input: "1" },
      { row: 1, col: 1, input: "=A2*2" },
    ]);
    const store = useWorkbookStore();
    expect(store.valueOf(at("B2"))).toBe(2);
    expect(store.selectedBlock).toEqual({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("grows the table to fit the file", async () => {
    await render();
    server.updateTable.mockResolvedValue({
      table: { ...TABLE, rowCount: 6, colCount: 5 },
      cells: [],
      views: [],
      tables: [],
    });
    await choose("data.csv", Array.from({ length: 6 }, () => "1,2,3,4,5").join("\n"));
    expect(server.updateTable).toHaveBeenCalledExactlyOnceWith("t1", { rowCount: 6, colCount: 5 });
    expect(useWorkbookStore().valueOf({ tableId: "t1", row: 5, col: 4 })).toBe(5);
  });

  it("asks before importing over a table that holds something", async () => {
    await render({ C3: "kept" });
    confirm.mockReturnValue(false);
    await choose("data.csv", "x");
    expect(confirm).toHaveBeenCalledExactlyOnceWith("Import data.csv over what Table 1 holds?");
    expect(server.setCells).not.toHaveBeenCalled();

    confirm.mockReturnValue(true);
    await choose("data.csv", "x");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [{ row: 0, col: 0, input: "x" }]);
    expect(useWorkbookStore().inputOf(at("C3"))).toBe("kept");
  });
});

describe("column names", () => {
  const prompt = vi.spyOn(window, "prompt");
  const COLUMNS = [
    { name: "Price", type: "number" as const },
    { name: "Qty", type: "any" as const },
    { name: "Total", type: "formula" as const, formula: "=[Price] * [Qty]" },
  ];
  const DATA_TABLE = { ...TABLE, columns: COLUMNS };

  async function renderData(): Promise<void> {
    server.getSnapshot.mockResolvedValue({ ...snapshotWith(), tables: [DATA_TABLE] });
    await useWorkbookStore().load("s1");
    wrapper = mount(TableCard, { props: { table: DATA_TABLE }, attachTo: document.body });
    server.updateColumn.mockResolvedValue({ table: DATA_TABLE, cells: [], views: [], tables: [] });
  }

  function item(name: string) {
    const found = wrapper
      .findAll('[role="menuitem"]')
      .find((candidate) => candidate.text() === name);
    if (!found) throw new Error(`No menu item named ${name}`);
    return found;
  }

  it("offers two ways to name the columns of a plain table", async () => {
    await render();
    server.nameColumns.mockResolvedValue({ table: DATA_TABLE, cells: [], views: [], tables: [] });
    await button("Name columns").trigger("click");
    expect(wrapper.get('[role="menu"]').attributes("aria-label")).toBe("Name columns");
    await item("Use the first row as the names").trigger("click");
    expect(server.nameColumns).toHaveBeenCalledExactlyOnceWith("t1", true);

    await button("Name columns").trigger("click");
    await item("Name them Column 1, Column 2, …").trigger("click");
    expect(server.nameColumns).toHaveBeenLastCalledWith("t1", false);
  });

  it("removes the names of a data table after confirming, with a warning about formula columns", async () => {
    await renderData();
    server.dropColumns.mockResolvedValue(TABLE);
    expect(wrapper.findAll("button").some((found) => found.text() === "Name columns")).toBe(false);
    confirm.mockReturnValue(false);
    await button("Remove column names").trigger("click");
    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      "Remove the column names of Table 1? Its formula columns will become empty.",
    );
    expect(server.dropColumns).not.toHaveBeenCalled();
    confirm.mockReturnValue(true);
    await button("Remove column names").trigger("click");
    expect(server.dropColumns).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("lists what a column can hold in the menu, with the current one ticked", async () => {
    await renderData();
    await wrapper.get('[data-cell="A1"]').trigger("contextmenu");
    const labels = wrapper.findAll('[role="menuitem"]').map((found) => found.text());
    expect(labels.filter((label) => label.includes("Column holds"))).toEqual([
      "Column holds: Anything",
      "Column holds: Text",
      "✓ Column holds: Number",
      "Column holds: Date",
      "Column holds: Checkbox",
      "Column holds: A formula…",
    ]);
    await item("Column holds: Date").trigger("click");
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", 0, { type: "date" });
  });

  it("asks for the formula of a formula column, starting from the one it has", async () => {
    await renderData();
    await wrapper.get('[data-cell="C1"]').trigger("contextmenu");
    prompt.mockReturnValue("=[Price] + 1");
    await item("✓ Column holds: A formula…").trigger("click");
    expect(prompt.mock.calls[0]?.[1]).toBe("=[Price] * [Qty]");
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", 2, {
      type: "formula",
      formula: "=[Price] + 1",
    });
  });

  it.each([null, "", " = "])(
    "leaves the column alone when the formula prompt gives %j",
    async (answer) => {
      await renderData();
      await wrapper.get('[data-cell="B1"]').trigger("contextmenu");
      prompt.mockReturnValue(answer);
      await item("Column holds: A formula…").trigger("click");
      expect(server.updateColumn).not.toHaveBeenCalled();
    },
  );

  it("has no column items in the menu of a plain table", async () => {
    await render();
    await wrapper.get('[data-cell="A1"]').trigger("contextmenu");
    const labels = wrapper.findAll('[role="menuitem"]').map((found) => found.text());
    expect(labels.some((label) => label.includes("Column holds"))).toBe(false);
  });
});
