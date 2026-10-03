import { describe, expect, it } from "vitest";
import { displayRows } from "./display";
import type { CellValue } from "./values";

const GRID: CellValue[][] = [
  ["pear", 3],
  ["apple", 1],
  [null, 2],
  ["fig", 1],
  ["Apple", null],
];
const valueAt = (row: number, col: number): CellValue => GRID[row]?.[col] ?? null;

describe("displayRows", () => {
  it("keeps the stored order with no sort", () => {
    expect(displayRows(5, valueAt, [])).toEqual([0, 1, 2, 3, 4]);
  });

  it("sorts ascending, putting empty cells last", () => {
    expect(displayRows(5, valueAt, [{ col: 0, descending: false }])).toEqual([1, 4, 3, 0, 2]);
  });

  it("sorts descending, still putting empty cells last", () => {
    expect(displayRows(5, valueAt, [{ col: 0, descending: true }])).toEqual([0, 3, 1, 4, 2]);
  });

  it("keeps stored order among rows that tie", () => {
    expect(displayRows(5, valueAt, [{ col: 1, descending: false }])).toEqual([1, 3, 2, 0, 4]);
    expect(displayRows(5, valueAt, [{ col: 1, descending: true }])).toEqual([0, 2, 1, 3, 4]);
  });

  it("breaks ties with the next key", () => {
    const keys = [
      { col: 1, descending: false },
      { col: 0, descending: true },
    ];
    expect(displayRows(5, valueAt, keys)).toEqual([3, 1, 2, 0, 4]);
  });

  it("leaves out the rows a filter rejects", () => {
    expect(displayRows(5, valueAt, [], (row) => row % 2 === 0)).toEqual([0, 2, 4]);
    expect(displayRows(5, valueAt, [{ col: 1, descending: true }], (row) => row !== 0)).toEqual([
      2, 1, 3, 4,
    ]);
  });
});
