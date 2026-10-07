import { describe, expect, it } from "vitest";
import {
  roundDecimal,
  roundDecimalToFixed,
  roundToMultiple,
  roundToNearestMultiple,
  type RoundingMode,
} from "./rounding";

describe("roundDecimal", () => {
  it.each<[number, number, "halfAwayFromZero", number]>([
    [1.005, 2, "halfAwayFromZero", 1.01],
    [2.675, 2, "halfAwayFromZero", 2.68],
    [1.015, 2, "halfAwayFromZero", 1.02],
    [-1.005, 2, "halfAwayFromZero", -1.01],
    [0.285, 2, "halfAwayFromZero", 0.29],
    [1.45, 1, "halfAwayFromZero", 1.5],
    [1234.5678, -2, "halfAwayFromZero", 1200],
    [0.5, 0, "halfAwayFromZero", 1],
    [-0.5, 0, "halfAwayFromZero", -1],
    [5e-324, 323, "halfAwayFromZero", 1e-323],
    [5e-324, 324, "halfAwayFromZero", 5e-324],
    [1e21, -20, "halfAwayFromZero", 1e21],
    [1.23e21, -20, "halfAwayFromZero", 1.2e21],
    [1e308, 0, "halfAwayFromZero", 1e308],
    [1.234, 20, "halfAwayFromZero", 1.234],
  ])("rounds %s to %s places as %s", (value, places, mode, expected) => {
    expect(roundDecimal(value, places, mode)).toBe(expected);
  });

  it("uses the decimal expansion of exponent notation", () => {
    expect(roundDecimal(1e-7, 8, "halfAwayFromZero")).toBe(1e-7);
    expect(roundDecimal(1.5e-7, 7, "halfAwayFromZero")).toBe(2e-7);
    expect(roundDecimal(1.5e21, -20, "halfAwayFromZero")).toBe(1.5e21);
  });

  it("rounds away from zero or cuts toward zero at decimal places", () => {
    expect(roundDecimal(1.005, 2, "awayFromZero")).toBe(1.01);
    expect(roundDecimal(-1.005, 2, "awayFromZero")).toBe(-1.01);
    expect(roundDecimal(1.005, 2, "towardZero")).toBe(1);
    expect(roundDecimal(-1.005, 2, "towardZero")).toBe(-1);
    expect(roundDecimal(5e-324, 323, "towardZero")).toBe(0);
    expect(roundDecimal(5e-324, 323, "awayFromZero")).toBe(1e-323);
  });

  it("preserves a negative zero result", () => {
    expect(Object.is(roundDecimal(-0.1, 0, "towardZero"), -0)).toBe(true);
    expect(Object.is(roundDecimal(-5e-324, 323, "halfAwayFromZero"), -1e-323)).toBe(true);
  });
});

describe("roundDecimalToFixed", () => {
  it.each<[number, number, RoundingMode, number, string]>([
    [1.005, 2, "halfAwayFromZero", 0, "1.01"],
    [1.2, 2, "halfAwayFromZero", 0, "1.20"],
    [-1.005, 2, "halfAwayFromZero", 0, "-1.01"],
    [1.005, 2, "halfAwayFromZero", 2, "100.50"],
    [1e21, 2, "halfAwayFromZero", 0, "1000000000000000000000.00"],
    [5e-324, 2, "halfAwayFromZero", 0, "0.00"],
  ])("writes %s with %s places and decimal scale %s", (value, places, mode, power, expected) => {
    expect(roundDecimalToFixed(value, places, mode, power)).toBe(expected);
  });
});

describe("roundToMultiple", () => {
  it("uses decimal arithmetic for floor and ceiling multiples", () => {
    expect(roundToMultiple(0.3, 0.1, "floor")).toBe(0.3);
    expect(roundToMultiple(0.3, 0.1, "ceil")).toBe(0.3);
    expect(roundToMultiple(0.29, 0.1, "floor")).toBe(0.2);
    expect(roundToMultiple(0.29, 0.1, "ceil")).toBe(0.3);
    expect(roundToMultiple(-0.29, 0.1, "floor")).toBe(-0.3);
    expect(roundToMultiple(-0.29, 0.1, "ceil")).toBe(-0.2);
  });
});

describe("roundToNearestMultiple", () => {
  it("uses decimal arithmetic and rounds half away from zero", () => {
    expect(roundToNearestMultiple(0.3, 0.1)).toBe(0.3);
    expect(roundToNearestMultiple(0.25, 0.1)).toBe(0.3);
    expect(roundToNearestMultiple(-0.25, 0.1)).toBe(-0.3);
  });
});
