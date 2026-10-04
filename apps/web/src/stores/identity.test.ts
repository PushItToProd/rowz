import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type Change } from "../api/client";
import {
  at,
  changeWith,
  identifiedAt,
  sizedTable,
  snapshotWith,
  TABLE,
  type MockedApi,
} from "../testing";
import { useWorkbookStore } from "./workbook";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

async function open(inputs: Record<string, string> = {}) {
  server.getSnapshot.mockResolvedValue({ ...snapshotWith(inputs), revision: 0 });
  const store = useWorkbookStore();
  await store.load("s1");
  return store;
}

function inserted(revision = 1): Change {
  return changeWith({ rows: [{ id: "inserted", tableId: "t1", orderKey: "Zz" }] }, revision);
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("identity and revision ordering", () => {
  it("does not extend the selection when a delayed paste finishes", async () => {
    const store = await open();
    const response = deferred<Change>();
    server.setCells.mockReturnValueOnce(response.promise);
    store.selection = at("A1");

    const paste = store.paste("first\nsecond");
    expect(store.selectedRange).toEqual({ startRow: 0, startCol: 0, endRow: 1, endCol: 0 });
    await vi.waitFor(() => {
      expect(server.setCells).toHaveBeenCalledOnce();
    });

    store.selection = at("C4");
    response.resolve(
      changeWith(
        {
          cells: [
            { ...identifiedAt("A1"), input: "first" },
            { ...identifiedAt("A2"), input: "second" },
          ],
        },
        1,
      ),
    );
    await paste;

    expect(store.selectedRange).toEqual({ startRow: 3, startCol: 2, endRow: 3, endCol: 2 });
  });

  it("keeps a paste selection that reaches newly created columns", async () => {
    const store = await open();
    const response = deferred<Change>();
    server.updateTable.mockReturnValueOnce(response.promise);
    server.setCells.mockImplementationOnce((tableId, cells) =>
      Promise.resolve(changeWith({ cells: cells.map((cell) => ({ tableId, ...cell })) }, 2)),
    );
    store.selection = at("C1");

    const paste = store.paste("last\textra");
    expect(store.selectedRange).toEqual({ startRow: 0, startCol: 2, endRow: 0, endCol: 3 });
    await vi.waitFor(() => {
      expect(server.updateTable).toHaveBeenCalledOnce();
    });

    response.resolve(changeWith(sizedTable({ colCount: 4 }), 1));
    await paste;

    expect(store.inputOf(at("D1"))).toBe("extra");
    expect(store.selectedRange).toEqual({ startRow: 0, startCol: 2, endRow: 0, endCol: 3 });
  });

  it("preserves later optimistic typing when a structural response arrives", async () => {
    const store = await open({ A2: "old" });
    const response = deferred<Change>();
    server.editTable.mockReturnValueOnce(response.promise);
    server.setCells.mockImplementationOnce((tableId, cells) =>
      Promise.resolve(changeWith({ cells: cells.map((cell) => ({ tableId, ...cell })) }, 2)),
    );
    const edit = store.editTable("t1", { axis: "row", kind: "insert", index: 0 });
    const save = store.setCell(at("A2"), "mine");
    response.resolve(inserted());
    await Promise.all([edit, save]);
    expect(store.inputOf(at("A3"))).toBe("mine");
    expect(server.setCells.mock.calls[0]?.[1]).toEqual([
      { rowId: "r1", colId: "c1", input: "mine" },
    ]);
  });

  it("uses both distinct row IDs when a paste grows the table behind a queued insert", async () => {
    const store = await open();
    const response = deferred<Change>();
    server.editTable.mockReturnValueOnce(response.promise);
    server.setCells.mockImplementationOnce((tableId, cells, _step, _revision, appendRows = []) =>
      Promise.resolve(
        changeWith(
          {
            cells: cells.map((cell) => ({ tableId, ...cell })),
            rows: appendRows.map((id) => ({ id, tableId, orderKey: "a4" })),
          },
          2,
        ),
      ),
    );
    const edit = store.editTable("t1", { axis: "row", kind: "insert", index: 0 });
    store.selection = at("A4");
    const paste = store.paste("existing\nappended");
    response.resolve(inserted());
    await Promise.all([edit, paste]);
    const [, cells, , , appendRows] = server.setCells.mock.calls[0]!;
    expect(cells.map((cell) => cell.rowId)).toEqual(["r3", appendRows?.[0]]);
    expect(store.inputOf(at("A5"))).toBe("existing");
    expect(store.inputOf(at("A6"))).toBe("appended");
  });

  it("returns to confirmed input when two consecutive saves of the same cell fail", async () => {
    const store = await open({ A1: "confirmed" });
    server.setCells
      .mockRejectedValueOnce(new Error("first"))
      .mockRejectedValueOnce(new Error("second"));
    await Promise.all([store.setCell(at("A1"), "one"), store.setCell(at("A1"), "two")]);
    expect(store.inputOf(at("A1"))).toBe("confirmed");
  });

  it("applies its own event before the response and ignores that response after a later event", async () => {
    const store = await open({ A1: "old" });
    const response = deferred<Change>();
    server.editTable.mockReturnValueOnce(response.promise);
    const edit = store.editTable("t1", { axis: "row", kind: "insert", index: 0 });
    await store.receiveChange(inserted());
    await store.receiveChange(
      changeWith({ cells: [{ ...identifiedAt("A1"), input: "remote" }] }, 2),
    );
    response.resolve(inserted());
    await edit;
    expect(store.revision).toBe(2);
    expect(store.inputOf(at("A2"))).toBe("remote");
    expect(store.tables[0]?.rowCount).toBe(5);
  });

  it("reads a snapshot on a revision gap without losing pending typing", async () => {
    const store = await open({ A2: "old" });
    const response = deferred<Change>();
    server.setCells.mockReturnValueOnce(response.promise);
    const save = store.setCell(at("A2"), "mine");
    server.getSnapshot.mockResolvedValue({
      ...snapshotWith({ A2: "old" }),
      revision: 3,
      rows: [
        { id: "inserted", tableId: "t1", orderKey: "Zz" },
        ...TABLE.rows.map((row) => ({ ...row, tableId: "t1" })),
      ],
    });
    await store.receiveChange(changeWith({}, 3));
    expect(store.inputOf(at("A3"))).toBe("mine");
    response.resolve(changeWith({ cells: [{ ...identifiedAt("A2"), input: "mine" }] }, 4));
    await save;
    expect(store.inputOf(at("A3"))).toBe("mine");
    expect(server.getSnapshot).toHaveBeenCalledTimes(2);
  });

  it("keeps a running button attached to its row across an insertion", async () => {
    const store = await open({ A1: '=BUTTON("Go", EXECUTE(1, B1))' });
    const response = deferred<Awaited<ReturnType<typeof api.click>>>();
    server.click.mockReturnValueOnce(response.promise);
    const click = store.click(at("A1"));
    expect(store.isRunning(at("A1"))).toBe(true);
    await store.receiveChange(inserted());
    expect(store.isRunning(at("A2"))).toBe(true);
    expect(store.isRunning(at("A1"))).toBe(false);
    response.resolve({
      runId: "run",
      status: "succeeded",
      error: null,
      emailsSent: 0,
      change: null,
    });
    await click;
    expect(store.isRunning(at("A2"))).toBe(false);
  });

  it("saves an unchanged formula draft to its moved target after a remote insertion", async () => {
    const store = await open();
    const identity = store.identityOf(at("A2"))!;
    const revision = store.revision;
    await store.receiveChange(inserted());
    server.setCells.mockImplementationOnce((tableId, cells) =>
      Promise.resolve(changeWith({ cells: cells.map((cell) => ({ tableId, ...cell })) }, 2)),
    );
    await store.setIdentifiedCell(identity, "=A1", revision);
    expect(server.setCells.mock.calls[0]?.[3]).toBe(0);
    expect(store.inputOf(at("A3"))).toBe("=A1");
    expect(store.rejectedDraft).toBeNull();
  });

  it("uses the paste's initial revision for every batch", async () => {
    const store = await open();
    let revision = 0;
    server.setCells.mockImplementation((tableId, cells, _step, _revision, appendRows = []) =>
      Promise.resolve(
        changeWith(
          {
            cells: cells.map((cell) => ({ tableId, ...cell })),
            rows: appendRows.map((id, index) => ({
              id,
              tableId,
              orderKey: `b${String(index).padStart(4, "0")}`,
            })),
          },
          ++revision,
        ),
      ),
    );
    await store.setCells(
      "t1",
      Array.from({ length: 1500 }, (_, index) => ({
        row: index % 750,
        col: Math.floor(index / 750),
        input: "=1",
      })),
    );
    expect(server.setCells.mock.calls.map((call) => call[3])).toEqual([0, 0]);
    expect(store.valueOf(at("B750"))).toBe(1);
  });

  it("queues version restoration behind pending edits", async () => {
    const store = await open();
    const response = deferred<Change>();
    server.setCells.mockReturnValueOnce(response.promise);
    server.restoreVersion.mockResolvedValueOnce({ revision: 2, changed: null });
    const save = store.setCell(at("A1"), "mine");
    const restore = store.restoreVersion("s1", "v1");
    await Promise.resolve();
    expect(server.restoreVersion).not.toHaveBeenCalled();
    server.getSnapshot.mockResolvedValueOnce({ ...snapshotWith({ A1: "restored" }), revision: 2 });
    response.resolve(changeWith({ cells: [{ ...identifiedAt("A1"), input: "mine" }] }, 1));
    await Promise.all([save, restore]);
    expect(store.inputOf(at("A1"))).toBe("restored");
  });
});
