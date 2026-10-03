import { savedCells } from "../testing";
import { wireSnapshot, changeWith, createdTable, createdPage, createdView } from "../testing";
import { sizedTable } from "../testing";
import { identifiedAt } from "../testing";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnDefinition, ConditionalRule, FormatRule } from "@spreadsheet-app/engine";
import { computed } from "vue";
import { api, type Snapshot, type ViewRecord } from "../api/client";
import { at, clickResult, notifyJournaled, snapshotWith, TABLE, type MockedApi } from "../testing";
import { useWorkbookStore } from "./workbook";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

type Store = ReturnType<typeof useWorkbookStore>;

async function open(inputs: Record<string, string> = {}, role = "owner"): Promise<Store> {
  server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith(inputs, role)));
  const store = useWorkbookStore();
  await store.load("s1");
  return store;
}

/** A promise the test settles by hand, to hold a request open. */
function deferred(): { promise: Promise<void>; resolve(): void; reject(cause: Error): void } {
  let resolve!: () => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets everything that can run without another answer from the server run. */
function idle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  server.setCells.mockImplementation(savedCells);
  server.deleteTable.mockImplementation((id) =>
    Promise.resolve(changeWith({ tables: [{ id, table: null }] })),
  );
  server.renamePage.mockImplementation((id, name) =>
    Promise.resolve(changeWith({ pages: [{ id, page: { id, name, position: 0 } }] })),
  );
  server.click.mockResolvedValue(clickResult());
});

describe("loading", () => {
  it("computes formula values from the stored inputs", async () => {
    const store = await open({ A1: "2", B1: "=A1*3" });
    expect(store.spreadsheet).toEqual({ id: "s1", name: "Budget", role: "owner" });
    expect(store.inputOf(at("B1"))).toBe("=A1*3");
    expect(store.valueOf(at("B1"))).toBe(6);
    expect(store.valueOf(at("C3"))).toBeNull();
    expect(store.canEdit).toBe(true);
  });

  it("clears the selection and notice left from another spreadsheet", async () => {
    const store = await open();
    store.selection = at("A1");
    store.notice = { kind: "error", text: "old" };
    await store.load("s1");
    expect(store.selection).toBeNull();
    expect(store.notice).toBeNull();
  });

  it("marks a viewer as unable to edit", async () => {
    expect((await open({}, "viewer")).canEdit).toBe(false);
  });

  it("shows the spreadsheet asked for last, whichever answer arrives last", async () => {
    const store = useWorkbookStore();
    const answers = new Map<string, (snapshot: Snapshot) => void>();
    server.getSnapshot.mockImplementation(
      (id) => new Promise<Snapshot>((resolve) => answers.set(id, resolve)),
    );
    const [first, second] = [store.load("s1"), store.load("s2")];
    answers.get("s2")?.({ ...snapshotWith({ A1: "new" }), id: "s2", name: "Second" });
    answers.get("s1")?.(snapshotWith({ A1: "old" }));
    await Promise.all([first, second]);
    expect(store.spreadsheet).toMatchObject({ id: "s2", name: "Second" });
    expect(store.inputOf(at("A1"))).toBe("new");
  });

  it("does not report a failure to read a spreadsheet it has moved on from", async () => {
    const store = useWorkbookStore();
    const gone = deferred();
    server.getSnapshot.mockImplementationOnce(async () => {
      await gone.promise;
      return snapshotWith();
    });
    const first = store.load("s1");
    server.getSnapshot.mockResolvedValue(wireSnapshot({ ...snapshotWith(), id: "s2" }));
    await store.load("s2");
    gone.reject(new Error("Spreadsheet not found"));
    await expect(first).resolves.toBeUndefined();
    expect(store.spreadsheet?.id).toBe("s2");
  });

  /** Another spreadsheet, whose page and table have other ids. */
  const OTHER: Snapshot = {
    ...snapshotWith(),
    id: "s2",
    name: "Second",
    pages: [{ id: "p9", name: "Page 1", position: 0 }],
    tables: [{ ...TABLE, id: "t9", pageId: "p9" }],
  };

  it("keeps a page added to one spreadsheet out of the one opened before the server answered", async () => {
    const store = await open();
    const answered = deferred();
    server.createPage.mockImplementation(async () => {
      await answered.promise;
      return createdPage({
        page: { id: "p2", name: "Page 2", position: 1 },
        table: { ...TABLE, id: "t2", pageId: "p2" },
      });
    });
    const added = store.addPage();
    server.getSnapshot.mockResolvedValue(wireSnapshot(OTHER));
    const opened = store.load("s2");
    await idle();
    answered.resolve();
    await Promise.all([added, opened]);

    expect(store.spreadsheet?.id).toBe("s2");
    expect(store.pages.map((page) => page.id)).toEqual(["p9"]);
    expect(store.tables.map((table) => table.id)).toEqual(["t9"]);
  });

  it("keeps the name given to one spreadsheet off the one opened before the server answered", async () => {
    const store = await open();
    const answered = deferred();
    server.renameSpreadsheet.mockImplementation(() => answered.promise);
    const renamed = store.renameSpreadsheet("Renamed");
    server.getSnapshot.mockResolvedValue(wireSnapshot(OTHER));
    const opened = store.load("s2");
    await idle();
    answered.resolve();
    await Promise.all([renamed, opened]);

    expect(store.spreadsheet).toMatchObject({ id: "s2", name: "Second" });
  });

  it("does not show the failure of a change to one spreadsheet over the one opened next", async () => {
    const store = await open();
    const answered = deferred();
    server.createPage.mockImplementation(async () => {
      await answered.promise;
      throw new Error("Too many pages");
    });
    const added = store.addPage();
    server.getSnapshot.mockResolvedValue(wireSnapshot(OTHER));
    const opened = store.load("s2");
    await idle();
    answered.resolve();
    await Promise.all([added, opened]);

    expect(store.spreadsheet?.id).toBe("s2");
    expect(store.notice).toBeNull();
  });

  it("reads a spreadsheet again when a change was made while it was being read", async () => {
    const store = await open();
    const reads: (() => void)[] = [];
    server.getSnapshot.mockImplementation(
      () =>
        new Promise<Snapshot>((resolve) =>
          reads.push(() => {
            resolve(snapshotWith({ A1: reads.length === 1 ? "stale" : "typed" }));
          }),
        ),
    );
    const opened = store.load("s1");
    // Typed after the read began, so the first answer may not hold it.
    await store.setCell(at("A1"), "typed");
    reads[0]?.();
    await vi.waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    reads[1]?.();
    await opened;

    expect(store.inputOf(at("A1"))).toBe("typed");
  });
});

describe("grid sizes", () => {
  it("saves identities, applies the returned metadata, exports sizes, and applies undo", async () => {
    const store = await open();
    const sized = { ...TABLE, gridSizes: { rows: { r1: 60 }, columns: { c2: 200 } } };
    server.resizeLines.mockResolvedValue(changeWith(sized));
    expect(await store.resizeLines("t1", "col", ["c2"], 200)).toBe(true);
    expect(server.resizeLines).toHaveBeenCalledExactlyOnceWith("t1", {
      axis: "col",
      ids: ["c2"],
      size: 200,
    });
    expect(store.tables[0]!.gridSizes).toEqual(sized.gridSizes);
    expect(store.toFile()?.pages[0]!.blocks[0]).toMatchObject({
      gridSizes: { rows: [{ index: 1, size: 60 }], columns: [{ index: 1, size: 200 }] },
    });
    notifyJournaled();
    server.undo.mockResolvedValue({
      outcome: "done",
      label: "Resize",
      error: null,
      change: changeWith(TABLE),
      undoable: false,
      redoable: true,
    });
    await store.undo();
    expect(store.tables[0]!.gridSizes).toEqual({ rows: {}, columns: {} });
  });

  it("refuses viewer writes and reports a failed save without changing sizes", async () => {
    const viewer = await open({}, "viewer");
    expect(await viewer.resizeLines("t1", "row", ["r1"], 60)).toBe(false);
    expect(server.resizeLines).not.toHaveBeenCalled();
    const store = await open();
    server.resizeLines.mockRejectedValueOnce(new Error("Row deleted"));
    expect(await store.resizeLines("t1", "row", ["r1"], 60)).toBe(false);
    expect(store.tables[0]!.gridSizes).toEqual({ rows: {}, columns: {} });
    expect(store.notice?.kind).toBe("error");
  });
});

describe("setCell", () => {
  it("shows the new value before the save finishes, then saves it", async () => {
    const store = await open({ A1: "1", B1: "=A1+1" });
    const save = deferred();
    server.setCells.mockImplementation((...args) => save.promise.then(() => savedCells(...args)));

    const done = store.setCell(at("A1"), "10");
    expect(store.valueOf(at("B1"))).toBe(11);
    save.resolve();
    await done;
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ rowId: "r0", colId: "c1", input: "10" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
    expect(store.notice).toBeNull();
  });

  it("updates values that Vue computed from the old input", async () => {
    const store = await open({ A1: "1", B1: "=A1+1" });
    const shown = computed(() => store.valueOf(at("B1")));
    expect(shown.value).toBe(2);
    await store.setCell(at("A1"), "5");
    expect(shown.value).toBe(6);
  });

  it("sends nothing when the input is unchanged", async () => {
    const store = await open({ A1: "1" });
    await store.setCell(at("A1"), "1");
    await store.setCell(at("C3"), "");
    expect(server.setCells).not.toHaveBeenCalled();
  });

  it("puts the old input back and reports the error when the save fails", async () => {
    const store = await open({ A1: "1", B1: "=A1+1" });
    server.setCells.mockRejectedValue(new Error("A1 is outside the table"));

    await store.setCell(at("A1"), "10");
    expect(store.inputOf(at("A1"))).toBe("1");
    expect(store.valueOf(at("B1"))).toBe(2);
    expect(store.notice).toEqual({ kind: "error", text: "A1 is outside the table" });
  });

  it("uses a fallback message when the failure has none", async () => {
    const store = await open();
    server.setCells.mockRejectedValue("offline");
    await store.setCell(at("A1"), "1");
    expect(store.notice).toEqual({ kind: "error", text: "The change could not be saved" });
  });

  it("keeps a later edit when an earlier save of the same cell fails", async () => {
    const store = await open({ A1: "1" });
    const first = deferred();
    server.setCells.mockImplementationOnce((...args) =>
      first.promise.then(() => savedCells(...args)),
    );

    const firstDone = store.setCell(at("A1"), "2");
    const secondDone = store.setCell(at("A1"), "3");
    first.reject(new Error("rejected"));
    await Promise.all([firstDone, secondDone]);

    expect(store.inputOf(at("A1"))).toBe("3");
    expect(server.setCells).toHaveBeenLastCalledWith(
      "t1",
      [{ rowId: "r0", colId: "c1", input: "3" }],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
  });

  it("saves edits one at a time, in the order they were made", async () => {
    const store = await open();
    const first = deferred();
    server.setCells.mockImplementationOnce((...args) =>
      first.promise.then(() => savedCells(...args)),
    );

    void store.setCell(at("A1"), "first");
    const second = store.setCell(at("A2"), "second");
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledTimes(1);
    });

    first.resolve();
    await second;
    expect(server.setCells.mock.calls.map(([, cells]) => cells[0]?.input)).toEqual([
      "first",
      "second",
    ]);
  });

  it("does not fail when the table is deleted while its save is failing", async () => {
    const store = await open({ A1: "1" });
    const save = deferred();
    server.setCells.mockImplementation((...args) => save.promise.then(() => savedCells(...args)));

    const done = store.setCell(at("A1"), "2");
    const deleted = store.deleteTable("t1");
    save.reject(new Error("Table not found"));
    await Promise.all([done, deleted]);
    expect(store.tables).toEqual([]);
  });
});

