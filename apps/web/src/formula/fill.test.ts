import { parseAddress, type CellAddress } from "@spreadsheet-app/engine";
import { describe, expect, it } from "vitest";
import {
  blockOf,
  clearWrites,
  contains,
  fillTarget,
  fillWrites,
  fromClipboardText,
  inputsOf,
  pasteWrites,
  toClipboardText,
  type Block,
} from "./fill";

function at(address: string): CellAddress {
  const parsed = parseAddress(address);
  if (!parsed) throw new Error(`Bad address ${address}`);
  return parsed;
}

function block(range: string): Block {
  const [start = "", end = start] = range.split(":");
  return blockOf(at(start), at(end));
}

/** Looks up inputs given as `{ A1: "..." }`. */
function sheet(cells: Record<string, string>): (cell: CellAddress) => string {
  const byPosition = new Map(
    Object.entries(cells).map(([address, input]) => [JSON.stringify(at(address)), input]),
  );
  return (cell) => byPosition.get(JSON.stringify(cell)) ?? "";
}

/** Writes as `{ A1: "..." }`, for comparing. */
function byAddress(writes: { row: number; col: number; input: string }[]): Record<string, string> {
  const letters = (col: number): string => String.fromCharCode(65 + col);
  return Object.fromEntries(
    writes.map(({ row, col, input }) => [`${letters(col)}${String(row + 1)}`, input]),
  );
}

describe("blockOf and contains", () => {
  it("orders the corners whichever way they are given", () => {
    expect(blockOf(at("C3"), at("A1"))).toEqual({ startRow: 0, startCol: 0, endRow: 2, endCol: 2 });
    expect(blockOf(at("B2"))).toEqual({ startRow: 1, startCol: 1, endRow: 1, endCol: 1 });
  });

  it("tests whether a cell is inside", () => {
    expect(contains(block("B2:C3"), at("C3"))).toBe(true);
    expect(contains(block("B2:C3"), at("A2"))).toBe(false);
    expect(contains(block("B2:C3"), at("B4"))).toBe(false);
  });
});

describe("fillTarget", () => {
  it.each([
    ["B2:C3", "C6", "B2:C6"],
    ["B2:C3", "E9", "B2:C9"],
    ["B4:C5", "A1", "B1:C5"],
    ["B2:C3", "F3", "B2:F3"],
    ["C2:D3", "A2", "A2:D3"],
    ["B2:C3", "C2", "B2:C3"],
  ])("dragging the handle of %s to %s fills %s", (source, to, expected) => {
    expect(fillTarget(block(source), at(to))).toEqual(block(expected));
  });
});

describe("fillWrites", () => {
  it("copies a formula down and moves its relative references", () => {
    const writes = fillWrites(block("C1"), block("C1:C3"), sheet({ C1: "=A1*$B$1" }));
    expect(byAddress(writes)).toEqual({ C2: "=A2*$B$1", C3: "=A3*$B$1" });
  });

  it("copies across, up, and to the left", () => {
    expect(byAddress(fillWrites(block("B2"), block("B2:D2"), sheet({ B2: "=B1" })))).toEqual({
      C2: "=C1",
      D2: "=D1",
    });
    expect(byAddress(fillWrites(block("B3"), block("B1:B3"), sheet({ B3: "=A3" })))).toEqual({
      B1: "=A1",
      B2: "=A2",
    });
    expect(byAddress(fillWrites(block("C1"), block("A1:C1"), sheet({ C1: "=C2" })))).toEqual({
      A1: "=A2",
      B1: "=B2",
    });
  });

  it("repeats a source of several cells as a pattern", () => {
    const writes = fillWrites(block("A1:A2"), block("A1:A5"), sheet({ A1: "x", A2: "=B2" }));
    expect(byAddress(writes)).toEqual({ A3: "x", A4: "=B4", A5: "x" });
  });

  it("repeats a pattern backward when filling up", () => {
    const writes = fillWrites(block("A4:A5"), block("A1:A5"), sheet({ A4: "first", A5: "second" }));
    expect(byAddress(writes)).toEqual({ A1: "second", A2: "first", A3: "second" });
  });

  it("clears target cells when the source cell is empty", () => {
    expect(byAddress(fillWrites(block("A1"), block("A1:A2"), sheet({ A2: "old" })))).toEqual({
      A2: "",
    });
  });

  it("writes nothing when the target is the source", () => {
    expect(fillWrites(block("A1:B2"), block("A1:B2"), sheet({ A1: "x" }))).toEqual([]);
  });

  it("writes #REF! into a formula filled past the edge it reads across", () => {
    expect(byAddress(fillWrites(block("A2"), block("A1:A2"), sheet({ A2: "=A1" })))).toEqual({
      A1: "=#REF!",
    });
  });
});

