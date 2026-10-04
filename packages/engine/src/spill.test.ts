import { describe, expect, it } from "vitest";
import { at, STRUCTURE, workbookWith } from "./testing";
import type { CellValue } from "./values";
import type { Workbook } from "./workbook";

function values(workbook: Workbook, addresses: string[], tableId = "t1"): CellValue[] {
  return addresses.map((address) => workbook.getValue(at(address, tableId)));
}

function expectError(value: CellValue, code: string, message?: string): void {
  expect(value).toMatchObject({ kind: "error", code });
  if (message !== undefined) expect(value).toMatchObject({ message });
}

describe("a formula whose result is an array", () => {
  it("shows the first value in its own cell and fills the cells below and beside it", () => {
    const workbook = workbookWith({ t1: { A1: "=SEQUENCE(2, 3)" } });
    expect(values(workbook, ["A1", "B1", "C1", "A2", "B2", "C2"])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(values(workbook, ["D1", "A3"])).toEqual([null, null]);
    expect(workbook.getArray(at("A1"))).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
  });

  it("leaves the filled cells without input, and says which formula filled them", () => {
    const workbook = workbookWith({ t1: { B2: "=SEQUENCE(2)" } });
    expect(workbook.getInput(at("B3"))).toBe("");
    expect(workbook.spillAnchor(at("B3"))).toEqual(at("B2"));
    expect(workbook.spillAnchor(at("B2"))).toBeUndefined();
    expect(workbook.spillAnchor(at("B4"))).toBeUndefined();
  });

  it("gives one cell for a formula with a single value", () => {
    const workbook = workbookWith({ t1: { A1: "=1+1", A2: "text" } });
    expect(workbook.getArray(at("A1"))).toEqual([[2]]);
    expect(workbook.getArray(at("A2"))).toEqual([["text"]]);
    expect(workbook.getArray(at("A3"))).toEqual([[null]]);
  });

  it("lets other formulas read the filled cells, one at a time or as a range", () => {
    const workbook = workbookWith({
      t1: { A1: "=SEQUENCE(3)", C1: "=A3 * 10", C2: "=SUM(A1:A3)", C3: "=SUM(A:A)" },
      t2: { A1: "=Table1!A2 + 1" },
    });
    expect(values(workbook, ["C1", "C2", "C3"])).toEqual([30, 6, 6]);
    expect(workbook.getValue(at("A1", "t2"))).toBe(3);
  });

  it("gives the same values whichever cell is read first", () => {
    const cells = { t1: { C1: "=A3 * 10", A1: "=SEQUENCE(3)", D1: "=C1 + A2" } };
    for (const first of ["C1", "A1", "D1", "A3"]) {
      const workbook = workbookWith(cells);
      workbook.getValue(at(first));
      expect(values(workbook, ["C1", "D1", "A3"])).toEqual([30, 32, 3]);
    }
  });

  it("refills when the array changes size, and updates the readers", () => {
    const workbook = workbookWith({ t1: { A1: "3", B1: "=SEQUENCE(A1)", C1: "=SUM(B:B)" } });
    expect(values(workbook, ["B1", "B2", "B3", "B4", "C1"])).toEqual([1, 2, 3, null, 6]);

    workbook.setCell(at("A1"), "1");
    expect(values(workbook, ["B1", "B2", "B3", "C1"])).toEqual([1, null, null, 1]);
    expect(workbook.spillAnchor(at("B2"))).toBeUndefined();

    workbook.setCell(at("A1"), "4");
    expect(values(workbook, ["B4", "C1"])).toEqual([4, 10]);
  });

  it("empties the filled cells when the formula is cleared or replaced", () => {
    const workbook = workbookWith({ t1: { A1: "=SEQUENCE(3)", C1: "=A3" } });
    expect(workbook.getValue(at("C1"))).toBe(3);
    workbook.setCell(at("A1"), "just text");
    expect(values(workbook, ["A1", "A2", "A3", "C1"])).toEqual(["just text", null, null, null]);
    workbook.setCell(at("A1"), "=SEQUENCE(3, 1, 10)");
    workbook.setCell(at("A1"), "");
    expect(values(workbook, ["A1", "A2", "A3"])).toEqual([null, null, null]);
  });

  it("feeds one array formula from another", () => {
    const workbook = workbookWith({
      t1: { A1: "=SEQUENCE(4)", C1: "=FILTER(A1:A4, A1:A4 > 2)", E1: "=SUM(C:C)" },
    });
    expect(values(workbook, ["C1", "C2", "C3", "E1"])).toEqual([3, 4, null, 7]);
  });

  it("settles a chain of array formulas entered in the least helpful order", () => {
    const workbook = workbookWith({
      t1: {
        G1: "=MAP(E1:E3, LAMBDA(v, v + 1))",
        E1: "=MAP(C1:C3, LAMBDA(v, v + 1))",
        C1: "=MAP(A1:A3, LAMBDA(v, v + 1))",
        A1: "=SEQUENCE(3)",
      },
    });
    expect(values(workbook, ["G1", "G2", "G3"])).toEqual([4, 5, 6]);
  });
});

describe("#SPILL!", () => {
  it("shows when cells in the result range already have values", () => {
    const workbook = workbookWith({ t1: { A1: "=SEQUENCE(3)", A3: "in the way" } });
    const spill = workbook.getValue(at("A1"));
    expectError(
      spill,
      "#SPILL!",
      "The result needs 3 rows and 1 column, but one or more cells in A1:A3 already have values.",
    );
    expect(spill).not.toHaveProperty("spill");
    expect(values(workbook, ["A2", "A3"])).toEqual([null, "in the way"]);
    expect(workbook.spillAnchor(at("A2"))).toBeUndefined();
  });

  it("clears once the cell in the way is emptied", () => {
    const workbook = workbookWith({
      t1: { A1: "=SEQUENCE(3)", A3: "in the way", C1: "=SUM(A:A)" },
    });
    expectError(workbook.getValue(at("C1")), "#SPILL!");
    workbook.setCell(at("A3"), "");
    expect(values(workbook, ["A1", "A2", "A3", "C1"])).toEqual([1, 2, 3, 6]);
  });

  it("appears when something is typed into a filled cell", () => {
    const workbook = workbookWith({ t1: { A1: "=SEQUENCE(3)", C1: "=A2" } });
    expect(workbook.getValue(at("C1"))).toBe(2);
    workbook.setCell(at("A2"), "typed");
    expectError(workbook.getValue(at("A1")), "#SPILL!");
    expect(values(workbook, ["A2", "A3", "C1"])).toEqual(["typed", null, "typed"]);
  });

  it("shows for the second of two arrays that need the same cell, and clears when the first goes", () => {
    const workbook = workbookWith({ t1: { A1: "=SEQUENCE(1, 3)", C1: "", B1: "" } });
    workbook.setCell(at("B2"), "=SEQUENCE(1, 2)");
    workbook.setCell(at("C1"), "");
    workbook.setCell(at("A2"), "=SEQUENCE(1, 3, 10)");
    expectError(workbook.getValue(at("A2")), "#SPILL!");
    expect(values(workbook, ["B2", "C2"])).toEqual([1, 2]);

    workbook.setCell(at("B2"), "");
    expect(values(workbook, ["A2", "B2", "C2"])).toEqual([10, 11, 12]);
  });

  it("keeps the originating table ID when a table-size spill propagates through a reference", () => {
    const workbook = workbookWith({
      t1: { A1: "=SEQUENCE(12)" },
      t2: { A1: "=Table1!A1" },
    });
    workbook.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) =>
        table.id === "t1" ? { ...table, rowCount: 11, colCount: 3 } : table,
      ),
    });

    expect(workbook.getValue(at("A1", "t2"))).toMatchObject({
      kind: "error",
      code: "#SPILL!",
      spill: {
        tableId: "t1",
        reason: "table-size",
        requiredRowCount: 12,
        requiredColumnCount: 1,
      },
    });
  });

  it("reports table dimensions without resize metadata when occupied cells also block the result", () => {
    const workbook = workbookWith({ t1: { A1: "=SEQUENCE(12, 26)", A2: "in the way" } });
    workbook.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) =>
        table.id === "t1" ? { ...table, rowCount: 11, colCount: 15 } : table,
      ),
    });
    const tooSmall = workbook.getValue(at("A1"));
    expectError(
      tooSmall,
      "#SPILL!",
      "The result needs 12 rows and 26 columns, but the table is only 11 rows and 15 columns.",
    );
    expect(tooSmall).not.toHaveProperty("spill");

    const small = workbookWith({ t1: { A2: "=SEQUENCE(3)" } });
    small.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) => ({ ...table, rowCount: 3, colCount: 2 })),
    });
    const offset = small.getValue(at("A2"));
    expectError(
      offset,
      "#SPILL!",
      "The result needs 3 rows and 1 column, but the table is only 3 rows and 2 columns.",
    );
    expect(offset).toMatchObject({
      spill: {
        tableId: "t1",
        reason: "table-size",
        requiredRowCount: 4,
        requiredColumnCount: 1,
      },
    });
    small.setCell(at("A2"), "=SEQUENCE(2, 2)");
    expect(small.getArray(at("A2"))).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe("cycles through filled cells", () => {
  it("marks a formula that reads a cell its own result fills", () => {
    const workbook = workbookWith({ t1: { A1: "=SEQUENCE(A2 + 2)" } });
    expectError(
      workbook.getValue(at("A1")),
      "#CYCLE!",
      "The formula reads a cell that its own result would fill",
    );
    expect(workbook.getValue(at("A2"))).toBeNull();
  });

  it("marks a formula that reads its filled cells through another cell", () => {
    const workbook = workbookWith({ t1: { A1: "=SEQUENCE(C1)", C1: "=A2 + 2" } });
    expectError(workbook.getValue(at("A1")), "#CYCLE!");
  });

  it("stops two arrays that keep changing each other's inputs", () => {
    const workbook = workbookWith({
      // A1 fills A2 only while D2 is empty, and D1 fills D2 only while A2 is filled.
      t1: {
        A1: "=IF(COUNTA(D2:D9) = 0, SEQUENCE(2), 1)",
        D1: "=IF(COUNTA(A2:A9) > 0, SEQUENCE(2), 1)",
      },
    });
    const [a, d] = values(workbook, ["A1", "D1"]);
    expect([a, d].some((value) => typeof value === "object" && value?.kind === "error")).toBe(true);
    // Reading again gives the same answer: the values are settled, not flickering.
    expect(values(workbook, ["A1", "D1"])).toEqual([a, d]);
  });
});

