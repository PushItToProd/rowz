import { vi } from "vitest";

// ECharts relies on browser layout. Tests inspect options at its public module boundary.
vi.mock("echarts/core", () => ({
  use: vi.fn(),
  init: vi.fn(() => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() })),
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe = vi.fn();
    disconnect = vi.fn();
  },
);

// jsdom has no layout, so it does not implement scrolling.
Element.prototype.scrollIntoView = vi.fn();

// CodeMirror measures text ranges on animation frames; jsdom has no range geometry.
Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
Range.prototype.getBoundingClientRect = () => new DOMRect();
