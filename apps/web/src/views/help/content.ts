import {
  createWorkbook,
  EXAMPLE_CELLS,
  formatValue,
  FUNCTION_CATEGORIES,
  functionDocs,
  isButton,
  isChart,
  isControl,
  parseAddress,
  type CellValue,
  type FunctionCategory,
  type FunctionDoc,
} from "@spreadsheet-app/engine";

const TABLE_ID = "examples";
// Below the cells the examples read, so an example never overwrites its own input.
const SCRATCH = { tableId: TABLE_ID, row: 100, col: 0 };

/** Runs each documented example through the engine, so the page shows what the app really computes. */
function exampleResults(): Map<string, string> {
  const workbook = createWorkbook({
    pages: [{ id: "page", name: "Page 1" }],
    tables: [{ id: TABLE_ID, pageId: "page", name: "Table 1" }],
    cells: Object.entries(EXAMPLE_CELLS).flatMap(([address, input]) => {
      const parsed = parseAddress(address);
      return parsed ? [{ tableId: TABLE_ID, ...parsed, input }] : [];
    }),
  });
  return new Map(
    functionDocs.map((doc) => {
      workbook.setCell(SCRATCH, `=${doc.example}`);
      return [doc.name, describeResult(workbook.getArray(SCRATCH))];
    }),
  );
}

/** Says what a formula shows: one value, or the cells an array fills. */
function describeResult(rows: CellValue[][]): string {
  const [first = []] = rows;
  const [single = null] = first;
  if (rows.length === 1 && first.length === 1) {
    if (isButton(single)) return `a button labeled “${single.label}”`;
    if (isChart(single)) {
      return single.title === ""
        ? `a ${single.chart} chart`
        : `a ${single.chart} chart titled “${single.title}”`;
    }
    if (!isControl(single)) return formatValue(single);
    if (single.control === "checkbox") return `a checkbox labeled “${single.label}”`;
    if (single.control === "dropdown")
      return `a list offering ${single.options.map(formatValue).join(", ")}`;
    return single.control === "numberbox" ? "a number input" : "a text input";
  }
  const lines = rows.map((cells) => cells.map(formatValue).join(", "));
  if (rows.length === 1) return `${lines.join("")} across a row`;
  if (first.length === 1) return `${lines.join(", ")} down a column`;
  return `${String(rows.length)} rows: ${lines.join(" / ")}`;
}

export const results = exampleResults();
export const exampleCells = Object.entries(EXAMPLE_CELLS)
  .map(([address, input]) => `${address} = ${input}`)
  .join(", ");

export const byCategory = FUNCTION_CATEGORIES.map((category: FunctionCategory) => ({
  category,
  docs: functionDocs.filter((doc: FunctionDoc) => doc.category === category),
}));

/** Splits text on backticks so the marked parts can be shown as code. */
export function segments(text: string): { text: string; code: boolean }[] {
  return text.split("`").map((part, index) => ({ text: part, code: index % 2 === 1 }));
}

export const KEYS = [
  ["Arrow keys, outside an editor", "Move the selection."],
  ["Any character", "Start typing over the selected cell."],
  ["Enter or F2", "Edit the selected cell's current contents."],
  ["Alt+Enter, on a table-size spill error", "Focus the Resize to fit button."],
  [
    "Enter, while editing a cell",
    "Save and move down, unless accepting an arrow-selected suggestion.",
  ],
  ["Arrow keys, while editing", "Move the caret or navigate completion suggestions."],
  ["Tab, Shift+Tab", "Save and move right or left."],
  [
    "Escape, while editing",
    "Dismiss completion, then cancel picking. Otherwise discard a single-line draft; retain scripts and text views.",
  ],
  ["Tab, while a list of suggestions shows", "Complete the word with the highlighted suggestion."],
  ["Up or Down, while suggestions show", "Move the highlight. Enter then accepts it."],
  ["Delete or Backspace", "Clear the selected cells."],
  ["Shift with an arrow key", "Select a range of cells."],
  [
    "Ctrl/Cmd+Arrow keys",
    "Jump to the edge of a contiguous non-empty region in that direction; from an empty cell or beside an empty cell, move to the next non-empty cell, or to the table edge. Vertical movement follows displayed row order. Shift extends the selection.",
  ],
  [
    "Home, End",
    "Move to the first column of the row or the last column of the table. Shift extends the selection.",
  ],
  [
    "Ctrl/Cmd+Home, Ctrl/Cmd+End",
    "Move to A1 or the bottom-right cell of the used range (A1 when empty). Shift extends the selection.",
  ],
  [
    "PageUp, PageDown",
    "Move up or down by the number of rows visible in the viewport. Shift extends the selection.",
  ],
  [
    "Ctrl/Cmd+B, Ctrl/Cmd+I",
    "Toggle bold or italic on the selected cells; the shortcut clears a format only when every selected cell has it.",
  ],
  ["Ctrl+C, Ctrl+X, Ctrl+V", "Copy, cut, and paste the selected cells."],
  [
    "Ctrl/Cmd+Z, Ctrl/Cmd+Y",
    "Undo or redo the active draft; otherwise undo or redo workbook changes.",
  ],
  ["Enter, in scripts and text views", "Insert a newline."],
  ["Ctrl/Cmd+Enter, in scripts and text views", "Save the source."],
  ["Ctrl/Cmd+[ or Ctrl/Cmd+], in scripts and text views", "Indent or unindent lines."],
  [
    "Ctrl/Cmd+D, with text selected in an editor",
    "Select the next occurrence of that text; with no selection, select the word under the cursor.",
  ],
  ["Ctrl+A", "Select every cell of the table."],
  ["Shift+F10", "Open the menu of row, column, and cell actions."],
  ["Ctrl+D, Ctrl+R", "Copy the first row of the selection down, or its first column across."],
] as const;

