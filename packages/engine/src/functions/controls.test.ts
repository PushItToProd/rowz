import { describe, expect, it } from "vitest";
import type { Effect } from "../effects";
import { at, STRUCTURE, workbookWith } from "../testing";
import { formatValue, isControl, type ControlValue, type ErrorValue, type Scalar } from "../values";
import { Workbook } from "../workbook";

function control(workbook: Workbook, address: string): ControlValue {
  const value = workbook.getValue(at(address));
  if (!isControl(value)) throw new Error(`${address} is not a control`);
  return value;
}

function choose(workbook: Workbook, address: string, value: Scalar): Effect[] | ErrorValue {
  const plan = workbook.planInput(control(workbook, address), value);
  return plan.ok ? plan.effects : plan.error;
}

describe("CHECKBOX", () => {
  it("shows the target cell's value, with a label", () => {
    const workbook = workbookWith({
      t1: { A1: "TRUE", B1: '=CHECKBOX(A1, "Done")', B2: "=CHECKBOX(A2)" },
    });
    expect(control(workbook, "B1")).toEqual({
      kind: "control",
      control: "checkbox",
      target: at("A1"),
      value: true,
      options: [],
      label: "Done",
    });
    expect(control(workbook, "B2")).toMatchObject({ value: null, label: "", target: at("A2") });
    expect(formatValue(control(workbook, "B1"))).toBe("Done");
  });

  it("follows the target cell", () => {
    const workbook = workbookWith({ t1: { A1: "FALSE", B1: "=CHECKBOX(A1)" } });
    expect(control(workbook, "B1").value).toBe(false);
    workbook.setCell(at("A1"), "TRUE");
    expect(control(workbook, "B1").value).toBe(true);
  });

  it("plans a write of TRUE or FALSE to the target cell", () => {
    const workbook = workbookWith({ t1: { B1: "=CHECKBOX('Other Table'!C3)" } });
    expect(choose(workbook, "B1", true)).toEqual([
      { type: "setCell", tableId: "t2", row: 2, col: 2, input: "TRUE" },
    ]);
    expect(choose(workbook, "B1", false)).toMatchObject([{ input: "FALSE" }]);
  });

  it.each<[Scalar]>([["yes"], [1], [null]])("refuses the value %j", (value) => {
    const workbook = workbookWith({ t1: { B1: "=CHECKBOX(A1)" } });
    expect(choose(workbook, "B1", value)).toEqual({
      kind: "error",
      code: "#VALUE!",
      message: "A checkbox takes TRUE or FALSE",
    });
  });

  it("refuses a formula target even when its result is an error or button", () => {
    const errorTarget = workbookWith({ t1: { A1: "=1/0", B1: "=CHECKBOX(A1)" } }).getValue(
      at("B1"),
    );
    const buttonTarget = workbookWith({
      t1: { A1: '=BUTTON("Go", EXECUTE(1, B1))', C1: "=CHECKBOX(A1)" },
    }).getValue(at("C1"));
    expect(errorTarget).toMatchObject({ kind: "error", code: "#VALUE!" });
    expect(buttonTarget).toMatchObject({ kind: "error", code: "#VALUE!" });
  });

  it.each([
    ["=CHECKBOX(A1:A2)", "#VALUE!", "CHECKBOX needs a single cell to read and write"],
    ["=CHECKBOX(TRUE)", "#VALUE!", "CHECKBOX needs a single cell to read and write"],
    ["=CHECKBOX(Missing!A1)", "#REF!", "The cell to read and write does not exist"],
    ["=CHECKBOX(A1, 1/0)", "#DIV/0!", "Division by zero"],
    ["=CHECKBOX()", "#ERROR!", "CHECKBOX takes 1 to 2 arguments"],
  ])("%s is %s", (formula, code, message) => {
    expect(workbookWith({ t1: { Z9: formula } }).getValue(at("Z9"))).toEqual({
      kind: "error",
      code,
      message,
    });
  });

  it("cannot be bound to its own cell", () => {
    expect(workbookWith({ t1: { A1: "=CHECKBOX(A1)" } }).getValue(at("A1"))).toMatchObject({
      code: "#VALUE!",
      message: "A1 has a formula and cannot be used as a control target",
    });
  });

  it("refuses a formula cell as its target", () => {
    expect(
      workbookWith({ t1: { A1: "=1", B1: "=CHECKBOX(A1)" } }).getValue(at("B1")),
    ).toMatchObject({
      code: "#VALUE!",
      message: "A1 has a formula and cannot be used as a control target",
    });
  });
});

