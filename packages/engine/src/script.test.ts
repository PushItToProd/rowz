import { describe, expect, it } from "vitest";
import { parseScript, rewriteScript, scriptNames } from "./script";
import { STRUCTURE, at } from "./testing";
import { viewsAfterRename } from "./views";
import { Workbook } from "./workbook";

describe("parseScript", () => {
  it("reads names, functions, bare formulas, and comments", () => {
    const source = [
      "// Totals",
      "Total = SUM(Sales!A:A) // all of it",
      "WithTax(amount, rate) = amount * (1 + rate)",
      "'my name' = 1",
      "",
      'ASSERT(Total >= 0, "no // comment here")',
    ].join("\n");
    const statements = parseScript(source);
    expect(statements).toMatchObject([
      { kind: "name", line: 2, name: "Total", formula: "SUM(Sales!A:A)" },
      {
        kind: "name",
        line: 3,
        name: "WithTax",
        params: ["amount", "rate"],
        formula: "amount * (1 + rate)",
      },
      { kind: "name", line: 4, name: "my name", formula: "1" },
      { kind: "expression", line: 6, formula: 'ASSERT(Total >= 0, "no // comment here")' },
    ]);
    // Each formula's offset is where it is written in the source.
    for (const statement of statements) {
      if (statement.kind === "error") continue;
      const { formula, from } = statement;
      expect(source.slice(from, from + formula.length)).toBe(formula);
    }
  });

  it("continues a statement on indented lines", () => {
    const [statement] = parseScript("Total = SUM(\n  Sales!A:A, // first\n  Sales!B:B)");
    expect(statement).toMatchObject({ kind: "name", name: "Total" });
    expect(statement?.kind === "name" && statement.formula.replace(/\s+/g, " ")).toBe(
      "SUM( Sales!A:A, Sales!B:B)",
    );
  });

  it("reports an indented line with no statement above it", () => {
    expect(parseScript("  1 + 1")).toEqual([
      { kind: "error", line: 1, message: expect.stringContaining("continues") as string },
    ]);
  });

  it("reads a comparison of a name as a bare formula", () => {
    expect(parseScript("Total <= 3")).toMatchObject([{ kind: "expression" }]);
  });
});

describe("scriptNames", () => {
  it("defines a function as a LAMBDA of its parameters", () => {
    expect(scriptNames("s1", "Double(x) = x * 2\nZero() = 0")).toEqual([
      { holderId: "s1", name: "Double", formula: "LAMBDA(x, (x * 2))" },
      { holderId: "s1", name: "Zero", formula: "LAMBDA((0))" },
    ]);
  });
});

describe("scripts in a workbook", () => {
  it("computes a script's names, which use each other and call its functions", () => {
    const workbook = new Workbook();
    workbook.setStructure({
      ...STRUCTURE,
      scripts: [
        {
          id: "s1",
          pageId: "p1",
          name: "Summary",
          source: ["Total = SUM(Table1!A1:A2)", "Double(x) = x * 2", "Twice = Double(Total)"].join(
            "\n",
          ),
        },
      ],
    });
    workbook.setCell(at("A1"), "1");
    workbook.setCell(at("A2"), "2");
    workbook.setCell(at("B1"), "=Twice + Summary!Double(1)");
    expect(workbook.getName("s1", "Twice")).toBe(6);
    expect(workbook.getValue(at("B1"))).toBe(8);
  });
});

describe("rewriteScript", () => {
  it("rewrites references and keeps comments and layout", () => {
    const source = "// Table1!A1 stays\nTotal = SUM(Table1!A1:A2) // Table1!A1\n  + Table1!B1";
    expect(
      rewriteScript(source, (reference) =>
        reference.table === "Table1" ? { ...reference, table: "Sales" } : undefined,
      ),
    ).toBe("// Table1!A1 stays\nTotal = SUM(Sales!A1:A2) // Table1!A1\n  + Sales!B1");
  });

  it("is applied to a script when a table it names is renamed", () => {
    const views = [{ id: "s1", pageId: "p1", kind: "script" as const, source: "X = Table1!A1" }];
    expect(
      viewsAfterRename(STRUCTURE, views, { kind: "table", tableId: "t1", name: "Sales" }),
    ).toEqual([{ id: "s1", source: "X = Sales!A1" }]);
  });
});
