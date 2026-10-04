import { describe, expect, it } from "vitest";
import { at, workbookWith } from "../testing";
import type { CellValue } from "../values";

// Fruit, color, and quantity in A1:C5. Formulas go in a second table so their results have room.
const DATA = {
  A1: "banana",
  B1: "yellow",
  C1: "12",
  A2: "apple",
  B2: "red",
  C2: "5",
  A3: "cherry",
  B3: "red",
  C3: "40",
  A4: "Apple",
  B4: "green",
  C4: "8",
  A5: "date",
  B5: "brown",
  C5: "5",
};

function run(formula: string, data: Record<string, string> = DATA): CellValue[][] {
  const qualified = formula
    .replaceAll(/\b([A-Z]\d?)(?=[:),\s]|$)/g, "Table1!$1")
    .replaceAll(":Table1!", ":");
  const workbook = workbookWith({ t1: data, t2: { A1: qualified } });
  return workbook.getArray(at("A1", "t2"));
}

function expectError(
  formula: string,
  code: string,
  message?: string,
  data: Record<string, string> = DATA,
): void {
  const [[value]] = run(formula, data) as [[CellValue]];
  expect(value, formula).toMatchObject({ kind: "error", code });
  if (message !== undefined) expect(value).toMatchObject({ message });
}

describe("FILTER", () => {
  it("keeps the rows where the condition is true", () => {
    expect(run('=FILTER(A1:C5, B1:B5 = "red")')).toEqual([
      ["apple", "red", 5],
      ["cherry", "red", 40],
    ]);
  });

  it("keeps the rows that meet every condition", () => {
    expect(run('=FILTER(A1:A5, B1:B5 = "red", C1:C5 > 10)')).toEqual([["cherry"]]);
  });

  it("keeps columns when the condition is a row", () => {
    expect(run("=FILTER(A1:C2, A9:C9)", { ...DATA, A9: "TRUE", B9: "FALSE", C9: "TRUE" })).toEqual([
      ["banana", 12],
      ["apple", 5],
    ]);
  });

  it("treats an empty condition cell as false", () => {
    expect(run("=FILTER(A1:A3, D1:D3)", { ...DATA, D2: "TRUE" })).toEqual([["apple"]]);
  });

  it.each([
    ['=FILTER(A1:C5, B1:B5 = "blue")', "#N/A", "Nothing matches"],
    [
      "=FILTER(A1:C5, B1:B4 = 1)",
      "#VALUE!",
      "A condition must be one column as tall as the range, or one row as wide",
    ],
    ["=FILTER(A1:C5, A1:C5)", "#VALUE!", undefined],
    ["=FILTER(A1:A5, A1:A5)", "#VALUE!", '"banana" is not TRUE or FALSE'],
    ["=FILTER(A1:A5, 1/0)", "#DIV/0!", undefined],
  ])("%s is %s", (formula, code, message) => {
    expectError(formula, code, message);
  });
});

describe("FILTER_COLUMNS", () => {
  it("keeps the columns where every condition row is true", () => {
    expect(
      run("=FILTER_COLUMNS(A1:C3, A8:C8, A9:C9)", {
        ...DATA,
        A8: "TRUE",
        B8: "TRUE",
        C8: "FALSE",
        A9: "TRUE",
        B9: "FALSE",
        C9: "TRUE",
      }),
    ).toEqual([["banana"], ["apple"], ["cherry"]]);
  });

  it.each<[string, string, string?, Record<string, string>?]>([
    [
      "=FILTER_COLUMNS(A1:C5, A9:B9)",
      "#VALUE!",
      "A condition must be one row as wide as the range",
    ],
    ["=FILTER_COLUMNS(A1:C5, A9:C9)", "#N/A", "Nothing matches"],
    ["=FILTER_COLUMNS(A1:C5, A9:C9)", "#VALUE!", '"no" is not TRUE or FALSE', { A9: "no" }],
  ])("%s is %s", (formula, code, message, extra = {}) => {
    expectError(formula, code, message, {
      ...DATA,
      A9: "FALSE",
      B9: "FALSE",
      C9: "FALSE",
      ...extra,
    });
  });
});