describe("DROPDOWN", () => {
  it("takes its choices from a range, without blanks or repeats", () => {
    const workbook = workbookWith({
      t1: {
        A1: "low",
        A2: "",
        A3: "high",
        A4: "LOW",
        A5: "3",
        B1: "high",
        C1: "=DROPDOWN(A1:A5, B1)",
      },
    });
    expect(control(workbook, "C1")).toMatchObject({
      control: "dropdown",
      options: ["low", "high", 3],
      value: "high",
      target: at("B1"),
    });
    expect(formatValue(control(workbook, "C1"))).toBe("high");
  });

  it("takes its choices from text with commas between them", () => {
    const workbook = workbookWith({ t1: { C1: '=DROPDOWN("low, medium , high", B1)' } });
    expect(control(workbook, "C1").options).toEqual(["low", "medium", "high"]);
  });

  it("follows its range of choices and its target", () => {
    const workbook = workbookWith({ t1: { A1: "a", C1: "=DROPDOWN(A1:A3, B1)" } });
    workbook.setCell(at("A2"), "b");
    workbook.setCell(at("B1"), "b");
    expect(control(workbook, "C1")).toMatchObject({ options: ["a", "b"], value: "b" });
  });

  it("plans a write of the chosen value, keeping its type", () => {
    const workbook = workbookWith({
      t1: { A1: "10", A2: "ten", A3: "'10", C1: "=DROPDOWN(A1:A3, B1)" },
    });
    expect(choose(workbook, "C1", 10)).toEqual([
      { type: "setCell", tableId: "t1", row: 0, col: 1, input: "10" },
    ]);
    expect(choose(workbook, "C1", "ten")).toMatchObject([{ input: "ten" }]);
    expect(choose(workbook, "C1", "10")).toMatchObject([{ input: "'10" }]);
    // The choice is written as the list has it, whatever letter case was sent.
    expect(choose(workbook, "C1", "TEN")).toMatchObject([{ input: "ten" }]);
  });

  it("accepts a date choice given as the text it is written as", () => {
    const workbook = workbookWith({
      t1: { A1: "2026-09-30", A2: "2026-10-01", C1: "=DROPDOWN(A1:A2, B1)" },
    });
    expect(choose(workbook, "C1", "2026-10-01")).toMatchObject([{ input: "2026-10-01" }]);
    expect(choose(workbook, "C1", "2026-12-25")).toMatchObject({ code: "#VALUE!" });
  });

  it("clears the target when nothing is chosen", () => {
    const workbook = workbookWith({ t1: { B1: "x", C1: '=DROPDOWN("x, y", B1)' } });
    expect(choose(workbook, "C1", null)).toMatchObject([{ input: "" }]);
  });

  it("refuses a value that is not one of the choices", () => {
    const workbook = workbookWith({ t1: { C1: '=DROPDOWN("x, y", B1)' } });
    expect(choose(workbook, "C1", "z")).toEqual({
      kind: "error",
      code: "#VALUE!",
      message: "z is not one of the choices",
    });
    expect(choose(workbook, "C1", true)).toMatchObject({ code: "#VALUE!" });
  });

  it.each([
    ["=DROPDOWN(D1:D3, B1)", "#VALUE!", "DROPDOWN needs at least one choice"],
    ['=DROPDOWN("a, b", B1:B2)', "#VALUE!", "DROPDOWN needs a single cell to read and write"],
    ["=DROPDOWN(1/0, B1)", "#DIV/0!", "Division by zero"],
  ])("%s is %s", (formula, code, message) => {
    expect(workbookWith({ t1: { Z9: formula } }).getValue(at("Z9"))).toEqual({
      kind: "error",
      code,
      message,
    });
  });
});