describe("operators on arrays", () => {
  it.each<[string, CellValue[][]]>([
    ["=A1:A3 * 2", [[2], [4], [6]]],
    ["=10 - A1:A3", [[9], [8], [7]]],
    ["=-A1:A3", [[-1], [-2], [-3]]],
    ["=A1:A3 + B1:B3", [[11], [22], [33]]],
    ["=A1:A3 > 1", [[false], [true], [true]]],
    ["=A1:A3 <> 1", [[false], [true], [true]]],
    ["=A1:A3 != 1", [[false], [true], [true]]],
    ['=A1:A3 & "!"', [["1!"], ["2!"], ["3!"]]],
    [
      "=A1:A3 * D1:E1",
      [
        [100, 200],
        [200, 400],
        [300, 600],
      ],
    ],
    ["=A1:B1 + 1", [[2, 11]]],
    [
      "=A1:A3 / F1:F3",
      [[{ kind: "error", code: "#DIV/0!", message: "Division by zero" }], [2], [3]],
    ],
  ])("%s gives %j", (formula, expected) => {
    const workbook = workbookWith({
      t1: {
        A1: "1",
        A2: "2",
        A3: "3",
        B1: "10",
        B2: "20",
        B3: "30",
        D1: "100",
        E1: "200",
        F2: "1",
        F3: "1",
      },
      t2: { A1: formula.replaceAll(/([A-Z]\d)/g, "Table1!$1").replaceAll(/:Table1!/g, ":") },
    });
    expect(workbook.getArray(at("A1", "t2"))).toEqual(expected);
  });

  it("marks cells with no partner when the arrays differ in size", () => {
    const workbook = workbookWith({
      t1: { A1: "1", A2: "2", A3: "3", B1: "10", B2: "20" },
      t2: { A1: "=Table1!A1:A3 + Table1!B1:B2" },
    });
    expect(workbook.getArray(at("A1", "t2"))).toMatchObject([[11], [22], [{ code: "#N/A" }]]);
  });

  it("fails as a whole when a single-value operand is an error", () => {
    const workbook = workbookWith({ t1: { A1: "1", A2: "2", C1: "=A1:A2 + 1/0" } });
    expectError(workbook.getValue(at("C1")), "#DIV/0!");
    expect(workbook.getValue(at("C2"))).toBeNull();
  });

  it("can be summed without filling any cells", () => {
    const workbook = workbookWith({
      t1: { A1: "1", A2: "2", A3: "3", B1: "10", B2: "20", B3: "30", C1: "=SUM(A1:A3 * B1:B3)" },
    });
    expect(workbook.getValue(at("C1"))).toBe(140);
    expect(workbook.getValue(at("C2"))).toBeNull();
  });
});
