These items are not necessarily in priority order. Triage and prioritize smaller, higher-value items before implementing bigger, more complex items.

Itmes added by AI agents should be prefixed `(Claude)`, `(GPT)`, etc. The author will remove the prefix if they fully endorse the idea, though agents asked to act autonomously should not consider these markers as prohibitions on implementation.

Items prefixed "P0", "P1", "P2", "P3", etc. are the author's prioritized actions. When instructed to work autonomously, execute these items first in ascending order (do all P0s first, then P1s, etc.). Items with the same priority are co-equal unless you're instructed otherwise. Items with priority "P10" and above are backlogged and generally shouldn't be picked up unless the author says so explicitly (this is primarily about allocation of work and the author's perceived necessity of the feature). Remove these priority prefixes when checking items off. Check these items off before making commits.

## Bugs

- [x] Wildcard criteria can stall synchronous formula evaluation. [criteria.ts](packages/engine/src/functions/criteria.ts:28) turns `*` and `?` into a backtracking regular expression, then tests cell text at [line 56](packages/engine/src/functions/criteria.ts:56). A crafted criterion and long near-matching text can trigger catastrophic backtracking. Formula evaluation has no time limit, and the server evaluates workbook formulas while handling action clicks. Use a matcher with bounded runtime.

- [x] Combined array results can exhaust memory before spill limits apply. [arrays.ts](packages/engine/src/functions/arrays.ts:129) caps each `SEQUENCE` call at 100,000 cells, but `HSTACK`, `VSTACK`, and `FLATTEN` have no aggregate output cap ([lines 155–184](packages/engine/src/functions/arrays.ts:155)). [workbook.ts](packages/engine/src/workbook.ts:654) materializes the result before checking whether it can spill into the table. Preflight the combined result against a workbook-wide cell budget before allocating it.

- [x] Queued writes are not reauthorized after acquiring the spreadsheet lock. `change` in [spreadsheets.ts](apps/server/src/repo/spreadsheets.ts) takes the lock and runs the work without checking access again, so a write that waited on the lock runs even when the caller was downgraded or removed while it waited. `changePage`, `changeTable`, and `changeView` already read their target again under the lock with `"write"`. The methods that call `change` directly (`createPage`, `reorderPages`, `restoreVersion`) and the public `lockSpreadsheet`, which button clicks use, check only before the lock.
  - Fix it in one place: `change` calls `findSpreadsheet(spreadsheetId, "write")` on the transaction right after `lockSpreadsheet`, and the public `lockSpreadsheet` makes its check after taking the lock. The checks callers make before `change` stay, because they answer 403 or 404 without waiting for the lock.
  - `share` and `unshare` stay outside the lock. A transaction at read committed sees a role change that committed before the check ran.
  - Test: one connection holds the spreadsheet's lock while an editor's write waits, the owner downgrades the editor, the lock is released, and the write gets 403. This needs two connections. If the PGlite setup cannot make one wait on another, run the test only with `TEST_DATABASE_URL`.
  - Update the `change` rule in `CLAUDE.md` to say `change` checks write access under the lock.
  - The undo plan (`plans/implement-undo-that-survives-structural-changes.md`) builds on this and should start after it.

- [ ] **P1** (Claude) One formula can hold many arrays in memory at once. `limitCells` in [arguments.ts](packages/engine/src/functions/arguments.ts) caps each array at 100,000 cells, and nothing caps their total. `=SUM(SEQUENCE(100000), SEQUENCE(100000), …)` fits roughly 600 such arguments in one 8,192-character cell, about 60 million cells alive together. Carry a cell allowance through one formula's evaluation and charge each array made against it.

- [ ] **P1** (Claude) Text has no length limit short of the JavaScript string limit. `REPT` and `&` can build text of hundreds of millions of characters, and every text function, including the wildcard matcher in [criteria.ts](packages/engine/src/functions/criteria.ts), takes time in proportion to it. Cap the length of text a formula can make.

- [ ] **P1** (Claude) Give one evaluation a budget, which covers the two items above. `EvaluationContext` in [evaluate.ts](packages/engine/src/evaluate.ts) carries a mutable allowance of cells read, cells made, characters of text made, and steps (calls of a `LAMBDA`, rows of a `QUERY`, effects planned). The helpers in `arguments.ts`, `QUERY`, the template engine, and action planning charge it, and a formula that runs out is an error in its cell. The server evaluates a whole document when a button is clicked, in the one Node process and under the document's lock, so without this one formula can stall every user.
  - The rule in `CLAUDE.md` that `limitCells` "bounds the memory a formula can ask for" is true of one array only. Reword it when the budget exists.

