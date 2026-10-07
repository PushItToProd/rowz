import { describe, expect, it } from "vitest";
import {
  error,
  formatValue,
  isFormulaInput,
  literalInput,
  parseLiteralInput,
  toBoolean,
  toNumber,
  toText,
  type ActionValue,
  type Scalar,
} from "./values";

const action: ActionValue = {
  kind: "action",
  name: "SEND_EMAIL",
  args: [],
  origin: { tableId: "t", row: 0, col: 0 },
};

describe("parseLiteralInput", () => {
  it.each<[string, Scalar]>([
    ["", null],
    ["42", 42],
    [" 42 ", 42],
    ["-1.5", -1.5],
    ["+3", 3],
    ["1e3", 1000],
    [".5", 0.5],
    ["true", true],
    ["FALSE", false],
    ["hello", "hello"],
    ["12 apples", "12 apples"],
    ["1e999", "1e999"],
    ["0x10", "0x10"],
    ["'42", "42"],
    ["'=A1", "=A1"],
    ["'", ""],
    ["=", "="],
  ])("reads %j as %j", (input, value) => {
    expect(parseLiteralInput(input)).toBe(value);
  });
});

describe("isFormulaInput", () => {
  it.each([
    ["=A1", true],
    ["=1", true],
    ["=", false],
    ["A1", false],
    [" =A1", false],
    ["'=A1", false],
  ])("%j -> %s", (input, expected) => {
    expect(isFormulaInput(input)).toBe(expected);
  });
});

describe("literalInput", () => {
  it.each<[Scalar, string]>([
    [null, ""],
    [3, "3"],
    [-0.5, "-0.5"],
    [true, "TRUE"],
    [false, "FALSE"],
    ["hello", "hello"],
    ["42", "'42"],
    ["true", "'true"],
    ["=A1", "'=A1"],
    ["'quoted", "''quoted"],
  ])("stores %j as %j", (value, input) => {
    expect(literalInput(value)).toBe(input);
  });

  it("produces an input that reads back as the same value and never as a formula", () => {
    let seed = 0x6d2b79f5;
    const next = (): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const nextInteger = (limit: number): number => Math.floor(next() * limit);
    const specialCharacters = ["\n", "\r", "\t", "\0", "\\", "'", '"', "\u2028", "\u2029"];
    const randomUnicodeString = (): string => {
      const length = nextInteger(24) + 1;
      let text = "";
      for (let index = 0; index < length; index += 1) {
        if (next() < 0.35) {
          text += specialCharacters[nextInteger(specialCharacters.length)]!;
          continue;
        }
        const codePoint = nextInteger(0x11_0000);
        text += String.fromCodePoint(codePoint);
      }
      return text;
    };
    const values: Scalar[] = [
      "hello",
      "42",
      "true",
      "=A1",
      "2026-09-30",
      "'quoted",
      "line\nbreak",
      'back\\slash and "quotes"',
      "Ω😀",
      0,
      -1,
      0.1,
      Number.MAX_VALUE,
      Number.MIN_VALUE,
      true,
      false,
    ];

    for (let sample = 0; sample < 300; sample += 1) {
      if (sample % 3 === 0) {
        values.push(randomUnicodeString());
      } else if (sample % 3 === 1) {
        const sign = nextInteger(2) === 0 ? -1 : 1;
        values.push((sign * (nextInteger(1_000_000) + 1)) / (nextInteger(10_000) + 1));
      } else {
        values.push(nextInteger(2) === 0);
      }
    }

    for (const value of values) {
      const input = literalInput(value);
      expect(isFormulaInput(input)).toBe(false);
      expect(parseLiteralInput(input)).toBe(value);
    }
  });
});

describe("conversions", () => {
  it.each<[Scalar, number]>([
    [5, 5],
    [true, 1],
    [false, 0],
    [null, 0],
    ["2.5", 2.5],
  ])("toNumber(%j) is %j", (value, expected) => {
    expect(toNumber(value)).toBe(expected);
  });

  it("toNumber rejects text that is not a number", () => {
    expect(toNumber("abc")).toMatchObject({ kind: "error", code: "#VALUE!" });
    expect(toNumber("")).toMatchObject({ kind: "error", code: "#VALUE!" });
  });

  it.each<[Scalar, string]>([
    [5, "5"],
    [0.1 + 0.2, "0.3"],
    [true, "TRUE"],
    [false, "FALSE"],
    [null, ""],
    ["x", "x"],
  ])("toText(%j) is %j", (value, expected) => {
    expect(toText(value)).toBe(expected);
  });

  it.each<[Scalar, boolean]>([
    [true, true],
    [0, false],
    [-2, true],
    [null, false],
    ["true", true],
    [" FALSE ", false],
  ])("toBoolean(%j) is %j", (value, expected) => {
    expect(toBoolean(value)).toBe(expected);
  });

  it("toBoolean rejects other text", () => {
    expect(toBoolean("yes")).toMatchObject({ kind: "error", code: "#VALUE!" });
  });
});

describe("formatValue", () => {
  it("shows an error as its code", () => {
    expect(formatValue(error("#DIV/0!", "Division by zero"))).toBe("#DIV/0!");
  });

  it("shows an action as its function name and a button as its label", () => {
    expect(formatValue(action)).toBe("SEND_EMAIL");
    expect(formatValue({ kind: "button", label: "Send", action })).toBe("Send");
  });

  it("shows scalars as text", () => {
    expect(formatValue(1234.5)).toBe("1234.5");
    expect(formatValue(null)).toBe("");
  });

  it.each<[number, string]>([
    [0.1 + 0.2, "0.3"],
    [-0.1 - 0.2, "-0.3"],
    [1.234567890123456e100, "1.23456789012346e+100"],
    [1.234567890123456e-100, "1.23456789012346e-100"],
    [9007199254740992, "9007199254740990"],
    [-0, "0"],
  ])("shows %s as %s", (value, expected) => {
    expect(formatValue(value)).toBe(expected);
  });
});

describe("error", () => {
  it("omits the message when none is given", () => {
    expect(error("#REF!")).toEqual({ kind: "error", code: "#REF!" });
    expect(Object.keys(error("#REF!"))).not.toContain("message");
  });
});
