import { describe, expect, it } from "vitest";
import type { Effect } from "../effects";
import { at, workbookWith } from "../testing";
import { isAction, isButton, type ActionValue, type ErrorValue } from "../values";
import type { Workbook } from "../workbook";

/** Reads the button in `address` and plans its action. */
function click(workbook: Workbook, address: string, tableId = "t1"): Effect[] | ErrorValue {
  const value = workbook.getValue(at(address, tableId));
  if (!isButton(value)) throw new Error(`${address} is not a button`);
  const plan = workbook.planAction(value.action);
  return plan.ok ? plan.effects : plan.error;
}

function clickFormula(formula: string, cells: Record<string, string> = {}): Effect[] | ErrorValue {
  return click(workbookWith({ t1: { ...cells, Z99: formula } }), "Z99");
}

describe("BUTTON", () => {
  it("evaluates to a button holding the label and the action", () => {
    const workbook = workbookWith({
      t1: { A1: "Go", B1: '=BUTTON(A1 & "!", EXECUTE(1, C1))' },
    });
    const value = workbook.getValue(at("B1"));
    expect(value).toMatchObject({
      kind: "button",
      label: "Go!",
      action: { kind: "action", name: "EXECUTE", origin: at("B1") },
    });
  });

  it("converts a non-text label to text", () => {
    expect(
      workbookWith({ t1: { A1: "=BUTTON(42, EXECUTE(1, C1))" } }).getValue(at("A1")),
    ).toMatchObject({ label: "42" });
  });

  it("updates its label when the label's cell changes", () => {
    const workbook = workbookWith({ t1: { A1: "Before", B1: "=BUTTON(A1, EXECUTE(1, C1))" } });
    expect(workbook.getValue(at("B1"))).toMatchObject({ label: "Before" });
    workbook.setCell(at("A1"), "After");
    expect(workbook.getValue(at("B1"))).toMatchObject({ label: "After" });
  });

  it.each([
    ['=BUTTON("x", 5)', "#VALUE!"],
    ['=BUTTON("x", SUM(1, 2))', "#VALUE!"],
    ['=BUTTON("x", 1/0)', "#DIV/0!"],
    ["=BUTTON(1/0, EXECUTE(1, C1))", "#DIV/0!"],
    ["=BUTTON(A1:A2, EXECUTE(1, C1))", "#VALUE!"],
    ['=BUTTON("x")', "#ERROR!"],
    ['=BUTTON("x", EXECUTE(1))', "#ERROR!"],
    ['=BUTTON("x", NOPE(1))', "#NAME?"],
  ])("%s is %s", (formula, code) => {
    expect(workbookWith({ t1: { Z99: formula } }).getValue(at("Z99"))).toMatchObject({
      kind: "error",
      code,
    });
  });
});

describe("action values", () => {
  it("a bare action formula evaluates to an action", () => {
    const value = workbookWith({ t1: { A1: "=EXECUTE(1, B1)" } }).getValue(at("A1"));
    expect(isAction(value)).toBe(true);
  });

  it("recalculation does not evaluate an action's arguments", () => {
    // Evaluating the arguments would make each of these an error.
    const workbook = workbookWith({
      t1: {
        A1: '=BUTTON("divide", EXECUTE(1/0, B1))',
        A2: '=BUTTON("self", EXECUTE(A2, A2))',
        A3: '=BUTTON("unknown table", EXECUTE(1, Missing!A1))',
      },
    });
    for (const address of ["A1", "A2", "A3"]) {
      expect(isButton(workbook.getValue(at(address)))).toBe(true);
    }
  });

  it("a button does not depend on the cells its action reads or writes", () => {
    const workbook = workbookWith({ t1: { A1: "0", B1: '=BUTTON("Add one", EXECUTE(A1+1, A1))' } });
    const before = workbook.getValue(at("B1"));
    workbook.setCell(at("A1"), "1");
    // The cached button is returned as is: changing A1 did not invalidate B1.
    expect(workbook.getValue(at("B1"))).toBe(before);
  });

  it("rejects an action whose function is not registered", () => {
    const action: ActionValue = { kind: "action", name: "LAUNCH", args: [], origin: at("A1") };
    expect(workbookWith({}).planAction(action)).toEqual({
      ok: false,
      error: { kind: "error", code: "#NAME?", message: "Unknown action LAUNCH" },
    });
  });

  it("rejects a pure function passed off as an action", () => {
    const action: ActionValue = { kind: "action", name: "SUM", args: [], origin: at("A1") };
    expect(workbookWith({}).planAction(action)).toMatchObject({ ok: false });
  });
});

