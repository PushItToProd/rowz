import { describe, expect, it } from "vitest";
import { applySuggestion, signatureAt, suggestionsAt, type NamingContext } from "./assist";

const context: NamingContext = {
  pages: [
    { id: "p1", name: "Summary" },
    { id: "p2", name: "Raw Data" },
  ],
  tables: [
    { pageId: "p1", name: "Sales" },
    { pageId: "p1", name: "Sales Targets" },
    { pageId: "p2", name: "Imports" },
    { pageId: "p2", name: "Joe's" },
  ],
  pageId: "p1",
};

/** Suggestions with the caret at the `|` mark, or at the end when there is no mark. */
function suggest(marked: string) {
  const caret = marked.includes("|") ? marked.indexOf("|") : marked.length;
  return suggestionsAt(marked.replace("|", ""), caret, context);
}

function labels(marked: string): string[] {
  return suggest(marked).items.map((item) => item.label);
}

describe("suggestionsAt", () => {
  it("offers functions that start with the typed letters, ignoring case, in alphabetical order", () => {
    expect(labels("=co")).toEqual([
      "COLUMNS",
      "CONCATENATE",
      "COUNT",
      "COUNTA",
      "COUNTIF",
      "COUNTIFS",
    ]);
    expect(labels("=1+ROUNDD")).toEqual(["ROUNDDOWN"]);
    expect(suggest("=su").items[1]).toEqual({
      kind: "function",
      label: "SUM",
      insert: "SUM(",
      detail: "SUM(value, ...)",
    });
  });

  it("lists functions before tables and pages", () => {
    expect(labels("=su")).toEqual(["SUBSTITUTE", "SUM", "SUMIF", "SUMIFS", "Summary"]);
  });

  it("offers at most eight", () => {
    expect(labels("=s")).toHaveLength(8);
  });

  it("offers tables on the formula's own page, and pages, with quotes where the name needs them", () => {
    expect(suggest("=sal").items).toEqual([
      { kind: "table", label: "Sales", insert: "Sales!", detail: "table" },
      { kind: "table", label: "Sales Targets", insert: "'Sales Targets'!", detail: "table" },
    ]);
    expect(suggest("=raw").items).toEqual([
      { kind: "page", label: "Raw Data", insert: "'Raw Data'!", detail: "page" },
    ]);
    expect(labels("=imp")).toEqual([]);
  });

  it("offers the tables of a page after its qualifier", () => {
    expect(labels("='Raw Data'!")).toEqual([]);
    expect(labels("='Raw Data'!i")).toEqual(["Imports"]);
    expect(labels("=Summary!s")).toEqual(["Sales", "Sales Targets"]);
    expect(labels("=Sales!su")).toEqual([]);
    expect(labels("=Nowhere!s")).toEqual([]);
  });

  it("completes a quoted name being typed", () => {
    expect(suggest("=SUM('sales t").items).toEqual([
      { kind: "table", label: "Sales Targets", insert: "'Sales Targets'!", detail: "table" },
    ]);
    expect(suggest("=SUM('sales t").from).toBe(5);
    expect(labels("='")).toEqual(["Sales", "Sales Targets", "Summary", "Raw Data"]);
    expect(suggest("='Raw Data'!'jo").items).toEqual([
      { kind: "table", label: "Joe's", insert: "'Joe''s'!", detail: "table" },
    ]);
    expect(labels("='su")).toEqual(["Summary"]);
  });

  it("offers names the formula already uses, before functions", () => {
    expect(labels("=LET(total, SUM(A1:A3), rate, 2, t")).toEqual([
      "total",
      "TAKE",
      "TEXTJOIN",
      "TODAY",
      "TRANSPOSE",
      "TRIM",
    ]);
    expect(labels("=LAMBDA(price, qty, pr")).toEqual(["price", "PRODUCT"]);
  });

  it("does not offer the word being typed as a name, a cell address, or a function name used as one", () => {
    expect(labels("=LET(tot")).toEqual([]);
    expect(labels("=A1 + ab")).toEqual(["ABS"]);
    expect(labels("=LET(x, sum, su")).toEqual(["SUBSTITUTE", "SUM", "SUMIF", "SUMIFS", "Summary"]);
  });

  it("uses the word that ends at the caret, wherever the caret is", () => {
    expect(labels("=CO|UNT(A1)")).toEqual([
      "COLUMNS",
      "CONCATENATE",
      "COUNT",
      "COUNTA",
      "COUNTIF",
      "COUNTIFS",
    ]);
    expect(suggest("=1+ab|").from).toBe(3);
    expect(labels("=SUM(|A1)")).toEqual([]);
  });

  it.each([
    ["plain text", "su"],
    ["text that starts with an apostrophe", "'=su"],
    ["inside quoted text", '="su'],
    ["inside quoted text after an escaped quote", '="say ""su'],
    ["after a number", "=1e"],
    ["an empty formula", "="],
    ["after an operator", "=1+"],
    ["after a complete call", "=SUM(A1)"],
    ["a cell address that starts no function", "=B7"],
  ])("offers nothing for %s", (_what, text) => {
    expect(labels(text)).toEqual([]);
  });

  it("offers nothing for a lone name that is already complete", () => {
    expect(labels("=LET(total, 1, total")).toEqual([]);
  });

  it("offers again after quoted text ends", () => {
    expect(labels('="su" & up')).toEqual(["UPPER"]);
  });
});

