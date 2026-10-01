import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  cellKey,
  columnIndex,
  columnLabel,
  formatAddress,
  parseAddress,
  rangeContains,
} from "./address";

describe("column labels", () => {
  it.each([
    [0, "A"],
    [25, "Z"],
    [26, "AA"],
    [27, "AB"],
    [701, "ZZ"],
    [702, "AAA"],
  ])("labels column %i as %s", (index, label) => {
    expect(columnLabel(index)).toBe(label);
    expect(columnIndex(label)).toBe(index);
  });

  it("reads lowercase labels", () => {
    expect(columnIndex("ab")).toBe(27);
  });

  it("round-trips every index", () => {
    fc.assert(
      fc.property(fc.nat(18_000), (index) => {
        expect(columnIndex(columnLabel(index))).toBe(index);
      }),
    );
  });
});

describe("addresses", () => {
  it.each([
    ["A1", { row: 0, col: 0 }],
    ["c10", { row: 9, col: 2 }],
    ["AA100", { row: 99, col: 26 }],
  ])("parses %s", (text, address) => {
    expect(parseAddress(text)).toEqual(address);
  });

  it.each(["", "A", "1", "A0", "A-1", "ABCD1", "A1B", "$A$1"])("rejects %j", (text) => {
    expect(parseAddress(text)).toBeUndefined();
  });

  it("formats an address", () => {
    expect(formatAddress({ row: 9, col: 27 })).toBe("AB10");
  });

  it("gives distinct keys to cells that differ only by table", () => {
    expect(cellKey({ tableId: "a", row: 1, col: 2 })).not.toBe(
      cellKey({ tableId: "b", row: 1, col: 2 }),
    );
  });
});

describe("rangeContains", () => {
  const range = { tableId: "t", startRow: 1, startCol: 1, endRow: 3, endCol: 2 };

  it.each([
    [{ tableId: "t", row: 1, col: 1 }, true],
    [{ tableId: "t", row: 3, col: 2 }, true],
    [{ tableId: "t", row: 0, col: 1 }, false],
    [{ tableId: "t", row: 4, col: 1 }, false],
    [{ tableId: "t", row: 2, col: 0 }, false],
    [{ tableId: "t", row: 2, col: 3 }, false],
    [{ tableId: "other", row: 2, col: 1 }, false],
  ])("%j -> %s", (cell, expected) => {
    expect(rangeContains(range, cell)).toBe(expected);
  });
});
