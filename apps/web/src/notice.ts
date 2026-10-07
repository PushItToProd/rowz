import type { RouteLocationRaw } from "vue-router";
import { shallowRef } from "vue";

export type NoticeAction =
  { label: string; to: RouteLocationRaw } | { label: string; run: () => void };

export interface Notice {
  kind: "success" | "error";
  text: string;
  action?: NoticeAction;
  dismissOnHistoryChange?: boolean;
}

/** A notice to show after navigation reaches the document list. */
export const queuedListNotice = shallowRef<Notice | null>(null);

export function queueListNotice(notice: Notice): void {
  queuedListNotice.value = notice;
}

export function takeQueuedListNotice(): Notice | null {
  const notice = queuedListNotice.value;
  queuedListNotice.value = null;
  return notice;
}

export function undoNotice(text: string, undo: () => void): Notice {
  return {
    kind: "success",
    text,
    action: { label: "Undo", run: undo },
    dismissOnHistoryChange: true,
  };
}
