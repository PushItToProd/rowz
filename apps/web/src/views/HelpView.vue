<script setup lang="ts">
import {
  createWorkbook,
  errorDocs,
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
import { LIMITS } from "@spreadsheet-app/shared";
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { usePageTitle } from "../pageTitle";

usePageTitle("Help");

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
    return single.control === "checkbox"
      ? `a checkbox labeled “${single.label}”`
      : `a list offering ${single.options.map(formatValue).join(", ")}`;
  }
  const lines = rows.map((cells) => cells.map(formatValue).join(", "));
  if (rows.length === 1) return `${lines.join("")} across a row`;
  if (first.length === 1) return `${lines.join(", ")} down a column`;
  return `${String(rows.length)} rows: ${lines.join(" / ")}`;
}

const results = exampleResults();
const exampleCells = Object.entries(EXAMPLE_CELLS)
  .map(([address, input]) => `${address} holds ${input}`)
  .join(", ");

const byCategory = FUNCTION_CATEGORIES.map((category: FunctionCategory) => ({
  category,
  docs: functionDocs.filter((doc: FunctionDoc) => doc.category === category),
}));

/** Splits text on backticks so the marked parts can be shown as code. */
function segments(text: string): { text: string; code: boolean }[] {
  return text.split("`").map((part, index) => ({ text: part, code: index % 2 === 1 }));
}

const SECTIONS = [
  ["basics", "Typing into cells"],
  ["filling", "Selecting, filling, and copying"],
  ["structure", "Pages and tables"],
  ["columns", "Tables with named columns"],
  ["references", "References"],
  ["operators", "Operators"],
  ["functions", "Functions"],
  ["names", "Names and your own functions"],
  ["arrays", "Formulas that fill several cells"],
  ["query", "Queries"],
  ["actions", "Buttons and actions"],
  ["controls", "Checkboxes and dropdowns"],
  ["formats", "Formats"],
  ["conditional", "Conditional formats"],
  ["sharing", "Sharing"],
  ["history", "History"],
  ["files", "Files"],
  ["charts", "Charts"],
  ["text-views", "Text views"],
  ["errors", "Errors"],
] as const;

type SectionId = (typeof SECTIONS)[number][0];

/** A section is the one being read once its top is within this many pixels of the top of the window. */
const READING_LINE = 120;

/** The section being read, which the contents mark. */
const reading = ref<SectionId>(SECTIONS[0][0]);
const contents = ref<HTMLElement>();

function trackSection(): void {
  const page = document.documentElement;
  // The last sections are too short to reach the top of the window.
  const atEnd = window.scrollY > 0 && window.innerHeight + window.scrollY >= page.scrollHeight - 2;
  const passed = SECTIONS.map(([id]) => id).filter((id) => {
    const top = document.getElementById(id)?.getBoundingClientRect().top;
    return top !== undefined && top <= READING_LINE;
  });
  reading.value = (atEnd ? SECTIONS.at(-1)?.[0] : passed.at(-1)) ?? SECTIONS[0][0];
}

// The contents scroll on their own where they do not fit. Keep the marked entry in view.
watch(reading, async () => {
  await nextTick();
  const list = contents.value;
  const link = list?.querySelector<HTMLElement>('[aria-current="true"]');
  if (!list || !link) return;
  list.scrollLeft = link.offsetLeft - (list.clientWidth - link.offsetWidth) / 2;
  list.scrollTop = link.offsetTop - (list.clientHeight - link.offsetHeight) / 2;
});

onMounted(() => {
  window.addEventListener("scroll", trackSection, { passive: true });
  window.addEventListener("resize", trackSection);
  trackSection();
});
onBeforeUnmount(() => {
  window.removeEventListener("scroll", trackSection);
  window.removeEventListener("resize", trackSection);
});

const KEYS = [
  ["Arrow keys", "Move the selection."],
  ["Any character", "Start typing over the selected cell."],
  ["Enter or F2", "Edit the selected cell, keeping what it holds."],
  ["Enter or Down, while editing", "Save and move down."],
  ["Up, while editing", "Save and move up."],
  ["Tab, Shift+Tab", "Save and move right or left."],
  ["Escape", "Stop editing and discard what was typed."],
  ["Tab, while a list of suggestions shows", "Complete the word with the highlighted suggestion."],
  ["Up or Down, while suggestions show", "Move the highlight. Enter then accepts it."],
  ["Delete or Backspace", "Clear the selected cells."],
  ["Shift with an arrow key", "Select a range of cells."],
  ["Ctrl+C, Ctrl+X, Ctrl+V", "Copy, cut, and paste the selected cells."],
  ["Ctrl+Z, Ctrl+Y", "Undo or redo the last change made since this page was opened."],
  ["Ctrl+A", "Select every cell of the table."],
  ["Shift+F10", "Open the menu of row, column, and cell actions."],
  ["Ctrl+D, Ctrl+R", "Copy the first row of the selection down, or its first column across."],
] as const;