The next five came from the review of 2026-10-01 (`_scratch/2026-10-01-fresh-eyes-review.md`). The first two were reproduced by running the engine and are fixed. The others were found by reading the code and need a failing test first.

- [x] (Claude) A whole column of another table, written as an operand, makes a false `#CYCLE!`. With `1` in `Table1!A1`, `=Other!A1+1` in `Table1!A2`, and `=Table1!A:A+1` in `Other!A1`, both formulas show `#CYCLE!`. They should show 3 and 2. `operand` in [evaluate.ts](packages/engine/src/evaluate.ts) reads only the formula's own row of `Table1!A:A`, but `Workbook.index` in [workbook.ts](packages/engine/src/workbook.ts) records the whole column as a precedent, so the dependency graph has an edge the evaluator never follows. Make the recorded precedent the cell the operand reads. The same applies to a whole row and to `Table[Column]` as an operand.

- [x] (Claude) `QUERY` refuses an alias used in a clause written before the `select` that defines it. `=QUERY(A1:B2, "order by Total select A, sum(B) as Total group by A")` is `#VALUE!` ("The data has no column Total"), and the same query with `select` first works. `DECISIONS.md` says clauses may come in any order. [query.ts](packages/engine/src/query.ts) resolves names as it parses each clause, so resolve them after every clause is read.

- [ ] **P1** (Claude) Reproduce, then fix: an undo can erase another person's edit. Ada types `x` in A1. Grace types `y` there and then `x`. Ada's undo finds A1 holding `x`, which is what her step left, and puts back what was there before her, erasing Grace's edit. `assertRecordedMatches` in [spreadsheets.ts](apps/server/src/repo/spreadsheets.ts) compares inputs by value, and `changeHistory` looks at later journal entries only to see whether they rewrote references. Refuse a step when a later entry that is still in effect touched one of its cells. Add the case to `undo.test.ts`.

- [ ] **P1** (Claude) Reproduce, then fix: a response that arrives after the editor has opened another document is applied to that document. `addPage` in the [workbook store](apps/web/src/stores/workbook.ts) appends the page and table the server made for document A to the lists of document B, and `renameSpreadsheet` puts back A's record. Other store functions that write after an `await` may do the same and need the same check. `runHistory` already compares the open document's id before applying its answer.

- [ ] **P2** (Claude) Reproduce: two failed saves to one cell may leave a value on screen that the server never held. A1 holds `old`. Type `two`, then `three` before the first save is answered, and have both saves fail. The first failure leaves the cell alone because it now holds `three`. The second restores its `previous`, which is `two`. The reviewer read this in `setCell` and its rollback in the workbook store. Nobody has run it.

## Formula language and functions

- [x] support more reference styles: `A:A`, `A:Z`, `1:1`, `1:4`, `A1:4`, etc.
- [x] renaming a page or table rewrites the formulas that name it
- [x] support the thing where `=A:A+B:B` is equivalent to `=A1+B1` in any cell in 1:1 (and so on)
- [x] add more formulas:
  - [x] common functions other spreadsheets have: SUMIF/COUNTIF family, lookups (VLOOKUP, XLOOKUP, INDEX, MATCH), more math and text, IS* checks, IFS, SWITCH
  - [x] action formulas: insert rows into tables, etc. (APPEND_ROW, CLEAR, DO)
  - [x] widget formulas: dropdown boxes, checkboxes
  - [x] lookup/database formulas: `FILTER`, `SUMIF`, `COUNTIF`, etc.
    - [x] array results that spill into neighboring cells (needed by FILTER, SORT, UNIQUE, MAP)
  - [x] `LET`
  - [x] `LAMBDA` - should be possible to bind a function in one cell and then invoke that function from other cells to create custom user defined functions
  - [x] `MAP` and `REDUCE`
  - [x] `QUERY`
  - [x] (see docs/rows-functions.md; 50 added, the rest triaged there) investigate what functions rows.com offered and filter out the ones that are just for specific data integrations, AI crap, or overly-obscure math stuff -- just try to identify
  - [x] dates and times: a date value type, TODAY, NOW, DATE, date arithmetic, and date display
