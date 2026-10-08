const FIELD_POPUPS = ".cm-tooltip, .context-menu";

/** Focus in a field's own popup stays with the field even when the popup is teleported. */
export function focusIsWithinField(root: HTMLElement | undefined): boolean {
  const active = document.activeElement;
  return (
    !!root?.contains(active) || (active instanceof Element && active.closest(FIELD_POPUPS) !== null)
  );
}
