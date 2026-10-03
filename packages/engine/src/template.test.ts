import { describe, expect, it } from "vitest";
import {
  parseTemplate,
  renderTemplate,
  rewriteTemplate,
  TemplateSyntaxError,
  type TemplateBlock,
} from "./template";
import { STRUCTURE, workbookWith } from "./testing";
import type { Evaluated } from "./values";
import { Workbook } from "./workbook";

// A sales table on page 1 and a summary on the Archive page, both named Table1.
const workbook = workbookWith({
  t1: {
    A1: "pear",
    B1: "5",
    A2: "apple",
    B2: "12",
    A3: "fig",
    B3: "8",
  },
  t2: { A1: "Q3 report", A2: "*not bold*" },
});
const PAGE = STRUCTURE.pages[0]?.id ?? "";

function render(source: string): TemplateBlock[] {
  return renderTemplate(source, (expression, names) =>
    workbook.evaluateOnPage(PAGE, expression, names),
  );
}

/** The Markdown of a view that renders to Markdown alone. */
function markdown(source: string): string {
  const blocks = render(source);
  expect(blocks.map((block) => block.type)).toEqual(blocks.length === 0 ? [] : ["markdown"]);
  const [block] = blocks;
  return block?.type === "markdown"
    ? block.parts.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
    : "";
}

function inlineParts(source: string) {
  return render(source).flatMap((block) => (block.type === "markdown" ? block.parts : []));
}

function inlineErrors(source: string) {
  return inlineParts(source).flatMap((part) => (part.type === "error" ? [part.error] : []));
}

describe("output", () => {
  it("puts the value of a formula into the text", () => {
    expect(markdown("Total sold: {{ SUM(Table1!B1:B3) }} items.")).toBe("Total sold: 25 items.");
    expect(markdown("{{Table1!A1}} and {{ UPPER(Table1!A2) }}")).toBe("pear and APPLE");
  });

  it("leaves text without tags as it is", () => {
    expect(markdown("# Title\n\nSome *emphasis* and a { brace }.")).toBe(
      "# Title\n\nSome *emphasis* and a { brace }.",
    );
    expect(render("")).toEqual([]);
    expect(render("  \n ")).toEqual([]);
  });

  it("escapes Markdown characters in a value, so the value shows as written", () => {
    expect(markdown("{{ 'Other Table'!A2 }}")).toBe("\\*not bold\\*");
    expect(markdown('{{ 1.5 }} {{ -2 }} {{ "a_b #1" }}')).toBe("1\\.5 \\-2 a\\_b \\#1");
  });

  it("preserves error values and messages for inline rendering", () => {
    expect(render("{{ 1/0 }} and {{ nonexistentvar }}")).toMatchObject([
      {
        type: "markdown",
        parts: [
          {
            type: "error",
            error: { kind: "error", code: "#DIV/0!", message: "Division by zero" },
          },
          { type: "text", text: " and " },
          {
            type: "error",
            error: { kind: "error", code: "#NAME?", message: "Unknown name 'nonexistentvar'" },
          },
        ],
      },
    ]);
    expect(inlineErrors("{{ Missing!A1 }} and {{ A1 }}").map((value) => value.code)).toEqual([
      "#REF!",
      "#REF!",
    ]);
    expect(inlineErrors("{{ 1 + }}").map((value) => value.code)).toEqual(["#ERROR!"]);
  });

  it("allows the closing characters inside quoted text", () => {
    expect(markdown('{{ "}}" & "%}" }}')).toBe("\\}\\}\\%\\}");
  });

  it("shows a range as a table, which splits the Markdown around it", () => {
    expect(render("Before\n\n{{ Table1!A1:B2 }}\n\nAfter")).toEqual([
      { type: "markdown", parts: [{ type: "text", text: "Before\n\n" }] },
      {
        type: "table",
        rows: [
          ["pear", 5],
          ["apple", 12],
        ],
      },
      { type: "markdown", parts: [{ type: "text", text: "\n\nAfter" }] },
    ]);
  });

  it("shows a range of one cell as a single value", () => {
    expect(markdown("{{ Table1!A1:A1 }}")).toBe("pear");
  });

  it("shows a chart as a chart", () => {
    expect(render('{{ PIE_CHART(Table1!A1:B3, "Sales") }}')).toEqual([
      {
        type: "chart",
        chart: {
          kind: "chart",
          chart: "pie",
          title: "Sales",
          rows: [
            ["pear", 5],
            ["apple", 12],
            ["fig", 8],
          ],
        },
      },
    ]);
  });
});

