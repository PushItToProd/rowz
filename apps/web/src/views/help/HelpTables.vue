<script setup lang="ts">
import { LIMITS } from "@spreadsheet-app/shared";
</script>

<template>
  <div>
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
          <strong>Resize</strong> in a table's block menu sets how many columns and rows it has. A
          smaller size deletes the rows and columns past it, as deleting them by hand does, and asks
          first when they hold something.
        </li>
        <li>
          <strong>Freeze rows and columns</strong> in a table's block menu chooses how many leading
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
          On the Documents page, click a document's name to open it, and rename a document you own
          from its <strong>⋯</strong> menu. Click another page tab to open it, or click the active
          page's name to rename it. Click a block's name to rename it. In the Names panel, click a
          name to rename it. Press F2 when a name is focused to rename it. Double-click the contents
          of a text view or script to edit its source.
        </li>
        <li>
          The arrows beside a block move it up or down its page, and the button under them moves it
          to another page. Formulas that read a moved table are rewritten to name its new page, so
          they keep reading it. A page cannot take a table with the name of one it already has.
        </li>
        <li>
          The arrows on the open page's tab move it left or right among the tabs. Its trash can
          button deletes the page; deletion offers an <strong>Undo</strong> notice.
        </li>
        <li>
          Right-click anywhere on a page tab, including its move and delete buttons, to rename,
          delete, or move that page. Right-click a block's header or card padding, or use its
          <strong>⋮</strong> button, for its rename, delete, move, add-below, and block-specific
          actions. Table cells keep their own context menu; controls and rendered text keep their
          normal right-click behavior. The Context Menu key or Shift+F10 opens a page or block menu;
          use the arrow keys, Home, or End to move through it, and Escape to close it and restore
          focus.
        </li>
        <li>
          Choose <strong>Copy link to this page</strong> in a page tab menu,
          <strong>Copy link</strong> in a block menu, or <strong>Copy link to this cell</strong> in
          a cell menu. A cell link uses the table, row, and column IDs, so it keeps pointing to the
          same stored cell when the table is sorted or filtered. Opening a block link expands and
          highlights the block.
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
        Choose <strong>Use the first row as the names</strong> or
        <strong>Name them Column 1, Column 2, …</strong> in a plain table's block menu to give each
        column a name in place of its letter. Using the first row removes it from the data. Click a
        column header to select it, then click its name to rename it. Double-click another part of
        the header, outside the resize handle, to open its name editor.
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
          formatting needs one row or whole columns. Use <strong>Freeze rows and columns</strong> in
          the table's block menu to keep leading columns in view; a data table's named-column header
          stays visible, and its row freeze setting is limited to that header. Plain tables can
          freeze leading rows and columns. A row or column header menu can freeze through that
          position or unfreeze the grid.
        </li>
        <li>
          <strong>Remove column names</strong> in a data table's block menu makes it a plain table
          again. Its formula columns become empty, and its sort and filter are cleared.
        </li>
      </ul>
    </section>
  </div>
</template>
