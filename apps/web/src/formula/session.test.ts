import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { history, undo } from "@codemirror/commands";
import { StateEffect, type Transaction } from "@codemirror/state";
import { sameEditingTarget, useFormulaSessionStore, type StartEditing } from "./session";

const request: StartEditing = {
  target: { kind: "cell", tableId: "table", rowId: "row", colId: "column" },
  context: { pageId: "original-page", tableId: "table", rowId: "row" },
  mode: "cell",
  text: "=B2",
};
const save = vi.fn(() => Promise.resolve("saved" as const));

beforeEach(() => {
  setActivePinia(createPinia());
  save.mockClear();
});

describe("formula editing sessions", () => {
  it("transfers the exact editor state and original context without saving", async () => {
    const store = useFormulaSessionStore();
    await store.start(request, save);
    const state = store.active!.state;
    const transaction = state.update({
      changes: { from: 3, insert: "+1" },
      selection: { anchor: 2 },
    });
    store.updateState(transaction.state);
    expect(
      await store.start(
        { ...request, text: "overwritten", context: { pageId: "another-page" } },
        save,
      ),
    ).toBe(true);
    expect(store.active!.state).toBe(transaction.state);
    expect(store.active!.context.pageId).toBe("original-page");
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps draft history across component-independent store updates", async () => {
    const store = useFormulaSessionStore();
    await store.start(request, save);
    let state = store.active!.state;
    // The editor attaches history when first mounted; the session keeps it when unmounted.
    state = state.update({ effects: StateEffect.reconfigure.of(history()) }).state;
    state = state.update({ changes: { from: 3, insert: "+1" }, userEvent: "input.type" }).state;
    store.updateState(state);
    await store.start(request, save);
    expect(
      undo({
        state: store.active!.state,
        dispatch: (transaction: Transaction) => {
          store.updateState(transaction.state);
        },
      }),
    ).toBe(true);
    expect(store.active!.state.doc.toString()).toBe("=B2");
  });

  it("waits for a save before opening another target and deduplicates blur submissions", async () => {
    const store = useFormulaSessionStore();
    await store.start(request, save);
    let resolve!: (value: "saved") => void;
    const delayed = vi.fn(
      () =>
        new Promise<"saved">((done) => {
          resolve = done;
        }),
    );
    const transition = store.start(
      { ...request, target: { kind: "filter", tableId: "other" } },
      delayed,
    );
    const blur = store.submit(delayed);
    await Promise.resolve();
    expect(store.active!.target).toEqual(request.target);
    expect(store.active!.saving).toBe(true);
    expect(store.cancel()).toBe(false);
    resolve("saved");
    expect(await transition).toBe(true);
    expect(await blur).toBe(true);
    expect(delayed).toHaveBeenCalledTimes(1);
    expect(delayed).toHaveBeenCalledWith(request.target, "=B2");
    expect(store.active!.target).toEqual({ kind: "filter", tableId: "other" });
  });

  it("retains a failed draft, blocks the new target, and allows retry", async () => {
    const store = useFormulaSessionStore();
    await store.start(request, save);
    const fail = vi.fn(() => Promise.reject(new Error("Offline")));
    expect(
      await store.start({ ...request, target: { kind: "filter", tableId: "other" } }, fail),
    ).toBe(false);
    expect(store.active).toMatchObject({ target: request.target, saving: false, error: "Offline" });
    expect(store.active!.state.doc.toString()).toBe("=B2");
    expect(await store.submit(save)).toBe(true);
    expect(store.active).toBeUndefined();
  });

  it("retains deleted targets until submission, with exact text available for recovery", async () => {
    const store = useFormulaSessionStore();
    await store.start(request, save);
    const state = store.active!.state.update({
      changes: { from: 0, to: 3, insert: '=B2 + "copy me"' },
    }).state;
    store.updateState(state);
    expect(await store.submit(() => Promise.resolve("deleted"))).toBe(false);
    expect(store.active).toMatchObject({ target: request.target, deleted: true, saving: false });
    expect(store.active!.state).toBe(state);
    expect(store.cancel()).toBe(true);
    expect(store.active).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  it("matches whole-column sessions independently of their originating row and names ignoring case", () => {
    expect(
      sameEditingTarget(
        { kind: "column", tableId: "t", colId: "c" },
        { kind: "column", tableId: "t", colId: "c" },
      ),
    ).toBe(true);
    expect(
      sameEditingTarget(
        { kind: "name", tableId: "t", name: "Total" },
        { kind: "name", tableId: "t", name: "TOTAL" },
      ),
    ).toBe(true);
    expect(
      sameEditingTarget(
        { kind: "name", tableId: "t", name: "Total" },
        { kind: "name", tableId: "t", name: "Renamed" },
      ),
    ).toBe(false);
    expect(
      sameEditingTarget(
        { kind: "cell", tableId: "t", colId: "c", rowId: "r" },
        { kind: "column", tableId: "t", colId: "c" },
      ),
    ).toBe(false);
  });
});
