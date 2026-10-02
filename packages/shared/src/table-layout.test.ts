import { describe, expect, it } from "vitest";
import { TableLayout } from "./table-layout";

describe("TableLayout", () => {
  const rows = [
    { id: "second", orderKey: "a1" },
    { id: "first", orderKey: "a0" },
  ];

  it("translates both ways using byte order without mutating its inputs", () => {
    const columns = ["left", "right"];
    const layout = new TableLayout(rows, columns);
    expect(layout.rowIds).toEqual(["first", "second"]);
    expect(rows[0]!.id).toBe("second");
    expect(layout.position({ rowId: "second", colId: "right" })).toEqual({ row: 1, col: 1 });
    expect(layout.identity({ row: 0, col: 0 })).toEqual({ rowId: "first", colId: "left" });
    columns.reverse();
    expect(layout.colIndex("left")).toBe(0);
  });

  it("keeps a cell's identity when a row or column is inserted before it", () => {
    const before = new TableLayout(rows, ["left", "right"]);
    const cell = before.identity({ row: 1, col: 1 })!;
    const after = new TableLayout(
      [...rows, { id: "new", orderKey: "Zz" }],
      ["new", "left", "right"],
    );
    expect(after.position(cell)).toEqual({ row: 2, col: 2 });
  });

  it("returns undefined for a deleted identity or an invalid position", () => {
    const layout = new TableLayout(rows, ["left"]);
    expect(layout.position({ rowId: "deleted", colId: "left" })).toBeUndefined();
    expect(layout.position({ rowId: "first", colId: "deleted" })).toBeUndefined();
    for (const row of [-1, 2, 0.5, NaN, Infinity])
      expect(layout.identity({ row, col: 0 })).toBeUndefined();
    expect(new TableLayout([], ["left"]).identity({ row: 0, col: 0 })).toBeUndefined();
  });

  it("rejects duplicate identities and duplicate order keys", () => {
    expect(() => new TableLayout([...rows, rows[0]!], [])).toThrow(RangeError);
    expect(() => new TableLayout(rows, ["left", "left"])).toThrow(RangeError);
    expect(
      () =>
        new TableLayout(
          [
            { id: "a", orderKey: "a0" },
            { id: "b", orderKey: "a0" },
          ],
          [],
        ),
    ).toThrow(RangeError);
  });
});
