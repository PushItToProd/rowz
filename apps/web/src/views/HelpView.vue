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

const results = exampleResults();
const exampleCells = Object.entries(EXAMPLE_CELLS)
  .map(([address, input]) => `${address} = ${input}`)
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
  ["find", "Find and replace"],
  ["structure", "Pages and tables"],
  ["columns", "Tables with named columns"],
  ["references", "References"],
  ["operators", "Operators"],
  ["functions", "Functions"],
  ["names", "Names and your own functions"],
  ["arrays", "Formulas that fill several cells"],
  ["query", "Queries"],
  ["actions", "Buttons and actions"],
  ["controls", "Input controls"],
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
  ["Arrow keys, outside an editor", "Move the selection."],
  ["Any character", "Start typing over the selected cell."],
  ["Enter or F2", "Edit the selected cell's current contents."],
  ["Alt+Enter, on a table-size spill error", "Focus the Resize table to fit button."],
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

const QUERY_TESTS = [
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

const TEMPLATE_BUTTON_EXAMPLE = '{{ BUTTON("Approve", EXECUTE(TRUE, Sales!D2)) }}';
const TEMPLATE_CELL_REFERENCE = "{{Sales!D1}}";
const TEMPLATE_COMPUTED_REFERENCE = "{{Sales!D1 * 2}}";

const OPERATORS = [
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
</script>

<template>
  <div class="help">
    <header class="help__header">
      <RouterLink :to="{ name: 'spreadsheets' }">← Documents</RouterLink>
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
            <th>The cell's value</th>
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
        Cell edits save when you commit or leave the editor. Other open sessions receive saved
        changes.
      </p>
      <p>
        When you commit a formula starting with <code>=</code>, rowz adds closing parentheses left
        open at the end. Parentheses inside strings, quoted names, brackets, and braces are ignored;
        extra closing parentheses remain and still cause an error. An unfinished string, quoted
        name, column bracket, or brace group is left as typed so its error remains visible.
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
      <p>
        Scripts and text views have <strong>Done</strong> and <strong>Cancel</strong> buttons. Done
        saves; Cancel discards the draft. Tab accepts completion or saves and leaves the source.
        Formula drafts keep their text, caret, and undo history while you browse other pages. The
        draft editor labels the original target; applying or canceling returns to its original page.
        A literal cell draft saves before a page change.
      </p>
    </section>

    <section id="filling">
      <h2>Selecting, filling, and copying</h2>
      <p>
        Drag across cells, or hold Shift and click or press the arrow keys, to select a range. The
        last cell of the selection has a small square at its corner. Drag that square down or across
        to extend the values or formulas in the selection into more cells.
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

    <section id="find">
      <h2>Find and replace</h2>
      <p>
        Click Find or press Ctrl/Cmd+F with focus in the editor. Search the whole document, current
        page, or selected block. Choose stored inputs (formulas as written) or displayed cell
        values. Both modes search text/Markdown, chart, and script sources, column formulas,
        filters, and named formulas. Case sensitive and whole cell/entire source options are
        available; queries are literal text. Current page and selected block scopes follow
        navigation while Find is open.
      </p>
      <p>
        Matches list their page, block, and cell address or source. Click a match to jump to it.
        Enter or F3 advances; Shift+Enter or Shift+F3 goes back. Escape closes Find. Browser find
        works outside the editor. Find counts every match and shows the first 1,000.
      </p>
      <p>
        In Stored inputs mode, Replace one replaces the selected occurrence, and Replace all
        replaces every occurrence in scope, including matches beyond the displayed list and text
        inside formulas. Inputs and sources whose replacement would introduce a syntax error stay
        unchanged and appear in the skipped replacements list. Unresolved names are allowed. Formula
        column cells are computed and skipped; their column formulas can be replaced. Ctrl/Cmd+Z in
        the grid undoes the entire replacement in one step. Replacements too large for the undo
        journal are refused; choose a smaller scope.
      </p>
      <p>
        Search above the Documents list to find literal text across documents you can read. It
        searches document, page, table, and column names; stored cell inputs; and text, script, and
        chart sources. Results show up to five snippets per document. Find and Replace in the editor
        remains scoped to one document.
      </p>
    </section>
    <section id="structure">
      <h2>Pages and tables</h2>
      <p>
        A document holds pages, shown as tabs. A page holds blocks: tables, charts, and text views.
        Each table is its own grid, with its own column letters and row numbers, so every table has
        a cell A1.
      </p>
      <ul>
        <li>
          Use <strong>Add page</strong> and <strong>Add table</strong> to grow a document. The strip
          marked <strong>+</strong> under a table adds a row, and the one along its right edge adds
          a column. A table can have up to {{ LIMITS.tableRows }} rows and
          {{ LIMITS.tableCols }} columns.
        </li>
        <li>
          <strong>Resize</strong> sets how many columns and rows a table has. A smaller size deletes
          the rows and columns past it, as deleting them by hand does, and asks first when they hold
          something.
        </li>
        <li>
          <strong>Freeze</strong> in the table's <strong>⋮</strong> menu chooses how many leading
          rows and columns stay in view while its grid scrolls. A row or column header's context
          menu can freeze through that line or unfreeze it. Data tables keep their named-column
          header in view; their row freeze count is limited to that header, and leading columns can
          also be frozen. Tall grids scroll inside the table card.
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
          Double-click the name of a document, page, or table to rename it. From the keyboard, move
          to the name with Tab and press Enter. A page's name is also the link that opens the page,
          so there Enter opens the page and F2 renames it.
        </li>
        <li>
          The arrows beside a block move it up or down its page, and the button under them moves it
          to another page. Formulas that read a moved table are rewritten to name its new page, so
          they keep reading it. A page cannot take a table with the name of one it already has.
        </li>
        <li>The arrows on the open page's tab move the page left or right among the tabs.</li>
        <li>
          Right-click a page tab to rename, delete, or move that page. A page deletion offers an
          <strong>Undo</strong> notice. Right-click a block's header or card padding, or use its
          <strong>⋮</strong> button, for its rename, delete, move, add-below, and block-specific
          actions. Table cells keep their own context menu; controls and rendered text keep their
          normal right-click behavior. The Context Menu key or Shift+F10 opens a page or block menu;
          use the arrow keys, Home, or End to move through it, and Escape to close it and restore
          focus.
        </li>
        <li>
          Use the chevron at the left of a block header to collapse it to its name, error indicator,
          and actions menu. The block menu also has <strong>Collapse</strong> or
          <strong>Expand</strong>; the page tab menu collapses or expands every block on that page.
          These per-viewer preferences stay in browser storage under the document and block IDs.
          Deleted block preferences are dropped the next time the document opens. Tall tables, text
          views, and scripts scroll inside their own content areas up to 70vh. Charts fit their
          blocks without an inner scrollbar.
        </li>
        <li>
          Two pages in a document cannot share a name, and neither can two tables on a page. Names
          are compared without regard to letter case.
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
          Right-click a column to set its type. <strong>Text</strong> preserves typed text, so
          <code>007</code> stays <code>007</code>. <strong>Number</strong> and
          <strong>Date</strong> show <code>#VALUE!</code> for anything else.
          <strong>Checkbox</strong> shows a checkbox in every row. <strong>A choice</strong> shows a
          dropdown in every row. Its choices are a list you write, one on each line, or the values
          of a column of a data table, which follow that column. A value that is not among the
          choices stays and is marked. <strong>Anything</strong> behaves like a regular cell.
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
          formatting needs one row or whole columns. Use <strong>Freeze</strong> in the table menu
          to keep leading columns in view; a data table's named-column header stays visible, and its
          row freeze setting is limited to that header. Plain tables can freeze leading rows and
          columns. A row or column header menu can freeze through that position or unfreeze the
          grid.
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
      <p>
        At an unfinished operand such as <code>=B3+</code>, click a cell or drag a range to insert
        its reference. Selecting a complete reference lets a grid pick replace it. For other formula
        positions, use <strong>Pick reference</strong>: it replaces selected text, otherwise the
        reference under the caret, otherwise inserts at the caret. It adds no operators. Further
        picks replace that insertion until you type or move the caret.
      </p>
      <p>
        Picking keeps the editing target and does not run buttons or change cell controls. A drag
        makes one undoable change; Escape cancels it and restores the pre-drag text. Picked
        addresses are relative, even when replacing a reference containing <code>$</code>. Type any
        desired absolute markers afterward. Reference colors match outlines of visible cells. Names
        are highlighted without evaluating them to find outlines.
      </p>
      <p>
        Ordinary row and column headers pick whole rows or columns. A named-column header inserts
        <code>[Column]</code> in its table's filter or formula-column definition; elsewhere it
        inserts <code>Table[Column]</code>. Whole-column references include filtered-out rows.
        Dragging across multiple named-column headers is not supported. A cell drag through sorted
        or filtered rows must name exactly one stored rectangle; otherwise pick a whole column or
        clear sorting and filtering. Page-scoped sources name the table, and cross-page picks name
        both the page and table.
      </p>
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
      <p>
        Boolean keywords ignore case and use the coercion, range handling, and errors of
        <code>AND</code>, <code>OR</code>, and <code>NOT</code>. Both operands of
        <code>and</code> and <code>or</code> are evaluated. Comparisons bind tighter than
        <code>not</code>, then <code>and</code>, then <code>or</code>:
        <code>=A1 > 1 and (not B1 or C1 &lt; 2)</code>.
      </p>
      <p>
        <code>and</code> and <code>or</code> are names where an operand is expected. Prefix
        <code>not</code> needs whitespace: <code>not A1</code> or <code>not (A1 or B1)</code>. A
        standalone <code>not</code> or one before an arithmetic or comparison operator is a name:
        <code>LET(Not, 2, Not + 1)</code> returns 3. Keep the parenthesis touching the keyword for
        function calls: <code>NOT(A1)</code>; <code>NOT (A1)</code> is prefix negation. Qualifiers
        and columns remain names: <code>and!A1</code>, <code>not[or]</code>, <code>[and]</code>.
        Single quotes always force a name: <code>'not' + 1</code>.
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
        The new-name form creates a name only with <strong>Add name</strong> or Enter. Tab and
        clicking outside retain the unfinished name and formula. Cancel or closing the form discards
        them. Its formula supports the same completion and reference picking as other formula
        editors.
      </p>
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
        Each script can define a given name only once, including function names. A repeated
        definition is an error on the later line; the first definition remains usable. A bare name
        must also have one meaning in the whole document. If names in different holders, two tables,
        or a name and table share a spelling, a bare use shows <code>#NAME?</code>. Give them
        distinct spellings or qualify them by their holder. If the February and March scripts each
        define <code>Total</code>, write <code>February!Total</code> and <code>March!Total</code>.
        Add the page when the holder is on another page: <code>'Page 2'!Summary!Total</code>.
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
      <pre><code>=QUERY(A1:D99, "select B, sum(C) where D >= date ""2026-01-01"" group by B order by sum(C) desc")</code></pre>
      <p>
        A column is named by its letter, counting from the first column of the range, so in
        <code>QUERY(C1:E9, …)</code> column C is <code>A</code>. A column with a header can also be
        named by it: <code>select Amount</code>. Headers with spaces or reserved words and aliases
        go in single quotes: <code>select 'Sold on'</code>. Double an apostrophe inside an
        identifier. Strings, date literals, and label text use double quotes only. Double each query
        double quote inside the formula string:
        <code>=QUERY(People, "select * where 'Favorite food' = ""Pizza""")</code>. A double quote
        inside query text is doubled again:
        <code>=QUERY(People, "select * where Note = ""say """"hello""""""")</code>
        matches <code>say "hello"</code>. Backslashes do not escape quotes.
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
        cell. It runs when it is inside <code>BUTTON</code> and someone clicks the button in a cell
        or text view.
      </p>
      <pre><code>=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))
=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3))
=BUTTON("Reset", CLEAR(A1:A3), "Clear these cells?")</code></pre>
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
          The optional third argument to <code>BUTTON</code> asks for confirmation before the click
          is sent. Give it a message, or use <code>TRUE</code> for “Run this button?”. This guards
          against accidental clicks; the server still derives the action from the stored formula.
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
          each data row below the range's existing content.
          <code>UPDATE(data, key_columns, range)</code> writes each row over the row with the same
          key and adds the rows with new keys, so running it twice does not add anything twice. In a
          data table, open-ended INSERT and UPDATE destinations append after the last stored row.
          <code>OVERWRITE(data, range)</code>
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
          When <code>SMTP_URL</code> is set, the server sends email through that mail server.
          Without it, the server records each message in its log and sends nothing. The server
          limits how many emails one person's clicks can send in an hour.
        </li>
        <li>Someone who can only view a document cannot run its buttons or change its controls.</li>
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
      <h2>Input controls</h2>
      <p>
        A control is a cell that shows an input bound to another cell. It shows that cell's value,
        and committing a change with Enter or by leaving the input writes the new value there.
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
          <code>=TEXTBOX(B1, "Name")</code> shows B1 in a text input and stores committed text as
          text. <code>=NUMBERBOX(C1, "Count")</code> accepts a number and clears C1 when left empty.
        </li>
        <li>
          Formulas read the bound cell, not the control: <code>=IF(B1, "thanks", "waiting")</code>.
        </li>
        <li>
          A control must target a stored cell without a formula. It cannot target a formula column
          or a cell filled by an array formula.
        </li>
      </ul>
    </section>

    <section id="formats">
      <h2>Formats</h2>
      <p>
        The row of controls under the bar changes how the selected cells look: bold, italic, wrap
        text, alignment, a number format, the color of the text, and the color of the cell. A format
        changes only how a cell is shown. Its value, and what formulas read from it, stay the same.
      </p>
      <ul>
        <li>
          <strong>Wrap text</strong> breaks long values within the column width and clips them to
          the row's configured height with an ellipsis. Hover over the cell to see its full text.
          Wrapping keeps row heights fixed; resize a row to show more lines.
        </li>
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
        their value. Select cells, choose a kind of rule, and press <strong>Add rule</strong>. You
        can also right-click selected cells and choose <strong>Add conditional format…</strong> to
        open the panel for that selection.
      </p>
      <ul>
        <li>
          <strong>Format cells that match</strong> takes a criterion as <code>COUNTIF</code> does:
          <code>&gt;100</code>, <code>Done</code>, <code>&lt;&gt;</code> for any non-empty cell,
          <code>*late*</code> with wildcards. The rule tests each cell's own value, and gives
          matching cells a fill, a text color, bold, or wrapped text.
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
        <strong>Share</strong>, at the top of a document, gives it to another person who has an
        account here. Type their email address and choose what they can do.
      </p>
      <ul>
        <li>
          Someone who <strong>can edit</strong> can change everything in the document and run its
          buttons. Someone who <strong>can view</strong> can read it and open copies from its
          history.
        </li>
        <li>
          Only the owner can share the document, change what someone can do, stop sharing, or delete
          it. A person it is shared with can leave it.
        </li>
        <li>
          A shared document shows in the other person's list, marked as shared with them. Everyone
          who has it open sees changes within a second. When two people change the same cell, the
          later change stays.
        </li>
        <li>The person must sign up before the document can be shared with them.</li>
      </ul>
    </section>

    <section id="history">
      <h2>History</h2>
      <p>
        The app keeps versions of a document as it changes. <strong>History</strong>, at the top of
        a document, lists them.
      </p>
      <ul>
        <li>
          A version is kept before anything is deleted: a row, a column, a table, a chart, a text
          view, or a page. One is also kept before a paste or an import that changes many cells, and
          every ten minutes while the document is being changed.
        </li>
        <li>
          <strong>Restore</strong> puts the whole document back as the version has it. The current
          document is saved as a version first, so you can undo the restore.
        </li>
        <li>
          <strong>Open a copy</strong> makes a new document from the version and leaves this one
          alone. Use it to look at an old version, or to take one table from it.
        </li>
        <li>The newest {{ LIMITS.versions }} versions are kept.</li>
        <li>
          Ctrl+Z and Ctrl+Y undo and redo changes made since this page was opened, including cell
          edits, formatting, and structural changes. A later edit can make an undo unsafe; when that
          happens, the app explains why and moves to the next change. Use History to restore an
          older version of the whole document.
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
          <strong>Export</strong>, at the top of a document, saves the whole document as a file: its
          pages, the blocks on them, and everything typed into cells, formulas included.
          <strong>Import</strong>, on the list of documents, makes a new document from such a file.
          <strong>New from template</strong> creates an editable copy of an invoice, contacts list,
          to-do list, or inventory example from the same document list. Use
          <strong>Browse samples and templates</strong> to choose one of those templates or a sample
          document. The gallery makes a copy in your account and opens it; repeated copies get a
          numbered name.
        </li>
        <li>
          On the Documents page, open a document's <strong>⋯</strong> menu to rename or delete a
          document you own, or to duplicate any document you can read. A duplicate is created in
          your workspace, and the list stays open. Deleting a document asks for confirmation and
          cannot be undone. The separate <strong>Move</strong> menu files a document into one of
          your folders.
        </li>
        <li>
          <strong>Export CSV</strong> saves one table as a CSV file that other spreadsheet apps
          open. The file contains the values the cells show, not their formulas.
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
        cells change. Charts fit the width of their block and show values on hover, including charts
        embedded in text views.
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
          When the first column contains dates and all its nonblank values are dates, bar, line, and
          scatter charts use a time axis with regular date ticks and ISO date labels. Line points
          are ordered by date; bars are placed at their dates.
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
        tags put values from the document into it. The view shows the result as you type. Leaving
        the source normally saves the text. Reference picks and browsing pages keep the draft open.
        <strong>Done</strong> or Ctrl/Cmd+Enter saves; <strong>Cancel</strong> discards.
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
          A lone table-qualified positional reference to one cell, such as
          <code v-text="TEMPLATE_CELL_REFERENCE"></code>, writes the number or date using that
          cell's number format, including a conditional number format. A named-column reference such
          as <code>Sales[Amount]</code>, a range (even one cell written as
          <code>Sales!D1:D1</code>), and a computed expression such as
          <code v-text="TEMPLATE_COMPUTED_REFERENCE"></code> do not inherit a cell format. Use
          <code>TEXT</code> to format a computed value. Text color, fill, bold, and other cell
          styles do not carry into the view.
        </li>
        <li>
          A formula that gives <code>BUTTON</code> shows a clickable button. For example,
          <code>{{ TEMPLATE_BUTTON_EXAMPLE }}</code> writes TRUE to <code>Sales!D2</code> when
          clicked. A button inside a loop appears once for each row.
        </li>
        <li>
          A formula that gives <code>TEXTBOX</code> or <code>NUMBERBOX</code> shows an input. Enter
          commits its value, and leaving the input commits it too. The view sends its control
          occurrence and target cell identity to the server, which checks the stored template again.
        </li>
        <li>
          A formula that fails shows an error chip with its code and message where its value would
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
      <p>
        Error details in the document errors list can be selected and copied. Copy copies one error,
        and Copy all copies the list with a blank line between errors. Go to error opens the cell,
        chart, or text view that shows the error. When an error is raised inside a script function,
        the list also identifies the function and shows how the formula reached it; Open definition
        opens the script at the function definition.
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
