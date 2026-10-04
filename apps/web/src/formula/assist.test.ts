import { describe, expect, it } from "vitest";
import { applySuggestion, signatureAt, suggestionsAt, type NamingContext } from "./assist";

const context: NamingContext = {
  pages: [
    { id: "p1", name: "Summary" },
    { id: "p2", name: "Raw Data" },
  ],
  tables: [
    {
      pageId: "p1",
      name: "Sales",
      columns: [{ name: "Price" }, { name: "Paid on" }, { name: "Qty" }],
    },
    { pageId: "p1", name: "Sales Targets" },
    { pageId: "p2", name: "Imports" },
    { pageId: "p2", name: "Joe's" },
  ],
  pageId: "p1",
  columns: [{ name: "Item" }, { name: "In stock" }],
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
    expect(labels("=round")).toEqual(["ROUND", "ROUNDDOWN", "ROUNDUP"]);
    expect(labels("=1+ROUNDD")).toEqual(["ROUNDDOWN"]);
    expect(suggest("=su").items.find((item) => item.label === "SUM")).toEqual({
      kind: "function",
      label: "SUM",
      insert: "SUM(",
      detail: "SUM(value, ...)",
    });
  });

  it("offers function completion after the != operator", () => {
    expect(suggest("=A1 != cla").items).toContainEqual({
      kind: "function",
      label: "CLAMP",
      insert: "CLAMP(",
      detail: "CLAMP(value, min, max)",
    });
  });

  it("lists functions before tables and pages", () => {
    expect(labels("=sum")).toEqual(["SUM", "SUMIF", "SUMIFS", "SUMPRODUCT", "Summary"]);
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
    expect(labels("=LET(total, SUM(A1:A3), rate, 2, to")).toEqual(["total", "TO_DATE", "TODAY"]);
    expect(labels("=LAMBDA(price, qty, pr")).toEqual(["price", "PRODUCT", "PROPER"]);
  });

  it("does not offer the word being typed as a name, a cell address, or a function name used as one", () => {
    expect(labels("=LET(tot")).toEqual([]);
    expect(labels("=A1 + ab")).toEqual(["ABS"]);
    expect(labels("=LET(x, sum, sum")).toEqual(["SUM", "SUMIF", "SUMIFS", "SUMPRODUCT", "Summary"]);
  });

  it("uses the word that ends at the caret, wherever the caret is", () => {
    expect(labels("=ROUND|UP(A1)")).toEqual(["ROUND", "ROUNDDOWN", "ROUNDUP"]);
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
    expect(labels('="su" & upp')).toEqual(["UPPER"]);
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

describe("column names", () => {
  it("offers the columns of the formula's own table after an open bracket", () => {
    expect(suggest("=[")).toEqual({
      from: 1,
      items: [
        { kind: "column", label: "Item", insert: "[Item]", detail: "column of this row" },
        { kind: "column", label: "In stock", insert: "[In stock]", detail: "column of this row" },
      ],
    });
    expect(labels("=1 + [in")).toEqual(["In stock"]);
    expect(labels("=[it")).toEqual(["Item"]);
    expect(labels("=[x")).toEqual([]);
  });

  it("offers the columns of a named table on the formula's page", () => {
    expect(suggest("=SUM(Sales[p")).toMatchObject({
      from: 10,
      items: [
        { label: "Price", insert: "[Price]", detail: "column of Sales" },
        { label: "Paid on", insert: "[Paid on]" },
      ],
    });
    expect(labels("=sales[")).toEqual(["Price", "Paid on", "Qty"]);
    expect(labels("='Sales Targets'[")).toEqual([]);
    expect(labels("=Imports[")).toEqual([]);
  });

  it("offers nothing once the bracket is closed, or inside text", () => {
    expect(labels("=[Item] + q")).toEqual(["QUARTILE", "QUERY", "QUOTIENT"]);
    expect(labels('="[it')).toEqual([]);
  });

  it("completes a name with spaces, and does not double a bracket that is already there", () => {
    const complete = (marked: string): string => {
      const caret = marked.indexOf("|");
      const text = marked.replace("|", "");
      const found = suggestionsAt(text, caret, context);
      return applySuggestion(text, found, caret, found.items[0]!).text;
    };
    expect(complete("=[in| * 2")).toBe("=[In stock] * 2");
    expect(complete("=[in|] * 2")).toBe("=[In stock] * 2");
    expect(complete("=SUM(Sales[pa|)")).toBe("=SUM(Sales[Paid on])");
  });

  it("offers the names the document defines, and the names a script on this page holds after its name", () => {
    const named: NamingContext = {
      ...context,
      names: [
        { name: "TaxRate", holder: "Rates", pageId: "p1" },
        { name: "Total", holder: "Other", pageId: "p2" },
      ],
    };
    expect(suggestionsAt("=Tax", 4, named).items[0]).toEqual({
      kind: "name",
      label: "TaxRate",
      insert: "TaxRate",
      detail: "name in Rates",
    });
    expect(suggestionsAt("=Rates!T", 8, named).items.map((item) => item.label)).toEqual([
      "TaxRate",
    ]);
  });
});
