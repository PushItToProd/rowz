import { describe, expect, it } from "vitest";
import type { Reference } from "./ast";
import { formatAddress } from "./address";
import {
  formulasAfterEdit,
  inputsAfterMove,
  inputsAfterRename,
  rewriteReferences,
  translateInput,
  type Move,
  type Rename,
  type StructuralEdit,
} from "./rewrite";
import { at, STRUCTURE } from "./testing";
import type { WorkbookData } from "./structure";
import { Workbook } from "./workbook";

/** Renames every table qualifier to `Renamed` and leaves unqualified references alone. */
const renameTables = (reference: Reference): Reference | undefined =>
  reference.table === undefined ? undefined : { ...reference, table: "Renamed" };

describe("rewriteReferences", () => {
  it("replaces the references it is told to and keeps the rest of the text as typed", () => {
    expect(rewriteReferences('=  sum( a1 ,Old!b2:c3 )  &  "Old!A1"', renameTables)).toBe(
      '=  sum( a1 ,Renamed!B2:C3 )  &  "Old!A1"',
    );
  });

  it("handles several references whose replacements change the text's length", () => {
    expect(rewriteReferences("=T!A1+'A long name'!A1+T!B2", renameTables)).toBe(
      "=Renamed!A1+Renamed!A1+Renamed!B2",
    );
  });

  it("quotes a new name only when it needs quotes", () => {
    const to = (name: string) => (reference: Reference) => ({ ...reference, table: name });
    expect(rewriteReferences("=T!A1", to("Sales_2024"))).toBe("=Sales_2024!A1");
    expect(rewriteReferences("=T!A1", to("Q1 Sales"))).toBe("='Q1 Sales'!A1");
    expect(rewriteReferences("=T!A1", to("Joe's"))).toBe("='Joe''s'!A1");
    expect(rewriteReferences("=T!A1", to("2024"))).toBe("='2024'!A1");
  });

  it("keeps absolute markers on a rewritten reference", () => {
    expect(rewriteReferences("=T!$A1:B$2", renameTables)).toBe("=Renamed!$A1:B$2");
  });

  it("keeps the open sides of a rewritten range", () => {
    expect(rewriteReferences("=SUM(T!a:a, T!2:$5, T!B2:B, 1:1)", renameTables)).toBe(
      "=SUM(Renamed!A:A, Renamed!2:$5, Renamed!B2:B, 1:1)",
    );
  });

  it("writes #REF! where a reference's target is gone, and the result still parses", () => {
    const rewritten = rewriteReferences("=SUM(A1, Gone!B2) + 1", (reference) =>
      reference.table === "Gone" ? "#REF!" : undefined,
    );
    expect(rewritten).toBe("=SUM(A1, #REF!) + 1");
    expect(rewriteReferences(rewritten, renameTables)).toBe(rewritten);
  });

  it("rewrites references inside action arguments", () => {
    expect(rewriteReferences('=BUTTON("x", EXECUTE(Old!A1+1, Old!A1))', renameTables)).toBe(
      '=BUTTON("x", EXECUTE(Renamed!A1+1, Renamed!A1))',
    );
  });

  it.each(["plain text", "Old!A1", "'=Old!A1", "", "=", "=Old!A1 +", '=Old!A1 & "unclosed'])(
    "returns %j unchanged: it is not a formula that parses",
    (input) => {
      expect(rewriteReferences(input, renameTables)).toBe(input);
    },
  );

  it("returns the input unchanged when no reference is replaced", () => {
    expect(rewriteReferences("= a1 + b2", renameTables)).toBe("= a1 + b2");
  });
});

