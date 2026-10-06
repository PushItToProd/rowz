import { expect, it, vi } from "vitest";
import { sliceGraphemes } from "./graphemes";

it("stops segmenting once the requested slice ends", () => {
  let yielded = 0;
  const segment = Intl.Segmenter.prototype.segment;
  const spy = vi.spyOn(Intl.Segmenter.prototype, "segment");
  spy.mockImplementation(function (this: Intl.Segmenter, value: string) {
    const segments = segment.call(this, value);
    return {
      *[Symbol.iterator]() {
        for (const part of segments) {
          yielded += 1;
          yield part;
        }
      },
    } as Intl.Segments;
  });

  try {
    expect(sliceGraphemes("界".repeat(100_000), 0, 1)).toBe("界");
    expect(yielded).toBe(1);
  } finally {
    spy.mockRestore();
  }
});
