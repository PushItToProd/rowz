import { describe, expect, it } from "vitest";
import type { Reference } from "./ast";
import { inputsAfterRename, rewriteReferences, type Rename } from "./rewrite";
import { at, STRUCTURE } from "./testing";
import type { WorkbookData } from "./workbook";

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
