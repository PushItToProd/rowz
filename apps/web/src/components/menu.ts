type MaybePromise<T> = T | Promise<T>;

/** One entry of a `ContextMenu`. */
export interface MenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** Runs without closing the menu, for actions that reveal more menu content. */
  keepOpen?: boolean;
  /** The action moves focus elsewhere, so closing the menu must leave focus there. */
  restoreFocus?: boolean;
  /** Transfers an existing formula draft to another editor without submitting it. */
  keepDraft?: boolean;
  /** Draws a line above this item, to set a group apart. */
  separated?: boolean;
  /** The items of a menu that opens beside this one. Choosing the item opens it and does not run it. */
  submenu?: readonly MenuItem[];
  run(): MaybePromise<void>;
}

/** An item that opens a menu of further choices, for a list too long to put in the menu itself. */
export function submenu(label: string, items: readonly MenuItem[]): MenuItem {
  return { label, submenu: items, run: () => undefined };
}

/**
 * What a table's menu of row, column, and cell actions acts on: the selected
 * cells with their rows and columns, or only the selected rows, or only the
 * selected columns.
 */
export type MenuScope = "cells" | "row" | "col";
