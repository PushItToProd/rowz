These items are not necessarily in priority order. Triage and prioritize smaller, higher-value items before implementing bigger, more complex items.

Itmes added by AI agents should be prefixed `(Claude)`, `(GPT)`, etc. The author will remove the prefix if they fully endorse the idea, though agents asked to act autonomously should not consider these markers as prohibitions on implementation.

Items prefixed "P0", "P1", "P2", "P3", etc. are the author's prioritized actions. When instructed to work autonomously, execute these items first in ascending order (do all P0s first, then P1s, etc.). Items with the same priority are co-equal unless you're instructed otherwise. Items with priority "P10" and above are backlogged and generally shouldn't be picked up unless the author says so explicitly (this is primarily about allocation of work and the author's perceived necessity of the feature). Remove these priority prefixes when checking items off. Check these items off before making commits.

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
- [ ] **P2** named functions and values at the workbook level, so `=double(5)` works instead of `=D1(5)`
- [ ] functions that expect one value (IF, UPPER, ...) do not work cell by cell on a range; only operators do. MAP is the workaround. 
  - [ ] Related: `=UPPER(A:A)` could mean this row's cell, as `=A:A & ""` now does. -- that is, if e.g. D2 = `=UPPER(A:A)`, it should be equivalent to `=UPPER(A2)`
- [ ] **P4** `MAP` doesn't take built-in function names as args - `MAP(A:A, UPPER)` should work but right now it errors with `#NAME?`
- [ ] **P3** regex functions (`REGEXMATCH`, `REGEXEXTRACT`, `REGEXREPLACE`) on a regex engine with a time bound
- [ ] **P3** `TEXT` writes a number of 1e21 or more as `1e+21` followed by the format's decimals
- [ ] **P4** the web app's fill and chart axis build dates without `dateFromMs`, so they skip the year 0 to 9999 check.
- [ ] **P99** user-defined formula functions, evaluated client-side in a sandbox (maybe something like QuickJS or Pyodide)
- [ ] **P4** support better operators: `&&`/`||`/`!` (or, even better, `and`/`or`/`not`) for boolean operations, `!=` in addition to `<>`, TTT
- [x] make the help page's navigation sticky so it stays visible as the user scrolls. update it to reflect the section they're currently looking at, too (e.g. by making the currently visible section bold)
- [ ] **P5** add `start` and `step` args to `SEQUENCE`

### Additional formula functions

- [/] (Claude) for the author: review the smaller candidates left in docs/rows-functions.md and determine which to include
- [ ] **P4** the reference functions `OFFSET`, `INDIRECT`, `ADDRESS`, `ISFORMULA`, `ISREF`
- [ ] **P5** random numbers
- [ ] **P4** date helpers except for `TO_TIMEZONE` since we don't use time zones here
- [ ] **P6** other text - `SLICE`, `SLUGIFY`, `DECODEURL`, `BASE64`, `BASE64DECODE`, `DOMAIN`, `RELATIVE_URL`
- [ ] **P3** `LOOKUP`, `HLOOKUP`, `XYLOOKUP` (skip `FLOOKUP` for now)
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

- [ ] **P3** implement the handy tab+enter workflow from Excel and Sheets -- if you select a certain cell with the mouse or arrow keys, use tab to traverse multiple cells (optionally entering values into any or none of them), then input a value into a cell and submit that value by hitting enter, it'll drop to the next row in the column where you started
  - example: in a table, select C3. hit tab 3 times (optionally entering values in any cells in C3:E3 along the way) - now you're in F3. hit enter to focus the cell input (or just start typing), type anything (or nothing), and hit enter to submit. the selection should move to C4.

- [x] add a long thin "+" button along the full width/height of the bottom/right side of each table for adding rows/cols. this way I can just click anywhere along the range
- [x] support resizing a whole table by just setting its width and height in cols/rows (warn the user and show a confirmation prompt if resizing will delete data)
- [x] dragging over col/row headers should select multiple full columns/rows
- [x] when multiple rows/columns are selected (either via row/col selection or by selecting specific cells), the context menu's "insert [row/column]" actions should become "insert N [rows/columns]", where `N` is the number of selected rows and cols as appropriate
  - if I select C:E using the column headers and right click, I should see "Insert 3 columns left" and "Insert 3 columns right"
