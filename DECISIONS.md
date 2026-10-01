# Decisions

Choices made without asking, for review. Each entry says what was decided, why, and what to change if you disagree. Newest first.

## 2026-10-01: Data tables: named, typed, and formula columns

**Decision.** A data table is an ordinary table whose columns have been given names. It is not a separate kind of page item. **Name columns** converts a table, optionally taking the names from its first row, and **Remove column names** converts it back. Everything a table could already do still works: cell addresses, fill, paste, CSV, charts.

**References.**

| Written                                 | Means                                                               |
| --------------------------------------- | ------------------------------------------------------------------- |
| `[Price]`                               | The Price cell of the formula's own row, in the formula's own table |
| `Sales[Price]`, `'Table 1'[Unit price]` | The whole Price column of that table on the formula's page          |
| `'Page 2'!Sales[Price]`                 | The same on another page                                            |

Your todo item gave `'Table 1'[Column Name]`. I added the bare `[Price]` form for "this row", because a formula column needs a way to say it and `'Table 1'[Price]` is the whole column. Excel writes this row as `[@Price]`. Here a bare `[Price]` could not sensibly mean anything else, so the `@` is left out. As an operand of an operator, `Sales[Price]` means this row's cell, the same rule as `A:A`.

**Column types.** Anything (the default: what is typed is read as in any cell), Text, Number, Date, Checkbox, and Formula.

- **A typed column shows `#VALUE!` for an entry of the wrong kind** and keeps what was typed. The alternative was to refuse the entry. Keeping it means a paste or an import never loses data, and changing a column's type back shows the values again.
- **A formula column holds one formula for every row.** The formula is stored on the column, not in cells. Typing a formula into any cell of the column changes it for the whole column. Typing something that is not a formula is refused with a message, so a stray keystroke cannot replace the column.
- **A formula column computes only in rows that hold something.** A table here has a fixed number of rows, most of them empty at the end. Without this rule `=[Price] * [Qty]` would show a column of zeros below the data, and `SUM(Sales[Total] + 1)` would count the empty rows.
- **A column that becomes a formula column loses what was typed into it.** The change is made from a menu and names the column, and stored cells that nothing shows would otherwise come back as a surprise in exports.

**Choices.**

- **Row 1 is the first row of data.** With names taken from the first row, that row is deleted and formulas are rewritten as for any deleted row. `A1` then names the first data cell.
- **Column names are unique within a table, ignoring case,** and cannot contain `[` or `]`.
- **Renaming a column rewrites every formula that names it:** in cells, in charts and text views, and in formula columns of any table. A formula that names a deleted column keeps its text and shows `#REF!`.
- **The formula for a formula column is asked for with the browser's prompt box.** It is the one place the app uses `prompt`. After that the formula is edited in the formula bar like any other.

**Not done.**

- Sorting and filtering a data table in place. `QUERY`, `SORT`, and `FILTER` over `Sales[...]` columns give sorted and filtered copies.
- Dropdown (choice) columns, and number formats per column.
- `QUERY(Sales, ...)` over a whole data table by name, with its column names as headers. A query currently needs a range, and a data table has no header row inside the range.
- Showing only the rows that hold data. The table still shows its empty rows.

**To change.** References: `packages/engine/src/ast.ts`, `parser.ts`. Typed and formula columns: `applyColumns` and `parseTyped` in `workbook.ts`. Server: `nameColumns` and `updateColumn` in `apps/server/src/repo/spreadsheets.ts`.

## 2026-10-01: Phone-width layout and touch

**Decision.** The app is usable on a phone. Below 640px the headers wrap, the back link is an arrow, page tabs scroll sideways, and table cards put their buttons under the name. On a touch device rows and buttons are taller, and inputs are 16px so iOS does not zoom when one takes focus.

**Tapping the selected cell edits it.** On a desktop, typing starts an edit. A phone shows no keyboard until an input has focus, so the second tap opens the cell's input. A mouse click on the selected cell still does nothing, because that would make range selection and dragging start edits.

**Not done on touch.**

- **Selecting a range.** Dragging scrolls the page, as it should. Row and column headers still select whole lines.
- **The fill handle.** It needs a drag.
- **The right-click menu on iOS.** Safari sends no `contextmenu` event for a long press. Android does. The buttons above each table insert and delete rows and columns on both.