describe("let", () => {
  it("names a value for the expressions after it", () => {
    expect(markdown("{% let total = SUM(Table1!B1:B3) %}{{ total }} and {{ total * 2 }}")).toBe(
      "25 and 50",
    );
  });

  it("names a range or a function, and ignores the letter case of the name", () => {
    expect(
      markdown(
        "{% let Sales = Table1!A1:B3 %}{% let double = LAMBDA(n, n * 2) %}{{ ROWS(sales) }} {{ double(4) }}",
      ),
    ).toBe("3 8");
  });

  it("takes its line with it, leaving no blank line", () => {
    expect(markdown("Top\n{% let x = 1 %}\n  {% let y = 2 %}  \nBottom {{ x + y }}")).toBe(
      "Top\nBottom 3",
    );
  });

  it("replaces an earlier value of the same name", () => {
    expect(markdown("{% let x = 1 %}{% let x = x + 1 %}{{ x }}")).toBe("2");
  });
});

describe("for", () => {
  it("repeats its body once per row, naming the cells of the row", () => {
    expect(
      markdown(
        "{% for name, sold in Table1!A1:B3 %}\n- **{{ name }}:** {{ sold }}\n{% end %}\nDone",
      ),
    ).toBe("- **pear:** 5\n- **apple:** 12\n- **fig:** 8\nDone");
  });

  it("gives one name the whole row, or the cell when rows have one cell", () => {
    expect(
      markdown("{% for row in Table1!A1:B2 %}{{ COLUMNS(row) }}{{ INDEX(row, 1) }} {% end %}"),
    ).toBe("2pear 2apple ");
    expect(markdown("{% for name in Table1!A1:A3 %}{{ name }},{% end %}")).toBe("pear,apple,fig,");
  });

  it("runs no times over a table that has no rows", () => {
    const empty = new Workbook();
    empty.setStructure({
      ...STRUCTURE,
      tables: STRUCTURE.tables.map((table) =>
        table.id === "t1"
          ? { ...table, rowCount: 0, colCount: 2, columns: [{ name: "Name", type: "any" }] }
          : table,
      ),
    });
    const blocks = renderTemplate(
      "{% for name in Table1[Name] %}{{ name }},{% end %}{{ ROWS(Table1!A:B) }} rows",
      (expression, names) => empty.evaluateOnPage(PAGE, expression, names),
    );
    expect(blocks).toEqual([{ type: "markdown", parts: [{ type: "text", text: "0 rows" }] }]);
  });

  it("works on the result of a formula, such as a sorted and shortened range", () => {
    expect(
      markdown(
        "{% for name, sold in TAKE(SORT(Table1!A1:B3, 2, FALSE), 2) %}{{ name }}={{ sold }} {% end %}",
      ),
    ).toBe("apple=12 fig=8 ");
  });

  it("leaves a name without a cell empty, and runs once for a single value", () => {
    expect(markdown("{% for a, b, c in Table1!A1:B1 %}[{{ a }}|{{ b }}|{{ c }}]{% end %}")).toBe(
      "[pear|5|]",
    );
    expect(markdown("{% for n in 7 %}{{ n }}{% end %}")).toBe("7");
  });

  it("keeps names bound inside the loop from leaking out of it", () => {
    expect(
      markdown(
        '{% let x = 0 %}{% for n in Table1!B1:B2 %}{% let x = n %}{% end %}{{ x }} {{ IFERROR(n, "gone") }}',
      ),
    ).toBe("0 gone");
  });

  it("nests", () => {
    expect(
      markdown(
        "{% for a in SEQUENCE(2) %}{% for b in SEQUENCE(2) %}{{ a }}{{ b }} {% end %}{% end %}",
      ),
    ).toBe("11 12 21 22 ");
  });

  it("shows the error when what it loops over is one", () => {
    expect(
      inlineErrors("{% for a in Missing!A1:A2 %}never{% end %}").map((value) => value.code),
    ).toEqual(["#REF!"]);
  });

  it("stops a view that repeats too many times", () => {
    expect(
      render("{% for a in SEQUENCE(200) %}{% for b in SEQUENCE(200) %}x{% end %}{% end %}"),
    ).toEqual([{ type: "error", message: "Line 1: The view repeats more than 10000 times" }]);
  });
});

