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
