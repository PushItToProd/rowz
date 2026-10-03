import { describe, expect, it } from "vitest";
import {
  conditionalFormatAt,
  criterionTest,
  prepareConditionals,
  scaleBounds,
} from "./conditional";
import { formatRulesAfterEdit, type ConditionalRule, type FormatPatch } from "./formats";
import type { CellValue } from "./values";

const GRID: CellValue[][] = [
  ["Done", 10],
  ["Open", 40],
  ["done", "n/a"],
  [null, 25],
];
const read = (row: number, col: number): CellValue => GRID[row]?.[col] ?? null;
const extent = { rows: 4, cols: 2 };

const area = { startRow: 0, endRow: null, startCol: 0, endCol: 0 };
const numbers = { startRow: 0, endRow: null, startCol: 1, endCol: 1 };

function formatsOf(rules: ConditionalRule[], col: number) {
  const prepared = prepareConditionals(rules, read, extent);
  return GRID.map((_, row) => conditionalFormatAt(prepared, row, col, read(row, col)));
}

describe("scaleBounds", () => {
  it("finds the smallest and largest number, skipping text and empty cells", () => {
    expect(scaleBounds(numbers, read, extent)).toEqual({ min: 10, max: 40 });
  });

  it("stops at the table's size where the area is open, and at its own end otherwise", () => {
    expect(scaleBounds({ ...numbers, endRow: 1 }, read, extent)).toEqual({ min: 10, max: 40 });
    expect(scaleBounds({ ...numbers, startRow: 3 }, read, extent)).toEqual({ min: 25, max: 25 });
  });

  it("is undefined for an area with no numbers", () => {
    expect(scaleBounds(area, read, extent)).toBeUndefined();
  });
});

describe("criterion rules", () => {
  const rule = (criterion: string, format: FormatPatch = { fill: "green" }): ConditionalRule => ({
    ...area,
    kind: "criterion",
    criterion,
    format,
  });

  it("format the cells whose own value meets a COUNTIF criterion, ignoring letter case", () => {
    expect(formatsOf([rule("done")], 0)).toEqual([{ fill: "green" }, {}, { fill: "green" }, {}]);
  });

  it("compare numbers, and never match text with a numeric comparison", () => {
    expect(formatsOf([{ ...rule(">20"), ...numbers }], 1)).toEqual([
      {},
      { fill: "green" },
      {},
      { fill: "green" },
    ]);
  });

  it("match empty cells with an empty criterion and the others with <>", () => {
    expect(formatsOf([rule("")], 0).map((format) => "fill" in format)).toEqual([
      false,
      false,
      false,
      true,
    ]);
    expect(formatsOf([rule("<>")], 0).map((format) => "fill" in format)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it("apply in order, later over earlier, and null removes what an earlier rule gave", () => {
    const formats = formatsOf(
      [
        rule("Done", { fill: "green" }),
        rule("Done", { fill: "red" }),
        rule("done", { fill: null }),
      ],
      0,
    );
    expect(formats[0]).toEqual({ fill: null });
    const kept = formatsOf([rule("Done", { fill: "green" }), rule("Done", { fill: "red" })], 0);
    expect(kept[0]).toEqual({ fill: "red" });
  });

  it("apply only inside their area", () => {
    const only: ConditionalRule = { ...rule("Done"), startRow: 1 };
    expect(formatsOf([only], 0)[0]).toEqual({});
    expect(formatsOf([only], 1)[0]).toEqual({});
  });

  it("match nothing when the criterion cannot be built", () => {
    const tooLong = rule("*a".repeat(200));
    expect(criterionTest("*a".repeat(200))).toBeUndefined();
    expect(formatsOf([tooLong], 0)).toEqual([{}, {}, {}, {}]);
  });
});

describe("scale rules", () => {
  const scale = (low: "red" | null): ConditionalRule => ({
    ...numbers,
    kind: "scale",
    low,
    high: "green",
  });

  it("place each number between the smallest and the largest, and leave other cells alone", () => {
    const formats = formatsOf([scale("red")], 1);
    expect(formats[0]).toEqual({ shade: { low: "red", high: "green", at: 0 } });
    expect(formats[1]).toEqual({ shade: { low: "red", high: "green", at: 1 } });
    expect(formats[2]).toEqual({});
    expect(formats[3]).toEqual({ shade: { low: "red", high: "green", at: 0.5 } });
  });

  it("keep a missing low color as null", () => {
    expect(formatsOf([scale(null)], 1)[0]).toEqual({ shade: { low: null, high: "green", at: 0 } });
  });

  it("give the middle shade when every number is equal", () => {
    const flat = prepareConditionals([scale(null)], () => 5, extent);
    expect(conditionalFormatAt(flat, 0, 1, 5)).toEqual({
      shade: { low: null, high: "green", at: 0.5 },
    });
  });

  it("lose to a fill given by a later rule", () => {
    const rules: ConditionalRule[] = [
      scale(null),
      { ...numbers, kind: "criterion", criterion: ">30", format: { fill: "red" } },
    ];
    expect(formatsOf(rules, 1)[1]).toEqual({ fill: "red" });
    expect(formatsOf(rules, 1)[0]).toEqual({ shade: { low: null, high: "green", at: 0 } });
  });

  it("place numbers whose difference overflows", () => {
    const wide = prepareConditionals([scale(null)], (row) => [-1e308, 5e307, 1e308][row] ?? null, {
      rows: 3,
      cols: 2,
    });
    expect(conditionalFormatAt(wide, 1, 1, 5e307).shade?.at).toBeCloseTo(0.75);
    expect(conditionalFormatAt(wide, 2, 1, 1e308).shade?.at).toBe(1);
  });

  it("read the cells of a scale only once, and only when a cell asks", () => {
    let reads = 0;
    const counting = prepareConditionals(
      [scale(null)],
      (row, col) => {
        reads += 1;
        return read(row, col);
      },
      extent,
    );
    expect(reads).toBe(0);
    conditionalFormatAt(counting, 0, 1, 10);
    const first = reads;
    conditionalFormatAt(counting, 1, 1, 40);
    expect(reads).toBe(first);
  });

  it("combine with a criterion rule", () => {
    const rules: ConditionalRule[] = [
      scale(null),
      { ...numbers, kind: "criterion", criterion: ">30", format: { bold: true } },
    ];
    expect(formatsOf(rules, 1)[1]).toEqual({
      shade: { low: null, high: "green", at: 1 },
      bold: true,
    });
  });
});

describe("formatRulesAfterEdit for conditional rules", () => {
  const rule: ConditionalRule = {
    startRow: 2,
    endRow: 4,
    startCol: 1,
    endCol: null,
    kind: "scale",
    low: null,
    high: "blue",
  };

  it("moves, grows, and drops rules as it does for formats, keeping what kind they are", () => {
    expect(
      formatRulesAfterEdit([rule], { axis: "row", kind: "insert", index: 0, count: 1 }),
    ).toEqual([{ ...rule, startRow: 3, endRow: 5 }]);
    expect(
      formatRulesAfterEdit([rule], { axis: "row", kind: "insert", index: 3, count: 2 }),
    ).toEqual([{ ...rule, endRow: 6 }]);
    expect(
      formatRulesAfterEdit([rule], { axis: "row", kind: "delete", index: 2, count: 3 }),
    ).toEqual([]);
    expect(
      formatRulesAfterEdit([rule], { axis: "col", kind: "delete", index: 0, count: 1 }),
    ).toEqual([{ ...rule, startCol: 0 }]);
  });
});