- [x] don't show "Insert row" actions in a column header's context menu and don't show "Insert column" actions in a row header's context menu
- [ ] **P1** when a row/col is inserted into a range used in a formula, the formula's range should be auto-updated to include the range.
  - e.g. if we have A1 = 1, A2 = 2, A3 = 3, A4 = `SUM(A1:A3)` and the user right clicks and inserts a row above or below A2, the range should be updated to `A1:A4`
- [ ] **P3** allow resizing rows/cols
  - [ ] by clicking and dragging on the borders of the row/col headers
  - [ ] by a "resize [row/column]" ctx menu item shown when right clicking on row/col headers
- [x] when multiple cells/cols/rows are selected, allow deleting the columns or rows containing them from the context menu
  - [x] if I select C:E, give me a "Delete columns C-E" option. likewise for rows.
  - [x] if I select C3:E6 and right click on the selected range, show me both "Delete columns C-E" and "Delete rows 3-6"
- [ ] **P4** merge cells across selection - support merging multiple cells across one or more rows and one or more columns

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
- [ ] data tables: sort and filter in place, dropdown columns, hide the empty rows, and `QUERY(Sales, ...)` over a whole table with its column names as headers
- [ ] (Claude) replace the browser prompt used for a formula column's first formula with an in-page editor
- [ ] **P2** move a table, chart, or text view to another page, and reorder pages
- [ ] support chart formulas in tables
  - [ ] **P3** `SPARKLINE` for a single cell
  - [ ] **P5** `PIE_CHART`, `LINE_CHART`, etc. (implement after merging cells is done so the user can merge however many cells they want to show this)
- [ ] **P5** chart options: 
  - [ ] axis titles
  - [ ] stacked bars
  - [ ] colors
- [ ] **P10** show labels on charts on hover
- [x] allow editing markdown views by just double clicking on the text (instead of clicking "Edit"). save and exit edit mode when the user unfocuses the input (instead of requiring user to hit "Done") (keep the "Edit" and "Done" buttons for user convenience)
- [ ] **P2** duplicate the "Add table", "Add chart", "Add text" buttons at the top and between each item so you can insert them anywhere
- [ ] **P3** add a new type of block (in addition to tables, charts, and text): a row, which can itself contain one or more table/chart/text components laid out side-by-side
- [x] **P2** update user-facing docs to use "Block" nomenclature for tables/charts/text/etc.

## Formatting

- [x] cell formatting (bold, italic, alignment, colors, number formats)
- [x] formula to render Markdown in cell (`MARKDOWN(text)`; inline formatting only, since a cell is one line)
- [x] (Claude) number formatting for cells (text views and formulas can use `TEXT(value, format)`)
- [ ] more formatting: 
  - [ ] **P5** borders
  - [ ] **P6** conditional formats
  - [ ] **P5** carrying formats through copy, fill, and paste

## Actions and automation

- [ ] more actions:
  - [ ] **P5** delete a row that matches a condition
  - [ ] **P5** targeted update of rows matching a condition as an alternative to the full replacement
    - [ ] **P99** typed (or at least column-name-aware) updates of data tables: s.t. like `MUTATE(Products, [Category] = "GPU", [Price] = [Price] * 2)` (i.e. double the value of `Price` for all rows in `Products` where `Category` == "GPU")
  - [ ] open a URL
  - [ ] call a webhook
- [ ] (Claude) scheduled actions: Rows' `SCHEDULE`, `REPEAT`, `REFRESH`. Needs a server scheduler and a rule for whose permissions a scheduled run uses
- [ ] **P2** a `BUTTON` in a text view shows only its label; it could run if views had a click endpoint
- [ ] a limit on the recipients of one `SEND_EMAIL`, separate from the hourly limit

## Controls, mobile use, and templates

