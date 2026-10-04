import { EditorState } from "@codemirror/state";
import { defineStore } from "pinia";
import { shallowRef } from "vue";

export type FormulaMode = "cell" | "formula";

export type EditingTarget =
  | { kind: "cell"; tableId: string; rowId: string; colId: string }
  | { kind: "column"; tableId: string; colId: string }
  | { kind: "filter"; tableId: string }
  | { kind: "name"; tableId: string; name: string }
  | { kind: "chart"; viewId: string };

/** Original formula resolution context; structural changes must not rewrite the draft. */
export interface EditingContext {
  pageId: string;
  tableId?: string;
  rowId?: string;
  holderId?: string;
}

export interface FormulaSession {
  target: EditingTarget;
  context: EditingContext;
  mode: FormulaMode;
  initialText: string;
  state: EditorState;
  saving: boolean;
  error?: string;
  deleted?: boolean;
}

export interface StartEditing {
  target: EditingTarget;
  context: EditingContext;
  mode: FormulaMode;
  text: string;
}

export type SaveDraft = (target: EditingTarget, text: string) => Promise<"saved" | "deleted">;

export function sameEditingTarget(left: EditingTarget, right: EditingTarget): boolean {
  if (left.kind !== right.kind) return false;
  switch (left.kind) {
    case "cell":
      return (
        right.kind === "cell" &&
        left.tableId === right.tableId &&
        left.rowId === right.rowId &&
        left.colId === right.colId
      );
    case "column":
      return (
        right.kind === "column" && left.tableId === right.tableId && left.colId === right.colId
      );
    case "filter":
      return right.kind === "filter" && left.tableId === right.tableId;
    case "name":
      return (
        right.kind === "name" &&
        left.tableId === right.tableId &&
        left.name.toLowerCase() === right.name.toLowerCase()
      );
    case "chart":
      return right.kind === "chart" && left.viewId === right.viewId;
  }
}

/** Owned by Pinia, so unmounting a page or transferring between editors retains the draft. */
export const useFormulaSessionStore = defineStore("formulaEditing", () => {
  const active = shallowRef<FormulaSession>();
  let pending: Promise<boolean> | undefined;

  function updateState(state: EditorState): void {
    const session = active.value;
    if (session && !session.saving) active.value = { ...session, state, error: undefined };
  }

  /** Deduplicates Enter/Apply followed by blur. The caller runs its transition only on success. */
  function submit(save: SaveDraft): Promise<boolean> {
    if (pending) return pending;
    const session = active.value;
    if (!session) return Promise.resolve(true);
    active.value = { ...session, saving: true, error: undefined };
    pending = Promise.resolve().then(async () => {
      try {
        const result = await save(session.target, session.state.doc.toString());
        if (result === "deleted") {
          active.value = {
            ...session,
            saving: false,
            deleted: true,
            error: "The editing target was deleted. Your text was not saved.",
          };
          return false;
        }
        active.value = undefined;
        return true;
      } catch (error) {
        active.value = {
          ...session,
          saving: false,
          error: error instanceof Error ? error.message : "Could not save the draft",
        };
        return false;
      } finally {
        pending = undefined;
      }
    });
    return pending;
  }

  /** Transfers to the same target do not save, reset context, or replace editor state. */
  async function start(request: StartEditing, save: SaveDraft): Promise<boolean> {
    if (active.value && sameEditingTarget(active.value.target, request.target)) return true;
    if (!(await submit(save))) return false;
    // Another request may have opened a target while this one was waiting for the save.
    if (active.value) return sameEditingTarget(active.value.target, request.target);
    active.value = {
      target: { ...request.target },
      context: { ...request.context },
      mode: request.mode,
      initialText: request.text,
      state: EditorState.create({ doc: request.text, selection: { anchor: request.text.length } }),
      saving: false,
    };
    return true;
  }

  /** Canceling a failed save discards the draft without replaying a blocked transition. */
  function cancel(): boolean {
    if (pending) return false;
    active.value = undefined;
    return true;
  }

  return { active, updateState, submit, start, cancel };
});