describe("if", () => {
  it("shows one branch or the other", () => {
    const source = "{% if SUM(Table1!B1:B3) > LIMIT %}over{% else %}under{% end %}";
    expect(markdown(source.replace("LIMIT", "20"))).toBe("over");
    expect(markdown(source.replace("LIMIT", "30"))).toBe("under");
  });

  it("shows nothing for a false condition with no else", () => {
    expect(render("{% if FALSE %}hidden{% end %}")).toEqual([]);
    expect(markdown("a{% if Table1!C9 %}hidden{% end %}b")).toBe("ab");
  });

  it("works inside a loop, with the loop's names", () => {
    expect(
      markdown(
        "{% for name, sold in Table1!A1:B3 %}{% if sold > 6 %}{{ name }} {% end %}{% end %}",
      ),
    ).toBe("apple fig ");
  });

  it("shows the error when the condition cannot be decided", () => {
    expect(inlineParts("before{% if 1/0 %}a{% else %}b{% end %}after")).toEqual([
      { type: "text", text: "before" },
      {
        type: "error",
        error: { kind: "error", code: "#DIV/0!", message: "Division by zero" },
      },
      { type: "text", text: "after" },
    ]);
    expect(inlineParts('{% if "maybe" %}a{% end %}')).toEqual([
      {
        type: "error",
        error: { kind: "error", code: "#VALUE!", message: '"maybe" is not TRUE or FALSE' },
      },
    ]);
    expect(inlineParts("{% if Table1!A1:B2 %}a{% end %}")).toEqual([
      {
        type: "error",
        error: { kind: "error", code: "#VALUE!", message: "Expected a single value" },
      },
    ]);
  });
});

describe("comments", () => {
  it("show nothing, and may hold anything", () => {
    expect(markdown("a{# {{ not run }} {% nor this %} #}b")).toBe("ab");
    expect(markdown("line\n{# a note #}\nnext")).toBe("line\nnext");
  });
});

describe("syntax errors", () => {
  it.each([
    ["{{ 1 + 1", "Line 1: {{ is never closed"],
    ["ok\n\n{% if TRUE %}\nnever closed", "Line 3: {% if %} is never closed with {% end %}"],
    ["{% for a in SEQUENCE(2) %}", "Line 1: {% for %} is never closed with {% end %}"],
    ["text\n{% end %}", "Line 2: {% end %} has nothing to close"],
    ["{% else %}", "Line 1: {% else %} has no {% if %} to belong to"],
    [
      "{% for a in SEQUENCE(2) %}{% else %}{% end %}",
      "Line 1: {% else %} has no {% if %} to belong to",
    ],
    [
      "{% if TRUE %}{% else %}{% else %}{% end %}",
      "Line 1: {% else %} has no {% if %} to belong to",
    ],
    ["{% loop %}", "Line 1: {% loop %} is not a tag this view understands"],
    ["{% let x %}", "Line 1: {% let x %} is not a tag this view understands"],
    [
      "{% for in SEQUENCE(2) %}{% end %}",
      "Line 1: {% for in SEQUENCE(2) %} is not a tag this view understands",
    ],
    ["{% let a1 = 5 %}", "Line 1: a1 is a cell address and cannot be used as a name"],
    [
      "{% for x, b2 in SEQUENCE(2) %}{% end %}",
      "Line 1: b2 is a cell address and cannot be used as a name",
    ],
    ["{# unclosed", "Line 1: {# is never closed"],
  ])("renders %j as the message %j", (source, message) => {
    expect(render(source)).toEqual([{ type: "error", message }]);
  });

  it("throws from parseTemplate with the line", () => {
    expect(() => parseTemplate("a\nb\n{% end %}")).toThrow(TemplateSyntaxError);
    try {
      parseTemplate("a\nb\n{% end %}");
    } catch (cause) {
      expect((cause as TemplateSyntaxError).line).toBe(3);
    }
  });
});

