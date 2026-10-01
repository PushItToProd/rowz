import { describe, expect, it } from "vitest";
import type { Effect } from "../effects";
import { at, workbookWith } from "../testing";
import { formatValue, isControl, type ControlValue, type ErrorValue, type Scalar } from "../values";
import type { Workbook } from "../workbook";

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

  it("treats a target that holds an error or a button as empty", () => {
    const workbook = workbookWith({ t1: { A1: "=1/0", B1: "=CHECKBOX(A1)" } });
    expect(control(workbook, "B1").value).toBeNull();
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
      code: "#CYCLE!",
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
    expect(choose(workbook, "C1", "TEN")).toMatchObject([{ input: "TEN" }]);
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
