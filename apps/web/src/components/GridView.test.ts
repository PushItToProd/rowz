import { DOMWrapper, flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api, type TableRecord } from "../api/client";
import { useWorkbookStore } from "../stores/workbook";
import {
  at,
  changeWith,
  clickResult,
  identifiedAt,
  notifyJournaled,
  sizedTable,
  snapshotWith,
  TABLE,
  type MockedApi,
  wireSnapshot,
} from "../testing";
import { EditorView } from "@codemirror/view";
import { completionStatus, startCompletion } from "@codemirror/autocomplete";
import GridView from "./GridView.vue";
import { useFormulaSessionStore } from "../formula/session";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

let wrapper: VueWrapper;

describe("windowed grids", () => {
  async function largeGrid(
    colCount = 100,
    rowCount = 1000,
    changes: Partial<TableRecord> = {},
    attachTo: HTMLElement = document.body,
  ): Promise<void> {
    const table = sizedTable({ rowCount, colCount, ...changes });
    server.getSnapshot.mockResolvedValue(wireSnapshot({ ...snapshotWith({}), tables: [table] }));
    await useWorkbookStore().load("s1");
    wrapper = mount(GridView, { props: { table }, attachTo });
  }

  it("mounts a window and updates both axes on scroll", async () => {
    await largeGrid();
    expect(wrapper.findAll('[role="gridcell"]').length).toBeLessThan(1000);
    expect(wrapper.find('[data-cell="CV1000"]').exists()).toBe(false);
    const grid = wrapper.element as HTMLElement;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({ top: -15000 } as DOMRect);
    grid.scrollLeft = 6000;
    window.dispatchEvent(new Event("scroll"));
    await flushPromises();
    expect(wrapper.find('[data-cell="A1"]').exists()).toBe(false);
    expect(wrapper.findAll('[role="gridcell"]').length).toBeLessThan(1000);
    expect(wrapper.find('[data-pick-row="500"]').exists()).toBe(true);
  });

  it("keeps a pending confirmation mounted when its row leaves the window", async () => {
    const table = sizedTable({ rowCount: 1000, colCount: 1 });
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith({ A1: '=BUTTON("Clear", CLEAR(A2), 1/0)', A2: "keep" }),
        tables: [table],
      }),
    );
    await useWorkbookStore().load("s1");
    wrapper = mount(GridView, { props: { table }, attachTo: document.body });

    await wrapper.get('[data-cell="A1"] button').trigger("click");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Run this button?");

    const grid = wrapper.element as HTMLElement;
    vi.spyOn(grid, "getBoundingClientRect").mockReturnValue({ top: -15000 } as DOMRect);
    window.dispatchEvent(new Event("scroll"));
    await flushPromises();

    expect(wrapper.find('[data-cell="A1"]').exists()).toBe(true);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(server.click).not.toHaveBeenCalled();
    document
      .querySelector<HTMLButtonElement>(".confirm-dialog__actions button:last-child")
      ?.click();
    await flushPromises();
    expect(server.click).toHaveBeenCalledExactlyOnceWith(identifiedAt("A1"));
  });

  it("scrolls to an unmounted selection during keyboard navigation", async () => {
    await largeGrid();
    const grid = wrapper.element as HTMLElement;
    let top = 0;
    vi.spyOn(grid, "getBoundingClientRect").mockImplementation(() => ({ top }) as DOMRect);
    vi.mocked(Element.prototype.scrollIntoView).mockImplementation(function (this: Element) {
      if (this instanceof HTMLElement && this.style.position === "absolute") {
        top = -Number.parseFloat(this.style.top);
        grid.scrollLeft = Number.parseFloat(this.style.left);
      }
    });
    const store = useWorkbookStore();
    store.selection = { tableId: TABLE.id, row: 998, col: 99 };
    (wrapper.element as HTMLElement).focus();
    await wrapper.trigger("keydown", { key: "ArrowDown" });
    await flushPromises();
    expect(store.selection.row).toBe(999);
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(wrapper.find('[data-cell="CV1000"]').exists()).toBe(true);
  });

  it.each([8, 100])("measures the windowed DOM for 1000 x %i", async (colCount) => {
    await largeGrid(colCount);
    await flushPromises();
    const grid = wrapper.element as HTMLElement;
    const mounted = grid.querySelectorAll('[role="gridcell"]').length;
    const nodes = grid.querySelectorAll("*").length;
    console.info(
      `Grid DOM (1000 x ${String(colCount)}): ${String(nodes)} descendant elements, ${String(mounted)} mounted cells; ${String(1000 * colCount)} unwindowed cells (calculated)`,
    );
    expect(mounted).toBeGreaterThan(0);
    expect(mounted).toBeLessThan(500);
    expect(nodes).toBeLessThan(1500);
    expect(mounted).toBeLessThan((1000 * colCount) / 10);
  });

  it("renders every cell for printing and restores the window afterward", async () => {
    // Exceed the row threshold with only one column: print behavior needs no huge baseline.
    await largeGrid(1, 201);
    await flushPromises();
    const grid = wrapper.element as HTMLElement;
    const mounted = grid.querySelectorAll('[role="gridcell"]').length;
    expect(mounted).toBeLessThan(50);
    window.dispatchEvent(new Event("beforeprint"));
    await flushPromises();
    expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(201);
    window.dispatchEvent(new Event("afterprint"));
    await flushPromises();
    expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(mounted);
  });

  it("retains a focused column-name draft outside the horizontal window", async () => {
    await largeGrid(40, 201, {
      columns: Array.from({ length: 40 }, (_, col) => ({
        name: `Column ${String(col)}`,
        type: "any",
      })),
    });
    await wrapper
      .get('[data-pick-kind="col"][data-pick-index="0"] .editable-name')
      .trigger("dblclick");
    await flushPromises();
    const input = wrapper.get<HTMLInputElement>('input[aria-label="Column name"]');
    await input.setValue("Uncommitted name");
    const grid = wrapper.element as HTMLElement;
    grid.scrollLeft = 4000;
    window.dispatchEvent(new Event("scroll"));
    await flushPromises();
    expect(wrapper.find('[data-pick-kind="col"][data-pick-index="1"]').exists()).toBe(false);
    expect(wrapper.get('input[aria-label="Column name"]').element).toBe(input.element);
    expect(input.element.value).toBe("Uncommitted name");
    expect(document.activeElement).toBe(input.element);
    expect(server.updateColumn).not.toHaveBeenCalled();
    grid.scrollLeft = 0;
    window.dispatchEvent(new Event("scroll"));
    await flushPromises();
    await input.trigger("keydown", { key: "Escape" });
    await flushPromises();
    expect(wrapper.get('[data-pick-kind="col"][data-pick-index="0"] .editable-name').text()).toBe(
      "Column 0",
    );
  });

  it.each(["reorder", "content"])(
    "refreshes a culled table after a page %s change",
    async (change) => {
      let notify: ((records: MutationRecord[]) => void) | undefined;
      const observe = vi.fn();
      class MutationObserverStub implements MutationObserver {
        constructor(callback: MutationCallback) {
          notify = (records) => {
            callback(records, this);
          };
        }
        observe = observe;
        disconnect = vi.fn();
        takeRecords(): MutationRecord[] {
          return [];
        }
      }
      vi.stubGlobal("MutationObserver", MutationObserverStub);
      // This fixture belongs to the test, outside Vue's mount container.
      const host = document.createElement("section");
      host.className = "editor";
      const block = document.createElement("div");
      const text = document.createTextNode("Block above the table");
      block.append(text);
      host.append(block);
      document.body.append(host);
      try {
        await largeGrid(100, 1000, {}, host);
        const grid = wrapper.element as HTMLElement;
        let top = 2000;
        vi.spyOn(grid, "getBoundingClientRect").mockImplementation(() => ({ top }) as DOMRect);
        expect(observe).toHaveBeenCalledWith(host, expect.objectContaining({ subtree: true }));
        if (!notify) throw new Error("Layout observer was not created");
        const emptyNodes = document.createDocumentFragment().childNodes;
        const record: MutationRecord = {
          type: change === "reorder" ? "childList" : "characterData",
          target: change === "reorder" ? host : text,
          addedNodes: emptyNodes,
          removedNodes: emptyNodes,
          previousSibling: null,
          nextSibling: null,
          attributeName: null,
          attributeNamespace: null,
          oldValue: null,
        };
        notify([record]);
        await flushPromises();
        expect(grid.querySelectorAll('[role="gridcell"]')).toHaveLength(0);
        top = 0;
        notify([record]);
        await flushPromises();
        expect(grid.querySelectorAll('[role="gridcell"]').length).toBeGreaterThan(0);
        expect(grid.querySelectorAll('[role="gridcell"]').length).toBeLessThan(500);
      } finally {
        // Detach only the fixture; Vue's mount container and children stay intact.
        host.remove();
        vi.unstubAllGlobals();
      }
    },
  );
});