describe("SORT", () => {
  it("sorts rows by the first column, ascending, ignoring letter case", () => {
    expect(run("=SORT(A1:A5)").flat()).toEqual(["apple", "Apple", "banana", "cherry", "date"]);
  });

  it("takes -1 for descending and 1 for ascending, as Excel does", () => {
    expect(run("=SORT(A1:C5, 3, -1)")).toEqual(run("=SORT(A1:C5, 3, FALSE)"));
    expect(run("=SORT(A1:C5, 3, 1)")).toEqual(run("=SORT(A1:C5, 3, TRUE)"));
  });

  it("sorts by a chosen column and direction", () => {
    expect(run("=SORT(A1:C5, 3, FALSE)").map(([fruit]) => fruit)).toEqual([
      "cherry",
      "banana",
      "Apple",
      "apple",
      "date",
    ]);
  });

  it("breaks ties with further column and direction pairs, and otherwise keeps the original order", () => {
    expect(run("=SORT(A1:C5, 2, TRUE, 3, FALSE)").map(([fruit]) => fruit)).toEqual([
      "date",
      "Apple",
      "cherry",
      "apple",
      "banana",
    ]);
    expect(
      run("=SORT(A1:C5, 3)")
        .map(([fruit]) => fruit)
        .slice(0, 2),
    ).toEqual(["apple", "date"]);
  });

  it("puts empty cells last in either direction, and numbers before text", () => {
    const data = { A1: "b", A2: "", A3: "2", A4: "a", A5: "10" };
    expect(run("=SORT(A1:A5)", data).flat()).toEqual([2, 10, "a", "b", null]);
    expect(run("=SORT(A1:A5, 1, FALSE)", data).flat()).toEqual(["b", "a", 10, 2, null]);
  });

  it.each([
    ["=SORT(A1:C5, 4)", "#VALUE!"],
    ["=SORT(A1:C5, 0)", "#VALUE!"],
    ['=SORT(A1:C5, 1, "up")', "#VALUE!"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code);
  });
});

describe("UNIQUE", () => {
  it("removes repeated rows, keeping the first, and ignores letter case", () => {
    expect(run("=UNIQUE(B1:B5)").flat()).toEqual(["yellow", "red", "green", "brown"]);
    expect(run("=UNIQUE(A1:A5)").flat()).toEqual(["banana", "apple", "cherry", "date"]);
  });

  it("compares whole rows, and keeps a number apart from the same digits as text", () => {
    expect(run("=UNIQUE(B1:C5)")).toHaveLength(5);
    expect(run("=UNIQUE(A1:A4)", { A1: "5", A2: "'5", A3: "5", A4: "TRUE" }).flat()).toEqual([
      5,
      "5",
      true,
    ]);
  });
});

