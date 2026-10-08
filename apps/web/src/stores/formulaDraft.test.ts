import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, type Change } from "../api/client";
import type { Notice } from "../notice";
import {
  at,
  clickResult,
  changeWith,
  snapshotWith,
  wireSnapshot,
  type MockedApi,
} from "../testing";
import { useWorkbookStore } from "./workbook";
import { useFormulaSessionStore } from "../formula/session";

vi.mock("../api/client", async () => {
  const testing = await import("../testing");
  return { api: testing.mockApi(), setJournaledHandler: testing.setJournaledHandler };
});
const server = api as unknown as MockedApi;

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: Error): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

async function open() {
  const snapshot = wireSnapshot(snapshotWith());
  server.getSnapshot.mockResolvedValue({
    ...snapshot,
    tables: snapshot.tables.map((table) => ({
      ...table,
      names: [
        { name: "Total", formula: "1" },
        { name: "TaxRate", formula: "2" },
      ],
    })),
  });
  const store = useWorkbookStore();
  await store.load("s1");
  return store;
}

describe("draft submissions", () => {
  it("submits a named target without sending a stale client name list", async () => {
    const store = await open();
    store.tables = store.tables.map((table) => ({
      ...table,
      names: [
        { name: "Added", formula: "3" },
        { name: "TAXRATE", formula: "updated" },
        { name: "TOTAL", formula: "theirs" },
      ],
    }));
    server.updateNamedFormula.mockResolvedValueOnce(changeWith());
    expect(
      await store.submitFormulaDraft({ kind: "name", tableId: "t1", name: "Total" }, " B2 + 1 "),
    ).toBe("saved");
    expect(server.updateNamedFormula).toHaveBeenCalledExactlyOnceWith("t1", "Total", " B2 + 1 ");
    expect(server.setTableNames).not.toHaveBeenCalled();
  });

  it("closes formula targets but leaves script and Markdown sources unchanged", async () => {
    const store = await open();
    store.views = [
      {
        id: "chart",
        pageId: "p1",
        kind: "chart",
        name: "Chart",
        source: "A1",
        chartType: "bar",
        position: 0,
      },
      {
        id: "script",
        pageId: "p1",
        kind: "script",
        name: "Script",
        source: "",
        chartType: null,
        position: 1,
      },
      {
        id: "text",
        pageId: "p1",
        kind: "text",
        name: "Text",
        source: "",
        chartType: null,
        position: 2,
      },
    ];
    server.updateNamedFormula.mockResolvedValue(changeWith());
    server.updateView.mockResolvedValue(changeWith());

    await store.submitFormulaDraft({ kind: "name", tableId: "t1", name: "Total" }, "=SUM(B2");
    await store.submitFormulaDraft({ kind: "chart", viewId: "chart" }, "=SUM(B2");
    await store.submitFormulaDraft({ kind: "script", viewId: "script" }, "=SUM(B2");
    await store.submitFormulaDraft({ kind: "markdown", viewId: "text" }, "=SUM(B2");

    expect(server.updateNamedFormula).toHaveBeenCalledExactlyOnceWith("t1", "Total", "=SUM(B2)");
    expect(server.updateView.mock.calls).toEqual([
      ["chart", { source: "=SUM(B2)" }],
      ["script", { source: "=SUM(B2" }],
      ["text", { source: "=SUM(B2" }],
    ]);
  });

  it("does not recreate a renamed or deleted named target or update its old list position", async () => {
    const store = await open();
    store.tables = store.tables.map((table) => ({
      ...table,
      names: [{ name: "Replacement", formula: "keep" }],
    }));
    server.updateNamedFormula.mockRejectedValueOnce(
      Object.assign(new Error("Name not found"), { code: "not_found" }),
    );
    expect(
      await store.submitFormulaDraft({ kind: "name", tableId: "t1", name: "Total" }, "B2"),
    ).toBe("deleted");
    expect(server.setTableNames).not.toHaveBeenCalled();
    store.tables = [];
    expect(
      await store.submitFormulaDraft({ kind: "name", tableId: "t1", name: "Total" }, "B2"),
    ).toBe("deleted");
  });

  it("clears the running flag when a draft save blocks a cell action and permits a later retry", async () => {
    const store = await open();
    const sessions = useFormulaSessionStore();
    await sessions.start(
      {
        target: { kind: "name", tableId: "t1", name: "Total" },
        context: { pageId: "p1", tableId: "t1" },
        mode: "formula",
        text: "draft",
      },
      store.submitFormulaDraft,
    );
    server.updateNamedFormula.mockRejectedValueOnce(new Error("Offline"));
    await store.click(at("A1"));
    expect(server.click).not.toHaveBeenCalled();
    expect(store.isRunning(at("A1"))).toBe(false);
    expect(sessions.active?.state.doc.toString()).toBe("draft");
    sessions.cancel();
    server.click.mockResolvedValueOnce(clickResult());
    await store.click(at("A1"));
    expect(server.click).toHaveBeenCalledTimes(1);
    expect(store.isRunning(at("A1"))).toBe(false);
  });

  it("reports which action and formula could not be saved", async () => {
    const store = await open();
    const sessions = useFormulaSessionStore();
    await sessions.start(
      {
        target: { kind: "name", tableId: "t1", name: "Total" },
        context: { pageId: "p1", tableId: "t1" },
        mode: "formula",
        text: "draft",
      },
      store.submitFormulaDraft,
    );
    server.updateNamedFormula.mockRejectedValueOnce(new Error("Offline"));

    await store.click(at("B1"));

    expect(server.click).not.toHaveBeenCalled();
    expect(store.notice).toEqual({
      kind: "error",
      text: "The button at Page 1 · Table 1!B1 could not be run because the formula for Total in Table 1 on Page 1 could not be saved. Resolve the draft error and try the action again.",
      detail: "Offline",
    });
  });

  it("keeps an unrelated error visible until the action succeeds", async () => {
    const store = await open();
    const sessions = useFormulaSessionStore();
    const previousNotice = { kind: "error" as const, text: "A different request failed" };
    store.notice = previousNotice;
    await sessions.start(
      {
        target: { kind: "name", tableId: "t1", name: "Total" },
        context: { pageId: "p1", tableId: "t1" },
        mode: "formula",
        text: "draft",
      },
      store.submitFormulaDraft,
    );
    server.updateNamedFormula.mockResolvedValueOnce(changeWith());
    let noticeDuringAction: Notice | null = store.notice;
    server.click.mockImplementationOnce(() => {
      noticeDuringAction = store.notice;
      return Promise.resolve(clickResult());
    });

    await store.click(at("B1"));

    expect(noticeDuringAction).toEqual(previousNotice);
    expect(store.notice).toEqual({ kind: "success", text: "Done" });
  });

  it("reports an action skipped after a pending cell save fails", async () => {
    const store = await open();
    const sessions = useFormulaSessionStore();
    await sessions.start(
      {
        target: { kind: "name", tableId: "t1", name: "Total" },
        context: { pageId: "p1", tableId: "t1" },
        mode: "formula",
        text: "draft",
      },
      store.submitFormulaDraft,
    );
    const saving = deferred<Change>();
    server.setCells.mockReturnValueOnce(saving.promise);
    server.updateNamedFormula.mockResolvedValueOnce(changeWith());

    const save = store.setCell(at("A1"), "pending");
    await Promise.resolve();
    const action = store.click(at("B1"));
    saving.reject(new Error("The cell save failed"));
    await Promise.all([save, action]);

    expect(server.click).not.toHaveBeenCalled();
    expect(store.notice).toEqual({
      kind: "error",
      text: "The button at Page 1 · Table 1!B1 could not be run because the change to Page 1 · Table 1!A1 could not be saved. Fix the save error and try the action again.",
      detail: "The cell save failed",
    });
  });

  it("stops a workbook operation after a failed draft save and does not replay it on cancel", async () => {
    const store = await open();
    store.views = [
      {
        id: "v1",
        pageId: "p1",
        kind: "chart",
        name: "Chart",
        source: "1",
        chartType: "bar",
        position: 1,
      },
    ];
    const sessions = useFormulaSessionStore();
    await sessions.start(
      {
        target: { kind: "chart", viewId: "v1" },
        context: { pageId: "p1" },
        mode: "formula",
        text: "draft",
      },
      store.submitFormulaDraft,
    );
    server.updateView.mockRejectedValueOnce(new Error("Offline"));
    expect(await store.addView("p1", "chart")).toBe(false);
    expect(server.createView).not.toHaveBeenCalled();
    expect(sessions.active?.state.doc.toString()).toBe("draft");
    sessions.cancel();
    await Promise.resolve();
    expect(server.createView).not.toHaveBeenCalled();
  });
});