async function mountGrid(inputs: Record<string, string> = {}, role = "owner"): Promise<void> {
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith(inputs, role)));
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

function mockPointerCapture(element: Element): void {
  const captured = new Set<number>();
  element.setPointerCapture = vi.fn((pointerId: number): void => {
    captured.add(pointerId);
  });
  element.hasPointerCapture = vi.fn((pointerId: number) => captured.has(pointerId));
  element.releasePointerCapture = vi.fn((pointerId: number): void => {
    captured.delete(pointerId);
  });
}

function dispatchPointer(
  target: EventTarget,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel" | "lostpointercapture",
  fields: {
    pointerId?: number;
    pointerType?: string;
    isPrimary?: boolean;
    button?: number;
    clientX?: number;
    clientY?: number;
  } = {},
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: 1,
    pointerType: "mouse",
    isPrimary: true,
    button: 0,
    ...fields,
  });
  target.dispatchEvent(event);
}

function editorView(): EditorView {
  return EditorView.findFromDOM(wrapper.get(".grid__editor .cm-content").element as HTMLElement)!;
}
function dispatchKey(
  target: EventTarget,
  key: string,
  modifiers: {
    shiftKey?: boolean;
    ctrlKey?: boolean;
    altKey?: boolean;
    metaKey?: boolean;
    repeat?: boolean;
  } = {},
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    ...modifiers,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}
async function setEditorText(text: string): Promise<void> {
  const view = editorView();
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
    userEvent: "input.type",
  });
  await flushPromises();
}
async function press(
  key: string,
  options: { shiftKey?: boolean; ctrlKey?: boolean; altKey?: boolean } = {},
): Promise<void> {
  const editor = wrapper.find(".grid__editor .cm-content");
  await (editor.exists() ? editor : wrapper.get(".grid")).trigger("keydown", { key, ...options });
  await flushPromises();
}

async function select(address: string): Promise<void> {
  await cellAt(address).trigger("mousedown");
  await flushPromises();
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

  it("resizes the table for a dimension spill and recalculates the formula", async () => {
    const resized = sizedTable({ rowCount: 6, colCount: 4 });
    server.updateTable.mockResolvedValue(
      changeWith({ table: resized, cells: [], views: [], tables: [] }),
    );
    await mountGrid({ A1: "=SEQUENCE(6, 4)" });
    expect(cellAt("A1").text()).toBe("#SPILL!");

    await cellAt("A1").find(".cell-value--error").trigger("mouseenter");
    const button = document.querySelector<HTMLButtonElement>(".cell-error-popover__action");
    if (!button) throw new Error("Expected the spill resize button");
    await new DOMWrapper(button).trigger("click");
    await flushPromises();

    expect(server.updateTable).toHaveBeenCalledExactlyOnceWith("t1", {
      rowCount: 6,
      colCount: 4,
      grow: true,
    });
    const store = useWorkbookStore();
    expect(store.valueOf(at("A1"))).toBe(1);
    expect(store.valueOf(at("D6"))).toBe(24);
    expect(document.querySelector(".cell-error-popover__action")).toBeNull();
  });

  it("focuses the spill resize button with Alt+Enter and returns to the grid on Escape", async () => {
    await mountGrid({ A1: "=SEQUENCE(6, 4)" });
    await select("A1");

    await press("Enter", { altKey: true });
    const button = document.querySelector<HTMLButtonElement>(".cell-error-popover__action");
    if (!button) throw new Error("Expected the spill resize button");
    expect(document.activeElement).toBe(button);
    expect(document.querySelector(".cell-error-popover__hint")?.textContent).toContain("Alt+Enter");

    await new DOMWrapper(button).trigger("mouseleave");
    expect(document.querySelector(".cell-error-popover__action")).toBe(button);

    await new DOMWrapper(button).trigger("keydown", { key: "Escape" });
    expect(document.querySelector(".cell-error-popover__action")).toBeNull();
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });

  it.each(["Enter", " "])(
    "resizes the table with %s after Alt+Enter focuses the action",
    async (key) => {
      const resized = sizedTable({ rowCount: 6, colCount: 4 });
      server.updateTable.mockResolvedValue(
        changeWith({ table: resized, cells: [], views: [], tables: [] }),
      );
      await mountGrid({ A1: "=SEQUENCE(6, 4)" });
      await select("A1");
      await press("Enter", { altKey: true });

      const button = document.querySelector<HTMLButtonElement>(".cell-error-popover__action");
      if (!button) throw new Error("Expected the spill resize button");
      expect(document.activeElement).toBe(button);
      const action = new DOMWrapper(button);
      await action.trigger("keydown", { key });
      if (key === " ") await action.trigger("keyup", { key });

      await vi.waitFor(() => {
        expect(server.updateTable).toHaveBeenCalledExactlyOnceWith("t1", {
          rowCount: 6,
          colCount: 4,
          grow: true,
        });
      });
      expect(document.activeElement).toBe(wrapper.get(".grid").element);
    },
  );

  it("does not offer table resizing when another cell blocks the spill", async () => {
    await mountGrid({ A1: "=SEQUENCE(2)", A2: "occupied" });
    await cellAt("A1").find(".cell-value--error").trigger("mouseenter");
    expect(document.querySelector(".cell-error-popover__action")).toBeNull();
  });

  it("does not offer resizing for a spill error propagated from another table", async () => {
    const source = sizedTable({ name: "Table1", rowCount: 2 });
    const destination = sizedTable({
      id: "t2",
      name: "Other Table",
      position: 1,
      rowCount: 4,
    });
    const snapshot = wireSnapshot({
      ...snapshotWith(),
      tables: [source, destination],
      cells: [
        { ...identifiedAt("A1", source.id), input: "=SEQUENCE(3)" },
        { ...identifiedAt("A1", destination.id), input: "=Table1!A1" },
      ],
    });
    server.getSnapshot.mockResolvedValue(snapshot);
    await useWorkbookStore().load("s1");
    wrapper = mount(GridView, { props: { table: destination }, attachTo: document.body });

    expect(useWorkbookStore().valueOf(at("A1", destination.id))).toMatchObject({
      kind: "error",
      spill: { tableId: source.id, reason: "table-size" },
    });
    await cellAt("A1").find(".cell-value--error").trigger("mouseenter");
    expect(document.querySelector(".cell-error-popover__action")).toBeNull();
  });

  it("does not offer resizing when both table dimensions and an occupied cell block the spill", async () => {
    await mountGrid({ A1: "=SEQUENCE(6)", A2: "occupied" });
    expect(useWorkbookStore().valueOf(at("A1"))).not.toHaveProperty("spill");
    await cellAt("A1").find(".cell-value--error").trigger("mouseenter");
    expect(document.querySelector(".cell-error-popover__action")).toBeNull();
  });

  it("hides the resize button when the required table size exceeds a limit", async () => {
    await mountGrid({ A1: "=SEQUENCE(1001)" });
    await cellAt("A1").find(".cell-value--error").trigger("mouseenter");
    expect(document.querySelector(".cell-error-popover__action")).toBeNull();
  });
});

