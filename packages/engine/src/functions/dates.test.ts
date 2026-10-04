import { describe, expect, it } from "vitest";
import { formatValue, type CellValue } from "../values";
import { at, STRUCTURE } from "../testing";
import { Workbook } from "../workbook";

// A Wednesday afternoon, as the clock a workbook is given.
const NOW = Date.UTC(2026, 8, 30, 14, 5, 9, 500);

function evaluate(formula: string, cells: Record<string, string> = {}): CellValue {
  const workbook = new Workbook({ now: () => NOW });
  workbook.setStructure(STRUCTURE);
  for (const [address, input] of Object.entries(cells)) workbook.setCell(at(address), input);
  workbook.setCell(at("Z99"), formula);
  return workbook.getValue(at("Z99"));
}

/** The text a cell would show for a formula's result. */
function shown(formula: string, cells: Record<string, string> = {}): string {
  return formatValue(evaluate(formula, cells));
}

function shownArray(formula: string): string[][] {
  const workbook = new Workbook({ now: () => NOW });
  workbook.setStructure(STRUCTURE);
  workbook.setCell(at("Z99"), formula);
  return workbook.getArray(at("Z99")).map((row) => row.map(formatValue));
}

describe("typed dates", () => {
  it("reads a typed date as a date, and keeps other text as text", () => {
    expect(evaluate("=ISDATE(A1)", { A1: "2026-09-30" })).toBe(true);
    expect(evaluate("=ISDATE(A1)", { A1: "2026-09-30 08:15" })).toBe(true);
    expect(evaluate("=ISDATE(A1)", { A1: "09/30/2026" })).toBe(false);
    expect(evaluate("=ISDATE(A1)", { A1: "'2026-09-30" })).toBe(false);
    expect(evaluate("=ISTEXT(A1)", { A1: "'2026-09-30" })).toBe(true);
    expect(evaluate("=ISNUMBER(A1)", { A1: "2026-09-30" })).toBe(false);
  });

  it("shows a date as it is typed", () => {
    expect(shown("=A1", { A1: "2026-09-30" })).toBe("2026-09-30");
    expect(shown("=A1", { A1: "2026-09-30T08:15" })).toBe("2026-09-30 08:15");
  });
});

