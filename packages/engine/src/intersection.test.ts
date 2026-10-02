import { describe, expect, it } from "vitest";
import { at, workbookWith } from "./testing";

const DATA = { A1: "1", A2: "2", A3: "3", B1: "10", B2: "20", B3: "30", C1: "x" };

function valueAt(address: string, formula: string, extra: Record<string, string> = {}) {
  return workbookWith({ t1: { ...DATA, ...extra, [address]: formula } }).getValue(at(address));
}

describe("a whole column or row as an operand", () => {
  it("means the cell of that column in the formula's own row", () => {
    expect(valueAt("D1", "=A:A + B:B")).toBe(11);
    expect(valueAt("D2", "=A:A + B:B")).toBe(22);
    expect(valueAt("D3", "=A:A * B:B - 1")).toBe(89);
    expect(valueAt("D2", "=-A:A")).toBe(-2);
    expect(valueAt("D2", '=A:A & "!"')).toBe("2!");
    expect(valueAt("D3", "=A:A > 2")).toBe(true);
    expect(valueAt("D2", "=$A:$A * 2")).toBe(4);
  });

  it("does not fill other cells", () => {
    const workbook = workbookWith({ t1: { ...DATA, D1: "=A:A + B:B" } });
    expect(workbook.getArray(at("D1"))).toEqual([[11]]);
    expect(workbook.getValue(at("D2"))).toBeNull();
  });

  it("lets one formula serve every row", () => {
    const workbook = workbookWith({
      t1: { ...DATA, D1: "=A:A + B:B", D2: "=A:A + B:B", D3: "=A:A + B:B" },
    });
    expect(["D1", "D2", "D3"].map((address) => workbook.getValue(at(address)))).toEqual([
      11, 22, 33,
    ]);
    workbook.setCell(at("A2"), "5");
    expect(workbook.getValue(at("D2"))).toBe(25);
  });

  it("works inside a function, for the function's own arguments", () => {
    expect(valueAt("D2", '=IF(A:A > 1, "big", "small")')).toBe("big");
    expect(valueAt("D1", '=IF(A:A > 1, "big", "small")')).toBe("small");
    expect(valueAt("D3", "=ROUND(B:B / A:A, 1)")).toBe(10);
  });

  it("means the cell of a whole row in the formula's own column", () => {
    expect(valueAt("A5", "=1:1 + 2:2")).toBe(3);
    expect(valueAt("B5", "=1:1 + 2:2")).toBe(30);
  });

  it("takes this row of each column when the reference spans several", () => {
    const workbook = workbookWith({ t1: { ...DATA, D2: "=A:B * 2" } });
    expect(workbook.getArray(at("D2"))).toEqual([[4, 40]]);
    expect(workbook.getValue(at("E2"))).toBe(40);
  });

  it("reads the same row of another table", () => {
    const workbook = workbookWith({ t1: DATA, t2: { A2: "=Table1!A:A * 100" } });
    expect(workbook.getValue(at("A2", "t2"))).toBe(200);
  });

  it("leaves a whole column whole where it is not an operand", () => {
    expect(valueAt("D3", "=SUM(A:A)")).toBe(6);
    expect(valueAt("D3", "=SUMPRODUCT(A:A, B:B)")).toBe(140);
    expect(valueAt("D3", "=COUNTA(A:B)")).toBe(6);
  });

  it("leaves a range with a row in it as the cells it names", () => {
    const workbook = workbookWith({ t1: { ...DATA, D1: "=A1:A3 * 2", E1: "=SUM(A1:A * B1:B)" } });
    expect(workbook.getArray(at("D1"))).toEqual([[2], [4], [6]]);
    expect(workbook.getValue(at("E1"))).toBe(140);
  });

  it("takes one row's product when whole columns are multiplied inside SUM", () => {
    expect(valueAt("D2", "=SUM(A:A * B:B)")).toBe(40);
  });

  it("is a cycle when the formula is in the column it reads", () => {
    expect(valueAt("A5", "=A:A + 1")).toMatchObject({ code: "#CYCLE!" });
  });

  it("depends only on the cell it reads", () => {
    // A2 reads the formula in the other table, which reads row 1 of column A and not A2.
    const workbook = workbookWith({
      t1: { A1: "1", A2: "='Other Table'!A1 + 1", B1: "5", C3: "=1:1 + D3", D3: "7" },
      t2: { A1: "=Table1!A:A + 1", C1: "=-Table1!A:A" },
    });
    expect(workbook.getValue(at("A1", "t2"))).toBe(2);
    expect(workbook.getValue(at("A2"))).toBe(3);
    // C3 reads C1 of row 1, which is empty, and not B1.
    expect(workbook.getValue(at("C3"))).toBe(7);
    expect(workbook.getValue(at("C1", "t2"))).toBe(-1);

    workbook.setCell(at("A1"), "10");
    expect(workbook.getValue(at("A1", "t2"))).toBe(11);
    expect(workbook.getValue(at("A2"))).toBe(12);
    expect(workbook.getValue(at("C1", "t2"))).toBe(-10);
    workbook.setCell(at("C1"), "100");
    expect(workbook.getValue(at("C3"))).toBe(107);
  });

  it("is not a cycle when a cell in another row of the column reads the formula", () => {
    const workbook = workbookWith({ t1: { A1: "1", B1: "=A:A + 1", A2: "=B1 + 1" } });
    expect(workbook.getValue(at("B1"))).toBe(2);
    expect(workbook.getValue(at("A2"))).toBe(3);
  });

  it("fails when the other table has no such row, or does not exist", () => {
    const workbook = workbookWith({
      t1: DATA,
      t2: { A9: "=Table1!A:A * 2", A1: "=Missing!A:A * 2" },
    });
    expect(workbook.getValue(at("A9", "t2"))).toMatchObject({
      code: "#VALUE!",
      message: "Table1!A:A has no row 9",
    });
    expect(workbook.getValue(at("A1", "t2"))).toMatchObject({ code: "#REF!" });
  });

  it("stays a whole column in a formula that is not in a cell", () => {
    const workbook = workbookWith({ t1: DATA });
    expect(workbook.evaluateOnPage("p1", "SUM(Table1!A:A * Table1!B:B)")).toBe(140);
  });
});
