import { describe, expect, it } from "vitest";
import { referenceHighlights, referenceOutlines, type ReferenceContext } from "./references";

const context: ReferenceContext = {
  pageId: "p1",
  tableId: "t1",
  row: 2,
  pages: [
    { id: "p1", name: "Page 1" },
    { id: "p2", name: "Other" },
  ],
  tables: [
    {
      id: "t1",
      pageId: "p1",
      name: "Sales",
      rowCount: 5,
      colCount: 4,
      columns: [{ name: "Amount" }, { name: "Tax" }],
    },
    {
      id: "t2",
      pageId: "p2",
      name: "Sales",
      rowCount: 3,
      colCount: 2,
      columns: [{ name: "Amount" }],
    },
  ],
};

function highlights(source: string, extra: Partial<ReferenceContext> = {}) {
  return referenceHighlights(source, "cell", source.length, { ...context, ...extra });
}

describe("direct reference colors", () => {
  it("finds references around boolean operators in complete and unfinished drafts", () => {
    for (const source of ["=A1 and (not B2 or Sales[Amount])", "=A1 and not B2 or "]) {
      expect(highlights(source).map(({ from, to }) => source.slice(from, to))).toEqual(
        source.includes("Sales") ? ["A1", "B2", "Sales[Amount]"] : ["A1", "B2"],
      );
    }
  });

  it("gives repeated targets one color independent of spelling and absolute markers", () => {
    const result = highlights("=A1 + $A$1 + Sales!A1 + 'Page 1'!sales!A1 + B2");
    expect(new Set(result.slice(0, 4).map((ref) => ref.color)).size).toBe(1);
    expect(result[4]!.color).not.toBe(result[0]!.color);
    expect(result[0]!.cells).toEqual({
      tableId: "t1",
      startRow: 0,
      endRow: 0,
      startCol: 0,
      endCol: 0,
    });
  });
  it("resolves qualifiers, reversed ranges, whole columns, and same-row columns", () => {
    expect(highlights("=B3:A1")[0]!.cells).toMatchObject({
      startRow: 0,
      endRow: 2,
      startCol: 0,
      endCol: 1,
    });
    expect(highlights("=A:C")[0]!.cells).toMatchObject({
      startRow: 0,
      endRow: 4,
      startCol: 0,
      endCol: 2,
    });
    expect(highlights("=2:3")[0]!.cells).toMatchObject({
      startRow: 1,
      endRow: 2,
      startCol: 0,
      endCol: 3,
    });
    expect(highlights("=[Tax]")[0]!.cells).toMatchObject({ startRow: 2, endRow: 2, startCol: 1 });
    expect(highlights("=Other!Sales[Amount]")[0]!.cells).toMatchObject({
      tableId: "t2",
      startRow: 0,
      endRow: 2,
      startCol: 0,
    });
    expect(highlights("=A1", { tableId: undefined })[0]!.cells).toBeUndefined();
    expect(highlights("=Missing!A1")[0]!.cells).toBeUndefined();
  });
  it("does not evaluate names, literals, comments, or inactive statements", () => {
    expect(highlights('=Total + Sales!Total + "A1"')).toEqual([]);
    expect(referenceHighlights("A1", "cell", 2, context)).toEqual([]);
    const source = "First = A1\n// B2\nLast = C3";
    expect(
      referenceHighlights(source, "script", 8, context).map((ref) =>
        source.slice(ref.from, ref.to),
      ),
    ).toEqual(["A1"]);
    expect(referenceHighlights(source, "script", 15, context)).toEqual([]);
  });
  it("outlines stored ranges using visible neighbors and deduplicates repeated references", () => {
    const refs = highlights("=A1:B3 + A1:B3");
    const outlines = referenceOutlines(refs, "t1", [0, 4, 2, 1], 4);
    expect(outlines.has("1:0")).toBe(false);
    expect(outlines.get("0:0")!.boxShadow).toBe(
      `inset 0 2px ${refs[0]!.color}, inset 0 -2px ${refs[0]!.color}, inset 2px 0 ${refs[0]!.color}`,
    );
    expect(outlines.get("2:0")!.boxShadow).toContain("inset 0 2px");
    expect(outlines.get("2:0")!.boxShadow).not.toContain("inset 0 -2px");
    expect(outlines.get("3:1")!.boxShadow).toContain("inset 0 -2px");
    expect(referenceOutlines(refs, "t2", [0, 1], 2).size).toBe(0);
  });
});
