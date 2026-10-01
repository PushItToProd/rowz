import { describe, expect, it } from "vitest";
import { FormulaSyntaxError, tokenize } from "./tokenizer";

/** Token types and values without positions, and without the trailing `end` token. */
function summarize(text: string): unknown[] {
  return tokenize(text)
    .filter((token) => token.type !== "end")
    .map((token) => [token.type, "value" in token ? token.value : undefined]);
}

describe("tokenize", () => {
  it.each([
    ["42", 42],
    ["3.14", 3.14],
    [".5", 0.5],
    ["5.", 5],
    ["1e3", 1000],
    ["1.5E-2", 0.015],
    ["2e+2", 200],
  ])("reads the number %s", (text, value) => {
    expect(summarize(text)).toEqual([["number", value]]);
  });

  it("reads strings, with doubled quotes as one quote", () => {
    expect(summarize('"say ""hi"""')).toEqual([["string", 'say "hi"']]);
    expect(summarize('""')).toEqual([["string", ""]]);
  });

  it("reads quoted names, with doubled apostrophes as one apostrophe", () => {
    expect(summarize("'Joe''s Table'")).toEqual([["quotedName", "Joe's Table"]]);
  });

  it("reads identifiers including absolute cell addresses", () => {
    expect(summarize("SUM $A$1 my_name TRUE")).toEqual([
      ["identifier", "SUM"],
      ["identifier", "$A$1"],
      ["identifier", "my_name"],
      ["identifier", "TRUE"],
    ]);
  });

  it("reads two-character operators before one-character ones", () => {
    expect(summarize("<= >= <> < > =")).toEqual([
      ["operator", "<="],
      ["operator", ">="],
      ["operator", "<>"],
      ["operator", "<"],
      ["operator", ">"],
      ["operator", "="],
    ]);
  });

  it("reads a whole formula and records positions", () => {
    const tokens = tokenize('SUM(A1:B2, 3) & "x"');
    expect(tokens.map((token) => token.type)).toEqual([
      "identifier",
      "punctuation",
      "identifier",
      "punctuation",
      "identifier",
      "punctuation",
      "number",
      "punctuation",
      "operator",
      "string",
      "end",
    ]);
    expect(tokens.map((token) => token.position)).toEqual([0, 3, 4, 6, 7, 9, 11, 12, 14, 16, 19]);
  });

  it("records where each token ends", () => {
    expect(tokenize("'My Table'!A1 >= 10").map((token) => [token.position, token.end])).toEqual([
      [0, 10],
      [10, 11],
      [11, 13],
      [14, 16],
      [17, 19],
      [19, 19],
    ]);
  });

  it.each(["#DIV/0!", "#VALUE!", "#REF!", "#NAME?", "#CYCLE!", "#ERROR!"])(
    "reads the error literal %s",
    (code) => {
      expect(summarize(`1+${code}`)).toEqual([
        ["number", 1],
        ["operator", "+"],
        ["error", code],
      ]);
    },
  );

  it("returns only the end token for blank text", () => {
    expect(tokenize("  ")).toEqual([{ type: "end", position: 2, end: 2 }]);
  });

  it.each([
    ['"unterminated', 'Missing closing "', 0],
    ["'unterminated", "Missing closing '", 0],
    ["1 # 2", "Unexpected character #", 2],
    ["1e999", "Number out of range: 1e999", 0],
  ])("rejects %j", (text, message, position) => {
    const attempt = (): unknown => tokenize(text);
    expect(attempt).toThrow(FormulaSyntaxError);
    expect(attempt).toThrow(message);
    try {
      attempt();
    } catch (cause) {
      expect((cause as FormulaSyntaxError).position).toBe(position);
      expect((cause as FormulaSyntaxError).code).toBe("#ERROR!");
    }
  });
});
