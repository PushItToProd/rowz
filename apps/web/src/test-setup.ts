import { vi } from "vitest";

// jsdom has no layout, so it does not implement scrolling.
Element.prototype.scrollIntoView = vi.fn();

// CodeMirror measures text ranges on animation frames; jsdom has no range geometry.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