describe("signatureAt", () => {
  function signature(marked: string): string | undefined {
    const caret = marked.includes("|") ? marked.indexOf("|") : marked.length;
    return signatureAt(marked.replace("|", ""), caret)?.name;
  }

  it.each([
    ["=SUM(", "SUM"],
    ["=sum(A1, ", "SUM"],
    ["=IF(SUM(A1) > 1, ", "IF"],
    ["=IF(SUM(A1|) > 1, 2)", "SUM"],
    ["=ROUND((1 + 2) * 3, ", "ROUND"],
    ["=ROUND((1 + |2) * 3, 1)", "ROUND"],
    ['=IF(A1 = ")", ', "IF"],
    ["=VLOOKUP (A1, ", "VLOOKUP"],
    ['=BUTTON("Go", EXECUTE(', "EXECUTE"],
  ])("inside %s the function is %s", (text, expected) => {
    expect(signature(text)).toBe(expected);
  });

  // Inside a call of something that is not a built-in function, no built-in's hint applies.
  it.each([
    "=SUM(A1)",
    "=SUM",
    "=(1 + ",
    "SUM(",
    '=SUM("(',
    "=A1(",
    "=LET(f, LAMBDA(x, x), f(",
    "",
  ])("finds no function for %j", (text) => {
    expect(signature(text)).toBeUndefined();
  });
});

describe("applySuggestion", () => {
  function accept(marked: string, label: string): string {
    const caret = marked.indexOf("|");
    const text = marked.replace("|", "");
    const found = suggestionsAt(text, caret, context);
    const suggestion = found.items.find((item) => item.label === label);
    if (!suggestion) throw new Error(`No suggestion ${label}`);
    const result = applySuggestion(text, found, caret, suggestion);
    return `${result.text.slice(0, result.caret)}|${result.text.slice(result.caret)}`;
  }

  it("replaces the typed word and puts the caret after the insertion", () => {
    expect(accept("=su|", "SUM")).toBe("=SUM(|");
    expect(accept("=1 + ro| * 2", "ROUND")).toBe("=1 + ROUND(| * 2");
    expect(accept("=sal|", "Sales Targets")).toBe("='Sales Targets'!|");
    expect(accept("=SUM('sales t|", "Sales Targets")).toBe("=SUM('Sales Targets'!|");
    expect(accept("=LET(total, 1, to|", "total")).toBe("=LET(total, 1, total|");
  });

  it("does not double a parenthesis that already follows", () => {
    expect(accept("=su|(A1)", "SUM")).toBe("=SUM|(A1)");
  });
});
