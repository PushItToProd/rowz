These items are not necessarily in priority order. Triage and prioritize smaller, higher-value items before implementing bigger, more complex items.

Itmes added by AI agents should be prefixed `(Claude)`, `(GPT)`, etc. The author will remove the prefix if they fully endorse the idea, though agents asked to act autonomously should not consider these markers as prohibitions on implementation.

Items prefixed "P0", "P1", "P2", "P3", etc. are the author's prioritized actions. When instructed to work autonomously, execute these items first in ascending order (do all P0s first, then P1s, etc.). Items with the same priority are co-equal unless you're instructed otherwise. Items with priority "P10" and above are backlogged and generally shouldn't be picked up unless the author says so explicitly (this is primarily about allocation of work and the author's perceived necessity of the feature). Remove these priority prefixes when checking items off. Check these items off before making commits.

## Current focus

rowz is a proof of concept that one person uses on their own machine. Features that make it more useful come before correctness under several users, hostile input, or deployment. The exceptions are serious bugs that one person would hit in ordinary use, and design flaws that would make much later work harder.

Feature work is grouped into four themes, and the priority prefixes follow them:

- **P1, names and testable logic:** document-level names for values, functions, and ranges, formula scripts, and `ASSERT`.
- **P2, data tables:** a reference to a whole table, `QUERY` output with column names, sorting and filtering in place, dropdown columns, and conditional formats.
- **P3, documents as small apps:** input controls bound to cells, buttons that run in text views, a log of button runs, and blocks laid out side by side.
- **P4, formula editing:** picking references by clicking, colored references, one formula editor for every place a formula is typed, and smaller editing fixes. Smaller editing fixes can be done between larger pieces of the other themes; the shared editor needs broader planning.