describe("EXECUTE", () => {
  it("plans a write of the expression's value to the target cell", () => {
    const effects = clickFormula('=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))', {
      A1: "1",
      A2: "2",
    });
    expect(effects).toEqual([{ type: "setCell", tableId: "t1", row: 2, col: 0, input: "3" }]);
  });

  it("uses the cell values at the time of the click", () => {
    const workbook = workbookWith({ t1: { A1: "1", B1: '=BUTTON("Copy", EXECUTE(A1 * 10, C1))' } });
    workbook.getValue(at("B1"));
    workbook.setCell(at("A1"), "7");
    expect(click(workbook, "B1")).toMatchObject([{ input: "70" }]);
  });

  it("reads formula cells that were never computed before the click", () => {
    const workbook = workbookWith({
      t1: { A1: "2", A2: "=A1*3", B1: '=BUTTON("Go", EXECUTE(A2+1, C1))' },
    });
    expect(click(workbook, "B1")).toMatchObject([{ input: "7" }]);
  });

  it("plans without changing the workbook", () => {
    const workbook = workbookWith({ t1: { A1: "1", B1: '=BUTTON("Add one", EXECUTE(A1+1, A1))' } });
    click(workbook, "B1");
    expect(workbook.getValue(at("A1"))).toBe(1);
    expect(workbook.getInput(at("A1"))).toBe("1");
  });

  it("supports a counter: each click reads the value the previous click wrote", () => {
    const workbook = workbookWith({ t1: { A1: "0", B1: '=BUTTON("Add one", EXECUTE(A1+1, A1))' } });
    for (const expected of ["1", "2", "3"]) {
      const effects = click(workbook, "B1");
      expect(effects).toEqual([
        { type: "setCell", tableId: "t1", row: 0, col: 0, input: expected },
      ]);
      workbook.setCell(at("A1"), expected);
    }
  });

  it.each([
    ['"hello"', "hello"],
    ["TRUE", "TRUE"],
    ["1=2", "FALSE"],
    ["0.5", "0.5"],
    ["D9", ""],
    // Text that would read back as something else is stored with the text prefix.
    ['"42"', "'42"],
    ['"=A1"', "'=A1"],
  ])("writes %s as the input %j", (expression, input) => {
    expect(clickFormula(`=BUTTON("x", EXECUTE(${expression}, C1))`)).toMatchObject([{ input }]);
  });

  it("writes to a cell in another table, resolved from the button's table", () => {
    const workbook = workbookWith({
      t3: { A1: "=BUTTON(\"x\", EXECUTE(5, 'Page 1'!'Other Table'!B2))" },
    });
    expect(click(workbook, "A1", "t3")).toEqual([
      { type: "setCell", tableId: "t2", row: 1, col: 1, input: "5" },
    ]);
  });

  it("resolves unqualified references against the table that holds the button", () => {
    const workbook = workbookWith({
      t1: { A1: "wrong" },
      t2: { A1: "right", B1: '=BUTTON("x", EXECUTE(A1, C1))' },
    });
    expect(click(workbook, "B1", "t2")).toEqual([
      { type: "setCell", tableId: "t2", row: 0, col: 2, input: "right" },
    ]);
  });

  it.each([
    ["EXECUTE(1/0, C1)", "#DIV/0!"],
    ['EXECUTE(SEND_EMAIL("a@b.co", "s", "b"), C1)', "#VALUE!"],
    ["EXECUTE(1, C1:C2)", "#VALUE!"],
    ["EXECUTE(1, C:C)", "#VALUE!"],
    ["EXECUTE(1, 5)", "#VALUE!"],
    ["EXECUTE(1, Missing!A1)", "#REF!"],
    ["EXECUTE(Z99, C1)", "#VALUE!"],
  ])("refuses %s with %s and plans no effects", (action, code) => {
    expect(clickFormula(`=BUTTON("x", ${action})`)).toMatchObject({ kind: "error", code });
  });
});