describe("translateInput", () => {
  it.each([
    ["=A1", 1, 0, "=A2"],
    ["=A1", 0, 1, "=B1"],
    ["=A1+B2", 2, 3, "=D3+E4"],
    ["=B2", -1, -1, "=A1"],
    ["=$A$1", 5, 5, "=$A$1"],
    ["=$A1", 2, 2, "=$A3"],
    ["=A$1", 2, 2, "=C$1"],
    ["=SUM(A1:A3)", 0, 1, "=SUM(B1:B3)"],
    ["=SUM($A$1:A3)", 1, 0, "=SUM($A$1:A4)"],
    ["=SUM(A:A)", 3, 1, "=SUM(B:B)"],
    ["=SUM(2:2)", 3, 1, "=SUM(5:5)"],
    ["=SUM(A2:A)", 1, 1, "=SUM(B3:B)"],
    ["=Sales!A1 * 'Page 2'!Costs!B2", 1, 1, "=Sales!B2 * 'Page 2'!Costs!C3"],
    ['=IF(A1 > 0, "A1", a1)', 1, 0, '=IF(A2 > 0, "A1", A2)'],
    ['=BUTTON("Add", EXECUTE(A1 + 1, A1))', 1, 0, '=BUTTON("Add", EXECUTE(A2 + 1, A2))'],
    ["=A1(B1)", 1, 1, "=B2(C2)"],
  ])("moves %s by %i rows and %i columns to %s", (input, rows, cols, expected) => {
    expect(translateInput(input, rows, cols)).toBe(expected);
  });

  it.each([
    ["=A1", -1, 0, "=#REF!"],
    ["=A1 + B2", 0, -1, "=#REF! + A2"],
    ["=SUM(A1:B2)", -1, 0, "=SUM(#REF!)"],
    ["=SUM(B1:B3)", 0, -2, "=SUM(#REF!)"],
  ])(
    "writes #REF! where %s moved by %i, %i would leave the table",
    (input, rows, cols, expected) => {
      expect(translateInput(input, rows, cols)).toBe(expected);
    },
  );

  it.each(["text", "42", "'=A1", "", "=A1 +"])("leaves %j as it is", (input) => {
    expect(translateInput(input, 3, 3)).toBe(input);
  });

  it("returns the same input for no movement", () => {
    expect(translateInput("= a1", 0, 0)).toBe("= a1");
  });
});

describe("inputsAfterRename", () => {
  // STRUCTURE: t1 "Table1" and t2 "Other Table" on p1 "Page 1"; t3 "Table1" on p2 "Archive".
  function workbook(cells: Record<string, Record<string, string>>): WorkbookData {
    return {
      ...STRUCTURE,
      cells: Object.entries(cells).flatMap(([tableId, inputs]) =>
        Object.entries(inputs).map(([address, input]) => ({ ...at(address, tableId), input })),
      ),
    };
  }

  function after(cells: Record<string, Record<string, string>>, rename: Rename) {
    return inputsAfterRename(workbook(cells), rename).map(
      ({ tableId, row, col, input }) => `${tableId}:${String(row)}:${String(col)} ${input}`,
    );
  }

  const renameOther: Rename = { kind: "table", tableId: "t2", name: "Sales" };

  it("rewrites references to a renamed table from its own page and from other pages", () => {
    expect(
      after(
        {
          t1: { A1: "='Other Table'!A1*2", A2: "=SUM('other table'!A1:A3)", A3: "=A1" },
          t3: { B1: "='Page 1'!'Other Table'!A1", B2: "='Other Table'!A1" },
        },
        renameOther,
      ),
    ).toEqual([
      "t1:0:0 =Sales!A1*2",
      "t1:1:0 =SUM(Sales!A1:A3)",
      "t3:0:1 ='Page 1'!Sales!A1",
      // t3!B2 names a table on its own page, Archive, which has no "Other Table". It is left alone.
    ]);
  });

  it("tells apart two tables with the same name on different pages", () => {
    const cells = {
      t1: { A1: "=Table1!B1", A2: "=Archive!Table1!B1", A3: "='Page 1'!Table1!B1" },
      t3: { A1: "=Table1!B1", A2: "=Archive!Table1!B1", A3: "='Page 1'!Table1!B1" },
    };
    expect(after(cells, { kind: "table", tableId: "t3", name: "Old" })).toEqual([
      "t1:1:0 =Archive!Old!B1",
      "t3:0:0 =Old!B1",
      "t3:1:0 =Archive!Old!B1",
    ]);
    expect(after(cells, { kind: "table", tableId: "t1", name: "New" })).toEqual([
      "t1:0:0 =New!B1",
      "t1:2:0 ='Page 1'!New!B1",
      "t3:2:0 ='Page 1'!New!B1",
    ]);
  });

  it("rewrites page qualifiers when a page is renamed, in every table", () => {
    expect(
      after(
        {
          t1: { A1: "=archive!Table1!A1", A2: "=Table1!A1" },
          t3: { A1: "=ARCHIVE!Table1!A1 + 'Page 1'!Table1!A1" },
        },
        { kind: "page", pageId: "p2", name: "Old Years" },
      ),
    ).toEqual([
      "t1:0:0 ='Old Years'!Table1!A1",
      "t3:0:0 ='Old Years'!Table1!A1 + 'Page 1'!Table1!A1",
    ]);
  });

  it("returns nothing when no formula names what is renamed", () => {
    expect(after({ t1: { A1: "=A2+1", A2: "5", A3: "Other Table" } }, renameOther)).toEqual([]);
  });

  it("returns nothing for a page or table that does not exist", () => {
    const cells = { t1: { A1: "='Other Table'!A1 + Archive!Table1!A1" } };
    expect(after(cells, { kind: "table", tableId: "missing", name: "x" })).toEqual([]);
    expect(after(cells, { kind: "page", pageId: "missing", name: "x" })).toEqual([]);
  });
});

