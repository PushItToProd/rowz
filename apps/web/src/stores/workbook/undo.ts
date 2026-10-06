import { api } from "../../api/client";
import type { WorkbookContext } from "./context";

export function createUndo(context: WorkbookContext) {
  async function runHistory(direction: "undo" | "redo"): Promise<void> {
    const current = context.spreadsheet.value;
    if (!current || !context.canEdit.value) return;
    if (!(direction === "undo" ? context.undoable.value : context.redoable.value)) return;
    try {
      const result = await (direction === "undo" ? api.undo(current.id) : api.redo(current.id));
      // The answer is about the spreadsheet that was open when it was asked for.
      if (context.spreadsheet.value?.id !== current.id) return;
      context.undoable.value = result.undoable;
      context.redoable.value = result.redoable;
      if (result.outcome === "done") {
        if (result.change) await context.receiveChange(result.change);
        if (
          result.change?.changed &&
          (result.change.changed.pages.length > 0 ||
            result.change.changed.tables.length > 0 ||
            result.change.changed.views.length > 0)
        ) {
          context.notice.value = {
            kind: "success",
            text: `${direction === "undo" ? "Undid" : "Redid"}: ${result.label ?? "change"}`,
          };
        }
      } else if (result.outcome === "refused") {
        context.notice.value = {
          kind: "error",
          text: result.error ?? "This change cannot be restored",
        };
      }
    } catch (cause) {
      if (context.spreadsheet.value?.id !== current.id) return;
      context.fail(
        cause,
        direction === "undo" ? "The change could not be undone" : "The change could not be redone",
      );
    }
  }

  function undo(): Promise<void> {
    return context.enqueueWrite(() => runHistory("undo"));
  }

  function redo(): Promise<void> {
    return context.enqueueWrite(() => runHistory("redo"));
  }
  return { undo, redo };
}
