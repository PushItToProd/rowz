import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../api/client";
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
