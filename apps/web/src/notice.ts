import type { RouteLocationRaw } from "vue-router";

export type NoticeAction =
  { label: string; to: RouteLocationRaw } | { label: string; run: () => void };

export interface Notice {
  kind: "success" | "error";
  text: string;
  action?: NoticeAction;
  dismissOnHistoryChange?: boolean;
}

export function undoNotice(text: string, undo: () => void): Notice {
  return {
    kind: "success",
    text,
    action: { label: "Undo", run: undo },
    dismissOnHistoryChange: true,
  };
}
