/** One entry of a `ContextMenu`. */
export interface MenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a line above this item, to set a group apart. */
  separated?: boolean;
  run(): void;
}
