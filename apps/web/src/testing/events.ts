import { nextTick } from "vue";

/** Dispatches a click with a browser-like click count and waits for Vue updates. */
export async function clickWithDetail(
  element: Element,
  detail = 1,
  modifiers: Pick<MouseEventInit, "altKey" | "ctrlKey" | "metaKey" | "shiftKey"> = {},
): Promise<void> {
  element.dispatchEvent(
    new MouseEvent("click", { button: 0, detail, bubbles: true, cancelable: true, ...modifiers }),
  );
  await nextTick();
}
