/**
 * Has the browser ask before the tab is closed, reloaded, or sent to another
 * site while `unsaved` says changes are still on their way to the server.
 * Changes are sent one at a time, so leaving then loses the ones not yet sent.
 * The browser words the question itself. Returns a function that stops it.
 */
export function warnBeforeLeaving(unsaved: () => boolean): () => void {
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (unsaved()) event.preventDefault();
  };
  window.addEventListener("beforeunload", onBeforeUnload);
  return () => {
    window.removeEventListener("beforeunload", onBeforeUnload);
  };
}
