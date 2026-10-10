<script setup lang="ts">
import {
  TEMPLATE_TAGS,
  TEMPLATE_EXAMPLE,
  TEMPLATE_BUTTON_EXAMPLE,
  TEMPLATE_CELL_REFERENCE,
  TEMPLATE_COMPUTED_REFERENCE,
} from "./content";
</script>

<template>
  <div>
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
        <strong>Conditional formats</strong> in a table's block menu opens the rules that format
        cells by their value. Select cells, choose a kind of rule, and press
        <strong>Add rule</strong>. You can also right-click selected cells and choose
        <strong>Add conditional format…</strong>
        to open the panel for that selection.
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

    <section id="charts">
      <h2>Charts</h2>
      <p>
        <strong>Add chart</strong> puts a chart on a page. Type the cells to draw into its
        <strong>Data</strong> box, and choose <strong>Chart type: Bar</strong>,
        <strong>Chart type: Line</strong>, <strong>Chart type: Pie</strong>, or
        <strong>Chart type: Scatter</strong> in the chart's block menu. The chart redraws when the
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
        <strong>Add text</strong> puts a text view on a page. Double-click the text or choose
        <strong>Edit</strong> in its block menu to write it. The text is
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
          Markdown links can navigate to a location in this document. Use
          <code>[Open block](#block=&lt;block-id&gt;)</code>,
          <code>[Open cell](#cell=&lt;table-id&gt;.&lt;row-id&gt;.&lt;column-id&gt;)</code>, or a
          page path such as <code>[/open page](/s/&lt;spreadsheet-id&gt;/p/&lt;page-id&gt;)</code>.
          Cell links name stored row and column IDs, not the displayed A1 address. Raw HTML and
          unsupported relative or unsafe URL schemes do not render as links.
        </li>
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
  </div>
</template>
