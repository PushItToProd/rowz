# rowz

rowz is a web app for building pages out of blocks. A block is a table, a chart, or a text view, and spreadsheet formulas connect them. A table is a spreadsheet grid. A chart or a text view shows what its formulas compute from the tables. A formula can also describe a side effect, such as writing to a cell or sending an email, that runs when someone clicks a button.

![A page holding a table with named columns, a bar chart of it, and a text view that reports on it](docs/screenshots/editor.png)

## Why it exists

rowz is a proof of concept of the spreadsheet app I have wanted for years. Its ideas come from Excel, Google Sheets, Apple Numbers, rows.com, Notion, and Vue, among others. Most of them already exist somewhere. I have not seen them combined in a way I like.

## Status

rowz is vibecoded in my spare time. AI coding agents, mostly Claude with some Codex, wrote nearly all of the code, much of it without my supervision. I skim some of the changes. Otherwise I rely on the tests and on reviews of the code by other models.

Expect bugs and breaking changes, and don't keep anything in it that you can't afford to lose. [What's missing](#whats-missing) lists the largest gaps.

## How it differs from a traditional spreadsheet

- **Errors stay visible.** Error visibility is a core product principle. A header indicator lists errors across the entire document and links to their locations, including other pages and filtered-out rows. Warning triangles mark affected blocks, pages, and documents in the document list. Cell errors explain themselves in a popover, which can resize a table when its dimensions prevent an array result from spilling. Errors should never disappear into a remote corner of a document.
- **A page holds blocks.** A traditional sheet is one unbounded grid with charts and text boxes floating over it. A rowz page is a stack of blocks in an order you choose.
- **Each table is its own grid.** Every table has its own cell A1 and only the rows and columns it was given. A formula reads another table by name: `Orders!A1`, or `'Page 1'!Orders!A1` from another page.
- **Columns can have names and types.** `[Price]` is the cell of the Price column in the formula's own row. A formula column computes one formula in every row.
- **Text computes.** A text view is a Markdown template whose tags hold formulas, with loops and conditions, so a report is written as prose and not laid out in cells.
- **A chart's data is a formula.** A chart is a block that draws whatever its formula returns. It is not anchored to cells of a grid.
- **A formula can describe a side effect.** `BUTTON`, `EXECUTE`, `SEND_EMAIL`, and the other action functions replace macros. Recalculation never runs an action. A click does, on the server, which keeps a record of it.
- **A cell can be an input.** `CHECKBOX`, `DROPDOWN`, `TEXTBOX`, and `NUMBERBOX` show a control that writes to another cell, so a table or text view can be a form.
- **A function can live in a cell.** A cell that holds a `LAMBDA` is called by its address: `=D1(21)`.

## What's missing

The aim is to do what a traditional spreadsheet does, and do it better. I build what I want from one first, so some of what follows may stay missing. [todo.md](todo.md) lists what is planned.

### Features of other spreadsheets

- **Layout:** merged cells, borders, wrapping text in a cell, hiding rows and columns, and freezing header rows.
- **Working with data:** a dedicated pivot-table editor, find and replace, and validation of what a cell accepts. Tables already support sorting, filtering, conditional formats, and `QUERY` pivot clauses.
- **Functions:** coverage follows what I use. Less common financial, statistical, and scientific functions are missing or lightly tested. There are no random numbers, and no `INDIRECT` or `OFFSET`.
- **Charts:** four kinds, with no axis titles, colors, or stacking.
- **Files:** rowz does not open or save Excel files. It has no layout for printing.
- **Dates:** there are no time zones, and numbers and dates are written one way whatever the reader's locale.
- **Working together:** edits made at the same moment are not merged. Open sessions see each other's changes within a second, and the last write to a cell wins. Saves, clicks, and control inputs follow their row and column IDs across insertions; a deleted row or column refuses the request. Formulas are saved exactly as submitted against the current document, even if its structure changed while they were being typed. There are no comments on cells and no protected ranges. A document can be shared only with someone who already has an account.
- **Size:** a document holds at most 100,000 filled cells and 100,000 rows across its tables.

### Known spreadsheet flaws

rowz has not fixed these.

- **Data and business logic are intermingled.** A table holds typed values and formulas side by side, and nothing marks which cells are which. Formula columns and text views move some formulas out of the cells.
- **Formulas cannot be tested.** There is no way to state what a formula should return and have that checked. History keeps versions of a document but does not show what changed between two of them.
- **Numbers are binary floating point.** `=0.1+0.2=0.3` is `FALSE`. There is no decimal type for money.
- **Typed text is converted by guesswork.** A cell typed as `2026-09-30` becomes a date. Outside a typed column, nothing says what a cell should hold.
- **A reference names a position.** `B2:B9` says nothing about what it reads. Named columns fix this only for tables that have them.
- **The whole document is computed at once.** The browser loads every cell of a document and recalculates it there.

## Quick start

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 and create an account. Development needs no database server: data is stored by PGlite, an in-process Postgres, under `apps/server/.data/`.

The Documents page lists documents you own and documents shared with you. Create flat folders to group the documents in your own list. Folders are private to your account, so moving a shared document changes only how it appears in your list. Deleting a folder returns its documents to the unfiled list without deleting them.

### Developing from another machine

To open the dev server from a second machine, put the URL that machine will use in `.env.local` at the repository root:

```sh
BASE_URL=https://devbox.example.com:5173
```

`pnpm dev` gives that file to both processes. The Vite dev server takes its port from the URL, listens on every interface, and accepts the URL's host name. The API server accepts sign-in requests from that origin alone, so http://localhost:5173 stops working while the setting is in place.

Use an `https` URL. The app calls `crypto.randomUUID`, which browsers provide over plain HTTP only on localhost. With an `https` URL the dev server presents a self-signed certificate, which the browser asks you to accept on the first visit.

## Pages and blocks

A document holds pages, and a page holds blocks: tables, charts, and text views. The arrows beside a block move it up or down the page.

### Tables

A table is a grid of cells with its own column letters and row numbers.

Drag a column header's right border to change its width, or a row header's bottom border to change its height. Double-click the border to reset its size. A header's context menu offers **Resize column** or **Resize row** with a size in pixels; it applies to all selected columns or rows. Sizes follow the rows and columns through structural edits, persist with the document, and support undo and redo.

A table can have named columns, which makes it a data table. `[Price]` is the cell of that column in the formula's own row, and `Sales[Price]` is the whole column of the table Sales. A column can be typed (text, number, date, checkbox), be a dropdown whose choices are a list or the values of a column of another data table, or be a formula column, which computes one formula in every stored row. A data table holds the rows added to it, including rows whose values were later cleared, and can have no rows. An empty line below its last row adds a row when you type into it. Naming columns removes trailing empty rows.

A data table can be sorted by several columns and filtered by one formula such as `=[Payout] > 60000`. Both are display settings stored on the table. The stored row order does not change, so `A2` and `SUM(Sales[Amount])` read the same cells under any sort or filter. While a table is sorted or filtered, a selection is a rectangle of the rows shown, and copy, clear, fill, paste, and delete act on those rows.

A unique table name by itself refers to all of its rows. `QUERY(Sales, "select Category, sum(Amount) group by Category")` uses a data table's column names as query headers. It also reads those names from ranges such as `Sales!A:C`. A plain table can also hold named values, functions, and ranges.

The toolbar under the formula bar gives the selected cells bold, italic, an alignment, a number format, a text color, or a fill color. Formats are stored per table as rules over ranges, so a whole column is one rule.

Conditional formats give cells a fill, a text color, or bold when their own value meets a `COUNTIF`-style criterion such as `>100`, or shade a range of numbers with a two-color scale. They are stored per table, follow rows and columns as they are inserted and deleted, and are laid over the plain formats.

Each table also exports to CSV (the values shown) and imports from CSV.

### Charts

A chart draws a range as bars, lines, a pie, or a scatter. Its data is a formula such as `Sales!A1:C9`. The first column labels the points and each other column is a series.

### Text views

A text view is Markdown with tags that put values from tables into it:

```
## Sales report

{% let total = SUM(Sales!B2:B) %}
We sold **{{ total }}** in all.

{% for name, amount in Sales!A2:B4 %}
- {{ name }}: {{ amount }}{% if amount > 100 %} (a big one){% end %}
{% end %}

{{ BAR_CHART(Sales!A2:B4, "Sales by person") }}
```

<img src="docs/screenshots/text-view.png" alt="A text view being edited, with its source above the result" width="407">

`{{ }}` shows one value in the sentence, a range as a table, and the result of `BAR_CHART`, `LINE_CHART`, `PIE_CHART`, or `SCATTER_CHART` as a chart. A failed formula appears as an error chip with its code and message. A formula in a chart or text view is written on a page and not in a table, so it names the table of every cell it reads.

A `BUTTON` result is clickable in a text view, including when a loop renders it more than once. For example, `{{ BUTTON("Approve", EXECUTE(TRUE, Sales!D2)) }}` shows an **Approve** button. The server re-evaluates the saved view when clicked and runs the action at that occurrence.

Formula inputs share completion and local undo history. Scripts and Markdown templates use multiline editors: Enter inserts a newline, Done or Ctrl/Cmd+Enter saves, and Cancel discards the draft. Escape dismisses completion without discarding multiline edits. Tab accepts a suggestion when one is open; otherwise it saves and moves focus. Formula drafts retain their history while browsing pages and appear in a labeled draft editor when their original field is unavailable.

At an unfinished operand, click a cell or drag a range to insert its reference. Use **Pick reference** to replace selected formula text or a reference under the caret. Further picks replace that insertion until typing or caret movement resumes. A drag creates one undo step; Escape cancels it. Picked positional addresses are relative. Named headers insert same-row columns in filters and formula-column definitions, and whole columns elsewhere. A drag through sorted or filtered rows must describe exactly one stored rectangle.

Direct references in the active formula, script statement, or template expression use matching colors in the source and grid outlines. Repeated references to the same cells share a color. Markdown prose and embedded formulas have separate syntax highlighting, including template tags inside code spans and fences.

### Names and scripts

A plain table or script can hold named formulas. A script is a block whose lines define names, functions, or checks:

```text
Total = SUM(Sales[Amount])
WithTax(amount) = amount * (1 + TaxRate)
ASSERT(Total >= 0, "Sales cannot be negative")
```

Formulas anywhere in the document can use `Total` or `Summary!Total`, and call `WithTax(A2)`. A table name by itself, such as `Sales`, returns the table's rows; `'Page 2'!Sales` returns a table on another page. A data table's rows carry their column names, so `QUERY(Sales, "select Category, sum(Amount) group by Category")` can use those names and returns them as headings.

A bare name must be unique across the document. If two names, two tables, or a name and table share a spelling, the bare word shows `#NAME?`. Give them distinct spellings or qualify each one by its holder. For example, if the February and March scripts each define `Total`, use `February!Total` and `March!Total`. A holder on another page can be named with three parts, as in `'Page 2'!Summary!Total`.

## Formulas

A cell whose input starts with `=` is a formula. A leading apostrophe forces text: `'=not a formula`.

The app has a help page at `/help` with the full reference. It lists every function with an example whose result the engine computes when the page loads.

![The function reference on the help page](docs/screenshots/help.png)

Typing a formula offers the functions and names that match, with what each function expects.

![The completion list under a cell that holds =SUMI](docs/screenshots/completion.png)

| Kind        | Supported                                                                                                                                                                                                                                                                                                                            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Operators   | `+ - * / ^`, `&` for joining text, `= <> != < > <= >=`                                                                                                                                                                                                                                                                               |
| References  | `A1`, `A1:B2`, `A:A`, `2:5`, `A2:A`, `$A$1`, `Table2!A1` for a table on the same page, `'Page 1'!'Table 2'!A1:B2` for a table on another page                                                                                                                                                                                        |
| Math        | `SUM AVERAGE MIN MAX CLAMP COUNT COUNTA PRODUCT MEDIAN SUBTOTAL SUMPRODUCT ROUND ROUNDUP ROUNDDOWN TRUNC MROUND FLOOR CEILING INT ABS SIGN SQRT POWER EXP LN LOG PI SIN COS TAN ASIN ACOS ATAN SINH COSH TANH DEGREES RADIANS MOD QUOTIENT EVEN ODD ISEVEN ISODD GCD LCM FACT COUNTIF COUNTIFS SUMIF SUMIFS AVERAGEIF MAXIFS MINIFS` |
| Statistics  | `MODE STDEV STDEVP VAR_S VAR_P PERCENTILE QUARTILE RANK CORREL COVARIANCE_S COVARIANCE_P SLOPE INTERCEPT FORECAST COUNTUNIQUE COUNTBLANK`                                                                                                                                                                                            |
| Financial   | `PMT FV PV NPER RATE NPV IRR`                                                                                                                                                                                                                                                                                                        |
| Logic       | `IF IFS SWITCH AND OR NOT IFERROR IFNA`                                                                                                                                                                                                                                                                                              |
| Lookup      | `LOOKUP VLOOKUP HLOOKUP XLOOKUP XYLOOKUP MATCH RANGE_CONTAINS INDEX ROW COLUMN`                                                                                                                                                                                                                                                      |
| Text        | `CONCATENATE CONCAT TEXTJOIN JOIN SPLIT LEN UPPER LOWER PROPER TRIM LEFT RIGHT MID FIND SEARCH REGEXMATCH REGEXEXTRACT REGEXREPLACE SUBSTITUTE REPT CHAR CODE ENCODEURL DECODEURL BASE64 BASE64DECODE DOMAIN RELATIVE_URL SLICE SLUGIFY VALUE TEXT FIXED MARKDOWN`                                                                   |
| Dates       | `TODAY NOW DATE TIME DATEVALUE YEARFRAC TIMEVALUE TO_DATE UNIXTIME UNIX2DATE LASTXDAYS LASTXWEEKS LASTXMONTHS DATEINTERVAL YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY WEEKNUM ISOWEEKNUM DAYS DATEDIF EDATE EOMONTH WORKDAY NETWORKDAYS`. A cell typed as `2026-09-30` is a date                                                      |
| Information | `ISBLANK ISNUMBER ISTEXT ISNONTEXT ISLOGICAL ISDATE ISERROR ISERR ISNA`                                                                                                                                                                                                                                                              |
| Arrays      | `FILTER FILTER_COLUMNS SORT UNIQUE SEQUENCE TRANSPOSE TAKE ARRAY_CONSTRAIN DROP HSTACK VSTACK FLATTEN ROWS COLUMNS MAP REDUCE BYROW BYCOL QUERY`. A result of several values fills the cells below and beside the formula                                                                                                            |
| Names       | `LET LAMBDA`. A function kept in a cell is called by the cell's address: `=D1(21)`                                                                                                                                                                                                                                                   |
| Errors      | `#DIV/0! #VALUE! #REF! #NAME? #N/A #SPILL! #CYCLE! #ERROR!`                                                                                                                                                                                                                                                                          |

`CLAMP(value, min, max)` is equivalent to `IFS(value < min, min, value > max, max, 1=1, value)`. It uses the comparison operators' type ordering and returns the selected input unchanged.

`REGEXMATCH(text, pattern)` checks for a match, `REGEXEXTRACT(text, pattern)` returns the first match (or first capture group), and `REGEXREPLACE(text, pattern, replacement)` replaces every non-overlapping match. Replacement text supports `$1` and later capture references, `$&` for the whole match, and `$$` for a literal dollar sign. Patterns support literals, `.`, character classes, common character escapes, word boundaries, `^` and `$`, capturing and noncapturing groups, alternation, and greedy or lazy `*`, `+`, `?`, and `{n,m}` quantifiers. Backreferences and lookaround are unsupported. Patterns are limited to 256 characters, replacements are limited to 2,000,000 output characters, and evaluation stops at a fixed step budget.

`SEQUENCE(rows, [columns], [start], [step])` fills a grid row by row. It defaults to a start and step of 1; the step can be negative or fractional.

`SUBTOTAL` codes 1–11 select AVERAGE, COUNT, COUNTA, MAX, MIN, PRODUCT, STDEV, STDEVP, SUM, VAR_S, and VAR_P. Codes 101–111 select the same functions; filtered and hidden rows still count because row visibility only changes the display.

`LAMBDA` makes a function value for `MAP`, `REDUCE`, `BYROW`, or `BYCOL`. These functions also accept a pure built-in function name: `MAP(B1:B3, UPPER)` applies `UPPER` to each cell, and `BYROW(A1:C3, SUM)` sums each row. A `LET` binding or a document name with that spelling takes precedence.

Page, table, and column names in references ignore case. Names with spaces need single quotes.

### Actions

An action is a function that describes a side effect. It does nothing until a button runs it.

```
=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))
=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3))
```

The first formula shows a button that writes the sum of A1 and A2 into A3. The second shows a button that sends an email built from three cells.

| Function                            | Effect                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `BUTTON(label, action)`             | Shows a button. Clicking it runs the action.                                                                                         |
| `EXECUTE(expression, target)`       | Writes the value of `expression` into the cell `target`.                                                                             |
| `SEND_EMAIL(to, subject, body, cc)` | Sends an email. `cc` is optional. `to` and `cc` take addresses separated by commas or semicolons                                     |
| `APPEND_ROW(range, value, ...)`     | Appends after the last stored row of a data table for an open-ended range; otherwise writes below the range's content                |
| `INSERT(data, range)`               | Appends each data row after the last stored row of a data table for an open-ended range; otherwise adds below the range's content    |
| `UPDATE(data, key_columns, range)`  | Writes each row of the data over the row of the range with the same key, and adds the rows with new keys                             |
| `OVERWRITE(data, range)`            | Empties the range and writes the data from its first row; deletes surplus data-table rows when the range covers all writable columns |
| `CLEAR(range)`                      | Empties the cells of the range.                                                                                                      |
| `DO(action, ...)`                   | Runs several actions from one click.                                                                                                 |

`SEND_EMAIL` delivers through a mail server when `SMTP_URL` is set. Without one it writes the message to the server log and delivers nothing.

An action's arguments are evaluated when the button is clicked, not when formulas recalculate. `=BUTTON("Add one", EXECUTE(A1+1, A1))` is a counter, not a circular reference.

### Controls

A control is a cell that shows an input bound to another cell. `CHECKBOX(cell, [label])`, `DROPDOWN(choices, cell)`, `TEXTBOX(cell, [label])`, and `NUMBERBOX(cell, [label])` show that cell's value and write a committed change back to it. Text and number inputs commit when you press Enter or leave the input. A number input accepts a number; leaving it empty clears the target. Text inputs store text even when it looks like a number or formula. A control must target a stored cell that has no formula and is not in a formula column or filled by an array formula.

The same controls work in Markdown text views:

```
Name: {{ TEXTBOX('Form'!A1, "Name") }}
Count: {{ NUMBERBOX('Form'!A2, "Count") }}
```

The server re-evaluates the template under the spreadsheet lock and checks the control occurrence, type, and target cell identity before writing. The changed target cell is included in the response and in undo history.

![A form whose dropdown and checkbox fill cells, and a button that appends them to a log table](docs/screenshots/form.png)

The **Save order** button above appends the form's cells to the Log table and then empties the form.

### Queries

`QUERY(range, query, [headers])` runs a query written like SQL over a range:

```
=QUERY(A1:D99, "select B, sum(C) where D >= date '2026-01-01' group by B order by sum(C) desc limit 5")
```

It supports `select`, `where`, `group by`, `having`, `pivot`, `order by`, `limit`, `offset`, and `label`. Columns are named by letter, counting from the first column of the range, or by header. A query expression can call any formula function.

## History and files

**Save a copy** in the editor creates a document in your own workspace, including all pages, blocks, formulas, and formatting. Anyone with read access can copy a document. The copy has fresh IDs, no shares, and no history; edits to it do not change the original.

The server keeps a per-tab undo journal for content changes, including cells, formatting, and structural edits. Ctrl+Z and Ctrl+Y undo and redo changes made since the page was opened while they remain safe to apply. An undo is refused when it conflicts with later writes to the same content, or when one change alters reference meanings and the other restores or writes formula text. Creating or deleting pages, tables, or views remains more conservative; **History** restores an earlier whole-spreadsheet version or opens it as a new document. The server also keeps versions before destructive or large changes and every ten minutes while a document is edited.
**Export** in the editor saves a document as a JSON file holding its pages, their blocks, and cell inputs. **Import** on the document list creates a document from one. A document holds at most 50 pages, 50 blocks on a page, 100,000 filled cells, and 100,000 rows across its tables, which are also the most a file may hold. The format is the `spreadsheetFile` schema in `packages/shared/src/index.ts`. It identifies things by name and order, with no ids. A data table may have zero rows.

## How it works

```
packages/engine   Formula engine: parser, evaluator, dependency tracking, action planning. No I/O.
packages/shared   Request schemas and limits used by the server and the web app.
apps/server       HTTP API (Hono), database (Drizzle on Postgres or PGlite), authentication (better-auth).
apps/web          Vue 3 app.
e2e               Playwright tests.
```

Rows and columns have persistent UUIDs. Cells and undo entries name those IDs; inserting a row writes row records and changed formula text without moving cells. `TableLayout` converts IDs to positions for the engine and grid. The browser keeps confirmed and pending inputs by ID, and applies mutation responses and live events in revision order. A revision gap or an event too large to include its content triggers a snapshot read.

The engine is pure. Evaluating an action formula returns a description of the effect, and `Workbook.planAction` turns that description into a list of effects such as `setCell` or `sendEmail`. The engine never applies them.

The same engine runs in two places. The browser runs it to show values as soon as a cell changes. The server runs it when a button is clicked: it loads the stored inputs, evaluates the clicked cell or the text view's selected button occurrence, plans the action, and applies the effects. The browser sends a cell's identity or a view ID and button occurrence, so it cannot ask the server for an effect that the stored formula does not describe.

Cell writes and a record in `action_runs` commit in one transaction. Email is sent after the commit.

Every change to what a document holds runs in a transaction that first locks the document's row, so changes to one document happen one at a time and each reads what the one before it left. A request that changes anything must also come from a page served at `BASE_URL`: the server refuses one whose `Origin` header names another origin. `action_runs` records who clicked a cell button or a text-view button, or changed a control, along with the effects and outcome.

Every document belongs to a workspace, and users reach documents through workspace membership with a role of owner, editor, or viewer. All data access goes through `SpreadsheetRepository`, which checks membership in each query. A document outside the user's workspaces is reported as not found.

## Configuration

The server reads environment variables, and the web app's build reads `APP_NAME`. Development needs none. `pnpm dev` also reads them from `.env.local` at the repository root, which Git ignores.

| Variable                     | Default                              | Meaning                                                                                                                                                                                                                           |
| ---------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_NAME`                   | `rowz`                               | The name the app calls itself, in the browser tab and as the sender of email. The web app takes it when Vite builds or serves it, so set it for `pnpm build` as well as for the server                                            |
| `DATABASE_URL`               | `.data/pglite`                       | A `postgres://` URL, or a directory for the embedded PGlite database                                                                                                                                                              |
| `AUTH_SECRET`                | a development value                  | Signs sessions. Required when `NODE_ENV=production`.                                                                                                                                                                              |
| `BASE_URL`                   | `http://localhost:5173`              | The URL browsers use to reach the app                                                                                                                                                                                             |
| `PORT`                       | `3000`                               | Port of the API server                                                                                                                                                                                                            |
| `EMAILS_PER_HOUR`            | `50`                                 | Emails one user's button clicks may send in an hour, counting each recipient of each message. Stops use as an open mail relay                                                                                                     |
| `SMTP_URL`                   | none                                 | An `smtp://` or `smtps://` URL of a mail server, with any user name and password in it. Without it email is logged, not sent                                                                                                      |
| `MAIL_FROM`                  | `APP_NAME`, at `no-reply@localhost`  | The address email is sent from                                                                                                                                                                                                    |
| `REQUIRE_EMAIL_VERIFICATION` | off                                  | Set to `true` to make a new account confirm its email address, through a link sent to it, before it can sign in. A document can then be shared only with an account that has confirmed its address. Needs `SMTP_URL` to be useful |
| `WEB_ROOT`                   | none, or `../web/dist` in production | The directory of the built web app, which the server then serves. Set it to nothing when something else serves the web app                                                                                                        |

The server applies database migrations at startup. After changing `apps/server/src/db/schema.ts`, run `pnpm --filter @spreadsheet-app/server db:generate` and commit the new file in `apps/server/drizzle/`.

## Running in production

```sh
pnpm install
pnpm build
NODE_ENV=production \
  AUTH_SECRET="$(openssl rand -base64 32)" \
  BASE_URL=https://sheets.example.com \
  DATABASE_URL=postgres://user:password@host/database \
  pnpm start
```

`pnpm build` builds the web app into `apps/web/dist`. With `NODE_ENV=production` the server serves that directory next to the API, so one process answers everything on `PORT`. Put it behind a reverse proxy that terminates TLS and forwards the client's address. The proxy must not buffer `/api/spreadsheets/*/events`, which is a long-lived stream.

The server runs from TypeScript source through `tsx`. There is no compiled server build.

One server process is assumed. Live updates between sessions are announced in the process's memory, so sessions connected to different processes would not hear each other.

## Development

| Command              | Does                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `pnpm dev`           | Runs the API server and the web app with reload                      |
| `pnpm check`         | Lint, typecheck, and unit tests                                      |
| `pnpm test`          | Unit and integration tests (Vitest)                                  |
| `pnpm test:coverage` | The same with coverage. Fails if the engine drops below 90% of lines |
| `pnpm e2e`           | End-to-end tests (Playwright). Starts its own servers on other ports |
| `pnpm e2e:remote`    | The same, with the browser in the `playwright` container (see below) |
| `pnpm format`        | Formats with Prettier                                                |
| `pnpm screenshots`   | Retakes the screenshots in this file (`e2e/screenshots.ts`)          |

Server tests run against PGlite in memory. Set `TEST_DATABASE_URL` to a Postgres server to run them against real Postgres instead; each test file creates and drops its own database. CI does this on every push. `pnpm test:postgres` does it locally: it starts the Postgres server in `compose.yaml` with Docker and runs the server tests against it. The tests that need two database connections run only this way. `docker compose down` stops the server.

`pnpm e2e:remote` runs the end-to-end tests where Chromium cannot start. The browser runs in the Playwright server of `compose.yaml`, started with `docker compose up --detach playwright`, and the tests and the servers they start stay on the machine that runs the command. It takes the arguments `playwright test` does. The container's Playwright version must match the one in `pnpm-lock.yaml`, so change both together.

A Claude Code session can run `pnpm e2e:remote` inside its Bash sandbox with these settings, in `.claude/settings.json` or, to keep them to one checkout, `.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": ["Bash(pnpm e2e:remote)", "Bash(pnpm e2e:remote *)"]
  },
  "sandbox": {
    "network": {
      "allowedDomains": ["127.0.0.1"]
    }
  }
}
```

A Codex session can run `pnpm e2e:remote:codex` inside its sandbox with the following settings in `.codex/config.toml`:

```toml
[permissions.workspace.network.domains]
"localhost" = "allow"

[permissions.workspace.network]
enabled = true
allow_local_binding = true
```

The sandbox gives each command its own loopback interface, so the command reaches the container's port through the sandbox's proxy, and `allowedDomains` is what lets the proxy connect to it. The entry opens every loopback port of the machine to sandboxed commands, not only the Playwright server's.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
