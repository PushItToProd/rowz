import { describe, expect, it } from "vitest";
import { errorDocs, EXAMPLE_CELLS, functionDocs } from "./docs";
import { defaultFunctions } from "./functions";
import { parseFormula } from "./parser";
import { at, workbookWith } from "./testing";
import { formatValue, isButton, isError } from "./values";

function evaluateExample(example: string) {
  const workbook = workbookWith({ t1: { ...EXAMPLE_CELLS, Z99: `=${example}` } });
  return { workbook, value: workbook.getValue(at("Z99")) };
}

describe("functionDocs", () => {
  it("documents every function in the default registry, and nothing else", () => {
    expect(functionDocs.map((doc) => doc.name).sort()).toEqual([...defaultFunctions.keys()].sort());
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
    ["ROUND", 3.14],
    ["IF", "small"],
    ["IFERROR", "no result"],
    ["AND", false],
    ["OR", true],
    ["CONCATENATE", "Total: 3"],
    ["TRIM", "two words"],
  ])("the %s example gives %j", (name, expected) => {
    const doc = functionDocs.find((candidate) => candidate.name === name);
    expect(evaluateExample(doc!.example).value).toBe(expected);
  });
});

describe("errorDocs", () => {
  it("explains every error code in a sentence", () => {
    for (const [code, explanation] of Object.entries(errorDocs)) {
      expect(code).toMatch(/^#.+[!?]$/);
      expect(explanation).toMatch(/^[A-Z].+\.$/);
    }
  });
});