describe("SEND_EMAIL", () => {
  it("plans an email from cell values", () => {
    const effects = clickFormula('=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3,A4))', {
      A1: "ada@example.com",
      A2: "Hello",
      A3: "The total is 3",
      A4: "bob@example.com",
    });
    expect(effects).toEqual([
      {
        type: "sendEmail",
        to: ["ada@example.com"],
        cc: ["bob@example.com"],
        subject: "Hello",
        body: "The total is 3",
      },
    ]);
  });

  it("defaults to no cc", () => {
    expect(clickFormula('=BUTTON("x", SEND_EMAIL("a@b.co", "s", "b"))')).toMatchObject([
      { cc: [] },
    ]);
  });

  it("splits recipients on commas and semicolons and drops blanks", () => {
    expect(
      clickFormula('=BUTTON("x", SEND_EMAIL(" a@b.co, c@d.co;e@f.co ; ", "s", "b", "g@h.co,"))'),
    ).toMatchObject([{ to: ["a@b.co", "c@d.co", "e@f.co"], cc: ["g@h.co"] }]);
  });

  it("converts numbers in the subject and body to text", () => {
    expect(
      clickFormula('=BUTTON("x", SEND_EMAIL("a@b.co", 2+2, "Total: " & A1))', { A1: "=0.1+0.2" }),
    ).toMatchObject([{ subject: "4", body: "Total: 0.3" }]);
  });

  it("allows an empty subject and body", () => {
    expect(clickFormula('=BUTTON("x", SEND_EMAIL("a@b.co", A8, A9))')).toMatchObject([
      { subject: "", body: "" },
    ]);
  });

  it.each([
    ['SEND_EMAIL("", "s", "b")', "#VALUE!", "SEND_EMAIL needs a recipient"],
    ['SEND_EMAIL(A9, "s", "b")', "#VALUE!", "SEND_EMAIL needs a recipient"],
    [
      'SEND_EMAIL("not an address", "s", "b")',
      "#VALUE!",
      '"not an address" is not an email address',
    ],
    ['SEND_EMAIL("a@b.co, nope", "s", "b")', "#VALUE!", '"nope" is not an email address'],
    ['SEND_EMAIL("a@b.co", "s", "b", "nope")', "#VALUE!", '"nope" is not an email address'],
    ['SEND_EMAIL(1/0, "s", "b")', "#DIV/0!", "Division by zero"],
    ['SEND_EMAIL("a@b.co", 1/0, "b")', "#DIV/0!", "Division by zero"],
    ['SEND_EMAIL("a@b.co", "s", 1/0)', "#DIV/0!", "Division by zero"],
    ['SEND_EMAIL("a@b.co", "s", "b", 1/0)', "#DIV/0!", "Division by zero"],
    ['SEND_EMAIL("a@b.co", "s", A1:A2)', "#VALUE!", "Expected a single value"],
  ])("refuses %s", (action, code, message) => {
    expect(clickFormula(`=BUTTON("x", ${action})`)).toEqual({ kind: "error", code, message });
  });
});