- [x] dropdown autocompletion of formula names and identifier names
- [x] (Claude) XLOOKUP and INDEX could return a whole row or column now that arrays exist
- [x] (Claude) MIN and MAX over a range of dates; a TEXT function to show a date or number in a chosen format
- [x] (Claude) financial functions (`PMT`, `PV`, `FV`, `NPV`, `IRR`, `RATE`, `NPER`), trig, and line fitting
- [ ] **P4** named functions and values at the workbook level, so `=double(5)` works instead of `=D1(5)`
  - (Claude) plan before implementing. A name that holds a formula is a new place formulas are kept, so renames and row and column edits must rewrite it, and undo must record it
- [ ] **P4** support creating named ranges of one or more cells
- [ ] support optional named arguments to formula functions
  - [ ] **P4** plan before implementing so we can see how hard this would be
  - [ ] example use case: `=QUERY(Table1!A:A, "select *", column_headers=False)`
- [ ] **P6** add a `default`/`else` case to `IFS` so you could write either `IFS(x > 100, "foo", x > 0 "bar", "default value")` or, maybe for familiarity/compatibility `IFS(x > 100, "foo", x > 0 "bar", default="default value")`
- [ ] functions that expect one value (IF, UPPER, ...) do not work cell by cell on a range; only operators do. MAP is the workaround. 
  - [ ] Related: `=UPPER(A:A)` could mean this row's cell, as `=A:A & ""` now does. -- that is, if e.g. D2 = `=UPPER(A:A)`, it should be equivalent to `=UPPER(A2)`
- [ ] **P4** `MAP` doesn't take built-in function names as args - `MAP(A:A, UPPER)` should work but right now it errors with `#NAME?`
- [ ] **P5** regex functions (`REGEXMATCH`, `REGEXEXTRACT`, `REGEXREPLACE`) on a regex engine with a time bound
- [ ] **P3** `TEXT` writes a number of 1e21 or more as `1e+21` followed by the format's decimals
- [ ] **P4** the web app's fill and chart axis build dates without `dateFromMs`, so they skip the year 0 to 9999 check.
- [ ] **P99** user-defined formula functions, evaluated client-side in a sandbox (maybe something like QuickJS or Pyodide)
- [ ] **P4** support better operators: `&&`/`||`/`!` (or, even better, `and`/`or`/`not`) for boolean operations, `!=` in addition to `<>`
- [x] make the help page's navigation sticky so it stays visible as the user scrolls. update it to reflect the section they're currently looking at, too (e.g. by making the currently visible section bold)
- [ ] **P5** add `start` and `step` args to `SEQUENCE`

### Additional formula functions

- [/] (Claude) for the author: review the smaller candidates left in docs/rows-functions.md and determine which to include
- [ ] **P4** the reference functions `OFFSET`, `INDIRECT`, `ADDRESS`, `ISFORMULA`, `ISREF`
- [ ] **P5** random numbers
- [ ] **P4** date helpers except for `TO_TIMEZONE` since we don't use time zones here
- [ ] **P6** other text - `SLICE`, `SLUGIFY`, `DECODEURL`, `BASE64`, `BASE64DECODE`, `DOMAIN`, `RELATIVE_URL`
- [ ] **P5** `LOOKUP`, `HLOOKUP`, `XYLOOKUP` (skip `FLOOKUP` for now)
- [ ] **P4** `SUBTOTAL`, `ARRAY_CONSTRAIN`, `FILTER_COLUMNS`, `RANGE_CONTAINS`
- [ ] **P99** `FLOOKUP`

## Grid editing and navigation

- [x] allow deleting rows and columns in tables (also inserting)
- [x] up and down arrow keys should move up and down rows when in input mode
- [x] support dragging and bulk applying formulas (range selection, fill handle, Ctrl+D/R, copy/cut/paste)
- [x] add context menus for actions like inserting/deleting rows/columns
- [x] (Claude) filling a number or date series: `1, 2` filled down should continue `3, 4`
- [x] (Claude) select whole rows and columns by clicking their headers, and Ctrl+A

- [x] bug: the formula bar doesn't save changes when it loses focus
- [x] hitting enter with the formula bar focused should return focus to the cell -- you can type input and try to hit enter and it'll just stay focused instead of acting like you hit enter in the cell input (I suspect possibly b/c of a conflict with the suggestion behavior)
- [ ] **P3** hitting tab with the formula bar focused should have the same effect as hitting tab with the cell itself selected
- [ ] **P3** show cell errors in a popover on hover instead of using a native browser tooltip
- [ ] **P3** (Claude) clicking a cell or dragging over a range while a formula is being typed writes its reference at the caret, as Excel and Sheets do. A formula's references are typed by hand today
- [ ] **P3** (Claude) color each reference in the formula being edited, and outline the cells it names in the same color
- [ ] **P5** when a spill error occurs, the popover should have a button to resize the table to fit

