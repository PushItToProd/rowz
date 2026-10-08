import { describe, expect, it } from "vitest";
import { parseDate } from "../dates";
import { Workbook } from "../workbook";
import { at, workbookWith } from "../testing";
import { formatValue, isButton, type CellValue } from "../values";

const DATA = {
  A1: "Item",
  B1: "Kind",
  C1: "Amount",
  D1: "Sold on",
  A2: "Apple",
  B2: "Fruit",
  C2: "10",
  D2: "2026-01-05",
  A3: "Carrot",
  B3: "Vegetable",
  C3: "5",
  D3: "2026-01-20",
  A4: "Banana",
  B4: "Fruit",
  C4: "20",
  D4: "2026-02-03",
  A5: "Leek",
  B5: "Vegetable",
  C5: "8",
  D5: "2026-02-10",
  A6: "apple",
  B6: "Fruit",
  C6: "7",
  D6: "2026-03-01",
  A7: "Milk",
  B7: "Dairy",
  D7: "2026-03-02",
};

/** Runs a query over the data and gives the cells it fills, with dates and errors as the text they show. */
function run(
  query: string,
  range = "A1:D7",
  extra = "",
  data: Record<string, string> = DATA,
): (string | number | boolean | null)[][] {
  const formula = `=QUERY(Table1!${range}, "${query.replaceAll('"', '""')}"${extra})`;
  const workbook = workbookWith({ t1: data, t2: { A1: formula } });
  return workbook
    .getArray(at("A1", "t2"))
    .map((row) =>
      row.map((cell: CellValue) =>
        cell === null || typeof cell === "number" || typeof cell === "boolean"
          ? cell
          : formatValue(cell),
      ),
    );
}

function runValues(
  query: string,
  range = "A1:D7",
  extra = "",
  data: Record<string, string> = DATA,
): CellValue[][] {
  const formula = `=QUERY(Table1!${range}, "${query.replaceAll('"', '""')}"${extra})`;
  return workbookWith({ t1: data, t2: { A1: formula } }).getArray(at("A1", "t2"));
}

function failure(query: string, range = "A1:D7", extra = ""): { code: string; message?: string } {
  const formula = `=QUERY(Table1!${range}, "${query.replaceAll('"', '""')}"${extra})`;
  const value = workbookWith({ t1: DATA, t2: { A1: formula } }).getValue(at("A1", "t2"));
  return value as { code: string; message?: string };
}

describe("selecting columns", () => {
  it("gives every column for * and for a query with no SELECT", () => {
    expect(run("select *", "A1:C3")).toEqual([
      ["Item", "Kind", "Amount"],
      ["Apple", "Fruit", 10],
      ["Carrot", "Vegetable", 5],
    ]);
    expect(run("limit 1", "A1:C3")).toEqual([
      ["Item", "Kind", "Amount"],
      ["Apple", "Fruit", 10],
    ]);
  });

  it("names columns by letter, by number, and by header", () => {
    const expected = [
      ["Amount", "Item"],
      [10, "Apple"],
      [5, "Carrot"],
    ];
    expect(run("select C, A", "A1:C3")).toEqual(expected);
    expect(run("select Col3, col1", "A1:C3")).toEqual(expected);
    expect(run("select amount, Item", "A1:C3")).toEqual(expected);
    expect(run("select 'Amount', 'item'", "A1:C3")).toEqual(expected);
  });

  it("counts column letters from the first column of the range", () => {
    expect(run("select A", "C1:C3")).toEqual([["Amount"], [10], [5]]);
  });

  it("names a header of several words or a reserved word in single quotes", () => {
    expect(run("select 'Sold on' where 'Sold on' < date \"2026-01-10\"")).toEqual([
      ["Sold on"],
      ["2026-01-05"],
    ]);
  });

  it("computes with columns and calls formula functions", () => {
    expect(run("select UPPER(A), C * 2 + 1, MONTH(D) limit 2")).toEqual([
      ["UPPER(A)", "C * 2 + 1", "MONTH(D)"],
      ["APPLE", 21, 1],
      ["CARROT", 11, 1],
    ]);
  });

  it("names a result column with AS or LABEL", () => {
    expect(run("select A as Name, C * 2 as 'Twice the amount' limit 1")).toEqual([
      ["Name", "Twice the amount"],
      ["Apple", 20],
    ]);
    expect(run('select A, C limit 1 label C "Units", A "What"')).toEqual([
      ["What", "Units"],
      ["Apple", 10],
    ]);
  });
});