describe("inputsAfterMove", () => {
  // STRUCTURE: t1 "Table1" and t2 "Other Table" on p1 "Page 1"; t3 "Table1" on p2 "Archive".
  function after(cells: Record<string, Record<string, string>>, move: Move): string[] {
    const data: WorkbookData = {
      ...STRUCTURE,
      cells: Object.entries(cells).flatMap(([tableId, inputs]) =>
        Object.entries(inputs).map(([address, input]) => ({ ...at(address, tableId), input })),
      ),
    };
    return inputsAfterMove(data, move)
      .map((cell) => `${cell.tableId} ${formatAddress(cell)} ${cell.input}`)
      .sort();
  }
  const toArchive: Move = { kind: "table", tableId: "t2", pageId: "p2" };

  it("names the new page in formulas elsewhere that read the moved table", () => {
    expect(
      after(
        {
          t1: {
            A1: "='Other Table'!A1",
            A2: "=SUM('page 1'!'Other Table'!A1:A3)",
            A3: "=Table1!A1 + B2",
          },
        },
        toArchive,
      ),
    ).toEqual(["t1 A1 =Archive!'Other Table'!A1", "t1 A2 =SUM(Archive!'Other Table'!A1:A3)"]);
  });

  it("needs no page name in formulas on the page the table moves to", () => {
    expect(
      after({ t3: { A1: "='Page 1'!'Other Table'!A1", A2: "='Other Table'!A1" } }, toArchive),
    ).toEqual(["t3 A1 ='Other Table'!A1"]);
  });

  it("names the old page in the moved table's formulas that read tables left behind", () => {
    expect(
      after(
        {
          t2: {
            A1: "=Table1!B1",
            A2: "='Other Table'!A5 + A4",
            A3: "='Page 1'!'Other Table'!A5",
            A4: "=Archive!Table1!A1 + 'Page 1'!Table1!A1",
            A5: "=Missing!A1",
          },
        },
        toArchive,
      ),
    ).toEqual(["t2 A1 ='Page 1'!Table1!B1", "t2 A3 ='Other Table'!A5"]);
  });

  it("keeps every formula reading the cells it read", () => {
    const cells = {
      t1: { A1: "='Other Table'!A1", A2: "7" },
      t2: { A1: "=Table1!A2 * 2", A2: "='Other Table'!A1 + 1" },
      t3: { A1: "='Page 1'!'Other Table'!A2", A2: "=Table1!A1" },
    };
    const values = (structure: typeof STRUCTURE, inputs: typeof cells) => {
      const workbook = new Workbook();
      workbook.setStructure(structure);
      for (const [tableId, written] of Object.entries(inputs)) {
        for (const [address, input] of Object.entries(written)) {
          workbook.setCell(at(address, tableId), input);
        }
      }
      return Object.entries(inputs).flatMap(([tableId, written]) =>
        Object.keys(written).map((address) => workbook.getValue(at(address, tableId))),
      );
    };
    const before = values(STRUCTURE, cells);
    expect(before).toEqual([14, 7, 14, 15, 15, 15]);

    const moved = structuredClone(cells) as Record<string, Record<string, string>>;
    const data: WorkbookData = {
      ...STRUCTURE,
      cells: Object.entries(cells).flatMap(([tableId, inputs]) =>
        Object.entries(inputs).map(([address, input]) => ({ ...at(address, tableId), input })),
      ),
    };
    for (const cell of inputsAfterMove(data, toArchive)) {
      moved[cell.tableId]![formatAddress(cell)] = cell.input;
    }
    const tables = STRUCTURE.tables.map((table) =>
      table.id === "t2" ? { ...table, pageId: "p2" } : table,
    );
    expect(values({ ...STRUCTURE, tables }, moved as typeof cells)).toEqual(before);
  });

  it("writes nothing for a table or page that does not exist", () => {
    const cells = { t1: { A1: "='Other Table'!A1" } };
    expect(after(cells, { kind: "table", tableId: "missing", pageId: "p2" })).toEqual([]);
    expect(after(cells, { kind: "table", tableId: "t2", pageId: "missing" })).toEqual([]);
  });

  it("leaves cells alone when it is a view that moves", () => {
    expect(
      after({ t1: { A1: "='Other Table'!A1" } }, { kind: "view", viewId: "v", pageId: "p2" }),
    ).toEqual([]);
  });
});

