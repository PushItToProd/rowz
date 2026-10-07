import { describe, expect, it } from "vitest";
import {
  buildBlockLink,
  buildCellLink,
  buildPageLink,
  isDeepLinkHref,
  parseDeepLinkFragment,
  parseDeepLinkHref,
} from "./deepLinks";

describe("deep links", () => {
  it("builds page, block, and stored-identity cell links", () => {
    expect(buildPageLink("sheet-1", "page_2")).toBe("/s/sheet-1/p/page_2");
    expect(buildBlockLink("sheet-1", "page_2", "block-3")).toBe(
      "/s/sheet-1/p/page_2#block=block-3",
    );
    expect(buildCellLink("sheet-1", "page_2", "table-3", "row-4", "col-5")).toBe(
      "/s/sheet-1/p/page_2#cell=table-3.row-4.col-5",
    );
  });

  it("parses app paths and current-page fragments", () => {
    expect(parseDeepLinkHref("/s/sheet-1/p/page_2")).toEqual({
      kind: "page",
      spreadsheetId: "sheet-1",
      pageId: "page_2",
    });
    expect(parseDeepLinkHref("/s/sheet-1/p/page_2#block=block-3")).toEqual({
      kind: "block",
      spreadsheetId: "sheet-1",
      pageId: "page_2",
      blockId: "block-3",
    });
    expect(parseDeepLinkHref("/s/sheet-1/p/page_2#cell=table-3.row-4.col-5")).toEqual({
      kind: "cell",
      spreadsheetId: "sheet-1",
      pageId: "page_2",
      tableId: "table-3",
      rowId: "row-4",
      colId: "col-5",
    });
    expect(
      parseDeepLinkHref("#block=block-3", { spreadsheetId: "sheet-1", pageId: "page_2" }),
    ).toEqual({
      kind: "block",
      spreadsheetId: "sheet-1",
      pageId: "page_2",
      blockId: "block-3",
    });
    expect(parseDeepLinkFragment("#cell=table-3.row-4.col-5")).toEqual({
      kind: "cell",
      tableId: "table-3",
      rowId: "row-4",
      colId: "col-5",
    });
  });

  it.each([
    "#heading",
    "#block=",
    "#block=a/b",
    "#cell=table.row",
    "#cell=table.row.col.extra",
    "/s/sheet/p/page?query=1",
    "/s/sheet/p/page#other=value",
    "s/sheet/p/page",
    "//evil.example/s/sheet/p/page",
    "javascript:alert(1)",
  ])("rejects unsupported href %s", (href) => {
    expect(parseDeepLinkHref(href, { spreadsheetId: "sheet", pageId: "page" })).toBeNull();
    expect(isDeepLinkHref(href)).toBe(false);
  });

  it("rejects IDs that cannot be represented unambiguously", () => {
    expect(() => buildCellLink("sheet", "page", "table", "row.with.dot", "col")).toThrow(TypeError);
  });
});