describe("saving", () => {
  it("is true from a change until the server has answered every queued one", async () => {
    const store = await open({ A1: "1" });
    const first = deferred();
    const second = deferred();
    server.setCells
      .mockImplementationOnce((...args) => first.promise.then(() => savedCells(...args)))
      .mockImplementationOnce((...args) => second.promise.then(() => savedCells(...args)));
    expect(store.saving).toBe(false);

    const one = store.setCell(at("A1"), "2");
    const two = store.setCell(at("A2"), "3");
    expect(store.saving).toBe(true);
    first.resolve();
    await one;
    // The second change was waiting for the first and is still on its way.
    expect(store.saving).toBe(true);
    second.resolve();
    await two;
    expect(store.saving).toBe(false);
  });

  it("ends when a save fails", async () => {
    const store = await open({ A1: "1" });
    server.setCells.mockRejectedValue(new Error("offline"));
    await store.setCell(at("A1"), "2");
    expect(store.saving).toBe(false);
  });

  it("covers an undo the server has not answered", async () => {
    const store = await open({ A1: "1" });
    await store.setCell(at("A1"), "2");
    notifyJournaled();
    const answer = deferred();
    server.undo.mockReturnValue(
      answer.promise.then(() => ({
        outcome: "nothing",
        label: null,
        error: null,
        change: changeWith({ pages: [], tables: [], views: [], cells: [] }),
        undoable: false,
        redoable: false,
      })),
    );
    const undone = store.undo();
    expect(store.saving).toBe(true);
    answer.resolve();
    await undone;
    expect(store.saving).toBe(false);
  });
});

describe("setCells", () => {
  it("shows and saves several cells of a table in one request", async () => {
    const store = await open({ A1: "1" });
    await store.setCells("t1", [
      { row: 0, col: 0, input: "1" },
      { row: 0, col: 1, input: "=A1+1" },
      { row: 1, col: 0, input: "x" },
    ]);
    expect(store.valueOf(at("B1"))).toBe(2);
    // A1 already held "1", so it is not sent.
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [
        { rowId: "r0", colId: "c2", input: "=A1+1" },
        { rowId: "r1", colId: "c1", input: "x" },
      ],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
  });

  it("puts every cell back when the save fails", async () => {
    const store = await open({ A1: "old" });
    server.setCells.mockRejectedValue(new Error("offline"));
    await store.setCells("t1", [
      { row: 0, col: 0, input: "new" },
      { row: 0, col: 1, input: "also new" },
    ]);
    expect(store.inputOf(at("A1"))).toBe("old");
    expect(store.inputOf(at("B1"))).toBe("");
    expect(store.notice).toEqual({ kind: "error", text: "offline" });
  });

  it("splits a large change into requests the server accepts, and keeps what was saved if a later one fails", async () => {
    const store = await open();
    server.updateTable.mockResolvedValue(
      changeWith({
        table: sizedTable({ rowCount: 1000, colCount: 3 }),
        cells: [],
        views: [],
        tables: [],
      }),
    );
    await store.updateTable("t1", { rowCount: 1000 });
    const writes = Array.from({ length: 1500 }, (_, index) => ({
      row: index % 1000,
      col: Math.floor(index / 1000),
      input: String(index),
    }));
    server.setCells.mockImplementationOnce(savedCells).mockRejectedValueOnce(new Error("too slow"));

    await store.setCells("t1", writes);
    expect(server.setCells.mock.calls.map(([, cells]) => cells.length)).toEqual([1000, 500]);
    expect(new Set(server.setCells.mock.calls.map(([, , stepId]) => stepId)).size).toBe(1);
    expect(store.inputOf({ tableId: "t1", row: 999, col: 0 })).toBe("999");
    expect(store.inputOf({ tableId: "t1", row: 0, col: 1 })).toBe("");
  });
});

describe("selection", () => {
  it("is one cell until it is extended, and one cell again when another is selected", async () => {
    const store = await open();
    expect(store.selectedRange).toBeNull();
    store.selection = at("B2");
    expect(store.selectedRange).toEqual({ startRow: 1, startCol: 1, endRow: 1, endCol: 1 });

    store.extendSelection({ row: 0, col: 2 });
    expect(store.selectedRange).toEqual({ startRow: 0, startCol: 1, endRow: 1, endCol: 2 });
    store.extendSelection({ row: 1, col: 1 });
    expect(store.selectionEnd).toBeNull();

    store.extendSelection({ row: 3, col: 2 });
    store.selection = at("A1");
    expect(store.selectedRange).toEqual({ startRow: 0, startCol: 0, endRow: 0, endCol: 0 });
  });

  it("copies shown values and pastes them back as the formulas they came from", async () => {
    const store = await open({ A1: "2", B1: "=A1*2", A2: "10" });
    store.selection = at("A1");
    store.extendSelection({ row: 0, col: 1 });
    const text = store.copySelection();
    expect(text).toBe("2\t4");

    store.selection = at("A3");
    await store.paste(text);
    expect(store.inputOf(at("B3"))).toBe("=A3*2");
    expect(store.valueOf(at("B3"))).toBe(4);
    expect(store.selectedRange).toEqual({ startRow: 2, startCol: 0, endRow: 2, endCol: 1 });
  });

  it("pastes other text as typed, and says so when part of it cannot fit", async () => {
    const store = await open();
    const cols = Array.from({ length: 101 }, (_, index) => String(index)).join("\t");
    server.updateTable.mockResolvedValue(
      changeWith({
        table: sizedTable({ colCount: 100 }),
        cells: [],
        views: [],
        tables: [],
      }),
    );
    store.selection = at("A1");
    await store.paste(cols);
    expect(server.updateTable).toHaveBeenCalledExactlyOnceWith(
      "t1",
      {
        colCount: 100,
      },
      expect.any(String),
    );
    expect(server.updateTable.mock.calls[0]?.[2]).toBe(server.setCells.mock.calls[0]?.[2]);
    expect(store.inputOf({ tableId: "t1", row: 0, col: 99 })).toBe("99");
    expect(store.notice).toEqual({
      kind: "error",
      text: "Some cells did not fit in the table",
    });
  });

  it("uses the current column IDs when queued pastes share a new column", async () => {
    const initial = sizedTable({ colCount: 8 });
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith(),
        tables: [initial],
        rows: initial.rows.map((row) => ({ ...row, tableId: initial.id })),
      }),
    );
    const store = useWorkbookStore();
    await store.load("s1");

    let finishResize!: (change: ReturnType<typeof changeWith>) => void;
    server.updateTable.mockReturnValue(
      new Promise((resolve) => {
        finishResize = resolve;
      }),
    );
    server.setCells.mockImplementation(savedCells);
    store.selection = at("H1");
    void store.paste("first\tfirst new column");
    void store.paste("second\tsecond new column");

    await vi.waitFor(() => {
      expect(server.updateTable).toHaveBeenCalledOnce();
    });
    expect(server.updateTable).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { colCount: 9 },
      expect.any(String),
    );
    finishResize(
      changeWith({ table: sizedTable({ colCount: 9 }), cells: [], views: [], tables: [] }),
    );
    await vi.waitFor(() => {
      expect(store.saving).toBe(false);
    });

    expect(server.updateTable).toHaveBeenCalledOnce();
    expect(server.setCells.mock.calls.map(([, cells]) => cells)).toEqual([
      [
        { rowId: "r0", colId: "c8", input: "first" },
        { rowId: "r0", colId: "c9", input: "first new column" },
      ],
      [
        { rowId: "r0", colId: "c8", input: "second" },
        { rowId: "r0", colId: "c9", input: "second new column" },
      ],
    ]);
  });

  it("does not paste when the table could not be grown", async () => {
    const store = await open();
    server.setCells.mockRejectedValue(new Error("no"));
    store.selection = at("A4");
    await store.paste("a\nb");
    expect(store.tables[0]?.rowCount).toBe(4);
    expect(store.inputOf(at("A4"))).toBe("");
    expect(store.notice?.text).toBe("no");
  });

  it("copies nothing and clears nothing without a selection", async () => {
    const store = await open({ A1: "x" });
    expect(store.copySelection()).toBe("");
    await store.clearSelection();
    await store.paste("y");
    expect(server.setCells).not.toHaveBeenCalled();
  });
});