P5 to P9 are other features in rough order of value. The items under [Before sharing with others](#before-sharing-with-others) are parked at P10.

The reference documents under [Controls, mobile use, and templates](#controls-mobile-use-and-templates) are the acceptance test of each theme: a theme is done when its reference document is usable. What gets in the way of building one becomes new items here.

## Inbox - to be categorized

- [x] "Save as"/"Save a copy" for duplicating an existing document
- [x] when errors appear in a rendered markdown block, show the errors as a chip with the error message. e.g. writing `{{ A+nonexistentvar }}` currently just renders `#NAME?` verbatim, but not even what name is invalid

## Plans

- [x] **P1** implement [persistent row identity](plans/persistent-row-identity.md)
- [x] implement [data tables](plans/data-tables.md): sort and filter, dropdown columns, conditional formats, and the Gran Turismo 7 sample

## Bugs

- [ ] `QUERY` treats single quotes as delimiting string literals which contradicts the outer formula languge syntax. this isn't exactly a bug but I consider it a severe enough misfeature I'm classing it as one - we should probably have single quotes delimit identifiers in `QUERY` syntax instead so you can write queries like `=QUERY(People, "select 'Favorite food', count(*) group by 'Favorite food'")`. (as this is a pre-production app I don't care if this breaks anything)

- [x] Wildcard criteria can stall synchronous formula evaluation. [criteria.ts](packages/engine/src/functions/criteria.ts:28) turns `*` and `?` into a backtracking regular expression, then tests cell text at [line 56](packages/engine/src/functions/criteria.ts:56). A crafted criterion and long near-matching text can trigger catastrophic backtracking. Formula evaluation has no time limit, and the server evaluates workbook formulas while handling action clicks. Use a matcher with bounded runtime.

- [x] Combined array results can exhaust memory before spill limits apply. [arrays.ts](packages/engine/src/functions/arrays.ts:129) caps each `SEQUENCE` call at 100,000 cells, but `HSTACK`, `VSTACK`, and `FLATTEN` have no aggregate output cap ([lines 155–184](packages/engine/src/functions/arrays.ts:155)). [workbook.ts](packages/engine/src/workbook.ts:654) materializes the result before checking whether it can spill into the table. Preflight the combined result against a workbook-wide cell budget before allocating it.

- [x] Queued writes are not reauthorized after acquiring the spreadsheet lock. `change` in [spreadsheets.ts](apps/server/src/repo/spreadsheets.ts) takes the lock and runs the work without checking access again, so a write that waited on the lock runs even when the caller was downgraded or removed while it waited. `changePage`, `changeTable`, and `changeView` already read their target again under the lock with `"write"`. The methods that call `change` directly (`createPage`, `reorderPages`, `restoreVersion`) and the public `lockSpreadsheet`, which button clicks use, check only before the lock.
  - Fix it in one place: `change` calls `findSpreadsheet(spreadsheetId, "write")` on the transaction right after `lockSpreadsheet`, and the public `lockSpreadsheet` makes its check after taking the lock. The checks callers make before `change` stay, because they answer 403 or 404 without waiting for the lock.
  - `share` and `unshare` stay outside the lock. A transaction at read committed sees a role change that committed before the check ran.
  - Test: one connection holds the spreadsheet's lock while an editor's write waits, the owner downgrades the editor, the lock is released, and the write gets 403. This needs two connections. If the PGlite setup cannot make one wait on another, run the test only with `TEST_DATABASE_URL`.
  - Update the `change` rule in `CLAUDE.md` to say `change` checks write access under the lock.
  - The undo plan (`plans/implement-undo-that-survives-structural-changes.md`) builds on this and should start after it.

The next five came from the review of 2026-10-01 (`_scratch/2026-10-01-fresh-eyes-review.md`). The first four are fixed, each with a test that failed before the fix. The last was found by reading the code and needs a failing test first. It is parked under Before sharing with others.

- [x] (Claude) A whole column of another table, written as an operand, makes a false `#CYCLE!`. With `1` in `Table1!A1`, `=Other!A1+1` in `Table1!A2`, and `=Table1!A:A+1` in `Other!A1`, both formulas show `#CYCLE!`. They should show 3 and 2. `operand` in [evaluate.ts](packages/engine/src/evaluate.ts) reads only the formula's own row of `Table1!A:A`, but `Workbook.index` in [workbook.ts](packages/engine/src/workbook.ts) records the whole column as a precedent, so the dependency graph has an edge the evaluator never follows. Make the recorded precedent the cell the operand reads. The same applies to a whole row and to `Table[Column]` as an operand.

- [x] (Claude) `QUERY` refuses an alias used in a clause written before the `select` that defines it. `=QUERY(A1:B2, "order by Total select A, sum(B) as Total group by A")` is `#VALUE!` ("The data has no column Total"), and the same query with `select` first works. `AGENT_DECISIONS.md` says clauses may come in any order. [query.ts](packages/engine/src/query.ts) resolves names as it parses each clause, so resolve them after every clause is read.

- [x] (Claude) Reproduce, then fix: an undo can erase another person's edit. Ada types `x` in A1. Grace types `y` there and then `x`. Ada's undo finds A1 holding `x`, which is what her step left, and puts back what was there before her, erasing Grace's edit. `assertRecordedMatches` in [spreadsheets.ts](apps/server/src/repo/spreadsheets.ts) compares inputs by value, and `changeHistory` looks at later journal entries only to see whether they rewrote references. Refuse a step when a later entry that is still in effect touched one of its cells. Add the case to `undo.test.ts`.

- [x] (Claude) Reproduce, then fix: a response that arrives after the editor has opened another document is applied to that document. `addPage` in the [workbook store](apps/web/src/stores/workbook.ts) appends the page and table the server made for document A to the lists of document B, and `renameSpreadsheet` puts back A's record. Other store functions that write after an `await` may do the same and need the same check. `runHistory` already compares the open document's id before applying its answer.

- [x] when editing a script and unfocusing it, if a table cell is already selected that's above or below the fold, the UI will scroll the whole page up/down to show that cell, which is really annoying

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
- [x] **P1** named functions and values at the workbook level, so `=double(5)` works instead of `=D1(5)`
  - (Claude) plan before implementing. A name that holds a formula is a new place formulas are kept, so renames and row and column edits must rewrite it, and undo must record it
- [x] **P1** support creating named ranges of one or more cells
- [x] **P1** (Claude) plan one mechanism for document-level names before implementing the two items above. It should cover named values, named functions, named ranges, and the formula scripts under Ambitious ideas. A script block that holds `Name = formula` lines could cover all four, and rewriting and undo would then be extended for one new place that holds formulas
  - (Claude) implemented in [plans/names-and-scripts.md](plans/names-and-scripts.md)
- [ ] support optional named arguments to formula functions
  - [ ] **P6** plan before implementing so we can see how hard this would be
  - [ ] example use case: `=QUERY(Table1!A:A, "select *", column_headers=False)`
- [ ] **P4** add a `default`/`else` case to `IFS` so you could write either `IFS(x > 100, "foo", x > 0 "bar", "default value")` or, maybe for familiarity/compatibility `IFS(x > 100, "foo", x > 0 "bar", default="default value")`
- [ ] functions that expect one value (IF, UPPER, ...) do not work cell by cell on a range; only operators do. MAP is the workaround. 
  - [ ] Related: `=UPPER(A:A)` could mean this row's cell, as `=A:A & ""` now does. -- that is, if e.g. D2 = `=UPPER(A:A)`, it should be equivalent to `=UPPER(A2)`
- [ ] **P4** `MAP` doesn't take built-in function names as args - `MAP(A:A, UPPER)` should work but right now it errors with `#NAME?`
- [ ] **P7** regex functions (`REGEXMATCH`, `REGEXEXTRACT`, `REGEXREPLACE`) on a regex engine with a time bound
- [x] **P10** `TEXT` writes a number of 1e21 or more as `1e+21` followed by the format's decimals
- [x] **P10** the web app's fill and chart axis build dates without `dateFromMs`, so they skip the year 0 to 9999 check.
- [ ] **P99** user-defined formula functions, evaluated client-side in a sandbox (maybe something like QuickJS or Pyodide)
- [ ] **P4** support better operators: 
  - [ ] infix `and`/`or`/`not` for boolean operations (`A and (not B or C)`)
  - [ ] `!=` in addition to `<>`
- [x] make the help page's navigation sticky so it stays visible as the user scrolls. update it to reflect the section they're currently looking at, too (e.g. by making the currently visible section bold)
- [x] **P7** add `start` and `step` args to `SEQUENCE`

### Additional formula functions

- [ ] add `CLAMP(val, min, max)`, equivalent to `IFS(val < min, min, val > max, max, default=val)` once the default case exists

- [/] (Claude) for the author: review the smaller candidates left in docs/rows-functions.md and determine which to include
- [ ] **P6** the reference functions `OFFSET`, `INDIRECT`, `ADDRESS`, `ISFORMULA`, `ISREF`
- [ ] **P7** random numbers
- [ ] **P6** date helpers except for `TO_TIMEZONE` since we don't use time zones here
- [x] other text - `SLICE`, `SLUGIFY`, `DECODEURL`, `BASE64`, `BASE64DECODE`, `DOMAIN`, `RELATIVE_URL`
- [x] **P7** `LOOKUP`, `HLOOKUP`, `XYLOOKUP` (skip `FLOOKUP` for now)
- [ ] **P6** `SUBTOTAL`, `ARRAY_CONSTRAIN`, `FILTER_COLUMNS`, `RANGE_CONTAINS`
- [ ] consider resolving an ambiguous bare word by nearness: a name in the formula's own table or script first, then names and tables on the formula's page. The author considers this dangerous and has not decided to do it. If it is done, every use of a word with more than one meaning in the document is marked with a yellow wavy underline. See [DECISIONS.md](DECISIONS.md), "An ambiguous name is an error"
- [ ] consider having a rename qualify the bare words it would make ambiguous. Renaming the name `Y` to `X` while a table `X` exists would first rewrite each bare `X` to `'Page 1'!X`
- [ ] (Claude) consider Excel's structured references for parts of a data table: `Sales[#Data]`, `Sales[#Headers]`, and `Sales[#All]`. The bare table name already means the data rows (see [plans/names-and-scripts.md](plans/names-and-scripts.md))
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
- [ ] **P4** one formula editor for every place a formula is typed: cells, the formula bar, formula columns, names, filters, chart sources, scripts, and Markdown templates
  - [ ] plan shared editing support across single-formula inputs, multiline scripts, and formulas embedded in Markdown; evaluate CodeMirror or a similar editor before choosing an implementation
  - [ ] syntax highlighting for formulas in scripts and Markdown
  - Coordinate completion, reference picking, reference colors, and keyboard behavior across these editors. The formula-column prompt replacement below is part of this work.
- [x] hitting tab with the formula bar focused should have the same effect as hitting tab with the cell itself selected
- [x] show cell errors in a popover on hover instead of using a native browser tooltip
- [ ] **P4** (Claude) clicking a cell or dragging over a range while a formula is being typed writes its reference at the caret, as Excel and Sheets do. A formula's references are typed by hand today
- [ ] **P4** (Claude) color each reference in the formula being edited, and outline the cells it names in the same color
- [x] **P7** when a spill error is caused by table dimensions, show a “Resize table to fit” button in its popover
- [x] **P6** Clearly explain why an array result cannot spill: when the table is too small, say e.g. “The result needs 12 rows and 26 columns, but the table is only 11 rows and 15 columns”; when existing values block it, say e.g. “but one or more cells in A1:P26 already have values.” Do not name a target cell when the table dimensions are the reason it cannot fit.

- [x] implement the handy tab+enter workflow from Excel and Sheets -- if you select a certain cell with the mouse or arrow keys, use tab to traverse multiple cells (optionally entering values into any or none of them), then input a value into a cell and submit that value by hitting enter, it'll drop to the next row in the column where you started
  - example: in a table, select C3. hit tab 3 times (optionally entering values in any cells in C3:E3 along the way) - now you're in F3. hit enter to focus the cell input (or just start typing), type anything (or nothing), and hit enter to submit. the selection should move to C4.

- [x] add a long thin "+" button along the full width/height of the bottom/right side of each table for adding rows/cols. this way I can just click anywhere along the range
- [x] right-clicking the row and column "+" strips opens a context menu to add 5, 10, or 15 rows or columns, or enter a custom count
  - [x] **P8** (Claude) a growth menu with every item disabled (the spreadsheet is at its row limit) cannot be dismissed with Escape from the keyboard, because no button takes focus and the menu has no `tabindex`. [ContextMenu.vue](apps/web/src/components/ContextMenu.vue)
  - [x] **P8** (Claude) the row "+" strip's left click ignores the spreadsheet-wide row limit: `rowsFull` in [TableCard.vue](apps/web/src/components/TableCard.vue) checks only the table's own limit, so at the spreadsheet limit the strip stays enabled and the server rejects the click
- [x] support resizing a whole table by just setting its width and height in cols/rows (warn the user and show a confirmation prompt if resizing will delete data)
- [x] dragging over col/row headers should select multiple full columns/rows
- [x] when multiple rows/columns are selected (either via row/col selection or by selecting specific cells), the context menu's "insert [row/column]" actions should become "insert N [rows/columns]", where `N` is the number of selected rows and cols as appropriate
  - if I select C:E using the column headers and right click, I should see "Insert 3 columns left" and "Insert 3 columns right"
- [x] don't show "Insert row" actions in a column header's context menu and don't show "Insert column" actions in a row header's context menu
- [x] when a row/col is inserted into a range used in a formula, the formula's range should be auto-updated to include the range.
  - e.g. if we have A1 = 1, A2 = 2, A3 = 3, A4 = `SUM(A1:A3)` and the user right clicks and inserts a row above or below A2, the range should be updated to `A1:A4`
  - (Claude) this already works. `inputsAfterEdit` in [rewrite.ts](packages/engine/src/rewrite.ts) turns `SUM(A1:A3)` into `SUM(A1:A4)` for a row inserted before row 2 or row 3, and into `SUM(A2:A4)` for one inserted before row 1
- [ ] **P7** (Claude) decide whether a row inserted directly below a range joins it. With `SUM(A1:A3)` in A4, a row inserted before row 4 leaves the range as `A1:A3`, so a value typed into the new row is not summed. Excel and Sheets do the same. Growing the range is right for a total under a list and wrong for a range that ends where it does on purpose. An auto-growing data table with `SUM(Sales[Amount])` avoids the question
- [x] **P4** allow resizing rows heights and column widths
  - [x] by clicking and dragging on the borders of the row/col headers
  - [x] by a "resize [row/column]" ctx menu item shown when right clicking on row/col headers
  - [x] **P8** (Claude) dragging a header border to resize did not work by touch. [GridView.vue](apps/web/src/components/GridView.vue) now uses pointer events with pointer capture and `touch-action: none` on the handles.
- [x] when multiple cells/cols/rows are selected, allow deleting the columns or rows containing them from the context menu
  - [x] if I select C:E, give me a "Delete columns C-E" option. likewise for rows.
  - [x] if I select C3:E6 and right click on the selected range, show me both "Delete columns C-E" and "Delete rows 3-6"
- [ ] **P8** merge cells across selection - support merging multiple cells across one or more rows and one or more columns
- [ ] **P5** (Claude) draw only the rows and columns in view. `GridView` makes a cell component for every row and column of a table, 100,000 of them for a table of 1,000 rows and 100 columns, and a page shows every table on it. Each edit also triggers the one ref that holds the engine, so everything that read a value through it is computed again. Do this before raising `tableRows`
- [ ] find and replace within a block, page, or document
  - [ ] **P4** standalone find without replace - search just the current document
    - [ ] **P4** allow filtering by just the current page or block
  - [ ] **P4** find and replace within a document
  - [ ] **P5** cross-document search
  - don't implement cross-document find and replace -- too risky
- [ ] support hiding rows and columns
- [ ] support hiding pages
- [ ] freeze header rows and columns so they stay in view while a table scrolls

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
- [x] **P1** (Claude) give rows and columns persistent identities in storage, snapshots, and editor requests. All implementation steps of `plans/persistent-row-identity.md` are implemented
- [x] **P1** finish steps 4–11 of `plans/persistent-row-identity.md`: ID-keyed cells and journal entries, narrower undo conflicts, appended rows, revisioned content events, stale-formula refusals, and OVERWRITE row deletion
- [x] data tables: sort and filter in place, dropdown columns, and `QUERY(Sales, ...)` over a whole table with its column names as headers
  - (Claude) after row identity, which sorting and hiding rows depend on
  - (author) sorting and filtering are display settings of a table. They leave the stored row order alone, so `A2` keeps its meaning
  - [x] reference an entire data table by its unique name; `QUERY(Sales, ...)` uses the table's column names as headers
  - [x] `QUERY` shows named columns in its output, including for ranges such as `Sales!A:C`
  - [x] sort and filter a data table in place (`plans/data-tables.md`, stage 1)
  - [x] dropdown columns (`plans/data-tables.md`, stage 2)
- [ ] export variables declared in Markdown templates as named values, like script declarations and named ranges in tables
- [ ] **P3** add a way to save multiple sort and filter view presets for each data table
- [ ] explore adding a generated, dynamically sized data table block type defined by the output of a formula, so changing the result's row or column count does not require manually managing table dimensions; the implementation approach is open and needs to consider conditional formatting and other proprrties as well (may also be addressed by the proposal to support conditional formatting and sorting when rendering data tables in markdown)
- [ ] (Claude) consider deleting a data table's row when its last cell is cleared. `plans/persistent-row-identity.md` keeps such a row, so that its id stays valid for a relation that points at it, and deletes empty rows only at the end of a table when its columns are named
- [ ] **P6** allow adjusting block display widths and heights to make them larger or smaller -- tables should just be scrollable if they're larger than their block, charts should resize to fit, text should word wrap and be vertically scrollable
- [ ] **P4** when updating a formula column's formula, use an in-page editor with proper formula support (modal or popover or maybe just hijack the formula bar), not a browser `input` popup
- [ ] (Claude) pivot tables as a block or table feature (`QUERY` already has a `pivot` clause)
- [x] move a table, chart, or text view to another page, and reorder pages
- [ ] support chart formulas in tables
  - [ ] **P7** `SPARKLINE` for a single cell
  - [ ] **P7** `PIE_CHART`, `LINE_CHART`, etc. (implement after merging cells is done so the user can merge however many cells they want to show this)
- [ ] **P7** chart options: 
  - [ ] axis titles
  - [ ] stacked bars
  - [ ] colors
- [ ] **P6** when a chart has dates on one axis, they should be spaced out like numeric data, not categorical -- right now if I have a plot with `2018-08-22`, `2019-03-04`, `2019-12-03`, `2020-03-01`, `2021-08-25` on the X-axis, those points all appear equally horizontally spaced, but they should have variable width gaps proportional to the number of days between them just like they would if they were ordinary numbers and the X-axis should have dates at regular intervals covering the time period
- [ ] adopt a reasonable charting library -- something lightweight that saves us from having to worry about too much minutiae (unvetted possibilities: ECharts, Chart.js)
- [ ] **P10** show labels on charts on hover
- [x] allow editing markdown views by just double clicking on the text (instead of clicking "Edit"). save and exit edit mode when the user unfocuses the input (instead of requiring user to hit "Done") (keep the "Edit" and "Done" buttons for user convenience)
- [ ] support conditional formatting and sorting when rendering a data table in Markdown, or allow embedding an existing table/sheet in a Markdown view so its conditional formatting is applied
- [x] **P6** duplicate the "Add table", "Add chart", "Add text" buttons at the top and between each item so you can insert them anywhere
- [ ] **P3** add a new type of block (in addition to tables, charts, and text): a row, which can itself contain one or more table/chart/text components laid out side-by-side
- [x] **P1** add an `assert` function that can be used for testing. if a sheet has any failing assertions, show a visible warning in the menu bar with a link the user can click to see the failing assertions
- [x] **P2** update user-facing docs to use "Block" nomenclature for tables/charts/text/etc.
- [ ] **P10** support nested pages
- [ ] support reordering things by dragging and dropping
  - [ ] **P7** pages
  - [ ] **P6** rows and cols by dragging and dropping their headers (including when a range of them is selected) (but no need to handle dragging and dropping a selected range of cells - only do it if the user has specifically selected full rows or columns)
  - [ ] **P7** blocks
- [ ] add context menus when right clicking on pages tab and block headers/margins
  - [ ] page actions: delete, move left/right
  - [ ] block actions: whatever each block supports
    - block context menu should appear when right clocking on the card around it but not the controls within it. keep a button in the upper right with a vertical ellipsis that I can click to show the same menu as well
- [ ] data tables - allow choices to be drawn from a formula's result (when the formula value changes, keep the raw underlying value in the cell but flag it visibly as invalid)
- [ ] allow creating links to navigate directly to a page, table cell, block, etc.

## Formatting

- [x] cell formatting (bold, italic, alignment, colors, number formats)
- [x] formula to render Markdown in cell (`MARKDOWN(text)`; inline formatting only, since a cell is one line)
- [x] (Claude) number formatting for cells (text views and formulas can use `TEXT(value, format)`)
- [ ] more formatting: 
  - [ ] **P8** borders
  - [x] basic conditional formatting (`plans/data-tables.md`, stage 3)
  - [ ] conditional formatting followups:
    - [ ] allow a criterion formula to refer to the current cell with a placeholder such as `X` or `X()`, e.g. `X>10`
    - [ ] support relative references in criterion formulas, e.g. `X()>X(0,+1)` for “this cell is greater than the value to its right”
    - [ ] calculate color range values with a formula, e.g. `CLAMP(X(), -5, 5)`, and use those results to choose colors
    - [ ] allow HTML color names and hex RGB codes for conditional formatting colors
      - [ ] make color dropdowns comboboxes that show current options on click, suggest valid HTML color names while typing, and accept hex codes beginning with `#`
    - [ ] allow a formula to return a conditional formatting color, including HTML color names such as `red` or `purple` and numeric values, so a user-defined function can control coloring
    - [ ] advanced color range settings:
      - [ ] choose arbitrary colors for minimum, midpoint, and maximum points
      - [ ] choose each point's value as the range minimum/maximum as appropriate, a fixed number, a percent, or a percentile
    - [ ] support more conditional formatting types, including text decoration (bold, italics, etc.) and cell borders
      - Formula-based formatting may initially need a separate formula for each formatting type; revisit the design when struct types are supported
    - [ ] explore user-configurable ways to combine multiple conditional formatting rules:
      - [ ] mix colors applied by multiple rules
      - [ ] split a cell background into segments colored by each applicable rule
  - [ ] **P8** carrying formats through copy, fill, and paste
  - [ ] (Claude) wrap long text within a cell

## Actions and automation

- [ ] more actions:
  - [ ] **P7** delete a row (or rows) that matches a condition
  - [ ] **P7** targeted update of rows matching a condition as an alternative to the full replacement
    - [ ] **P99** typed (or at least column-name-aware) updates of data tables: s.t. like `MUTATE(Products, [Category] = "GPU", [Price] = [Price] * 2)` (i.e. double the value of `Price` for all rows in `Products` where `Category` == "GPU")
  - [ ] fetch CSV/JSON/etc. from a URL
  - [ ] call a webhook
    - (Claude) needs the outbox under Before sharing with others, and a rule for which addresses a server may call, so a formula cannot reach the server's own network
- [ ] (Claude) scheduled actions: Rows' `SCHEDULE`, `REPEAT`, `REFRESH`. Needs a server scheduler and a rule for whose permissions a scheduled run uses
- [ ] **P3** a `BUTTON` in a text view shows only its label; it could run if views had a click endpoint
- [ ] **P3** (Claude) show the runs of a document's buttons to the people who can open it: who clicked, when, what it wrote and sent, and how it ended. `action_runs` records all of this and nothing shows it
- [ ] **P3** (Claude) a button can ask for confirmation before it runs, for an action that clears cells or sends email

## Controls, mobile use, and templates

- [x] rebrand the app as "rowz" instead of "Spreadsheet". don't change package names but just update the UI. make the name configurable via an env var as well so it's easy to update in the future.
- [x] update the page title to show the name of the spreadsheet being edited or, for the help page, "Help". include the app name `rowz` at the end - e.g. `Help | rowz` or `My budget | rowz`
- [ ] remove awkward or unnecessary agent-written wording from the UI and help text
  - [ ] remove "Select a cell to insert or delete its row or column." from the table view - that functionality is obvious
  - [ ] replace Claudeslop phrasing like "what it holds"
  - [ ] revise "row of this column" help text in autocomplete
  - [ ] revise "Write the one meant" in `workbook.ts`
- [x] make errors highly visible throughout the document
  - [x] show a button in the editor header whenever the document has errors, like the failing-assertions indicator; open a popup listing all errors with links to their locations
  - [x] show a warning triangle on blocks and pages that contain errors
  - [x] show a warning triangle on documents that contain errors in the document list
- [ ] (Claude) say "document" instead of "spreadsheet" in the UI and help page, as the README does
- [x] mobile friendly UI (layout, touch targets, tap twice to edit)
- [ ] **P10** revamp the phone-width UI so it is less cramped. The editor header is the tightest part: it holds the back arrow, the spreadsheet's name, the saving indicator, Share, History, Export, and Help on one line.
- [ ] allow checkboxes, inputs, and other controls to target a named range; require the target to contain exactly one cell
- [ ] more controls:
  - [ ] **P3** a text or number input bound to a cell (esp. useful in Markdown)
  - [ ] **P8** a date picker
  - [ ] **P8** a time picker
  - [ ] **P8** a combined date and time picker
  - [ ] **P8** a slider input for picking a value from a range
  - [ ] **P8** a numeric value input roughly like (don't use this as a literal template; make it nicer) "<button>-</button> <input value="100"> <button>+</button>" where you can increment and decrement the value using the -/+ buttons (but also still support editing the number directly)
- [ ] **P6** cell validation - require the value to match a pattern, regex, or custom formula
- [ ] **P6** touch: select a range, fill by dragging, and a long-press menu on Android+iOS
- [ ] add an in-app samples and templates gallery; selecting an example copies it into the user's account
- [ ] allow users to create and reuse their own document templates
- [ ] generate example documents with multiple pages
- build reference documents in rowz as far as its features allow, at the end of each theme
  - [x] **P1** a [monthly budget example](docs/reference/monthly-budget.json): a data table of inflows and outflows, each with a category and an account, and reports of the month's amounts grouped by category and by account
    - (Codex) `_scratch/google-sheets` was absent from this checkout, so the example uses representative October transactions instead of source-sheet data.
  - [x] a comparison of high-payout races in Gran Turismo 7, after https://docs.google.com/spreadsheets/d/1rZxgfay0Gjq7MuSmOkioZC4srW5yerPfiYR0XAXcE3c ([sample](samples/gt7-grind-comparison.json))
    - (Claude) the source sheet could not be read: the Google Drive read was denied and `_scratch/google-sheets-exported-to-xlsx` is absent from this checkout. The races, payouts, and durations are representative, and the columns follow `plans/data-tables.md`. Compare it with the real sheet and replace the data.
    - (Claude) `Runs[Race]` written on another page than the table is `#REF!`, though `QUERY(Runs, ...)` with the bare name works. A column reference needs the page, as in `Data!Runs[Race]`. Decide whether a unique bare table name should work as the table of a column reference too.
    - [ ] (Claude) `QUERY ... pivot Duration` writes the pivoted numbers as text headers (`"6"`, not `6`), so a header cannot be compared as a number.
    - (Claude) each run is entered by hand with a race picked from the dropdown, so one race at one duration appears once. A way to build the grid of every race at every duration from `Races` would remove the hand-entered rows.
  - [ ] **P3** a video game quest tracker, after https://docs.google.com/spreadsheets/d/1cwsRONdpXMJAvjpamauZ391NrTXX1gEdeTrx1Rf324o
  - [ ] **P4** a few standard templates in the style of Sheets and Excel (invoice, contacts list, to-do list), and one or two in the style of Access and FileMaker
  - [ ] **P10** revise/augment the samples after we've added formatting, conditional formatting, etc.
- [x] add screenshots to the README
- [ ] use icons to make the toolbar denser
- [ ] **P5** plan to add keyboard shortcuts
- [ ] **P4** identify where we should use in-app modals instead of browser-based `input` and alerts -- we have specific tasks for a couple of these already so this would just cover identifying anything I missed
- [ ] allow renaming, deleting, and duplicating docs from the docs list view 

## Import and export

- [x] import and export (to files on disk): a JSON file for a whole spreadsheet, and CSV for a table
- [ ] (Claude) import from .xlsx
- [ ] CSV export - two modes: rowz-compatible and data export (selected from a dropdown on the "Export CSV" button)
  - [ ] rowz-compatible: keep verbatim formulas (so the user can reupload it and have their rowz behavior stay the same).
  - [ ] data export: the output is an export that has all calculations materialized so it can be used with any tool that supports reading CSVs
- [ ] CSV import - support appending to a data table instead of replacing it

## Undo and collaboration

- [x] undo that survives structural changes (insert or delete a row, rename), and undo of formatting (I'm inclined to tie this into verison history -author)
- [ ] **P9** named versions
- [x] (Claude) undo and redo (persistent version history): the server keeps versions, and History restores one or opens a copy
- [x] (Claude) Ctrl+Z and Ctrl+Y for single edits within a session
- [ ] (Claude) store versions compressed or as differences if large spreadsheets make them costly
- [x] (Claude) live sync between sessions: open sessions re-read the spreadsheet when another changes it
- [ ] **P10** show who else has a spreadsheet open
- [x] **P1** saves, button clicks, and checkbox/dropdown changes name their row and column by persistent IDs, so intervening inserts cannot redirect them
- [x] **P2** (Claude) send workbook-store mutations, including undo and redo, through one ordered queue. Requests enter it when the person acts; formatting, renames, and deletes wait for earlier saves. Version restoration uses the same queue
- [x] (Claude) route version restoration through the workbook mutation queue and save indicator
- [ ] (Claude) comments on cells

## Accounts and email

- [x] (Claude) sharing UI: share a spreadsheet with another account as editor or viewer
- [x] (Claude) email verification at sign-up, switched on with `REQUIRE_EMAIL_VERIFICATION`
- [x] (Claude) real email delivery behind the `Mailer` interface (set `SMTP_URL`)
- [ ] **P10** (Claude) invitations for people without an account, password reset, and resending a confirmation link
- [ ] **P6** allow users to create folders to organize their sheets

## API and agent tools

- [ ] provide a documented API for creating, reading, and editing documents, with an API explorer
- [ ] create a CLI tool and a skill for AI agents to create and work with rowz documents; document key features and when they are useful so agents use them effectively

## Server, performance, and reliability

- [ ] investigate whether the previously flaky Postgres test still fails; identify the test and reproduce the failure before deciding on a fix
- [ ] replace UUIDs in document URLs with shorter unique IDs, targeting 14 characters from a URL-safe alphabet such as `[A-Za-z0-9._-]`
  - That alphabet has 65 characters, so 14 characters allow about 24 septillion values. Example: `2WRhRE4C3O.EaQ` instead of `277690de-bc98-4310-9a84-ab5f27a02086`.

- [x] (Claude) production build of the web app, served by the server
- [ ] (Claude) cache a range's values across the formulas that read the same range. Each formula reads every cell of its range again when it is recalculated, so 50,000 formulas that each read a 1,000-row column take about 10 s after one edit in that column: 50 million cell reads. 1,000 such formulas take about 0.2 s, so this matters only at the extreme. The cache needs invalidation inside the evaluator: a cached range is stale once any cell in it changes, including a cell an array result fills or gives up.
- [ ] (Claude) index the ranges of a column by row in the dependency index. `transitiveDependents` in [graph.ts](packages/engine/src/graph.ts) scans every range that crosses a cell's column for each cell it reaches, so one edit costs the number of cells reached times the number of ranges in their columns. Deferred because the size limits keep it small: a table has at most 1,000 rows, so a chain down one column costs about 12 ms, and the worst case that fits in a spreadsheet (1,000 cells reached in a column that 99,000 ranges cross) is estimated at 1 s. Do it before raising `tableRows`: at 20,000 rows one edit measured 4.7 s, and the time grows with the square of the row count
- [x] (Claude) code review of 2026-10-01 (`_scratch/2026-10-01-codex-review.md`): all 20 findings addressed, see AGENT_DECISIONS.md
- [x] (Claude) run `pnpm e2e` and the server tests against Postgres (`TEST_DATABASE_URL`) after the review fixes: neither runs in the sandbox
  - (author) e2e run and full CI run are passing as of `87b20ea`
- [x] (Claude) make the tests that guard a design rule find what they guard. `access.test.ts` and `undo.test.ts` ran over lists of routes written by hand, so a new route that nobody added passed both, and the stream at `/spreadsheets/:id/events` was missing from `access.test.ts`. Each now compares what it covers with the routes the app registers and fails for one that is left out
- [ ] **P5** (Claude) a lint rule that keeps `packages/engine` free of imports from outside it and of Node and browser globals. Its `package.json` has no dependencies, and nothing fails if one is added

## Before sharing with others

These items harden rowz for several users, hostile input, or a deployed server. They are parked while one person uses rowz on their own machine. Review findings of that kind go here.

- [ ] **P10** (Claude) `personalWorkspace()` in [spreadsheets.ts](apps/server/src/repo/spreadsheets.ts) puts a new spreadsheet, an import, and a copy into the caller's oldest workspace membership whatever the role. Once a user can belong to a shared workspace, a new spreadsheet or "Save a copy" can land in a workspace that other members read, and the caller may not own it. Choose a workspace where the caller is an owner, or one made for the caller.

- [ ] **P10** (Claude) The capacity the growth menu offers can be stale while an insert is pending. [TableCard.vue](apps/web/src/components/TableCard.vue) computes it from table records that update only when the server answers. With five spreadsheet rows left, choose "Add 5 rows", reopen the menu before the response arrives, and choose it again: the second request is rejected by the server.

- [ ] **P10** (Claude) A stale tab can insert a block at the wrong place. The insert-block requests send only a numeric index ([AddBlockRow.vue](apps/web/src/components/AddBlockRow.vue)), and the server checks it against the current block count, not against the order the client saw. With two tabs showing `[A, B]`, one inserts `X` at the top, and the stale tab then inserts at index 1: the block lands before `A` in `[X, A, B]`. Send the ID of the block to insert before (or after) instead.

- [ ] **P10** (Claude) Give one evaluation a budget, which covers the two items below. `EvaluationContext` in [evaluate.ts](packages/engine/src/evaluate.ts) carries a mutable allowance of cells read, cells made, characters of text made, and steps (calls of a `LAMBDA`, rows of a `QUERY`, effects planned). The helpers in `arguments.ts`, `QUERY`, the template engine, and action planning charge it, and a formula that runs out is an error in its cell. The server evaluates a whole document when a button is clicked, in the one Node process and under the document's lock, so without this one formula can stall every user.
  - The rule in `CLAUDE.md` that `limitCells` "bounds the memory a formula can ask for" is true of one array only. Reword it when the budget exists.
- [ ] **P10** (Claude) One formula can hold many arrays in memory at once. `limitCells` in [arguments.ts](packages/engine/src/functions/arguments.ts) caps each array at 100,000 cells, and nothing caps their total. `=SUM(SEQUENCE(100000), SEQUENCE(100000), …)` fits roughly 600 such arguments in one 8,192-character cell, about 60 million cells alive together. Carry a cell allowance through one formula's evaluation and charge each array made against it.
- [ ] **P10** (Claude) Text has no length limit short of the JavaScript string limit. `REPT` and `&` can build text of hundreds of millions of characters, and every text function, including the wildcard matcher in [criteria.ts](packages/engine/src/functions/criteria.ts), takes time in proportion to it. Cap the length of text a formula can make.
- [ ] **P10** a limit on the length of text a formula builds: `REPT("x", 5e8)` is under JavaScript's string limit and still takes half a gigabyte, on the server too when a button runs
  - (Claude) the evaluation budget in this section covers this
- [ ] **P10** (Claude) evaluate a click's document off the main thread, with a time limit. `runCell` builds and computes the whole workbook in the request handler, which stops the one Node process from answering anyone else until it finishes. The evaluation budget in this section bounds the work; a worker thread is what can stop a formula that is already running
- [ ] **P10** (Claude) Reproduce: two failed saves to one cell may leave a value on screen that the server never held. A1 holds `old`. Type `two`, then `three` before the first save is answered, and have both saves fail. The first failure leaves the cell alone because it now holds `three`. The second restores its `previous`, which is `two`. The reviewer read this in `setCell` and its rollback in the workbook store. Nobody has run it.
- [ ] **P10** (Claude) send email from an outbox. `runCell` in [run.ts](apps/server/src/actions/run.ts) commits the cell writes and then sends, so a server that stops in between leaves the run `pending` and the email unsent, and clicking again repeats the cell writes. Store each message with the run in the same transaction and have a sender deliver and retry it
- [ ] **P10** (Claude) a click names the run it is, so a click sent twice runs once
- [ ] a limit on the recipients of one `SEND_EMAIL`, separate from the hourly limit
- [ ] **P10** (Claude) refuse to start in production on development defaults. With `NODE_ENV=production`, [config.ts](apps/server/src/config.ts) requires `AUTH_SECRET` but falls back to PGlite under `.data/` for `DATABASE_URL` and to `http://localhost:5173` for `BASE_URL`. Require both
- [ ] **P10** (Claude) require a confirmed email address before an account can send email. `REQUIRE_EMAIL_VERIFICATION` is off by default, so on an instance with `SMTP_URL` set anyone can sign up and send 50 emails an hour to any address. Either turn verification on whenever `SMTP_URL` is set, or refuse `SEND_EMAIL` from an unconfirmed account. Also add a limit on email for the whole instance
- [ ] **P10** limits on per-block and overall document size (make sure to enforce on upload as well) to avoid gigantic docs
- [ ] **P10** narrow stale-formula refusals to structural changes in the tables a formula references before several people edit one spreadsheet regularly
- [ ] (Claude) a compiled server build and a Dockerfile, verified by building and running it
- [ ] (Claude) several server processes: the change feed is in memory (Postgres LISTEN/NOTIFY would do)
- [ ] (Claude) trusted proxy configuration for better-auth's rate limiting, as a config variable

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

- **P999** user-defined macros so you could create your own syntax -- hypothetical use case with made-up syntax (so I'm not wedded to it looking like this): `SWITCHON(x, [A]*[B]/[C])(x > 1000, "foo", x > 100, "bar", x > 0, "baz", default="nope!")` which could possibly be defined something like, uh... idk what the macro definition syntax should actually be but somehow that would get munged into `LET(x, [A]*[B]/[C], IFS(x > 1000, "foo", x > 100, "bar", x > 0, "baz", default="nope!"))`

- (Claude) protected ranges: cells that only some people may change
- (Claude) a layout for printing
- (Claude) export to .xlsx
- (Claude) numbers and dates shown in the reader's locale

- allow table cells to contain structs/arrays/nested tables

- [ ] `ContextMenu.vue` moves focus to the menu only on mount. If the focused item becomes disabled while the menu stays open (for example another tab uses the last row capacity), focus can leave the menu and Escape stops working. Keep focus on the menu when its focused item is disabled, and test it.

- [ ] Add tests for `BASE64DECODE` with malformed padding or trailing bits made of valid alphabet characters (`"A==="`, `"AA=A"`, `"AB=="`), and for `SLICE("abcdef", -4, -1)` (negative end index).

- [ ] The `SEQUENCE` help summary in `packages/engine/src/docs.ts` reads as if giving either start or step overrides both defaults. Say that start and step each default to 1.

- [ ] Add tests for `LOOKUP` and `XYLOOKUP` with empty search ranges, empty or single-row `XYLOOKUP` ranges, and mismatched key types.