describe("parseTemplate", () => {
  it("builds a tree of text, outputs, and blocks", () => {
    expect(
      parseTemplate(
        "Hi {{ a }}{% if b %}x{% else %}{% for c, d in e %}{{ c }}{% endfor %}{% endif %}",
      ),
    ).toEqual([
      { type: "text", text: "Hi " },
      { type: "output", expression: "a" },
      {
        type: "if",
        expression: "b",
        then: [{ type: "text", text: "x" }],
        otherwise: [
          {
            type: "for",
            names: ["c", "d"],
            expression: "e",
            body: [{ type: "output", expression: "c" }],
          },
        ],
      },
    ]);
  });
});

describe("the example from the project notes", () => {
  it("renders a report with a total, a loop over the top rows, a chart, and a table", () => {
    const source = [
      "Total sales were ${{ SUM(Table1!B:B) }}.",
      "",
      "## Top sellers",
      "",
      "{% let sales = Table1!A:B %}",
      "{% let top = TAKE(SORT(sales, 2, FALSE), 2) %}",
      "",
      "{% for name, amount in top %}",
      "- **{{ name }}:** ${{ amount }}",
      "{% end %}",
      "",
      "{{ PIE_CHART(sales) }}",
      "",
      "## All of them",
      "",
      "{{ SORT(sales, 2, FALSE) }}",
    ].join("\n");
    const blocks = render(source);
    expect(blocks.map((block) => block.type)).toEqual(["markdown", "chart", "markdown", "table"]);
    expect(blocks[0]).toEqual({
      type: "markdown",
      parts: [
        {
          type: "text",
          text: "Total sales were $25.\n\n## Top sellers\n\n\n- **apple:** $12\n- **fig:** $8\n\n",
        },
      ],
    });
    expect(blocks[3]).toMatchObject({
      rows: [
        ["apple", 12],
        ["fig", 8],
        ["pear", 5],
      ],
    });
  });
});

describe("rewriteTemplate", () => {
  const rename = (reference: {
    table?: string;
  }): Evaluated extends never ? never : object | undefined =>
    reference.table === "Old" ? { ...reference, table: "New Name" } : undefined;

  it("rewrites references in every kind of tag and nowhere else", () => {
    const source = [
      "Old!A1 in plain text stays. {{ Old!A1 + other!B2 }}",
      "{% let x = SUM(Old!A:A) %}",
      "{% for a, b in  Old!A1:B9 %}{{ a }}{% end %}",
      "{% if Old!C1 > 0 %}yes{% end %}",
      "{# Old!A1 in a comment stays #}",
    ].join("\n");
    expect(rewriteTemplate(source, rename as never)).toBe(
      [
        "Old!A1 in plain text stays. {{ 'New Name'!A1 + other!B2 }}",
        "{% let x = SUM('New Name'!A:A) %}",
        "{% for a, b in  'New Name'!A1:B9 %}{{ a }}{% end %}",
        "{% if 'New Name'!C1 > 0 %}yes{% end %}",
        "{# Old!A1 in a comment stays #}",
      ].join("\n"),
    );
  });

  it("leaves an expression that does not parse, and rewrites the others", () => {
    expect(rewriteTemplate("{{ Old!A1 + }} {{ Old!A1 }}", rename as never)).toBe(
      "{{ Old!A1 + }} {{ 'New Name'!A1 }}",
    );
  });

  it("returns a template with broken tags unchanged", () => {
    expect(rewriteTemplate("{{ Old!A1 }} {% nonsense Old!A1 %}", rename as never)).toBe(
      "{{ Old!A1 }} {% nonsense Old!A1 %}",
    );
    expect(rewriteTemplate("{{ Old!A1", rename as never)).toBe("{{ Old!A1");
  });
});