const REFERENCES = [
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

const QUERY_CLAUSES = [
  [
    "select A, C * 2",
    "Which columns to give, and values computed from them. `select *` gives every column.",
  ],
  ["select A as Name", "Names a result column."],
  ["where C > 5 and B = 'Fruit'", "Keeps the rows that pass a test."],
  [
    "group by B",
    "Makes one row for each value of B. Other columns must be inside `sum`, `count`, `avg`, `min`, `max`, or `median`.",
  ],
  ["having sum(C) > 10", "Keeps the groups that pass a test."],
  ["pivot B", "Makes a column for each value of B."],
  ["order by C desc, A", "Sorts the rows. `desc` sorts from the largest."],
  ["limit 10 offset 5", "Gives at most 10 rows, after skipping 5."],
  ["label C 'Units'", "Names a result column, as `as` does."],
] as const;

const QUERY_TESTS = [
  ["= != < > <= >=", "Compare. An empty cell passes none of them."],
  ["and, or, not", "Combine tests."],
  ["A contains 'an'", "Text that holds other text. Also `starts with` and `ends with`."],
  [
    "A like 'b%'",
    "Text that fits a pattern, where `%` is any run of characters and `_` is any one.",
  ],
  ["A in ('x', 'y')", "One of several values."],
  ["C is null", "An empty cell. Also `is not null`."],
  ["D >= date '2026-01-31'", "A date is written with the word `date` before it."],
] as const;

const TEMPLATE_TAGS = [
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

const TEMPLATE_EXAMPLE = `## Sales report

{% let total = SUM(Sales!B2:B) %}
We sold **{{ total }}** in all.

{% for name, amount in Sales!A2:B4 %}
- {{ name }}: {{ amount }}{% if amount > 100 %} (a big one){% end %}
{% end %}

{{ BAR_CHART(Sales!A2:B4, "Sales by person") }}`;

const OPERATORS = [
  ["-x", "Negation", "-A1"],
  ["^", "Power", "A1 ^ 2"],
  ["* /", "Multiply, divide", "A1 * A2 / 4"],
  ["+ -", "Add, subtract", "A1 + A2 - 1"],
  ["&", "Join as text", 'A1 & " items"'],
  ["= <> < > <= >=", "Compare. The result is TRUE or FALSE.", "A1 >= A2"],
] as const;
</script>

<template>
  <div class="help">
    <header class="help__header">
      <RouterLink :to="{ name: 'spreadsheets' }">← Spreadsheets</RouterLink>
      <h1>Help</h1>
    </header>

    <nav ref="contents" class="help__contents" aria-label="Contents">
      <a
        v-for="[id, title] in SECTIONS"
        :key="id"
        :href="`#${id}`"
        :aria-current="id === reading ? 'true' : undefined"
      >
        {{ title }}
      </a>
    </nav>

    <section id="basics">
      <h2>Typing into cells</h2>
      <p>
        Click a cell and type. What you type is the cell's <em>input</em>. The cell shows the
        input's <em>value</em>, and the bar above the tables shows the input of the selected cell.
      </p>
      <table>
        <thead>
          <tr>
            <th>You type</th>
            <th>The cell holds</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>42</code>, <code>-1.5</code>, <code>1e3</code></td>
            <td>A number.</td>
          </tr>
          <tr>
            <td><code>2026-09-30</code>, <code>2026-09-30 14:05</code></td>
            <td>A date, written year, month, day, optionally with a time.</td>
          </tr>
          <tr>
            <td><code>TRUE</code>, <code>false</code></td>
            <td>A true-or-false value, in any letter case.</td>
          </tr>
          <tr>
            <td><code>=A1+1</code></td>
            <td>A formula. Anything that starts with <code>=</code> is computed.</td>
          </tr>
          <tr>
            <td><code>'=A1+1</code>, <code>'42</code></td>
            <td>Text. A leading apostrophe keeps the rest from being read as anything else.</td>
          </tr>
          <tr>
            <td>Anything else</td>
            <td>Text.</td>
          </tr>
        </tbody>
      </table>
      <p>
        Inside a formula, write text in double quotes: <code>"hello"</code>. Write a double quote
        inside text by doubling it: <code>"say ""hi"""</code>.
      </p>
      <p>
        Dates can be compared, sorted, and used in arithmetic. Adding a number to a date moves it by
        that many days: <code>=A1 + 7</code>. Taking one date from another gives the days between
        them. Only the year-month-day form is read as a date, because forms such as
        <code>3/4/2026</code> mean different days in different countries.
      </p>
      <p>
        Changes are saved as you make them. Someone else with the spreadsheet open sees them after
        reloading the page.
      </p>

      <h3>Keyboard</h3>
      <table>
        <tbody>
          <tr v-for="[keys, effect] in KEYS" :key="keys">
            <th scope="row">{{ keys }}</th>
            <td>{{ effect }}</td>
          </tr>
        </tbody>
      </table>
    </section>

    <section id="filling">
      <h2>Selecting, filling, and copying</h2>
      <p>
        Drag across cells, or hold Shift and click or press the arrow keys, to select a range. The
        last cell of the selection has a small square at its corner. Drag that square down or across
        to fill more cells with what the selection holds.
      </p>
      <ul>
        <li>
          Filling and pasting move a formula's references by the distance the formula moved.
          <code>=A1*10</code> filled one row down becomes <code>=A2*10</code>.
        </li>
        <li>
          A <code>$</code> pins the part of a reference that follows it.
          <code>=A1*$B$1</code> filled down becomes <code>=A2*$B$1</code>, and
          <code>=$A1</code> filled across stays <code>=$A1</code>.
        </li>
        <li>
          On a phone or tablet, tap a cell to select it and tap it again to type into it. The bar
          above the tables edits the selected cell too. The buttons above a table insert and delete
          rows and columns.
        </li>
        <li>
          Click a row number or a column letter to select the whole row or column. Drag across
          several, or hold Shift and click another, to select them all. Ctrl+A selects the whole
          table.
        </li>
        <li>
          Dragging the handle continues a series: <code>1, 2</code> goes on to <code>3, 4</code>,
          dates an even step apart keep that step, a single date counts up by days, and
          <code>Week 1</code> goes on to <code>Week 2</code>. Anything else repeats as a pattern.
          Ctrl+D and Ctrl+R copy exactly and continue nothing.
        </li>
        <li>
          Copying puts the values the cells show on the clipboard, which is what other apps can use.
          Pasting them back here pastes the formulas. Text copied from another spreadsheet app is
          pasted cell by cell, and the table grows to fit it.
        </li>
      </ul>
    </section>

    <section id="structure">
      <h2>Pages and tables</h2>
      <p>
        A spreadsheet holds pages, shown as tabs. A page holds blocks: tables, charts, and text
        views. Each table is its own grid, with its own column letters and row numbers, so every
        table has a cell A1.
      </p>
      <ul>
        <li>
          Use <strong>Add page</strong> and <strong>Add table</strong> to grow a spreadsheet. The
          strip marked <strong>+</strong> under a table adds a row, and the one along its right edge
          adds a column. A table can have up to {{ LIMITS.tableRows }} rows and
          {{ LIMITS.tableCols }} columns.
        </li>
        <li>
          <strong>Resize</strong> sets how many columns and rows a table has. A smaller size deletes
          the rows and columns past it, as deleting them by hand does, and asks first when they hold
          something.
        </li>
        <li>
          Right-click a cell to insert a row or column next to it, or to delete its row or column.
          With several cells selected, the menu inserts as many rows or columns as the selection
          spans, and deletes the ones it spans. Right-click a row number or a column letter for the
          row or column actions alone. Shift+F10 opens the menu from the keyboard, and the buttons
          above the table insert and delete at the selected cell. Formulas that read the table are
          rewritten to keep reading the same cells. A formula that named a deleted cell shows
          <code>#REF!</code>.
        </li>
        <li>
          Double-click the name of a spreadsheet, page, or table to rename it. From the keyboard,
          move to the name with Tab and press Enter. A page's name is also the link that opens the
          page, so there Enter opens the page and F2 renames it.
        </li>
        <li>
          The arrows beside a block move it up or down its page, and the button under them moves it
          to another page. Formulas that read a moved table are rewritten to name its new page, so
          they keep reading it. A page cannot take a table with the name of one it already has.
        </li>
        <li>The arrows on the open page's tab move the page left or right among the tabs.</li>
        <li>
          Two pages in a spreadsheet cannot share a name, and neither can two tables on a page.
          Names are compared without regard to letter case.
        </li>
      </ul>
    </section>

    <section id="columns">
      <h2>Tables with named columns</h2>
      <p>
        <strong>Name columns</strong>, above a table, gives each column a name in place of its
        letter. The names can come from the table's first row, which then stops being a row of data.
        Double-click a name to change it.
      </p>
      <ul>
        <li>
          A formula names a column in square brackets. <code>=[Price] * [Qty]</code> multiplies the
          Price and Qty cells of the formula's own row. From anywhere,
          <code>=SUM(Sales[Price])</code> adds the whole Price column of the table Sales. Typing
          <code>[</code> in a formula lists the columns.
        </li>
        <li>
          Right-click a column to choose what it holds. <strong>Text</strong> keeps what is typed as
          it is, so <code>007</code> stays <code>007</code>. <strong>Number</strong> and
          <strong>Date</strong> show <code>#VALUE!</code> for anything else.
          <strong>Checkbox</strong> shows a checkbox in every row. <strong>A choice</strong> shows a
          dropdown in every row. Its choices are a list you write, one on each line, or the values
          of a column of a data table, which follow that column. A value that is not among the
          choices stays and is marked. <strong>Anything</strong> reads what is typed as an ordinary
          cell does.
        </li>
        <li>
          <strong>A formula</strong> makes a formula column: one formula computed in every stored
          row. Its cells cannot be typed into. Typing a formula into any of them, or into the bar
          above the tables while one is selected, changes the formula for the whole column.
        </li>
        <li>
          Renaming a column rewrites the formulas that name it. Cell addresses such as
          <code>A1</code> still work in a table with named columns, where row 1 is the first row of
          data.
        </li>
        <li>
          <code>QUERY</code> reads a data table's column names from a range or a whole-table
          reference. Array functions can combine whole columns, such as
          <code>HSTACK(Sales[Item], Sales[Total])</code>.
        </li>
        <li>
          Under a data table, <strong>Filter</strong> takes a formula that is true for the rows to
          show, such as <code>=[Payout] &gt; 60000</code>, and <strong>Add sort</strong> orders the
          rows by one or more columns. Right-click a column to sort by it. Sorting and filtering
          change only what is shown: the stored rows keep their order, so <code>A2</code> and
          <code>SUM(Sales[Amount])</code> read the same cells. A row for which the filter gives an
          error stays shown. The row numbers are the stored ones. While a table is sorted or
          filtered, a selection covers the rows shown, you cannot insert a row above or below, and
          formatting needs one row or whole columns.
        </li>
        <li>
          <strong>Remove column names</strong> makes the table a plain table again. Its formula
          columns become empty, and its sort and filter are cleared.
        </li>
      </ul>
    </section>

    <section id="references">
      <h2>References</h2>
      <p>A formula reads other cells by naming them.</p>
      <table>
        <thead>
          <tr>
            <th>Reference</th>
            <th>Reads</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[reference, meaning] in REFERENCES" :key="reference">
            <td>
              <code>{{ reference }}</code>
            </td>
            <td>{{ meaning }}</td>
          </tr>
        </tbody>
      </table>
      <p>
        Page and table names in a reference ignore letter case. A name needs single quotes unless it
        is made of letters, digits, and underscores and does not start with a digit. Write an
        apostrophe inside a quoted name by doubling it: <code>'Joe''s table'!A1</code>.
      </p>
      <p>
        Renaming a page or table rewrites the formulas that name it, so they keep reading the same
        cells.
      </p>
    </section>

    <section id="operators">
      <h2>Operators</h2>
      <p>
        Operators higher in this table are applied first. Operators in the same row are applied left
        to right. Parentheses override the order: <code>(1 + 2) * 3</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th>Operator</th>
            <th>Meaning</th>
            <th>Example</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[operator, meaning, example] in OPERATORS" :key="operator">
            <td>
              <code>{{ operator }}</code>
            </td>
            <td>{{ meaning }}</td>
            <td>
              <code>={{ example }}</code>
            </td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>
          Arithmetic reads text that looks like a number as that number, TRUE as 1, FALSE as 0, and
          an empty cell as 0.
        </li>
        <li>Negation is applied before a power, so <code>=-2^2</code> is 4.</li>
        <li>
          Comparing text ignores letter case. Between kinds, any number is less than any date, any
          date is less than any text, and any text is less than TRUE or FALSE.
        </li>
      </ul>
    </section>

    <section id="functions">
      <h2>Functions</h2>
      <p>
        Function names can be typed in any letter case. A parameter in square brackets may be left
        out. In the examples, {{ exampleCells }}.
      </p>
      <p class="help__jump">
        <a
          v-for="{ category } in byCategory"
          :key="category"
          :href="`#functions-${category.toLowerCase()}`"
        >
          {{ category }}
        </a>
      </p>
      <template v-for="{ category, docs } in byCategory" :key="category">
        <h3 :id="`functions-${category.toLowerCase()}`">{{ category }}</h3>
        <table class="help__functions">
          <thead>
            <tr>
              <th>Function</th>
              <th>What it does</th>
              <th>Example</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in docs" :key="doc.name" :data-function="doc.name">
              <td>
                <code>{{ doc.syntax }}</code>
              </td>
              <td>
                <template v-for="(part, index) in segments(doc.summary)" :key="index">
                  <code v-if="part.code">{{ part.text }}</code>
                  <template v-else>{{ part.text }}</template>
                </template>
              </td>
              <td>
                <code>={{ doc.example }}</code>
                <span class="help__result">gives {{ results.get(doc.name) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <section id="names">
      <h2>Names and your own functions</h2>
      <p>
        <code>LET</code> gives a name to a value so a formula can use it more than once:
        <code>=LET(total, SUM(A1:A3), total / COUNT(A1:A3))</code>. A name is any word that is not a
        cell address, so <code>total</code> and <code>tax_rate</code> work and <code>x1</code> does
        not. Names ignore letter case.
      </p>
      <p>
        A plain table or a script can hold names for values, ranges, and functions. A script has one
        definition per line, such as <code>Total = SUM(Sales[Amount])</code> or
        <code>WithTax(amount) = amount * (1 + TaxRate)</code>. A line can also check a formula with
        <code>ASSERT(Total &gt;= 0, "Sales cannot be negative")</code>.
      </p>
      <p>
        A bare name must have one meaning in the whole document. If two names, two tables, or a name
        and table share a spelling, a bare use shows <code>#NAME?</code>. Give them distinct
        spellings or qualify them by their holder. If the February and March scripts each define
        <code>Total</code>, write <code>February!Total</code> and <code>March!Total</code>. Add the
        page when the holder is on another page: <code>'Page 2'!Summary!Total</code>.
      </p>
      <p>
        <code>LAMBDA</code> makes a function. Its last part is what the function computes, and the
        parts before it are the names of its inputs. Call a function by putting values in
        parentheses after it.
      </p>
      <table>
        <tbody>
          <tr>
            <th scope="row">Call it at once</th>
            <td><code>=LAMBDA(x, x * 2)(21)</code></td>
          </tr>
          <tr>
            <th scope="row">Name it with LET</th>
            <td><code>=LET(double, LAMBDA(x, x * 2), double(A1) + double(A2))</code></td>
          </tr>
          <tr>
            <th scope="row">Keep it in a cell</th>
            <td>
              Put <code>=LAMBDA(x, x * 2)</code> in D1. Any formula can then call
              <code>=D1(21)</code>, or <code>=Tools!D1(21)</code> from another table.
            </td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>A cell that holds a function shows <code>LAMBDA</code> and its input names in gray.</li>
        <li>
          Cell references inside a function are read from the cell that defines it, wherever it is
          called from.
        </li>
        <li>
          A function kept in a cell cannot call its own cell. A function can still repeat itself by
          taking itself as an input:
          <code>=LET(f, LAMBDA(self, n, IF(n &lt;= 1, 1, n * self(self, n - 1))), f(f, 5))</code>.
        </li>
        <li>
          Because a cell address before parentheses calls that cell, no function is named like one.
        </li>
      </ul>
    </section>

    <section id="arrays">
      <h2>Formulas that fill several cells</h2>
      <p>
        Some formulas give several values. <code>=SEQUENCE(3)</code> gives 1, 2, and 3, and
        <code>=FILTER(A1:B9, B1:B9 &gt; 5)</code> gives every row that passes the test. The
        formula's own cell shows the first value, and the rest fill the cells below it and to its
        right. Filled cells have a tinted background.
      </p>
      <ul>
        <li>
          Other formulas read filled cells like any others: <code>=SUM(D:D)</code> adds a column
          that a formula in D1 filled.
        </li>
        <li>
          The error message says whether the table has too few rows or columns, or cells in the
          result range already have values. Typing into a filled cell causes the same error until
          that cell is cleared.
        </li>
        <li>
          Arithmetic and comparisons work cell by cell on a range: <code>=A1:A3 * 2</code> gives
          three values, and <code>=A1:A3 &gt; 1</code> gives three TRUE or FALSE values, which is
          what <code>FILTER</code> takes as a condition.
        </li>
        <li>
          A function that expects a single value, such as <code>UPPER</code> or <code>IF</code>,
          does not work cell by cell. Use <code>MAP</code> for that:
          <code>=MAP(A1:A3, LAMBDA(n, IF(n &gt; 1, "many", "one")))</code>.
        </li>
        <li>
          A whole column in arithmetic means that column's cell in the formula's own row:
          <code>=A:A + B:B</code> in row 5 is <code>=A5 + B5</code>, and the same formula can be
          filled down a column. It gives one value and fills no other cells. To work on every cell
          of a column at once, write the range from its first row, as in <code>=A1:A + B1:B</code>,
          or use a function that takes ranges, such as <code>SUMPRODUCT(A:A, B:B)</code>.
        </li>
        <li>
          A function that takes a range also takes an array, so results can be combined without
          filling any cells: <code>=SUM(A1:A3 * B1:B3)</code>.
        </li>
        <li><code>EXECUTE</code> writes an array into the cells starting at its target.</li>
      </ul>
    </section>

    <section id="query">
      <h2>Queries</h2>
      <p>
        <code>QUERY</code> picks, filters, groups, and sorts the rows of a range with a query
        written like SQL:
      </p>
      <pre><code>=QUERY(A1:D99, "select B, sum(C) where D >= date '2026-01-01' group by B order by sum(C) desc")</code></pre>
      <p>
        A column is named by its letter, counting from the first column of the range, so in
        <code>QUERY(C1:E9, …)</code> column C is <code>A</code>. A column with a header can also be
        named by it: <code>select Amount</code>. A header of several words goes in backticks:
        <code>select `Sold on`</code>. Text in a query goes in single quotes.
      </p>
      <p>
        A data table carries its column names into a query, without a header row in its data. For
        example, <code>=QUERY(Sales, "select Category, sum(Amount) group by Category")</code> can
        use those names and returns them as headings. The same works for a named-column range such
        as <code>Sales!A:C</code>.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Clause</th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[clause, meaning] in QUERY_CLAUSES" :key="clause">
            <td>
              <code>{{ clause }}</code>
            </td>
            <td>
              <template v-for="(part, index) in segments(meaning)" :key="index">
                <code v-if="part.code">{{ part.text }}</code>
                <template v-else>{{ part.text }}</template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th scope="col">Test</th>
            <th scope="col">What it matches</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[test, meaning] in QUERY_TESTS" :key="test">
            <td>
              <code>{{ test }}</code>
            </td>
            <td>
              <template v-for="(part, index) in segments(meaning)" :key="index">
                <code v-if="part.code">{{ part.text }}</code>
                <template v-else>{{ part.text }}</template>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <ul>
        <li>
          A query can call any function a formula can:
          <code>select UPPER(A), MONTH(D) where LEN(A) > 3</code>.
        </li>
        <li>
          A first row of text above numbers or dates is taken to be a header row, and the result
          starts with a header row too. Give the number of header rows as a third argument to say
          otherwise: <code>QUERY(A1:D99, "select A", 0)</code>.
        </li>
        <li>
          The result fills cells like any other formula with several values, and a text view shows
          it as a table.
        </li>
      </ul>
    </section>

    <section id="actions">
      <h2>Buttons and actions</h2>
      <p>
        An <em>action</em> is a function that changes something: <code>EXECUTE</code> writes to a
        cell, and <code>SEND_EMAIL</code> sends a message. An action does nothing by being in a
        cell. It runs when it is inside <code>BUTTON</code> and someone clicks the button.
      </p>
      <pre><code>=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))
=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3))</code></pre>
      <p>
        The first shows a button that writes the sum of A1 and A2 into A3. The second shows a button
        that sends an email to the address in A1, with the subject in A2 and the body in A3.
      </p>
      <ul>
        <li>
          An action reads its cells at the moment of the click, not when the sheet recalculates. A
          button can therefore read and write the same cell:
          <code>=BUTTON("Add one", EXECUTE(A1 + 1, A1))</code> is a counter.
        </li>
        <li>
          <code>EXECUTE</code> writes to one cell. The target can be in another table or on another
          page, written like any other reference.
        </li>
        <li>
          <code>APPEND_ROW</code> appends after the last stored row of a data table when the range
          has no fixed bottom. In a plain grid it writes below the last row with content.
          <code>CLEAR</code> empties cells. <code>DO</code> runs several actions from one click, so
          a button can save a form and then reset it:
          <code>=BUTTON("Save", DO(APPEND_ROW(Log!A:B, A1, A2), CLEAR(A1:A2)))</code>.
        </li>
        <li>
          Three actions move many rows at once. <code>INSERT(data, range)</code> adds every row of
          the data below what the range holds. <code>UPDATE(data, key_columns, range)</code> writes
          each row over the row with the same key and adds the rows with new keys, so running it
          twice does not add anything twice. In a data table, open-ended INSERT and UPDATE
          destinations append after the last stored row. <code>OVERWRITE(data, range)</code>
          empties the range first and deletes surplus rows of a data table when the range covers
          every writable column. The data can be a range or a formula:
          <code>=BUTTON("Archive", INSERT(FILTER(A2:C99, C2:C99 = "done"), Archive!A:C))</code>.
        </li>
        <li>
          When an action cannot run, a message says why and nothing is changed. Examples are a
          recipient that is not an email address, and a target cell outside its table.
        </li>
        <li>
          <code>TODAY()</code> and <code>NOW()</code> inside an action give the time of the click on
          your clock, so <code>=BUTTON("Log", APPEND_ROW(Log!A:B, NOW(), A1))</code> stamps each
          row.
        </li>
        <li>
          This version records each email in the server's log and does not deliver it. The server
          limits how many emails one person's clicks can send in an hour.
        </li>
        <li>
          Someone who can only view a spreadsheet cannot run its buttons or change its controls.
        </li>
        <li>
          An action typed without <code>BUTTON</code> around it shows its name in gray and never
          runs.
        </li>
        <li>
          To change a button's formula, select its cell and press Enter, or use the formula bar.
        </li>
      </ul>
    </section>

    <section id="controls">
      <h2>Checkboxes and dropdowns</h2>
      <p>
        A control is a cell that shows an input bound to another cell. It shows that cell's value,
        and changing the control writes the new value there.
      </p>
      <ul>
        <li>
          <code>=CHECKBOX(B1, "Paid")</code> is ticked when B1 holds TRUE. Ticking or clearing it
          writes TRUE or FALSE to B1.
        </li>
        <li>
          <code>=DROPDOWN(D1:D5, B2)</code> offers the values of D1 to D5 and writes the choice to
          B2. The choices can also be written out: <code>=DROPDOWN("low, medium, high", B2)</code>.
        </li>
        <li>
          Formulas read the bound cell, not the control: <code>=IF(B1, "thanks", "waiting")</code>.
        </li>
        <li>A control cannot be bound to its own cell.</li>
      </ul>
    </section>

    <section id="formats">
      <h2>Formats</h2>
      <p>
        The row of controls under the bar changes how the selected cells look: bold, italic,
        alignment, a number format, the color of the text, and the color of the cell. A format
        changes only how a cell is shown. Its value, and what formulas read from it, stay the same.
      </p>
      <ul>
        <li>
          A number format applies to numbers and dates. <code>1,234.50</code> groups thousands and
          shows two decimals, <code>50%</code> shows a fraction as a percentage, and
          <code>Sep 30, 2026</code> writes a date with the month's name.
        </li>
        <li>
          Formatting a whole row or column also covers the cells added to it later. Click a row
          number or a column letter to select one.
        </li>
        <li>
          A format stays with its cell when rows or columns are inserted or deleted. It is not
          copied when the cell is copied, filled, or pasted.
        </li>
        <li><strong>Clear format</strong> removes every format from the selected cells.</li>
        <li>
          For a formatted value as text inside a formula, use
          <code>TEXT(A1, "#,##0.00")</code>.
        </li>
      </ul>
    </section>

    <section id="conditional">
      <h2>Conditional formats</h2>
      <p>
        <strong>Conditional formats</strong>, above a table, lists the rules that format cells by
        their value. Select cells, choose a kind of rule, and press <strong>Add rule</strong>.
      </p>
      <ul>
        <li>
          <strong>Format cells that match</strong> takes a criterion as <code>COUNTIF</code> does:
          <code>&gt;100</code>, <code>Done</code>, <code>&lt;&gt;</code> for any non-empty cell,
          <code>*late*</code> with wildcards. The rule tests each cell's own value, and gives
          matching cells a fill, a text color, or bold.
        </li>
        <li>
          <strong>Color scale</strong> shades each number from the color of the smallest number in
          the cells to the color of the largest. Text and empty cells are left alone.
        </li>
        <li>
          Rules follow their cells when rows and columns are inserted or deleted, and are laid over
          the formats from the toolbar. The list shows the rule that wins first. The
          <strong>↑</strong> and <strong>↓</strong>
          buttons move a rule up or down it, so a rule higher in the list wins over the ones below.
        </li>
        <li>
          <strong>Edit</strong> beside a rule changes its criterion or colors and keeps the cells it
          covers. <strong>×</strong> removes a rule after asking you to confirm.
        </li>
      </ul>
    </section>

    <section id="sharing">
      <h2>Sharing</h2>
      <p>
        <strong>Share</strong>, at the top of a spreadsheet, gives it to another person who has an
        account here. Type their email address and choose what they can do.
      </p>
      <ul>
        <li>
          Someone who <strong>can edit</strong> can change everything in the spreadsheet and run its
          buttons. Someone who <strong>can view</strong> can read it and open copies from its
          history.
        </li>
        <li>
          Only the owner can share the spreadsheet, change what someone can do, stop sharing, or
          delete it. A person it is shared with can leave it.
        </li>
        <li>
          A shared spreadsheet shows in the other person's list, marked as shared with them.
          Everyone who has it open sees changes within a second. When two people change the same
          cell, the later change stays.
        </li>
        <li>The person must sign up before the spreadsheet can be shared with them.</li>
      </ul>
    </section>

    <section id="history">
      <h2>History</h2>
      <p>
        The app keeps versions of a spreadsheet as it changes. <strong>History</strong>, at the top
        of a spreadsheet, lists them.
      </p>
      <ul>
        <li>
          A version is kept before anything is deleted: a row, a column, a table, a chart, a text
          view, or a page. One is also kept before a paste or an import that changes many cells, and
          every ten minutes while the spreadsheet is being changed.
        </li>
        <li>
          <strong>Restore</strong> puts the whole spreadsheet back as the version has it. What the
          spreadsheet held is kept as a version first, so a restore can be undone by restoring that
          one.
        </li>
        <li>
          <strong>Open a copy</strong> makes a new spreadsheet of the version and leaves this one
          alone. Use it to look at an old version, or to take one table from it.
        </li>
        <li>The newest {{ LIMITS.versions }} versions are kept.</li>
        <li>
          Ctrl+Z and Ctrl+Y undo and redo changes made since this page was opened, including cell
          edits, formatting, and structural changes. A later edit can make an undo unsafe; when that
          happens, the app explains why and moves to the next change. Use History to restore an
          older version of the whole spreadsheet.
        </li>
        <li>
          A change is sent to the server as soon as it is made. The top of the editor says
          <q>Saving…</q> until the server has it, and the browser asks before closing or reloading
          the page while it does.
        </li>
      </ul>
    </section>

    <section id="files">
      <h2>Files</h2>
      <ul>
        <li>
          <strong>Export</strong>, at the top of a spreadsheet, saves the whole spreadsheet as a
          file: its pages, the blocks on them, and everything typed into cells, formulas included.
          <strong>Import</strong>, on the list of spreadsheets, makes a new spreadsheet from such a
          file.
        </li>
        <li>
          <strong>Export CSV</strong> saves one table as a CSV file that other spreadsheet apps
          open. It holds the values the cells show, not their formulas.
        </li>
        <li>
          <strong>Import CSV</strong> reads a CSV file into a table, starting at A1. The table grows
          to fit, up to {{ LIMITS.tableRows }} rows and {{ LIMITS.tableCols }} columns. A cell in
          the file that starts with <code>=</code> becomes a formula. Files with semicolons or tabs
          between cells are read too.
        </li>
      </ul>
    </section>

    <section id="charts">
      <h2>Charts</h2>
      <p>
        <strong>Add chart</strong> puts a chart on a page. Type the cells to draw into its
        <strong>Data</strong> box, and choose bar, line, pie, or scatter. The chart redraws when the
        cells change.
      </p>
      <ul>
        <li>
          A chart is on a page and not in a table, so its data names the table:
          <code>Sales!A1:C9</code>, not <code>A1:C9</code>.
        </li>
        <li>
          The first column labels the points and each other column is a series. A first row of text
          names the series.
        </li>
        <li>
          The data can be any formula that gives a range, such as
          <code>FILTER(Sales!A2:B99, Sales!B2:B99 &gt; 0)</code> or
          <code>HSTACK(Sales!A:A, Sales!D:D)</code> to chart columns that are not side by side.
        </li>
        <li>
          A pie chart draws the first series. A scatter chart needs numbers or dates in its first
          column.
        </li>
        <li>
          Renaming a table or page, or inserting or deleting rows and columns, rewrites the data so
          the chart keeps reading the same cells.
        </li>
      </ul>
    </section>

    <section id="text-views">
      <h2>Text views</h2>
      <p>
        <strong>Add text</strong> puts a text view on a page. Double-click the text, or choose
        <strong>Edit</strong>, to write it. The text is
        <a href="https://commonmark.org/help/" target="_blank" rel="noreferrer">Markdown</a>, and
        tags put values from the spreadsheet into it. The view shows the result as you type.
        Clicking anywhere else, or choosing <strong>Done</strong>, saves the text.
      </p>
      <table>
        <thead>
          <tr>
            <th scope="col">Tag</th>
            <th scope="col">What it does</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="[tag, meaning] in TEMPLATE_TAGS" :key="tag">
            <td>
              <code>{{ tag }}</code>
            </td>
            <td>{{ meaning }}</td>
          </tr>
        </tbody>
      </table>
      <pre><code>{{ TEMPLATE_EXAMPLE }}</code></pre>
      <ul>
        <li>As in a chart, a formula in a text view names the table of every cell it reads.</li>
        <li>
          A formula that gives one value puts it into the sentence. A formula that gives a range
          shows it as a table, and a chart function such as <code>BAR_CHART</code> shows the chart.
        </li>
        <li>
          A formula that fails shows its error, such as <code>#DIV/0!</code>, where its value would
          have been. A tag that is written wrong replaces the view with a message naming the line.
        </li>
        <li>
          A name from <code>let</code> or <code>for</code> lasts to the end of the part it was made
          in. A cell address such as <code>A1</code> cannot be used as a name.
        </li>
        <li>HTML written in a text view is shown as text.</li>
      </ul>
    </section>

    <section id="errors">
      <h2>Errors</h2>
      <p>
        A cell that cannot be computed shows one of these. Hover over the cell to read the specific
        reason. A formula that reads a cell holding an error shows the same error, unless
        <code>IFERROR</code> catches it.
      </p>
      <table>
        <tbody>
          <tr v-for="(explanation, code) in errorDocs" :key="code" :data-error="code">
            <th scope="row">
              <code>{{ code }}</code>
            </th>
            <td>{{ explanation }}</td>
          </tr>
        </tbody>
      </table>
    </section>
  </div>
</template>