describe("click", () => {
  const BUTTON = '=BUTTON("Sum", EXECUTE(SUM(A1,A2),A3))';

  it("applies the cells the server wrote and says what changed", async () => {
    const store = await open({ A1: "1", A2: "2", B1: BUTTON, C1: "=A3*2" });
    server.click.mockResolvedValue(clickResult({ cells: [{ ...at("A3"), input: "3" }] }));

    await store.click(at("B1"));
    expect(server.click).toHaveBeenCalledExactlyOnceWith(identifiedAt("B1"));
    expect(store.valueOf(at("A3"))).toBe(3);
    expect(store.valueOf(at("C1"))).toBe(6);
    expect(store.notice).toEqual({ kind: "success", text: "Updated A3" });
    expect(store.running.size).toBe(0);
  });

  it("names the table of a cell written outside the button's table", async () => {
    const store = await open({ B1: BUTTON });
    server.createTable.mockResolvedValue(
      createdTable({ ...TABLE, id: "t2", name: "Log", position: 1 }),
    );
    await store.addTable("p1");
    server.click.mockResolvedValue(
      clickResult({
        cells: [
          { ...at("A3"), input: "3" },
          { ...at("B2", "t2"), input: "x" },
        ],
      }),
    );
    await store.click(at("B1"));
    expect(store.notice).toEqual({ kind: "success", text: "Updated A3, Log!B2" });
  });

  it.each([
    [clickResult({ emailsSent: 1 }), { kind: "success", text: "Email sent" }],
    [clickResult(), { kind: "success", text: "Done" }],
    [
      clickResult({ status: "failed", error: "#DIV/0! Division by zero" }),
      { kind: "error", text: "#DIV/0! Division by zero" },
    ],
    [clickResult({ status: "failed" }), { kind: "error", text: "The action failed" }],
  ])("reports the outcome %#", async (result, notice) => {
    const store = await open({ B1: BUTTON });
    server.click.mockResolvedValue(result);
    await store.click(at("B1"));
    expect(store.notice).toEqual(notice);
  });

  it("names the cells an action wrote, or counts them when there are many", async () => {
    const store = await open({ B1: BUTTON });
    const cells = ["A1", "A2", "A3", "A4"].map((address) => ({ ...at(address), input: "x" }));
    server.click.mockResolvedValue(clickResult({ cells: cells.slice(0, 3) }));
    await store.click(at("B1"));
    expect(store.notice?.text).toBe("Updated A1, A2, A3");

    server.click.mockResolvedValue(clickResult({ cells }));
    await store.click(at("B1"));
    expect(store.notice?.text).toBe("Updated 4 cells");
  });

  it("applies a table the action grew before the cells written into its new rows", async () => {
    const store = await open({ B1: BUTTON });
    server.click.mockResolvedValue(
      clickResult({
        tables: [sizedTable({ rowCount: 5 })],
        cells: [{ tableId: "t1", row: 4, col: 0, input: "appended" }],
      }),
    );
    await store.click(at("B1"));
    expect(store.tables[0]?.rowCount).toBe(5);
    expect(store.inputOf({ tableId: "t1", row: 4, col: 0 })).toBe("appended");
  });

  it("stores a control's value quietly, and reports only a refusal", async () => {
    const store = await open({ A1: "FALSE", B1: "=CHECKBOX(A1)" });
    server.input.mockResolvedValue(clickResult({ cells: [{ ...at("A1"), input: "TRUE" }] }));
    await store.input(at("B1"), true);
    expect(server.input).toHaveBeenCalledExactlyOnceWith(identifiedAt("B1"), true);
    expect(store.valueOf(at("A1"))).toBe(true);
    expect(store.notice).toBeNull();

    server.input.mockResolvedValue(clickResult({ status: "failed", error: "No" }));
    await store.input(at("B1"), false);
    expect(store.notice).toEqual({ kind: "error", text: "No" });
  });

  it("reports a request that fails", async () => {
    const store = await open({ B1: BUTTON });
    server.click.mockRejectedValue(new Error("B1 does not hold a button"));
    await store.click(at("B1"));
    expect(store.notice).toEqual({ kind: "error", text: "B1 does not hold a button" });
    expect(store.running.size).toBe(0);
  });

  it("waits for pending saves, so the server evaluates what the user sees", async () => {
    const store = await open({ A1: "1", B1: BUTTON });
    const save = deferred();
    server.setCells.mockImplementation((...args) => save.promise.then(() => savedCells(...args)));

    void store.setCell(at("A1"), "5");
    const clicked = store.click(at("B1"));
    await Promise.resolve();
    expect(server.click).not.toHaveBeenCalled();

    save.resolve();
    await clicked;
    expect(server.click).toHaveBeenCalledOnce();
  });

  it("does not run when a pending save fails, and leaves the save's error showing", async () => {
    const store = await open({ A1: "1", B1: BUTTON });
    const save = deferred();
    server.setCells.mockImplementation((...args) => save.promise.then(() => savedCells(...args)));

    void store.setCell(at("A1"), "5");
    const clicked = store.click(at("B1"));
    save.reject(new Error("A1 could not be saved"));
    await clicked;
    expect(server.click).not.toHaveBeenCalled();
    expect(store.notice).toEqual({ kind: "error", text: "A1 could not be saved" });
    expect(store.running.size).toBe(0);

    // The failed save is behind it now, so the button runs.
    await store.click(at("B1"));
    expect(server.click).toHaveBeenCalledOnce();
  });

  it("ignores a second click on a button that is still running", async () => {
    const store = await open({ B1: BUTTON });
    const first = store.click(at("B1"));
    expect(store.running.size).toBe(1);
    await store.click(at("B1"));
    await first;
    expect(server.click).toHaveBeenCalledOnce();
  });

  it("does nothing for a viewer", async () => {
    const store = await open({ B1: BUTTON }, "viewer");
    await store.click(at("B1"));
    expect(server.click).not.toHaveBeenCalled();
  });
});

describe("structure", () => {
  it("renames the spreadsheet", async () => {
    const store = await open();
    await store.renameSpreadsheet("Forecast");
    expect(server.renameSpreadsheet).toHaveBeenCalledExactlyOnceWith("s1", "Forecast");
    expect(store.spreadsheet?.name).toBe("Forecast");
  });

  it("adds a page with its table, which formulas can then reference", async () => {
    const store = await open({ A1: "=Data!'Table 1'!A1" });
    expect(store.valueOf(at("A1"))).toMatchObject({ code: "#REF!" });

    const page = { id: "p2", name: "Data", position: 1 };
    const table = { ...TABLE, id: "t2", pageId: "p2" };
    server.createPage.mockResolvedValue(createdPage({ page, table }));
    expect(await store.addPage()).toEqual(page);
    expect(store.pages).toHaveLength(2);
    expect(store.tables).toHaveLength(2);

    await store.setCell(at("A1", "t2"), "7");
    expect(store.valueOf(at("A1"))).toBe(7);
  });

  it("re-resolves formulas when a table is renamed", async () => {
    const store = await open({ A1: "5", B1: "=Sales!A1" });
    expect(store.valueOf(at("B1"))).toMatchObject({ code: "#REF!" });

    server.updateTable.mockResolvedValue(
      changeWith({
        table: { ...TABLE, name: "Sales" },
        cells: [],
        views: [],
        tables: [],
      }),
    );
    expect(await store.updateTable("t1", { name: "Sales" })).toBe(true);
    expect(store.tables[0]?.name).toBe("Sales");
    expect(store.valueOf(at("B1"))).toBe(5);
  });

  it("applies the formulas the server rewrote for a renamed table", async () => {
    const store = await open({ A1: "5", B1: "='Table 1'!A1" });
    server.updateTable.mockResolvedValue(
      changeWith({
        table: { ...TABLE, name: "Sales" },
        cells: [{ ...at("B1"), input: "=Sales!A1" }],
        views: [],
        tables: [],
      }),
    );
    await store.updateTable("t1", { name: "Sales" });
    expect(store.inputOf(at("B1"))).toBe("=Sales!A1");
    expect(store.valueOf(at("B1"))).toBe(5);
  });

  it("applies the formulas the server rewrote for a renamed page", async () => {
    const store = await open({ A1: "5", B1: "='Page 1'!'Table 1'!A1" });
    server.renamePage.mockResolvedValue(
      changeWith({
        pages: [{ id: "p1", page: { id: "p1", name: "Summary", position: 0 } }],
        cells: [{ ...at("B1"), input: "=Summary!'Table 1'!A1" }],
        views: [],
        tables: [],
      }),
    );
    await store.renamePage("p1", "Summary");
    expect(store.inputOf(at("B1"))).toBe("=Summary!'Table 1'!A1");
    expect(store.valueOf(at("B1"))).toBe(5);
  });

  it("applies a row deletion: resizes the table, moves cells, and keeps the selection inside", async () => {
    const store = await open({ A1: "1", A2: "2", A4: "=A1+A2" });
    store.selection = at("C4");
    server.editTable.mockResolvedValue(
      changeWith({
        table: { ...TABLE, rowCount: 3, rows: TABLE.rows.slice(1) },
        cells: [{ ...identifiedAt("A4"), input: "=#REF!+A1" }],
        views: [],
        tables: [],
      }),
    );

    expect(await store.editTable("t1", { axis: "row", kind: "delete", index: 0 })).toBe(true);
    expect(store.tables[0]?.rowCount).toBe(3);
    expect(store.inputOf(at("A1"))).toBe("2");
    expect(store.inputOf(at("A2"))).toBe("");
    expect(store.valueOf(at("A3"))).toMatchObject({ code: "#REF!" });
    expect(store.selection).toEqual(at("C3"));
  });

  it("keeps a selected range selected after an edit, as far as the table still reaches", async () => {
    const store = await open();
    store.selection = at("A2");
    store.extendSelection(at("C4"));
    server.editTable.mockResolvedValue(
      changeWith({
        table: { ...TABLE, rowCount: 3, rows: TABLE.rows.slice(1) },
        cells: [],
        views: [],
        tables: [],
      }),
    );
    await store.editTable("t1", { axis: "row", kind: "delete", index: 0 });
    expect(store.selectedRange).toEqual({ startRow: 0, endRow: 2, startCol: 0, endCol: 2 });
  });

  it("applies a smaller size: drops the cells that went, and keeps the selection inside", async () => {
    const store = await open({ A1: "1", C4: "gone", B1: "=C4" });
    store.selection = at("B2");
    store.extendSelection(at("C4"));
    server.updateTable.mockResolvedValue(
      changeWith({
        table: sizedTable({ rowCount: 2, colCount: 2 }),
        cells: [
          { ...at("C4"), input: "" },
          { ...at("B1"), input: "=#REF!" },
        ],
        views: [],
        tables: [],
      }),
    );
    expect(await store.updateTable("t1", { rowCount: 2, colCount: 2 })).toBe(true);
    expect(store.inputOf(at("C4"))).toBe("");
    expect(store.inputOf(at("B1"))).toBe("=#REF!");
    expect(store.selection).toEqual(at("B2"));
    expect(store.selectedRange).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 });

    store.selection = at("A2");
    server.updateTable.mockResolvedValue(
      changeWith({
        table: sizedTable({ rowCount: 1, colCount: 2 }),
        cells: [],
        views: [],
        tables: [],
      }),
    );
    await store.updateTable("t1", { rowCount: 1 });
    expect(store.selection).toBeNull();
  });

  it("stores pending cell edits before asking the server to move cells", async () => {
    const store = await open({ A1: "1" });
    const save = deferred();
    server.setCells.mockImplementation((...args) => save.promise.then(() => savedCells(...args)));
    server.editTable.mockResolvedValue(
      changeWith({ table: TABLE, cells: [], views: [], tables: [] }),
    );

    void store.setCell(at("A1"), "5");
    const edited = store.editTable("t1", { axis: "row", kind: "insert", index: 0 });
    await Promise.resolve();
    expect(server.editTable).not.toHaveBeenCalled();
    save.resolve();
    await edited;
    expect(server.editTable).toHaveBeenCalledOnce();
  });

  it.each(["row", "col"] as const)(
    "inserts several %ss with one request and distinct identities",
    async (axis) => {
      const store = await open();
      server.editTable.mockResolvedValue(changeWith());
      const index = axis === "row" ? TABLE.rowCount : TABLE.colCount;

      expect(await store.editTable("t1", { axis, kind: "insert", index, count: 5 })).toBe(true);

      expect(server.editTable).toHaveBeenCalledOnce();
      const request = server.editTable.mock.calls[0]?.[1];
      expect(request).toMatchObject({ axis, kind: "insert", beforeId: null });
      expect(request?.ids).toHaveLength(5);
      expect(new Set(request?.ids).size).toBe(5);
    },
  );

  it("reports a refused row or column edit", async () => {
    const store = await open();
    server.editTable.mockRejectedValue(new Error("A table needs at least one row"));
    expect(await store.editTable("t1", { axis: "row", kind: "delete", index: 0 })).toBe(false);
    expect(store.notice).toEqual({ kind: "error", text: "A table needs at least one row" });
  });

  it("adds a table to a page", async () => {
    const store = await open();
    server.createTable.mockResolvedValue(
      createdTable({ ...TABLE, id: "t2", name: "Table 2", position: 1 }),
    );
    expect(await store.addTable("p1")).toBe(true);
    expect(store.tables.map((table) => table.name)).toEqual(["Table 1", "Table 2"]);
  });

  it("renames a page", async () => {
    const store = await open();
    expect(await store.renamePage("p1", "Summary")).toBe(true);
    expect(store.pages[0]?.name).toBe("Summary");
  });

  it("deletes a table and drops a selection inside it", async () => {
    const store = await open({ A1: "1" });
    store.selection = at("A1");
    expect(await store.deleteTable("t1")).toBe(true);
    expect(store.tables).toEqual([]);
    expect(store.selection).toBeNull();
  });

  it("deletes a page with its tables and drops a selection inside them", async () => {
    const store = await open();
    const page = { id: "p2", name: "Page 2", position: 1 };
    server.createPage.mockResolvedValue(
      createdPage({ page, table: { ...TABLE, id: "t2", pageId: "p2" } }),
    );
    await store.addPage();
    store.selection = at("A1", "t2");

    server.deletePage.mockResolvedValue(
      changeWith({ pages: [{ id: "p2", page: null }], tables: [{ id: "t2", table: null }] }),
    );
    expect(await store.deletePage("p2")).toBe(true);
    expect(store.pages.map((item) => item.id)).toEqual(["p1"]);
    expect(store.tables.map((item) => item.id)).toEqual(["t1"]);
    expect(store.selection).toBeNull();
  });

  it("reports a refused change and leaves the structure as it was", async () => {
    const store = await open();
    server.renamePage.mockRejectedValue(new Error("A page named Summary already exists"));
    server.deleteTable.mockRejectedValue(new Error("nope"));
    server.createPage.mockRejectedValue(new Error("nope"));

    expect(await store.renamePage("p1", "Summary")).toBe(false);
    expect(store.notice).toEqual({ kind: "error", text: "A page named Summary already exists" });
    expect(store.pages[0]?.name).toBe("Page 1");
    expect(await store.deleteTable("t1")).toBe(false);
    expect(store.tables).toHaveLength(1);
    expect(await store.addPage()).toBeUndefined();
  });

  it("does nothing before a spreadsheet is loaded", async () => {
    const store = useWorkbookStore();
    await store.renameSpreadsheet("x");
    expect(await store.addPage()).toBeUndefined();
    expect(server.renameSpreadsheet).not.toHaveBeenCalled();
    expect(store.canEdit).toBe(false);
  });
});

