import { wireSnapshot, changeWith } from "../testing";
import { expectedEdit } from "../testing";
import { sizedTable } from "../testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { download } from "../files/download";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, TABLE, type MockedApi } from "../testing";
import TableCard from "./TableCard.vue";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
vi.mock("../files/download", () => ({
  download: vi.fn(),
  fileName: (name: string, extension: string) => `${name}.${extension}`,
}));
const server = api as unknown as MockedApi;

let wrapper: VueWrapper;
const confirm = vi.spyOn(window, "confirm");

async function render(inputs: Record<string, string> = {}, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith(inputs, role)));
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
  server.editTable.mockResolvedValue(
    changeWith({ table: TABLE, cells: [], views: [], tables: [] }),
  );
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
    ["Insert row above", { axis: "row", kind: "insert", index: 2, count: 1 }],
    ["Delete row", { axis: "row", kind: "delete", index: 2, count: 1 }],
    ["Insert column left", { axis: "col", kind: "insert", index: 1, count: 1 }],
    ["Delete column", { axis: "col", kind: "delete", index: 1, count: 1 }],
  ])("%s edits the selected cell's row or column", async (name, edit) => {
    await render();
    await select("B3");
    await button(name).trigger("click");
    await vi.waitFor(() => {
      expect(server.editTable).toHaveBeenCalledExactlyOnceWith("t1", expectedEdit(edit));
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
  it("adds a row from the strip under the grid, and a column from the strip beside it", async () => {
    await render();
    server.updateTable.mockResolvedValue(
      changeWith({ table: TABLE, cells: [], views: [], tables: [] }),
    );
    server.editTable.mockResolvedValue(changeWith());
    await wrapper.get('button[aria-label="Add row"]').trigger("click");
    await wrapper.get('button[aria-label="Add column"]').trigger("click");
    await vi.waitFor(() => {
      expect(server.updateTable).toHaveBeenCalledExactlyOnceWith("t1", { colCount: 4 });
      expect(server.editTable).toHaveBeenCalledExactlyOnceWith("t1", {
        axis: "row",
        kind: "insert",
        beforeId: null,
        ids: [expect.any(String)],
      });
    });
  });

  it("has no strips for a viewer", async () => {
    await render({}, "viewer");
    expect(wrapper.find(".table-card__grow").exists()).toBe(false);
  });

  async function resizeTo(columns: string, rows: string): Promise<void> {
    await button("Resize").trigger("click");
    const form = wrapper.get('[role="dialog"]');
    const [colCount, rowCount] = form.findAll("input");
    await colCount!.setValue(columns);
    await rowCount!.setValue(rows);
    await form.trigger("submit");
  }

  it("sets the size of the table from a form that starts at its size", async () => {
    await render();
    server.updateTable.mockResolvedValue(
      changeWith({ table: TABLE, cells: [], views: [], tables: [] }),
    );
    await button("Resize").trigger("click");
    const form = wrapper.get('[role="dialog"]');
    expect(form.attributes("aria-label")).toBe("Resize Table 1");
    expect(form.findAll("input").map((input) => input.element.value)).toEqual(["3", "4"]);

    await form.findAll("input")[0]!.setValue("6");
    await form.findAll("input")[1]!.setValue("10");
    await form.trigger("submit");
    await vi.waitFor(() => {
      expect(server.updateTable).toHaveBeenCalledExactlyOnceWith("t1", {
        rowCount: 10,
        colCount: 6,
      });
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("asks before a smaller size discards content, and keeps the form open if refused", async () => {
    await render({ A1: "kept", C4: "would go" });
    server.updateTable.mockResolvedValue(
      changeWith({ table: TABLE, cells: [], views: [], tables: [] }),
    );
    confirm.mockReturnValue(false);
    await resizeTo("2", "4");
    expect(confirm).toHaveBeenCalledExactlyOnceWith(
      "Resizing Table 1 to 2 columns and 4 rows deletes what its other rows and columns hold. Resize it?",
    );
    expect(server.updateTable).not.toHaveBeenCalled();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    confirm.mockReturnValue(true);
    await wrapper.get('[role="dialog"]').trigger("submit");
    await vi.waitFor(() => {
      expect(server.updateTable).toHaveBeenCalledExactlyOnceWith("t1", {
        rowCount: 4,
        colCount: 2,
      });
    });
  });

  it("does not ask when the rows and columns that go are empty", async () => {
    await render({ A1: "kept", B2: "kept" });
    server.updateTable.mockResolvedValue(
      changeWith({ table: TABLE, cells: [], views: [], tables: [] }),
    );
    await resizeTo("2", "2");
    expect(confirm).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(server.updateTable).toHaveBeenCalledOnce();
    });
  });

  it("refuses a size a table cannot have, and sends nothing for the size it has", async () => {
    await render();
    await button("Resize").trigger("click");
    const form = wrapper.get('[role="dialog"]');
    const submit = form.get('button[type="submit"]');
    for (const bad of ["0", "101", "2.5", ""]) {
      await form.findAll("input")[0]!.setValue(bad);
      expect(submit.attributes("disabled")).toBeDefined();
    }
    await form.findAll("input")[0]!.setValue("3");
    await form.trigger("submit");
    expect(server.updateTable).not.toHaveBeenCalled();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("closes the resize form on Escape, Cancel, or a press outside it", async () => {
    await render();
    for (const close of [
      () => wrapper.get('[role="dialog"]').trigger("keydown", { key: "Escape" }),
      () => button("Cancel").trigger("click"),
      () => wrapper.get(".grid").trigger("mousedown"),
    ]) {
      await button("Resize").trigger("click");
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true);
      await close();
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
    }
    expect(server.updateTable).not.toHaveBeenCalled();
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
      "Name this range…",
      "Clear cells",
    ]);
  });

  it.each([
    ["Insert row above", { axis: "row", kind: "insert", index: 1, count: 1 }],
    ["Insert row below", { axis: "row", kind: "insert", index: 2, count: 1 }],
    ["Insert column left", { axis: "col", kind: "insert", index: 1, count: 1 }],
    ["Insert column right", { axis: "col", kind: "insert", index: 2, count: 1 }],
    ["Delete column B", { axis: "col", kind: "delete", index: 1, count: 1 }],
    ["Delete row 2", { axis: "row", kind: "delete", index: 1, count: 1 }],
  ])("%s edits the table and closes the menu", async (name, edit) => {
    await open("B2");
    await item(name).trigger("click");
    expect(server.editTable).toHaveBeenCalledWith("t1", expectedEdit(edit));
    expect(wrapper.find('[role="menu"]').exists()).toBe(false);
  });

  const labels = (): string[] => wrapper.findAll('[role="menuitem"]').map((entry) => entry.text());

  /** Opens the menu on `address` with the cells from `from` to `to` selected. */
  async function openOnRange(from: string, to: string, address = to) {
    await render({ A1: "x", B2: "y" });
    await wrapper.get(`[data-cell="${from}"]`).trigger("mousedown");
    await wrapper.get(`[data-cell="${to}"]`).trigger("mousedown", { shiftKey: true });
    await wrapper.get(`[data-cell="${address}"]`).trigger("contextmenu");
    return wrapper.get('[role="menu"]');
  }

  it("acts on every row and column of a selected range, and says how many", async () => {
    const menu = await openOnRange("B2", "C4");
    expect(menu.attributes("aria-label")).toBe("Actions for B2:C4");
    expect(labels()).toEqual([
      "Insert 3 rows above",
      "Insert 3 rows below",
      "Delete rows 2-4",
      "Insert 2 columns left",
      "Insert 2 columns right",
      "Delete columns B-C",
      "Name this range…",
      "Clear cells",
    ]);
  });

  it.each([
    ["Insert 3 rows above", { axis: "row", kind: "insert", index: 1, count: 3 }],
    ["Insert 3 rows below", { axis: "row", kind: "insert", index: 4, count: 3 }],
    ["Delete rows 2-4", { axis: "row", kind: "delete", index: 1, count: 3 }],
    ["Insert 2 columns left", { axis: "col", kind: "insert", index: 1, count: 2 }],
    ["Insert 2 columns right", { axis: "col", kind: "insert", index: 3, count: 2 }],
    ["Delete columns B-C", { axis: "col", kind: "delete", index: 1, count: 2 }],
  ])("%s edits that many rows or columns in one request", async (name, edit) => {
    await openOnRange("C4", "B2", "B3");
    await item(name).trigger("click");
    expect(server.editTable).toHaveBeenCalledExactlyOnceWith("t1", expectedEdit(edit));
  });

  it("asks before deleting several rows or columns when one of them holds content", async () => {
    await openOnRange("B2", "C4");
    confirm.mockReturnValue(false);
    await item("Delete columns B-C").trigger("click");
    expect(confirm).toHaveBeenCalledExactlyOnceWith("Delete columns B-C and what they hold?");
    expect(server.editTable).not.toHaveBeenCalled();
  });

  it("does not offer to delete every row or every column", async () => {
    await openOnRange("A1", "C4");
    expect(item("Delete rows 1-4").attributes("disabled")).toBeDefined();
    expect(item("Delete columns A-C").attributes("disabled")).toBeDefined();
    expect(item("Insert 4 rows above").attributes("disabled")).toBeUndefined();
  });

  it("has only column actions when opened from a column header, and only row actions from a row header", async () => {
    await render();
    await wrapper.findAll("thead th")[2]!.trigger("contextmenu");
    expect(labels()).toEqual([
      "Insert column left",
      "Insert column right",
      "Delete column B",
      "Clear cells",
    ]);
    await wrapper.get('[role="menu"]').trigger("keydown", { key: "Escape" });

    await wrapper.findAll("tbody th")[2]!.trigger("contextmenu");
    expect(labels()).toEqual([
      "Insert row above",
      "Insert row below",
      "Delete row 3",
      "Clear cells",
    ]);
  });

  it("acts on every column selected by dragging over the headers", async () => {
    await render();
    const headers = wrapper.findAll("thead th");
    await headers[2]!.trigger("mousedown");
    await headers[3]!.trigger("mouseenter");
    window.dispatchEvent(new MouseEvent("mouseup"));
    await headers[3]!.trigger("contextmenu");
    expect(wrapper.get('[role="menu"]').attributes("aria-label")).toBe("Actions for B1:C4");
    expect(labels()).toEqual([
      "Insert 2 columns left",
      "Insert 2 columns right",
      "Delete columns B-C",
      "Clear cells",
    ]);
  });

  it("clears the selected cells", async () => {
    await open("B2");
    await item("Clear cells").trigger("click");
    expect(server.setCells).toHaveBeenCalledWith(
      "t1",
      [{ rowId: "r1", colId: "c2", input: "" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
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
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [
        { rowId: "r0", colId: "c1", input: "x" },
        { rowId: "r0", colId: "c2", input: "y, z" },
        { rowId: "r1", colId: "c1", input: "1" },
        { rowId: "r1", colId: "c2", input: "=A2*2" },
      ],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
    const store = useWorkbookStore();
    expect(store.valueOf(at("B2"))).toBe(2);
    expect(store.selectedRange).toEqual({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("grows the table to fit the file", async () => {
    await render();
    server.updateTable.mockResolvedValue(
      changeWith({
        table: sizedTable({ colCount: 5 }),
        cells: [],
        views: [],
        tables: [],
      }),
    );
    await choose("data.csv", Array.from({ length: 6 }, () => "1,2,3,4,5").join("\n"));
    expect(server.updateTable).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { colCount: 5 },
      expect.any(String),
    );
    expect(server.updateTable.mock.calls[0]?.[2]).toBe(server.setCells.mock.calls[0]?.[2]);
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
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ rowId: "r0", colId: "c1", input: "x" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
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
    server.getSnapshot.mockResolvedValue(wireSnapshot({ ...snapshotWith(), tables: [DATA_TABLE] }));
    await useWorkbookStore().load("s1");
    wrapper = mount(TableCard, { props: { table: DATA_TABLE }, attachTo: document.body });
    server.updateColumn.mockResolvedValue(
      changeWith({ table: DATA_TABLE, cells: [], views: [], tables: [] }),
    );
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
    server.nameColumns.mockResolvedValue(
      changeWith({ table: DATA_TABLE, cells: [], views: [], tables: [] }),
    );
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
    server.dropColumns.mockResolvedValue(changeWith(TABLE));
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
      "Column holds: A choice…",
      "Column holds: A formula…",
    ]);
    await item("Column holds: Date").trigger("click");
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c1", {
      revision: expect.any(Number),
      type: "date",
    });
  });

  it("asks for the formula of a formula column, starting from the one it has", async () => {
    await renderData();
    await wrapper.get('[data-cell="C1"]').trigger("contextmenu");
    prompt.mockReturnValue("=[Price] + 1");
    await item("✓ Column holds: A formula…").trigger("click");
    expect(prompt.mock.calls[0]?.[1]).toBe("=[Price] * [Qty]");
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c3", {
      revision: expect.any(Number),
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

it("sends distinct row insertions for rapid clicks on Add row", async () => {
  await render();
  server.editTable.mockImplementation(() => Promise.resolve(changeWith()));
  const button = wrapper.get('button[aria-label="Add row"]');
  await button.trigger("click");
  await button.trigger("click");
  await flushPromises();
  expect(server.editTable).toHaveBeenCalledTimes(2);
  const requests = server.editTable.mock.calls.map((call) => call[1]);
  expect(requests[0]).toMatchObject({ kind: "insert", beforeId: null });
  expect(requests[1]).toMatchObject({ kind: "insert", beforeId: null });
  expect(requests[0]?.ids[0]).not.toBe(requests[1]?.ids[0]);
});

describe("sorting and filtering a data table", () => {
  const SORTED_TABLE = {
    ...TABLE,
    columns: [
      { name: "Item", type: "any" as const },
      { name: "Qty", type: "number" as const },
      { name: "Note", type: "text" as const },
    ],
    display: { sort: [{ colId: "c2", descending: true }], filter: "=[Qty] > 1" },
  };

  async function renderSorted(role = "owner"): Promise<void> {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith({ A1: "a", B1: "1", A2: "b", B2: "2", A3: "c", B3: "3" }, role),
        tables: [SORTED_TABLE],
      }),
    );
    await useWorkbookStore().load("s1");
    wrapper = mount(TableCard, { props: { table: SORTED_TABLE }, attachTo: document.body });
    server.setTableDisplay.mockResolvedValue(changeWith());
  }

  const bar = () => wrapper.get('[role="group"][aria-label="Sort and filter Table 1"]');

  it("is not offered for a plain table", async () => {
    await render();
    expect(wrapper.find('[aria-label="Table filter"]').exists()).toBe(false);
  });

  it("shows the sort keys, the filter, and how many rows the filter hides", async () => {
    await renderSorted();
    expect(bar().get<HTMLInputElement>('[aria-label="Table filter"]').element.value).toBe(
      "=[Qty] > 1",
    );
    expect(bar().get<HTMLSelectElement>('[aria-label="Sort column 1"]').element.value).toBe("c2");
    expect(bar().get<HTMLSelectElement>('[aria-label="Sort direction 1"]').element.value).toBe(
      "descending",
    );
    expect(bar().text()).toContain("2 rows hidden");
  });

  it("saves a changed filter with the revision it was started at", async () => {
    await renderSorted();
    const input = bar().get('[aria-label="Table filter"]');
    const written = useWorkbookStore().revision;
    await input.trigger("focus");
    await input.setValue("=[Qty] > 2");
    await input.trigger("keydown", { key: "Enter" });
    await input.trigger("blur");
    expect(server.setTableDisplay).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { sort: [{ colId: "c2", descending: true }], filter: "=[Qty] > 2" },
      written,
    );
  });

  it("clears the filter and keeps the sort", async () => {
    await renderSorted();
    await button("Clear filter").trigger("click");
    expect(server.setTableDisplay).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { sort: [{ colId: "c2", descending: true }] },
      expect.any(Number),
    );
  });

  it("changes the direction of a key, adds one, and removes one, keeping the filter", async () => {
    await renderSorted();
    await bar().get('[aria-label="Sort direction 1"]').setValue("ascending");
    await flushPromises();
    expect(server.setTableDisplay).toHaveBeenLastCalledWith(
      "t1",
      { sort: [{ colId: "c2", descending: false }], filter: "=[Qty] > 1" },
      expect.any(Number),
    );
    await button("Add sort").trigger("click");
    await flushPromises();
    expect(server.setTableDisplay).toHaveBeenLastCalledWith(
      "t1",
      {
        sort: [
          { colId: "c2", descending: true },
          { colId: "c1", descending: false },
        ],
        filter: "=[Qty] > 1",
      },
      expect.any(Number),
    );
    await bar().get('[aria-label="Remove sort by Qty"]').trigger("click");
    await flushPromises();
    expect(server.setTableDisplay).toHaveBeenLastCalledWith(
      "t1",
      { sort: [], filter: "=[Qty] > 1" },
      expect.any(Number),
    );
  });

  it("sorts from a column's menu", async () => {
    await renderSorted();
    await wrapper.get('[data-cell="C3"]').trigger("contextmenu");
    const item = (name: string) =>
      wrapper.findAll('[role="menuitem"]').find((found) => found.text() === name)!;
    await item("Sort ascending").trigger("click");
    expect(server.setTableDisplay).toHaveBeenLastCalledWith(
      "t1",
      { sort: [{ colId: "c3", descending: false }], filter: "=[Qty] > 1" },
      expect.any(Number),
    );
    await wrapper.get('[data-cell="C3"]').trigger("contextmenu");
    await item("Clear sort").trigger("click");
    expect(server.setTableDisplay).toHaveBeenLastCalledWith(
      "t1",
      { sort: [], filter: "=[Qty] > 1" },
      expect.any(Number),
    );
  });

  it("refuses to insert a row above or below while the table is sorted, and still adds one at the end", async () => {
    await renderSorted();
    await select("A3");
    expect(button("Insert row above").element.disabled).toBe(true);
    await wrapper.get('[data-cell="A3"]').trigger("contextmenu");
    const items = wrapper.findAll('[role="menuitem"]');
    expect(
      items.find((found) => found.text() === "Insert row above")?.attributes("disabled"),
    ).toBeDefined();
    expect(
      items.find((found) => found.text() === "Insert row below")?.attributes("disabled"),
    ).toBeDefined();
    server.editTable.mockResolvedValue(changeWith());
    await wrapper.get('button[aria-label="Add row"]').trigger("click");
    expect(server.editTable).toHaveBeenCalledOnce();
  });

  it("deletes the row selected, which is the stored row it shows", async () => {
    await renderSorted();
    // Sorted by Qty descending with Qty > 1 shown: stored rows 2 and 1.
    await select("A3");
    server.editTable.mockResolvedValue(changeWith());
    await button("Delete row").trigger("click");
    expect(server.editTable).toHaveBeenCalledExactlyOnceWith("t1", {
      axis: "row",
      kind: "delete",
      ids: ["r2"],
    });
  });

  it("shows a viewer what is sorted and filtered without the means to change it", async () => {
    await renderSorted("viewer");
    expect(bar().get('[aria-label="Table filter"]').attributes("disabled")).toBeDefined();
    expect(bar().findAll("button")).toHaveLength(0);
  });

  it("keeps a filter typed just before a sort is added", async () => {
    await renderSorted();
    await button("Clear filter").trigger("click");
    await flushPromises();
    const input = bar().get('[aria-label="Table filter"]');
    await input.trigger("focus");
    await input.setValue("=[Qty] > 3");
    await input.trigger("blur");
    await button("Add sort").trigger("click");
    await flushPromises();
    expect(server.setTableDisplay).toHaveBeenLastCalledWith(
      "t1",
      {
        sort: [
          { colId: "c2", descending: true },
          { colId: "c1", descending: false },
        ],
        filter: "=[Qty] > 3",
      },
      expect.any(Number),
    );
  });
});

describe("dropdown columns", () => {
  const SOURCE = {
    ...TABLE,
    id: "t2",
    name: "Races",
    colIds: ["d1", "d2", "d3"],
    columns: [
      { name: "Race Name", type: "text" as const },
      { name: "Payout", type: "number" as const },
      { name: "Note", type: "any" as const },
    ],
  };
  const DATA = {
    ...TABLE,
    columns: [
      { name: "Race", type: "any" as const },
      { name: "Kind", type: "any" as const },
      { name: "Other", type: "any" as const },
    ],
  };

  async function renderChoices(): Promise<void> {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({ ...snapshotWith(), tables: [DATA, SOURCE] }),
    );
    await useWorkbookStore().load("s1");
    wrapper = mount(TableCard, { props: { table: DATA }, attachTo: document.body });
    server.updateColumn.mockResolvedValue(changeWith());
    await wrapper.get('[data-cell="A1"]').trigger("contextmenu");
    await wrapper
      .findAll('[role="menuitem"]')
      .find((found) => found.text() === "Column holds: A choice…")!
      .trigger("click");
  }

  it("opens a panel from the column menu and saves a list, one choice on each line", async () => {
    await renderChoices();
    const panel = wrapper.get('form[aria-label="Choices for Race"]');
    await panel.get("textarea").setValue(" Trial \n\nSprint\n");
    await panel.trigger("submit");
    await flushPromises();
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c1", {
      type: "choice",
      choices: ["Trial", "Sprint"],
      revision: expect.any(Number),
    });
    expect(wrapper.find("form.choices-panel").exists()).toBe(false);
  });

  it("saves a column of a data table as the source", async () => {
    await renderChoices();
    const panel = wrapper.get("form.choices-panel");
    await panel.get('input[value="column"]').setValue(true);
    await panel.get('select[aria-label="Table to take choices from"]').setValue("t2");
    await panel.get('select[aria-label="Column to take choices from"]').setValue("d1");
    await panel.trigger("submit");
    await flushPromises();
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c1", {
      type: "choice",
      choicesFrom: { tableId: "t2", colId: "d1" },
      revision: expect.any(Number),
    });
  });

  it("saves nothing for an empty list, and closes on Cancel", async () => {
    await renderChoices();
    const save = wrapper.get<HTMLButtonElement>('form.choices-panel button[type="submit"]');
    expect(save.element.disabled).toBe(true);
    await wrapper.get("form.choices-panel").trigger("submit");
    expect(server.updateColumn).not.toHaveBeenCalled();
    await button("Cancel").trigger("click");
    expect(wrapper.find("form.choices-panel").exists()).toBe(false);
  });
});