describe("text and number controls in typed columns", () => {
  it.each(["TEXTBOX", "NUMBERBOX"])("validates %s against the target column", (name) => {
    const workbook = new Workbook();
    workbook.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) =>
        table.id === "t1"
          ? {
              ...table,
              rowCount: 1,
              colCount: 5,
              columns: [
                { name: "Text", type: "text" },
                { name: "Number", type: "number" },
                { name: "Date", type: "date" },
                { name: "Control", type: "any" },
                { name: "Other control", type: "any" },
              ] as const,
            }
          : table,
      ),
    });
    workbook.setCell(at("A1"), "original");
    workbook.setCell(at("B1"), "12");
    workbook.setCell(at("D1"), `=${name}(A1)`);
    workbook.setCell(at("E1"), `=${name}(B1)`);
    const textPlan = workbook.planInput(control(workbook, "D1"), "007");
    expect(textPlan).toMatchObject({ ok: true });
    if (!textPlan.ok) throw new Error("Expected a write");
    for (const effect of textPlan.effects) {
      if (effect.type === "setCell") workbook.setCell(effect, effect.input);
    }
    expect(workbook.getValue(at("A1"))).toBe(name === "TEXTBOX" ? "007" : "7");
    expect(choose(workbook, "E1", "007")).toMatchObject([
      { input: name === "TEXTBOX" ? "'007" : "7" },
    ]);
    expect(choose(workbook, "E1", "abc")).toMatchObject({
      code: "#VALUE!",
      message: name === "TEXTBOX" ? "Number: abc is not a number" : "A number box takes a number",
    });
    expect(workbook.getValue(at("B1"))).toBe(12);
    expect(choose(workbook, "E1", "")).toMatchObject([{ input: "" }]);
    workbook.setCell(at("E1"), `=${name}(C1)`);
    expect(choose(workbook, "E1", "7")).toMatchObject({
      code: "#VALUE!",
      message: "Date: " + (name === "TEXTBOX" ? "'7" : "7") + " is not a date",
    });
  });
});

describe("TEXTBOX", () => {
  it("shows the target value and label, and writes committed text as text", () => {
    const workbook = workbookWith({ t1: { A1: "'123", B1: '=TEXTBOX(A1, "Name")' } });
    expect(control(workbook, "B1")).toMatchObject({
      control: "textbox",
      target: at("A1"),
      value: "123",
      label: "Name",
    });
    expect(choose(workbook, "B1", "456")).toMatchObject([{ input: "'456" }]);
    expect(choose(workbook, "B1", "")).toMatchObject([{ input: "" }]);
    expect(choose(workbook, "B1", 4)).toMatchObject({
      code: "#VALUE!",
      message: "A text box takes text",
    });
  });

  it("refuses a formula target", () => {
    expect(workbookWith({ t1: { A1: "=1", B1: "=TEXTBOX(A1)" } }).getValue(at("B1"))).toMatchObject(
      {
        kind: "error",
        code: "#VALUE!",
        message: "A1 has a formula and cannot be used as a control target",
      },
    );
  });
});

describe("NUMBERBOX", () => {
  it("shows the target value, parses a committed number, and clears on empty", () => {
    const workbook = workbookWith({ t1: { A1: "1.5", B1: '=NUMBERBOX(A1, "Count")' } });
    expect(control(workbook, "B1")).toMatchObject({
      control: "numberbox",
      target: at("A1"),
      value: 1.5,
      label: "Count",
    });
    expect(choose(workbook, "B1", "12.25")).toEqual([
      { type: "setCell", tableId: "t1", row: 0, col: 0, input: "12.25" },
    ]);
    expect(choose(workbook, "B1", "")).toMatchObject([{ input: "" }]);
    expect(choose(workbook, "B1", "many")).toMatchObject({
      code: "#VALUE!",
      message: "A number box takes a number",
    });
  });

  it("refuses a formula-column target", () => {
    const workbook = new Workbook();
    workbook.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) =>
        table.id === "t1"
          ? {
              ...table,
              rowCount: 2,
              colCount: 2,
              columns: [
                { name: "Computed", type: "formula", formula: "=1" },
                { name: "Input", type: "any" },
              ],
            }
          : table,
      ),
    });
    workbook.setCell(at("B1"), "=NUMBERBOX(A1)");
    expect(workbook.getValue(at("B1"))).toMatchObject({
      kind: "error",
      code: "#VALUE!",
      message: "Computed is a formula column and cannot be written to",
    });
  });
});