## 2026-10-01: A whole column in arithmetic means the formula's own row

**Decision.** Your todo item: `=A:A+B:B` is equivalent to `=A1+B1` in any cell of row 1, and so on for other rows. A whole-column reference (`A:A`, `A:C`) written as an operand of an operator now means that column's cell in the formula's own row. A whole-row reference (`2:2`) means its cell in the formula's own column.

**The rule is about how the reference is written, not about the shape of the result.**

| Formula in row 5               | Meaning                                                                   |
| ------------------------------ | ------------------------------------------------------------------------- |
| `=A:A + B:B`                   | `=A5 + B5`. One value. Nothing spills.                                    |
| `=IF(A:A > 1, "big", "small")` | `=IF(A5 > 1, ...)`. The comparison is an operator.                        |
| `=SUM(A:A)`                    | The whole column. `A:A` is an argument of `SUM`, not an operand.          |
| `=A1:A + B1:B`                 | Every row, spilling down. A range that names a row is the cells it names. |
| `=SUM(A:A * B:B)`              | `A5 * B5`. Use `SUMPRODUCT(A:A, B:B)` or `SUM(A1:A * B1:B)` for all rows. |

**Why this rule.** Before this, `=A:A+B:B` produced a column of results that spilled from the formula's cell, so it worked only in row 1 and collided with a second copy of itself. The alternative was to decide by the result: when an array is as tall as the table and cannot spill, take this row's element. That would also change `=SORT(A:A)` in row 2 from `#SPILL!` to "the second smallest value", which is wrong. Deciding by syntax is what Google Sheets does outside `ARRAYFORMULA`.

**Costs.**

- `=SUM(A:A * B:B)` is one row's product. Sheets has the same trap.
- **A formula in a chart or text view is not in a row,** so there a whole column in arithmetic stays the whole column: `{{ SUM(Sales!B:B * Sales!C:C) }}` adds every row. The same text means something different in a cell.
- **Inside a `LAMBDA`, "the formula's own row" is the row of the cell that defines the function,** not the row of the cell that calls it.
- A function that expects one value still does not take a whole column directly: `=UPPER(A:A)` is `#VALUE!`. `=UPPER(A:A & "")` works, because `&` is an operator. Making function arguments intersect as well is the remaining half of "functions do not work cell by cell" in the todo file.

**To change.** `operand` in `packages/engine/src/evaluate.ts`.

## 2026-10-01: Import and export

**Decision.** Two kinds of file.

- **A spreadsheet file (JSON)** holds a whole spreadsheet: pages, tables, charts, text views, and what was typed into each cell. Export is in the editor's header. Import is on the spreadsheet list and always makes a new spreadsheet.
- **CSV, per table.** Export writes the values the cells show. Import reads a file into the table from A1.

**Choices.**

- **The spreadsheet file has no ids.** Pages and tables are identified by name and order, which is how formulas identify them. A file can be imported twice, edited by hand, or produced by a script. The schema is `spreadsheetFile` in `packages/shared`, with `version: 1`.
- **Import is one request and one transaction** (`POST /api/spreadsheets/import`). A file that breaks a rule creates nothing.
- **Import never overwrites an existing spreadsheet.** Replacing one in place would need undo first.
- **CSV export writes values, not formulas,** because the point of CSV is other programs. The JSON file is the way to keep formulas.
- **CSV import treats a cell starting with `=` as a formula,** the same as typing or pasting it. A CSV from an untrusted source can therefore put formulas in a table, including a `BUTTON`, but nothing runs until someone clicks it.
- **CSV export does not guard against formula injection in other apps.** A cell whose text starts with `=`, `+`, `-`, or `@` is written as it is. Prefixing such cells with an apostrophe, as some exporters do, would corrupt negative numbers and text that round-trips back into this app. If exports will be opened in Excel by people who did not write the data, this should become an option.
- **Limits:** 50 pages, 50 items on a page, 100,000 cells in a file, and a 32 MB request body. The body limit now applies to every API request; before this there was none.
- **The CSV reader accepts commas, semicolons, or tabs** and picks the one that splits the first rows evenly. Excel in many European locales writes semicolons.

## 2026-10-01: QUERY

**Decision.** `QUERY(range, query, [headers])` runs a SQL-like query over a range, with the clauses Rows documented: `select`, `where`, `group by`, `having`, `pivot`, `order by`, `limit`, `offset`, `label`, and `as`.

