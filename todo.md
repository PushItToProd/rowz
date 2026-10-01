These items are not necessarily in priority order. Triage and prioritize smaller, higher-value items before implementing bigger, more complex items.

Itmes added by AI agents should be prefixed `(Claude)`, `(GPT)`, etc. The author will remove the prefix if they fully endorse the idea, though agents asked to act autonomously should not consider these markers as prohibitions on implementation.

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
- [ ] named functions and values at the workbook level, so `=double(5)` works instead of `=D1(5)`
- [ ] functions that expect one value (IF, UPPER, ...) do not work cell by cell on a range; only operators do. MAP is the workaround. Related: `=UPPER(A:A)` could mean this row's cell, as `=A:A & ""` now does
- [ ] regex functions (`REGEXMATCH`, `REGEXEXTRACT`, `REGEXREPLACE`) on a regex engine with a time bound
- [ ] (Claude) the smaller candidates left in docs/rows-functions.md
- [ ] (Claude) `TEXT` writes a number of 1e21 or more as `1e+21` followed by the format's decimals
- [ ] (Claude) the web app's fill and chart axis build dates without `dateFromMs`, so they skip the year 0 to 9999 check

## Grid editing and navigation

- [x] allow deleting rows and columns in tables (also inserting)
- [x] up and down arrow keys should move up and down rows when in input mode
- [x] support dragging and bulk applying formulas (range selection, fill handle, Ctrl+D/R, copy/cut/paste)
- [x] add context menus for actions like inserting/deleting rows/columns
- [x] (Claude) filling a number or date series: `1, 2` filled down should continue `3, 4`
- [x] (Claude) select whole rows and columns by clicking their headers, and Ctrl+A
- [ ] dragging over col/row headers should select multiple columns/rows
- [ ] when a row/col is inserted into a range used in a formula, the formula's range should be expanded.
  - e.g. if we have A1 = 1, A2 = 2, A3 = 3, A4 = `SUM(A1:A3)` and the user right clicks and inserts a row above or below A2, the range should be updated to `A1:A4`
- [ ] allow adding rows/cols with a long thin "+" button along the full width/height of the bottom/right side of the table
- [ ] resizable rows/cols
- [ ] when multiple cells/cols/rows are selected, allow deleting the columns or rows containing them from the context menu
- [ ] merge cells across selection

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
- [ ] (Claude) move a table, chart, or text view to another page, and reorder pages
- [ ] chart formulas
  - [ ] `SPARKLINE` for a single cell
  - [ ] `PIE_CHART`, `LINE_CHART`, etc. which produce charts that spill over multiple rows and columns (size defined by the user or maybe implemented via merging cells)
- [ ] (Claude) chart options: axis titles, stacked bars, colors
- [ ] allow editing markdown views by just clicking on the text and save/stop editing when focus is lost instead of requiring user to hit "Done"
- [ ] duplicate the "Add table", "Add chart", "Add text" buttons at the top and between each item so you can insert them anywhere

## Formatting

- [x] cell formatting (bold, italic, alignment, colors, number formats)
- [x] formula to render Markdown in cell (`MARKDOWN(text)`; inline formatting only, since a cell is one line)
- [x] (Claude) number formatting for cells (text views and formulas can use `TEXT(value, format)`)
- [ ] (Claude) more formatting: column widths, borders, conditional formats, and carrying formats through copy, fill, and paste

## Actions and automation

- [ ] more actions:
  - [ ] delete a row that matches a condition
  - [ ] open a URL
  - [ ] call a webhook
- [ ] (Claude) scheduled actions: Rows' `SCHEDULE`, `REPEAT`, `REFRESH`. Needs a server scheduler and a rule for whose permissions a scheduled run uses
- [ ] (Claude) a `BUTTON` in a text view shows only its label; it could run if views had a click endpoint
- [ ] (Claude) a limit on the recipients of one `SEND_EMAIL`, separate from the hourly limit

## Controls, mobile use, and templates

- [x] mobile friendly UI (layout, touch targets, tap twice to edit)
- [ ] more controls:
  - [ ] a text or number input bound to a cell (esp. useful in Markdown)
  - [ ] a date picker (after dates exist)
  - [ ] a slider
- [ ] cell validation - require matching a pattern, regex, or custom formula
- [ ] (Claude) touch: select a range, fill by dragging, and a long-press menu on iOS
- [ ] create some sample/template sheets users can use - invoice, contacts list, to-do list, personal monthly budget, etc.
- [x] add screenshots to the README

## Import and export

- [x] import and export (to files on disk): a JSON file for a whole spreadsheet, and CSV for a table
- [ ] (Claude) import from .xlsx, and CSV export with a formula-injection guard as an option

## Undo and collaboration

- [ ] undo that survives structural changes (insert or delete a row, rename), and undo of formatting
- [x] (Claude) undo and redo (persistent version history): the server keeps versions, and History restores one or opens a copy
- [x] (Claude) Ctrl+Z and Ctrl+Y for single edits within a session
- [ ] (Claude) store versions compressed or as differences if large spreadsheets make them costly
- [x] (Claude) live sync between sessions: open sessions re-read the spreadsheet when another changes it
- [ ] (Claude) send the changed cells with a change event, so sessions need not re-read the whole spreadsheet; show who else has it open
- [ ] a save names a cell by row and column, so one that crosses another person's row or column insert lands on the wrong cell. Needs the client to send the table version it saw

## Accounts and email

- [x] (Claude) sharing UI: share a spreadsheet with another account as editor or viewer
- [x] (Claude) email verification at sign-up, switched on with `REQUIRE_EMAIL_VERIFICATION`
- [x] (Claude) real email delivery behind the `Mailer` interface (set `SMTP_URL`)
- [ ] (Claude) invitations for people without an account, password reset, and resending a confirmation link

## Server, performance, and reliability

- [x] (Claude) production build of the web app, served by the server
- [ ] (Claude) a compiled server build and a Dockerfile, verified by building and running it
- [ ] (Claude) several server processes: the change feed is in memory (Postgres LISTEN/NOTIFY would do)
- [ ] (Claude) trusted proxy configuration for better-auth's rate limiting, as a config variable
- [ ] (Claude) a large table re-writes every moved cell on a row or column insert/delete; shift in SQL if this gets slow
- [x] (Claude) code review of 2026-10-01 (`_scratch/2026-10-01-codex-review.md`): all 20 findings addressed, see DECISIONS.md
- [ ] (Claude) run `pnpm e2e` and the server tests against Postgres (`TEST_DATABASE_URL`) after the review fixes: neither runs in the sandbox
- [ ] (Claude) a limit on the length of text a formula builds: `REPT("x", 5e8)` is under JavaScript's string limit and still takes half a gigabyte, on the server too when a button runs
