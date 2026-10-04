import { describe, expect, it } from "vitest";
import { parseDate } from "./dates";
import { formatDateAs, FormatError, formatNumber } from "./format";

describe("formatNumber", () => {
  it.each<[number, string, string]>([
    [1234.5, "0", "1235"],
    [1234.5, "0.00", "1234.50"],
    [1234.567, "#,##0.00", "1,234.57"],
    [1234567, "#,##0", "1,234,567"],
    [999, "#,##0", "999"],
    [0.5, "0%", "50%"],
    [0.1234, "0.0%", "12.3%"],
    [5, "000", "005"],
    [1.5, "0.###", "1.5"],
    [1, "0.###", "1"],
    [1.23456, "0.###", "1.235"],
    [1.5, "0.0##", "1.5"],
    [1, "0.0##", "1.0"],
    [0.5, "#.00", ".50"],
    [0.5, ".00", ".50"],
    [0, "#", ""],
    [0, "0", "0"],
    [-1234.5, "#,##0.00", "-1,234.50"],
    [-0.001, "0.00", "0.00"],
    [2.5, "0", "3"],
    [-2.5, "0", "-3"],
    [42, "$0.00", "$42.00"],
    [-42, "$0.00", "-$42.00"],
    [42, '0 "items"', "42 items"],
    [42, '"No. "0', "No. 42"],
    [3, '"100% of "0', "100% of 3"],
    [12, '0 "kg (0.5 off)"', "12 kg (0.5 off)"],
    [1e21, "0", "1000000000000000000000"],
    [1e21, "#,##0.00", "1,000,000,000,000,000,000,000.00"],
    [1.2345678901234568e21, "#,##0.00", "1,234,567,890,123,456,800,000.00"],
    [999999999999999900000, "#,##0.00", "999,999,999,999,999,900,000.00"],
    [Number.MAX_SAFE_INTEGER + 1, "#,##0", "9,007,199,254,740,992"],
  ])("writes %d as %s: %s", (value, format, expected) => {
    expect(formatNumber(value, format)).toBe(expected);
  });

  it("refuses a format with nowhere to put the number", () => {
    expect(() => formatNumber(1, "abc")).toThrow(FormatError);
    expect(() => formatNumber(1, '"0"')).toThrow(FormatError);
  });
});

describe("formatDateAs", () => {
  const afternoon = parseDate("2026-03-04 15:07:09")!;
  const morning = parseDate("2026-12-25 00:30")!;

  it.each<[string, string]>([
    ["yyyy-mm-dd", "2026-03-04"],
    ["YYYY-MM-DD", "2026-03-04"],
    ["d/m/yy", "4/3/26"],
    ["mmm d, yyyy", "Mar 4, 2026"],
    ["dddd, mmmm d", "Wednesday, March 4"],
    ["ddd", "Wed"],
    ["hh:mm", "15:07"],
    ["h:mm:ss", "15:07:09"],
    ["mm:ss", "07:09"],
    ["h:mm AM/PM", "3:07 PM"],
    ["h:mm am/pm", "3:07 pm"],
    ["yyyy-mm-dd hh:mm", "2026-03-04 15:07"],
    ['"Due" mmm d', "Due Mar 4"],
    ['d "day of month" m', "4 day of month 3"],
  ])("writes a date as %s", (format, expected) => {
    expect(formatDateAs(afternoon, format)).toBe(expected);
  });

  it("writes midnight as 12 on a twelve-hour clock", () => {
    expect(formatDateAs(morning, "h:mm AM/PM")).toBe("12:30 AM");
    expect(formatDateAs(morning, "hh:mm")).toBe("00:30");
  });
});