describe("quoted identifiers and strings", () => {
  it("looks up quoted ColN identifiers as headers", () => {
    const col1Header = {
      A1: "Other",
      B1: "Col1",
      A2: "first",
      B2: "second",
    };
    expect(run("select 'Col1'", "A1:B2", ", 1", col1Header)).toEqual([["Col1"], ["second"]]);

    const col9Header = {
      A1: "Other",
      B1: "Col9",
      A2: "first",
      B2: "ninth",
    };
    expect(run("select 'Col9'", "A1:B2", ", 1", col9Header)).toEqual([["Col9"], ["ninth"]]);
  });

  it("groups a named data table by a single-quoted header", () => {
    const workbook = new Workbook();
    workbook.setStructure({
      pages: [{ id: "p", name: "Main" }],
      tables: [
        {
          id: "people",
          pageId: "p",
          name: "People",
          rowCount: 3,
          colCount: 3,
          columns: [
            { name: "Favorite food", type: "text" },
            { name: "Person's food", type: "text" },
            { name: "select", type: "text" },
          ],
        },
      ],
    });
    for (const [row, food] of ["Pizza", "Tacos", "Pizza"].entries()) {
      for (let col = 0; col < 3; col += 1) {
        workbook.setCell({ tableId: "people", row, col }, food);
      }
    }
    const report = workbook.evaluateOnPage(
      "p",
      `QUERY(People, "select 'Favorite food', count(*) group by 'Favorite food'")`,
    );
    expect(report).toMatchObject({
      rows: [
        ["Favorite food", "count(*)"],
        ["Pizza", 2],
        ["Tacos", 1],
      ],
    });
    const escaped = workbook.evaluateOnPage(
      "p",
      `QUERY(People, "select 'Person''s food', 'select' where 'Favorite food' = ""Pizza""")`,
    );
    expect(escaped).toMatchObject({
      rows: [
        ["Person's food", "select"],
        ["Pizza", "Pizza"],
        ["Pizza", "Pizza"],
      ],
    });
  });

  it("resolves a quoted alias in a clause before SELECT", () => {
    expect(
      run("order by 'Twice the amount' desc select A, C * 2 as 'Twice the amount' limit 1"),
    ).toEqual([
      ["Item", "Twice the amount"],
      ["Banana", 40],
    ]);
  });

  it("preserves literal double quotes after both parsers decode them", () => {
    const workbook = workbookWith({
      t1: DATA,
      t2: {
        A1: '=QUERY(Table1!A1:D7, "select ""say """"hello"""""" as Note limit 1")',
      },
    });
    expect(workbook.getArray(at("A1", "t2"))).toEqual([["Note"], ['say "hello"']]);
    expect(run('select "" as Note limit 1')).toEqual([["Note"], [""]]);
  });
});

describe("header rows", () => {
  it("takes a first row of text above other values to be a header", () => {
    expect(run("select C where C > 9")).toEqual([["Amount"], [10], [20]]);
  });

  it("treats every row as data when told there are no header rows", () => {
    expect(run("select A, C where C > 9", "A2:C7")).toEqual([
      ["Apple", 10],
      ["Banana", 20],
    ]);
    expect(run("select A limit 2", "A1:C7", ", 0")).toEqual([["Item"], ["Apple"]]);
  });

  it("does not guess a header when every column is text", () => {
    expect(run("select A limit 1", "A1:B7")).toEqual([["Item"]]);
    expect(run("select A limit 1", "A1:B7", ", 1")).toEqual([["Item"], ["Apple"]]);
  });

  it("gives a result with no header row a header when a column is named", () => {
    expect(run("select A as Name, C where C > 9", "A2:C7")).toEqual([
      ["Name", "C"],
      ["Apple", 10],
      ["Banana", 20],
    ]);
  });
});