describe("structural formula rewrites", () => {
  const deleteRow = (index: number): StructuralEdit => ({
    tableId: "t1",
    axis: "row",
    kind: "delete",
    index,
  });
  const insertRow = (index: number): StructuralEdit => ({
    tableId: "t1",
    axis: "row",
    kind: "insert",
    index,
  });
  const deleteCol = (index: number): StructuralEdit => ({
    tableId: "t1",
    axis: "col",
    kind: "delete",
    index,
  });
  const insertCol = (index: number): StructuralEdit => ({
    tableId: "t1",
    axis: "col",
    kind: "insert",
    index,
  });

  function data(cells: Record<string, Record<string, string>>): WorkbookData {
    return {
      ...STRUCTURE,
      cells: Object.entries(cells).flatMap(([tableId, inputs]) =>
        Object.entries(inputs).map(([address, input]) => ({ ...at(address, tableId), input })),
      ),
    };
  }

  /** The writes for an edit, as `table address input` lines sorted for comparison. */
  function writes(cells: Record<string, Record<string, string>>, edit: StructuralEdit): string[] {
    return formulasAfterEdit(data(cells), edit)
      .map((cell) => `${cell.tableId} ${formatAddress(cell)} ${cell.input || "(cleared)"}`)
      .sort();
  }

  /** How a formula in another table, reading Table1, is written after an edit to Table1. */
  function rewritten(formula: string, edit: StructuralEdit): string {
    const result = formulasAfterEdit(data({ t2: { A1: formula } }), edit);
    return result[0]?.input ?? formula;
  }

  describe("rewriting references after deleting row 3", () => {
    it.each([
      ["=Table1!A2", "=Table1!A2"],
      ["=Table1!A3", "=#REF!"],
      ["=Table1!A4", "=Table1!A3"],
      ["=SUM(Table1!A1:A2)", "=SUM(Table1!A1:A2)"],
      ["=SUM(Table1!A1:A3)", "=SUM(Table1!A1:A2)"],
      ["=SUM(Table1!A1:A5)", "=SUM(Table1!A1:A4)"],
      ["=SUM(Table1!A3:A5)", "=SUM(Table1!A3:A4)"],
      ["=SUM(Table1!A4:A5)", "=SUM(Table1!A3:A4)"],
      ["=SUM(Table1!A3:B3)", "=SUM(#REF!)"],
      ["=SUM(Table1!A5:A1)", "=SUM(Table1!A4:A1)"],
      ["=SUM(Table1!$A$4:$A$5)", "=SUM(Table1!$A$3:$A$4)"],
      ["=SUM(Table1!A:A)", "=SUM(Table1!A:A)"],
      ["=SUM(Table1!2:5)", "=SUM(Table1!2:4)"],
      ["=SUM(Table1!3:3)", "=SUM(#REF!)"],
      ["=SUM(Table1!A2:A)", "=SUM(Table1!A2:A)"],
      ["=SUM(Table1!A3:A)", "=SUM(Table1!A3:A)"],
      ["=SUM(Table1!A4:A)", "=SUM(Table1!A3:A)"],
      ["=SUM(Table1!A:A5)", "=SUM(Table1!A:A4)"],
      ["=SUM(Table1!A1:4)", "=SUM(Table1!A1:3)"],
    ])("%s becomes %s", (formula, expected) => {
      expect(rewritten(formula, deleteRow(2))).toBe(expected);
    });
  });

  describe("rewriting references after inserting a row at row 3", () => {
    it.each([
      ["=Table1!A2", "=Table1!A2"],
      ["=Table1!A3", "=Table1!A4"],
      ["=SUM(Table1!A1:A2)", "=SUM(Table1!A1:A2)"],
      ["=SUM(Table1!A1:A3)", "=SUM(Table1!A1:A4)"],
      ["=SUM(Table1!A3:A5)", "=SUM(Table1!A4:A6)"],
      ["=SUM(Table1!A5:A1)", "=SUM(Table1!A6:A1)"],
      ["=SUM(Table1!A:A)", "=SUM(Table1!A:A)"],
      ["=SUM(Table1!2:5)", "=SUM(Table1!2:6)"],
      ["=SUM(Table1!A3:A)", "=SUM(Table1!A4:A)"],
      ["=SUM(Table1!A:A5)", "=SUM(Table1!A:A6)"],
    ])("%s becomes %s", (formula, expected) => {
      expect(rewritten(formula, insertRow(2))).toBe(expected);
    });
  });

  describe("rewriting references after editing column B", () => {
    it.each([
      ["=Table1!A1", "=Table1!A1", "=Table1!A1"],
      ["=Table1!B1", "=#REF!", "=Table1!C1"],
      ["=Table1!C1", "=Table1!B1", "=Table1!D1"],
      ["=SUM(Table1!A1:C1)", "=SUM(Table1!A1:B1)", "=SUM(Table1!A1:D1)"],
      ["=SUM(Table1!B:B)", "=SUM(#REF!)", "=SUM(Table1!C:C)"],
      ["=SUM(Table1!A:C)", "=SUM(Table1!A:B)", "=SUM(Table1!A:D)"],
      ["=SUM(Table1!2:2)", "=SUM(Table1!2:2)", "=SUM(Table1!2:2)"],
      ["=SUM(Table1!B2:5)", "=SUM(Table1!B2:5)", "=SUM(Table1!C2:5)"],
      ["=SUM(Table1!C2:5)", "=SUM(Table1!B2:5)", "=SUM(Table1!D2:5)"],
    ])("%s: delete gives %s, insert gives %s", (formula, afterDelete, afterInsert) => {
      expect(rewritten(formula, deleteCol(1))).toBe(afterDelete);
      expect(rewritten(formula, insertCol(1))).toBe(afterInsert);
    });
  });

  it("rewrites only references that resolve to the edited table", () => {
    // t3 is also named Table1, on the Archive page.
    expect(
      writes(
        {
          t2: { A1: "=Table1!A5", A2: "=Archive!Table1!A5", A3: "=A5", A4: "='Page 1'!Table1!A5" },
          t3: { A1: "=Table1!A5", A2: "='Page 1'!Table1!A5" },
        },
        deleteRow(0),
      ),
    ).toEqual(["t2 A1 =Table1!A4", "t2 A4 ='Page 1'!Table1!A4", "t3 A2 ='Page 1'!Table1!A4"]);
  });

  describe("several rows or columns at once", () => {
    it.each([
      ["=Table1!A2", "=Table1!A2"],
      ["=Table1!A3", "=#REF!"],
      ["=Table1!A5", "=#REF!"],
      ["=Table1!A6", "=Table1!A3"],
      ["=SUM(Table1!A1:A4)", "=SUM(Table1!A1:A2)"],
      ["=SUM(Table1!A4:A8)", "=SUM(Table1!A3:A5)"],
      ["=SUM(Table1!A1:A9)", "=SUM(Table1!A1:A6)"],
      ["=SUM(Table1!A3:A5)", "=SUM(#REF!)"],
      ["=SUM(Table1!A4:A4)", "=SUM(#REF!)"],
      ["=SUM(Table1!A8:A4)", "=SUM(Table1!A5:A3)"],
      ["=SUM(Table1!A4:A)", "=SUM(Table1!A3:A)"],
      ["=SUM(Table1!A7:A)", "=SUM(Table1!A4:A)"],
      ["=SUM(Table1!2:4)", "=SUM(Table1!2:2)"],
      ["=SUM(Table1!B:B)", "=SUM(Table1!B:B)"],
    ])("rewrites %s to %s after deleting rows 3 to 5", (formula, expected) => {
      expect(rewritten(formula, { ...deleteRow(2), count: 3 })).toBe(expected);
    });

    it.each([
      ["=Table1!A2", "=Table1!A2"],
      ["=Table1!A3", "=Table1!A6"],
      ["=SUM(Table1!A1:A2)", "=SUM(Table1!A1:A2)"],
      ["=SUM(Table1!A1:A3)", "=SUM(Table1!A1:A6)"],
      ["=SUM(Table1!A3:A4)", "=SUM(Table1!A6:A7)"],
      ["=SUM(Table1!A2:A)", "=SUM(Table1!A2:A)"],
      ["=SUM(Table1!3:3)", "=SUM(Table1!6:6)"],
    ])("rewrites %s to %s after inserting three rows at row 3", (formula, expected) => {
      expect(rewritten(formula, { ...insertRow(2), count: 3 })).toBe(expected);
    });
  });

  it("rewrites references inside action arguments", () => {
    expect(rewritten('=BUTTON("Add", EXECUTE(Table1!A4+1, Table1!A4))', deleteRow(0))).toBe(
      '=BUTTON("Add", EXECUTE(Table1!A3+1, Table1!A3))',
    );
  });
});

describe("formulasAfterEdit", () => {
  it("leaves unchanged formulas and moved literals out of the writes", () => {
    const data = {
      ...STRUCTURE,
      cells: [
        { ...at("A3", "t1"), input: "literal" },
        { ...at("B3", "t1"), input: "=A1" },
        { ...at("C3", "t1"), input: "=A3" },
      ],
    };
    const edit = { tableId: "t1", axis: "row", kind: "insert", index: 1 } as const;
    expect(formulasAfterEdit(data, edit)).toEqual([{ ...at("C3", "t1"), input: "=A4" }]);
  });

  it.each(["row", "col"] as const)("omits a rewritten formula in a deleted %s", (axis) => {
    const data = {
      ...STRUCTURE,
      cells: [
        { ...at("A1", "t1"), input: "=A2" },
        { ...at("B2", "t1"), input: "=A2" },
        { ...at("A1", "t2"), input: "=Table1!A2" },
      ],
    };
    const edit = { tableId: "t1", axis, kind: "delete", index: 0 } as const;
    expect(
      formulasAfterEdit(data, edit).some(
        (cell) => cell.tableId === "t1" && cell.row === 0 && cell.col === 0,
      ),
    ).toBe(false);
  });
});