describe("views", () => {
  const CHART: ViewRecord = {
    id: "v1",
    pageId: "p1",
    kind: "chart",
    name: "Chart 1",
    position: 1,
    source: "'Table 1'!A1:B2",
    chartType: "bar",
  };
  const TEXT: ViewRecord = { ...CHART, id: "v2", kind: "text", name: "Text 1", position: 2 };

  async function openWith(views: ViewRecord[], inputs: Record<string, string> = {}) {
    server.getSnapshot.mockResolvedValue(wireSnapshot({ ...snapshotWith(inputs), views }));
    const store = useWorkbookStore();
    await store.load("s1");
    return store;
  }

  it("loads the views of a spreadsheet", async () => {
    const store = await openWith([CHART, TEXT]);
    expect(store.views.map((view) => view.name)).toEqual(["Chart 1", "Text 1"]);
  });

  it("evaluates a formula written on a page against the cells", async () => {
    const store = await openWith([], { A1: "2", A2: "3" });
    expect(store.evaluateOnPage("p1", "SUM('Table 1'!A1:A2) * n", new Map([["n", 10]]))).toBe(50);
    expect(store.evaluateOnPage("p1", "A1")).toMatchObject({ code: "#REF!" });
  });

  it("re-evaluates a page formula when a cell it reads changes", async () => {
    const store = await openWith([], { A1: "2" });
    const doubled = computed(() => store.evaluateOnPage("p1", "'Table 1'!A1 * 2"));
    expect(doubled.value).toBe(4);
    await store.setCell(at("A1"), "5");
    expect(doubled.value).toBe(10);
  });

  it("adds a view to the page", async () => {
    const store = await openWith([]);
    server.createView.mockResolvedValue(createdView(CHART));
    expect(await store.addView("p1", "chart")).toBe(true);
    expect(server.createView).toHaveBeenCalledWith("p1", "chart", undefined);
    expect(store.views).toEqual([CHART]);
  });

  it("replaces a view with what the server stored", async () => {
    const store = await openWith([CHART, TEXT]);
    server.updateView.mockResolvedValue(changeWith({ ...CHART, chartType: "pie" }));
    expect(await store.updateView("v1", { chartType: "pie" })).toBe(true);
    expect(store.views).toEqual([{ ...CHART, chartType: "pie" }, TEXT]);
  });

  it("serializes overlapping updates to the same view", async () => {
    const store = await openWith([CHART, TEXT]);
    let finishFirst!: (view: ViewRecord) => void;
    let finishSecond!: (view: ViewRecord) => void;
    const firstResponse = new Promise<ViewRecord>((resolve) => (finishFirst = resolve));
    const secondResponse = new Promise<ViewRecord>((resolve) => (finishSecond = resolve));
    server.updateView
      .mockReturnValueOnce(firstResponse.then((value) => changeWith(value)))
      .mockReturnValueOnce(secondResponse.then((value) => changeWith(value)));

    const first = store.updateView("v1", { source: "first" });
    const second = store.updateView("v1", { source: "second" });
    await vi.waitFor(() => {
      expect(server.updateView).toHaveBeenCalledTimes(1);
    });
    finishFirst({ ...CHART, source: "first" });
    expect(await first).toBe(true);
    await vi.waitFor(() => {
      expect(server.updateView).toHaveBeenCalledTimes(2);
    });
    finishSecond({ ...CHART, source: "second" });
    expect(await second).toBe(true);
    expect(store.views.find((view) => view.id === "v1")?.source).toBe("second");
  });

  it("deletes a view", async () => {
    const store = await openWith([CHART, TEXT]);
    expect(await store.deleteView("v1")).toBe(true);
    expect(store.views).toEqual([TEXT]);
  });

  it("reports a refused change and keeps the views as they were", async () => {
    const store = await openWith([CHART]);
    server.updateView.mockRejectedValue(new Error("nope"));
    server.createView.mockRejectedValue(new Error("nope"));
    server.deleteView.mockRejectedValueOnce(new Error("nope"));
    expect(await store.updateView("v1", { name: "x" })).toBe(false);
    expect(await store.addView("p1", "text")).toBe(false);
    expect(await store.deleteView("v1")).toBe(false);
    expect(store.views).toEqual([CHART]);
    expect(store.notice).toEqual({ kind: "error", text: "nope" });
  });

  it("applies the view sources the server rewrote, and leaves the others alone", async () => {
    const store = await openWith([CHART, { ...TEXT, source: "plain" }]);
    server.renamePage.mockResolvedValue(
      changeWith({
        cells: [],
        views: [{ id: "v1", source: "Data!'Table 1'!A1:B2" }],
        tables: [],
      }),
    );
    await store.renamePage("p1", "Data");
    expect(store.views.map((view) => view.source)).toEqual(["Data!'Table 1'!A1:B2", "plain"]);
  });

  it("drops the views of a deleted page", async () => {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith(),
        pages: [
          { id: "p1", name: "Page 1", position: 0 },
          { id: "p2", name: "Page 2", position: 1 },
        ],
        views: [CHART, { ...TEXT, pageId: "p2" }],
      }),
    );
    const store = useWorkbookStore();
    await store.load("s1");
    server.deletePage.mockResolvedValue(
      changeWith({ pages: [{ id: "p2", page: null }], views: [{ id: "v2", view: null }] }),
    );
    await store.deletePage("p2");
    expect(store.views).toEqual([CHART]);
  });
});

describe("files", () => {
  it("gives the values a table shows, without the empty rows and columns at its end", async () => {
    const store = await open({ A1: "2", B1: "=A1*3", A3: "2026-09-30", B3: "=1/0" });
    expect(store.shownRows(TABLE)).toEqual([
      ["2", "6"],
      ["", ""],
      ["2026-09-30", "#DIV/0!"],
    ]);
    expect((await open()).shownRows(TABLE)).toEqual([]);
  });

  it("writes the spreadsheet as a file holding what was typed", async () => {
    const store = await open({ A1: "2", B1: "=A1*3" });
    expect(store.toFile()).toEqual({
      format: "spreadsheet-app",
      version: 1,
      name: "Budget",
      pages: [
        {
          name: "Page 1",
          blocks: [
            {
              type: "table",
              name: "Table 1",
              rowCount: 4,
              colCount: 3,
              cells: [
                { row: 0, col: 0, input: "2" },
                { row: 0, col: 1, input: "=A1*3" },
              ],
            },
          ],
        },
      ],
    });
    setActivePinia(createPinia());
    expect(useWorkbookStore().toFile()).toBeUndefined();
  });

  it("does not import rows for a viewer", async () => {
    const store = await open({}, "viewer");
    await store.importRows("t1", [["x"]]);
    expect(server.setCells).not.toHaveBeenCalled();
  });
});

