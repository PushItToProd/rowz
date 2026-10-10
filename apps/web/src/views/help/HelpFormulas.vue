<script setup lang="ts">
import { REFERENCES, OPERATORS } from "./content";
</script>

<template>
  <div>
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
        Boolean keywords ignore case and use the coercion and range handling of
        <code>AND</code>, <code>OR</code>, and <code>NOT</code>. The <code>and</code> operator skips
        its right operand when its left side is <code>FALSE</code>, and <code>or</code> skips it
        when its left side is <code>TRUE</code>. The <code>AND</code> function also stops at its
        first <code>FALSE</code>, and <code>OR</code> at its first <code>TRUE</code>.
        <code>ALL</code> and <code>ANY</code> evaluate every argument and return an error found in
        any of them. Comparisons bind tighter than <code>not</code>, then <code>and</code>, then
        <code>or</code>: <code>=A1 > 1 and (not B1 or C1 &lt; 2)</code>.
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

    <section id="names">
      <h2>Names and your own functions</h2>
      <p>
        Choose <strong>Names</strong> in a plain table's block menu to open the Names panel. The
        new-name form creates a name only with <strong>Add name</strong> or Enter. Click an existing
        name to rename it. Tab and clicking outside retain the unfinished name and formula. Cancel
        or closing the form discards them. Its formula supports the same completion and reference
        picking as other formula editors.
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
  </div>
</template>