**How it works.** The query parser produces the formula engine's own expression nodes, with each column as a name bound per row. A query expression can therefore call any formula function (`MONTH(D)`, `UPPER(A)`, `TEXT(C, "0.00")`), and a new formula function is available in queries with no further work. The aggregates `sum`, `count`, `avg`, `min`, `max`, `median`, and a few more call the formula functions of the same names over a group's rows.

**Choices.**

- **Column letters count from the first column of the range.** In `QUERY(C1:E9, ...)`, `A` is column C. Google Sheets uses the sheet's own letters for a range and `Col1` for computed data. `QUERY` receives values and not a reference, so a single rule that also works for `QUERY(FILTER(...), ...)` seemed better than two. `Col1`, `Col2` also work.
- **Columns can be named by header:** `select Amount`, or `` select `Sold on` `` for a header with spaces. Rows and Sheets do not offer this. A header that is also a column letter (a header `B` on column A) means the header.
- **Header rows are guessed when the third argument is left out:** a first row of text above numbers or dates is a header. Rows documents the default as 0. Guessing matches Sheets, and a header row sorted into the data is the more annoying mistake.
- **An empty cell passes no comparison,** as in SQL. A formula treats an empty cell as 0, which would make `where C < 5` keep rows with nothing in C.
- **Text comparison ignores case,** as everywhere else in the app. `group by` also groups `Apple` with `apple`.
- **Clauses may come in any order.** Rows documents an unusual fixed order with `having` near the end. Accepting any order takes both that and SQL's.
- **Groups come out sorted by their group values** unless `order by` says otherwise.
- **`matches` (regular expressions) is refused,** for the reason regex functions are held back. `like`, `contains`, `starts with`, and `ends with` cover the common cases.
- **An error in `where` or `having` fails the whole query with that error.** An error in a selected value shows in its cell.
- **`MAX(A, B)` with two arguments is the ordinary function,** applied row by row. With one argument it is the aggregate.

**To change.** The parser is `packages/engine/src/query.ts`. Running a parsed query is `packages/engine/src/functions/query.ts`.

## 2026-09-30: Which Rows functions to add

**Decision.** I read Rows' function index, which is still online, and sorted it in [docs/rows-functions.md](docs/rows-functions.md). I added the 50 ordinary functions that were missing and cheap: statistics (`STDEV`, `PERCENTILE`, `RANK`, `CORREL`, ...), math (`SUMPRODUCT`, `MROUND`, `LOG`, `GCD`, ...), text (`SPLIT`, `PROPER`, `JOIN`, `FIXED`, ...), dates (`DATEDIF`, `WORKDAY`, `NETWORKDAYS`, `WEEKNUM`, ...), lookups (`HLOOKUP`, `ROW`, `COLUMN`), and `IFNA`, `ISNA`, `ISERR`, `FLATTEN`.

**Held back, with reasons in that document.**

- **Regular expression functions.** A slow pattern would stall the server for every user, because the server evaluates formulas when a button is clicked. They need a regex engine with a time bound.
- **`RAND` and `RANDBETWEEN`.** The browser and the server evaluate separately and would each get a different number.
- **`OFFSET` and `INDIRECT`.** They produce references the dependency graph cannot see in advance.
- **`LOG10`.** `LOG10(5)` already means "call the function stored in cell LOG10", the same form as `=D1(21)`. `LOG(x)` uses base 10.
- **Hashes.** Browser hashing is asynchronous and the engine is synchronous.

**Next from that list:** `UPDATE` and `OVERWRITE`, then scheduled actions. `QUERY` has since been added.

## 2026-09-30: Charts and text views

**Decision.** A page holds three kinds of item: tables, charts, and text views. A chart or text view is a row in a `views` table with a `source`: the data formula for a chart, the Markdown template for a text view. Views and tables share one ordering on the page.

**Template syntax.** Your Jinja-style example, with these tags:

| Tag                                                | Meaning                                                 |
| -------------------------------------------------- | ------------------------------------------------------- |
| `{{ expression }}`                                 | The value of a formula, written without the leading `=` |
| `{% let name = expression %}`                      | Names a value                                           |
| `{% for a, b in expression %} ... {% end %}`       | Once per row, naming the row's cells                    |
| `{% if expression %} ... {% else %} ... {% end %}` | Conditional                                             |
| `{# ... #}`                                        | Comment                                                 |

