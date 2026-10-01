import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("toCsv", () => {
  it("separates cells with commas and rows with line breaks", () => {
    expect(
      toCsv([
        ["a", "b"],
        ["1", ""],
      ]),
    ).toBe("a,b\r\n1,");
  });

  it("quotes a cell that holds a comma, a quote, or a line break", () => {
    expect(toCsv([["a,b", 'say "hi"', "two\nlines", "plain"]])).toBe(
      '"a,b","say ""hi""","two\nlines",plain',
    );
  });
});

describe("parseCsv", () => {
  it.each<[string, string, string[][]]>([
    [
      "cells and rows",
      "a,b\n1,2",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "Windows line breaks",
      "a,b\r\n1,2\r\n",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    ["old Mac line breaks", "a\rb", [["a"], ["b"]]],
    ["a line break at the end", "a\n", [["a"]]],
    [
      "empty cells",
      "a,,c\n,,",
      [
        ["a", "", "c"],
        ["", "", ""],
      ],
    ],
    ["an empty line between rows", "a\n\nb", [["a"], [""], ["b"]]],
    ["a quoted comma", '"a,b",c', [["a,b", "c"]]],
    ["a doubled quote", '"say ""hi""",x', [['say "hi"', "x"]]],
    ["a quoted line break", '"two\nlines",x\ny', [["two\nlines", "x"], ["y"]]],
    ["a quoted empty cell at the end", 'a,""', [["a", ""]]],
    ["a quote inside an unquoted cell", 'a"b,c', [['a"b', "c"]]],
    ["a byte order mark", "﻿a,b", [["a", "b"]]],
    [
      "semicolons",
      "a;b;c\n1;2;3",
      [
        ["a", "b", "c"],
        ["1", "2", "3"],
      ],
    ],
    [
      "tabs",
      "a\tb\n1\t2",
      [
        ["a", "b"],
        ["1", "2"],
      ],
    ],
    [
      "commas inside a semicolon file",
      "1,5;2,5;x\n3;4;5",
      [
        ["1,5", "2,5", "x"],
        ["3", "4", "5"],
      ],
    ],
    ["rows of different lengths", "a\nb,c,d", [["a"], ["b", "c", "d"]]],
    ["nothing", "", []],
    ["a single cell", "x", [["x"]]],
  ])("reads %s", (_, text, expected) => {
    expect(parseCsv(text)).toEqual(expected);
  });

  it("reads back what toCsv wrote", () => {
    const cell = fc.string({ unit: fc.constantFrom("a", "1", ",", '"', "\n", "\r", " ", ";") });
    const rows = fc.array(fc.array(cell, { minLength: 1, maxLength: 4 }), { maxLength: 4 });
    fc.assert(
      fc.property(rows, (table) => {
        // One empty cell alone on the last line is the same text as a final line break.
        fc.pre(table.at(-1)?.join("") !== "" || (table.at(-1)?.length ?? 2) > 1);
        // A first line of semicolons and no commas would be read as semicolon-separated.
        fc.pre(!(table[0]?.join("").includes(";") ?? false));
        expect(parseCsv(toCsv(table))).toEqual(table);
      }),
      { numRuns: 500 },
    );
  });
});
