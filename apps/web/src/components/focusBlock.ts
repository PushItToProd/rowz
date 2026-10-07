const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "input:not(:disabled)",
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  "a[href]",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** Brings a newly added block into view and moves focus into it. */
export function focusBlock(block: HTMLElement): void {
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  block.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "instant" : "smooth" });
  const target =
    block.querySelector<HTMLElement>('[role="grid"]') ??
    block.querySelector<HTMLElement>(".editable-name:not(input)") ??
    block.querySelector<HTMLElement>(FOCUSABLE_SELECTOR) ??
    block;
  target.focus({ preventScroll: true });
}
