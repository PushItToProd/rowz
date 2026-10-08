const NATIVE_INTERACTIVE_SELECTOR = "button, input, select, textarea, a[href]";

/** Whether keyboard events from a native control should stay with that control. */
export function isNativelyInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(NATIVE_INTERACTIVE_SELECTOR) !== null;
}
