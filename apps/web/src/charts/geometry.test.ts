import { describe, expect, it } from "vitest";
import { linePaths, linear, niceScale, pieSlices, slicePath, visibleLabels } from "./geometry";

describe("niceScale", () => {
  it.each([
    [[3, 47], { min: 0, max: 50, ticks: [0, 10, 20, 30, 40, 50] }],
    [[120, 980], { min: 0, max: 1000, ticks: [0, 200, 400, 600, 800, 1000] }],
    [[0.2, 0.7], { min: 0, max: 0.8, ticks: [0, 0.2, 0.4, 0.6, 0.8] }],
    [[-30, 20], { min: -30, max: 20, ticks: [-30, -20, -10, 0, 10, 20] }],
    [[-8, -2], { min: -8, max: 0, ticks: [-8, -6, -4, -2, 0] }],
    [[5], { min: 0, max: 5, ticks: [0, 1, 2, 3, 4, 5] }],
    [[0.1, 0.3], { min: 0, max: 0.3, ticks: [0, 0.1, 0.2, 0.3] }],
  ])("covers %j with %j", (values, scale) => {
    expect(niceScale(values)).toEqual(scale);
  });

  it("gives a usable scale when there is nothing to cover, or only one value", () => {
    expect(niceScale([])).toEqual({ min: -1, max: 1, ticks: [-1, -0.5, 0, 0.5, 1] });
    expect(niceScale([0, 0])).toEqual({ min: -1, max: 1, ticks: [-1, -0.5, 0, 0.5, 1] });
    expect(niceScale([7, 7], false)).toEqual({ min: 6, max: 8, ticks: [6, 6.5, 7, 7.5, 8] });
  });

  it("leaves zero out when told the values need not start there", () => {
    expect(niceScale([1010, 1090], false)).toEqual({
      min: 1000,
      max: 1100,
      ticks: [1000, 1020, 1040, 1060, 1080, 1100],
    });
    expect(niceScale([-3, 4], false).ticks).toContain(0);
  });
});

describe("linear", () => {
  it("maps one interval onto another, in either direction", () => {
    const toPixels = linear([0, 100], [300, 20]);
    expect(toPixels(0)).toBe(300);
    expect(toPixels(100)).toBe(20);
    expect(toPixels(50)).toBe(160);
    expect(toPixels(150)).toBe(-120);
  });

  it("maps everything to the start when the source interval is empty", () => {
    expect(linear([5, 5], [10, 90])(5)).toBe(10);
  });
});

describe("linePaths", () => {
  it("draws one path through unbroken points", () => {
    expect(
      linePaths([
        { x: 0, y: 10 },
        { x: 5, y: 2.5 },
        { x: 10, y: 7.333 },
      ]),
    ).toEqual(["M0,10 L5,2.5 L10,7.33"]);
  });

  it("breaks the line where a point is missing", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 1 };
    expect(linePaths([null, a, b, null, null, b, null])).toEqual(["M0,0 L1,1", "M1,1"]);
    expect(linePaths([null, null])).toEqual([]);
    expect(linePaths([])).toEqual([]);
  });
});

describe("pieSlices", () => {
  it("gives each positive value its share, in order around the pie", () => {
    expect(pieSlices([1, 3])).toEqual([
      { index: 0, value: 1, fraction: 0.25, start: 0, end: 0.25 },
      { index: 1, value: 3, fraction: 0.75, start: 0.25, end: 1 },
    ]);
  });

  it("gives no slice to zero, a negative number, or a gap", () => {
    expect(pieSlices([2, 0, null, -5, 2]).map((slice) => slice.index)).toEqual([0, 4]);
    expect(pieSlices([null, 0])).toEqual([]);
  });
});

describe("slicePath", () => {
  const center = { x: 100, y: 100 };

  it("draws a wedge from the center, clockwise from the top", () => {
    expect(slicePath(center, 50, { index: 0, value: 1, fraction: 0.25, start: 0, end: 0.25 })).toBe(
      "M100,100 L100,50 A50,50 0 0 1 150,100 Z",
    );
  });

  it("uses the long way around for a slice of more than half", () => {
    expect(slicePath(center, 50, { index: 0, value: 3, fraction: 0.75, start: 0.25, end: 1 })).toBe(
      "M100,100 L150,100 A50,50 0 1 1 100,50 Z",
    );
  });

  it("draws a whole pie as a circle, which a single wedge cannot be", () => {
    expect(slicePath(center, 50, { index: 0, value: 1, fraction: 1, start: 0, end: 1 })).toBe(
      "M100,50 A50,50 0 1 1 100,150 A50,50 0 1 1 100,50 Z",
    );
  });
});

describe("visibleLabels", () => {
  it("shows every label when there is room", () => {
    expect(visibleLabels(3, 10)).toEqual([true, true, true]);
  });

  it("shows evenly spaced labels when there is not", () => {
    expect(visibleLabels(7, 3)).toEqual([true, false, false, true, false, false, true]);
    expect(visibleLabels(4, 0)).toEqual([true, false, false, false]);
    expect(visibleLabels(0, 5)).toEqual([]);
  });
});
