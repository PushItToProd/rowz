import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { EditorState, type TransactionSpec } from "@codemirror/state";
import { history, undo, redo } from "@codemirror/commands";
import { pickedReference, pickingSpan, useReferencePickingStore, type GridPick } from "./picking";
import type { NamingContext } from "./assist";

const context: NamingContext = {
  pageId: "p1",
  tableId: "t1",
  pages: [
    { id: "p1", name: "Page 1" },
    { id: "p2", name: "Joe's page" },
  ],
  tables: [],
};
const table = { id: "t1", pageId: "p1", name: "Sales" };
const cell = (row: number, col: number): GridPick => ({ kind: "cells", row, col });
const rows = [0, 1, 2, 3, 4];
const selected = (text: string, from = text.length, to = from) =>
  EditorState.create({ doc: text, selection: { anchor: from, head: to } });

beforeEach(() => setActivePinia(createPinia()));

describe("picking positions", () => {
  it.each(["=", "=B3+", "=SUM(", "=SUM(A1, "])("automatically picks an operand in %s", (text) => {
    expect(pickingSpan(selected(text), "cell", false)).toEqual({
      from: text.length,
      to: text.length,
    });
  });
  it("automatically replaces a completely selected reference, but does not replace a completed operand without selection", () => {
    expect(pickingSpan(selected("=$A1+B2", 1, 4), "cell", false)).toEqual({ from: 1, to: 4 });
    expect(pickingSpan(selected("=B3", 2), "cell", false)).toBeUndefined();
    expect(pickingSpan(selected("=B3"), "cell", false)).toBeUndefined();
    expect(pickingSpan(selected("=10+B2", 1, 3), "cell", false)).toBeUndefined();
  });
  it("explicitly replaces selections, whole references under the caret, or inserts without repairing syntax", () => {
    expect(pickingSpan(selected("=10+B2", 1, 3), "cell", true)).toEqual({ from: 1, to: 3 });
    expect(pickingSpan(selected("=Sales!$A$1+2", 8), "cell", true)).toMatchObject({
      from: 1,
      to: 11,
    });
    expect(pickingSpan(selected("=12+3", 2), "cell", true)).toEqual({ from: 2, to: 2 });
  });
  it.each(['="text"', '="unfinished', '="escaped""', '="A1" + 2'])(
    "disables picking inside %s",
    (source) => {
      const caret = source.endsWith("2") ? 3 : source.length - (source.endsWith('text"') ? 1 : 0);
      expect(pickingSpan(selected(source, caret), "cell", true)).toBeUndefined();
    },
  );
  it("disables literals, comments, prose, headers, and selections spanning formula regions", () => {
    expect(pickingSpan(selected("123"), "cell", true)).toBeUndefined();
    expect(pickingSpan(selected("Value = A1 // comment"), "script", true)).toBeUndefined();
    expect(pickingSpan(selected("Fn(amount) = A1", 4), "script", true)).toBeUndefined();
    expect(pickingSpan(selected("prose {{ A1 }}", 2), "markdown", true)).toBeUndefined();
    expect(pickingSpan(selected("{{ A1 }} and {{ B2 }}", 3, 18), "markdown", true)).toBeUndefined();
    expect(pickingSpan(selected('=SUM("A1", 2)', 1, 13), "cell", true)).toBeUndefined();
  });
});

describe("picked reference generation", () => {
  it("uses relative addresses with original-page qualification and engine quoting", () => {
    expect(pickedReference(cell(0, 0), cell(0, 0), table, rows, context, false)).toEqual({
      text: "A1",
    });
    expect(pickedReference(cell(3, 3), cell(1, 1), table, rows, context, false)).toEqual({
      text: "B2:D4",
    });
    expect(
      pickedReference(
        cell(0, 0),
        cell(0, 0),
        { ...table, id: "t2", name: "Other table" },
        rows,
        context,
        false,
      ),
    ).toEqual({ text: "'Other table'!A1" });
    expect(
      pickedReference(
        cell(0, 0),
        cell(0, 0),
        { ...table, id: "t2", pageId: "p2" },
        rows,
        context,
        false,
      ),
    ).toEqual({ text: "'Joe''s page'!Sales!A1" });
    expect(
      pickedReference(
        cell(0, 0),
        cell(0, 0),
        table,
        rows,
        { ...context, tableId: undefined },
        false,
      ),
    ).toEqual({ text: "Sales!A1" });
  });
  it("uses same-row columns only for same-table filters and formula-column definitions", () => {
    const named = { ...table, columns: [{ name: "Unit price" }, { name: "Qty" }] };
    const header: GridPick = { kind: "col", index: 0 };
    expect(pickedReference(header, header, named, [0, 2], context, true)).toEqual({
      text: "[Unit price]",
    });
    expect(pickedReference(header, header, named, [0, 2], context, false)).toEqual({
      text: "Sales[Unit price]",
    });
    expect(
      pickedReference(header, header, { ...named, id: "t2", pageId: "p2" }, rows, context, true),
    ).toEqual({ text: "'Joe''s page'!Sales[Unit price]" });
    expect(
      pickedReference(header, { kind: "col", index: 1 }, named, rows, context, false).error,
    ).toContain("one named column");
  });
  it("picks whole ordinary columns regardless of filtering and translates row headers", () => {
    expect(
      pickedReference(
        { kind: "col", index: 2 },
        { kind: "col", index: 0 },
        table,
        [4, 1],
        context,
        false,
      ),
    ).toEqual({ text: "A:C" });
    expect(
      pickedReference(
        { kind: "row", index: 0 },
        { kind: "row", index: 1 },
        table,
        [2, 1],
        context,
        false,
      ),
    ).toEqual({ text: "2:3" });
  });
  it("accepts reordered rectangles and rejects hidden rows and the append row", () => {
    expect(pickedReference(cell(0, 0), cell(1, 2), table, [2, 1, 4], context, false)).toEqual({
      text: "A2:C3",
    });
    expect(pickedReference(cell(0, 0), cell(1, 2), table, [2, 4], context, false).error).toContain(
      "stored rectangle",
    );
    expect(pickedReference(cell(0, 0), cell(0, 0), table, [4, 1], context, false)).toEqual({
      text: "A5",
    });
    expect(pickedReference(cell(2, 0), cell(2, 0), table, [4, 1], context, false).error).toContain(
      "append row",
    );
  });
});

