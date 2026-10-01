import { describe, expect, it } from "vitest";
import { addFormatRule, formatAt, formatRulesAfterEdit, type FormatRule } from "./formats";

function rule(
  [startRow, endRow, startCol, endCol]: [number, number | null, number, number | null],
  format: FormatRule["format"],
  reset?: boolean,
): FormatRule {
  return { startRow, endRow, startCol, endCol, format, ...(reset ? { reset } : {}) };
}

describe("formatAt", () => {
  const rules = [
    rule([0, 2, 0, 2], { bold: true, color: "red" }),
    rule([1, null, 1, 1], { italic: true, color: "blue" }),
    rule([2, 2, 0, null], { bold: false, fill: "yellow" }),
  ];

  it("has no format where no rule reaches", () => {
    expect(formatAt(rules, 5, 5)).toEqual({});
    expect(formatAt([], 0, 0)).toEqual({});
  });

  it("combines the rules that cover a cell, later ones over earlier ones", () => {
    expect(formatAt(rules, 0, 0)).toEqual({ bold: true, color: "red" });
    expect(formatAt(rules, 1, 1)).toEqual({ bold: true, italic: true, color: "blue" });
    expect(formatAt(rules, 2, 1)).toEqual({ italic: true, color: "blue", fill: "yellow" });
  });

  it("follows a rule with no last row or column as far as the table goes", () => {
    expect(formatAt(rules, 900, 1)).toEqual({ italic: true, color: "blue" });
    expect(formatAt(rules, 2, 90)).toEqual({ fill: "yellow" });
  });

  it("removes a property that a later rule sets to null", () => {
    expect(formatAt([...rules, rule([0, 0, 0, 0], { color: null })], 0, 0)).toEqual({ bold: true });
  });

  it("starts over at a rule that resets", () => {
    const cleared = [
      ...rules,
      rule([1, 1, 0, null], {}, true),
      rule([1, 1, 1, 1], { fill: "green" }),
    ];
    expect(formatAt(cleared, 1, 0)).toEqual({});
    expect(formatAt(cleared, 1, 1)).toEqual({ fill: "green" });
    expect(formatAt(cleared, 0, 0)).toEqual({ bold: true, color: "red" });
  });
});

describe("addFormatRule", () => {
  it("adds a rule after the others", () => {
    const first = rule([0, 0, 0, 0], { bold: true });
    const second = rule([0, 5, 0, 0], { italic: true });
    expect(addFormatRule([first], second)).toEqual([first, second]);
  });

  it("drops earlier rules it overrides everywhere", () => {
    const rules = [
      rule([0, 0, 0, 0], { bold: true }),
      rule([1, 1, 1, 1], { bold: false }),
      rule([0, 0, 0, 0], { italic: true }),
      rule([0, 9, 0, 9], { color: "red" }),
    ];
    const bold = rule([0, 3, 0, 3], { bold: true });
    expect(addFormatRule(rules, bold)).toEqual([rules[2], rules[3], bold]);
  });

  it("keeps an earlier rule it only partly covers, or that sets something else too", () => {
    const wide = rule([0, null, 0, 0], { bold: true });
    const both = rule([0, 0, 0, 0], { bold: true, color: "red" });
    const bold = rule([0, 5, 0, 0], { bold: true });
    expect(addFormatRule([wide, both], bold)).toEqual([wide, both, bold]);
  });

  it("drops everything under a rule that resets, and the reset too when nothing is left to clear", () => {
    const rules = [rule([0, 0, 0, 0], { bold: true }), rule([5, 5, 5, 5], { italic: true })];
    expect(addFormatRule(rules, rule([0, 2, 0, 2], {}, true))).toEqual([rules[1]]);
    const reset = rule([0, 2, 0, null], {}, true);
    const partly = rule([0, null, 0, 0], { bold: true });
    expect(addFormatRule([partly], reset)).toEqual([partly, reset]);
  });

  it("keeps a reset that a later, plain rule covers, because it still clears what came before", () => {
    const wide = rule([0, null, 0, null], { color: "red" });
    const reset = rule([0, 0, 0, 0], {}, true);
    const bold = rule([0, 0, 0, 0], { bold: true });
    expect(addFormatRule([wide, reset], bold)).toEqual([wide, reset, bold]);
  });

  it("does not add a rule that only removes formats where there are none", () => {
    expect(addFormatRule([], rule([0, 0, 0, 0], { bold: false, color: null }))).toEqual([]);
    const far = rule([9, 9, 9, 9], { bold: true });
    expect(addFormatRule([far], rule([0, 0, 0, 0], { bold: false }))).toEqual([far]);
    const near = rule([0, null, 0, 0], { bold: true });
    const unbold = rule([3, 3, 0, 0], { bold: false });
    expect(addFormatRule([near], unbold)).toEqual([near, unbold]);
  });

  it("does not grow when the same cells are formatted over and over", () => {
    let rules: FormatRule[] = [];
    for (let round = 0; round < 50; round += 1) {
      rules = addFormatRule(rules, rule([0, 3, 0, 3], { bold: round % 2 === 0 }));
    }
    expect(rules).toEqual([]);
    for (let round = 0; round < 51; round += 1) {
      rules = addFormatRule(rules, rule([0, 3, 0, 3], { bold: round % 2 === 0 }));
    }
    expect(rules).toEqual([rule([0, 3, 0, 3], { bold: true })]);
  });
});

describe("formatRulesAfterEdit", () => {
  const rules = [rule([2, 4, 1, 1], { bold: true }), rule([3, null, 0, null], { italic: true })];
  const rows = (edited: FormatRule[]): [number, number | null][] =>
    edited.map(({ startRow, endRow }) => [startRow, endRow]);

  it("moves rules below an inserted row, and grows a rule the row is inserted into", () => {
    expect(rows(formatRulesAfterEdit(rules, { axis: "row", kind: "insert", index: 0 }))).toEqual([
      [3, 5],
      [4, null],
    ]);
    expect(rows(formatRulesAfterEdit(rules, { axis: "row", kind: "insert", index: 3 }))).toEqual([
      [2, 5],
      [4, null],
    ]);
    expect(rows(formatRulesAfterEdit(rules, { axis: "row", kind: "insert", index: 9 }))).toEqual([
      [2, 4],
      [3, null],
    ]);
  });

  it("moves rules below a deleted row, and shrinks a rule the row is deleted from", () => {
    expect(rows(formatRulesAfterEdit(rules, { axis: "row", kind: "delete", index: 0 }))).toEqual([
      [1, 3],
      [2, null],
    ]);
    expect(rows(formatRulesAfterEdit(rules, { axis: "row", kind: "delete", index: 3 }))).toEqual([
      [2, 3],
      [3, null],
    ]);
  });

  it("drops a rule whose only row or column is deleted", () => {
    const edited = formatRulesAfterEdit(rules, { axis: "col", kind: "delete", index: 1 });
    expect(edited).toEqual([rule([3, null, 0, null], { italic: true })]);
    const one = [rule([2, 2, 0, 0], { bold: true })];
    expect(formatRulesAfterEdit(one, { axis: "row", kind: "delete", index: 2 })).toEqual([]);
    expect(formatRulesAfterEdit(one, { axis: "row", kind: "delete", index: 1 })).toEqual([
      rule([1, 1, 0, 0], { bold: true }),
    ]);
  });

  it("edits columns the same way", () => {
    const edited = formatRulesAfterEdit(rules, { axis: "col", kind: "insert", index: 0 });
    expect(edited.map(({ startCol, endCol }) => [startCol, endCol])).toEqual([
      [2, 2],
      [1, null],
    ]);
  });
});
