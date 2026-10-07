let activeMenuClose: (() => void) | undefined;

/** Ensures that page, block, grid, and document menus never overlap. */
export function registerContextMenu(close: () => void): () => void {
  activeMenuClose?.();
  activeMenuClose = close;
  return () => {
    if (activeMenuClose === close) activeMenuClose = undefined;
  };
}

/** Closes an open menu before a dialog or side pane takes focus. */
export function closeContextMenu(): void {
  activeMenuClose?.();
}