describe("filtering", () => {
  it.each<[string, string[]]>([
    ["C > 8", ["Apple", "Banana"]],
    ['C >= 8 and B = "Vegetable"', ["Leek"]],
    ['B = "fruit" and not C > 8', ["apple"]],
    ["C < 6 or C > 15", ["Carrot", "Banana"]],
    ['B != "Fruit"', ["Carrot", "Leek", "Milk"]],
    ['B <> "Fruit" and C is not null', ["Carrot", "Leek"]],
    ["C is null", ["Milk"]],
    ['A in ("Leek", "Milk", "Kiwi")', ["Leek", "Milk"]],
    ['A not in ("Apple", "Banana", "Carrot")', ["Leek", "Milk"]],
    ['A contains "an"', ["Banana"]],
    ['A not contains "a"', ["Leek", "Milk"]],
    ['A starts with "ap"', ["Apple", "apple"]],
    ['A ends with "k"', ["Leek", "Milk"]],
    ['A like "%e_k"', ["Leek"]],
    ['A like "b%"', ["Banana"]],
    ['D >= date "2026-03-01"', ["apple", "Milk"]],
    ["MONTH(D) = 2", ["Banana", "Leek"]],
    ["(C + 1) * 2 = 12", ["Carrot"]],
    ["C = -5 + 10", ["Carrot"]],
    ["true and C = 7", ["apple"]],
    ["C < 100", ["Apple", "Carrot", "Banana", "Leek", "apple"]],
    ["C = 0", []],
    ["not C > 8", ["Carrot", "Leek", "apple", "Milk"]],
  ])("where %s", (condition, expected) => {
    const [, ...rows] = run(`select A where ${condition}`);
    expect(rows.flat()).toEqual(expected);
  });

  it("doubles query double quotes inside formula strings", () => {
    expect(run('select "say ""hello""" as Note limit 1')).toEqual([["Note"], ['say "hello"']]);
    expect(run(`select "it's" as Note limit 1`)).toEqual([["Note"], ["it's"]]);
  });
});

describe("ordering and paging", () => {
  it("sorts by columns, either way, with empty cells last", () => {
    const [, ...ascending] = run("select A order by C");
    expect(ascending.flat()).toEqual(["Carrot", "apple", "Leek", "Apple", "Banana", "Milk"]);
    const [, ...descending] = run("select A order by C desc");
    expect(descending.flat()).toEqual(["Banana", "Apple", "Leek", "apple", "Carrot", "Milk"]);
  });

  it("orders errors before empty cells in either direction", () => {
    const data = {
      A1: "blank key",
      A2: "error key",
      B2: "=1/0",
      A3: "two",
      B3: "2",
      A4: "one",
      B4: "1",
    };
    expect(run("select A order by B", "A1:B4", ", 0", data)).toEqual([
      ["one"],
      ["two"],
      ["error key"],
      ["blank key"],
    ]);
    expect(run("select A order by B desc", "A1:B4", ", 0", data)).toEqual([
      ["two"],
      ["one"],
      ["error key"],
      ["blank key"],
    ]);
  });

  it("breaks ties with the next column, and keeps the data's order when a tie is not broken", () => {
    const [, ...rows] = run("select A, C order by B desc, C asc");
    expect(rows.map(([item]) => item)).toEqual([
      "Carrot",
      "Leek",
      "apple",
      "Apple",
      "Banana",
      "Milk",
    ]);
    const [, ...tied] = run("select C order by A");
    expect(tied.flat().slice(0, 2)).toEqual([10, 7]);
  });

  it("sorts by an expression and by a name given with AS", () => {
    const [, ...rows] = run("select A, C * -1 as Negative order by Negative limit 2");
    expect(rows).toEqual([
      ["Banana", -20],
      ["Apple", -10],
    ]);
  });

  it("skips and limits rows after sorting", () => {
    const [, ...rows] = run("select A order by C desc limit 2 offset 1");
    expect(rows.flat()).toEqual(["Apple", "Leek"]);
    const [, ...rest] = run("select A offset 4");
    expect(rest.flat()).toEqual(["apple", "Milk"]);
  });

  it("accepts the clauses in any order", () => {
    expect(run('limit 1 order by C desc where B = "Fruit" select A')).toEqual([
      ["Item"],
      ["Banana"],
    ]);
  });

  it("knows a name given with AS in a clause written before the SELECT", () => {
    const [, ...rows] = run("limit 2 order by Negative select A, C * -1 as Negative");
    expect(rows).toEqual([
      ["Banana", -20],
      ["Apple", -10],
    ]);
    const [, ...groups] = run(
      "having Total > 10 order by Total desc select B, sum(C) as Total group by B",
    );
    expect(groups).toEqual([
      ["Fruit", 37],
      ["Vegetable", 13],
    ]);
    expect(failure('where A = "x" select A select B').message).toBe("SELECT appears twice");
  });
});