`{% endfor %}` and `{% endif %}` are accepted for `{% end %}`. I kept Jinja over JSX-style tags because the expressions inside the tags are the app's own formulas, and the tag delimiters do not collide with Markdown or with formula syntax.

**Differences from your example.**

- **No slice syntax.** `SORT(x, 2)[:10]` is written `TAKE(SORT(x, 2), 10)`. The formula language already has `TAKE` and `DROP`, and a second way to say it would exist only inside templates.
- **Chart functions are ordinary functions:** `BAR_CHART`, `LINE_CHART`, `PIE_CHART`, `SCATTER_CHART`. They work in a cell too, where they show as a chip, because a cell has no room to draw one. Function names ignore case, so `pie_chart(...)` works.
- **`${{ amount }}` works** and shows a dollar sign followed by the value. For a fixed number of decimals, write `{{ TEXT(amount, "$#,##0.00") }}`.

**Choices.**

- **A formula on a page must name its table.** `A1` alone is `#REF!` in a chart or text view. A page can hold several tables, so there is no table for a bare address to mean. The alternative was to let a bare address mean the first table on the page, which would silently change meaning when tables are reordered.
- **What `{{ }}` shows depends on the value:** one value goes into the sentence, a range becomes a table, a chart is drawn.
- **Values are escaped.** A cell holding `**bold**` or `<script>` shows those characters. Raw HTML in the template itself is also shown as text. A view can be written by one person and read by another, so nothing a view or cell contains can become markup or script.
- **An error in a formula shows in place** as `#DIV/0!` and the rest of the view still renders. A malformed tag replaces the view with one message naming the line.
- **A `for` loop stops at 10,000 repetitions** across the view, with a message, so `A:A` over a large table cannot hang the page.
- **Renames and row or column edits rewrite view sources** the same way they rewrite cell formulas.
- **Two views may share a name.** Nothing refers to a view by name.
- **Charts are drawn as SVG by the app's own code,** about 300 lines, with no chart library. The four kinds asked for did not justify a dependency, and the drawing is testable as plain DOM. If charts grow (stacking, axes titles, tooltips, zoom), switching to a library is the better path.
- **A standalone chart item takes its kind from the dropdown.** If its data formula is itself a chart function, the dropdown still decides the kind.
- **Views do not act.** A `BUTTON` in a text view shows its label as text. Buttons run from cells because the server derives an action from a stored cell.

**Not done.** Dragging items to reorder them. Data tables with named, typed columns are still on the todo list.

**To change.** The template engine is `packages/engine/src/template.ts`. Rewriting of sources is `packages/engine/src/views.ts`. Drawing is `apps/web/src/components/ChartView.vue` with the arithmetic in `apps/web/src/charts/geometry.ts`.

## 2026-09-30: Dates

**Decision.** Dates are their own kind of value, next to numbers, text, and TRUE/FALSE. A cell typed as `2026-09-30` or `2026-09-30 14:05` is a date. 15 functions work with dates, including `TODAY` and `NOW`.

**Why a separate kind and not a number with a format.** Excel stores a date as a day count and relies on cell formatting to show it as a date. This app has no cell formatting, so a date stored as a number would show as `20726`. A date kind shows as a date everywhere with no formatting step, and `ISDATE`, sorting, and criteria can tell dates from numbers.

**Choices.**

- **Only `YYYY-MM-DD` is read as a date.** `3/4/2026` is March 4 in one country and April 3 in another, so it stays text. This matches your date preference.
- **Arithmetic.** date + number and date - number give a date, counting days. date - date gives days. Anything else uses the date's day count, so `=A1 * 1` is a number.
- **No time zones.** A date is a wall-clock value. `2026-09-30 14:05` means that reading on the clock, wherever you are.
- **`TODAY` and `NOW` use the viewer's clock.** In the browser that is the browser's local time. When the server runs a button, the browser sends its offset from UTC in a request header and the server uses it, so a row stamped by `NOW()` shows the time the person who clicked saw. Without the header the server uses UTC.
- **`TODAY` and `NOW` are computed when the sheet loads or the formula's inputs change.** They do not tick while the page is open.
- **Ordering between kinds:** number < date < text < TRUE/FALSE.
- **`SUM` skips dates in a range**, as it skips text. `MIN` and `MAX` over dates give the earliest and latest date. `MIN` or `MAX` over numbers and dates together is `#VALUE!`, because there is no scale the two share.