- [x] rebrand the app as "rowz" instead of "Spreadsheet". don't change package names but just update the UI. make the name configurable via an env var as well so it's easy to update in the future.
- [x] update the page title to show the name of the spreadsheet being edited or, for the help page, "Help". include the app name `rowz` at the end - e.g. `Help | rowz` or `My budget | rowz`
- [x] mobile friendly UI (layout, touch targets, tap twice to edit)
- [ ] more controls:
  - [ ] **P2** a text or number input bound to a cell (esp. useful in Markdown)
  - [ ] **P3** a date picker
  - [ ] **P3** a time picker
  - [ ] **P3** a combined date and time picker
  - [ ] **P3** a slider input for picking a value from a range
  - [ ] **P4** a numeric value input roughly like (don't use this as a literal template; make it nicer) "<button>-</button> <input value="100"> <button>+</button>" where you can increment and decrement the value using the -/+ buttons (but also still support editing the number directly)
- [ ] **P7** cell validation - require the value to match a pattern, regex, or custom formula
- [ ] **P4** touch: select a range, fill by dragging, and a long-press menu on Android+iOS
- [ ] **P2** create some sample/template sheets users can use - invoice, contacts list, to-do list, personal monthly budget, etc.
  - [ ] **P10** revise/augment the samples after we've added formatting, conditional formatting, etc.
- [x] add screenshots to the README

## Import and export

- [x] import and export (to files on disk): a JSON file for a whole spreadsheet, and CSV for a table
- [ ] (Claude) import from .xlsx
- [ ] CSV export - two modes: rowz-compatible and data export (selected from a dropdown on the "Export CSV" button)
  - [ ] rowz-compatible: keep verbatim formulas (so the user can reupload it and have their rowz behavior stay the same).
  - [ ] data export: the output is an export that has all calculations materialized so it can be used with any tool that supports reading CSVs

## Undo and collaboration

- [ ] **P0** undo that survives structural changes (insert or delete a row, rename), and undo of formatting (I'm inclined to tie this into verison history -author)
- [ ] **P8** named versions
- [x] (Claude) undo and redo (persistent version history): the server keeps versions, and History restores one or opens a copy
- [x] (Claude) Ctrl+Z and Ctrl+Y for single edits within a session
- [ ] (Claude) store versions compressed or as differences if large spreadsheets make them costly
- [x] (Claude) live sync between sessions: open sessions re-read the spreadsheet when another changes it
- [ ] **P3** send the changed cells with a change event, so sessions need not re-read the whole spreadsheet; show who else has it open
- [ ] **P3** a save names a cell by row and column, so one that crosses another person's row or column insert lands on the wrong cell. Needs the client to send the table version it saw

## Accounts and email

- [x] (Claude) sharing UI: share a spreadsheet with another account as editor or viewer
- [x] (Claude) email verification at sign-up, switched on with `REQUIRE_EMAIL_VERIFICATION`
- [x] (Claude) real email delivery behind the `Mailer` interface (set `SMTP_URL`)
- [ ] (Claude) invitations for people without an account, password reset, and resending a confirmation link
- [ ] **P4** allow users to create folders to organize their sheets

## Server, performance, and reliability

- [x] (Claude) production build of the web app, served by the server
- [ ] (Claude) a compiled server build and a Dockerfile, verified by building and running it
- [ ] (Claude) several server processes: the change feed is in memory (Postgres LISTEN/NOTIFY would do)
- [ ] (Claude) trusted proxy configuration for better-auth's rate limiting, as a config variable
- [ ] (Claude) a large table re-writes every moved cell on a row or column insert/delete; shift in SQL if this gets slow
- [x] (Claude) code review of 2026-10-01 (`_scratch/2026-10-01-codex-review.md`): all 20 findings addressed, see DECISIONS.md
- [x] (Claude) run `pnpm e2e` and the server tests against Postgres (`TEST_DATABASE_URL`) after the review fixes: neither runs in the sandbox
  - (author) e2e run and full CI run are passing as of `87b20ea`
- [ ] **P3** a limit on the length of text a formula builds: `REPT("x", 5e8)` is under JavaScript's string limit and still takes half a gigabyte, on the server too when a button runs
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
