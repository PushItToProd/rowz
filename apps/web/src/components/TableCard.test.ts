import { wireSnapshot, changeWith } from "../testing";
import { expectedEdit } from "../testing";
import { sizedTable } from "../testing";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { LIMITS } from "@spreadsheet-app/shared";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type TableRecord } from "../api/client";
import { download } from "../files/download";
import { useWorkbookStore } from "../stores/workbook";
import {
  appDialog,
  at,
  mountDialogHost,
  notifyJournaled,
  respondToDialog,
  savedCells,
  snapshotWith,
  TABLE,
  type MockedApi,
} from "../testing";
import { EditorView } from "@codemirror/view";
import { useFormulaSessionStore } from "../formula/session";
import FormulaBar from "./FormulaBar.vue";
import FormulaSessionHost from "./FormulaSessionHost.vue";
import { undo } from "@codemirror/commands";
import { bodyFindAll, bodyGet, bodyHas } from "../testing/teleported";
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
let dialogHost: VueWrapper;

async function render(inputs: Record<string, string> = {}, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith(inputs, role)));
  await useWorkbookStore().load("s1");
  wrapper = mount(TableCard, {
    props: { table: TABLE },
    attachTo: document.body,
  });
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
  dialogHost = mountDialogHost();
  server.editTable.mockResolvedValue(
    changeWith({ table: TABLE, cells: [], views: [], tables: [] }),
  );
});
afterEach(() => {
  wrapper.unmount();
  dialogHost.unmount();
});

describe("row and column actions", () => {
  it("freezes up to a row or column from its header menu", async () => {
    await render();
    server.updateTable.mockResolvedValue(changeWith());

    await wrapper.findAll("tbody th")[1]!.trigger("contextmenu");
    await bodyFindAll('[role="menuitem"]')
      .find((item) => item.text() === "Freeze up to this row")!
      .trigger("click");
    expect(server.updateTable).toHaveBeenLastCalledWith("t1", { freezeRows: 2 });

    await wrapper.findAll("thead th")[1]!.trigger("contextmenu");
    await bodyFindAll('[role="menuitem"]')
      .find((item) => item.text() === "Freeze up to this column")!
      .trigger("click");
    expect(server.updateTable).toHaveBeenLastCalledWith("t1", { freezeColumns: 1 });
  });

  it("sets freeze counts from the table action menu", async () => {
    await render();
    server.updateTable.mockResolvedValue(changeWith());
    await button("Freeze").trigger("click");

    const settings = wrapper.get('form[aria-label="Freeze Table 1"]');
    const fields = settings.findAll("input");
    await fields[0]!.setValue("2");
    await fields[1]!.setValue("1");
    await settings.trigger("submit");
    await flushPromises();

    expect(server.updateTable).toHaveBeenCalledExactlyOnceWith("t1", {
      freezeRows: 2,
      freezeColumns: 1,
    });
    expect(wrapper.find('form[aria-label="Freeze Table 1"]').exists()).toBe(false);
  });

  it.each([
    ["col", "column", "thead th", 2, 3, ["c2", "c3"]],
    ["row", "row", "tbody th", 1, 2, ["r1", "r2"]],
  ] as const)(
    "resizes all selected %s identities from the header menu",
    async (axis, noun, selector, first, last, ids) => {
      await render();
      server.resizeLines.mockResolvedValue(changeWith());
      const headers = wrapper.findAll(selector);
      await headers[first]!.trigger("mousedown");
      await headers[last]!.trigger("mouseenter");
      window.dispatchEvent(new MouseEvent("mouseup"));
      await headers[last]!.trigger("contextmenu");
      await bodyFindAll('[role="menuitem"]')
        .find((item) => item.text() === `Resize ${noun}`)!
        .trigger("click");
      const form = wrapper.get(`form[aria-label="Resize ${noun}"]`);
      await form.get("input").setValue("170");
      await form.trigger("submit");
      await flushPromises();
      expect(server.resizeLines).toHaveBeenCalledExactlyOnceWith("t1", {
        axis,
        ids: [...ids],
        size: 170,
      });
      expect(wrapper.find(".resize-lines").exists()).toBe(false);
    },
  );

  it("validates the size input, cancels without saving, and resets to default", async () => {
    await render();
    server.resizeLines.mockResolvedValue(changeWith());
    async function open() {
      await wrapper.findAll("thead th")[1]!.trigger("contextmenu");
      await bodyFindAll('[role="menuitem"]')
        .find((item) => item.text() === "Resize column")!
        .trigger("click");
      return wrapper.get('form[aria-label="Resize column"]');
    }
    let form = await open();
    await form.get("input").setValue("10");
    expect(form.get('button[type="submit"]').attributes("disabled")).toBeDefined();
    await form.trigger("submit");
    expect(server.resizeLines).not.toHaveBeenCalled();
    await form.trigger("keydown", { key: "Escape" });
    expect(wrapper.find(".resize-lines").exists()).toBe(false);
    form = await open();
    await form
      .findAll("button")
      .find((button) => button.text() === "Reset to default")!
      .trigger("click");
    await flushPromises();
    expect(server.resizeLines).toHaveBeenCalledExactlyOnceWith("t1", {
      axis: "col",
      ids: ["c1"],
      size: null,
    });
  });

  it("show row and column actions after a cell is selected, and name its row and column", async () => {
    await render();
    expect(wrapper.get(".table-card__lines").text()).toBe("");

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
    expect(appDialog()).toBeNull();
  });

  it("deletes a row or column that holds content without asking and offers undo", async () => {
    await render({ A3: "keep me" });
    await select("B3");

    await button("Delete row").trigger("click");
    await flushPromises();
    expect(appDialog()).toBeNull();
    expect(server.editTable).toHaveBeenCalledOnce();
    expect(useWorkbookStore().notice).toMatchObject({
      kind: "success",
      text: "Deleted row 3",
      action: { label: "Undo" },
    });

    server.editTable.mockClear();
    await select("A1");
    await button("Delete column").trigger("click");
    await flushPromises();
    expect(appDialog()).toBeNull();
    expect(server.editTable).toHaveBeenCalledOnce();
    expect(useWorkbookStore().notice).toMatchObject({
      kind: "success",
      text: "Deleted column A",
      action: { label: "Undo" },
    });
  });

  it("dismisses the delete Undo notice after a later cell edit", async () => {
    await render();
    await select("A3");
    server.editTable.mockImplementationOnce(() => {
      notifyJournaled();
      return Promise.resolve(
        changeWith({
          table: { ...TABLE, rowCount: 3, rows: TABLE.rows.filter((row) => row.id !== "r2") },
        }),
      );
    });

    await button("Delete row").trigger("click");
    await flushPromises();
    expect(useWorkbookStore().notice?.action).toMatchObject({ label: "Undo" });

    server.setCells.mockImplementationOnce((...args) => {
      notifyJournaled();
      return savedCells(...args);
    });
    await useWorkbookStore().setCell(at("A1"), "edited");

    expect(useWorkbookStore().notice).toBeNull();
  });

  it("are hidden from a viewer", async () => {
    await render({}, "viewer");
    await select("B3");
    expect(wrapper.find(".table-card__lines").exists()).toBe(false);
    expect(wrapper.findAll(".table-card__actions button").map((found) => found.text())).toEqual([
      "Export CSV",
      "⋮",
    ]);
    expect(wrapper.find('button[aria-label="Block actions for Table 1"]').exists()).toBe(true);
    expect(wrapper.find('input[type="file"]').exists()).toBe(false);
  });
});