describe("data tables", () => {
  const COLUMNS: ColumnDefinition[] = [
    { name: "Price", type: "number" },
    { name: "Qty", type: "any" },
    { name: "Total", type: "formula", formula: "=[Price] * [Qty]" },
  ];
  const DATA_TABLE = { ...TABLE, columns: COLUMNS };

  async function openData(
    inputs: Record<string, string> = { A1: "2", B1: "10", A2: "5", B2: "3" },
  ) {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({ ...snapshotWith(inputs), tables: [DATA_TABLE] }),
    );
    const store = useWorkbookStore();
    await store.load("s1");
    return store;
  }

  it("computes a formula column in every row, and knows the column of a cell", async () => {
    const store = await openData();
    expect(store.valueOf(at("C1"))).toBe(20);
    expect(store.valueOf(at("C2"))).toBe(15);
    expect(store.inputOf(at("C2"))).toBe("=[Price] * [Qty]");
    expect(store.columnOf(at("C2"))).toEqual(COLUMNS[2]);
    expect(store.columnOf(at("A1"))?.name).toBe("Price");
  });

  it("makes a formula typed into a formula column the formula of the whole column", async () => {
    const store = await openData();
    const changed = COLUMNS.with(2, { name: "Total", type: "formula", formula: "=[Price] + 1" });
    server.updateColumn.mockResolvedValue(
      changeWith({
        table: { ...DATA_TABLE, columns: changed },
        cells: [],
        views: [],
        tables: [],
      }),
    );
    await store.setCell(at("C2"), "=[Price] + 1");
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", "c3", {
      revision: expect.any(Number),
      formula: "=[Price] + 1",
    });
    expect(server.setCells).not.toHaveBeenCalled();
    expect(store.valueOf(at("C1"))).toBe(3);
    expect(store.valueOf(at("C2"))).toBe(6);
  });

  it("refuses to replace a column's formula with something that is not a formula", async () => {
    const store = await openData();
    await store.setCell(at("C1"), "5");
    await store.setCell(at("C1"), "");
    await store.setCell(at("C1"), "=[Price] * [Qty]");
    expect(server.updateColumn).not.toHaveBeenCalled();
    expect(store.notice).toEqual({
      kind: "error",
      text: "Total is a formula column. Type a formula starting with = to change it for every row",
    });
    expect(store.valueOf(at("C1"))).toBe(20);
  });

  it("leaves a formula column out of a paste, a fill, and a clear that cross it", async () => {
    const store = await openData();
    store.selection = at("B1");
    await store.paste("7\t8\n9\t10");
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [
        { rowId: "r0", colId: "c2", input: "7" },
        { rowId: "r1", colId: "c2", input: "9" },
      ],
      expect.any(String),
      expect.any(Number),
      expect.any(Array),
    );
    expect(store.valueOf(at("C1"))).toBe(14);
  });

  it("names the columns of a table, and shows the cells the server moved", async () => {
    const store = await open({ A1: "Price", A2: "4" });
    server.nameColumns.mockResolvedValue(
      changeWith({
        table: { ...TABLE, rowCount: 3, columns: [{ name: "Price", type: "any" }] },
        cells: [
          { ...at("A1"), input: "4" },
          { ...at("A2"), input: "" },
        ],
        views: [],
        tables: [],
      }),
    );
    expect(await store.nameColumns("t1", true)).toBe(true);
    expect(server.nameColumns).toHaveBeenCalledExactlyOnceWith("t1", true);
    expect(store.tables[0]?.columns).toEqual([{ name: "Price", type: "any" }]);
    expect(store.valueOf(at("A1"))).toBe(4);
    expect(store.inputOf(at("A2"))).toBe("");
  });

  it("changes a column, and reads its cells as the new type", async () => {
    const store = await openData({ B1: "007" });
    server.updateColumn.mockResolvedValue(
      changeWith({
        table: { ...DATA_TABLE, columns: COLUMNS.with(1, { name: "Qty", type: "text" }) },
        cells: [],
        views: [],
        tables: [],
      }),
    );
    expect(store.valueOf(at("B1"))).toBe(7);
    expect(await store.updateColumn("t1", 1, { type: "text" })).toBe(true);
    expect(store.valueOf(at("B1"))).toBe("007");
  });

  it("drops the column names, after which the formula column is empty", async () => {
    const store = await openData();
    server.dropColumns.mockResolvedValue(changeWith(TABLE));
    expect(await store.dropColumns("t1")).toBe(true);
    expect(store.tables[0]?.columns).toBeNull();
    expect(store.valueOf(at("C1"))).toBeNull();
  });

  it("shows other tables whose formula columns a rename rewrote", async () => {
    const store = await openData();
    const rewritten = COLUMNS.with(2, {
      name: "Total",
      type: "formula",
      formula: "=[Price] + [Qty]",
    });
    server.renamePage.mockResolvedValue(
      changeWith({
        cells: [],
        views: [],
        tables: [{ ...DATA_TABLE, columns: rewritten }],
      }),
    );
    await store.renamePage("p1", "Data");
    expect(store.valueOf(at("C1"))).toBe(12);
  });

  it("reports a refused column change", async () => {
    const store = await openData();
    server.updateColumn.mockRejectedValue(new Error("A column named Qty already exists"));
    expect(await store.updateColumn("t1", 0, { name: "Qty" })).toBe(false);
    expect(store.notice).toEqual({ kind: "error", text: "A column named Qty already exists" });
  });

  it("writes column definitions to a file, without cells for the formula column", async () => {
    const store = await openData({ A1: "2", B1: "10" });
    expect(store.toFile()?.pages[0]?.blocks[0]).toEqual({
      type: "table",
      name: "Table 1",
      rowCount: 4,
      colCount: 3,
      columns: COLUMNS,
      cells: [
        { row: 0, col: 0, input: "2" },
        { row: 0, col: 1, input: "10" },
      ],
    });
  });
});

describe("the order of a page", () => {
  const view = (id: string, position: number): ViewRecord => ({
    id,
    pageId: "p1",
    kind: "text",
    name: id,
    position,
    source: "",
    chartType: null,
  });

  async function openPage() {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith(),
        views: [view("v2", 2), view("v1", 1), { ...view("far", 0), pageId: "p9" }],
      }),
    );
    const store = useWorkbookStore();
    await store.load("s1");
    return store;
  }

  it("lists the tables and views of a page in their order", async () => {
    const store = await openPage();
    expect(store.blocksOn("p1")).toEqual(["t1", "v1", "v2"]);
  });

  it("moves a block up or down, and stores the new order", async () => {
    const store = await openPage();
    expect(await store.moveBlock("p1", "v2", -1)).toBe(true);
    expect(server.reorderPage).toHaveBeenCalledExactlyOnceWith("p1", ["t1", "v2", "v1"]);
    expect(store.blocksOn("p1")).toEqual(["t1", "v2", "v1"]);
    await store.moveBlock("p1", "t1", 1);
    expect(store.blocksOn("p1")).toEqual(["v2", "t1", "v1"]);
  });

  it("keeps a later optimistic block order when the first response arrives", async () => {
    const store = await openPage();
    const first = deferred();
    const second = deferred();
    server.reorderPage
      .mockImplementationOnce(async () => {
        await first.promise;
        return changeWith(
          {
            table: { ...TABLE, position: 1 },
            views: [
              { id: "v1", position: 0 },
              { id: "v2", position: 2 },
            ],
          },
          1,
        );
      })
      .mockImplementationOnce(async () => {
        await second.promise;
        return changeWith(
          {
            table: { ...TABLE, position: 2 },
            views: [
              { id: "v1", position: 0 },
              { id: "v2", position: 1 },
            ],
          },
          2,
        );
      });

    const firstMove = store.moveBlock("p1", "t1", 1);
    const secondMove = store.moveBlock("p1", "t1", 1);
    expect(store.blocksOn("p1")).toEqual(["v1", "v2", "t1"]);
    await vi.waitFor(() => {
      expect(server.reorderPage).toHaveBeenCalledOnce();
    });

    first.resolve();
    await vi.waitFor(() => {
      expect(server.reorderPage).toHaveBeenCalledTimes(2);
    });
    expect(store.blocksOn("p1")).toEqual(["v1", "v2", "t1"]);

    second.resolve();
    await Promise.all([firstMove, secondMove]);
    expect(store.blocksOn("p1")).toEqual(["v1", "v2", "t1"]);
  });

  it("does nothing at either end of the page, or for a block that is not on it", async () => {
    const store = await openPage();
    expect(await store.moveBlock("p1", "t1", -1)).toBe(false);
    expect(await store.moveBlock("p1", "v2", 1)).toBe(false);
    expect(await store.moveBlock("p1", "far", 1)).toBe(false);
    expect(server.reorderPage).not.toHaveBeenCalled();
  });

  it("keeps the order when the server refuses", async () => {
    const store = await openPage();
    server.reorderPage.mockRejectedValueOnce(new Error("The page has changed"));
    expect(await store.moveBlock("p1", "v1", 1)).toBe(false);
    expect(store.blocksOn("p1")).toEqual(["t1", "v1", "v2"]);
  });

  it("keeps a later block order when an earlier move fails", async () => {
    const store = await openPage();
    server.reorderPage
      .mockRejectedValueOnce(new Error("first move failed"))
      .mockResolvedValueOnce(changeWith(undefined));
    const first = store.moveBlock("p1", "t1", 1);
    const second = store.moveBlock("p1", "t1", 1);
    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(store.blocksOn("p1")).toEqual(["v1", "v2", "t1"]);
    expect(server.reorderPage.mock.calls.map(([, blocks]) => blocks)).toEqual([
      ["v1", "t1", "v2"],
      ["v1", "v2", "t1"],
    ]);
  });

  it("restores the accepted block order when every queued move fails", async () => {
    const store = await openPage();
    server.reorderPage
      .mockRejectedValueOnce(new Error("first move failed"))
      .mockRejectedValueOnce(new Error("second move failed"));
    const first = store.moveBlock("p1", "t1", 1);
    const second = store.moveBlock("p1", "t1", 1);
    expect(await Promise.all([first, second])).toEqual([false, false]);
    expect(store.blocksOn("p1")).toEqual(["t1", "v1", "v2"]);
  });
});