- [ ] **P3** implement the handy tab+enter workflow from Excel and Sheets -- if you select a certain cell with the mouse or arrow keys, use tab to traverse multiple cells (optionally entering values into any or none of them), then input a value into a cell and submit that value by hitting enter, it'll drop to the next row in the column where you started
  - example: in a table, select C3. hit tab 3 times (optionally entering values in any cells in C3:E3 along the way) - now you're in F3. hit enter to focus the cell input (or just start typing), type anything (or nothing), and hit enter to submit. the selection should move to C4.

- [x] add a long thin "+" button along the full width/height of the bottom/right side of each table for adding rows/cols. this way I can just click anywhere along the range
- [x] support resizing a whole table by just setting its width and height in cols/rows (warn the user and show a confirmation prompt if resizing will delete data)
- [x] dragging over col/row headers should select multiple full columns/rows
- [x] when multiple rows/columns are selected (either via row/col selection or by selecting specific cells), the context menu's "insert [row/column]" actions should become "insert N [rows/columns]", where `N` is the number of selected rows and cols as appropriate
  - if I select C:E using the column headers and right click, I should see "Insert 3 columns left" and "Insert 3 columns right"
- [x] don't show "Insert row" actions in a column header's context menu and don't show "Insert column" actions in a row header's context menu
- [x] when a row/col is inserted into a range used in a formula, the formula's range should be auto-updated to include the range.
  - e.g. if we have A1 = 1, A2 = 2, A3 = 3, A4 = `SUM(A1:A3)` and the user right clicks and inserts a row above or below A2, the range should be updated to `A1:A4`
  - (Claude) this already works. `inputsAfterEdit` in [rewrite.ts](packages/engine/src/rewrite.ts) turns `SUM(A1:A3)` into `SUM(A1:A4)` for a row inserted before row 2 or row 3, and into `SUM(A2:A4)` for one inserted before row 1
- [ ] **P5** (Claude) decide whether a row inserted directly below a range joins it. With `SUM(A1:A3)` in A4, a row inserted before row 4 leaves the range as `A1:A3`, so a value typed into the new row is not summed. Excel and Sheets do the same. Growing the range is right for a total under a list and wrong for a range that ends where it does on purpose. An auto-growing data table with `SUM(Sales[Amount])` avoids the question
- [ ] **P3** allow resizing rows/cols
  - [ ] by clicking and dragging on the borders of the row/col headers
  - [ ] by a "resize [row/column]" ctx menu item shown when right clicking on row/col headers
- [x] when multiple cells/cols/rows are selected, allow deleting the columns or rows containing them from the context menu
  - [x] if I select C:E, give me a "Delete columns C-E" option. likewise for rows.
  - [x] if I select C3:E6 and right click on the selected range, show me both "Delete columns C-E" and "Delete rows 3-6"
- [ ] **P6** merge cells across selection - support merging multiple cells across one or more rows and one or more columns
- [ ] **P2** (Claude) draw only the rows and columns in view. `GridView` makes a cell component for every row and column of a table, 100,000 of them for a table of 1,000 rows and 100 columns, and a page shows every table on it. Each edit also triggers the one ref that holds the engine, so everything that read a value through it is computed again. Do this before raising `tableRows`
- [ ] (Claude) find and replace within a table, page, or document
- [ ] (Claude) hide rows and columns
- [ ] (Claude) freeze header rows and columns so they stay in view while a table scrolls

## Tables, pages, charts, and text views

- [x] add new item types in pages: charts, data tables, and text template views
  - [x] charts - just support basic pie, bar, scatter, and line plots initially as an MVP
  - [x] data tables are tables with specific named and typed columns
    - columns can be referenced using syntax like `'Table 1'[Column Name]`
    - formula columns are a type
  - [x] text template views are the more interesting one. these should be Markdown with some syntax (JSX component tags? some template syntax?) that allows rendering data in a template: values, lists, tables, and eventally charts. it should be possible to invoke formulas. for example, if we used Jinja-style syntax, it'd be possible to write something like (I'm not wedded to this syntax, just using it as an example -- feel free to suggest an alternative if it's friendlier to parse and evaluate):

    ```markdown
    Total sales for the month were ${{ SUM(Sales!B:B) }}.

    ## Top sales categories:

    {% let sales_categories = 'Sales Summary'!A:B %}
    {% let top_categories = SORT(sales_categories, 2)[:10] %}

    {% for category, amount in top_categories %}
    - **{{ category }}:** ${{ amount }}
    {% end %}

    {{ pie_chart(sales_categories) }}

    ## Top 10 deals: <!-- this renders as a table -->

    {{ SORT(Sales!A:C, 2)[:10] }}
    ```