function editing(text: string, from?: number, to?: number, limit = 50_000) {
  const store = useReferencePickingStore();
  let state = selected(text, from, to).update({ effects: [] }).state;
  state = EditorState.create({
    doc: state.doc,
    selection: state.selection,
    extensions: [history()],
  });
  const focus = vi.fn();
  const adapter = {
    state: () => state,
    mode: () => "cell" as const,
    readonly: () => false,
    maxLength: () => limit,
    context: () => context,
    sameRow: () => false,
    dispatch: (spec: TransactionSpec) => {
      state = state.update(spec).state;
      store.update("session", state);
    },
    restore: (restored: EditorState) => {
      state = restored;
      store.update("session", state);
    },
    focus,
  };
  store.connect("session", adapter);
  return { store, adapter, focus, state: () => state };
}

describe("reference picking state", () => {
  it("replaces explicit selections, supports repeated picks, and stops replacement after typing or caret movement", () => {
    const { store, adapter, state } = editing("=10+B2", 1, 3);
    store.request();
    expect(store.begin()).toBe(true);
    store.preview({ text: "A1" });
    store.finish();
    expect(state().doc.toString()).toBe("=A1+B2");
    expect(store.begin()).toBe(true);
    store.preview({ text: "C3" });
    store.finish();
    expect(state().doc.toString()).toBe("=C3+B2");
    adapter.dispatch({ selection: { anchor: 5 } });
    expect(store.explicit).toBe(false);
    expect(store.insertion).toBeUndefined();
    adapter.dispatch({
      changes: { from: state().doc.length, insert: "+" },
      selection: { anchor: state().doc.length + 1 },
    });
    expect(store.available).toBe(true);
  });
  it("previews a drag and commits exactly one undoable change on release", () => {
    const { store, state, adapter } = editing("=$A1", 1, 4);
    expect(store.begin()).toBe(true);
    store.preview({ text: "B2" });
    store.preview({ text: "B2:D4" });
    expect(state().doc.toString()).toBe("=B2:D4");
    store.finish();
    expect(
      undo({
        state: state(),
        dispatch: (transaction) => {
          adapter.restore(transaction.state);
        },
      }),
    ).toBe(true);
    expect(state().doc.toString()).toBe("=$A1");
    expect(
      redo({
        state: state(),
        dispatch: (transaction) => {
          adapter.restore(transaction.state);
        },
      }),
    ).toBe(true);
    expect(state().doc.toString()).toBe("=B2:D4");
  });
  it("restores exact pre-drag state and history when canceled or rejected", () => {
    const { store, state } = editing("=B3+");
    const original = state();
    store.begin();
    store.preview({ text: "A1:A3" });
    store.cancel();
    expect(state()).toBe(original);
    expect(store.drag).toBeUndefined();
    store.begin();
    store.preview({ text: "A1" });
    store.preview({ error: "Not a rectangle" });
    store.finish();
    expect(state()).toBe(original);
    expect(store.message).toBe("Not a rectangle");
  });
  it("keeps picking across a same-session transfer and resets for another target", () => {
    const { store, adapter } = editing("=B3+");
    store.request();
    store.begin();
    store.preview({ text: "A1" });
    store.finish();
    store.disconnect("session");
    store.connect("session", adapter);
    expect(store.insertion).toEqual({ from: 4, to: 6 });
    store.connect("different", adapter);
    expect(store.insertion).toBeUndefined();
    expect(store.explicit).toBe(false);
  });

  it("ignores disconnects from an editor that already transferred ownership", () => {
    const { store, adapter } = editing("=");
    store.connect("session", adapter, "new-owner");
    store.disconnect("session", "session");
    expect(store.connected).toBe(true);
    expect(store.available).toBe(true);
  });
  it("retains the draft when a pick exceeds its length limit", () => {
    const { store, state } = editing("=", undefined, undefined, 3);
    store.begin();
    store.preview({ text: "A1:A3" });
    store.finish();
    expect(state().doc.toString()).toBe("=");
    expect(store.message).toContain("length limit");
  });
});