describe("the order of the pages, and moving a block between them", () => {
  const PAGES = [
    { id: "p1", name: "Page 1", position: 0 },
    { id: "p2", name: "Page 2", position: 1 },
    { id: "p3", name: "Page 3", position: 2 },
  ];
  const TEXT: ViewRecord = {
    id: "v1",
    pageId: "p1",
    kind: "text",
    name: "Text 1",
    position: 1,
    source: "{{ 'Table 1'!A1 }}",
    chartType: null,
  };

  async function openPages(inputs: Record<string, string> = {}) {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({ ...snapshotWith(inputs), pages: PAGES, views: [TEXT] }),
    );
    const store = useWorkbookStore();
    await store.load("s1");
    return store;
  }
  const order = (store: ReturnType<typeof useWorkbookStore>) => store.pages.map((page) => page.id);

  it("moves a page left or right, and stores the new order", async () => {
    const store = await openPages();
    expect(await store.movePage("p3", -1)).toBe(true);
    expect(server.reorderPages).toHaveBeenCalledExactlyOnceWith("s1", ["p1", "p3", "p2"]);
    expect(order(store)).toEqual(["p1", "p3", "p2"]);
    expect(store.pages.map((page) => page.position)).toEqual([0, 1, 2]);
    await store.movePage("p1", 1);
    expect(order(store)).toEqual(["p3", "p1", "p2"]);
  });

  it("keeps a later optimistic page order when the first response arrives", async () => {
    const store = await openPages();
    const first = deferred();
    const second = deferred();
    server.reorderPages
      .mockImplementationOnce(async () => {
        await first.promise;
        return changeWith(
          {
            pages: [
              { id: "p2", page: { id: "p2", name: "Page 2", position: 0 } },
              { id: "p1", page: { id: "p1", name: "Page 1", position: 1 } },
              { id: "p3", page: { id: "p3", name: "Page 3", position: 2 } },
            ],
          },
          1,
        );
      })
      .mockImplementationOnce(async () => {
        await second.promise;
        return changeWith(
          {
            pages: [
              { id: "p2", page: { id: "p2", name: "Page 2", position: 0 } },
              { id: "p3", page: { id: "p3", name: "Page 3", position: 1 } },
              { id: "p1", page: { id: "p1", name: "Page 1", position: 2 } },
            ],
          },
          2,
        );
      });

    const firstMove = store.movePage("p1", 1);
    const secondMove = store.movePage("p1", 1);
    expect(order(store)).toEqual(["p2", "p3", "p1"]);
    await vi.waitFor(() => {
      expect(server.reorderPages).toHaveBeenCalledOnce();
    });

    first.resolve();
    await vi.waitFor(() => {
      expect(server.reorderPages).toHaveBeenCalledTimes(2);
    });
    expect(order(store)).toEqual(["p2", "p3", "p1"]);

    second.resolve();
    await Promise.all([firstMove, secondMove]);
    expect(order(store)).toEqual(["p2", "p3", "p1"]);
  });

  it("does nothing at either end of the tabs, and keeps the order when the server refuses", async () => {
    const store = await openPages();
    expect(await store.movePage("p1", -1)).toBe(false);
    expect(await store.movePage("p3", 1)).toBe(false);
    expect(server.reorderPages).not.toHaveBeenCalled();

    server.reorderPages.mockRejectedValueOnce(new Error("The pages have changed"));
    expect(await store.movePage("p1", 1)).toBe(false);
    expect(order(store)).toEqual(["p1", "p2", "p3"]);
    expect(store.notice).toEqual({ kind: "error", text: "The pages have changed" });
  });

  it("keeps the later order when an earlier page move fails", async () => {
    const store = await openPages();
    server.reorderPages
      .mockRejectedValueOnce(new Error("first move failed"))
      .mockResolvedValueOnce(changeWith(undefined));
    const first = store.movePage("p1", 1);
    const second = store.movePage("p1", 1);
    expect(await Promise.all([first, second])).toEqual([false, true]);
    expect(order(store)).toEqual(["p2", "p3", "p1"]);
    expect(server.reorderPages.mock.calls.map(([, pages]) => pages)).toEqual([
      ["p2", "p1", "p3"],
      ["p2", "p3", "p1"],
    ]);
  });

  it("restores the last accepted order when every queued page move fails", async () => {
    const store = await openPages();
    server.reorderPages
      .mockRejectedValueOnce(new Error("first move failed"))
      .mockRejectedValueOnce(new Error("second move failed"));
    const first = store.movePage("p1", 1);
    const second = store.movePage("p1", 1);
    expect(await Promise.all([first, second])).toEqual([false, false]);
    expect(order(store)).toEqual(["p1", "p2", "p3"]);
  });

  it("moves a table to another page, with the formulas the server rewrote", async () => {
    const store = await openPages({ A1: "5" });
    store.selection = at("A1");
    server.moveTable.mockResolvedValue(
      changeWith({
        table: { ...TABLE, pageId: "p2", position: 0 },
        cells: [],
        views: [{ id: "v1", source: "{{ 'Page 2'!'Table 1'!A1 }}" }],
        tables: [],
      }),
    );
    expect(await store.moveBlockToPage("t1", "p2")).toBe(true);
    expect(server.moveTable).toHaveBeenCalledExactlyOnceWith("t1", "p2");
    expect(store.blocksOn("p1")).toEqual(["v1"]);
    expect(store.blocksOn("p2")).toEqual(["t1"]);
    expect(store.views[0]?.source).toBe("{{ 'Page 2'!'Table 1'!A1 }}");
    expect(store.evaluateOnPage("p1", "'Page 2'!'Table 1'!A1")).toBe(5);
    expect(store.selection).toBeNull();
    expect(store.notice).toEqual({ kind: "success", text: "Moved Table 1 to Page 2" });
  });

  it("moves a view to another page, as the server now has it", async () => {
    const store = await openPages();
    const moved = { ...TEXT, pageId: "p3", position: 0, source: "{{ 'Page 1'!'Table 1'!A1 }}" };
    server.moveView.mockResolvedValue(
      changeWith({ view: moved, cells: [], views: [], tables: [] }),
    );
    expect(await store.moveBlockToPage("v1", "p3")).toBe(true);
    expect(server.moveView).toHaveBeenCalledExactlyOnceWith("v1", "p3");
    expect(store.views).toEqual([moved]);
    expect(store.notice).toEqual({ kind: "success", text: "Moved Text 1 to Page 3" });
  });

  it("leaves a block where it is when the server refuses the move", async () => {
    const store = await openPages();
    server.moveTable.mockRejectedValue(new Error("Page 2 already has a table named Table 1"));
    expect(await store.moveBlockToPage("t1", "p2")).toBe(false);
    expect(store.blocksOn("p1")).toEqual(["t1", "v1"]);
    expect(store.notice).toEqual({
      kind: "error",
      text: "Page 2 already has a table named Table 1",
    });
  });
});

describe("undo and redo", () => {
  const changedCell = (input: string) => ({
    pages: [],
    tables: [],
    views: [],
    cells: [{ ...at("A1"), input }],
  });

  it("follows the journal response and applies undo and redo", async () => {
    const store = await open({ A1: "2" });
    expect(store.canUndo).toBe(false);
    notifyJournaled();
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);

    server.undo.mockResolvedValue({
      outcome: "done",
      label: "Change cells in Table 1",
      error: null,
      change: changeWith(changedCell("1")),
      undoable: false,
      redoable: true,
    });
    await store.undo();
    expect(store.inputOf(at("A1"))).toBe("1");
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);

    server.redo.mockResolvedValue({
      outcome: "done",
      label: "Change cells in Table 1",
      error: null,
      change: changeWith(changedCell("2")),
      undoable: true,
      redoable: false,
    });
    await store.redo();
    expect(store.inputOf(at("A1"))).toBe("2");
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);
  });

  it("restores a deleted table before applying its cells", async () => {
    const store = await open();
    await store.deleteTable("t1");
    expect(store.tables).toEqual([]);
    notifyJournaled();
    server.undo.mockResolvedValue({
      outcome: "done",
      label: "Delete table Table 1",
      error: null,
      change: changeWith({
        pages: [],
        tables: [{ id: "t1", table: TABLE }],
        views: [],
        cells: [{ ...at("A1"), input: "restored" }],
      }),
      undoable: false,
      redoable: true,
    });

    await store.undo();
    expect(store.tables).toEqual([TABLE]);
    expect(store.inputOf(at("A1"))).toBe("restored");
  });

  it("waits for pending saves before sending undo", async () => {
    const store = await open({ A1: "1" });
    const saving = deferred();
    server.setCells.mockImplementation((...args) => saving.promise.then(() => savedCells(...args)));
    const save = store.setCell(at("A1"), "2");
    const undo = store.undo();
    await Promise.resolve();
    expect(server.undo).not.toHaveBeenCalled();

    saving.resolve();
    notifyJournaled();
    await Promise.all([save, undo]);
    expect(server.undo).toHaveBeenCalledOnce();
  });

  it("keeps showing what was typed into a cell while the undo that restores it is on its way", async () => {
    const store = await open({ A1: "2", B1: "=A1*10" });
    notifyJournaled();
    let answer!: (result: Awaited<ReturnType<typeof api.undo>>) => void;
    server.undo.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const undo = store.undo();
    await vi.waitFor(() => {
      expect(server.undo).toHaveBeenCalledOnce();
    });
    const typed = store.setCell(at("A1"), "3");
    const typedAgain = store.setCell(at("A1"), "4");
    expect(server.setCells).not.toHaveBeenCalled();

    server.setCells.mockImplementationOnce(savedCells).mockRejectedValueOnce(new Error("refused"));
    answer({
      outcome: "done",
      label: "Change cells in Table 1",
      error: null,
      change: changeWith(changedCell("1")),
      undoable: false,
      redoable: true,
    });
    await undo;
    expect(store.inputOf(at("A1"))).toBe("4");
    expect(store.valueOf(at("B1"))).toBe(40);

    // The second save fails, and the cell goes back to what the first one stored.
    await Promise.all([typed, typedAgain]);
    expect(server.setCells).toHaveBeenCalledTimes(2);
    expect(store.inputOf(at("A1"))).toBe("3");
  });

  it("leaves another spreadsheet alone when it was asked for before the answer came", async () => {
    const store = await open({ A1: "2" });
    notifyJournaled();
    let answer!: (result: Awaited<ReturnType<typeof api.undo>>) => void;
    server.undo.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const undo = store.undo();
    await vi.waitFor(() => {
      expect(server.undo).toHaveBeenCalledOnce();
    });

    const other = { ...TABLE, id: "t2", name: "Theirs" };
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith(),
        id: "s2",
        tables: [other],
        undoable: true,
      }),
    );
    // The other spreadsheet is shown once the undo is answered, so the answer has nothing of it to change.
    const opened = store.load("s2");
    await idle();
    expect(store.spreadsheet?.id).toBe("s1");
    answer({
      outcome: "done",
      label: "Delete table Table 1",
      error: null,
      change: changeWith({ pages: [], tables: [{ id: "t1", table: TABLE }], views: [], cells: [] }),
      undoable: false,
      redoable: true,
    });
    await Promise.all([undo, opened]);
    expect(store.spreadsheet?.id).toBe("s2");
    expect(store.tables).toEqual([other]);
    expect(store.canUndo).toBe(true);
    expect(store.canRedo).toBe(false);
    expect(store.notice).toBeNull();
  });

  it("waits for pending page reorders and view updates before sending undo", async () => {
    const pages = [
      { id: "p1", name: "Page 1", position: 0 },
      { id: "p2", name: "Page 2", position: 1 },
    ];
    const view: ViewRecord = {
      id: "v1",
      pageId: "p1",
      kind: "text",
      name: "Text 1",
      position: 1,
      source: "before",
      chartType: null,
    };
    server.getSnapshot.mockResolvedValue(wireSnapshot({ ...snapshotWith(), pages, views: [view] }));
    const store = useWorkbookStore();
    await store.load("s1");

    const reordering = deferred();
    let finishView!: (value: ViewRecord) => void;
    const updating = new Promise<ViewRecord>((resolve) => (finishView = resolve));
    server.reorderPages.mockReturnValue(reordering.promise.then(() => changeWith()));
    server.updateView.mockReturnValue(updating.then((value) => changeWith(value)));
    const pageMove = store.movePage("p1", 1);
    const viewUpdate = store.updateView("v1", { source: "after" });
    const history = store.undo();
    await vi.waitFor(() => {
      expect(server.reorderPages).toHaveBeenCalledOnce();
    });
    expect(server.undo).not.toHaveBeenCalled();

    expect(server.updateView).not.toHaveBeenCalled();
    reordering.resolve();
    await vi.waitFor(() => {
      expect(server.updateView).toHaveBeenCalledOnce();
    });
    finishView({ ...view, source: "after" });
    notifyJournaled();
    await Promise.all([pageMove, viewUpdate, history]);
    expect(server.undo).toHaveBeenCalledOnce();
  });

  it("shows a refusal from the server", async () => {
    const store = await open();
    notifyJournaled();
    server.undo.mockResolvedValue({
      outcome: "refused",
      label: "Insert row 1",
      error: "A later change prevents undoing this structural change",
      change: changeWith({ pages: [], tables: [], views: [], cells: [] }),
      undoable: false,
      redoable: false,
    });
    await store.undo();
    expect(store.notice).toEqual({
      kind: "error",
      text: "A later change prevents undoing this structural change",
    });
  });

  it("does not offer undo or redo to a viewer", async () => {
    const store = await open({}, "viewer");
    notifyJournaled();
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(false);
    await store.undo();
    expect(server.undo).not.toHaveBeenCalled();
  });
});

