/** Copies text with the legacy selection API when the Clipboard API is unavailable. */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    const clipboard = Reflect.get(navigator, "clipboard") as Clipboard | undefined;
    if (typeof clipboard?.writeText === "function") {
      await clipboard.writeText(text);
      return true;
    }
  } catch {
    // Some browsers expose the Clipboard API but reject writes outside a secure context.
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.setAttribute("aria-hidden", "true");
  Object.assign(textarea.style, {
    position: "fixed",
    left: "-9999px",
    top: "0",
    opacity: "0",
  });
  const active = document.activeElement;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : [];
  document.body.append(textarea);
  textarea.select();
  let copied: boolean;
  try {
    // This legacy command is the fallback for contexts without navigator.clipboard.
    // eslint-disable-next-line @typescript-eslint/no-deprecated
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  } finally {
    textarea.remove();
    if (active instanceof HTMLElement && active.isConnected) active.focus({ preventScroll: true });
    if (selection) {
      selection.removeAllRanges();
      for (const range of ranges) {
        if (range.startContainer.isConnected && range.endContainer.isConnected)
          selection.addRange(range);
      }
    }
  }
  return copied;
}