describe("table side panes", () => {
  it("shows one table side pane at a time", async () => {
    await render();
    await button("Names").trigger("click");
    expect(wrapper.find('[aria-label="Names in Table 1"]').exists()).toBe(true);

    await button("Conditional formats").trigger("click");
    expect(wrapper.find('[aria-label="Names in Table 1"]').exists()).toBe(false);
    expect(wrapper.find('[aria-label="Conditional formats of Table 1"]').exists()).toBe(true);
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
    expect(appDialog()).toBeNull();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false);
  });

  it("asks before a smaller size discards content, and keeps the form open if refused", async () => {
    await render({ A1: "kept", C4: "would go" });
    server.updateTable.mockResolvedValue(
      changeWith({ table: TABLE, cells: [], views: [], tables: [] }),
    );
    await resizeTo("2", "4");
    expect(appDialog()?.textContent).toContain(
      "Resizing Table 1 to 2 columns and 4 rows deletes content beyond the new size. Resize it?",
    );
    expect(server.updateTable).not.toHaveBeenCalled();
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true);

    await respondToDialog("cancel");
    await wrapper.get('[role="dialog"]').trigger("submit");
    await respondToDialog("confirm");
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
    expect(appDialog()).toBeNull();
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
    await button("Delete table").trigger("click");
    await respondToDialog("cancel");
    expect(server.deleteTable).not.toHaveBeenCalled();

    await button("Delete table").trigger("click");
    await respondToDialog("confirm");
    expect(server.deleteTable).toHaveBeenCalledExactlyOnceWith("t1");
  });
});