describe("APPEND_ROW", () => {
  it("writes the values into the first row after the last one with content", () => {
    const effects = clickFormula('=BUTTON("Add", APPEND_ROW(A:C, "pear", 1 + 1, TRUE))', {
      A1: "name",
      B1: "count",
      A2: "apple",
      C2: "x",
    });
    expect(effects).toEqual([
      { type: "ensureRows", tableId: "t1", rowCount: 3 },
      { type: "setCell", tableId: "t1", row: 2, col: 0, input: "pear" },
      { type: "setCell", tableId: "t1", row: 2, col: 1, input: "2" },
      { type: "setCell", tableId: "t1", row: 2, col: 2, input: "TRUE" },
    ]);
  });

  it("starts at the top of an empty range, and at the range's own first row and column", () => {
    expect(clickFormula('=BUTTON("Add", APPEND_ROW(B5:D, "x"))', { A1: "outside" })).toEqual([
      { type: "ensureRows", tableId: "t1", rowCount: 5 },
      { type: "setCell", tableId: "t1", row: 4, col: 1, input: "x" },
    ]);
  });

  it("adds to a range in another table, and spreads an array over cells", () => {
    const workbook = workbookWith({
      t1: { A1: "a", B1: "b", E1: '=BUTTON("Log", APPEND_ROW(\'Other Table\'!A:C, A1:B1, "end"))' },
      t2: { A1: "first" },
    });
    expect(click(workbook, "E1")).toEqual([
      { type: "ensureRows", tableId: "t2", rowCount: 2 },
      { type: "setCell", tableId: "t2", row: 1, col: 0, input: "a" },
      { type: "setCell", tableId: "t2", row: 1, col: 1, input: "b" },
      { type: "setCell", tableId: "t2", row: 1, col: 2, input: "end" },
    ]);
  });

  it("counts a cell that an array formula fills as content", () => {
    expect(
      clickFormula('=BUTTON("Add", APPEND_ROW(A:A, "next"))', { A1: "=SEQUENCE(3)" }),
    ).toMatchObject([{ rowCount: 4 }, { row: 3, input: "next" }]);
  });

  it.each([
    ['APPEND_ROW(A1:B1, "x")', "#VALUE!", "The range has no empty row left"],
    ["APPEND_ROW(A:B, 1, 2, 3)", "#VALUE!", "APPEND_ROW was given 3 values for 2 columns"],
    ['APPEND_ROW("A:B", 1)', "#VALUE!", "APPEND_ROW needs a range to add the row to"],
    ["APPEND_ROW(Missing!A:B, 1)", "#REF!", "The range to add the row to does not exist"],
    ["APPEND_ROW(A:B, 1/0)", "#DIV/0!", "Division by zero"],
  ])("refuses %s", (action, code, message) => {
    expect(clickFormula(`=BUTTON("x", ${action})`, { A1: "taken", B1: "taken" })).toEqual({
      kind: "error",
      code,
      message,
    });
  });
});

describe("CLEAR", () => {
  it("empties the cells of the range that hold something typed, and only those", () => {
    const effects = clickFormula('=BUTTON("Reset", CLEAR(A1:B2))', {
      A1: "x",
      B2: "=1+1",
      C1: "outside",
    });
    expect(effects).toEqual([
      { type: "setCell", tableId: "t1", row: 0, col: 0, input: "" },
      { type: "setCell", tableId: "t1", row: 1, col: 1, input: "" },
    ]);
  });

  it("empties a whole column or a single cell", () => {
    expect(
      clickFormula('=BUTTON("Reset", CLEAR(A:A))', { A1: "x", A9: "y", B1: "z" }),
    ).toHaveLength(2);
    expect(clickFormula('=BUTTON("Reset", CLEAR(B1))', { A1: "x", B1: "z" })).toEqual([
      { type: "setCell", tableId: "t1", row: 0, col: 1, input: "" },
    ]);
    expect(clickFormula('=BUTTON("Reset", CLEAR(D1:D9))')).toEqual([]);
  });

  it.each([
    ["CLEAR(5)", "#VALUE!"],
    ["CLEAR(Missing!A1)", "#REF!"],
  ])("refuses %s with %s", (action, code) => {
    expect(clickFormula(`=BUTTON("x", ${action})`)).toMatchObject({ kind: "error", code });
  });
});