export const REFERENCES = [
  ["A1", "The cell in column A, row 1 of the formula's own table."],
  ["A1:B3", "A range: every cell from A1 to B3. Functions such as SUM take ranges."],
  ["A:A", "All of column A. A:C is columns A to C."],
  ["2:2", "All of row 2. 2:5 is rows 2 to 5."],
  ["A2:A", "Column A from row 2 to the bottom of the table."],
  ["A1:4", "Rows 1 to 4, from column A to the last column of the table."],
  ["Sales", "All rows of the unique table named Sales, wherever it is in the document."],
  [
    "$A$1",
    "The same cell as A1. The $ marks keep it from moving when the formula is filled or pasted.",
  ],
  ["Sales!A1", "Cell A1 of the table named Sales on the formula's own page."],
  ["'Table 2'!A1:A9", "A table whose name has a space needs single quotes."],
  ["'Page 2'!Sales!A1", "Cell A1 of the table Sales on the page named Page 2."],
  ["'Page 2'!Sales", "All rows of the table Sales on the page named Page 2."],
  [
    "[Price]",
    "In a table with named columns: the cell of the column Price in the formula's own row.",
  ],
  [
    "Sales[Price]",
    "Every cell of the column Price in the table Sales. 'Table 2'[Unit price] and 'Page 2'!Sales[Price] work the same way.",
  ],
] as const;

export const QUERY_CLAUSES = [
  [
    "select A, C * 2",
    "Which columns to give, and values computed from them. `select *` gives every column.",
  ],
  ["select A as Name", "Names a result column."],
  ['where C > 5 and B = "Fruit"', "Keeps the rows that pass a test."],
  [
    "group by B",
    "Makes one row for each value of B. Other columns must be inside `sum`, `count`, `avg`, `min`, `max`, or `median`.",
  ],
  ["having sum(C) > 10", "Keeps the groups that pass a test."],
  ["pivot B", "Makes a column for each value of B."],
  ["order by C desc, A", "Sorts the rows. `desc` sorts from the largest."],
  ["limit 10 offset 5", "Gives at most 10 rows, after skipping 5."],
  ['label C "Units"', "Names a result column, as `as` does."],
] as const;

export const QUERY_TESTS = [
  ["= != < > <= >=", "Compare. An empty cell passes none of them."],
  ["and, or, not", "Combine tests."],
  ['A contains "an"', "Text that contains other text. Also `starts with` and `ends with`."],
  [
    'A like "b%"',
    "Text that fits a pattern, where `%` is any run of characters and `_` is any one.",
  ],
  ['A in ("x", "y")', "One of several values."],
  ["C is null", "An empty cell. Also `is not null`."],
  ['D >= date "2026-01-31"', "A date is written with the word `date` before it."],
] as const;

export const TEMPLATE_TAGS = [
  ["{{ SUM(Sales!B:B) }}", "The value of a formula, written without the leading =."],
  ["{% let total = SUM(Sales!B:B) %}", "Gives a value a name that later formulas can use."],
  [
    "{% for name, amount in Sales!A2:B9 %} … {% end %}",
    "Repeats what is between the tags once for each row, naming the cells of the row in order.",
  ],
  [
    "{% if total > 100 %} … {% else %} … {% end %}",
    "Shows the first part when the formula is true, and the second when it is not. The else part is optional.",
  ],
  ["{# note #}", "A comment. It is not shown."],
] as const;

export const TEMPLATE_EXAMPLE = `## Sales report

{% let total = SUM(Sales!B2:B) %}
We sold **{{ total }}** in all.

{% for name, amount in Sales!A2:B4 %}
- {{ name }}: {{ amount }}{% if amount > 100 %} (a big one){% end %}
{% end %}

{{ BAR_CHART(Sales!A2:B4, "Sales by person") }}`;

export const TEMPLATE_BUTTON_EXAMPLE = '{{ BUTTON("Approve", EXECUTE(TRUE, Sales!D2)) }}';
export const TEMPLATE_CELL_REFERENCE = "{{Sales!D1}}";
export const TEMPLATE_COMPUTED_REFERENCE = "{{Sales!D1 * 2}}";

export const OPERATORS = [
  ["-x", "Negation", "-A1"],
  ["^", "Power", "A1 ^ 2"],
  ["* /", "Multiply, divide", "A1 * A2 / 4"],
  ["+ -", "Add, subtract", "A1 + A2 - 1"],
  ["&", "Join as text", 'A1 & " items"'],
  ["= <> != < > <= >=", "Compare. The result is TRUE or FALSE.", "A1 != A2"],
  ["not", "Boolean NOT", "not A1 > 1"],
  ["and", "Boolean AND", "A1 > 1 and A2 < 2"],
  ["or", "Boolean OR", "A1 or A2"],
] as const;