describe("refreshing after a change made elsewhere", () => {
  it("keeps the newer of two overlapping reads, whichever answer arrives last", async () => {
    const store = await open({ A1: "start" });
    const answers: ((snapshot: Snapshot) => void)[] = [];
    server.getSnapshot.mockImplementation(
      () => new Promise<Snapshot>((resolve) => answers.push(resolve)),
    );
    const [older, newer] = [store.refresh(), store.refresh()];
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    answers[1]?.(snapshotWith({ A1: "newer" }));
    answers[0]?.(snapshotWith({ A1: "older" }));
    await Promise.all([older, newer]);
    expect(store.inputOf(at("A1"))).toBe("newer");
  });

  it("gives way to a load that began after it", async () => {
    const store = await open({ A1: "start" });
    const answers: ((snapshot: Snapshot) => void)[] = [];
    server.getSnapshot.mockImplementation(
      () => new Promise<Snapshot>((resolve) => answers.push(resolve)),
    );
    const refreshed = store.refresh();
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1);
    });
    const loaded = store.load("s1");
    answers[1]?.(snapshotWith({ A1: "loaded" }));
    answers[0]?.(snapshotWith({ A1: "refreshed" }));
    await Promise.all([refreshed, loaded]);
    expect(store.inputOf(at("A1"))).toBe("loaded");
  });

  it("shows the cells and views the server now has, and keeps the selection", async () => {
    const store = await open({ A1: "1", B1: "=A1*2" });
    store.selection = at("B1");
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith({ A1: "5", B1: "=A1*2", C1: "new" }),
        name: "Renamed elsewhere",
        views: [
          {
            id: "v1",
            pageId: "p1",
            kind: "text",
            name: "Text 1",
            position: 1,
            source: "hi",
            chartType: null,
          },
        ],
      }),
    );
    await store.refresh();
    expect(store.valueOf(at("B1"))).toBe(10);
    expect(store.inputOf(at("C1"))).toBe("new");
    expect(store.spreadsheet?.name).toBe("Renamed elsewhere");
    expect(store.views).toHaveLength(1);
    expect(store.selection).toEqual(at("B1"));
  });

  it("loads undo and redo flags from a refreshed snapshot", async () => {
    const store = await open({ A1: "1" });
    await store.setCell(at("A1"), "2");
    notifyJournaled();
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith({ A1: "2", B1: "theirs" }),
        undoable: true,
        redoable: false,
      }),
    );
    await store.refresh();
    expect(store.canUndo).toBe(true);

    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith({ A1: "2" }),
        tables: [{ ...TABLE, name: "Renamed" }],
        undoable: false,
        redoable: true,
      }),
    );
    await store.refresh();
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);
  });

  it("drops a selection in a table or a row that is gone", async () => {
    const store = await open();
    store.selection = at("C4");
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith(),
        tables: [sizedTable({ rowCount: 2 })],
      }),
    );
    await store.refresh();
    expect(store.selection).toBeNull();
  });

  it("follows a change of role", async () => {
    const store = await open();
    server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith({}, "viewer")));
    await store.refresh();
    expect(store.canEdit).toBe(false);
  });

  it("reads while a save is pending and preserves its optimistic input", async () => {
    const store = await open();
    const saving = deferred();
    server.setCells.mockImplementationOnce((...args) =>
      saving.promise.then(() => savedCells(...args)),
    );
    const typed = store.setCell(at("A1"), "mine");
    server.getSnapshot.mockResolvedValue(wireSnapshot(snapshotWith({ B1: "theirs" })));
    await store.refresh();
    expect(store.inputOf(at("A1"))).toBe("mine");
    expect(store.inputOf(at("B1"))).toBe("theirs");
    saving.resolve();
    await typed;
    expect(store.inputOf(at("A1"))).toBe("mine");
  });

  it("ignores a snapshot older than an undo applied while the read was pending", async () => {
    const store = await open({ A1: "2" });
    notifyJournaled();
    let answer!: (snapshot: Snapshot) => void;
    server.getSnapshot.mockReturnValue(
      new Promise((resolve) => {
        answer = resolve;
      }),
    );
    const refreshed = store.refresh();
    server.undo.mockResolvedValue({
      outcome: "done",
      label: "Edit",
      error: null,
      change: changeWith({ cells: [{ ...identifiedAt("A1"), input: "1" }] }),
      undoable: false,
      redoable: true,
    });
    await store.undo();
    answer({ ...snapshotWith({ A1: "2" }), revision: 0, undoable: true });
    await refreshed;
    expect(store.inputOf(at("A1"))).toBe("1");
    expect(store.canRedo).toBe(true);
  });

  it("can refresh while a name change waits for its response", async () => {
    const store = await open();
    const renaming = deferred();
    server.renameSpreadsheet.mockReturnValueOnce(renaming.promise);
    const renamed = store.renameSpreadsheet("Mine");
    await store.refresh();
    renaming.resolve();
    await renamed;
    expect(store.spreadsheet?.name).toBe("Mine");
  });

  it("passes on the failure when the spreadsheet can no longer be read", async () => {
    const store = await open();
    server.getSnapshot.mockRejectedValue(new Error("Spreadsheet not found"));
    await expect(store.refresh()).rejects.toThrow("Spreadsheet not found");
  });

  it("does nothing before a spreadsheet is open", async () => {
    await useWorkbookStore().refresh();
    expect(server.getSnapshot).not.toHaveBeenCalled();
  });
});

it("keeps the selected cell and saves its captured IDs after a remote row insertion", async () => {
  const store = await open({ A2: "original" });
  store.selection = at("A2");
  const identity = store.identityOf(at("A2"))!;
  const shifted = snapshotWith({ A2: "original" });
  shifted.tables = [
    { ...TABLE, rowCount: 5, rows: [{ id: "inserted", orderKey: "Zz" }, ...TABLE.rows] },
  ];
  server.getSnapshot.mockResolvedValue(wireSnapshot(shifted));
  await store.refresh();
  expect(store.selection).toEqual(at("A3"));
  await store.setIdentifiedCell(identity, "edited");
  expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
    "t1",
    [{ rowId: "r1", colId: "c1", input: "edited" }],
    expect.any(String),
    expect.any(Number),
    expect.any(Array),
  );
  expect(store.inputOf(at("A3"))).toBe("edited");
  expect(store.inputOf(at("A2"))).toBe("");
});

it("queues formatting and renaming behind an earlier cell save, and continues after failures", async () => {
  const store = await open();
  const saving = deferred();
  server.setCells.mockImplementationOnce((...args) =>
    saving.promise.then(() => savedCells(...args)),
  );
  server.formatCells.mockResolvedValueOnce(changeWith(TABLE));
  server.renamePage.mockResolvedValueOnce(changeWith({ cells: [], views: [], tables: [] }));
  store.selection = at("A1");
  const saved = store.setCell(at("A1"), "first");
  const formatted = store.formatSelection({ bold: true });
  const renamed = store.renamePage("p1", "After");
  await idle();
  expect(server.formatCells).not.toHaveBeenCalled();
  expect(server.renamePage).not.toHaveBeenCalled();
  saving.reject(new Error("offline"));
  await Promise.all([saved, formatted, renamed]);
  expect(server.formatCells).toHaveBeenCalledOnce();
  expect(server.renamePage).toHaveBeenCalledOnce();
  expect(server.setCells.mock.invocationCallOrder[0]).toBeLessThan(
    server.formatCells.mock.invocationCallOrder[0]!,
  );
  expect(server.formatCells.mock.invocationCallOrder[0]).toBeLessThan(
    server.renamePage.mock.invocationCallOrder[0]!,
  );
});