describe("DO", () => {
  it("combines the effects of several actions, in order", () => {
    const effects = clickFormula(
      '=BUTTON("Submit", DO(APPEND_ROW(D:E, A1, A2), CLEAR(A1:A2), SEND_EMAIL("a@b.co", "New", A1)))',
      { A1: "pear", A2: "3" },
    );
    expect(effects).toEqual([
      { type: "ensureRows", tableId: "t1", rowCount: 1 },
      { type: "setCell", tableId: "t1", row: 0, col: 3, input: "pear" },
      { type: "setCell", tableId: "t1", row: 0, col: 4, input: "3" },
      { type: "setCell", tableId: "t1", row: 0, col: 0, input: "" },
      { type: "setCell", tableId: "t1", row: 1, col: 0, input: "" },
      { type: "sendEmail", to: ["a@b.co"], cc: [], subject: "New", body: "pear" },
    ]);
  });

  it("lets every action read the cells as they were before the click", () => {
    const effects = clickFormula('=BUTTON("Swap", DO(EXECUTE(A2, A1), EXECUTE(A1, A2)))', {
      A1: "one",
      A2: "two",
    });
    expect(effects).toMatchObject([
      { row: 0, input: "two" },
      { row: 1, input: "one" },
    ]);
  });

  it("nests, and takes an action chosen by a formula", () => {
    expect(
      clickFormula(
        '=BUTTON("Go", DO(DO(EXECUTE(1, B1)), IF(A1 > 0, EXECUTE(2, B2), EXECUTE(3, B3))))',
        {
          A1: "5",
        },
      ),
    ).toMatchObject([
      { row: 0, input: "1" },
      { row: 1, input: "2" },
    ]);
  });

  it("does nothing at all when one of its actions cannot run", () => {
    expect(clickFormula('=BUTTON("Go", DO(EXECUTE(1, B1), EXECUTE(1/0, B2)))')).toMatchObject({
      kind: "error",
      code: "#DIV/0!",
    });
  });

  it.each([
    ["DO(5)", "#VALUE!", "DO takes actions such as EXECUTE or SEND_EMAIL"],
    ["DO(1/0)", "#DIV/0!", "Division by zero"],
  ])("refuses %s", (action, code, message) => {
    expect(clickFormula(`=BUTTON("x", ${action})`)).toEqual({ kind: "error", code, message });
  });
});

