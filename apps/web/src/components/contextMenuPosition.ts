export type ViewportBounds = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type ContextMenuPosition = Readonly<{ left: number; top: number }>;

/**
 * Places a context menu at visual-viewport coordinates and returns fixed-position coordinates.
 * The viewport offsets account for the visual viewport moving inside the layout viewport on phones.
 */
export function contextMenuPosition(
  x: number,
  y: number,
  menuWidth: number,
  menuHeight: number,
  viewport: ViewportBounds,
  margin = 4,
): ContextMenuPosition {
  const right = viewport.left + viewport.width;
  const bottom = viewport.top + viewport.height;
  const minLeft = viewport.left + margin;
  const minTop = viewport.top + margin;
  const maxLeft = Math.max(minLeft, right - menuWidth - margin);
  const maxTop = Math.max(minTop, bottom - menuHeight - margin);

  let left = viewport.left + x;
  if (left + menuWidth > right - margin) left -= menuWidth;
  left = Math.min(Math.max(left, minLeft), maxLeft);

  let top = viewport.top + y;
  if (top + menuHeight > bottom - margin) top -= menuHeight;
  top = Math.min(Math.max(top, minTop), maxTop);

  return { left, top };
}
