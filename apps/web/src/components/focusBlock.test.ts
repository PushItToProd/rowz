import { afterEach, expect, it, vi } from "vitest";
import { focusBlock } from "./focusBlock";

const matchMediaDescriptor = Object.getOwnPropertyDescriptor(window, "matchMedia");

afterEach(() => {
  document.body.replaceChildren();
  if (matchMediaDescriptor) Object.defineProperty(window, "matchMedia", matchMediaDescriptor);
  else Reflect.deleteProperty(window, "matchMedia");
});

function block(scrollIntoView: ReturnType<typeof vi.fn>): HTMLDivElement {
  const element = document.createElement("div");
  element.tabIndex = -1;
  element.setAttribute("role", "region");
  element.setAttribute("aria-label", "Chart 1");
  Object.defineProperty(element, "scrollIntoView", { value: scrollIntoView });
  document.body.append(element);
  return element;
}

it("scrolls with reduced motion off and focuses the first available control", () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  const scrollIntoView = vi.fn();
  const card = block(scrollIntoView);
  const first = document.createElement("button");
  const second = document.createElement("button");
  card.append(first, second);

  focusBlock(card);

  expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "smooth" });
  expect(document.activeElement).toBe(first);
});

it("focuses a block's grid before its other controls", () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: false }),
  });
  const scrollIntoView = vi.fn();
  const card = block(scrollIntoView);
  const name = document.createElement("button");
  const grid = document.createElement("div");
  grid.setAttribute("role", "grid");
  grid.tabIndex = 0;
  card.append(name, grid);

  focusBlock(card);

  expect(document.activeElement).toBe(grid);
});

it("uses an instant scroll for reduced motion and focuses the labeled card if it has no controls", () => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({ matches: true }),
  });
  const scrollIntoView = vi.fn();
  const card = block(scrollIntoView);

  focusBlock(card);

  expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest", behavior: "instant" });
  expect(card.getAttribute("aria-label")).toBe("Chart 1");
  expect(document.activeElement).toBe(card);
});
