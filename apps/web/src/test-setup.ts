import { vi } from "vitest";

// jsdom has no layout, so it does not implement scrolling.
Element.prototype.scrollIntoView = vi.fn();
