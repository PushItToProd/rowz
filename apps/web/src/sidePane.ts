import {
  computed,
  inject,
  provide,
  readonly,
  ref,
  type ComputedRef,
  type InjectionKey,
  type Ref,
} from "vue";
import { closeContextMenu } from "./components/contextMenuState";

export const SIDE_PANES = {
  errors: "errors",
  assertions: "assertions",
  find: "find",
  history: "history",
  runs: "runs",
  share: "share",
} as const;

export type SidePaneId =
  | (typeof SIDE_PANES)[keyof typeof SIDE_PANES]
  | `names:${string}`
  | `conditional-formats:${string}`
  | `choices:${string}`;

export function tableIdOfSidePane(id: SidePaneId | null): string | undefined {
  if (id?.startsWith("names:")) return id.slice("names:".length);
  if (id?.startsWith("conditional-formats:")) return id.slice("conditional-formats:".length);
  if (id?.startsWith("choices:")) return id.slice("choices:".length);
  return undefined;
}

export interface ActiveSidePane {
  active: Readonly<Ref<SidePaneId | null>>;
  isOpen(id: SidePaneId): ComputedRef<boolean>;
  open(id: SidePaneId): void;
  toggle(id: SidePaneId): void;
  close(id: SidePaneId): void;
  closeActive(): void;
}

const activeSidePaneKey: InjectionKey<ActiveSidePane> = Symbol("active-side-pane");

export function createActiveSidePane(): ActiveSidePane {
  const active = ref<SidePaneId | null>(null);
  return {
    active: readonly(active),
    isOpen: (id) => computed(() => active.value === id),
    open: (id) => {
      closeContextMenu();
      active.value = id;
    },
    toggle: (id) => {
      closeContextMenu();
      active.value = active.value === id ? null : id;
    },
    close: (id) => {
      if (active.value === id) active.value = null;
    },
    closeActive: () => {
      active.value = null;
    },
  };
}

export function provideActiveSidePane(): ActiveSidePane {
  const state = createActiveSidePane();
  provide(activeSidePaneKey, state);
  return state;
}

/** Components mounted outside an editor get their own isolated pane state. */
export function useActiveSidePane(): ActiveSidePane {
  return inject(activeSidePaneKey, createActiveSidePane, true);
}