- [x] (Claude) Rows' data actions: `UPDATE(data, key_columns, range)` (upsert by key), `OVERWRITE(data, range)`, and `INSERT` of several rows
- [x] (Claude) reorder the tables, charts, and text views on a page (arrows beside each one)
- [ ] **P1** (Claude) give rows a persistent identity, and let a data table grow as rows are added. Plan before implementing (`plans/persistent-row-identity.md`). A cell is stored and named by its row and column numbers, and a table has a fixed number of rows. That is why a save can cross another person's row insert (under Undo and collaboration), why undo refuses a step after any later structural change, why a data table shows its unused rows, and why the items below it here are hard: sorting and filtering in place, a button in every row, relations between tables, and forms that add a row
- [ ] **P2** data tables: sort and filter in place, dropdown columns, hide the empty rows, and `QUERY(Sales, ...)` over a whole table with its column names as headers
  - (Claude) after row identity, which sorting and hiding rows depend on
  - [ ] allow referencing an entire data table without naming a specific range -- I would like to be able to write s.t. like `=QUERY('Table name'!, 'select * ...')` (not wedded to that exact syntax tho)
    - [ ] **P2** evaluate syntax options and how painful they'd be to implement
  - [ ] **P3** `QUERY` doesn't show col names in its output - if `Table1` is a table with named columns and we write `=QUERY(Table1!A:A, "select *")`, the output should show the column names by default
- [ ] **P4** allow adjusting block display widths and heights to make them larger or smaller -- tables should just be scrollable if they're larger than their block, charts should resize to fit, text should word wrap and be vertically scrollable
- [ ] **P3** when updating a formula column's formula, use an in-page editor with proper formula support (modal or popover or maybe just hijack the formula bar), not a browser `input` popup
- [ ] (Claude) pivot tables as a block or table feature (`QUERY` already has a `pivot` clause)
- [x] move a table, chart, or text view to another page, and reorder pages
- [ ] support chart formulas in tables
  - [ ] **P5** `SPARKLINE` for a single cell
  - [ ] **P5** `PIE_CHART`, `LINE_CHART`, etc. (implement after merging cells is done so the user can merge however many cells they want to show this)
- [ ] **P5** chart options: 
  - [ ] axis titles
  - [ ] stacked bars
  - [ ] colors
- [ ] **P4** when a chart has dates on one axis, they should be spaced out like numeric data, not categorical -- right now if I have a plot with `2018-08-22`, `2019-03-04`, `2019-12-03`, `2020-03-01`, `2021-08-25` on the X-axis, those points all appear equally horizontally spaced, but they should have variable width gaps proportional to the number of days between them just like they would if they were ordinary numbers and the X-axis should have dates at regular intervals covering the time period
- [ ] **P10** show labels on charts on hover
- [x] allow editing markdown views by just double clicking on the text (instead of clicking "Edit"). save and exit edit mode when the user unfocuses the input (instead of requiring user to hit "Done") (keep the "Edit" and "Done" buttons for user convenience)
- [ ] **P4** duplicate the "Add table", "Add chart", "Add text" buttons at the top and between each item so you can insert them anywhere
- [ ] **P5** add a new type of block (in addition to tables, charts, and text): a row, which can itself contain one or more table/chart/text components laid out side-by-side
- [ ] **P3** add an `assert` function that can be used for testing. if a sheet has any failing assertions, show a visible warning in the menu bar with a link the user can click to see the failing assertions
- [x] **P2** update user-facing docs to use "Block" nomenclature for tables/charts/text/etc.
- [ ] **P10** support nested pages
- [ ] support reordering things by dragging and dropping
  - [ ] **P5** pages
  - [ ] **P4** rows and cols by dragging and dropping their headers (including when a range of them is selected) (but no need to handle dragging and dropping a selected range of cells - only do it if the user has specifically selected full rows or columns)
  - [ ] **P5** blocks