describe("a sorted and filtered data table", () => {
  const COLUMNS: ColumnDefinition[] = [
    { name: "Item", type: "any" },
    { name: "Qty", type: "number" },
  ];

  // Item reads b, d, a, c down the stored rows. Sorted ascending they show stored rows 2, 0, 3, 1.
  async function openSorted(display: (typeof TABLE)["display"]) {
    const table = { ...TABLE, columns: COLUMNS, display };
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith({ A1: "b", A2: "d", A3: "a", A4: "c", B1: "1", B2: "2", B3: "3", B4: "4" }),
        tables: [table],
      }),
    );
    const store = useWorkbookStore();
    await store.load("s1");
    return store;
  }
  const SORTED = { sort: [{ colId: "c1", descending: false }] };

  it("gives the rows in display order and maps places to stored rows and back", async () => {
    const store = await openSorted(SORTED);
    const view = store.rowView("t1");
    expect(view.rows).toEqual([2, 0, 3, 1]);
    expect(view.reordered).toBe(true);
    expect([0, 1, 2, 3].map((row) => view.place(row))).toEqual([1, 3, 0, 2]);
    expect([0, 1, 2, 3, 4].map(view.storedRow)).toEqual([2, 0, 3, 1, 4]);
    // A row the table does not have yet is placed after the last shown.
    expect(view.place(4)).toBe(4);
  });

  it("shows every row in stored order when there is no sort or filter", async () => {
    const store = await openSorted({ sort: [] });
    expect(store.rowView("t1")).toMatchObject({ rows: [0, 1, 2, 3], reordered: false, hidden: 0 });
  });

  it("leaves out the rows a filter rejects, counts them, and reports an error in the formula", async () => {
    const store = await openSorted({ sort: [], filter: "=[Qty] > 2" });
    expect(store.rowView("t1")).toMatchObject({ rows: [2, 3], hidden: 2, filterError: undefined });
    expect(store.rowView("t1").place(0)).toBeUndefined();
    const broken = await openSorted({ sort: [], filter: "=[Qty] >" });
    expect(broken.rowView("t1").filterError).toBeDefined();
    expect(broken.rowView("t1").hidden).toBe(0);
  });

  it("reports the code of a filter error that has no message", async () => {
    const store = await openSorted({ sort: [], filter: "=QUOTIENT(1, 0)" });
    expect(store.rowView("t1")).toMatchObject({ rows: [0, 1, 2, 3], filterError: "#DIV/0!" });
  });

  it("re-sorts as cells change, and the selection follows its cell", async () => {
    const store = await openSorted(SORTED);
    store.selection = at("A3");
    await store.setCell(at("A3"), "z");
    expect(store.rowView("t1").rows).toEqual([0, 3, 1, 2]);
    expect(store.selection).toEqual(at("A3"));
    expect(store.selectedRange).toEqual({ startRow: 3, endRow: 3, startCol: 0, endCol: 0 });
  });

  it("makes the selection a rectangle of the rows shown", async () => {
    const store = await openSorted(SORTED);
    store.selection = at("A3");
    store.extendSelection(at("A4"));
    expect(store.selectedRange).toEqual({ startRow: 0, endRow: 2, startCol: 0, endCol: 0 });
  });

  it("clears the selection when a filter hides its row", async () => {
    const store = await openSorted({ sort: [], filter: "=[Qty] > 1" });
    store.selection = at("B2");
    await store.setCell(at("B2"), "0");
    expect(store.selection).toBeNull();
  });

  it("pastes down the rows shown, each formula moving by the stored distance", async () => {
    const store = await openSorted(SORTED);
    store.selection = at("A3");
    store.extendSelection(at("B3"));
    // Place 0 is stored row 3 (a, 3). Pasting it at place 2 lands in stored row 4 (c, 4).
    const text = store.copySelection();
    expect(text).toBe("a\t3");
    store.selection = at("A4");
    await store.paste(text);
    expect(server.setCells.mock.calls[0]?.[1]).toEqual([
      { rowId: "r3", colId: "c1", input: "a" },
      { rowId: "r3", colId: "c2", input: "3" },
    ]);
  });

  it("deletes the stored rows of the places selected, though they are not adjacent", async () => {
    const store = await openSorted(SORTED);
    server.editTable.mockResolvedValue(changeWith());
    // Stored rows 2 and 3 sit next to each other, and rows 0 and 3 do not.
    await store.deleteLines("t1", "row", [0, 3]);
    expect(server.editTable).toHaveBeenCalledExactlyOnceWith("t1", {
      axis: "row",
      kind: "delete",
      ids: ["r0", "r3"],
    });
  });

  it("refuses to format several rows, and formats one row or whole columns", async () => {
    const store = await openSorted(SORTED);
    store.selection = at("A3");
    store.extendSelection(at("B1"));
    expect(await store.formatSelection({ bold: true })).toBe(false);
    expect(store.notice?.text).toContain("sorted or filtered");
    expect(server.formatCells).not.toHaveBeenCalled();

    server.formatCells.mockResolvedValue(changeWith());
    store.selection = at("A3");
    store.extendSelection(at("B3"));
    expect(await store.formatSelection({ bold: true })).toBe(true);
    expect(server.formatCells).toHaveBeenLastCalledWith(
      "t1",
      { startRowId: "r2", endRowId: "r2", startColId: "c1", endColId: "c2" },
      { bold: true },
      false,
    );

    // The first place is stored row 3, but a whole column covers every stored row.
    store.selection = at("B3");
    store.extendSelection(at("B2"));
    expect(await store.formatSelection({ italic: true })).toBe(true);
    expect(server.formatCells).toHaveBeenLastCalledWith(
      "t1",
      { startRowId: "r0", endRowId: null, startColId: "c2", endColId: "c2" },
      { italic: true },
      false,
    );
  });

  it("saves the sort and filter", async () => {
    const store = await openSorted(SORTED);
    server.setTableDisplay.mockResolvedValue(changeWith());
    await store.setTableDisplay("t1", { sort: [], filter: "=[Qty] > 1" }, 7);
    expect(server.setTableDisplay).toHaveBeenCalledExactlyOnceWith(
      "t1",
      { sort: [], filter: "=[Qty] > 1" },
      7,
    );
  });
});

describe("dropdown columns", () => {
  const SOURCE = {
    ...TABLE,
    id: "t2",
    name: "Races",
    colIds: ["d1", "d2", "d3"],
    columns: [{ name: "Race Name", type: "text" as const }],
  };
  const withColumn = (column: ColumnDefinition) => ({
    ...TABLE,
    columns: [column, { name: "Other", type: "any" as const }],
  });
  async function openChoices(column: ColumnDefinition) {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith(),
        tables: [withColumn(column), SOURCE],
        cells: [
          { tableId: "t2", rowId: "r0", colId: "d1", input: "Trial" },
          { tableId: "t2", rowId: "r1", colId: "d1", input: "Sprint" },
          { tableId: "t2", rowId: "r2", colId: "d1", input: "Trial" },
          { tableId: "t2", rowId: "r3", colId: "d1", input: "=1+1" },
        ],
      }),
    );
    const store = useWorkbookStore();
    await store.load("s1");
    return store;
  }

  it("offers the list of a column that has one, and nothing for other columns", async () => {
    const store = await openChoices({ name: "Race", type: "choice", choices: ["a", "b"] });
    expect(store.choicesOf("t1", 0)).toEqual(["a", "b"]);
    expect(store.choicesOf("t1", 1)).toBeUndefined();
  });

  it("offers the distinct non-empty values of the source column in stored order", async () => {
    const store = await openChoices({
      name: "Race",
      type: "choice",
      choicesFrom: { tableId: "t2", colId: "d1" },
    });
    expect(store.choicesOf("t1", 0)).toEqual(["Trial", "Sprint", "=1+1"]);
  });

  it("follows a change to the source column", async () => {
    const store = await openChoices({
      name: "Race",
      type: "choice",
      choicesFrom: { tableId: "t2", colId: "d1" },
    });
    await store.setCell({ tableId: "t2", row: 1, col: 0 }, "Rally");
    expect(store.choicesOf("t1", 0)).toEqual(["Trial", "Rally", "=1+1"]);
  });

  it("offers at most as many choices as a list may hold", async () => {
    const many = Array.from({ length: 250 }, (_, index) => `v${String(index)}`);
    const store = await openChoices({
      name: "Race",
      type: "choice",
      choicesFrom: { tableId: "t2", colId: "d1" },
    });
    await store.setCells(
      "t2",
      many.map((input, row) => ({ row, col: 0, input })),
    );
    expect(store.choicesOf("t1", 0)).toHaveLength(200);
  });

  it("offers nothing when the source is gone", async () => {
    const store = await openChoices({
      name: "Race",
      type: "choice",
      choicesFrom: { tableId: "gone", colId: "d1" },
    });
    expect(store.choicesOf("t1", 0)).toEqual([]);
  });
});

describe("conditional formats", () => {
  const rules: ConditionalRule[] = [
    {
      startRow: 0,
      endRow: null,
      startCol: 0,
      endCol: 0,
      kind: "criterion",
      criterion: ">3",
      format: { color: "red", bold: true },
    },
    { startRow: 0, endRow: 3, startCol: 1, endCol: 1, kind: "scale", low: null, high: "blue" },
  ];
  const FORMATS: FormatRule[] = [
    { startRow: 0, endRow: null, startCol: 0, endCol: 0, format: { fill: "yellow", bold: true } },
  ];

  async function openRules(inputs: Record<string, string>) {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith(inputs),
        tables: [{ ...TABLE, formats: FORMATS, conditionalFormats: rules }],
      }),
    );
    const store = useWorkbookStore();
    await store.load("s1");
    return store;
  }

  it("lays the conditional format over the plain one where the value meets the criterion", async () => {
    const store = await openRules({ A1: "5", A2: "1", B1: "10", B2: "30" });
    expect(store.formatOf(at("A1"))).toEqual({ fill: "yellow", bold: true, color: "red" });
    expect(store.formatOf(at("A2"))).toEqual({ fill: "yellow", bold: true });
  });

  it("lets a null conditional format remove what the plain format gave", async () => {
    server.getSnapshot.mockResolvedValue(
      wireSnapshot({
        ...snapshotWith({ A1: "5", A2: "1" }),
        tables: [
          {
            ...TABLE,
            formats: FORMATS,
            conditionalFormats: [
              {
                startRow: 0,
                endRow: null,
                startCol: 0,
                endCol: 0,
                kind: "criterion",
                criterion: ">3",
                format: { fill: null, bold: false },
              },
            ],
          },
        ],
      }),
    );
    const store = useWorkbookStore();
    await store.load("s1");
    expect(store.formatOf(at("A1"))).toEqual({});
    expect(store.formatOf(at("A2"))).toEqual({ fill: "yellow", bold: true });
  });

  it("shades a scale by the numbers it covers", async () => {
    const store = await openRules({ B1: "10", B2: "30", B3: "20" });
    expect(store.formatOf(at("B1")).shade).toEqual({ low: null, high: "blue", at: 0 });
    expect(store.formatOf(at("B2")).shade).toEqual({ low: null, high: "blue", at: 1 });
    expect(store.formatOf(at("B3")).shade).toEqual({ low: null, high: "blue", at: 0.5 });
    expect(store.formatOf(at("C1"))).toEqual({});
  });

  it("follows a cell as it changes, including the bounds of a scale", async () => {
    const store = await openRules({ A1: "1", B1: "10", B2: "30" });
    expect(store.formatOf(at("A1")).color).toBeUndefined();
    await store.setCell(at("A1"), "9");
    expect(store.formatOf(at("A1")).color).toBe("red");
    await store.setCell(at("B2"), "50");
    expect(store.formatOf(at("B1")).shade?.at).toBe(0);
    expect(store.formatOf(at("B2")).shade?.at).toBe(1);
  });

  it("adds a rule over the selection, after the rules the table has, by ids", async () => {
    const store = await openRules({});
    server.setConditionalFormats.mockResolvedValue(changeWith());
    store.selection = at("C2");
    store.extendSelection(at("C3"));
    await store.addConditionalFormat({
      kind: "criterion",
      criterion: "Done",
      format: { fill: "green" },
    });
    expect(server.setConditionalFormats).toHaveBeenCalledExactlyOnceWith("t1", [
      {
        range: { startRowId: "r0", endRowId: null, startColId: "c1", endColId: "c1" },
        kind: "criterion",
        criterion: ">3",
        format: { color: "red", bold: true },
      },
      {
        range: { startRowId: "r0", endRowId: "r3", startColId: "c2", endColId: "c2" },
        kind: "scale",
        low: null,
        high: "blue",
      },
      {
        range: { startRowId: "r1", endRowId: "r2", startColId: "c3", endColId: "c3" },
        kind: "criterion",
        criterion: "Done",
        format: { fill: "green" },
      },
    ]);
  });

  it("removes a rule by its place in the list", async () => {
    const store = await openRules({});
    server.setConditionalFormats.mockResolvedValue(changeWith());
    await store.removeConditionalFormat("t1", 0);
    expect(server.setConditionalFormats.mock.calls[0]?.[1]).toMatchObject([{ kind: "scale" }]);
  });
});

it("updates document errors and page/block warnings when cells are corrected", async () => {
  const store = await open({ A1: "=1/0", B1: "=Missing" });
  expect(store.errors.map((failure) => failure.label)).toEqual(["Table 1!A1", "Table 1!B1"]);
  expect(store.errorPages.has("p1")).toBe(true);
  expect(store.errorBlocks.has("t1")).toBe(true);
  await store.setCell(at("A1"), "1");
  expect(store.errors).toHaveLength(1);
  await store.setCell(at("B1"), "2");
  expect(store.errors).toEqual([]);
  expect(store.errorPages.size).toBe(0);
  expect(store.errorBlocks.size).toBe(0);
});