describe("SEQUENCE, TRANSPOSE, TAKE, DROP, ROWS, COLUMNS", () => {
  it.each<[string, CellValue[][]]>([
    ["=SEQUENCE(3)", [[1], [2], [3]]],
    [
      "=SEQUENCE(2, 2)",
      [
        [1, 2],
        [3, 4],
      ],
    ],
    [
      "=SEQUENCE(2, 2, 5)",
      [
        [5, 6],
        [7, 8],
      ],
    ],
    ["=SEQUENCE(1, 3, 10, 5)", [[10, 15, 20]]],
    [
      "=SEQUENCE(2, 3, 10, 0.5)",
      [
        [10, 10.5, 11],
        [11.5, 12, 12.5],
      ],
    ],
    [
      "=SEQUENCE(2, 2, 1, -0.5)",
      [
        [1, 0.5],
        [0, -0.5],
      ],
    ],
    [
      "=TRANSPOSE(SEQUENCE(2, 3))",
      [
        [1, 4],
        [2, 5],
        [3, 6],
      ],
    ],
    ["=TRANSPOSE(7)", [[7]]],
    ["=TAKE(SEQUENCE(5), 2)", [[1], [2]]],
    ["=TAKE(SEQUENCE(5), -2)", [[4], [5]]],
    ["=TAKE(SEQUENCE(5), 99)", [[1], [2], [3], [4], [5]]],
    ["=TAKE(SEQUENCE(3, 3), 2, -1)", [[3], [6]]],
    [
      "=ARRAY_CONSTRAIN(A1:C5, 2, 2)",
      [
        ["banana", "yellow"],
        ["apple", "red"],
      ],
    ],
    ["=ARRAY_CONSTRAIN(A1:C5, -2, -1)", [[8], [5]]],
    ["=DROP(SEQUENCE(5), 2)", [[3], [4], [5]]],
    ["=DROP(SEQUENCE(5), -4)", [[1]]],
    [
      "=DROP(SEQUENCE(3, 3), 1, 1)",
      [
        [5, 6],
        [8, 9],
      ],
    ],
    [
      "=HSTACK(SEQUENCE(2), SEQUENCE(2, 1, 10))",
      [
        [1, 10],
        [2, 11],
      ],
    ],
    [
      "=HSTACK(SEQUENCE(3), 9)",
      [
        [1, 9],
        [2, null],
        [3, null],
      ],
    ],
    [
      "=VSTACK(SEQUENCE(1, 2), SEQUENCE(1, 2, 10))",
      [
        [1, 2],
        [10, 11],
      ],
    ],
    [
      "=VSTACK(SEQUENCE(1, 3), 9)",
      [
        [1, 2, 3],
        [9, null, null],
      ],
    ],
    [
      "=HSTACK(A1:A2, C1:C2)",
      [
        ["banana", 12],
        ["apple", 5],
      ],
    ],
    ["=ROWS(A1:C5)", [[5]]],
    ["=COLUMNS(A1:C5)", [[3]]],
    ["=ROWS(7)", [[1]]],
    [
      "=TAKE(SORT(FILTER(A1:C5, C1:C5 >= 8), 3, FALSE), 2)",
      [
        ["cherry", "red", 40],
        ["banana", "yellow", 12],
      ],
    ],
  ])("%s gives %j", (formula, expected) => {
    expect(run(formula)).toEqual(expected);
  });

  it.each([
    ["=SEQUENCE(0)", "#VALUE!"],
    ["=SEQUENCE(1000, 1000)", "#VALUE!"],
    ["=TAKE(SEQUENCE(3), 0)", "#VALUE!"],
    ["=ARRAY_CONSTRAIN(A1:C5, 0, 2)", "#VALUE!"],
    ["=DROP(SEQUENCE(3), 3)", "#N/A"],
    ["=DROP(SEQUENCE(3), 99)", "#N/A"],
  ])("%s is %s", (formula, code) => {
    expectError(formula, code);
  });
});