describe("date arithmetic", () => {
  const cells = { A1: "2026-09-30", A2: "2026-10-02 12:00", A3: "2026-01-01" };

  it.each([
    ["=A1 + 1", "2026-10-01"],
    ["=1 + A1", "2026-10-01"],
    ["=A1 - 30", "2026-08-31"],
    ["=A1 + 0.5", "2026-09-30 12:00"],
    ["=A2 - A1", "2.5"],
    ["=A1 - A3", "272"],
    ["=A1 + 366", "2027-10-01"],
    ['=A1 & " is the day"', "2026-09-30 is the day"],
  ])("%s shows %s", (formula, expected) => {
    expect(shown(formula, cells)).toBe(expected);
  });

  it.each([
    ["=A1 < A2", true],
    ["=A1 = A1", true],
    ["=A1 > A2", false],
    ["=A1 <> A3", true],
    ["=A1 > 999999", true],
    ['=A1 < "text"', true],
    ["=MAX(A1 - A3, 0) > 200", true],
    ["=MAX(A1:A3) = A2", true],
    ["=MIN(A1:A3) = A3", true],
    ["=MIN(A1, A2) = A1", true],
    ["=ISDATE(MAX(A1:A3))", true],
    ['=TEXT(A1, "mmm d, yyyy")', "Sep 30, 2026"],
    ['=TEXT(A2, "dddd h:mm AM/PM")', "Friday 12:00 PM"],
    ['=TEXT(MAX(A1:A3), "yyyy-mm-dd")', "2026-10-02"],
  ])("%s is %j", (formula, expected) => {
    expect(evaluate(formula, cells)).toBe(expected);
  });

  it.each([
    ["=A1 + A2", "#VALUE!"],
    ["=IF(A1, 1, 2)", "#VALUE!"],
    ['=A1 + "x"', "#VALUE!"],
    ["=MAX(A1:A3, 5)", "#VALUE!"],
    ["=MIN(A1, 5)", "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expect(evaluate(formula, cells)).toMatchObject({ kind: "error", code });
  });

  it("treats a date as its day count for other arithmetic", () => {
    expect(evaluate("=A2 * 1 - A1 * 1", cells)).toBe(2.5);
    expect(evaluate("=INT(A1 - A3)", cells)).toBe(272);
  });

  it("sorts, filters, and matches dates", () => {
    const workbook = new Workbook({ now: () => NOW });
    workbook.setStructure(STRUCTURE);
    const inputs = { A1: "2026-03-01", A2: "2025-12-31", A3: "2026-03-01", A4: "2026-01-15" };
    for (const [address, input] of Object.entries(inputs)) workbook.setCell(at(address), input);
    workbook.setCell(at("C1"), "=SORT(UNIQUE(A1:A4))");
    workbook.setCell(at("E1"), '=COUNTIF(A1:A4, ">2026-01-01")');
    workbook.setCell(at("E2"), "=COUNTIF(A1:A4, A1)");
    workbook.setCell(at("E3"), "=MATCH(DATE(2026, 1, 15), A1:A4, 0)");
    workbook.setCell(at("E4"), "=FILTER(A1:A4, A1:A4 < DATE(2026, 1, 1))");
    expect(workbook.getArray(at("C1")).flat().map(formatValue)).toEqual([
      "2025-12-31",
      "2026-01-15",
      "2026-03-01",
    ]);
    expect(workbook.getValue(at("E1"))).toBe(3);
    expect(workbook.getValue(at("E2"))).toBe(2);
    expect(workbook.getValue(at("E3"))).toBe(4);
    expect(formatValue(workbook.getValue(at("E4")))).toBe("2025-12-31");
  });
});

describe("date functions", () => {
  it.each([
    ["=TODAY()", "2026-09-30"],
    ["=NOW()", "2026-09-30 14:05:09"],
    ["=TODAY() + 7", "2026-10-07"],
    ["=DATE(2026, 9, 30)", "2026-09-30"],
    ["=DATE(2026, 14, 1)", "2027-02-01"],
    ["=DATE(2026, 3, 0)", "2026-02-28"],
    ['=DATEVALUE("2026-09-30")', "2026-09-30"],
    ["=YEAR(A1)", "2026"],
    ["=MONTH(A1)", "9"],
    ["=DAY(A1)", "30"],
    ["=HOUR(A1)", "8"],
    ["=MINUTE(A1)", "15"],
    ["=SECOND(A1)", "42"],
    ["=WEEKDAY(A1)", "4"],
    ['=YEAR("2024-02-29")', "2024"],
    ['=DAYS("2026-10-02", A1)', "2"],
    ['=DAYS(A1, "2026-10-02 23:00")', "-2"],
    ["=DAYS(TODAY(), A1)", "0"],
    ["=EDATE(A1, 1)", "2026-10-30 08:15:42"],
    ['=EDATE("2026-01-31", 1)', "2026-02-28"],
    ['=EDATE("2024-01-31", 1)', "2024-02-29"],
    ['=EDATE("2026-03-31", -1)', "2026-02-28"],
    ['=EDATE("2026-11-15", 3)', "2027-02-15"],
    ["=EOMONTH(A1, 0)", "2026-09-30"],
    ['=EOMONTH("2026-01-15", 1)', "2026-02-28"],
    ['=EOMONTH("2026-12-15", 0)', "2026-12-31"],
    ["=ISDATE(TODAY())", "TRUE"],
    ["=ISDATE(1)", "FALSE"],
  ])("%s shows %s", (formula, expected) => {
    expect(shown(formula, { A1: "2026-09-30 08:15:42" })).toBe(expected);
  });

  it.each([
    ['=YEAR("soon")', "#VALUE!", "soon is not a date"],
    ["=YEAR(B9)", "#VALUE!", "An empty cell is not a date"],
    ["=MONTH(12)", "#VALUE!", "12 is not a date"],
    ['=DATEVALUE("09/30/2026")', "#VALUE!", "09/30/2026 is not a date"],
    ['=DATE("x", 1, 1)', "#VALUE!", '"x" is not a number'],
    ["=TODAY(1)", "#ERROR!", "TODAY takes 0 arguments"],
    ["=DAYS(A1)", "#ERROR!", "DAYS takes 2 arguments"],
  ])("%s is %s: %s", (formula, code, message) => {
    expect(evaluate(formula, { A1: "2026-09-30" })).toEqual({ kind: "error", code, message });
  });

  it("uses this machine's local time when no clock is given", () => {
    const workbook = new Workbook();
    workbook.setStructure(STRUCTURE);
    workbook.setCell(at("A1"), "=YEAR(TODAY())");
    expect(workbook.getValue(at("A1"))).toBe(new Date().getFullYear());
  });

  it("computes year fractions with spreadsheet day-count conventions", () => {
    expect(evaluate("=YEARFRAC(DATE(2026, 1, 1), DATE(2026, 7, 1))")).toBe(0.5);
    expect(evaluate("=YEARFRAC(DATE(2024, 1, 1), DATE(2025, 1, 1), 1)")).toBe(1);
    expect(evaluate("=YEARFRAC(DATE(2024, 1, 1), DATE(2025, 1, 1), 2)")).toBe(366 / 360);
    expect(evaluate("=YEARFRAC(DATE(2024, 1, 1), DATE(2025, 1, 1), 3)")).toBe(366 / 365);
    expect(evaluate("=YEARFRAC(DATE(2026, 1, 30), DATE(2026, 2, 28), 4)")).toBe(28 / 360);
    expect(evaluate("=YEARFRAC(DATE(2026, 7, 1), DATE(2026, 1, 1))")).toBe(-0.5);
    expect(evaluate('=YEARFRAC("2026-01-01", "2026-01-01 23:00")')).toBe(0);
    expect(evaluate("=YEARFRAC(DATE(2026, 1, 1), DATE(2026, 2, 1), 5)")).toMatchObject({
      kind: "error",
      code: "#VALUE!",
    });
  });

  it("reads time text as a fraction of a day", () => {
    expect(evaluate('=TIMEVALUE("14:05:09")')).toBe((14 * 3600 + 5 * 60 + 9) / 86400);
    expect(evaluate('=TIMEVALUE("2:05 PM")')).toBe((14 * 3600 + 5 * 60) / 86400);
    expect(evaluate('=TIMEVALUE("12:00 AM")')).toBe(0);
    expect(evaluate('=TIMEVALUE("12:00 PM")')).toBe(0.5);
    expect(evaluate('=TIMEVALUE("25:00")')).toMatchObject({ kind: "error", code: "#VALUE!" });
  });

  it("converts spreadsheet serial dates and Unix timestamps", () => {
    expect(shown("=TO_DATE(0)")).toBe("1899-12-30");
    expect(shown("=TO_DATE(1.5)")).toBe("1899-12-31 12:00");
    expect(evaluate('=UNIXTIME("1970-01-01 00:01:30")')).toBe(90);
    expect(shown("=UNIX2DATE(0)")).toBe("1970-01-01");
    expect(shown("=UNIX2DATE(86400)")).toBe("1970-01-02");
    expect(shown("=UNIX2DATE(-1)")).toBe("1969-12-31 23:59:59");
  });

  it("returns date intervals as inclusive start and end cells", () => {
    expect(shownArray("=DATEINTERVAL(DATE(2026, 9, 1), DATE(2026, 9, 30))")).toEqual([
      ["2026-09-01", "2026-09-30"],
    ]);
    expect(shownArray("=LASTXDAYS(7)")).toEqual([["2026-09-24", "2026-09-30"]]);
    expect(shownArray("=LASTXWEEKS(2)")).toEqual([["2026-09-17", "2026-09-30"]]);
    expect(shownArray("=LASTXMONTHS(1)")).toEqual([["2026-08-31", "2026-09-30"]]);
    expect(evaluate("=LASTXDAYS(0)")).toMatchObject({ kind: "error", code: "#VALUE!" });
  });

  it("uses the workbook clock for relative date ranges", () => {
    const workbook = new Workbook({ now: () => Date.UTC(2027, 0, 1, 23) });
    workbook.setStructure(STRUCTURE);
    workbook.setCell(at("A1"), "=LASTXDAYS(2)");
    expect(workbook.getArray(at("A1")).map((row) => row.map(formatValue))).toEqual([
      ["2026-12-31", "2027-01-01"],
    ]);
  });
});

describe("dates written by actions", () => {
  it("writes a date so that it reads back as the same date", () => {
    const workbook = new Workbook({ now: () => NOW });
    workbook.setStructure(STRUCTURE);
    workbook.setCell(at("A1"), '=BUTTON("Stamp", APPEND_ROW(C:D, NOW(), TODAY() + 1))');
    const button = workbook.getValue(at("A1"));
    if (typeof button !== "object" || button?.kind !== "button") throw new Error("not a button");
    expect(workbook.planAction(button.action)).toMatchObject({
      ok: true,
      effects: [{}, { input: "2026-09-30 14:05:09" }, { input: "2026-10-01" }],
    });
  });

  it("writes text that looks like a date with the text prefix", () => {
    const workbook = new Workbook();
    workbook.setStructure(STRUCTURE);
    workbook.setCell(at("A1"), "'2026-09-30");
    workbook.setCell(at("B1"), '=BUTTON("Copy", EXECUTE(A1, C1))');
    const button = workbook.getValue(at("B1"));
    if (typeof button !== "object" || button?.kind !== "button") throw new Error("not a button");
    expect(workbook.planAction(button.action)).toMatchObject({
      effects: [{ input: "'2026-09-30" }],
    });
  });
});

describe("working with spans of dates", () => {
  // 2026-09-30 is a Wednesday.
  const cells = { A1: "2026-09-30", A2: "2024-01-15", A3: "2026-10-02", A4: "not a date" };

  it.each<[string, CellValue]>([
    ['=DATEDIF(A2, A1, "Y")', 2],
    ['=DATEDIF(A2, A1, "M")', 32],
    ['=DATEDIF(A2, A1, "D")', 989],
    ['=DATEDIF(A2, A1, "YM")', 8],
    ['=DATEDIF(A2, A1, "MD")', 15],
    ['=DATEDIF(A2, A1, "y")', 2],
    ['=DATEDIF(A1, A1, "D")', 0],
    ['=DATEDIF("2024-01-31", "2024-02-29", "M")', 1],
    ['=DATEDIF("2024-01-31", "2024-02-28", "M")', 0],
    ['=DATEDIF("2024-02-29", "2025-02-28", "Y")', 1],
    ["=WEEKNUM(DATE(2026, 1, 1))", 1],
    ["=WEEKNUM(DATE(2026, 1, 3))", 1],
    ["=WEEKNUM(DATE(2026, 1, 4))", 2],
    ["=WEEKNUM(A1)", 40],
    ["=ISOWEEKNUM(A1)", 40],
    ["=ISOWEEKNUM(DATE(2026, 1, 1))", 1],
    ["=ISOWEEKNUM(DATE(2027, 1, 1))", 53],
    ["=ISOWEEKNUM(DATE(2024, 12, 30))", 1],
    ["=ISOWEEKNUM(DATE(2023, 1, 1))", 52],
    ["=NETWORKDAYS(A1, A3)", 3],
    ["=NETWORKDAYS(A3, A1)", -3],
    ["=NETWORKDAYS(DATE(2026, 9, 1), A1)", 22],
    ["=NETWORKDAYS(A1, A3, A3)", 2],
    ["=NETWORKDAYS(A1, A3, A1:A4)", 1],
    ["=NETWORKDAYS(DATE(2026, 10, 3), DATE(2026, 10, 4))", 0],
    ["=TIME(12, 0, 0)", 0.5],
    ["=TIME(0, 30, 0) * 48", 1],
  ])("%s is %j", (formula, expected) => {
    expect(evaluate(formula, cells)).toBe(expected);
  });

  it.each([
    ["=WORKDAY(A1, 1)", "2026-10-01"],
    ["=WORKDAY(A1, 3)", "2026-10-05"],
    ["=WORKDAY(A1, 5)", "2026-10-07"],
    ["=WORKDAY(A1, 0)", "2026-09-30"],
    ["=WORKDAY(A1, -3)", "2026-09-25"],
    ["=WORKDAY(A1, 3, A3)", "2026-10-06"],
    ["=WORKDAY(DATE(2026, 10, 3), 1)", "2026-10-05"],
    ["=A1 + TIME(14, 30, 0)", "2026-09-30 14:30"],
  ])("%s shows %s", (formula, expected) => {
    expect(shown(formula, cells)).toBe(expected);
  });

  it.each([
    ['=DATEDIF(A1, A2, "D")', "#VALUE!"],
    ['=DATEDIF(A2, A1, "W")', "#VALUE!"],
    ['=DATEDIF(A4, A1, "D")', "#VALUE!"],
    ["=WORKDAY(A1, 1000000)", "#VALUE!"],
    ["=WEEKNUM(A4)", "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expect(evaluate(formula, cells)).toMatchObject({ kind: "error", code });
  });
});
