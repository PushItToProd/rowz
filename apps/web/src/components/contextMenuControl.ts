import type { InjectionKey } from "vue";

export type ContextMenuClickGuard = (event: MouseEvent) => void;

export const contextMenuClickGuardKey: InjectionKey<ContextMenuClickGuard> =
  Symbol("contextMenuClickGuard");