describe("MAP, REDUCE, BYROW, BYCOL", () => {
  it.each<[string, CellValue[][]]>([
    ["=MAP(C1:C3, LAMBDA(n, n * 2))", [[24], [10], [80]]],
    ['=MAP(A1:A2, C1:C2, LAMBDA(name, n, name & ": " & n))', [["banana: 12"], ["apple: 5"]]],
    ['=MAP(C1:C3, LAMBDA(n, IF(n > 10, "many", "few")))', [["many"], ["few"], ["many"]]],
    [
      "=MAP(SEQUENCE(2, 2), LAMBDA(n, n * n))",
      [
        [1, 4],
        [9, 16],
      ],
    ],
    ["=MAP(5, LAMBDA(n, n + 1))", [[6]]],
    ["=LET(double, LAMBDA(n, n * 2), MAP(C1:C2, double))", [[24], [10]]],
    ["=REDUCE(0, C1:C5, LAMBDA(total, n, total + n))", [[70]]],
    ['=REDUCE("", A1:A3, LAMBDA(text, name, text & LEFT(name, 1)))', [["bac"]]],
    ["=REDUCE(100, C9:C9, LAMBDA(total, n, total + n))", [[100]]],
    ["=BYROW(SEQUENCE(2, 3), LAMBDA(row, SUM(row)))", [[6], [15]]],
    ["=BYCOL(SEQUENCE(2, 3), LAMBDA(col, MAX(col)))", [[4, 5, 6]]],
    ["=SUM(MAP(C1:C5, LAMBDA(n, n * 2)))", [[140]]],
  ])("%s gives %j", (formula, expected) => {
    expect(run(formula)).toEqual(expected);
  });

  it("puts an error in the cell whose call failed, and computes the rest", () => {
    expect(run("=MAP(SEQUENCE(3, 1, -1), LAMBDA(n, 1 / n))")).toMatchObject([
      [-1],
      [{ code: "#DIV/0!" }],
      [1],
    ]);
  });

  it("uses the first value when the function gives an array for one cell", () => {
    expect(run("=MAP(SEQUENCE(2), LAMBDA(n, SEQUENCE(1, 3, n * 10)))")).toEqual([[10], [20]]);
  });

  it.each([
    ["=MAP(C1:C3, 5)", "#VALUE!", "Expected a function made with LAMBDA"],
    [
      "=MAP(C1:C3, C1:C2, LAMBDA(a, b, a + b))",
      "#VALUE!",
      "The arrays given to MAP must be the same size",
    ],
    ["=MAP(C1:C3, LAMBDA(a, b, a + b))", "#VALUE!", undefined],
    ["=REDUCE(0, C1:C3, LAMBDA(n, n))", "#ERROR!", "The function takes 1 argument"],
    ["=REDUCE(0, C1:C3, LAMBDA(total, n, total + 1/0))", "#DIV/0!", undefined],
    ["=BYROW(C1:C3, SUM)", "#NAME?", undefined],
  ])("%s is %s", (formula, code, message) => {
    if (formula.includes("LAMBDA(a, b, a + b))") && !formula.includes("C1:C2")) {
      // Each cell's call fails on its own, so the array is made of errors.
      expect(run(formula)).toMatchObject([
        [{ code: "#ERROR!" }],
        [{ code: "#ERROR!" }],
        [{ code: "#ERROR!" }],
      ]);
    } else expectError(formula, code, message);
  });
});

describe("EXECUTE with an array", () => {
  it("writes the array as a block starting at the target cell", () => {
    const workbook = workbookWith({
      t1: { ...DATA, E1: '=BUTTON("Copy reds", EXECUTE(FILTER(A1:C5, B1:B5 = "red"), G1))' },
    });
    const button = workbook.getValue(at("E1"));
    if (typeof button !== "object" || button?.kind !== "button") throw new Error("not a button");
    expect(workbook.planAction(button.action)).toEqual({
      ok: true,
      effects: [
        { type: "setCell", tableId: "t1", row: 0, col: 6, input: "apple" },
        { type: "setCell", tableId: "t1", row: 0, col: 7, input: "red" },
        { type: "setCell", tableId: "t1", row: 0, col: 8, input: "5" },
        { type: "setCell", tableId: "t1", row: 1, col: 6, input: "cherry" },
        { type: "setCell", tableId: "t1", row: 1, col: 7, input: "red" },
        { type: "setCell", tableId: "t1", row: 1, col: 8, input: "40" },
      ],
    });
  });

  it("refuses an array that holds an error", () => {
    const workbook = workbookWith({
      t1: { A1: "0", E1: '=BUTTON("Go", EXECUTE(MAP(A1:A1, LAMBDA(n, 1 / n)), G1))' },
    });
    const button = workbook.getValue(at("E1"));
    if (typeof button !== "object" || button?.kind !== "button") throw new Error("not a button");
    expect(workbook.planAction(button.action)).toMatchObject({
      ok: false,
      error: { code: "#DIV/0!" },
    });
  });
});
