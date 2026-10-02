import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ColumnDefinition } from "@spreadsheet-app/engine";
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
  server.getSnapshot.mockResolvedValue(snapshotWith(inputs, role));
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

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  server.setCells.mockResolvedValue(undefined);
  server.deleteTable.mockResolvedValue(undefined);
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
    server.getSnapshot.mockResolvedValue({ ...snapshotWith(), id: "s2" });
    await store.load("s2");
    gone.reject(new Error("Spreadsheet not found"));
    await expect(first).resolves.toBeUndefined();
    expect(store.spreadsheet?.id).toBe("s2");
  });
});

describe("setCell", () => {
  it("shows the new value before the save finishes, then saves it", async () => {
    const store = await open({ A1: "1", B1: "=A1+1" });
    const save = deferred();
    server.setCells.mockReturnValue(save.promise);

    const done = store.setCell(at("A1"), "10");
    expect(store.valueOf(at("B1"))).toBe(11);
    save.resolve();
    await done;
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith(
      "t1",
      [{ row: 0, col: 0, input: "10" }],
      expect.any(String),
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
    server.setCells.mockReturnValueOnce(first.promise);

    const firstDone = store.setCell(at("A1"), "2");
    const secondDone = store.setCell(at("A1"), "3");
    first.reject(new Error("rejected"));
    await Promise.all([firstDone, secondDone]);

    expect(store.inputOf(at("A1"))).toBe("3");
    expect(server.setCells).toHaveBeenLastCalledWith(
      "t1",
      [{ row: 0, col: 0, input: "3" }],
      expect.any(String),
    );
  });

  it("saves edits one at a time, in the order they were made", async () => {
    const store = await open();
    const first = deferred();
    server.setCells.mockReturnValueOnce(first.promise);

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
    server.setCells.mockReturnValue(save.promise);

    const done = store.setCell(at("A1"), "2");
    await store.deleteTable("t1");
    save.reject(new Error("Table not found"));
    await done;
    expect(store.tables).toEqual([]);
  });
});

describe("saving", () => {
  it("is true from a change until the server has answered every queued one", async () => {
    const store = await open({ A1: "1" });
    const first = deferred();
    const second = deferred();
    server.setCells.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
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
        changed: { pages: [], tables: [], views: [], cells: [] },
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
        { row: 0, col: 1, input: "=A1+1" },
        { row: 1, col: 0, input: "x" },
      ],
      expect.any(String),
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
    server.updateTable.mockResolvedValue({
      table: { ...TABLE, rowCount: 1000, colCount: 3 },
      cells: [],
      views: [],
      tables: [],
    });
    await store.updateTable("t1", { rowCount: 1000 });
    const writes = Array.from({ length: 1500 }, (_, index) => ({
      row: index % 1000,
      col: Math.floor(index / 1000),
      input: String(index),
    }));
    server.setCells.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("too slow"));

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
    server.updateTable.mockResolvedValue({
      table: { ...TABLE, colCount: 100 },
      cells: [],
      views: [],
      tables: [],
    });
    store.selection = at("A1");
    await store.paste(cols);
    expect(server.updateTable).toHaveBeenCalledExactlyOnceWith(
      "t1",
      {
        rowCount: 4,
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

  it("does not paste when the table could not be grown", async () => {
    const store = await open();
    server.updateTable.mockRejectedValue(new Error("no"));
    store.selection = at("A4");
    await store.paste("a\nb");
    expect(server.setCells).not.toHaveBeenCalled();
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
    expect(server.click).toHaveBeenCalledExactlyOnceWith(at("B1"));
    expect(store.valueOf(at("A3"))).toBe(3);
    expect(store.valueOf(at("C1"))).toBe(6);
    expect(store.notice).toEqual({ kind: "success", text: "Updated A3" });
    expect(store.running.size).toBe(0);
  });

  it("names the table of a cell written outside the button's table", async () => {
    const store = await open({ B1: BUTTON });
    server.createTable.mockResolvedValue({ ...TABLE, id: "t2", name: "Log", position: 1 });
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
        tables: [{ ...TABLE, rowCount: 5 }],
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
    expect(server.input).toHaveBeenCalledExactlyOnceWith(at("B1"), true);
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
    server.setCells.mockReturnValue(save.promise);

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
    server.setCells.mockReturnValue(save.promise);

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
    server.createPage.mockResolvedValue({ page, table });
    expect(await store.addPage()).toEqual(page);
    expect(store.pages).toHaveLength(2);
    expect(store.tables).toHaveLength(2);

    await store.setCell(at("A1", "t2"), "7");
    expect(store.valueOf(at("A1"))).toBe(7);
  });

  it("re-resolves formulas when a table is renamed", async () => {
    const store = await open({ A1: "5", B1: "=Sales!A1" });
    expect(store.valueOf(at("B1"))).toMatchObject({ code: "#REF!" });

    server.updateTable.mockResolvedValue({
      table: { ...TABLE, name: "Sales" },
      cells: [],
      views: [],
      tables: [],
    });
    expect(await store.updateTable("t1", { name: "Sales" })).toBe(true);
    expect(store.tables[0]?.name).toBe("Sales");
    expect(store.valueOf(at("B1"))).toBe(5);
  });

  it("applies the formulas the server rewrote for a renamed table", async () => {
    const store = await open({ A1: "5", B1: "='Table 1'!A1" });
    server.updateTable.mockResolvedValue({
      table: { ...TABLE, name: "Sales" },
      cells: [{ ...at("B1"), input: "=Sales!A1" }],
      views: [],
      tables: [],
    });
    await store.updateTable("t1", { name: "Sales" });
    expect(store.inputOf(at("B1"))).toBe("=Sales!A1");
    expect(store.valueOf(at("B1"))).toBe(5);
  });

  it("applies the formulas the server rewrote for a renamed page", async () => {
    const store = await open({ A1: "5", B1: "='Page 1'!'Table 1'!A1" });
    server.renamePage.mockResolvedValue({
      cells: [{ ...at("B1"), input: "=Summary!'Table 1'!A1" }],
      views: [],
      tables: [],
    });
    await store.renamePage("p1", "Summary");
    expect(store.inputOf(at("B1"))).toBe("=Summary!'Table 1'!A1");
    expect(store.valueOf(at("B1"))).toBe(5);
  });

  it("applies a row deletion: resizes the table, moves cells, and keeps the selection inside", async () => {
    const store = await open({ A1: "1", A2: "2", A4: "=A1+A2" });
    store.selection = at("C4");
    server.editTable.mockResolvedValue({
      table: { ...TABLE, rowCount: 3 },
      cells: [
        { ...at("A1"), input: "2" },
        { ...at("A2"), input: "" },
        { ...at("A3"), input: "=#REF!+A1" },
        { ...at("A4"), input: "" },
      ],
      views: [],
      tables: [],
    });

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
    server.editTable.mockResolvedValue({
      table: { ...TABLE, rowCount: 3 },
      cells: [],
      views: [],
      tables: [],
    });
    await store.editTable("t1", { axis: "row", kind: "delete", index: 0 });
    expect(store.selectedRange).toEqual({ startRow: 1, endRow: 2, startCol: 0, endCol: 2 });
  });

  it("applies a smaller size: drops the cells that went, and keeps the selection inside", async () => {
    const store = await open({ A1: "1", C4: "gone", B1: "=C4" });
    store.selection = at("B2");
    store.extendSelection(at("C4"));
    server.updateTable.mockResolvedValue({
      table: { ...TABLE, rowCount: 2, colCount: 2 },
      cells: [
        { ...at("C4"), input: "" },
        { ...at("B1"), input: "=#REF!" },
      ],
      views: [],
      tables: [],
    });
    expect(await store.updateTable("t1", { rowCount: 2, colCount: 2 })).toBe(true);
    expect(store.inputOf(at("C4"))).toBe("");
    expect(store.inputOf(at("B1"))).toBe("=#REF!");
    expect(store.selection).toEqual(at("B2"));
    expect(store.selectedRange).toEqual({ startRow: 1, endRow: 1, startCol: 1, endCol: 1 });

    store.selection = at("A2");
    server.updateTable.mockResolvedValue({
      table: { ...TABLE, rowCount: 1, colCount: 2 },
      cells: [],
      views: [],
      tables: [],
    });
    await store.updateTable("t1", { rowCount: 1 });
    expect(store.selection).toEqual(at("A1"));
  });

  it("stores pending cell edits before asking the server to move cells", async () => {
    const store = await open({ A1: "1" });
    const save = deferred();
    server.setCells.mockReturnValue(save.promise);
    server.editTable.mockResolvedValue({ table: TABLE, cells: [], views: [], tables: [] });

    void store.setCell(at("A1"), "5");
    const edited = store.editTable("t1", { axis: "row", kind: "insert", index: 0 });
    await Promise.resolve();
    expect(server.editTable).not.toHaveBeenCalled();
    save.resolve();
    await edited;
    expect(server.editTable).toHaveBeenCalledOnce();
  });

  it("reports a refused row or column edit", async () => {
    const store = await open();
    server.editTable.mockRejectedValue(new Error("A table needs at least one row"));
    expect(await store.editTable("t1", { axis: "row", kind: "delete", index: 0 })).toBe(false);
    expect(store.notice).toEqual({ kind: "error", text: "A table needs at least one row" });
  });

  it("adds a table to a page", async () => {
    const store = await open();
    server.createTable.mockResolvedValue({ ...TABLE, id: "t2", name: "Table 2", position: 1 });
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
    server.createPage.mockResolvedValue({ page, table: { ...TABLE, id: "t2", pageId: "p2" } });
    await store.addPage();
    store.selection = at("A1", "t2");

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
    server.getSnapshot.mockResolvedValue({ ...snapshotWith(inputs), views });
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
    server.createView.mockResolvedValue(CHART);
    expect(await store.addView("p1", "chart")).toBe(true);
    expect(server.createView).toHaveBeenCalledWith("p1", "chart");
    expect(store.views).toEqual([CHART]);
  });

  it("replaces a view with what the server stored", async () => {
    const store = await openWith([CHART, TEXT]);
    server.updateView.mockResolvedValue({ ...CHART, chartType: "pie" });
    expect(await store.updateView("v1", { chartType: "pie" })).toBe(true);
    expect(store.views).toEqual([{ ...CHART, chartType: "pie" }, TEXT]);
  });

  it("serializes overlapping updates to the same view", async () => {
    const store = await openWith([CHART, TEXT]);
    let finishFirst!: (view: ViewRecord) => void;
    let finishSecond!: (view: ViewRecord) => void;
    const firstResponse = new Promise<ViewRecord>((resolve) => (finishFirst = resolve));
    const secondResponse = new Promise<ViewRecord>((resolve) => (finishSecond = resolve));
    server.updateView.mockReturnValueOnce(firstResponse).mockReturnValueOnce(secondResponse);

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
    server.renamePage.mockResolvedValue({
      cells: [],
      views: [{ id: "v1", source: "Data!'Table 1'!A1:B2" }],
      tables: [],
    });
    await store.renamePage("p1", "Data");
    expect(store.views.map((view) => view.source)).toEqual(["Data!'Table 1'!A1:B2", "plain"]);
  });

  it("drops the views of a deleted page", async () => {
    server.getSnapshot.mockResolvedValue({
      ...snapshotWith(),
      pages: [
        { id: "p1", name: "Page 1", position: 0 },
        { id: "p2", name: "Page 2", position: 1 },
      ],
      views: [CHART, { ...TEXT, pageId: "p2" }],
    });
    const store = useWorkbookStore();
    await store.load("s1");
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
    server.getSnapshot.mockResolvedValue({ ...snapshotWith(inputs), tables: [DATA_TABLE] });
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
    server.updateColumn.mockResolvedValue({
      table: { ...DATA_TABLE, columns: changed },
      cells: [],
      views: [],
      tables: [],
    });
    await store.setCell(at("C2"), "=[Price] + 1");
    expect(server.updateColumn).toHaveBeenCalledExactlyOnceWith("t1", 2, {
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
        { row: 0, col: 1, input: "7" },
        { row: 1, col: 1, input: "9" },
      ],
      expect.any(String),
    );
    expect(store.valueOf(at("C1"))).toBe(14);
  });

  it("names the columns of a table, and shows the cells the server moved", async () => {
    const store = await open({ A1: "Price", A2: "4" });
    server.nameColumns.mockResolvedValue({
      table: { ...TABLE, rowCount: 3, columns: [{ name: "Price", type: "any" }] },
      cells: [
        { ...at("A1"), input: "4" },
        { ...at("A2"), input: "" },
      ],
      views: [],
      tables: [],
    });
    expect(await store.nameColumns("t1", true)).toBe(true);
    expect(server.nameColumns).toHaveBeenCalledExactlyOnceWith("t1", true);
    expect(store.tables[0]?.columns).toEqual([{ name: "Price", type: "any" }]);
    expect(store.valueOf(at("A1"))).toBe(4);
    expect(store.inputOf(at("A2"))).toBe("");
  });

  it("changes a column, and reads its cells as the new type", async () => {
    const store = await openData({ B1: "007" });
    server.updateColumn.mockResolvedValue({
      table: { ...DATA_TABLE, columns: COLUMNS.with(1, { name: "Qty", type: "text" }) },
      cells: [],
      views: [],
      tables: [],
    });
    expect(store.valueOf(at("B1"))).toBe(7);
    expect(await store.updateColumn("t1", 1, { type: "text" })).toBe(true);
    expect(store.valueOf(at("B1"))).toBe("007");
  });

  it("drops the column names, after which the formula column is empty", async () => {
    const store = await openData();
    server.dropColumns.mockResolvedValue(TABLE);
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
    server.renamePage.mockResolvedValue({
      cells: [],
      views: [],
      tables: [{ ...DATA_TABLE, columns: rewritten }],
    });
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
    server.getSnapshot.mockResolvedValue({
      ...snapshotWith(),
      views: [view("v2", 2), view("v1", 1), { ...view("far", 0), pageId: "p9" }],
    });
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
      .mockResolvedValueOnce(undefined);
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
    server.getSnapshot.mockResolvedValue({ ...snapshotWith(inputs), pages: PAGES, views: [TEXT] });
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
      .mockResolvedValueOnce(undefined);
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
    server.moveTable.mockResolvedValue({
      table: { ...TABLE, pageId: "p2", position: 0 },
      cells: [],
      views: [{ id: "v1", source: "{{ 'Page 2'!'Table 1'!A1 }}" }],
      tables: [],
    });
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
    server.moveView.mockResolvedValue({ view: moved, cells: [], views: [], tables: [] });
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
      changed: changedCell("1"),
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
      changed: changedCell("2"),
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
      changed: {
        pages: [],
        tables: [{ id: "t1", table: TABLE }],
        views: [],
        cells: [{ ...at("A1"), input: "restored" }],
      },
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
    server.setCells.mockReturnValue(saving.promise);
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

    server.setCells.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("refused"));
    answer({
      outcome: "done",
      label: "Change cells in Table 1",
      error: null,
      changed: changedCell("1"),
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
    server.getSnapshot.mockResolvedValue({ ...snapshotWith(), pages, views: [view] });
    const store = useWorkbookStore();
    await store.load("s1");

    const reordering = deferred();
    let finishView!: (value: ViewRecord) => void;
    const updating = new Promise<ViewRecord>((resolve) => (finishView = resolve));
    server.reorderPages.mockReturnValue(reordering.promise);
    server.updateView.mockReturnValue(updating);
    const pageMove = store.movePage("p1", 1);
    const viewUpdate = store.updateView("v1", { source: "after" });
    const history = store.undo();
    await vi.waitFor(() => {
      expect(server.reorderPages).toHaveBeenCalledOnce();
      expect(server.updateView).toHaveBeenCalledOnce();
    });
    expect(server.undo).not.toHaveBeenCalled();

    reordering.resolve();
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
      changed: { pages: [], tables: [], views: [], cells: [] },
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
    server.getSnapshot.mockResolvedValue({
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
    });
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
    server.getSnapshot.mockResolvedValue({
      ...snapshotWith({ A1: "2", B1: "theirs" }),
      undoable: true,
      redoable: false,
    });
    await store.refresh();
    expect(store.canUndo).toBe(true);

    server.getSnapshot.mockResolvedValue({
      ...snapshotWith({ A1: "2" }),
      tables: [{ ...TABLE, name: "Renamed" }],
      undoable: false,
      redoable: true,
    });
    await store.refresh();
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);
  });

  it("drops a selection in a table or a row that is gone", async () => {
    const store = await open();
    store.selection = at("C4");
    server.getSnapshot.mockResolvedValue({
      ...snapshotWith(),
      tables: [{ ...TABLE, rowCount: 2 }],
    });
    await store.refresh();
    expect(store.selection).toBeNull();
  });

  it("follows a change of role", async () => {
    const store = await open();
    server.getSnapshot.mockResolvedValue(snapshotWith({}, "viewer"));
    await store.refresh();
    expect(store.canEdit).toBe(false);
  });

  it("waits for what was typed here to be saved before reading", async () => {
    const store = await open();
    const saving = deferred();
    server.setCells.mockReturnValueOnce(saving.promise);
    const typed = store.setCell(at("A1"), "mine");
    server.getSnapshot.mockClear();
    const refreshed = store.refresh();
    await Promise.resolve();
    expect(server.getSnapshot).not.toHaveBeenCalled();

    server.getSnapshot.mockResolvedValue(snapshotWith({ A1: "mine", B1: "theirs" }));
    saving.resolve();
    await typed;
    await refreshed;
    expect(store.inputOf(at("A1"))).toBe("mine");
    expect(store.inputOf(at("B1"))).toBe("theirs");
  });

  it("reads again when an undo was answered while the spreadsheet was being read", async () => {
    const store = await open({ A1: "2" });
    notifyJournaled();
    const answers: ((snapshot: Snapshot) => void)[] = [];
    server.getSnapshot.mockImplementation(
      () => new Promise<Snapshot>((resolve) => answers.push(resolve)),
    );
    const refreshed = store.refresh();
    await vi.waitFor(() => {
      expect(answers).toHaveLength(1);
    });

    server.undo.mockResolvedValue({
      outcome: "done",
      label: "Change cells in Table 1",
      error: null,
      changed: { pages: [], tables: [], views: [], cells: [{ ...at("A1"), input: "1" }] },
      undoable: false,
      redoable: true,
    });
    await store.undo();
    // The first read began before the undo, and still has what it undid.
    answers[0]?.({ ...snapshotWith({ A1: "2" }), undoable: true });
    await vi.waitFor(() => {
      expect(answers).toHaveLength(2);
    });
    expect(store.inputOf(at("A1"))).toBe("1");
    answers[1]?.({ ...snapshotWith({ A1: "1", B1: "theirs" }), redoable: true });
    await refreshed;
    expect(store.inputOf(at("A1"))).toBe("1");
    expect(store.inputOf(at("B1"))).toBe("theirs");
    expect(store.canUndo).toBe(false);
    expect(store.canRedo).toBe(true);
  });

  it("waits for a change to the structure made here before reading", async () => {
    const store = await open();
    const renaming = deferred();
    server.renameSpreadsheet.mockReturnValueOnce(renaming.promise);
    const renamed = store.renameSpreadsheet("Mine");
    server.getSnapshot.mockClear();
    const refreshed = store.refresh();
    await Promise.resolve();
    expect(server.getSnapshot).not.toHaveBeenCalled();

    server.getSnapshot.mockResolvedValue({ ...snapshotWith(), name: "Mine" });
    renaming.resolve();
    await Promise.all([renamed, refreshed]);
    expect(server.getSnapshot).toHaveBeenCalledOnce();
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