describe("grouping", () => {
  it("combines the rows of each group, in order of the group's value", () => {
    expect(run("select B, sum(C), count(C), count(*) group by B")).toEqual([
      ["Kind", "sum Amount", "count Amount", "count(*)"],
      ["Dairy", 0, 0, 1],
      ["Fruit", 37, 3, 3],
      ["Vegetable", 13, 2, 2],
    ]);
  });

  it("groups text without regard to letter case", () => {
    expect(run('select A, sum(C) where B = "Fruit" group by A')).toEqual([
      ["Item", "sum Amount"],
      ["Apple", 17],
      ["Banana", 20],
    ]);
  });

  it("offers the other ways to combine", () => {
    expect(
      run("select min(C), max(C), avg(C), average(C), median(C), countunique(B), max(D)"),
    ).toEqual([
      [
        "min Amount",
        "max Amount",
        "avg Amount",
        "average Amount",
        "median Amount",
        "countunique Kind",
        "max Sold on",
      ],
      [5, 20, 10, 10, 8, 3, "2026-03-02"],
    ]);
  });

  it("combines every row into one when there is no GROUP BY", () => {
    expect(run('select sum(C) where B = "Fruit"')).toEqual([["sum Amount"], [37]]);
    expect(run("select count(*), sum(C) where C > 100")).toEqual([
      ["count(*)", "sum Amount"],
      [0, null],
    ]);
  });

  it("groups by an expression and computes with the combined values", () => {
    expect(
      run("select MONTH(D) as Month, sum(C) / count(*) as Mean group by MONTH(D) order by Month"),
    ).toEqual([
      ["Month", "Mean"],
      [1, 7.5],
      [2, 14],
      [3, 3.5],
    ]);
  });

  it("filters groups with HAVING and sorts them by a combined value", () => {
    expect(run("select B, sum(C) group by B having sum(C) > 10 order by sum(C) desc")).toEqual([
      ["Kind", "sum Amount"],
      ["Fruit", 37],
      ["Vegetable", 13],
    ]);
    expect(run("select B group by B order by count(*) desc, B limit 2")).toEqual([
      ["Kind"],
      ["Fruit"],
      ["Vegetable"],
    ]);
  });

  it("shows an error from a combination in its cell, and keeps the rest", () => {
    expect(run("select B, avg(C) group by B")).toEqual([
      ["Kind", "avg Amount"],
      ["Dairy", "#DIV/0!"],
      ["Fruit", 37 / 3],
      ["Vegetable", 6.5],
    ]);
  });

  it("treats a function of two columns as the ordinary function, row by row", () => {
    expect(run("select A, MAX(C, 8) limit 2")).toEqual([
      ["Item", "MAX(C, 8)"],
      ["Apple", 10],
      ["Carrot", 8],
    ]);
  });
});

describe("pivoting", () => {
  it("gives each value of the pivot column its own column", () => {
    expect(run("select MONTH(D) as Month, sum(C) group by MONTH(D) pivot B")).toEqual([
      ["Month", "Dairy", "Fruit", "Vegetable"],
      [1, null, 10, 5],
      [2, null, 20, 8],
      [3, 0, 7, null],
    ]);
  });

  it("names the columns after each combination when there are several", () => {
    expect(run('select sum(C), count(*) where B <> "Dairy" pivot B')).toEqual([
      ["Fruit sum Amount", "Fruit count(*)", "Vegetable sum Amount", "Vegetable count(*)"],
      [37, 3, 13, 2],
    ]);
  });

  it("keeps each single pivot value's type in the output heading", () => {
    const numeric = runValues("select A, sum(C) group by A pivot B", "A1:C3", ", 1", {
      A1: "Group",
      B1: "Duration",
      C1: "Amount",
      A2: "Day",
      B2: "6",
      C2: "10",
      A3: "Night",
      B3: "12",
      C3: "5",
    });
    expect(numeric[0]).toEqual(["Group", 6, 12]);

    const dates = runValues("select A, sum(C) group by A pivot B", "A1:C3", ", 1", {
      A1: "Group",
      B1: "Date",
      C1: "Amount",
      A2: "Day",
      B2: "2026-01-05",
      C2: "10",
      A3: "Night",
      B3: "2026-02-03",
      C3: "5",
    });
    expect(dates[0]).toEqual(["Group", parseDate("2026-01-05"), parseDate("2026-02-03")]);

    const text = runValues("select A, sum(C) group by A pivot B", "A1:C3", ", 1", {
      A1: "Group",
      B1: "Kind",
      C1: "Amount",
      A2: "Day",
      B2: "short",
      C2: "10",
      A3: "Night",
      B3: "long",
      C3: "5",
    });
    expect(text[0]).toEqual(["Group", "long", "short"]);
    expect(typeof text[0]?.[1]).toBe("string");
  });

  it("keeps button values with different captured names in separate groups", () => {
    const workbook = workbookWith({
      t1: {
        A1: '=QUERY(MAP(SEQUENCE(2), LAMBDA(x, BUTTON("go", EXECUTE(x, C1)))), "select Col1, count(*) group by Col1", 0)',
      },
    });
    const rows = workbook.getArray(at("A1"));

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row[1])).toEqual([1, 1]);
    expect(
      rows.map((row) => (isButton(row[0]) ? row[0].action.names?.get("x") : undefined)),
    ).toEqual([1, 2]);
  });
});

