type MaybePromise<T> = T | Promise<T>;

/** One entry of a `ContextMenu`. */
export interface MenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** Runs without closing the menu, for actions that reveal more menu content. */
  keepOpen?: boolean;
  /** Transfers an existing formula draft to another editor without submitting it. */
  keepDraft?: boolean;
  /** Draws a line above this item, to set a group apart. */
  separated?: boolean;
  run(): MaybePromise<void>;
}

/**
 * What a table's menu of row, column, and cell actions acts on: the selected
 * cells with their rows and columns, or only the selected rows, or only the
 * selected columns.
 */
export type MenuScope = "cells" | "row" | "col";
