import { describe, expect, it } from "vitest";
import { STRUCTURE } from "./testing";
import { viewsAfterEdit, viewsAfterMove, viewsAfterRename, type ViewSource } from "./views";

// STRUCTURE: t1 "Table1" and t2 "Other Table" on p1 "Page 1"; t3 "Table1" on p2 "Archive".
const views: ViewSource[] = [
  { id: "chart-on-p1", pageId: "p1", kind: "chart", source: "Table1!A1:B9" },
  { id: "chart-with-equals", pageId: "p1", kind: "chart", source: "=SORT('Other Table'!A:B, 2)" },
  { id: "chart-on-p2", pageId: "p2", kind: "chart", source: "Table1!A1:B9" },
  {
    id: "text-on-p2",
    pageId: "p2",
    kind: "text",
    source:
      "Table1!A5 in prose. {{ 'Page 1'!Table1!A5 }} {% for a in Table1!A2:A9 %}{{ a }}{% end %}",
  },
  { id: "plain", pageId: "p1", kind: "text", source: "No formulas here." },
];

describe("viewsAfterRename", () => {
  it("writes a table's new name into the views that read that table", () => {
    expect(
      viewsAfterRename(STRUCTURE, views, { kind: "table", tableId: "t1", name: "Sales" }),
    ).toEqual([
      { id: "chart-on-p1", source: "Sales!A1:B9" },
      {
        id: "text-on-p2",
        source:
          "Table1!A5 in prose. {{ 'Page 1'!Sales!A5 }} {% for a in Table1!A2:A9 %}{{ a }}{% end %}",
      },
    ]);
  });

  it("keeps the leading = of a chart's formula as written", () => {
    expect(
      viewsAfterRename(STRUCTURE, views, { kind: "table", tableId: "t2", name: "Costs" }),
    ).toEqual([{ id: "chart-with-equals", source: "=SORT(Costs!A:B, 2)" }]);
  });

  it("writes a page's new name into the views that name that page", () => {
    expect(viewsAfterRename(STRUCTURE, views, { kind: "page", pageId: "p1", name: "Now" })).toEqual(
      [
        {
          id: "text-on-p2",
          source:
            "Table1!A5 in prose. {{ Now!Table1!A5 }} {% for a in Table1!A2:A9 %}{{ a }}{% end %}",
        },
      ],
    );
  });
});

describe("viewsAfterMove", () => {
  it("names the new page in the views that read a moved table", () => {
    expect(
      viewsAfterMove(STRUCTURE, views, { kind: "table", tableId: "t2", pageId: "p2" }),
    ).toEqual([{ id: "chart-with-equals", source: "=SORT(Archive!'Other Table'!A:B, 2)" }]);
    // On the page the table moves to, its name alone is enough.
    expect(
      viewsAfterMove(STRUCTURE, views, { kind: "table", tableId: "t1", pageId: "p2" }),
    ).toEqual([
      { id: "chart-on-p1", source: "Archive!Table1!A1:B9" },
      {
        id: "text-on-p2",
        source: "Table1!A5 in prose. {{ Table1!A5 }} {% for a in Table1!A2:A9 %}{{ a }}{% end %}",
      },
    ]);
  });

  it("names the old page in a moved view, where it read a table by name alone", () => {
    expect(
      viewsAfterMove(STRUCTURE, views, { kind: "view", viewId: "chart-on-p1", pageId: "p2" }),
    ).toEqual([{ id: "chart-on-p1", source: "'Page 1'!Table1!A1:B9" }]);
    expect(
      viewsAfterMove(STRUCTURE, views, { kind: "view", viewId: "text-on-p2", pageId: "p1" }),
    ).toEqual([
      {
        id: "text-on-p2",
        source:
          "Table1!A5 in prose. {{ 'Page 1'!Table1!A5 }} {% for a in Archive!Table1!A2:A9 %}{{ a }}{% end %}",
      },
    ]);
    expect(
      viewsAfterMove(STRUCTURE, views, { kind: "view", viewId: "plain", pageId: "p2" }),
    ).toEqual([]);
  });
});

describe("viewsAfterEdit", () => {
  it("moves references into the edited table, in charts and text views on any page", () => {
    expect(
      viewsAfterEdit(STRUCTURE, views, { tableId: "t1", axis: "row", kind: "insert", index: 0 }),
    ).toEqual([
      { id: "chart-on-p1", source: "Table1!A2:B10" },
      {
        id: "text-on-p2",
        source:
          "Table1!A5 in prose. {{ 'Page 1'!Table1!A6 }} {% for a in Table1!A2:A9 %}{{ a }}{% end %}",
      },
    ]);
  });

  it("follows the page's own table of the same name separately", () => {
    expect(
      viewsAfterEdit(STRUCTURE, views, { tableId: "t3", axis: "row", kind: "delete", index: 0 }),
    ).toEqual([
      { id: "chart-on-p2", source: "Table1!A1:B8" },
      {
        id: "text-on-p2",
        source:
          "Table1!A5 in prose. {{ 'Page 1'!Table1!A5 }} {% for a in Table1!A1:A8 %}{{ a }}{% end %}",
      },
    ]);
  });

  it("returns nothing when no view reads the table", () => {
    expect(
      viewsAfterEdit(STRUCTURE, [views[4]!], {
        tableId: "t1",
        axis: "col",
        kind: "delete",
        index: 0,
      }),
    ).toEqual([]);
  });
});
