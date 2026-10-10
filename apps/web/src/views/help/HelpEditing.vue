<script setup lang="ts">
import { KEYS } from "./content";
</script>

<template>
  <div>
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
      <p>
        Formula editors pair <code>(</code>, <code>[</code>, and double quotes. They pair an
        apostrophe when it starts a quoted page or table name. Typing an opening delimiter around
        selected text wraps it; typing a closer skips an automatically inserted closer, and
        Backspace between an empty <code>()</code> deletes both characters. Formula strings escape a
        double quote by doubling it; typing a quote inside an open string does not start another
        pair. Accepting a function completion inserts its closing parenthesis with the caret inside.
        Script editors use the same formula pairs. Markdown source pairs parentheses and double
        quotes, but leaves square and curly brackets unpaired.
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
  </div>
</template>