describe("clearWrites and inputsOf", () => {
  const cells = sheet({ A1: "1", B2: "=A1" });

  it("empties only the cells that hold something", () => {
    expect(byAddress(clearWrites(block("A1:B2"), cells))).toEqual({ A1: "", B2: "" });
    expect(clearWrites(block("C1:D4"), cells)).toEqual([]);
  });

  it("reads a block's inputs as rows", () => {
    expect(inputsOf(block("A1:B2"), cells)).toEqual([
      ["1", ""],
      ["", "=A1"],
    ]);
  });
});

describe("pasteWrites", () => {
  it("places rows at the target cell as they are when they came from elsewhere", () => {
    expect(
      byAddress(
        pasteWrites(
          [
            ["a", "=A1"],
            ["c", ""],
          ],
          at("B2"),
        ),
      ),
    ).toEqual({
      B2: "a",
      C2: "=A1",
      B3: "c",
      C3: "",
    });
  });

  it("moves formula references by the distance from where the rows were copied", () => {
    expect(byAddress(pasteWrites([["=A1+$B$1"], ["=A2"]], at("D5"), at("C1")))).toEqual({
      D5: "=B5+$B$1",
      D6: "=B6",
    });
  });

  it("writes rows of different lengths as given", () => {
    expect(byAddress(pasteWrites([["a"], ["b", "c"]], at("A1")))).toEqual({
      A1: "a",
      A2: "b",
      B2: "c",
    });
  });
});

describe("clipboard text", () => {
  it("writes rows as lines of tab-separated cells and reads them back", () => {
    const rows = [
      ["a", "b"],
      ["", "=A1"],
    ];
    expect(toClipboardText(rows)).toBe("a\tb\n\t=A1");
    expect(fromClipboardText(toClipboardText(rows))).toEqual(rows);
  });

  it.each([
    [
      "a\tb\r\nc\td\r\n",
      [
        ["a", "b"],
        ["c", "d"],
      ],
    ],
    ["one cell", [["one cell"]]],
    ["a\n\nb", [["a"], [""], ["b"]]],
    ["", [[""]]],
    ["a\rb", [["a"], ["b"]]],
  ])("reads %j as %j", (text, rows) => {
    expect(fromClipboardText(text)).toEqual(rows);
  });
});

