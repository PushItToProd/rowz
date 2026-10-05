import { computed, shallowRef } from "vue";
import { defineStore } from "pinia";
import { type EditorState, Transaction, type TransactionSpec } from "@codemirror/state";
import { isolateHistory, undo, redo, undoDepth, redoDepth } from "@codemirror/commands";
import {
  analyzeSource,
  formulaAt,
  expectsOperand,
  formatReference,
  type EditingMode,
  type EditingSpan,
  type Reference,
  type ReferenceCell,
} from "@spreadsheet-app/engine";
import type { NamingContext } from "./assist";
import { referenceHighlights } from "./references";

/** Picking may replace an operand, but never a string, comment, or declaration header. */
export function pickingSpan(
  state: EditorState,
  mode: EditingMode,
  explicit: boolean,
): EditingSpan | undefined {
  const selection = state.selection.main;
  const source = state.doc.toString();
  const analysis = analyzeSource(source, mode);
  const formula = formulaAt(analysis, selection.from);
  if (!formula || formulaAt(analysis, selection.to) !== formula) return undefined;
  if (
    analysis.decorations.some(
      (span) => span.type === "comment" && span.from < selection.to && span.to > selection.from,
    )
  )
    return undefined;
  if (
    formula.tokens.some(
      (token) =>
        token.type === "string" &&
        (selection.empty
          ? token.position <= selection.head &&
            (selection.head < token.end ||
              (selection.head === token.end &&
                !/^"(?:[^"]|"")*"$/.test(source.slice(token.position, token.end))))
          : token.position < selection.to && token.end > selection.from),
    )
  )
    return undefined;
  const reference = formula.references.find(
    (ref) =>
      !ref.qualified &&
      (selection.empty
        ? ref.from <= selection.head && selection.head <= ref.to
        : ref.from === selection.from && ref.to === selection.to),
  );
  if (!selection.empty)
    return explicit || reference ? { from: selection.from, to: selection.to } : undefined;
  if (explicit)
    return reference
      ? { from: reference.from, to: reference.to }
      : { from: selection.head, to: selection.head };
  return expectsOperand(formula, selection.head)
    ? { from: selection.head, to: selection.head }
    : undefined;
}

export type GridPick =
  { kind: "cells"; row: number; col: number } | { kind: "row" | "col"; index: number };
export interface PickTable {
  id: string;
  name: string;
  pageId: string;
  columns?: readonly { name: string }[] | null;
}
export interface PickResult {
  text?: string;
  error?: string;
}

/** Displayed cells must be exactly one stored rectangle, with no hidden rows added. */
export function pickedReference(
  first: GridPick,
  last: GridPick,
  table: PickTable,
  rows: readonly number[],
  context: Pick<NamingContext, "tableId" | "pageId" | "pages">,
  sameRow: boolean,
): PickResult {
  if (first.kind !== last.kind)
    return { error: "Keep the drag within cells or within the same kind of header." };
  const qualified = {
    ...(table.pageId !== context.pageId
      ? { page: context.pages.find((page) => page.id === table.pageId)?.name }
      : {}),
    table: table.name,
  };
  if (table.pageId !== context.pageId && qualified.page === undefined)
    return { error: "The picked page no longer exists." };
  if (first.kind === "col" && last.kind === "col" && table.columns) {
    if (first.index !== last.index)
      return {
        error: "Pick one named column at a time. Dragging across named columns is not supported.",
      };
    const column = table.columns[first.index];
    if (!column) return { error: "The picked column no longer exists." };
    return {
      text: formatReference({
        ...(sameRow && table.id === context.tableId ? {} : qualified),
        column: column.name,
      }),
    };
  }
  const corner = (row: number | null, col: number | null): ReferenceCell => ({
    row,
    col,
    rowAbsolute: false,
    colAbsolute: false,
  });
  let reference: Reference;
  if (first.kind === "col" && last.kind === "col") {
    reference = {
      start: corner(null, Math.min(first.index, last.index)),
      end: corner(null, Math.max(first.index, last.index)),
    };
  } else {
    const firstRow = first.kind === "cells" ? first.row : first.kind === "row" ? first.index : -1;
    const lastRow = last.kind === "cells" ? last.row : last.kind === "row" ? last.index : -1;
    const selected = rows.slice(Math.min(firstRow, lastRow), Math.max(firstRow, lastRow) + 1);
    if (!selected.length || firstRow >= rows.length || lastRow >= rows.length)
      return { error: "Pick a stored row. The append row has no address yet." };
    const min = Math.min(...selected),
      max = Math.max(...selected);
    if (max - min + 1 !== selected.length || new Set(selected).size !== selected.length)
      return {
        error:
          "These displayed rows do not form one stored rectangle. Pick a whole column or clear sorting and filtering.",
      };
    if (first.kind === "row") reference = { start: corner(min, null), end: corner(max, null) };
    else if (first.kind === "cells" && last.kind === "cells") {
      const left = Math.min(first.col, last.col),
        right = Math.max(first.col, last.col);
      reference = {
        start: corner(min, left),
        ...(min !== max || left !== right ? { end: corner(max, right) } : {}),
      };
    } else return { error: "Keep the drag within cells or within the same kind of header." };
  }
  return {
    text: formatReference({ ...(table.id === context.tableId ? {} : qualified), ...reference }),
  };
}

interface PickingEditor {
  state: () => EditorState;
  mode: () => EditingMode;
  readonly: () => boolean;
  maxLength: () => number;
  context: () => NamingContext;
  sameRow: () => boolean;
  hasControl?: () => boolean;
  dispatch: (spec: TransactionSpec) => void;
  restore: (state: EditorState) => void;
  focus: () => void;
}