**To change.** `packages/engine/src/dates.ts` holds the value, parsing, and display. Arithmetic rules are in `dateArithmetic` in `evaluate.ts`.

## 2026-09-30: Range selection, filling, and copy and paste

**Decision.** The todo item was "dragging and bulk applying formulas". That needed a way to select several cells, so this adds:

- **Range selection** by dragging, Shift+click, and Shift+arrows.
- **A fill handle** on the last cell of the selection. Dragging it down, up, or across repeats the selection's cells as a pattern.
- **Ctrl+D and Ctrl+R**, which copy the first row of the selection down or its first column across.
- **Copy, cut, and paste**, and Delete over a range.

**How formulas move.** A filled or pasted formula has each relative reference moved by the distance the formula moved. `$` pins a row or column. This is what gives the `$` markers their meaning; before this they were parsed and ignored.

**Choices.**

- **No series guessing.** Filling `1, 2` gives `1, 2, 1, 2`, not `3, 4`. Excel and Sheets extend number and date series. Use `=A1+1` and fill that instead. Worth adding later.
- **Copy puts shown values on the clipboard**, so pasting into another app gives results, not formula text. The app remembers what it last copied, and pasting that same text back pastes the formulas.
- **Paste grows the table** to fit, up to its size limit, and says so when part of the paste did not fit.
- **Cut clears at once** and then behaves like copy. It does not wait for the paste, and the formulas' references move as with copy. Excel moves cut formulas without changing them.
- **A fill or paste is one save** of all its cells, in requests of at most 1,000 cells.
- Cell text can no longer be selected by dragging, because dragging selects cells.

**To change.** `translateInput` in `packages/engine/src/rewrite.ts` moves a formula. `apps/web/src/formula/fill.ts` decides which cells a fill or paste writes.

## 2026-09-30: Formula autocompletion

**Decision.** While a formula is typed, in a cell or in the formula bar, a list offers what could complete the word at the caret: function names, the tables of the cell's page, page names, and names the formula already uses (such as those bound by `LET`). Inside a function's parentheses, a hint shows the function's syntax and summary.

**Keys.** Tab accepts the highlighted suggestion. The arrows move the highlight. Enter saves the cell, as it always does, unless the arrows have moved the highlight, in which case it accepts. Escape closes the list, and a second Escape cancels the edit.

**Why Enter does not accept by default.** Typing `=a` and pressing Enter would otherwise turn into `=ABS(`. Excel behaves this way too: Tab completes, Enter commits.

**Not included.** Suggestions for cell addresses, and help on which argument the caret is in.

**To change.** `apps/web/src/formula/assist.ts` decides what is offered. `useFormulaAssist.ts` holds the key handling.

## 2026-09-30: Controls and form actions

**Decision.** Two controls and three actions:

- `CHECKBOX(cell, [label])` and `DROPDOWN(choices, cell)` show an input bound to another cell.
- `APPEND_ROW(range, value, ...)` adds a row below the content of a range and grows the table when needed.
- `CLEAR(range)` empties cells.
- `DO(action, ...)` runs several actions from one click.

Together they make a form: inputs, a Save button that appends to a log table and resets the inputs.

**Why a control writes to another cell.** A formula cannot hold state: its cell's input is the formula. So a control is bound to a target cell, shows that cell's value, and writes changes there. Other formulas read the target cell. This is the same shape as `EXECUTE(value, target)`.

**How a change is stored.** The browser sends the control's cell address and the chosen value. The server evaluates the stored formula, checks that the value is allowed (TRUE or FALSE for a checkbox, one of the choices for a dropdown), and writes it to the target the formula names. As with buttons, the browser cannot name the cell to write. Each change is recorded in `action_runs`.

**Choices.**

