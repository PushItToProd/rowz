import { describe, expect, it } from "vitest";
import { chartData } from "./charts";
import { parseDate } from "./dates";
import { at, STRUCTURE, workbookWith } from "./testing";
import { error, formatValue, isChart, type CellValue } from "./values";

describe("chartData", () => {
  it("reads the first column as labels and each other column as a series", () => {
    expect(
      chartData([
        ["apple", 5, 1.5],
        ["pear", 12, 0.5],
      ]),
    ).toEqual({
      labels: ["apple", "pear"],
      x: [null, null],
      series: [
        { name: "Series 1", values: [5, 12] },
        { name: "Series 2", values: [1.5, 0.5] },
      ],
    });
  });

  it("takes series names from a first row that holds no numbers", () => {
    expect(
      chartData([
        ["fruit", "sold", "price"],
        ["apple", 5, 1.5],
        ["pear", 12, 0.5],
      ]),
    ).toMatchObject({
      labels: ["apple", "pear"],
      series: [{ name: "sold" }, { name: "price" }],
    });
  });

  it("does not take a first row as names when it holds a number, or when nothing follows it", () => {
    expect(
      chartData([
        ["apple", 5],
        ["pear", 12],
      ]).labels,
    ).toEqual(["apple", "pear"]);
    expect(chartData([["fruit", "sold"]])).toMatchObject({
      labels: ["fruit"],
      series: [{ name: "Series 1", values: [null] }],
    });
    expect(
      chartData([
        ["fruit", "sold"],
        ["apple", "none"],
      ]).labels,
    ).toHaveLength(2);
  });

  it("reads a single column as one series labeled by position", () => {
    expect(chartData([[5], [12], [8]])).toEqual({
      labels: ["1", "2", "3"],
      x: [1, 2, 3],
      series: [{ name: "Series 1", values: [5, 12, 8] }],
    });
    expect(chartData([["sold"], [5], [12]])).toMatchObject({
      labels: ["1", "2"],
      series: [{ name: "sold", values: [5, 12] }],
    });
  });

  it("plots only numbers and dates, and leaves a gap for anything else", () => {
    const date = parseDate("1970-01-03");
    // A number comes first, so the first row is data and not series names.
    const cells: CellValue[] = [1, "text", null, true, error("#DIV/0!"), date ?? null, 7];
    expect(chartData(cells.map((cell, index) => [index, cell])).series[0]?.values).toEqual([
      1,
      null,
      null,
      null,
      null,
      2,
      7,
    ]);
  });

  it("gives the labels as numbers for a chart that places points along a number line", () => {
    const data = chartData([
      [1.5, 10],
      [parseDate("1970-01-11") ?? null, 20],
      ["later", 30],
    ]);
    expect(data.x).toEqual([1.5, 10, null]);
    expect(data.labels).toEqual(["1.5", "1970-01-11", "later"]);
  });

  it("reads no rows as no points", () => {
    expect(chartData([])).toEqual({
      labels: [],
      x: [],
      series: [{ name: "Series 1", values: [] }],
    });
  });
});

describe("chart functions", () => {
  it("describe a chart of the data without drawing anything", () => {
    const workbook = workbookWith({
      t1: { A1: "apple", B1: "5", A2: "pear", B2: "12", D1: '=BAR_CHART(A1:B2, "Fruit sold")' },
    });
    const value = workbook.getValue(at("D1"));
    expect(value).toEqual({
      kind: "chart",
      chart: "bar",
      title: "Fruit sold",
      rows: [
        ["apple", 5],
        ["pear", 12],
      ],
    });
    expect(isChart(value)).toBe(true);
    expect(formatValue(value)).toBe("Fruit sold");
  });

  it.each([
    ["=PIE_CHART(A1:B2)", "pie"],
    ["=LINE_CHART(A1:B2)", "line"],
    ["=SCATTER_CHART(A1:B2)", "scatter"],
    ["=BAR_CHART(7)", "bar"],
  ])("%s is a %s chart, named by its kind when it has no title", (formula, kind) => {
    const value = workbookWith({ t1: { D1: formula } }).getValue(at("D1"));
    expect(value).toMatchObject({ kind: "chart", chart: kind, title: "" });
    expect(formatValue(value)).toBe(`${kind} chart`);
  });

  it("fails when the data is an error", () => {
    expect(workbookWith({ t1: { D1: "=BAR_CHART(1/0)" } }).getValue(at("D1"))).toMatchObject({
      code: "#DIV/0!",
    });
  });

  it("follows the data", () => {
    const workbook = workbookWith({ t1: { A1: "1", D1: "=LINE_CHART(A1:A2)" } });
    workbook.setCell(at("A2"), "9");
    expect(workbook.getValue(at("D1"))).toMatchObject({ rows: [[1], [9]] });
  });
});

describe("evaluateOnPage", () => {
  const workbook = workbookWith({
    t1: { A1: "1", A2: "2" },
    t2: { A1: "10" },
    t3: { A1: "archived" },
  });

  it.each<[string, string, CellValue]>([
    ["p1", "=SUM(Table1!A1:A2)", 3],
    ["p1", "SUM(Table1!A1:A2) + 'Other Table'!A1", 13],
    ["p1", "Archive!Table1!A1", "archived"],
    ["p2", "Table1!A1", "archived"],
    ["p2", "='Page 1'!Table1!A2 * 2", 4],
    ["p1", "1 + 1", 2],
  ])("on page %s, %s is %j", (pageId, formula, expected) => {
    expect(workbook.evaluateOnPage(pageId, formula)).toBe(expected);
  });

  it.each([
    ["A1", "#REF!"],
    ["SUM(A1:A2)", "#REF!"],
    ["Missing!A1", "#REF!"],
    ["1 +", "#ERROR!"],
    ["nope", "#NAME?"],
  ])("%s is %s: a formula on a page must name the table it reads", (formula, code) => {
    expect(workbook.evaluateOnPage("p1", formula)).toMatchObject({ kind: "error", code });
  });

  it("gives a range as rows, and can use values passed by name", () => {
    expect(workbook.evaluateOnPage("p1", "Table1!A1:A2")).toEqual({
      kind: "range",
      rows: [[1], [2]],
    });
    expect(workbook.evaluateOnPage("p1", "price * 2 + Table1!A1", new Map([["price", 5]]))).toBe(
      11,
    );
  });

  it("sees cells an array formula filled", () => {
    const filled = workbookWith({ t1: { A1: "=SEQUENCE(3)" } });
    expect(filled.evaluateOnPage("p1", "SUM(Table1!A:A)")).toBe(6);
    expect(filled.evaluateOnPage(STRUCTURE.pages[0]?.id ?? "", "Table1!A3")).toBe(3);
  });
});