describe("the menu of row, column, and cell actions", () => {
  async function open(address: string) {
    await render({ A1: "x", B2: "y" });
    await wrapper
      .get(`[data-cell="${address}"]`)
      .trigger("contextmenu", { clientX: 10, clientY: 20 });
    return bodyGet('[role="menu"]');
  }

  function item(name: string) {
    const found = bodyFindAll('[role="menuitem"]').find((candidate) => candidate.text() === name);
    if (!found) throw new Error(`No menu item named ${name}`);
    return found;
  }

  it("opens on a right-click and names the cell it acts on", async () => {
    const menu = await open("B2");
    expect(menu.attributes("aria-label")).toBe("Actions for B2");
    expect(menu.findAll('[role="menuitem"]').map((entry) => entry.text())).toEqual([
      "Copy link to this cell",
      "Insert row above",
      "Insert row below",
      "Delete row 2",
      "Insert column left",
      "Insert column right",
      "Delete column B",
      "Wrap text",
      "Add conditional format…",
      "Name this range…",
      "Clear cells",
    ]);
  });

  it("marks deleted rows, columns, and cell contents as dangerous", async () => {
    await open("B2");

    for (const name of ["Delete row 2", "Delete column B", "Clear cells"]) {
      expect(item(name).classes()).toContain("danger");
    }
  });

  it("copies a link using the selected cell's stable row and column IDs", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    try {
      await open("B2");
      await item("Copy link to this cell").trigger("click");
      await flushPromises();

      expect(writeText).toHaveBeenCalledExactlyOnceWith(
        new URL("/s/s1/p/p1#cell=t1.r1.c2", window.location.href).href,
      );
      expect(useWorkbookStore().notice).toEqual({ kind: "success", text: "Copied" });
    } finally {
      if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
      else Reflect.deleteProperty(navigator, "clipboard");
    }
  });

  it("offers the cell link action to a viewer", async () => {
    await render({}, "viewer");
    const cell = wrapper.get('[data-cell="A1"]');
    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    cell.element.dispatchEvent(event);
    await flushPromises();

    expect(event.defaultPrevented).toBe(true);
    expect(bodyFindAll('[role="menuitem"]').map((entry) => entry.text())).toEqual([
      "Copy link to this cell",
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
    expect(bodyHas('[role="menu"]')).toBe(false);
  });

  const labels = (): string[] => bodyFindAll('[role="menuitem"]').map((entry) => entry.text());

  /** Opens the menu on `address` with the cells from `from` to `to` selected. */
  async function openOnRange(from: string, to: string, address = to) {
    await render({ A1: "x", B2: "y" });
    await wrapper.get(`[data-cell="${from}"]`).trigger("mousedown");
    await wrapper.get(`[data-cell="${to}"]`).trigger("mousedown", { shiftKey: true });
    await wrapper.get(`[data-cell="${address}"]`).trigger("contextmenu");
    return bodyGet('[role="menu"]');
  }

  it("acts on every row and column of a selected range, and says how many", async () => {
    const menu = await openOnRange("B2", "C4");
    expect(menu.attributes("aria-label")).toBe("Actions for B2:C4");
    expect(labels()).toEqual([
      "Copy link to this cell",
      "Insert 3 rows above",
      "Insert 3 rows below",
      "Delete rows 2-4",
      "Insert 2 columns left",
      "Insert 2 columns right",
      "Delete columns B-C",
      "Wrap text",
      "Add conditional format…",
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

  it("applies wrap text to the selected range from its context menu", async () => {
    await openOnRange("B2", "C4");
    server.formatCells.mockResolvedValue(changeWith());
    await item("Wrap text").trigger("click");
    await flushPromises();
    expect(server.formatCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { startRowId: "r1", endRowId: "r3", startColId: "c2", endColId: "c3" },
      { wrap: true },
      false,
    );
  });

  it("opens conditional formats for the selected range and focuses the criterion", async () => {
    await openOnRange("B2", "C4");
    await item("Add conditional format…").trigger("click");
    await flushPromises();

    expect(wrapper.find('[aria-label="Conditional formats of Table 1"]').exists()).toBe(true);
    expect(wrapper.get(".conditional-panel__add p").text()).toBe("Applies to B2:C4.");
    expect(document.activeElement).toBe(wrapper.get('[aria-label="Criterion"]').element);
    expect(bodyHas('[role="menu"]')).toBe(false);
  });

  it("deletes selected rows and columns with content without asking and offers undo", async () => {
    await openOnRange("B2", "C4");
    await item("Delete rows 2-4").trigger("click");
    await flushPromises();
    expect(appDialog()).toBeNull();
    expect(server.editTable).toHaveBeenCalledOnce();
    expect(useWorkbookStore().notice).toMatchObject({
      kind: "success",
      text: "Deleted rows 2-4",
      action: { label: "Undo" },
    });

    await wrapper.get('[data-cell="C4"]').trigger("contextmenu");
    await item("Delete columns B-C").trigger("click");
    await flushPromises();
    expect(appDialog()).toBeNull();
    expect(server.editTable).toHaveBeenCalledTimes(2);
    expect(useWorkbookStore().notice).toMatchObject({
      kind: "success",
      text: "Deleted columns B-C",
      action: { label: "Undo" },
    });
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
      "Freeze up to this column",
      "Resize column",
      "Insert column left",
      "Insert column right",
      "Delete column B",
      "Wrap text",
      "Add conditional format…",
      "Clear cells",
    ]);
    await bodyGet('[role="menu"]').trigger("keydown", { key: "Escape" });

    await wrapper.findAll("tbody th")[2]!.trigger("contextmenu");
    expect(labels()).toEqual([
      "Freeze up to this row",
      "Resize row",
      "Insert row above",
      "Insert row below",
      "Delete row 3",
      "Wrap text",
      "Add conditional format…",
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
    expect(bodyGet('[role="menu"]').attributes("aria-label")).toBe("Actions for B1:C4");
    expect(labels()).toEqual([
      "Freeze up to this column",
      "Resize column",
      "Insert 2 columns left",
      "Insert 2 columns right",
      "Delete columns B-C",
      "Wrap text",
      "Add conditional format…",
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
    expect(bodyHas('[role="menu"]')).toBe(false);
    expect(server.editTable).not.toHaveBeenCalled();
  });
});

describe("files", () => {
  /** Chooses a file in the table's file input, as picking one in the browser's dialog does. */
  async function choose(name: string, content: string, action = "Import CSV"): Promise<void> {
    const input = wrapper.get<HTMLInputElement>(
      `label[data-block-action="${action}"] input[type="file"]`,
    );
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
    expect(appDialog()).toBeNull();
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
    await choose("data.csv", "x");
    await flushPromises();
    expect(appDialog()?.textContent).toContain("Replace the contents of Table 1 with data.csv?");
    await respondToDialog("cancel");
    expect(server.setCells).not.toHaveBeenCalled();

    await choose("data.csv", "x");
    await respondToDialog("confirm");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ rowId: "r0", colId: "c1", input: "x" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
    expect(useWorkbookStore().inputOf(at("C3"))).toBe("kept");
  });

  it("confirms named-column mapping before appending parsed CSV rows", async () => {
    const named: TableRecord = {
      ...TABLE,
      name: "Sales",
      columns: [
        { name: "Item", type: "text" },
        { name: "Qty", type: "number" },
        { name: "Notes", type: "any" },
      ],
    };
    server.getSnapshot.mockResolvedValue(wireSnapshot({ ...snapshotWith(), tables: [named] }));
    await useWorkbookStore().load("s1");
    const store = useWorkbookStore();
    wrapper = mount(TableCard, { props: { table: named }, attachTo: document.body });

    await choose("sales.csv", "item,QTY,Notes\nPen,2,first\nPencil,3,second", "Append CSV rows");
    expect(appDialog()?.textContent).toContain(
      "Append 2 rows to Sales? Matched columns: Item, Qty, Notes.",
    );
    expect(server.appendCsvRows).not.toHaveBeenCalled();
    await respondToDialog("cancel");
    expect(server.appendCsvRows).not.toHaveBeenCalled();

    await choose("sales.csv", "QTY,qTy,item,Unknown\n007,999,Pen,ignored", "Append CSV rows");
    expect(appDialog()?.textContent).toContain(
      "Append 1 row to Sales? Matched columns: Qty, Item. Ignored: Unknown. Duplicate columns ignored: qTy.",
    );
    await respondToDialog("confirm");
    await flushPromises();
    expect(server.appendCsvRows).toHaveBeenCalledExactlyOnceWith("t1", [
      ["QTY", "qTy", "item", "Unknown"],
      ["007", "999", "Pen", "ignored"],
    ]);
    expect(store.notice).toBeNull();
  });

  it("shows the matching-header refusal without calling the server", async () => {
    const named: TableRecord = {
      ...TABLE,
      columns: [{ name: "Item", type: "text" }],
    };
    server.getSnapshot.mockResolvedValue(wireSnapshot({ ...snapshotWith(), tables: [named] }));
    await useWorkbookStore().load("s1");
    wrapper = mount(TableCard, { props: { table: named }, attachTo: document.body });

    await choose("bad.csv", "Unknown\nvalue", "Append CSV rows");
    expect(appDialog()?.textContent).toContain(
      "The first row of the file has no column names that match this table.",
    );
    expect(server.appendCsvRows).not.toHaveBeenCalled();
  });

  it("confirms plain-grid append without dropping its first row", async () => {
    await render();
    await choose("grid.csv", "header,value\nfirst,1", "Append CSV rows");
    expect(appDialog()?.textContent).toContain(
      "Append 2 rows to Table 1? Columns are matched by position.",
    );
    await respondToDialog("confirm");
    await flushPromises();
    expect(server.appendCsvRows).toHaveBeenCalledExactlyOnceWith("t1", [
      ["header", "value"],
      ["first", "1"],
    ]);
  });
});

describe("column names", () => {
  const COLUMNS = [
    { name: "Price", type: "number" as const },
    { name: "Qty", type: "any" as const },
    { name: "Total", type: "formula" as const, formula: "=[Price] * [Qty]" },
  ];
  const DATA_TABLE = { ...TABLE, columns: COLUMNS };

  async function renderData(
    inputs: Record<string, string> = {},
    columns: TableRecord["columns"] = COLUMNS,
  ): Promise<void> {
    const table = { ...TABLE, columns };
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({ ...snapshotWith(inputs), tables: [table] }),
    );
    await useWorkbookStore().load("s1");
    const store = useWorkbookStore();
    wrapper = mount(
      {
        components: { TableCard, FormulaBar, FormulaSessionHost },
        setup: () => ({ store }),
        template: '<FormulaBar /><TableCard :table="store.tables[0]" /><FormulaSessionHost />',
      },
      { attachTo: document.body },
    );
    server.updateColumn.mockResolvedValue(changeWith({ table, cells: [], views: [], tables: [] }));
  }

  function item(name: string) {
    const found = bodyFindAll('[role="menuitem"]').find((candidate) => candidate.text() === name);
    if (!found) throw new Error(`No menu item named ${name}`);
    return found;
  }

  it("offers two ways to name the columns of a plain table", async () => {
    await render();
    server.nameColumns.mockResolvedValue(
      changeWith({ table: DATA_TABLE, cells: [], views: [], tables: [] }),
    );
    await button("Name columns").trigger("click");
    expect(bodyGet('[role="menu"]').attributes("aria-label")).toBe("Name columns");
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
    await button("Remove column names").trigger("click");
    expect(appDialog()?.textContent).toContain(
      "Remove the column names of Table 1? Its formula columns will become empty.",
    );
    await respondToDialog("cancel");
    expect(server.dropColumns).not.toHaveBeenCalled();
    await button("Remove column names").trigger("click");
    await respondToDialog("confirm");
    expect(server.dropColumns).toHaveBeenCalledExactlyOnceWith("t1");
  });

  it("lists the available column types in the menu, with the current one ticked", async () => {
    await renderData();
    await wrapper.get('[data-cell="A1"]').trigger("contextmenu");
    const labels = bodyFindAll('[role="menuitem"]').map((found) => found.text());
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
    await flushPromises();
    expect(appDialog()).toBeNull();
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c1", {
      revision: expect.any(Number),
      type: "date",
    });
  });

  it("asks how many cells will fail and keeps the old type when canceled", async () => {
    await renderData({ A1: "TRUE", A2: "yes", A3: "FALSE" });
    await wrapper.get('[data-cell="A1"]').trigger("contextmenu");
    await item("Column holds: Checkbox").trigger("click");
    await flushPromises();

    expect(appDialog()?.textContent).toContain(
      "1 of 4 cells in 'Price' are not TRUE or FALSE and will show #VALUE! as Checkbox. Change the type anyway?",
    );
    expect(appDialog()?.textContent).toContain("Change type");
    await respondToDialog("cancel");
    await flushPromises();

    expect(server.updateColumn).not.toHaveBeenCalled();
    expect(useWorkbookStore().tables[0]?.columns?.[0]?.type).toBe("number");
  });

  it("warns when text formulas return errors after changing to Anything", async () => {
    const textColumns = COLUMNS.map((column, index) =>
      index === 0 ? { ...column, type: "text" as const } : column,
    );
    await renderData({ A1: "=1/0" }, textColumns);

    expect(useWorkbookStore().valueOf(at("A1"))).toBe("=1/0");
    await wrapper.get('[data-cell="A1"]').trigger("contextmenu");
    await item("Column holds: Anything").trigger("click");
    await flushPromises();

    expect(appDialog()?.textContent).toContain(
      "1 of 4 cells in 'Price' contain formulas that will show errors as Anything. Change the type anyway?",
    );
    await respondToDialog("cancel");
    await flushPromises();
    expect(server.updateColumn).not.toHaveBeenCalled();
  });

  function columnEditor(): EditorView {
    return EditorView.findFromDOM(
      wrapper.get(".column-formula-popover .cm-content").element as HTMLElement,
    )!;
  }
  async function openFormula(address = "C1"): Promise<EditorView> {
    await wrapper.get(`[data-cell="${address}"]`).trigger("contextmenu");
    await flushPromises();
    await item(
      address === "C1" ? "✓ Column holds: A formula…" : "Column holds: A formula…",
    ).trigger("click");
    await flushPromises();
    if (appDialog()) await respondToDialog("confirm");
    await flushPromises();
    return columnEditor();
  }
  it("opens a nonmodal formula editor with the whole-column label and saves on Apply", async () => {
    await renderData();
    const view = await openFormula();
    expect(view.state.doc.toString()).toBe("=[Price] * [Qty]");
    expect(wrapper.get(".column-formula-popover").text()).toContain(
      "Editing formula for every row in Table 1[Total]",
    );
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "=[Price] + 1" } });
    await button("Apply").trigger("click");
    await flushPromises();
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c3", {
      type: "formula",
      formula: "=[Price] + 1",
    });
    expect(wrapper.find(".column-formula-popover").exists()).toBe(false);
  });
  it("retains a failed column draft and discards it on Cancel without retrying", async () => {
    await renderData();
    const view = await openFormula();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "=[Price] + 1" } });
    server.updateColumn.mockRejectedValueOnce(new Error("Offline"));
    await button("Apply").trigger("click");
    await flushPromises();
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.state.doc.toString()).toBe("=[Price] + 1");
    expect(wrapper.get('.column-formula-popover [role="alert"]').text()).toBe("Offline");
    await button("Cancel").trigger("click");
    await flushPromises();
    expect(wrapper.find(".column-formula-popover").exists()).toBe(false);
    expect(server.updateColumn).toHaveBeenCalledTimes(1);
  });
  it("transfers the column draft and undo history between inline, bar, and popover editors without saves", async () => {
    await renderData();
    const store = useWorkbookStore();
    store.selection = at("C1");
    await flushPromises();
    await wrapper.get(".grid").trigger("keydown", { key: "F2" });
    await flushPromises();
    const inline = EditorView.findFromDOM(
      wrapper.get(".grid__editor .cm-content").element as HTMLElement,
    )!;
    expect(inline.contentDOM.getAttribute("aria-label")).toContain(
      "Editing formula for every row in Table 1[Total]",
    );
    inline.dispatch({
      changes: { from: inline.state.doc.length, insert: "+1" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    await flushPromises();
    (wrapper.get(".formula-bar input").element as HTMLInputElement).focus();
    await flushPromises();
    const bar = EditorView.findFromDOM(
      wrapper.get(".formula-bar .cm-content").element as HTMLElement,
    )!;
    expect(bar.state.selection.main.anchor).toBe(2);
    await button("Edit column formula").trigger("click");
    await flushPromises();
    const popover = columnEditor();
    expect(popover.state.doc.toString()).toBe("=[Price] * [Qty]+1");
    expect(popover.state.selection.main.anchor).toBe(2);
    expect(wrapper.findAll(".cm-editor")).toHaveLength(1);
    expect(undo(popover)).toBe(true);
    await flushPromises();
    expect(popover.state.doc.toString()).toBe("=[Price] * [Qty]");
    expect(server.updateColumn).not.toHaveBeenCalled();
    expect(useFormulaSessionStore().active?.target).toMatchObject({
      kind: "column",
      tableId: "t1",
      colId: "c3",
    });
    (wrapper.get(".formula-bar input").element as HTMLInputElement).focus();
    await flushPromises();
    expect(wrapper.findAll(".formula-bar button").map((control) => control.text())).toContain(
      "Pick reference",
    );
    expect(wrapper.find(".column-formula-popover .formula-editor__pick").exists()).toBe(false);
  });
  it("retains a column draft after its originating row is deleted and recovers a deleted column on submission", async () => {
    await renderData();
    const view = await openFormula();
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "=[Price]+9" } });
    const store = useWorkbookStore();
    await store.receiveChange(
      changeWith({ table: { ...DATA_TABLE, rows: DATA_TABLE.rows.slice(1), rowCount: 3 } }),
    );
    await flushPromises();
    expect(view.state.doc.toString()).toBe("=[Price]+9");
    expect(useFormulaSessionStore().active?.deleted).toBeUndefined();
    await store.receiveChange(
      changeWith({
        table: { ...DATA_TABLE, colCount: 2, colIds: ["c1", "c2"], columns: COLUMNS.slice(0, 2) },
      }),
    );
    await flushPromises();
    expect(useFormulaSessionStore().active?.deleted).toBeUndefined();
    await button("Apply").trigger("click");
    await flushPromises();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
      "The editing target was deleted",
    );
    const copy = EditorView.findFromDOM(
      document.querySelector<HTMLElement>('[aria-label="Unsaved formula for copying"]')!,
    )!;
    expect(copy.state.doc.toString()).toBe("=[Price]+9");
    expect(server.updateColumn).not.toHaveBeenCalled();
  });
  it("confirms removal of stored inputs when converting and can decline it", async () => {
    await renderData();
    await useWorkbookStore().setCell(at("B1"), "4");
    await flushPromises();
    await wrapper.get('[data-cell="B1"]').trigger("contextmenu");
    await item("Column holds: A formula…").trigger("click");
    await flushPromises();
    expect(appDialog()?.textContent).toContain(
      "Make Table 1[Qty] a formula column and remove its stored inputs?",
    );
    await respondToDialog("cancel");
    expect(wrapper.find(".column-formula-popover").exists()).toBe(false);
    expect(server.updateColumn).not.toHaveBeenCalled();
    const view = await openFormula("B1");
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "[Price] * 2" } });
    await button("Apply").trigger("click");
    await flushPromises();
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c2", {
      type: "formula",
      formula: "[Price] * 2",
    });
  });

  it("has no column items in the menu of a plain table", async () => {
    await render();
    await wrapper.get('[data-cell="A1"]').trigger("contextmenu");
    const labels = bodyFindAll('[role="menuitem"]').map((found) => found.text());
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

it("disables Add row when the spreadsheet-wide row limit is reached", async () => {
  await render();
  const store = useWorkbookStore();
  store.tables = [
    ...store.tables,
    {
      ...TABLE,
      id: "t2",
      rowCount: LIMITS.spreadsheetRows - TABLE.rowCount,
      rows: [],
    },
  ];
  await wrapper.vm.$nextTick();

  expect(wrapper.get('button[aria-label="Add row"]').attributes("disabled")).toBeDefined();
  expect(server.editTable).not.toHaveBeenCalled();
});

it.each([
  ["row", "rows", "Add row", "Add 5 rows", TABLE.rowCount],
  ["col", "columns", "Add column", "Add 10 columns", TABLE.colCount],
] as const)(
  "opens the %s growth menu and adds the preset count in one request",
  async (axis, noun, strip, label, index) => {
    await render();
    await wrapper.get(`button[aria-label="${strip}"]`).trigger("contextmenu", {
      clientX: 25,
      clientY: 30,
    });

    expect(bodyGet('[role="menu"]').attributes("aria-label")).toBe(`Add ${noun}`);
    await bodyFindAll('[role="menuitem"]')
      .find((item) => item.text() === label)!
      .trigger("click");

    expect(server.editTable).toHaveBeenCalledExactlyOnceWith(
      "t1",
      expectedEdit({ axis, kind: "insert", index, count: axis === "row" ? 5 : 10 }),
    );
    expect(bodyHas('[role="menu"]')).toBe(false);
  },
);

it("validates a custom count and clamps it to the table's remaining row limit", async () => {
  await render();
  await wrapper.get('button[aria-label="Add row"]').trigger("contextmenu");
  await bodyFindAll('[role="menuitem"]')
    .find((item) => item.text() === "Add custom number…")!
    .trigger("click");

  const form = bodyGet(".context-menu__custom");
  const input = form.get('input[aria-label="Number of rows"]');
  await input.setValue("0");
  await form.trigger("submit");
  expect(form.get('[role="alert"]').text()).toBe("Enter a positive whole number.");

  await input.setValue("2.5");
  await form.trigger("submit");
  expect(form.get('[role="alert"]').text()).toBe("Enter a positive whole number.");
  expect(server.editTable).not.toHaveBeenCalled();

  await input.setValue("999999999999");
  await form.trigger("submit");
  expect(server.editTable).toHaveBeenCalledExactlyOnceWith(
    "t1",
    expectedEdit({
      axis: "row",
      kind: "insert",
      index: TABLE.rowCount,
      count: 1000 - TABLE.rowCount,
    }),
  );
  expect(bodyHas('[role="menu"]')).toBe(false);
});

it("clamps a custom column count to the table's remaining column limit", async () => {
  await render();
  await wrapper.get('button[aria-label="Add column"]').trigger("contextmenu");
  await bodyFindAll('[role="menuitem"]')
    .find((item) => item.text() === "Add custom number…")!
    .trigger("click");

  const form = bodyGet(".context-menu__custom");
  await form.get('input[aria-label="Number of columns"]').setValue("1000");
  await form.trigger("submit");

  expect(server.editTable).toHaveBeenCalledExactlyOnceWith(
    "t1",
    expectedEdit({
      axis: "col",
      kind: "insert",
      index: TABLE.colCount,
      count: 100 - TABLE.colCount,
    }),
  );
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

  async function editFilter(text: string): Promise<EditorView> {
    const input = bar().find('input[aria-label="Table filter"]');
    if (input.exists()) {
      (input.element as HTMLInputElement).focus();
      await flushPromises();
    }
    const view = EditorView.findFromDOM(
      bar().get('[aria-label="Table filter"]').element as HTMLElement,
    )!;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
      selection: { anchor: text.length },
      userEvent: "input.type",
    });
    await flushPromises();
    return view;
  }

  it("resizes the selected visible rows by stored identity while sorted and filtered", async () => {
    await renderSorted();
    server.resizeLines.mockResolvedValue(changeWith());
    const rows = wrapper.findAll("tbody th");
    await rows[0]!.trigger("mousedown");
    await rows[1]!.trigger("mouseenter");
    window.dispatchEvent(new MouseEvent("mouseup"));
    await rows[1]!.trigger("contextmenu");
    await bodyFindAll('[role="menuitem"]')
      .find((item) => item.text() === "Resize row")!
      .trigger("click");
    const form = wrapper.get('form[aria-label="Resize row"]');
    await form.get("input").setValue("80");
    await form.trigger("submit");
    await flushPromises();
    expect(server.resizeLines).toHaveBeenCalledExactlyOnceWith("t1", {
      axis: "row",
      ids: ["r2", "r1"],
      size: 80,
    });
  });

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

  it("saves a changed filter once on Enter without a starting revision", async () => {
    await renderSorted();
    await editFilter("=[Qty] > 2");
    await bar().get('[aria-label="Table filter"]').trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(server.setTableDisplay).toHaveBeenCalledExactlyOnceWith("t1", {
      sort: [{ colId: "c2", descending: true }],
      filter: "=[Qty] > 2",
    });
  });

  it("blocks sort changes on a failed filter save, restores the sort control, and permits cancel", async () => {
    await renderSorted();
    const view = await editFilter("=[Qty] > 2");
    server.setTableDisplay.mockRejectedValue(new Error("Offline"));
    await bar().get('[aria-label="Sort direction 1"]').setValue("ascending");
    await flushPromises();
    expect(server.setTableDisplay).toHaveBeenCalledExactlyOnceWith("t1", {
      sort: [{ colId: "c2", descending: true }],
      filter: "=[Qty] > 2",
    });
    expect(bar().get('[aria-label="Sort direction 1"]').element).toHaveProperty(
      "value",
      "descending",
    );
    expect(document.activeElement).toBe(view.contentDOM);
    expect(view.state.doc.toString()).toBe("=[Qty] > 2");
    await bar().get('[aria-label="Table filter"]').trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(useFormulaSessionStore().active).toBeUndefined();
    expect(server.setTableDisplay).toHaveBeenCalledTimes(1);
  });

  it("saves on Tab and moves focus to the next control", async () => {
    await renderSorted();
    await editFilter("=[Qty] > 2");
    await bar().get('[aria-label="Table filter"]').trigger("keydown", { key: "Tab" });
    await flushPromises();
    expect(server.setTableDisplay).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(button("Clear filter").element);
  });

  it("clears the filter and keeps the sort", async () => {
    await renderSorted();
    await button("Clear filter").trigger("click");
    await flushPromises();
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
      bodyFindAll('[role="menuitem"]').find((found) => found.text() === name)!;
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
    const items = bodyFindAll('[role="menuitem"]');
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
    await editFilter("=[Qty] > 3");
    server.setTableDisplay.mockResolvedValueOnce(
      changeWith({ ...SORTED_TABLE, display: { ...SORTED_TABLE.display, filter: "=[Qty] > 3" } }),
    );
    await button("Add sort").trigger("click");
    await flushPromises();
    expect(server.setTableDisplay).toHaveBeenCalledTimes(2);
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

  async function renderChoices(
    inputs: Record<string, string> = {},
    data: TableRecord = DATA,
  ): Promise<void> {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({ ...snapshotWith(inputs), tables: [data, SOURCE] }),
    );
    await useWorkbookStore().load("s1");
    wrapper = mount(TableCard, { props: { table: data }, attachTo: document.body });
    server.updateColumn.mockResolvedValue(changeWith());
    await wrapper.get('[data-cell="A1"]').trigger("contextmenu");
    await bodyFindAll('[role="menuitem"]')
      .find((found) => found.text() === "Column holds: A choice…")!
      .trigger("click");
  }

  it("opens a panel from the column menu and saves a list, one choice on each line", async () => {
    await renderChoices({ A1: "outside" });
    const panel = wrapper.get('form[aria-label="Choices for Race"]');
    await panel.get("textarea").setValue(" Trial \n\nSprint\n");
    await panel.trigger("submit");
    await flushPromises();
    expect(appDialog()).toBeNull();
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c1", {
      type: "choice",
      choices: ["Trial", "Sprint"],
      revision: expect.any(Number),
    });
    expect(wrapper.find("form.choices-panel").exists()).toBe(false);
  });

  it("asks before choices turn malformed formulas into errors", async () => {
    const textData = {
      ...DATA,
      columns: DATA.columns.map((column, index) =>
        index === 0 ? { ...column, type: "text" as const } : column,
      ),
    };
    await renderChoices({ A1: "=[" }, textData);
    const panel = wrapper.get('form[aria-label="Choices for Race"]');
    await panel.get("textarea").setValue("Trial\nSprint");
    await panel.trigger("submit");
    await flushPromises();

    expect(appDialog()?.textContent).toContain(
      "1 of 4 cells in 'Race' contain formulas that will show errors as a dropdown. Change the type anyway?",
    );
    await respondToDialog("cancel");
    await flushPromises();
    expect(server.updateColumn).not.toHaveBeenCalled();
    expect(useWorkbookStore().tables[0]?.columns?.[0]?.type).toBe("text");
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
