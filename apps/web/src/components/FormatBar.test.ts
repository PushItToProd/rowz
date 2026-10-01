import { mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FormatRule } from "@spreadsheet-app/engine";
import { api } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import { at, snapshotWith, TABLE, type MockedApi } from "../testing";
import FormatBar from "./FormatBar.vue";

vi.mock("../api/client", async () => ({ api: (await import("../testing")).mockApi() }));
const server = api as unknown as MockedApi;

let wrapper: VueWrapper;

async function render(formats: FormatRule[] = []): Promise<ReturnType<typeof useWorkbookStore>> {
  server.getSnapshot.mockResolvedValue({ ...snapshotWith(), tables: [{ ...TABLE, formats }] });
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(FormatBar, { attachTo: document.body });
  return store;
}

const control = (label: string) => wrapper.get(`[aria-label="${label}"]`);

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  // The server answers with the table holding the rule that was asked for.
  server.formatCells.mockImplementation((_id, range, format, reset) =>
    Promise.resolve({ ...TABLE, formats: [{ ...range, format, ...(reset ? { reset } : {}) }] }),
  );
});
afterEach(() => {
  wrapper.unmount();
});

describe("FormatBar", () => {
  it("is off until a cell is selected", async () => {
    const store = await render();
    expect(control("Bold").attributes("disabled")).toBeDefined();
    expect(control("Number format").attributes("disabled")).toBeDefined();
    store.selection = at("A1");
    await wrapper.vm.$nextTick();
    expect(control("Bold").attributes("disabled")).toBeUndefined();
  });

  it("makes the selected cells bold, and then not bold", async () => {
    const store = await render();
    store.selection = at("B2");
    store.extendSelection({ row: 2, col: 2 });
    await wrapper.vm.$nextTick();
    await control("Bold").trigger("click");
    const range = { startRow: 1, endRow: 2, startCol: 1, endCol: 2 };
    expect(server.formatCells).toHaveBeenCalledExactlyOnceWith("t1", range, { bold: true }, false);
    await vi.waitFor(() => {
      expect(control("Bold").attributes("aria-pressed")).toBe("true");
    });

    await control("Bold").trigger("click");
    expect(server.formatCells).toHaveBeenLastCalledWith("t1", range, { bold: false }, false);
  });

  it("shows the format of the selected cell", async () => {
    const store = await render([
      {
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: 0,
        format: { italic: true, align: "center", numberFormat: "0.00", color: "red", fill: "blue" },
      },
    ]);
    store.selection = at("A1");
    await wrapper.vm.$nextTick();
    expect(control("Italic").attributes("aria-pressed")).toBe("true");
    expect(control("Bold").attributes("aria-pressed")).toBe("false");
    const value = (label: string): string => (control(label).element as HTMLSelectElement).value;
    expect(["Align", "Number format", "Text color", "Fill color"].map(value)).toEqual([
      "center",
      "0.00",
      "red",
      "blue",
    ]);

    store.selection = at("B1");
    await wrapper.vm.$nextTick();
    expect(value("Align")).toBe("");
    expect(control("Italic").attributes("aria-pressed")).toBe("false");
  });

  it.each([
    ["Align", "right", { align: "right" }],
    ["Number format", "#,##0.00", { numberFormat: "#,##0.00" }],
    ["Text color", "green", { color: "green" }],
    ["Fill color", "yellow", { fill: "yellow" }],
    ["Align", "", { align: null }],
    ["Fill color", "", { fill: null }],
  ])("sets %s to %j", async (label, value, patch) => {
    const store = await render();
    store.selection = at("A1");
    await wrapper.vm.$nextTick();
    await control(label).setValue(value);
    expect(server.formatCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { startRow: 0, endRow: 0, startCol: 0, endCol: 0 },
      patch,
      false,
    );
  });

  it("lists a number format it does not offer by name, when the cell has one", async () => {
    const rule = {
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 0,
      format: { numberFormat: "0.0000" },
    };
    const store = await render([rule]);
    store.selection = at("A1");
    await wrapper.vm.$nextTick();
    expect((control("Number format").element as HTMLSelectElement).value).toBe("0.0000");
  });

  it("formats a whole column to the end of the table, so later rows match", async () => {
    const store = await render();
    store.selection = at("B1");
    store.extendSelection({ row: TABLE.rowCount - 1, col: 1 });
    await wrapper.vm.$nextTick();
    await control("Italic").trigger("click");
    expect(server.formatCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { startRow: 0, endRow: null, startCol: 1, endCol: 1 },
      { italic: true },
      false,
    );
  });

  it("clears the formats of the selected cells", async () => {
    const store = await render();
    store.selection = at("A1");
    store.extendSelection({ row: TABLE.rowCount - 1, col: TABLE.colCount - 1 });
    await wrapper.vm.$nextTick();
    const clear = wrapper.findAll("button").find((button) => button.text() === "Clear format");
    await clear!.trigger("click");
    expect(server.formatCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { startRow: 0, endRow: null, startCol: 0, endCol: null },
      {},
      true,
    );
  });

  it("takes back and makes again the last edit", async () => {
    const store = await render();
    expect(control("Undo").attributes("disabled")).toBeDefined();
    await store.setCell(at("A1"), "typed");
    await wrapper.vm.$nextTick();
    await control("Undo").trigger("click");
    expect(store.inputOf(at("A1"))).toBe("");
    await wrapper.vm.$nextTick();
    expect(control("Undo").attributes("disabled")).toBeDefined();
    await control("Redo").trigger("click");
    expect(store.inputOf(at("A1"))).toBe("typed");
  });

  it("reports a refused change", async () => {
    const store = await render();
    store.selection = at("A1");
    server.formatCells.mockRejectedValue(new Error("Too many"));
    await wrapper.vm.$nextTick();
    await control("Bold").trigger("click");
    await vi.waitFor(() => {
      expect(store.notice).toEqual({ kind: "error", text: "Too many" });
    });
  });
});