describe("continuing a series", () => {
  const values = (source: string, target: string, cells: Record<string, string>): string[] =>
    fillWrites(block(source), block(target), sheet(cells), true).map((write) => write.input);

  it.each<[string, Record<string, string>, string, string, string[]]>([
    ["numbers an even step apart", { A1: "1", A2: "2" }, "A1:A2", "A1:A5", ["3", "4", "5"]],
    ["a step other than 1", { A1: "10", A2: "7.5" }, "A1:A2", "A1:A4", ["5", "2.5"]],
    ["decimal steps without noise", { A1: "0.1", A2: "0.2" }, "A1:A2", "A1:A4", ["0.3", "0.4"]],
    ["three numbers", { A1: "2", A2: "4", A3: "6" }, "A1:A3", "A1:A5", ["8", "10"]],
    ["numbers across a row", { A1: "5", B1: "10" }, "A1:B1", "A1:D1", ["15", "20"]],
    ["a series upward", { A3: "5", A4: "6" }, "A3:A4", "A1:A4", ["3", "4"]],
    ["a series leftward", { C1: "1", D1: "3" }, "C1:D1", "A1:D1", ["-3", "-1"]],
    [
      "one date, by a day",
      { A1: "2026-09-29" },
      "A1",
      "A1:A4",
      ["2026-09-30", "2026-10-01", "2026-10-02"],
    ],
    [
      "dates a week apart",
      { A1: "2026-09-01", A2: "2026-09-08" },
      "A1:A2",
      "A1:A4",
      ["2026-09-15", "2026-09-22"],
    ],
    [
      "dates with times",
      { A1: "2026-09-30 08:00", A2: "2026-09-30 08:30" },
      "A1:A2",
      "A1:A3",
      ["2026-09-30 09:00"],
    ],
    ["a date upward", { A3: "2026-01-01" }, "A3", "A1:A3", ["2025-12-30", "2025-12-31"]],
    ["text ending in a number", { A1: "Week 1" }, "A1", "A1:A3", ["Week 2", "Week 3"]],
    ["numbered text with a step", { A1: "Q1", A2: "Q3" }, "A1:A2", "A1:A4", ["Q5", "Q7"]],
  ])("continues %s", (_, cells, source, target, expected) => {
    expect(values(source, target, cells)).toEqual(expected);
  });

  it.each<[string, Record<string, string>, string, string, string[]]>([
    ["one number", { A1: "5" }, "A1", "A1:A3", ["5", "5"]],
    ["numbers an uneven step apart", { A1: "1", A2: "2", A3: "4" }, "A1:A3", "A1:A5", ["1", "2"]],
    [
      "dates an uneven step apart",
      { A1: "2026-01-01", A2: "2026-01-02", A3: "2026-01-05" },
      "A1:A3",
      "A1:A4",
      ["2026-01-01"],
    ],
    ["plain text", { A1: "a", A2: "b" }, "A1:A2", "A1:A4", ["a", "b"]],
    [
      "numbered text with different names",
      { A1: "Week 1", A2: "Day 2" },
      "A1:A2",
      "A1:A4",
      ["Week 1", "Day 2"],
    ],
    ["a number and text", { A1: "1", A2: "x" }, "A1:A2", "A1:A4", ["1", "x"]],
    ["empty cells", {}, "A1:A2", "A1:A4", ["", ""]],
  ])("repeats %s", (_, cells, source, target, expected) => {
    expect(values(source, target, cells)).toEqual(expected);
  });

  it("still moves the references of formulas, even ones that end in a number", () => {
    expect(values("A1:A2", "A1:A3", { A1: "=B1", A2: "=B2" })).toEqual(["=B3"]);
    expect(values("A1", "A1:A3", { A1: "=B1*10" })).toEqual(["=B2*10", "=B3*10"]);
  });

  it("decides for each column of the source on its own", () => {
    const writes = fillWrites(
      block("A1:B2"),
      block("A1:B4"),
      sheet({ A1: "1", A2: "2", B1: "x", B2: "y" }),
      true,
    );
    expect(byAddress(writes)).toEqual({ A3: "3", B3: "x", A4: "4", B4: "y" });
  });

  it("repeats numbered text where counting down would go below zero", () => {
    expect(values("A3", "A1:A3", { A3: "Item 1" })).toEqual(["Item 1", "Item 0"]);
  });

  it("repeats without the series flag, as Ctrl+D does", () => {
    const writes = fillWrites(block("A1:A2"), block("A1:A4"), sheet({ A1: "1", A2: "2" }));
    expect(writes.map((write) => write.input)).toEqual(["1", "2"]);
  });
});
