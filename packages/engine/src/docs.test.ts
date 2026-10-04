import { describe, expect, it } from "vitest";
import { errorDocs, EXAMPLE_CELLS, FUNCTION_CATEGORIES, functionDocs } from "./docs";
import { defaultFunctions } from "./functions";
import { parseFormula } from "./parser";
import { at, workbookWith } from "./testing";
import { ERROR_CODES, formatValue, isButton, isError } from "./values";

function evaluateExample(example: string) {
  const workbook = workbookWith({ t1: { ...EXAMPLE_CELLS, Z99: `=${example}` } });
  return { workbook, value: workbook.getValue(at("Z99")) };
}

describe("functionDocs", () => {
  it("documents every function in the default registry, and nothing else", () => {
    expect(functionDocs.map((doc) => doc.name).sort()).toEqual([...defaultFunctions.keys()].sort());
  });

  it("lists functions by category, in the order the categories are shown", () => {
    const order = functionDocs.map((doc) => FUNCTION_CATEGORIES.indexOf(doc.category));
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(new Set(order).size).toBe(FUNCTION_CATEGORIES.length);
  });

  it("writes each syntax as a call to the function it documents", () => {
    for (const doc of functionDocs) expect(doc.syntax).toMatch(new RegExp(`^${doc.name}\\(.*\\)$`));
  });

  it.each(functionDocs.map((doc) => [doc.name, doc]))(
    "has a working example for %s",
    (name, doc) => {
      expect(JSON.stringify(parseFormula(doc.example))).toContain(`"name":"${name}"`);
      const { workbook, value } = evaluateExample(doc.example);
      expect(isError(value), formatValue(value)).toBe(false);
      // An action example must also plan without an error, as it would on a click.
      if (isButton(value)) expect(workbook.planAction(value.action)).toMatchObject({ ok: true });
      else expect(doc.category).not.toBe("Actions");
    },
  );

  it.each([
    ["SUM", 16],
    ["AVERAGE", 2],
    ["COUNT", 3],
    ["COUNTA", 3],
    ["SUBTOTAL", 6],
    ["ROUND", 3.14],
    ["CLAMP", 10],
    ["IF", "small"],
    ["IFERROR", "no result"],
    ["AND", false],
    ["OR", true],
    ["CONCATENATE", "Total: 3"],
    ["TRIM", "two words"],
    ["COUNTIF", 2],
    ["COUNTIFS", 1],
    ["SUMIF", 4],
    ["SUMIFS", 3],
    ["AVERAGEIF", 2.5],
    ["MEDIAN", 2.5],
    ["LOOKUP", "banana"],
    ["VLOOKUP", "banana"],
    ["XLOOKUP", 3],
    ["XYLOOKUP", "banana"],
    ["HLOOKUP", "banana"],
    ["MATCH", 2],
    ["RANGE_CONTAINS", true],
    ["INDEX", "cherry"],
    ["TEXTJOIN", "apple, banana, cherry"],
    ["SWITCH", "two"],
    ["IFS", "small"],
    ["ISBLANK", true],
    ["LET", 12],
    ["LAMBDA", 6],
  ])("the %s example gives %j", (name, expected) => {
    const doc = functionDocs.find((candidate) => candidate.name === name);
    expect(evaluateExample(doc!.example).value).toBe(expected);
  });
});

describe("array examples", () => {
  it.each([
    ["FILTER", [["banana"], ["cherry"]]],
    ["FILTER_COLUMNS", [["apple"], ["banana"], ["cherry"]]],
    [
      "SORT",
      [
        [3, "cherry"],
        [2, "banana"],
        [1, "apple"],
      ],
    ],
    ["UNIQUE", [[5], [6]]],
    [
      "SEQUENCE",
      [
        [10, 10.5, 11],
        [11.5, 12, 12.5],
      ],
    ],
    ["TRANSPOSE", [[1, 2, 3]]],
    [
      "TAKE",
      [
        [3, "cherry"],
        [2, "banana"],
      ],
    ],
    ["ARRAY_CONSTRAIN", [[1], [2]]],
    ["DROP", [["banana"], ["cherry"]]],
    ["MAP", [["APPLE"], ["BANANA"], ["CHERRY"]]],
    ["REDUCE", [[6]]],
    ["BYROW", [[1], [2], [3]]],
    ["BYCOL", [[3, 3]]],
  ])("the %s example gives %j", (name, expected) => {
    const doc = functionDocs.find((candidate) => candidate.name === name);
    const { workbook } = evaluateExample(doc!.example);
    expect(workbook.getArray(at("Z99"))).toEqual(expected);
  });
});

describe("errorDocs", () => {
  it("explains every error code in a sentence", () => {
    for (const [code, explanation] of Object.entries(errorDocs)) {
      expect(ERROR_CODES).toContain(code);
      expect(explanation).toMatch(/^[A-Z].+\.$/);
    }
  });
});