- **`DO` actions do not see each other's writes.** Every action reads the cells as they were before the click. This lets `DO(APPEND_ROW(Log!A:B, A1, A2), CLEAR(A1:A2))` work in either order, and makes `DO(EXECUTE(A2, A1), EXECUTE(A1, A2))` a swap.
- **`APPEND_ROW` counts cells filled by an array formula as content**, so it never writes into a spilled result.
- **`CLEAR` only empties cells that hold typed input.** Cells filled by an array formula are not typed, and are left to their formula.
- **A successful control change shows no notice.** The control itself shows the new state. A refused change shows the reason.
- **No dates yet**, so a log row cannot carry a timestamp. `NOW()` needs the date work listed in the todo file.

**To change.** Actions are in `packages/engine/src/functions/actions.ts`, controls in `controls.ts`, and the server's handling in `apps/server/src/actions/run.ts`.

## 2026-09-30: Array results fill neighboring cells

**Decision.** A formula whose result is several values shows the first in its own cell and fills the cells below and to its right, as in Excel and Google Sheets. `FILTER`, `SORT`, `UNIQUE`, `SEQUENCE`, `TRANSPOSE`, `TAKE`, `DROP`, `MAP`, `REDUCE`, `BYROW`, and `BYCOL` build on this. A bare range such as `=A1:A3` now fills cells too; it used to be `#VALUE!`.

**Choices.**

- **Operators work cell by cell on arrays; functions do not.** `=A1:A3 * 2` and `=B1:B9 > 5` give arrays, which is what `FILTER` conditions need. A function that expects one value, such as `IF` or `UPPER`, still fails on a range. `MAP` covers that case. Lifting every function over arrays is possible later.
- **A blocked result is `#SPILL!`.** The cells to fill must be empty and inside the table. The message names the first cell in the way.
- **A formula that reads a cell its own result fills is `#CYCLE!`.** Two array formulas that keep undoing each other's inputs are stopped after 20 rounds and marked `#CYCLE!`.
- **`FILTER` with no matching rows is `#N/A`.** Excel uses `#CALC!` and Sheets uses `#N/A`.
- **`SORT` puts empty cells last in both directions** and orders numbers before text.
- **`EXECUTE` writes an array as a block** starting at its target cell. This gives a button that copies a filtered or sorted result into plain cells.
- **Filled cells are tinted**, and the formula bar names the formula that filled the selected cell.

**Cost.** The engine used to compute a cell only when it was read. It now computes every stale formula before answering any read, because a reader of an empty cell cannot know whether some formula not yet computed will fill it. After an edit only the affected cells are stale, so the cost shows up on first load and on a button click, where the server builds the workbook: all formulas are computed once.

**To change.** `Workbook.place` and `Workbook.settle` in `packages/engine/src/workbook.ts`. Operators over arrays are in `elementwise` in `evaluate.ts`.

## 2026-09-30: LET, LAMBDA, and calling a function kept in a cell

**Decision.** `LET(name, value, ..., result)` and `LAMBDA(parameter, ..., body)` work as in Excel. A function kept in a cell is called by the cell's address: with `=LAMBDA(x, x * 2)` in D1, another cell writes `=D1(21)`.

**Why the cell address is the call syntax.** The todo item asked for a function bound in one cell and invoked from others. Calling by address needs no naming feature, and it reuses everything references already do: the caller depends on the defining cell, renames and row inserts rewrite the call, and `Tools!D1(21)` reaches another table. A named-function feature (a workbook-level list of names) would read better and can be added on top.

**Consequences.**

- A cell address before parentheses always means "call that cell". No built-in function can be named like a cell address, so a future `LOG10` or `ATAN2` needs a different name or a parser exception. A test enforces this for the built-in list.
- An unknown word is now a `#NAME?` error when the formula is computed, not when it is parsed. The result in the cell is the same.
- References inside a function body are read from the defining cell's table, not the caller's.
- A function in a cell cannot call its own cell, because that is a reference cycle. Recursion works by passing the function to itself. Calls nest at most 200 deep.

**To change.** `packages/engine/src/functions/names.ts` holds the two forms. The call syntax is in `Parser.identifier` and `Parser.unary`.

## 2026-09-30: The first batch of added functions

**Decision.** Added 35 functions that other spreadsheets have and that return a single value: the `SUMIF` family, `VLOOKUP`, `XLOOKUP`, `MATCH`, `INDEX`, more math and text functions, the `IS` checks, `IFS`, and `SWITCH`. The help page lists them all.

**Choices that differ between spreadsheets or that I had to pick.**