describe("mistakes", () => {
  it.each<[string, string]>([
    ["select 'Fruit'", "The data has no column Fruit"],
    ["select 'x", "' is never closed"],
    ["select `Amount`", "The query cannot contain `"],
    ['select A as "Name"', "AS needs a name after it"],
    ["select A label A 'Units'", "LABEL needs text in double quotes after each column"],
    ["select A where A like 'a%'", "LIKE needs a pattern in double quotes"],
    ["select Z", "The data has no column Z"],
    ["select Col9", "The data has no column Col9"],
    ["select 'Price'", "The data has no column Price"],
    ["select A, sum(C)", "A must be in GROUP BY or inside a function such as SUM"],
    ["select A, sum(C) group by B", "A must be in GROUP BY or inside a function such as SUM"],
    ["select * group by B", "Col1 must be in GROUP BY or inside a function such as SUM"],
    ["select B group by B pivot A", "PIVOT needs a function such as SUM in the SELECT"],
    ["select A where", "The query ends where a value was expected"],
    ["select A from B", "Expected a clause such as SELECT or WHERE, not from"],
    ["select A select B", "SELECT appears twice"],
    ["select A limit x", "LIMIT needs a whole number"],
    ["select A limit 1.5", "LIMIT needs a whole number"],
    ['select A where B = "x', '" is never closed'],
    [
      'select A where B matches "x"',
      "MATCHES is not supported. Use LIKE, CONTAINS, or STARTS WITH",
    ],
    ["select A where B like C", "LIKE needs a pattern in double quotes"],
    ["select A group B", "Expected BY, not B"],
    ["select A where (C > 1", "Expected ), not the end of the query"],
    ["select A ; drop", "The query cannot contain ;"],
    ["select A label A", "LABEL needs text in double quotes after each column"],
    ["select A as", "AS needs a name after it"],
    ["select order", "order cannot be used as a value here"],
    ["select A where B not 5", "Expected IN, LIKE, or CONTAINS after NOT"],
    ["select )", ") cannot start a value"],
  ])("%s: %s", (query, message) => {
    expect(failure(query)).toMatchObject({ code: "#VALUE!", message });
  });

  it("says so when no rows match", () => {
    expect(failure("select A where C > 100", "A2:C7")).toMatchObject({ code: "#N/A" });
  });

  it("fails with the error a condition runs into", () => {
    expect(failure("select A where C / 0 > 1")).toMatchObject({ code: "#DIV/0!" });
    expect(failure("select A where NOSUCH(C) > 1")).toMatchObject({ code: "#NAME?" });
  });

  it("refuses a count of header rows the data does not have", () => {
    expect(failure("select A", "A1:C3", ", 4")).toMatchObject({ code: "#VALUE!" });
    expect(failure("select A", "A1:C3", ", -1")).toMatchObject({ code: "#VALUE!" });
  });
});

describe("as part of a workbook", () => {
  it("follows changes to the data, and its result can be read by other formulas", () => {
    const workbook = workbookWith({
      t1: DATA,
      t2: {
        A1: '=QUERY(Table1!A1:D7, "select B, sum(C) group by B order by sum(C) desc")',
        D1: "=SUM(B2:B4)",
      },
    });
    expect(workbook.getValue(at("B2", "t2"))).toBe(37);
    expect(workbook.getValue(at("D1", "t2"))).toBe(50);
    workbook.setCell(at("C7", "t1"), "100");
    expect(workbook.getValue(at("A2", "t2"))).toBe("Dairy");
    expect(workbook.getValue(at("D1", "t2"))).toBe(150);
  });

  it("takes the result of another formula as its data", () => {
    const workbook = workbookWith({
      t1: DATA,
      t2: { A1: '=QUERY(FILTER(Table1!A2:C7, Table1!C2:C7 > 6), "select A order by C desc")' },
    });
    expect(workbook.getArray(at("A1", "t2")).flat()).toEqual(["Banana", "Apple", "Leek", "apple"]);
  });
});