describe("resizing headers", () => {
  it.each([
    ["col", "column B", "clientX", "c2", 120, 180],
    ["row", "row 2", "clientY", "r1", 30, 90],
  ] as const)(
    "previews a %s drag and saves its stable identity once on release",
    async (axis, label, coordinate, id, original, size) => {
      await mountGrid();
      server.resizeLines.mockResolvedValue(changeWith());
      const handle = wrapper.get(`[aria-label="Resize ${label}"]`);
      mockPointerCapture(handle.element);
      dispatchPointer(handle.element, "pointerdown", {
        pointerType: "touch",
        [coordinate]: 100,
      });
      expect(handle.element.setPointerCapture).toHaveBeenCalledExactlyOnceWith(1);
      dispatchPointer(window, "pointermove", { pointerId: 1, [coordinate]: 100 + size - original });
      await wrapper.vm.$nextTick();
      expect(server.resizeLines).not.toHaveBeenCalled();
      if (axis === "col") expect(wrapper.findAll("col")[2]!.attributes("style")).toContain("180px");
      else expect(wrapper.findAll("tbody tr")[1]!.attributes("style")).toContain("90px");
      expect(useWorkbookStore().selection).toBeNull();
      dispatchPointer(window, "pointerup");
      await flushPromises();
      expect(server.resizeLines).toHaveBeenCalledExactlyOnceWith("t1", { axis, ids: [id], size });
    },
  );

  it("clamps dragging, cancels with Escape, and resets on double-click", async () => {
    await mountGrid();
    server.resizeLines.mockResolvedValue(changeWith());
    const handle = wrapper.get('[aria-label="Resize column A"]');
    mockPointerCapture(handle.element);
    dispatchPointer(handle.element, "pointerdown", { clientX: 100 });
    dispatchPointer(window, "pointermove", { clientX: 5000 });
    dispatchPointer(window, "pointerup");
    await flushPromises();
    expect(server.resizeLines).toHaveBeenLastCalledWith("t1", {
      axis: "col",
      ids: ["c1"],
      size: 1000,
    });
    dispatchPointer(handle.element, "pointerdown", { clientX: 100 });
    dispatchPointer(window, "pointermove", { clientX: -5000 });
    dispatchPointer(window, "pointerup");
    await flushPromises();
    expect(server.resizeLines).toHaveBeenLastCalledWith("t1", {
      axis: "col",
      ids: ["c1"],
      size: 40,
    });
    server.resizeLines.mockClear();
    dispatchPointer(handle.element, "pointerdown", { clientX: 100 });
    dispatchPointer(window, "pointermove", { clientX: 200 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    dispatchPointer(window, "pointerup");
    await flushPromises();
    expect(server.resizeLines).not.toHaveBeenCalled();
    await handle.trigger("dblclick");
    await flushPromises();
    expect(server.resizeLines).toHaveBeenCalledExactlyOnceWith("t1", {
      axis: "col",
      ids: ["c1"],
      size: null,
    });
  });

  it("cancels a touch resize when the pointer is canceled", async () => {
    await mountGrid();
    const handle = wrapper.get('[aria-label="Resize column A"]');
    mockPointerCapture(handle.element);
    dispatchPointer(handle.element, "pointerdown", {
      pointerId: 7,
      pointerType: "touch",
      clientX: 100,
    });
    dispatchPointer(window, "pointermove", { pointerId: 7, clientX: 200 });
    dispatchPointer(window, "pointercancel", { pointerId: 7 });
    dispatchPointer(window, "pointerup", { pointerId: 7 });
    await flushPromises();
    expect(server.resizeLines).not.toHaveBeenCalled();
    expect(handle.element.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
  });

  it("stops resizing when a removed handle loses pointer capture", async () => {
    await mountGrid();
    const handle = wrapper.get('[aria-label="Resize column A"]');
    mockPointerCapture(handle.element);
    dispatchPointer(handle.element, "pointerdown", { pointerId: 9, clientX: 100 });
    dispatchPointer(window, "pointermove", { pointerId: 9, clientX: 200 });
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll("col")[1]!.attributes("style")).toContain("220px");

    handle.element.remove();
    dispatchPointer(handle.element, "lostpointercapture", { pointerId: 9 });
    dispatchPointer(window, "pointermove", { pointerId: 9, clientX: 300 });
    dispatchPointer(window, "pointerup", { pointerId: 9 });
    await flushPromises();

    expect(server.resizeLines).not.toHaveBeenCalled();
    expect(wrapper.findAll("col")[1]!.attributes("style")).not.toContain("220px");
  });

  it("ignores a secondary pointer when starting a resize", async () => {
    await mountGrid();
    const handle = wrapper.get('[aria-label="Resize column A"]');
    mockPointerCapture(handle.element);
    dispatchPointer(handle.element, "pointerdown", {
      pointerId: 2,
      pointerType: "touch",
      isPrimary: false,
      clientX: 100,
    });
    dispatchPointer(window, "pointermove", { pointerId: 2, clientX: 200 });
    dispatchPointer(window, "pointerup", { pointerId: 2 });
    await flushPromises();

    expect(handle.element.setPointerCapture).not.toHaveBeenCalled();
    expect(server.resizeLines).not.toHaveBeenCalled();
  });

  it("renders persisted sizes by identity and hides resize handles for viewers", async () => {
    await mountGrid();
    await wrapper.setProps({
      table: { ...TABLE, gridSizes: { rows: { r1: 80 }, columns: { c2: 240 } } },
    });
    expect(wrapper.findAll("col")[2]!.attributes("style")).toContain("240px");
    expect(wrapper.findAll("tbody tr")[1]!.attributes("style")).toContain("80px");
    wrapper.unmount();
    setActivePinia(createPinia());
    await mountGrid({}, "viewer");
    expect(wrapper.find(".grid__resize").exists()).toBe(false);
  });

  it("removes drag listeners when unmounted", async () => {
    await mountGrid();
    const handle = wrapper.get('[aria-label="Resize row 1"]');
    mockPointerCapture(handle.element);
    dispatchPointer(handle.element, "pointerdown", { clientY: 100 });
    wrapper.unmount();
    dispatchPointer(window, "pointermove", { clientY: 200 });
    dispatchPointer(window, "pointerup");
    expect(server.resizeLines).not.toHaveBeenCalled();
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
  const modifiedNavigationKeys = [
    ["Ctrl+Enter", "Enter", { ctrlKey: true }],
    ["Ctrl+Tab", "Tab", { ctrlKey: true }],
    ["Alt+Enter", "Enter", { altKey: true }],
    ["Alt+Tab", "Tab", { altKey: true }],
    ["Meta+Enter", "Enter", { metaKey: true }],
    ["Meta+Tab", "Tab", { metaKey: true }],
  ] as const;

  it("keeps a fast burst of characters while the grid opens the editor", async () => {
    await mountGrid({ A1: "old" });
    await select("A1");

    const grid = wrapper.get(".grid").element;
    for (const character of "TRUE") dispatchKey(grid, character);
    await flushPromises();

    expect(editorView().state.doc.toString()).toBe("TRUE");
  });

  it.each(modifiedNavigationKeys)(
    "does not queue %s while the grid is opening the editor",
    async (_label, key, modifiers) => {
      await mountGrid();
      await select("A1");

      const grid = wrapper.get(".grid").element;
      dispatchKey(grid, "x");
      const event = dispatchKey(grid, key, modifiers);
      expect(event.defaultPrevented).toBe(false);

      await flushPromises();
      expect(selectedAddress()).toBe("A1");
      expect(editorView().state.doc.toString()).toBe("x");
    },
  );

  it("keeps Shift+Tab navigation while the grid is opening the editor", async () => {
    await mountGrid();
    await select("B1");

    const grid = wrapper.get(".grid").element;
    dispatchKey(grid, "x");
    dispatchKey(grid, "Tab", { shiftKey: true });
    await flushPromises();

    expect(cellAt("B1").text()).toBe("x");
    expect(selectedAddress()).toBe("A1");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
  });

  it("keeps a failed save's restored draft focused and drops queued navigation", async () => {
    await mountGrid({ A1: "old" });
    await select("A1");
    await press("Enter");
    await setEditorText("cc");
    server.setCells.mockRejectedValueOnce(new Error("Offline"));

    const content = editorView().contentDOM;
    dispatchKey(content, "Tab");
    dispatchKey(content, "d");
    dispatchKey(content, "d");
    dispatchKey(content, "Enter");
    await flushPromises();

    const editor = editorView();
    expect(editor.state.doc.toString()).toBe("ccdd");
    expect(document.activeElement).toBe(editor.contentDOM);
    expect(selectedAddress()).toBe("A1");
    expect(cellAt("A1").text()).toBe("ccdd");
  });

  it("discards queued typing when Escape is pressed during a save", async () => {
    await mountGrid({ A1: "old" });
    await select("A1");
    await press("Enter");
    await setEditorText("cc");

    const content = editorView().contentDOM;
    dispatchKey(content, "Tab");
    dispatchKey(content, "d");
    dispatchKey(content, "d");
    dispatchKey(content, "Enter");
    const field = wrapper.get(".session-formula-field").element;
    dispatchKey(field, "Escape");
    await flushPromises();

    expect(cellAt("A1").text()).toBe("cc");
    expect(cellAt("B1").text()).toBe("");
    expect(selectedAddress()).toBe("B1");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
  });

  it.each(modifiedNavigationKeys)(
    "does not replay %s received while a cell save is pending",
    async (_label, key, modifiers) => {
      await mountGrid();
      await select("A1");
      await press("Enter");
      await setEditorText("cc");

      dispatchKey(editorView().contentDOM, "Tab");
      const field = wrapper.get(".session-formula-field").element;
      const event = dispatchKey(field, key, modifiers);
      expect(event.defaultPrevented).toBe(false);

      await flushPromises();
      expect(selectedAddress()).toBe("B1");
      expect(wrapper.find(".grid__editor").exists()).toBe(false);
    },
  );

  it.each([
    ["Enter", "A2"],
    ["Tab", "B1"],
  ] as const)(
    "keeps keys typed immediately after %s while the save is pending",
    async (key, next) => {
      await mountGrid({ A1: "old" });
      await select("A1");
      await press("Enter");
      await setEditorText("cc");

      const content = editorView().contentDOM;
      dispatchKey(content, key);
      for (const character of "dd") dispatchKey(content, character);
      await flushPromises();

      expect(editorView().state.doc.toString()).toBe("dd");
      await press("Enter");
      expect(cellAt(next).text()).toBe("dd");
    },
  );

  it("starts with the typed character, replacing the content, and saves on Enter", async () => {
    await mountGrid({ A1: "old" });
    await select("A1");
    await press("7");

    const editor = editorView();
    expect(editor.state.doc.toString()).toBe("7");
    await flushPromises();
    expect(document.activeElement).toBe(editor.contentDOM);

    await setEditorText("75");
    await press("Enter");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ rowId: "r0", colId: "c1", input: "75" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
    expect(cellAt("A1").text()).toBe("75");
    expect(selectedAddress()).toBe("A2");
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });

  it.each(["Enter", "F2"])("opens the existing input for editing with %s", async (key) => {
    await mountGrid({ A1: "5", B1: "=A1*2" });
    await select("B1");
    await press(key);
    expect(editorView().state.doc.toString()).toBe("=A1*2");
  });

  it("opens the existing input on double click", async () => {
    await mountGrid({ A1: "5" });
    await select("A1");
    await cellAt("A1").trigger("dblclick");
    expect(editorView().state.doc.toString()).toBe("5");
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
    (wrapper.get(".grid").element as HTMLElement).focus();
    await flushPromises();
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

  it.each(["ArrowDown", "ArrowUp"])(
    "keeps arrows in the editor without saving with %s",
    async (key) => {
      await mountGrid();
      await select("B2");
      await press("9");
      await press(key);
      expect(selectedAddress()).toBe("B2");
      expect(editorView().state.doc.toString()).toBe("9");
      expect(server.setCells).not.toHaveBeenCalled();
    },
  );

  it.each(["Delete", "Backspace"])("clears the selected cell with %s", async (key) => {
    await mountGrid({ A1: "gone" });
    await select("A1");
    await press(key);
    expect(cellAt("A1").text()).toBe("");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ rowId: "r0", colId: "c1", input: "" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
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
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [
        { rowId: "r0", colId: "c1", input: "" },
        { rowId: "r0", colId: "c2", input: "" },
        { rowId: "r1", colId: "c1", input: "" },
      ],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
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
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledOnce();
    });
    await wrapper.vm.$nextTick();
    expect(["B1", "B2", "B3"].map((address) => cellAt(address).text())).toEqual(["10", "20", "30"]);
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [
        { rowId: "r1", colId: "c2", input: "=A2*10" },
        { rowId: "r2", colId: "c2", input: "=A3*10" },
      ],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
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
    await focusAndSelect("C4");
    clipboard("paste", "one\ntwo\nthree");
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledOnce();
    });
    expect(server.updateTable).not.toHaveBeenCalled();
    const [, cells, , revision, appended] = server.setCells.mock.calls[0]!;
    expect(revision).toBe(0);
    expect(appended).toHaveLength(2);
    expect(cells.map((cell) => cell.rowId)).toEqual(["r3", ...appended!]);
    await flushPromises();
    expect(useWorkbookStore().tables[0]?.rowCount).toBe(6);
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
    return [...document.querySelectorAll('.cm-tooltip-autocomplete [role="option"]')].map(
      (option) => option.querySelector(".cm-completionLabel")?.textContent,
    );
  }

  function editor() {
    return editorView();
  }

  /** Starts editing A1 and types the text. */
  async function type(text: string): Promise<void> {
    await select("A1");
    await press(text.charAt(0));
    await setEditorText(text);
    if (text.startsWith("=") && /[A-Za-z_]$/.test(text)) {
      startCompletion(editor());
      await vi.waitFor(() => {
        expect(completionStatus(editor().state)).toBe("active");
      });
    }
  }

  it("lists matching functions while a formula is typed, and completes with Tab", async () => {
    await mountGrid();
    await type("=rou");
    expect(options()).toEqual(["ROUND", "ROUNDDOWN", "ROUNDUP"]);
    expect(document.querySelector('[role="option"][aria-selected="true"]')?.textContent).toContain(
      "ROUND(number, [digits])",
    );

    await press("Tab");
    expect(editor().state.doc.toString()).toBe("=ROUND(");
    expect(selectedAddress()).toBe("A1");
    expect(options()).toEqual([]);
    expect(document.querySelector(".formula-editor__signature")?.textContent).toContain(
      "ROUND(number, [digits])",
    );
  });

  it("saves the cell on Enter while the list has not been touched", async () => {
    await mountGrid();
    await type("=ab");
    expect(options()).toEqual(["ABS"]);
    await press("Enter");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ rowId: "r0", colId: "c1", input: "=ab" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
    expect(selectedAddress()).toBe("A2");
    expect(document.querySelector(".cm-tooltip-autocomplete")).toBeNull();
  });

  it("moves the highlight with the arrows, then accepts it with Enter", async () => {
    await mountGrid();
    await type("=rou");
    await press("ArrowDown");
    await press("ArrowDown");
    await press("ArrowUp");
    expect(selectedAddress()).toBe("A1");
    await press("Enter");
    expect(editor().state.doc.toString()).toBe("=ROUNDDOWN(");
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("keeps the highlighted completion when a save refreshes the naming context", async () => {
    await mountGrid();
    await type("=cou");
    await press("ArrowDown");
    const store = useWorkbookStore();
    store.tables = store.tables.map((table) => ({ ...table }));
    await wrapper.vm.$nextTick();
    await press("Enter");
    expect(editor().state.doc.toString()).toBe("=COUNTA(");
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("wraps the highlight around the ends of the list", async () => {
    await mountGrid();
    await type("=rou");
    await press("ArrowUp");
    await press("Enter");
    expect(editor().state.doc.toString()).toBe("=ROUNDUP(");
  });

  it("closes the list on Escape, and cancels the edit on a second Escape", async () => {
    await mountGrid({ A1: "kept" });
    await type("=rou");
    await press("Escape");
    expect(options()).toEqual([]);
    expect(editor().state.doc.toString()).toBe("=rou");

    await press("Escape");
    expect(wrapper.find(".grid__editor").exists()).toBe(false);
    expect(cellAt("A1").text()).toBe("kept");
  });

  it("accepts a clicked suggestion without ending the edit", async () => {
    await mountGrid();
    await type("=rou");
    const option = document.querySelectorAll('.cm-tooltip-autocomplete [role="option"]')[2];
    await new DOMWrapper(option).trigger("mousedown");
    await new DOMWrapper(option).trigger("click");
    await flushPromises();
    expect(editor().state.doc.toString()).toBe("=ROUNDUP(");
    // The editor keeps focus, so the click did not end the edit.
    expect(document.activeElement).toBe(editor().contentDOM);
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("offers tables of the cell's page and completes one with its qualifier", async () => {
    await mountGrid();
    await type("=tab");
    expect(options()).toEqual(["Table 1"]);
    await press("Tab");
    expect(editor().state.doc.toString()).toBe("='Table 1'!");
  });

  it("shows what the function at the caret expects", async () => {
    await mountGrid();
    await type("=IF(A2 > 1, ");
    expect(options()).toEqual([]);
    expect(document.querySelector(".formula-editor__signature")?.textContent).toContain(
      "IF(condition, then, [else])",
    );
  });

  it("offers nothing while plain text is typed, and nothing when not editing", async () => {
    await mountGrid();
    expect(document.querySelector(".cm-tooltip-autocomplete")).toBeNull();
    await type("sum");
    expect(document.querySelector(".cm-tooltip-autocomplete")).toBeNull();
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
    expect(server.click).toHaveBeenCalledExactlyOnceWith(identifiedAt("B1"));
  });

  it("waits for confirmation before sending a cell button click", async () => {
    await mountGrid({ A1: "keep", B1: '=BUTTON("Clear", CLEAR(A1), "Clear A1?")' });
    server.click.mockResolvedValue(clickResult({ cells: [{ ...at("A1"), input: "" }] }));

    const trigger = cellAt("B1").get<HTMLButtonElement>("button");
    trigger.element.focus();
    await trigger.trigger("click");
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(dialog?.textContent).toContain("Clear A1?");
    expect(document.activeElement?.textContent).toBe("Cancel");
    expect(server.click).not.toHaveBeenCalled();

    const cancel = document.querySelector<HTMLButtonElement>(
      ".confirm-dialog__actions button:first-child",
    );
    const enter = new KeyboardEvent("keydown", {
      key: "Enter",
      bubbles: true,
      cancelable: true,
    });
    cancel?.dispatchEvent(enter);
    await flushPromises();
    expect(enter.defaultPrevented).toBe(false);
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(server.click).not.toHaveBeenCalled();
    cancel?.click();

    await flushPromises();
    expect(server.click).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(trigger.element);

    await trigger.trigger("click");
    document
      .querySelector<HTMLButtonElement>(".confirm-dialog__actions button:last-child")
      ?.click();
    await flushPromises();
    expect(server.click).toHaveBeenCalledExactlyOnceWith(identifiedAt("B1"));
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

  it("takes the keyboard when the store asks, if the selected cell is in this table", async () => {
    await mountGrid();
    const store = useWorkbookStore();
    store.focusGrid();
    await wrapper.vm.$nextTick();
    expect(document.activeElement).not.toBe(wrapper.get(".grid").element);

    store.selection = at("B2");
    store.focusGrid();
    await wrapper.vm.$nextTick();
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });

  it("scrolls the selected cell into view when the selection moves", async () => {
    await mountGrid();
    await select("B2");
    wrapper.get<HTMLElement>(".grid").element.focus();
    await press("ArrowDown");
    await wrapper.vm.$nextTick();
    const scrolled = vi.mocked(Element.prototype.scrollIntoView).mock.contexts;
    expect(scrolled.at(-1)).toBe(cellAt("B3").element);
  });

  it("opens the button's formula for editing with Enter", async () => {
    await mountGrid({ B1: BUTTON });
    await select("B1");
    await press("Enter");
    expect(editorView().state.doc.toString()).toBe(BUTTON);
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
    expect(server.input).toHaveBeenCalledExactlyOnceWith(identifiedAt("B1"), true);
    expect(cellAt("B1").get<HTMLInputElement>("input").element.checked).toBe(true);
    expect(useWorkbookStore().notice).toBeNull();
  });

  it("selects a CHECKBOX cell without toggling, and toggles it with Space", async () => {
    await mountGrid({ A1: "FALSE", B1: '=CHECKBOX(A1, "Done")' });
    server.input.mockResolvedValue(clickResult({ cells: [{ ...at("A1"), input: "TRUE" }] }));

    await cellAt("B1").trigger("mousedown");
    await cellAt("B1").trigger("click");
    expect(selectedAddress()).toBe("B1");
    expect(server.input).not.toHaveBeenCalled();
    expect(cellAt("B1").get<HTMLInputElement>("input").element.checked).toBe(false);

    const repeated = dispatchKey(wrapper.get(".grid").element, " ", { repeat: true });
    expect(repeated.defaultPrevented).toBe(true);
    expect(server.input).not.toHaveBeenCalled();

    await press(" ");
    await vi.waitFor(() => {
      expect(server.input).toHaveBeenCalledExactlyOnceWith(identifiedAt("B1"), true);
    });
    expect(cellAt("B1").get<HTMLInputElement>("input").element.checked).toBe(true);
  });

  it("does not toggle or edit a CHECKBOX cell when Space is pressed on a range", async () => {
    await mountGrid({ A1: "FALSE", B1: "=CHECKBOX(A1)" });
    await select("B1");
    await press("ArrowDown", { shiftKey: true });
    expect(useWorkbookStore().selectionEnd).not.toBeNull();

    await press(" ");

    expect(wrapper.find(".grid__editor").exists()).toBe(false);
    expect(server.input).not.toHaveBeenCalled();
  });

  it("does not toggle a CHECKBOX control on a modifier-click", async () => {
    await mountGrid({ A1: "FALSE", B1: "=CHECKBOX(A1)" });
    await select("A1");
    const box = cellAt("B1").get<HTMLInputElement>("input");
    await box.trigger("mousedown", { ctrlKey: true });

    const click = new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true });
    box.element.dispatchEvent(click);

    expect(selectedAddress()).toBe("B1");
    expect(click.defaultPrevented).toBe(true);
    expect(box.element.checked).toBe(false);
    expect(server.input).not.toHaveBeenCalled();
  });

  it.each([
    ["Shift", { shiftKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
  ] as const)(
    "does not toggle a CHECKBOX control on a %s-click in its hit area",
    async (_key, modifiers) => {
      await mountGrid({ A1: "FALSE", B1: "=CHECKBOX(A1)" });
      await select("A1");
      const target = cellAt("B1").get(".cell-control__checkbox-target");
      await target.trigger("mousedown", modifiers);

      const click = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers });
      target.element.dispatchEvent(click);

      if ("shiftKey" in modifiers) expect(useWorkbookStore().selectionEnd).not.toBeNull();
      else expect(selectedAddress()).toBe("B1");
      expect(click.defaultPrevented).toBe(true);
      expect(cellAt("B1").get<HTMLInputElement>("input").element.checked).toBe(false);
      expect(server.input).not.toHaveBeenCalled();
    },
  );

  it("does not start editing when a checkbox is double-clicked", async () => {
    await mountGrid({ A1: "FALSE", B1: "=CHECKBOX(A1)" });
    const box = cellAt("B1").get<HTMLInputElement>("input");

    await box.trigger("dblclick");

    expect(wrapper.find(".grid__editor").exists()).toBe(false);
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
    expect(server.input).toHaveBeenCalledExactlyOnceWith(identifiedAt("C1"), "low");
  });

  it("commits text and number inputs bound to stored cells", async () => {
    await mountGrid({ A1: "name", A2: "1.5", B1: "=TEXTBOX(A1)", C1: "=NUMBERBOX(A2)" });
    server.input.mockImplementation((_cell, value) =>
      Promise.resolve(
        clickResult({
          cells: [
            {
              ...identifiedAt(value === "updated" ? "A1" : "A2"),
              input: value === "updated" ? "updated" : String(value),
            },
          ],
        }),
      ),
    );

    const text = cellAt("B1").get<HTMLInputElement>('input[type="text"]');
    await text.setValue("updated");
    await text.trigger("keydown", { key: "Enter" });
    await vi.waitFor(() => {
      expect(cellAt("A1").text()).toBe("updated");
    });
    expect(server.input).toHaveBeenNthCalledWith(1, identifiedAt("B1"), "updated");

    const number = cellAt("C1").get<HTMLInputElement>('input[type="number"]');
    await number.setValue("2.75");
    await number.trigger("blur");
    await vi.waitFor(() => {
      expect(cellAt("A2").text()).toBe("2.75");
    });
    expect(server.input).toHaveBeenNthCalledWith(2, identifiedAt("C1"), 2.75);
  });

  it("sends an empty value when the blank choice is picked", async () => {
    await mountGrid({ B1: "x", C1: '=DROPDOWN("x, y", B1)' });
    await cellAt("C1").get("select").setValue("-1");
    await vi.waitFor(() => {
      expect(server.input).toHaveBeenCalledExactlyOnceWith(identifiedAt("C1"), null);
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
  it("retains the selection when saving another formula editor fails", async () => {
    await mountGrid();
    await select("A1");
    const store = useWorkbookStore();
    store.views = [
      {
        id: "chart",
        kind: "chart",
        pageId: "p1",
        name: "Chart",
        source: "1",
        chartType: "bar",
        position: 1,
      },
    ];
    const formulas = useFormulaSessionStore();
    await formulas.start(
      {
        target: { kind: "chart", viewId: "chart" },
        context: { pageId: "p1" },
        mode: "formula",
        text: "draft",
      },
      store.submitFormulaDraft,
    );
    server.updateView.mockRejectedValue(new Error("Offline"));
    await cellAt("B2").trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(store.selection).toEqual(at("A1"));
    await wrapper.get("thead th:nth-child(3)").trigger("mousedown", { button: 0 });
    await flushPromises();
    expect(store.selection).toEqual(at("A1"));
    expect(store.selectionEnd).toBeNull();
    await cellAt("B2").trigger("contextmenu");
    await flushPromises();
    await wrapper.get("thead th:nth-child(3)").trigger("contextmenu");
    await flushPromises();
    expect(store.selection).toEqual(at("A1"));
    expect(store.selectionEnd).toBeNull();
    expect(wrapper.emitted("menu")).toBeUndefined();
    expect(formulas.active?.state.doc.toString()).toBe("draft");
  });
  const range = () => {
    const selected = useWorkbookStore().selectedRange;
    if (!selected) return null;
    return {
      startRow: selected.startRow,
      startCol: selected.startCol,
      endRow: selected.endRow,
      endCol: selected.endCol,
    };
  };

  it("selects a whole row or column from its header", async () => {
    await mountGrid();
    await wrapper.findAll("tbody th")[1]!.trigger("mousedown");
    expect(range()).toEqual({ startRow: 1, endRow: 1, startCol: 0, endCol: 2 });
    expect(useWorkbookStore().selectedRange).toMatchObject({ entireRow: true });
    await wrapper.findAll("thead th")[2]!.trigger("mousedown");
    expect(range()).toEqual({ startRow: 0, endRow: 3, startCol: 1, endCol: 1 });
    expect(useWorkbookStore().selectedRange).toMatchObject({ entireColumn: true });
    expect(document.activeElement).toBe(wrapper.get(".grid").element);
  });

  it("selects every cell with Ctrl+A", async () => {
    await mountGrid();
    await select("B2");
    await press("a", { ctrlKey: true });
    expect(range()).toEqual({ startRow: 0, endRow: 3, startCol: 0, endCol: 2 });
  });

  it("asks for the menu where a cell is right-clicked, and selects that cell", async () => {
    await mountGrid();
    await select("A1");
    await cellAt("B3").trigger("contextmenu", { clientX: 120, clientY: 80 });
    expect(selectedAddress()).toBe("B3");
    expect(wrapper.emitted("menu")).toEqual([[{ x: 120, y: 80, scope: "cells" }]]);
  });

  it("keeps a selected range when the right-click is inside it", async () => {
    await mountGrid();
    await select("A1");
    await cellAt("B2").trigger("mousedown", { shiftKey: true });
    await cellAt("B1").trigger("contextmenu");
    expect(range()).toEqual({ startRow: 0, endRow: 1, startCol: 0, endCol: 1 });
    expect(wrapper.emitted("menu")).toHaveLength(1);
  });

  it("asks for the menu from a header after selecting its row or column", async () => {
    await mountGrid();
    await wrapper.findAll("tbody th")[2]!.trigger("contextmenu", { clientX: 5, clientY: 6 });
    expect(range()).toEqual({ startRow: 2, endRow: 2, startCol: 0, endCol: 2 });
    expect(wrapper.emitted("menu")).toEqual([[{ x: 5, y: 6, scope: "row" }]]);
    await wrapper.findAll("thead th")[1]!.trigger("contextmenu", { clientX: 7, clientY: 8 });
    expect(range()).toEqual({ startRow: 0, endRow: 3, startCol: 0, endCol: 0 });
    expect(wrapper.emitted("menu")?.[1]).toEqual([{ x: 7, y: 8, scope: "col" }]);
  });

  const release = (): boolean => window.dispatchEvent(new MouseEvent("mouseup"));

  it("selects several rows or columns when the mouse is dragged over their headers", async () => {
    await mountGrid();
    const rows = wrapper.findAll("tbody th");
    await rows[1]!.trigger("mousedown");
    await rows[2]!.trigger("mouseenter");
    await rows[3]!.trigger("mouseenter");
    expect(range()).toEqual({ startRow: 1, endRow: 3, startCol: 0, endCol: 2 });
    // Back over fewer rows, and into the cells: the drag still selects whole rows.
    await cellAt("B3").trigger("mouseenter");
    expect(range()).toEqual({ startRow: 1, endRow: 2, startCol: 0, endCol: 2 });
    expect(rows.map((row) => row.classes("grid__header--selected"))).toEqual([
      false,
      true,
      true,
      false,
    ]);
    release();
    await rows[0]!.trigger("mouseenter");
    expect(range()).toEqual({ startRow: 1, endRow: 2, startCol: 0, endCol: 2 });

    const columns = wrapper.findAll("thead th");
    await columns[3]!.trigger("mousedown");
    await columns[1]!.trigger("mouseenter");
    // A column drag pays no attention to the row headers it crosses.
    await rows[2]!.trigger("mouseenter");
    release();
    expect(range()).toEqual({ startRow: 0, endRow: 3, startCol: 0, endCol: 2 });
  });

  it("selects from the selected cell's row or column to a header clicked with Shift", async () => {
    await mountGrid();
    await select("B2");
    await wrapper.findAll("tbody th")[3]!.trigger("mousedown", { shiftKey: true });
    expect(range()).toEqual({ startRow: 1, endRow: 3, startCol: 0, endCol: 2 });
    release();
    await select("C1");
    await wrapper.findAll("thead th")[1]!.trigger("mousedown", { shiftKey: true });
    expect(range()).toEqual({ startRow: 0, endRow: 3, startCol: 0, endCol: 2 });
  });

  it("keeps several selected rows when the right-click is on one of their headers", async () => {
    await mountGrid();
    const rows = wrapper.findAll("tbody th");
    await rows[1]!.trigger("mousedown");
    await rows[2]!.trigger("mouseenter");
    release();
    await rows[2]!.trigger("contextmenu");
    expect(range()).toEqual({ startRow: 1, endRow: 2, startCol: 0, endCol: 2 });
    // A header outside them selects its own row, as does a column header.
    await rows[0]!.trigger("contextmenu");
    expect(range()).toEqual({ startRow: 0, endRow: 0, startCol: 0, endCol: 2 });
    await wrapper.findAll("thead th")[1]!.trigger("contextmenu");
    expect(range()).toEqual({ startRow: 0, endRow: 3, startCol: 0, endCol: 0 });
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
    const editor = editorView();
    expect(editor.state.doc.toString()).toBe("hello");
    await flushPromises();
    expect(document.activeElement).toBe(editor.contentDOM);
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

describe("a data table", () => {
  const DATA_TABLE = {
    ...TABLE,
    columns: [
      { name: "Item", type: "any" as const },
      { name: "Done", type: "checkbox" as const },
      { name: "Twice", type: "formula" as const, formula: "=[Item] * 2" },
    ],
  };

  async function mountData(inputs: Record<string, string> = {}, role = "owner"): Promise<void> {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({ ...snapshotWith(inputs, role), tables: [DATA_TABLE] }),
    );
    await useWorkbookStore().load("s1");
    wrapper = mount(GridView, { props: { table: DATA_TABLE }, attachTo: document.body });
  }

  const header = (name: string) => wrapper.get(`thead th[data-column="${name}"]`);

  it("heads each column with its name, its letter, and its type", async () => {
    await mountData();
    const part = (selector: string): string[] =>
      wrapper.findAll(`thead th ${selector}`).map((found) => found.text());
    expect(part(".grid__column-letter")).toEqual(["A", "B", "C"]);
    expect(part(".editable-name")).toEqual(["Item", "Done", "Twice"]);
    expect(part(".grid__column-type")).toEqual(["checkbox", "formula"]);
  });

  it("renames a column from its header", async () => {
    await mountData();
    server.updateColumn.mockResolvedValue(
      changeWith({ table: DATA_TABLE, cells: [], views: [], tables: [] }),
    );
    await header("Item").get(".editable-name").trigger("dblclick");
    const input = header("Item").get("input");
    // A press inside the box places the caret and does not select the column.
    await input.trigger("mousedown");
    expect(useWorkbookStore().selection).toBeNull();
    await input.setValue("Thing");
    await input.trigger("keydown", { key: "Enter" });
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c1", {
      revision: expect.any(Number),
      name: "Thing",
    });
  });

  it("still selects the column when its header is pressed", async () => {
    await mountData();
    await header("Done").trigger("mousedown");
    expect(useWorkbookStore().selectedRange).toEqual({
      startRow: 0,
      endRow: 3,
      startCol: 1,
      endCol: 1,
      entireColumn: true,
    });
  });

  it("shows a checkbox in every cell of a checkbox column, and stores a tick", async () => {
    await mountData({ B1: "TRUE", B2: "FALSE" });
    const boxes = ["B1", "B2", "B3"].map((address) =>
      cellAt(address).get<HTMLInputElement>("input"),
    );
    expect(boxes.map((box) => box.element.checked)).toEqual([true, false, false]);
    await boxes[2]!.setValue(true);
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ rowId: "r2", colId: "c2", input: "TRUE" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
    await boxes[0]!.setValue(false);
    expect(server.setCells).toHaveBeenLastCalledWith(
      "t1",
      [{ rowId: "r0", colId: "c2", input: "FALSE" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
  });

  it("selects checkbox-column cells outside the box and toggles a selected cell with Space", async () => {
    await mountData({ B1: "FALSE" });

    await cellAt("B1").trigger("mousedown");
    await cellAt("B1").trigger("click");
    expect(selectedAddress()).toBe("B1");
    expect(server.setCells).not.toHaveBeenCalled();
    expect(cellAt("B1").get<HTMLInputElement>("input").element.checked).toBe(false);

    await press(" ");
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
        "t1",
        [{ rowId: "r0", colId: "c2", input: "TRUE" }],
        expect.any(String),
        expect.any(Number),
        expect.any(Array),
      );
    });
    expect(cellAt("B1").get<HTMLInputElement>("input").element.checked).toBe(true);

    const nextBox = cellAt("B2").get<HTMLInputElement>("input");
    await nextBox.trigger("mousedown");
    await nextBox.setValue(true);
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledTimes(2);
    });
    expect(selectedAddress()).toBe("B2");
  });

  it.each([
    ["Shift", { shiftKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
  ] as const)("does not toggle a checkbox on a %s-click", async (_modifier, modifiers) => {
    await mountData({ B1: "FALSE" });
    await select("A1");
    const box = cellAt("B1").get<HTMLInputElement>("input");
    await box.trigger("mousedown", modifiers);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true, ...modifiers });
    box.element.dispatchEvent(click);

    expect(click.defaultPrevented).toBe(true);
    expect(box.element.checked).toBe(false);
    expect(server.setCells).not.toHaveBeenCalled();
    if ("shiftKey" in modifiers) expect(useWorkbookStore().selectionEnd).not.toBeNull();
    else expect(selectedAddress()).toBe("B1");
  });

  it("does not open an editor for Space on a checkbox-column range", async () => {
    await mountData({ B1: "FALSE" });
    await select("B1");
    await press("ArrowDown", { shiftKey: true });
    expect(useWorkbookStore().selectionEnd).not.toBeNull();

    await press(" ");

    expect(wrapper.find(".grid__editor").exists()).toBe(false);
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("shows the error for something in a checkbox column that is not TRUE or FALSE", async () => {
    await mountData({ B1: "maybe" });
    expect(cellAt("B1").find("input").exists()).toBe(false);
    expect(cellAt("B1").text()).toBe("#VALUE!");
  });

  it("marks the cells of a formula column, which show the column's formula result", async () => {
    await mountData({ A1: "4" });
    expect(cellAt("C1").classes()).toContain("grid__cell--computed");
    expect(cellAt("C1").text()).toBe("8");
    expect(cellAt("A1").classes()).not.toContain("grid__cell--computed");
  });

  it("gives a viewer the names without the means to change them", async () => {
    await mountData({ B1: "TRUE" }, "viewer");
    await header("Item").get(".editable-name").trigger("dblclick");
    expect(header("Item").find("input").exists()).toBe(false);
    expect(cellAt("B1").get("input").attributes("disabled")).toBeDefined();
  });
});

describe("formats", () => {
  it("shows cells with the formats their table gives them", async () => {
    const formats = [
      {
        startRow: 0,
        endRow: 0,
        startCol: 0,
        endCol: null,
        format: { bold: true, fill: "yellow" as const },
      },
      {
        startRow: 0,
        endRow: null,
        startCol: 1,
        endCol: 1,
        format: { numberFormat: "0.00", color: "green" as const },
      },
    ];
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith({ A1: "x", B1: "2", B2: "=1/0", B3: "3.14159" }),
        tables: [{ ...TABLE, formats }],
      }),
    );
    await useWorkbookStore().load("s1");
    wrapper = mount(GridView, { props: { table: { ...TABLE, formats } }, attachTo: document.body });

    expect(cellAt("A1").attributes("style")).toContain("background");
    expect(cellAt("A1").get(".cell-value").attributes("style")).toContain("font-weight: 700");
    expect(cellAt("A2").attributes("style")).toBeUndefined();
    expect(cellAt("B1").text()).toBe("2.00");
    expect(cellAt("B3").text()).toBe("3.14");
    expect(cellAt("B3").get(".cell-value").attributes("style")).toContain("color");
    // An error keeps the color of errors.
    expect(cellAt("B2").text()).toBe("#DIV/0!");
    expect(cellAt("B2").get(".cell-value").attributes("style") ?? "").not.toContain("color");
  });
});

describe("undo from the keyboard", () => {
  it("takes back an edit with Ctrl+Z and makes it again with Ctrl+Y or Ctrl+Shift+Z", async () => {
    await mountGrid({ A1: "old" });
    await select("A1");
    await press("n");
    await setEditorText("new");
    await press("Enter");
    expect(cellAt("A1").text()).toBe("new");
    notifyJournaled();
    server.undo.mockImplementation(() =>
      Promise.resolve({
        outcome: "done",
        label: "Change cells in Table 1",
        error: null,
        change: changeWith({
          pages: [],
          tables: [],
          views: [],
          cells: [{ ...at("A1"), input: "old" }],
        }),
        undoable: false,
        redoable: true,
      }),
    );
    server.redo.mockImplementation(() =>
      Promise.resolve({
        outcome: "done",
        label: "Change cells in Table 1",
        error: null,
        change: changeWith({
          pages: [],
          tables: [],
          views: [],
          cells: [{ ...at("A1"), input: "new" }],
        }),
        undoable: true,
        redoable: false,
      }),
    );

    await press("z", { ctrlKey: true });
    await vi.waitFor(() => {
      expect(cellAt("A1").text()).toBe("old");
    });
    expect(selectedAddress()).toBe("A2");
    await press("y", { ctrlKey: true });
    await vi.waitFor(() => {
      expect(cellAt("A1").text()).toBe("new");
    });
    await press("z", { ctrlKey: true });
    await vi.waitFor(() => {
      expect(cellAt("A1").text()).toBe("old");
    });
    await press("Z", { ctrlKey: true, shiftKey: true });
    await vi.waitFor(() => {
      expect(cellAt("A1").text()).toBe("new");
    });
  });
});

it("keeps a grid draft attached to its row after a remote insertion", async () => {
  await mountGrid({ A2: "old" });
  await select("A2");
  await press("d");
  await setEditorText("draft");
  const store = useWorkbookStore();
  const snapshot = snapshotWith({ A2: "old" });
  snapshot.tables = [
    { ...TABLE, rowCount: 5, rows: [{ id: "new", orderKey: "Zz" }, ...TABLE.rows] },
  ];
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshot));
  await store.refresh();
  await wrapper.vm.$nextTick();
  expect(selectedAddress()).toBe("A3");
  expect(editorView().state.doc.toString()).toBe("draft");
  expect(server.setCells).not.toHaveBeenCalled();
  await press("Enter");
  await vi.waitFor(() => {
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ rowId: "r1", colId: "c1", input: "draft" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
  });
});

async function mountEmptyDataTable(): Promise<void> {
  const table = {
    ...TABLE,
    rowCount: 0,
    rows: [],
    columns: [
      { name: "Item", type: "any" as const },
      { name: "Count", type: "number" as const },
      { name: "Twice", type: "formula" as const, formula: "=[Count]*2" },
    ],
  };
  server.getSnapshot.mockResolvedValue(wireSnapshot({ ...snapshotWith(), tables: [table] }));
  const store = useWorkbookStore();
  await store.load("s1");
  wrapper = mount(
    {
      components: { GridView },
      setup: () => ({ store }),
      template: '<GridView v-if="store.tables[0]" :table="store.tables[0]" />',
    },
    { attachTo: document.body },
  );
}

it("types into an empty data table's new-row line and moves the line down", async () => {
  await mountEmptyDataTable();
  expect(wrapper.findAll("tbody tr")).toHaveLength(1);
  await select("A1");
  await press("x");
  await press("Enter");
  await flushPromises();
  expect(server.setCells).toHaveBeenCalledOnce();
  const [, cells, , , appended] = server.setCells.mock.calls[0]!;
  expect(appended).toHaveLength(1);
  expect(cells).toEqual([{ rowId: appended?.[0], colId: "c1", input: "x" }]);
  expect(wrapper.findAll("tbody tr")).toHaveLength(2);
  expect(cellAt("A1").text()).toBe("x");
  expect(cellAt("A2").text()).toBe("");
});

it("keeps a new-row draft separate from a row appended remotely", async () => {
  await mountEmptyDataTable();
  await select("A1");
  await press("m");
  const store = useWorkbookStore();
  await store.receiveChange(
    changeWith({
      rows: [{ id: "remote", tableId: "t1", orderKey: "a0" }],
      cells: [{ tableId: "t1", rowId: "remote", colId: "c1", input: "theirs" }],
    }),
  );
  await wrapper.vm.$nextTick();
  expect(selectedAddress()).toBe("A2");
  await press("Enter");
  await flushPromises();
  expect(cellAt("A1").text()).toBe("theirs");
  expect(cellAt("A2").text()).toBe("m");
  expect(store.tables[0]?.rowCount).toBe(2);
});

it("saves a formula draft literally after its target moves", async () => {
  await mountGrid({ A1: "old" });
  await select("A1");
  await press("=");
  await setEditorText("=A2");
  const store = useWorkbookStore();
  await store.receiveChange(
    changeWith({ rows: [{ id: "remote", tableId: "t1", orderKey: "Zz" }] }),
  );
  await press("Enter");
  await flushPromises();
  expect(store.inputOf(at("A2"))).toBe("=A2");
  expect(wrapper.find(".grid__editor").exists()).toBe(false);
});

describe("a sorted and filtered data table", () => {
  // The Item column reads b, d, a, c down the stored rows, and Qty reads 1 to 4.
  const INPUTS = {
    A1: "b",
    A2: "d",
    A3: "a",
    A4: "c",
    B1: "1",
    B2: "2",
    B3: "3",
    B4: "4",
  };
  const COLUMNS = [
    { name: "Item", type: "any" as const },
    { name: "Qty", type: "number" as const },
    { name: "Twice", type: "formula" as const, formula: "=[Qty] * 2" },
  ];

  async function mountShown(
    display: (typeof TABLE)["display"],
    inputs: Record<string, string> = INPUTS,
  ): Promise<void> {
    const table = { ...TABLE, columns: COLUMNS, display };
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({ ...snapshotWith(inputs), tables: [table] }),
    );
    await useWorkbookStore().load("s1");
    wrapper = mount(GridView, { props: { table }, attachTo: document.body });
  }

  const SORTED = { sort: [{ colId: "c1", descending: false }] };
  it("resizes the stored identity of a sorted row and leaves the append row unsized", async () => {
    await mountShown(SORTED);
    server.resizeLines.mockResolvedValue(changeWith());
    const handle = wrapper.get('[aria-label="Resize row 3"]');
    mockPointerCapture(handle.element);
    dispatchPointer(handle.element, "pointerdown", { clientY: 100 });
    dispatchPointer(window, "pointermove", { clientY: 140 });
    dispatchPointer(window, "pointerup");
    await flushPromises();
    expect(server.resizeLines).toHaveBeenCalledExactlyOnceWith("t1", {
      axis: "row",
      ids: ["r2"],
      size: 70,
    });
    expect(wrapper.findAll("tbody tr").at(-1)!.find(".grid__resize").exists()).toBe(false);
  });
  const shownAddresses = (): (string | undefined)[] =>
    wrapper.findAll("tbody tr td:first-of-type").map((cell) => cell.attributes("data-cell"));

  it("shows the rows in the order of the sort, each with its stored row number and address", async () => {
    await mountShown(SORTED);
    expect(shownAddresses()).toEqual(["A3", "A1", "A4", "A2", "A5"]);
    expect(wrapper.findAll("tbody th").map((th) => th.text())).toEqual(["3", "1", "4", "2", "+"]);
    expect(wrapper.findAll("tbody tr td:first-of-type").map((cell) => cell.text())).toEqual([
      "a",
      "b",
      "c",
      "d",
      "",
    ]);
  });

  it("sorts descending, and leaves out the rows a filter rejects", async () => {
    await mountShown({ sort: [{ colId: "c1", descending: true }], filter: "=[Qty] > 1" });
    expect(shownAddresses()).toEqual(["A2", "A4", "A3", "A5"]);
    expect(wrapper.findAll("tbody th").map((th) => th.text())).toEqual(["2", "4", "3", "+"]);
  });

  it("moves the selection through the rows in the order shown", async () => {
    await mountShown(SORTED);
    await select("A3");
    await press("ArrowDown");
    expect(selectedAddress()).toBe("A1");
    await press("ArrowDown");
    await press("ArrowDown");
    expect(selectedAddress()).toBe("A2");
    await press("ArrowUp");
    expect(selectedAddress()).toBe("A4");
  });

  it("moves from the top of a whole column when its anchor row is filtered out", async () => {
    await mountShown({
      sort: [{ colId: "c2", descending: true }],
      filter: "=[Qty] < 3",
    });
    const store = useWorkbookStore();
    store.selection = at("B4");
    store.extendSelection(at("B4"), "col");

    await press("ArrowRight");

    expect(selectedAddress()).toBe("C2");
  });

  it("keeps a whole-column selection when Shift extends it across columns", async () => {
    await mountShown({
      sort: [{ colId: "c2", descending: true }],
      filter: "=[Qty] >= 3",
    });
    const store = useWorkbookStore();
    store.selection = at("B4");
    store.extendSelection(at("B3"), "col");

    await press("ArrowRight", { shiftKey: true });

    expect(store.selectedRange).toMatchObject({
      startCol: 1,
      endCol: 2,
      entireColumn: true,
    });
    server.setConditionalFormats.mockResolvedValue(changeWith());
    expect(
      await store.addConditionalFormat({
        kind: "criterion",
        criterion: ">0",
        format: { bold: true },
      }),
    ).toBe(true);
    expect(server.setConditionalFormats).toHaveBeenCalledOnce();
  });

  it("selects a rectangle of the rows shown", async () => {
    await mountShown(SORTED);
    await select("A1");
    await cellAt("A4").trigger("mousedown", { shiftKey: true });
    window.dispatchEvent(new MouseEvent("mouseup"));
    expect(
      wrapper.findAll(".grid__cell--in-range").map((cell) => cell.attributes("data-cell")),
    ).toEqual(["A1", "A4"]);
  });

  it("clears the stored rows of the cells selected", async () => {
    await mountShown(SORTED);
    await select("A3");
    await cellAt("A1").trigger("mousedown", { shiftKey: true });
    window.dispatchEvent(new MouseEvent("mouseup"));
    await press("Delete");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [
        { rowId: "r2", colId: "c1", input: "" },
        { rowId: "r0", colId: "c1", input: "" },
      ],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
  });

  it("fills down the rows shown, moving a formula by the distance between the stored rows", async () => {
    // Sorted by Qty descending the places are stored rows 4, 3, 2, 1. A formula in the first
    // place, stored row 4, moves up one row for the second place and two for the third.
    await mountShown({ sort: [{ colId: "c2", descending: true }] }, { ...INPUTS, A4: "=B4*10" });
    await select("A4");
    await wrapper.get(".grid__fill-handle").trigger("mousedown");
    await cellAt("A2").trigger("mouseenter");
    window.dispatchEvent(new MouseEvent("mouseup"));
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledOnce();
    });
    expect(server.setCells.mock.calls[0]?.[1]).toEqual([
      { rowId: "r2", colId: "c1", input: "=B3*10" },
      { rowId: "r1", colId: "c1", input: "=B2*10" },
    ]);
  });

  it("saves an edit and moves to the row that was below it, though the edit moves its own row", async () => {
    await mountShown(SORTED);
    await select("A3");
    await press("z");
    await press("Enter");
    // The row held a and now holds z, which sorts last. Enter went to b, the row shown next.
    expect(selectedAddress()).toBe("A1");
    expect(shownAddresses().slice(0, 4)).toEqual(["A1", "A4", "A2", "A3"]);
  });

  it("returns to the starting column while skipping filtered rows", async () => {
    await mountShown({ sort: [], filter: "=[Qty] > 2" });
    await select("A3");
    await press("Tab");
    await press("Tab");
    await press("Enter");
    await press("Enter");
    expect(selectedAddress()).toBe("A4");
  });

  it("returns to the starting column on the next displayed row", async () => {
    await mountShown(SORTED);
    await select("A3");
    await press("Tab");
    await press("Tab");
    await press("Enter");
    await press("Enter");
    expect(selectedAddress()).toBe("A1");
  });

  it("copies the cells in the order shown", async () => {
    await mountShown(SORTED);
    await select("A3");
    await cellAt("C4").trigger("mousedown", { shiftKey: true });
    window.dispatchEvent(new MouseEvent("mouseup"));
    wrapper.get<HTMLElement>(".grid").element.focus();
    const data = new Map<string, string>();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.assign(event, {
      clipboardData: {
        getData: () => "",
        setData: (_: string, value: string) => data.set("t", value),
      },
    });
    document.dispatchEvent(event);
    expect(data.get("t")).toBe("a\t3\t6\nb\t1\t2\nc\t4\t8");
  });

  it("clears the selection when a filter hides the row it is in", async () => {
    await mountShown({ sort: [], filter: "=[Qty] > 1" });
    expect(shownAddresses()).toEqual(["A2", "A3", "A4", "A5"]);
    await select("B2");
    await press("0");
    // Tab stays in the row, which the new Qty of 0 no longer lets through the filter.
    await press("Tab");
    expect(wrapper.find('[data-cell="A2"]').exists()).toBe(false);
    expect(selectedAddress()).toBeUndefined();
  });

  it("selects the cell clicked, though the edit it commits re-sorts the rows", async () => {
    await mountShown(SORTED);
    await select("A3");
    await press("z");
    // The row under the pointer is b (A1), the second place, when the click lands.
    await cellAt("A1").trigger("mousedown");
    await flushPromises();
    expect(selectedAddress()).toBe("A1");
  });
});

describe("a dropdown column", () => {
  const CHOICE_TABLE = {
    ...TABLE,
    columns: [
      { name: "Race", type: "choice" as const, choices: ["Trial", "007", "=1+1"] },
      { name: "Other", type: "any" as const },
      { name: "More", type: "any" as const },
    ],
  };

  it("stores a picked choice as the text it is, even when it reads as a number or a formula", async () => {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({ ...snapshotWith(), tables: [CHOICE_TABLE] }),
    );
    await useWorkbookStore().load("s1");
    wrapper = mount(GridView, { props: { table: CHOICE_TABLE }, attachTo: document.body });
    const pick = async (text: string): Promise<void> => {
      await cellAt("A1").get("select").setValue(text);
    };
    await pick("007");
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledTimes(1);
    });
    expect(server.setCells.mock.calls[0]?.[1]).toEqual([
      { rowId: "r0", colId: "c1", input: "'007" },
    ]);
    await pick("=1+1");
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledTimes(2);
    });
    expect(server.setCells.mock.calls[1]?.[1]).toEqual([
      { rowId: "r0", colId: "c1", input: "'=1+1" },
    ]);
  });
});

describe("Tab and Enter traversal", () => {
  it("returns to the starting column after editing across a row", async () => {
    await mountGrid();
    await select("A2");
    await press("Tab");
    await press("x");
    await press("Tab");
    await press("Enter");
    await press("Enter");
    expect(selectedAddress()).toBe("A3");
  });

  it.each(["ArrowLeft", "mouse"])("resets traversal after %s navigation", async (navigation) => {
    await mountGrid();
    await select("A2");
    await press("Tab");
    await press("Tab");
    if (navigation === "mouse") await select("C2");
    else await press(navigation);
    await press("x");
    await press("Enter");
    expect(selectedAddress()).toBe(navigation === "mouse" ? "C3" : "B3");
  });

  it("does not scroll a refreshed selection while another editor has focus", async () => {
    await mountGrid();
    await select("B2");
    const textarea = document.createElement("textarea");
    document.body.append(textarea);
    textarea.focus();
    vi.mocked(Element.prototype.scrollIntoView).mockClear();
    useWorkbookStore().selection = { ...at("B2") };
    await flushPromises();
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(textarea);
    textarea.remove();
  });
});