- `VLOOKUP` and `MATCH` default to the nearest match in sorted data, as in Excel and Google Sheets. Pass `FALSE` or `0` for an exact match. Formulas pasted from those apps behave the same here.
- `XLOOKUP` only does exact matches, and both of its ranges must be a single row or column. Its other match modes can come later.
- A criterion such as `">5"` only matches cells of its own kind: it matches numbers above 5 and never text. An empty criterion `""` matches empty cells, and `"<>"` matches non-empty ones.
- A lookup that finds nothing gives `#N/A`. That error code is back for this purpose.
- `HLOOKUP` is left out. `XLOOKUP` and `INDEX` with `MATCH` cover it.
- Functions that return several values (`FILTER`, `SORT`, `UNIQUE`) wait for array results.
- Dates are not started. There is no date value yet, so `TODAY` and date arithmetic need their own design.

## 2026-09-30: Deleting and inserting rows and columns

**Decision.** A row or column anywhere in a table can be deleted, and one can be inserted before any row or column. The todo item asked only for deleting. Inserting uses the same code, so both shipped.

**How it behaves.**

- Cells past the edit move by one. Formulas anywhere in the spreadsheet that read the table are rewritten to keep reading the same cells.
- A range shrinks when a row inside it is deleted and grows when one is inserted inside it. A formula that named a deleted cell gets `#REF!` in place of the reference.
- The controls act on the selected cell's row and column. Deleting asks for confirmation only when the row or column holds something.
- A table keeps at least one row and one column.

**Why the engine computes it.** The engine function `inputsAfterEdit` takes the workbook and the edit and returns the cell writes. The server applies them in one transaction with the table's new size and returns them, and the browser applies the same list. Shifting rows in SQL would be faster for a large table but would put the rewriting rules in two places.

**Known cost.** Every moved cell is rewritten in the database. Deleting row 1 of a full 1000 by 100 table writes about 100,000 cells.

**To change.** `moveSpan` in `packages/engine/src/rewrite.ts` holds the range rules.

## 2026-09-30: Open-sided ranges

**Decision.** A corner of a range may leave out its row or its column. `A:A` and `A:C` are whole columns, `2:2` and `2:5` are whole rows, `A2:A` runs from A2 to the bottom of the table, and `A1:4` covers rows 1 to 4 from column A to the last column. A reference that is not a range still needs both parts.

**Why these meanings.** Each corner contributes what it names. A start corner that leaves a side out begins at the first row or column. An end corner that leaves a side out has no limit on that side. This one rule gives the usual meaning to `A:A`, `1:1`, and `A2:A`, and gives `A1:4` a meaning without a special case.

**Consequences.**

- An open side stops at the table's size. The engine learns the size from the `rowCount` and `colCount` the app already passes with each table.
- A formula in column A that reads `A:A` is a cycle, as in other spreadsheets.
- A one-to-three-letter word followed by a colon is now a column, so `=A1:foo` is the range A1 to column FOO, not an error.

**To change.** `span` in `packages/engine/src/workbook.ts` holds the rule.

## 2026-09-30: Renames rewrite reference text in place

**Decision.** Renaming a page or table rewrites the formulas that name it. Only the characters of each affected reference change. The rest of the formula stays as typed, including spacing and letter case.

**Why.** The engine can already print a formula from its syntax tree, but that output adds parentheses around every operator and would reformat every formula a rename touched. The parser now records where each reference sits in the text, and `rewriteReferences` splices replacements into those positions.

**Consequences.**

- A rewritten reference is written in canonical form: `'table 2'!a1` becomes `Sales!A1`. A name is quoted only when it is not a plain word.
- The rewrite runs on the server inside the rename's transaction, and the response lists the changed cells. The client does not rewrite anything itself.
- A table name with no page qualifier means a table on the formula's own page. A formula on another page that names a table of the same name is left alone.
- Formulas that do not parse are left alone.

**To change.** `packages/engine/src/rewrite.ts` holds the matching rules in `inputsAfterRename`.

## 2026-09-30: Errors can be written in a formula

**Decision.** `#REF!`, `#DIV/0!`, and the other error codes are valid in formula text and evaluate to that error.

**Why.** Deleting a row, column, or table has to leave something where a formula named the deleted cells. Spreadsheets write `#REF!` there. Without this, the rewritten formula would fail to parse and show `#ERROR!`, which hides the cause.
