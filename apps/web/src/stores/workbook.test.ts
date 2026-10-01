import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { computed } from "vue";
import { api } from "../api/client";
import { at, clickResult, snapshotWith, TABLE, type MockedApi } from "../testing";
import { useWorkbookStore } from "./workbook";

vi.mock("../api/client", async () => ({ api: (await import("../testing")).mockApi() }));
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
    expect(server.setCells).toHaveBeenCalledExactlyOnceWith("t1", [
      { row: 0, col: 0, input: "10" },
    ]);
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
    expect(server.setCells).toHaveBeenLastCalledWith("t1", [{ row: 0, col: 0, input: "3" }]);
  });

  it("saves edits one at a time, in the order they were made", async () => {
    const store = await open();
    const first = deferred();
    server.setCells.mockReturnValueOnce(first.promise);

    void store.setCell(at("A1"), "first");
    const second = store.setCell(at("A2"), "second");
    await Promise.resolve();
    expect(server.setCells).toHaveBeenCalledTimes(1);

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

    server.updateTable.mockResolvedValue({ table: { ...TABLE, name: "Sales" }, cells: [] });
    expect(await store.updateTable("t1", { name: "Sales" })).toBe(true);
    expect(store.tables[0]?.name).toBe("Sales");
    expect(store.valueOf(at("B1"))).toBe(5);
  });

  it("applies the formulas the server rewrote for a renamed table", async () => {
    const store = await open({ A1: "5", B1: "='Table 1'!A1" });
    server.updateTable.mockResolvedValue({
      table: { ...TABLE, name: "Sales" },
      cells: [{ ...at("B1"), input: "=Sales!A1" }],
    });
    await store.updateTable("t1", { name: "Sales" });
    expect(store.inputOf(at("B1"))).toBe("=Sales!A1");
    expect(store.valueOf(at("B1"))).toBe(5);
  });

  it("applies the formulas the server rewrote for a renamed page", async () => {
    const store = await open({ A1: "5", B1: "='Page 1'!'Table 1'!A1" });
    server.renamePage.mockResolvedValue({
      cells: [{ ...at("B1"), input: "=Summary!'Table 1'!A1" }],
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
    });

    expect(await store.editTable("t1", { axis: "row", kind: "delete", index: 0 })).toBe(true);
    expect(store.tables[0]?.rowCount).toBe(3);
    expect(store.inputOf(at("A1"))).toBe("2");
    expect(store.inputOf(at("A2"))).toBe("");
    expect(store.valueOf(at("A3"))).toMatchObject({ code: "#REF!" });
    expect(store.selection).toEqual(at("C3"));
  });

  it("stores pending cell edits before asking the server to move cells", async () => {
    const store = await open({ A1: "1" });
    const save = deferred();
    server.setCells.mockReturnValue(save.promise);
    server.editTable.mockResolvedValue({ table: TABLE, cells: [] });

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
