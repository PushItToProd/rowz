import { describe, expect, it } from "vitest";
import { countVisibleRows, dataRegionDestination, usedRangeDestination } from "./gridNavigation";

describe("dataRegionDestination", () => {
  const run = (
    values: readonly string[],
    row: number,
    direction: -1 | 1,
  ): { row: number; col: number } =>
    dataRegionDestination(
      { row, col: 0 },
      { row: direction, col: 0 },
      values.length,
      1,
      ({ row: candidate }) => values[candidate] !== "",
    );

  it("moves to the end of a contiguous non-empty run", () => {
    expect(run(["a", "b", "c", "", "d"], 1, 1)).toEqual({ row: 2, col: 0 });
    expect(run(["a", "b", "c", "", "d"], 2, -1)).toEqual({ row: 0, col: 0 });
  });

  it("moves to the next non-empty cell when the current cell or neighbor is empty", () => {
    expect(run(["a", "", "b", "", "c"], 0, 1)).toEqual({ row: 2, col: 0 });
    expect(run(["a", "", "b", "", "c"], 1, 1)).toEqual({ row: 2, col: 0 });
  });

  it("moves to the table edge when no later non-empty cell exists", () => {
    expect(run(["a", "b", "", ""], 1, 1)).toEqual({ row: 3, col: 0 });
    expect(run(["", "", "a"], 1, -1)).toEqual({ row: 0, col: 0 });
  });

  it("works across columns", () => {
    const values = ["a", "b", "", "c"];
    expect(
      dataRegionDestination(
        { row: 0, col: 2 },
        { row: 0, col: 1 },
        1,
        values.length,
        ({ col }) => values[col] !== "",
      ),
    ).toEqual({ row: 0, col: 3 });
  });
});

describe("countVisibleRows", () => {
  it("counts rows that intersect the viewport, including partial rows", () => {
    expect(countVisibleRows([0, 20, 50, 70, 100], 15, 71)).toBe(4);
  });

  it("returns zero when the grid is outside the viewport", () => {
    expect(countVisibleRows([0, 20, 40], 50, 100)).toBe(0);
  });
});

describe("usedRangeDestination", () => {
  it("returns the bottommost and rightmost cells that contain data", () => {
    const cells = new Set(["0:2", "3:0", "1:1"]);
    expect(
      usedRangeDestination(5, 4, ({ row, col }) => cells.has(`${String(row)}:${String(col)}`)),
    ).toEqual({ row: 3, col: 2 });
  });

  it("returns A1 for an empty table", () => {
    expect(usedRangeDestination(20, 8, () => false)).toEqual({ row: 0, col: 0 });
  });
});
