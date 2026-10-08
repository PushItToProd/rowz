import { useFormulaSessionStore } from "../../formula/session";
import type { WorkbookContext } from "./context";
function messageOf(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message !== "" ? cause.message : fallback;
}

export function createQueue(context: WorkbookContext) {
  /** Every content mutation, including undo and redo, enters this queue immediately. */
  let mutations: Promise<unknown> = Promise.resolve();

  /** Counts a request toward `saving` until it settles. */
  function countUnanswered<T>(request: Promise<T>): Promise<T> {
    context.begun += 1;
    context.unanswered.add(request);
    context.unansweredCount.value = context.unanswered.size;
    const settled = (): void => {
      context.unanswered.delete(request);
      context.unansweredCount.value = context.unanswered.size;
    };
    void request.then(settled, settled);
    return request;
  }

  function enqueueWrite<T>(
    change: () => Promise<T>,
    draftWrite = false,
    clearPreviousError = true,
  ): Promise<T> {
    const sessions = useFormulaSessionStore();
    if (!draftWrite && sessions.active) {
      return sessions
        .submit((target, text) => context.submitFormulaDraft(target, text, clearPreviousError))
        .then((saved) => {
          if (!saved) {
            sessions.focus();
            throw new Error(sessions.active?.error ?? "The draft could not be saved");
          }
          return enqueueWrite(change, true, clearPreviousError);
        });
    }
    const queued = mutations.then(async () => {
      const previousNotice = context.notice.value;
      const result = await change();
      if (
        clearPreviousError &&
        previousNotice?.kind === "error" &&
        context.notice.value === previousNotice
      )
        context.notice.value = null;
      return result;
    });
    mutations = queued.catch(() => undefined);
    return countUnanswered(queued);
  }

  /** Waits for the edits made so far to be saved. Resolves to whether every one of them was. */
  async function stored(
    queue: Promise<void> = context.saves,
    before = context.failedSaves,
  ): Promise<boolean> {
    await queue;
    return context.failedSaves === before;
  }

  function fail(cause: unknown, fallback: string): void {
    context.notice.value = { kind: "error", text: messageOf(cause, fallback) };
  }

  /** Runs a structure change and reports a failure as a notice. Returns whether it worked. */
  async function attempt(change: () => Promise<void>, fallback: string): Promise<boolean> {
    try {
      await enqueueWrite(change);
      return true;
    } catch (cause) {
      fail(cause, fallback);
      return false;
    }
  }
  return { enqueueWrite, stored, fail, attempt };
}
