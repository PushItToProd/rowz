import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, TABLE, type MockedApi } from "../testing";
import TableCard from "./TableCard.vue";

vi.mock("../api/client", async () => ({ api: (await import("../testing")).mockApi() }));
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
  server.editTable.mockResolvedValue({ table: TABLE, cells: [] });
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
    expect(wrapper.find(".table-card__actions").exists()).toBe(false);
  });
});

describe("table actions", () => {
  it("adds a row and a column at the end", async () => {
    await render();
    server.updateTable.mockResolvedValue({ table: TABLE, cells: [] });
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