/** One active editor, including the local new-name form and persistent shared sessions. */
export const useReferencePickingStore = defineStore("referencePicking", () => {
  const key = shallowRef<string | symbol>();
  const editor = shallowRef<PickingEditor>();
  let connection: string | symbol | undefined;
  const current = shallowRef<EditorState>();
  const explicit = shallowRef(false);
  const insertion = shallowRef<EditingSpan>();
  const message = shallowRef<string>();
  const drag = shallowRef<{ state: EditorState; span: EditingSpan; result?: PickResult }>();
  const suppressClick = shallowRef(false);
  let applying = false;
  const span = computed(() => {
    const target = editor.value;
    if (!target || target.readonly() || !current.value) return undefined;
    return insertion.value ?? pickingSpan(current.value, target.mode(), explicit.value);
  });
  const available = computed(() => span.value !== undefined);
  const connected = computed(() => editor.value !== undefined);
  const hasControl = computed(() => editor.value?.hasControl?.() ?? true);
  const canUndo = computed(() =>
    editor.value && !editor.value.readonly() && current.value
      ? undoDepth(current.value) > 0
      : false,
  );
  const canRedo = computed(() =>
    editor.value && !editor.value.readonly() && current.value
      ? redoDepth(current.value) > 0
      : false,
  );
  const highlights = computed(() =>
    current.value && editor.value
      ? referenceHighlights(
          current.value.doc.toString(),
          editor.value.mode(),
          current.value.selection.main.head,
          editor.value.context(),
        )
      : [],
  );

  function clear(): void {
    explicit.value = false;
    insertion.value = undefined;
    message.value = undefined;
  }
  function connect(
    identity: string | symbol,
    target: PickingEditor,
    owner: string | symbol = identity,
  ): void {
    if (key.value !== identity) {
      cancel();
      clear();
    }
    key.value = identity;
    connection = owner;
    editor.value = target;
    current.value = target.state();
  }
  function disconnect(identity: string | symbol, owner: string | symbol = identity): void {
    if (key.value !== identity || connection !== owner) return;
    if (drag.value) cancel();
    editor.value = undefined;
  }
  function update(identity: string | symbol, state: EditorState): void {
    if (key.value !== identity) return;
    if (
      !applying &&
      current.value &&
      (!state.doc.eq(current.value.doc) || !state.selection.eq(current.value.selection))
    )
      clear();
    current.value = state;
  }
  function request(): void {
    const target = editor.value;
    if (!target || target.readonly() || !pickingSpan(target.state(), target.mode(), true)) return;
    explicit.value = true;
    insertion.value = undefined;
    message.value = undefined;
    target.focus();
  }
  function change(action: () => void): void {
    applying = true;
    try {
      action();
      current.value = editor.value?.state();
    } finally {
      applying = false;
    }
  }
  function begin(): boolean {
    const target = editor.value,
      replacement = span.value;
    if (!target || target.readonly() || !replacement) return false;
    drag.value = { state: target.state(), span: replacement };
    suppressClick.value = true;
    message.value = undefined;
    return true;
  }
  function preview(result: PickResult): void {
    const target = editor.value,
      started = drag.value;
    if (!target || !started) return;
    if (target.readonly()) {
      cancel();
      message.value = "The source is read-only. Your draft was retained.";
      return;
    }
    if (
      result.text !== undefined &&
      started.state.doc.length - (started.span.to - started.span.from) + result.text.length >
        target.maxLength()
    )
      result = { error: "The picked reference would exceed the source length limit." };
    drag.value = { ...started, result };
    message.value = result.error;
    change(() => {
      target.restore(started.state);
      if (result.text !== undefined)
        target.dispatch({
          changes: { ...started.span, insert: result.text },
          selection: { anchor: started.span.from + result.text.length },
          annotations: Transaction.addToHistory.of(false),
          userEvent: "input.pick.preview",
        });
    });
  }
  function finish(): void {
    const target = editor.value,
      started = drag.value;
    if (!target || !started) return;
    if (target.readonly()) {
      cancel();
      message.value = "The source is read-only. Your draft was retained.";
      return;
    }
    const text = started.result?.text;
    change(() => {
      target.restore(started.state);
      if (text !== undefined)
        target.dispatch({
          changes: { ...started.span, insert: text },
          selection: { anchor: started.span.from + text.length },
          annotations: isolateHistory.of("full"),
          userEvent: "input.pick",
        });
    });
    drag.value = undefined;
    if (text !== undefined)
      insertion.value = { from: started.span.from, to: started.span.from + text.length };
    target.focus();
  }
  function cancel(): boolean {
    if (!drag.value && !explicit.value && !insertion.value) return false;
    const started = drag.value,
      target = editor.value;
    if (started && target)
      change(() => {
        target.restore(started.state);
      });
    drag.value = undefined;
    clear();
    return true;
  }
  function pick(first: GridPick, last: GridPick, table: PickTable, rows: readonly number[]): void {
    const target = editor.value;
    if (target)
      preview(pickedReference(first, last, table, rows, target.context(), target.sameRow()));
  }
  function draftHistory(direction: "undo" | "redo"): void {
    const target = editor.value;
    if (!target || target.readonly()) return;
    if (drag.value) cancel();
    target.focus();
    (direction === "undo" ? undo : redo)({ state: target.state(), dispatch: target.dispatch });
  }
  return {
    key,
    current,
    explicit,
    insertion,
    message,
    drag,
    suppressClick,
    available,
    connected,
    hasControl,
    canUndo,
    canRedo,
    draftHistory,
    highlights,
    connect,
    disconnect,
    update,
    request,
    begin,
    preview,
    finish,
    cancel,
    pick,
  };
});