describe("INSERT, UPDATE, and OVERWRITE", () => {
  // The data to write is in A:B, and the range written to is D:E.
  const DATA = { A1: "ann", B1: "1", A2: "bob", B2: "2" };
  const set = (address: string, input: string) => ({ type: "setCell", ...at(address), input });
  const grow = (rowCount: number) => ({ type: "ensureRows", tableId: "t1", rowCount });

  it("INSERT adds every row of the data after the content of the range", () => {
    expect(
      clickFormula('=BUTTON("Go", INSERT(A1:B2, D:E))', {
        ...DATA,
        D1: "name",
        E1: "n",
        D2: "zed",
        E2: "9",
      }),
    ).toEqual([grow(4), set("D3", "ann"), set("E3", "1"), set("D4", "bob"), set("E4", "2")]);
  });

  it("INSERT starts at the top of an empty range, and skips empty rows of the data", () => {
    expect(clickFormula('=BUTTON("Go", INSERT(A:B, D:E))', DATA)).toEqual([
      grow(2),
      set("D1", "ann"),
      set("E1", "1"),
      set("D2", "bob"),
      set("E2", "2"),
    ]);
    expect(clickFormula('=BUTTON("Go", INSERT(A5:B9, D:E))', DATA)).toEqual([]);
  });

  it("UPDATE writes over the row with the same key, and adds the rows with new keys", () => {
    const effects = clickFormula('=BUTTON("Go", UPDATE(A1:B2, 1, D:E))', {
      ...DATA,
      D1: "name",
      E1: "n",
      D2: "BOB",
      E2: "old",
    });
    expect(effects).toEqual([
      set("D2", "bob"),
      set("E2", "2"),
      grow(3),
      set("D3", "ann"),
      set("E3", "1"),
    ]);
  });

  it("UPDATE matches on several key columns together", () => {
    const effects = clickFormula('=BUTTON("Go", UPDATE(A1:B2, VSTACK(1, 2), D:E))', {
      ...DATA,
      D1: "ann",
      E1: "1",
      D2: "bob",
      E2: "7",
    });
    // ann/1 is there already and is written over with the same values. bob/2 is new.
    expect(effects).toEqual([
      set("D1", "ann"),
      set("E1", "1"),
      grow(3),
      set("D3", "bob"),
      set("E3", "2"),
    ]);
  });

  it("UPDATE keeps the last of two data rows with one key, and never matches an empty key", () => {
    expect(
      clickFormula('=BUTTON("Go", UPDATE(A1:B3, 1, D:E))', {
        A1: "ann",
        B1: "1",
        A2: "ann",
        B2: "2",
        B3: "3",
      }),
    ).toEqual([grow(2), set("D1", "ann"), set("E1", "2"), set("D2", ""), set("E2", "3")]);
  });

  it("OVERWRITE empties the range and writes the data from its first row", () => {
    const effects = clickFormula('=BUTTON("Go", OVERWRITE(A1:B2, D:E))', {
      ...DATA,
      D1: "old",
      D3: "old too",
      E5: "and this",
    });
    expect(effects).toEqual([
      set("D3", ""),
      set("E5", ""),
      grow(2),
      set("D1", "ann"),
      set("E1", "1"),
      set("D2", "bob"),
      set("E2", "2"),
    ]);
  });

  it("OVERWRITE with no data only empties the range", () => {
    expect(clickFormula('=BUTTON("Go", OVERWRITE(A5:B9, D:E))', { D1: "old" })).toEqual([
      set("D1", ""),
    ]);
  });

  it("write the result of a formula, such as a query", () => {
    expect(clickFormula('=BUTTON("Go", INSERT(FILTER(A1:B2, B1:B2 > 1), D:E))', DATA)).toEqual([
      grow(1),
      set("D1", "bob"),
      set("E1", "2"),
    ]);
  });

  it.each([
    ['=BUTTON("Go", INSERT(A1:C2, D:E))', "#VALUE!", "INSERT was given 3 columns for a range of 2"],
    ['=BUTTON("Go", INSERT(A1:B2, 5))', "#VALUE!", "INSERT needs a range to write to"],
    ['=BUTTON("Go", INSERT(A1:B2, Missing!A:B))', "#REF!", "The range to write to does not exist"],
    ['=BUTTON("Go", INSERT(A1:B2, D1:E1))', "#VALUE!", "The range has too few empty rows left"],
    ['=BUTTON("Go", UPDATE(A1:B2, 3, D:E))', "#VALUE!", "The key columns must be between 1 and 2"],
    ['=BUTTON("Go", UPDATE(A1:B2, 0, D:E))', "#VALUE!", "The key columns must be between 1 and 2"],
    ['=BUTTON("Go", OVERWRITE(1/0, D:E))', "#DIV/0!", undefined],
  ])("%s fails with %s", (formula, code, message) => {
    expect(clickFormula(formula, { ...DATA, C1: "x" })).toMatchObject({
      code,
      ...(message === undefined ? {} : { message }),
    });
  });
});