- [ ] add context menus for pages and blocks
  - [ ] page actions: delete, move left/right
  - [ ] block actions: whatever each block supports
    - block context menu should appear when right clocking on the card around it but not the controls within it. keep a button in the upper right with a vertical ellipsis that I can click to show the same menu as well

## Formatting

- [x] cell formatting (bold, italic, alignment, colors, number formats)
- [x] formula to render Markdown in cell (`MARKDOWN(text)`; inline formatting only, since a cell is one line)
- [x] (Claude) number formatting for cells (text views and formulas can use `TEXT(value, format)`)
- [ ] more formatting: 
  - [ ] **P6** borders
  - [ ] **P4** basic conditional formatting
  - [ ] **P6** carrying formats through copy, fill, and paste
  - [ ] (Claude) wrap long text within a cell

## Actions and automation

- [ ] more actions:
  - [ ] **P5** delete a row that matches a condition
  - [ ] **P5** targeted update of rows matching a condition as an alternative to the full replacement
    - [ ] **P99** typed (or at least column-name-aware) updates of data tables: s.t. like `MUTATE(Products, [Category] = "GPU", [Price] = [Price] * 2)` (i.e. double the value of `Price` for all rows in `Products` where `Category` == "GPU")
  - [ ] open a URL
  - [ ] call a webhook
    - (Claude) needs the outbox below, and a rule for which addresses a server may call, so a formula cannot reach the server's own network
- [ ] (Claude) scheduled actions: Rows' `SCHEDULE`, `REPEAT`, `REFRESH`. Needs a server scheduler and a rule for whose permissions a scheduled run uses
- [ ] **P2** a `BUTTON` in a text view shows only its label; it could run if views had a click endpoint
- [ ] a limit on the recipients of one `SEND_EMAIL`, separate from the hourly limit
- [ ] **P2** (Claude) show the runs of a document's buttons to the people who can open it: who clicked, when, what it wrote and sent, and how it ended. `action_runs` records all of this and nothing shows it
- [ ] **P3** (Claude) a button can ask for confirmation before it runs, for an action that clears cells or sends email
- [ ] **P3** (Claude) send email from an outbox. `runCell` in [run.ts](apps/server/src/actions/run.ts) commits the cell writes and then sends, so a server that stops in between leaves the run `pending` and the email unsent, and clicking again repeats the cell writes. Store each message with the run in the same transaction and have a sender deliver and retry it
- [ ] **P3** (Claude) a click names the run it is, so a click sent twice runs once
- [ ] **P2** (Claude) evaluate a click's document off the main thread, with a time limit. `runCell` builds and computes the whole workbook in the request handler, which stops the one Node process from answering anyone else until it finishes. The evaluation budget under Bugs bounds the work; a worker thread is what can stop a formula that is already running

## Controls, mobile use, and templates

