import { describe, expect, it } from "vitest";
import { dateFromParts, dateParts, formatDate, isDate, parseDate, startOfDay } from "./dates";

describe("parseDate and formatDate", () => {
  it.each([
    ["2026-09-30", "2026-09-30"],
    ["2026-09-30 14:05", "2026-09-30 14:05"],
    ["2026-09-30T14:05:09", "2026-09-30 14:05:09"],
    ["  2026-09-30  ", "2026-09-30"],
    ["2024-02-29", "2024-02-29"],
    ["2026-09-30 00:00", "2026-09-30"],
    ["2026-09-30 00:00:05", "2026-09-30 00:00:05"],
    ["0099-01-01", "0099-01-01"],
    ["1969-12-31 23:59:59", "1969-12-31 23:59:59"],
  ])("reads %j and writes it as %j", (text, written) => {
    const value = parseDate(text);
    expect(value && formatDate(value)).toBe(written);
  });

  it.each([
    "2026-02-30",
    "2025-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-09-31",
    "2026-09-30 24:00",
    "2026-09-30 12:60",
    "2026-9-30",
    "09/30/2026",
    "30.09.2026",
    "2026-09",
    "2026-09-30 14",
    "tomorrow",
    "",
  ])("does not read %j as a date", (text) => {
    expect(parseDate(text)).toBeUndefined();
  });

  it("reads back every date it writes", () => {
    let seed = 0x4d595df4;
    const nextInteger = (limit: number): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % limit;
    };

    for (let sample = 0; sample < 500; sample += 1) {
      const year = nextInteger(9999) + 1;
      const month = nextInteger(12) + 1;
      const day = nextInteger(28) + 1;
      const seconds = nextInteger(86_400);
      const value = dateFromParts(year, month, day, 0, 0, seconds);
      expect(parseDate(formatDate(value))).toEqual(value);
    }
  });
});

describe("date parts", () => {
  it("splits a date into its calendar parts", () => {
    expect(dateParts(parseDate("2026-09-30 14:05:09")!)).toEqual({
      year: 2026,
      month: 9,
      day: 30,
      hour: 14,
      minute: 5,
      second: 9,
      weekday: 4,
    });
  });

  it("carries parts outside their range into the next unit", () => {
    expect(formatDate(dateFromParts(2026, 13, 1))).toBe("2027-01-01");
    expect(formatDate(dateFromParts(2026, 3, 0))).toBe("2026-02-28");
    expect(formatDate(dateFromParts(2026, 1, 32))).toBe("2026-02-01");
    expect(formatDate(dateFromParts(2026, 1, 1, 25))).toBe("2026-01-02 01:00");
  });

  it("removes the time of day", () => {
    expect(formatDate(startOfDay(parseDate("2026-09-30 23:59:59")!))).toBe("2026-09-30");
    expect(formatDate(startOfDay(parseDate("1969-12-31 00:00:01")!))).toBe("1969-12-31");
  });

  it("recognizes a date value", () => {
    expect(isDate(parseDate("2026-01-01"))).toBe(true);
    expect(isDate({ kind: "error" })).toBe(false);
    expect(isDate("2026-01-01")).toBe(false);
    expect(isDate(null)).toBe(false);
  });
});