- [x] rebrand the app as "rowz" instead of "Spreadsheet". don't change package names but just update the UI. make the name configurable via an env var as well so it's easy to update in the future.
- [x] update the page title to show the name of the spreadsheet being edited or, for the help page, "Help". include the app name `rowz` at the end - e.g. `Help | rowz` or `My budget | rowz`
- [ ] (Claude) say "document" instead of "spreadsheet" in the UI and help page, as the README does
- [x] mobile friendly UI (layout, touch targets, tap twice to edit)
- [ ] **P10** revamp the phone-width UI so it is less cramped. The editor header is the tightest part: it holds the back arrow, the spreadsheet's name, the saving indicator, Share, History, Export, and Help on one line.
- [ ] more controls:
  - [ ] **P2** a text or number input bound to a cell (esp. useful in Markdown)
  - [ ] **P6** a date picker
  - [ ] **P6** a time picker
  - [ ] **P6** a combined date and time picker
  - [ ] **P6** a slider input for picking a value from a range
  - [ ] **P6** a numeric value input roughly like (don't use this as a literal template; make it nicer) "<button>-</button> <input value="100"> <button>+</button>" where you can increment and decrement the value using the -/+ buttons (but also still support editing the number directly)
- [ ] **P4** cell validation - require the value to match a pattern, regex, or custom formula
- [ ] **P4** touch: select a range, fill by dragging, and a long-press menu on Android+iOS
- [ ] **P3** create some sample/template sheets users can use - invoice, contacts list, to-do list, personal monthly budget, etc.
  - [ ] **P10** revise/augment the samples after we've added formatting, conditional formatting, etc.
- [x] add screenshots to the README
- [ ] use icons to make the toolbar denser
- [ ] **P3** plan to add keyboard shortcuts
- [ ] **P3** identify where we should use in-app modals instead of browser-based `input` and alerts -- we have specific tasks for a couple of these already so this would just cover identifying anything I missed

## Import and export

- [x] import and export (to files on disk): a JSON file for a whole spreadsheet, and CSV for a table
- [ ] (Claude) import from .xlsx
- [ ] CSV export - two modes: rowz-compatible and data export (selected from a dropdown on the "Export CSV" button)
  - [ ] rowz-compatible: keep verbatim formulas (so the user can reupload it and have their rowz behavior stay the same).
  - [ ] data export: the output is an export that has all calculations materialized so it can be used with any tool that supports reading CSVs

## Undo and collaboration

- [x] undo that survives structural changes (insert or delete a row, rename), and undo of formatting (I'm inclined to tie this into verison history -author)
- [ ] **P8** named versions
- [x] (Claude) undo and redo (persistent version history): the server keeps versions, and History restores one or opens a copy
- [x] (Claude) Ctrl+Z and Ctrl+Y for single edits within a session
- [ ] (Claude) store versions compressed or as differences if large spreadsheets make them costly
- [x] (Claude) live sync between sessions: open sessions re-read the spreadsheet when another changes it
- [ ] **P3** send the changed cells with a change event, so sessions need not re-read the whole spreadsheet; show who else has it open
- [ ] **P1** a save names a cell by row and column, so one that crosses another person's row or column insert lands on the wrong cell. Needs the client to send the table version it saw
  - (Claude) a button click and a checkbox or dropdown change name their cell the same way. The row identity plan under Tables decides between a table version and row ids, and its first step should fix this
- [ ] **P2** (Claude) send every change the editor makes through one ordered queue. The workbook store orders cell saves in `saves`, holds writes behind `writeBarrier` during an undo, and keeps separate queues for reorders and view updates. Structure changes go through `attempt`, which waits for the barrier and not for `saves`. A reviewer read this as letting a cell save and a resize started together reach the server in either order; check whether each such function waits for `stored()` first. A queue that also remembers which document each request was for fixes the wrong-document bug under Bugs in one place, and gives the version restore below a place to go
- [ ] (Claude) show a version restore in the save indicator. `HistoryPanel` calls the server itself, so the header says "Saved" and the leave warning stays off while a restore runs. The request is sent on the click and the server finishes it if the page is closed, so nothing is lost; routing the restore through the workbook store would also order it after edits still being saved
- [ ] (Claude) comments on cells

## Accounts and email

- [x] (Claude) sharing UI: share a spreadsheet with another account as editor or viewer
- [x] (Claude) email verification at sign-up, switched on with `REQUIRE_EMAIL_VERIFICATION`
- [x] (Claude) real email delivery behind the `Mailer` interface (set `SMTP_URL`)
- [ ] **P4** (Claude) invitations for people without an account, password reset, and resending a confirmation link
- [ ] **P4** allow users to create folders to organize their sheets

## Server, performance, and reliability

- [x] (Claude) production build of the web app, served by the server
- [ ] (Claude) a compiled server build and a Dockerfile, verified by building and running it
- [ ] (Claude) several server processes: the change feed is in memory (Postgres LISTEN/NOTIFY would do)
- [ ] (Claude) trusted proxy configuration for better-auth's rate limiting, as a config variable
- [ ] (Claude) a large table re-writes every moved cell on a row or column insert/delete; shift in SQL if this gets slow
- [ ] (Claude) cache a range's values across the formulas that read the same range. Each formula reads every cell of its range again when it is recalculated, so 50,000 formulas that each read a 1,000-row column take about 10 s after one edit in that column: 50 million cell reads. 1,000 such formulas take about 0.2 s, so this matters only at the extreme. The cache needs invalidation inside the evaluator: a cached range is stale once any cell in it changes, including a cell an array result fills or gives up.
- [ ] (Claude) index the ranges of a column by row in the dependency index. `transitiveDependents` in [graph.ts](packages/engine/src/graph.ts) scans every range that crosses a cell's column for each cell it reaches, so one edit costs the number of cells reached times the number of ranges in their columns. Deferred because the size limits keep it small: a table has at most 1,000 rows, so a chain down one column costs about 12 ms, and the worst case that fits in a spreadsheet (1,000 cells reached in a column that 99,000 ranges cross) is estimated at 1 s. Do it before raising `tableRows`: at 20,000 rows one edit measured 4.7 s, and the time grows with the square of the row count
- [x] (Claude) code review of 2026-10-01 (`_scratch/2026-10-01-codex-review.md`): all 20 findings addressed, see DECISIONS.md
- [x] (Claude) run `pnpm e2e` and the server tests against Postgres (`TEST_DATABASE_URL`) after the review fixes: neither runs in the sandbox
  - (author) e2e run and full CI run are passing as of `87b20ea`
- [ ] **P1** a limit on the length of text a formula builds: `REPT("x", 5e8)` is under JavaScript's string limit and still takes half a gigabyte, on the server too when a button runs
  - (Claude) the evaluation budget under Bugs covers this
- [ ] **P1** (Claude) refuse to start in production on development defaults. With `NODE_ENV=production`, [config.ts](apps/server/src/config.ts) requires `AUTH_SECRET` but falls back to PGlite under `.data/` for `DATABASE_URL` and to `http://localhost:5173` for `BASE_URL`. Require both
- [ ] **P1** (Claude) require a confirmed email address before an account can send email. `REQUIRE_EMAIL_VERIFICATION` is off by default, so on an instance with `SMTP_URL` set anyone can sign up and send 50 emails an hour to any address. Either turn verification on whenever `SMTP_URL` is set, or refuse `SEND_EMAIL` from an unconfirmed account. Also add a limit on email for the whole instance
- [x] (Claude) make the tests that guard a design rule find what they guard. `access.test.ts` and `undo.test.ts` ran over lists of routes written by hand, so a new route that nobody added passed both, and the stream at `/spreadsheets/:id/events` was missing from `access.test.ts`. Each now compares what it covers with the routes the app registers and fails for one that is left out
- [ ] **P2** (Claude) a lint rule that keeps `packages/engine` free of imports from outside it and of Node and browser globals. Its `package.json` has no dependencies, and nothing fails if one is added
- [ ] **P3** limits on per-block and overall document size (make sure to enforce on upload as well) to avoid gigantic docs

## Planning/ideas

- [x] **P1** come up with a good name to refer to all "page components" - tables, charts, text templates, etc. -- I guess "page components" could work but feels kinda generic. `Card` is used in the component names. "card types"? -> Block

## Ambitious ideas - don't implement until further consideration

- **P9999** idea to think about: support offline work on spreadsheets, stored in local storage, and let users create and edit local spreadsheets even without an account. features like sharing, sending emails, automation, etc. would still require an account, but users could use the client side functionality freely without signing up.
- "table functions" - functions defined by a table editor. mark specific cells as inputs and a specific cell/range as the output. then when the function is invoked, evaluate the operations defined by this table (note: this shouldn't mutate the table in place)
- "formula scripts" - let the user write scripts like so:
  ```
  // Script name: SalesSummary
  TotalSales = SUM(Sales[Amount])
  NumSales = COUNT(Sales)
  // could also just write `AverageSale = AVERAGE(Sales[Amount])`
  AverageSale = TotalSales / NumSales
  ```
  - make the values in the function script accessible so you could write `=SalesSummary[AverageSale]` or maybe `=SalesSummary.AverageSale` to reference a computed value
  - this would also enable defining functions
    ```
    MyFunc = LAMBDA(...)
    OtherFunc = LAMBDA(...)
    ```
  - support reusable function scripts that can be shared across sheets
- support referencing tables/etc. from other documents
- forms for submitting new rows to tables
- programmatic construction of documents
  - one approach:
    - create new actions to support editing other documents programmatically (by default require the user's approval for access before the first time. after that the document gains permission to edit the other doc whenever)
    - create new actions that allow creating new docs programmatically (in this case, by default, the doc that executed the creation action gets permission to edit the other doc)
    - -> then it'd be possible to have a `DO` block that makes a copy of a document and edits it
- expose a user-facing API to create, edit, read, etc. documents

- **P999** user-defined macros so you could create your own syntax -- hypothetical use case with made-up syntax (so I'm not wedded to it looking like this): `SWITCHON(x, [A]*[B]/[C])(x > 1000, "foo", x > 100, "bar", x > 0, "baz", default="nope!")` which could possibly be defined something like, uh... idk what the macro definition syntax should actually be but somehow that would get munged into `LET(x, [A]*[B]/[C], IFS(x > 1000, "foo", x > 100, "bar", x > 0, "baz", default="nope!"))`

- (Claude) protected ranges: cells that only some people may change
- (Claude) a layout for printing
- (Claude) export to .xlsx
- (Claude) numbers and dates shown in the reader's locale
