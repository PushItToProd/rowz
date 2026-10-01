# Spreadsheet app

An open source, web-based spreadsheet modeled on rows.com. A spreadsheet holds pages, a page holds several independent tables, and a formula can describe a side effect that runs when someone clicks a button.

```
=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))
=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3))
```

The first formula shows a button that writes the sum of A1 and A2 into A3. The second shows a button that sends an email built from three cells.

`SEND_EMAIL` writes the message to the server log and delivers nothing. A real mail transport plugs in behind the `Mailer` interface in `apps/server/src/mail/mailer.ts`.

## Quick start

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 and create an account. Development needs no database server: data is stored by PGlite, an in-process Postgres, under `apps/server/.data/`.

## Formulas

A cell whose input starts with `=` is a formula. A leading apostrophe forces text: `'=not a formula`.

The app has a help page at `/help` with the full reference. It lists every function with an example whose result the engine computes when the page loads.

| Kind        | Supported                                                                                                                                                      |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operators   | `+ - * / ^`, `&` for joining text, `= <> < > <= >=`                                                                                                            |
| References  | `A1`, `A1:B2`, `A:A`, `2:5`, `A2:A`, `$A$1`, `Table2!A1` for a table on the same page, `'Page 1'!'Table 2'!A1:B2` for a table on another page                  |
| Math        | `SUM AVERAGE MIN MAX COUNT COUNTA PRODUCT MEDIAN ROUND ROUNDUP ROUNDDOWN FLOOR CEILING INT ABS SQRT POWER MOD COUNTIF COUNTIFS SUMIF SUMIFS AVERAGEIF`         |
| Logic       | `IF IFS SWITCH AND OR NOT IFERROR`                                                                                                                             |
| Lookup      | `VLOOKUP XLOOKUP MATCH INDEX`                                                                                                                                  |
| Text        | `CONCATENATE TEXTJOIN LEN UPPER LOWER TRIM LEFT RIGHT MID FIND SEARCH SUBSTITUTE REPT VALUE TEXT`                                                              |
| Dates       | `TODAY NOW DATE DATEVALUE YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY DAYS EDATE EOMONTH`. A cell typed as `2026-09-30` is a date                                |
| Information | `ISBLANK ISNUMBER ISTEXT ISLOGICAL ISDATE ISERROR`                                                                                                             |
| Arrays      | `FILTER SORT UNIQUE SEQUENCE TRANSPOSE TAKE DROP ROWS COLUMNS MAP REDUCE BYROW BYCOL`. A result of several values fills the cells below and beside the formula |
| Names       | `LET LAMBDA`. A function kept in a cell is called by the cell's address: `=D1(21)`                                                                             |
| Errors      | `#DIV/0! #VALUE! #REF! #NAME? #N/A #SPILL! #CYCLE! #ERROR!`                                                                                                    |

Page and table names in references ignore case. Names with spaces need single quotes.

### Actions

An action is a function that describes a side effect. It does nothing until a button runs it.

| Function                            | Effect                                                                                           |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `BUTTON(label, action)`             | Shows a button. Clicking it runs the action.                                                     |
| `EXECUTE(expression, target)`       | Writes the value of `expression` into the cell `target`.                                         |
| `SEND_EMAIL(to, subject, body, cc)` | Sends an email. `cc` is optional. `to` and `cc` take addresses separated by commas or semicolons |
| `APPEND_ROW(range, value, ...)`     | Writes the values into the first row of the range below its content, growing the table if needed |
| `CLEAR(range)`                      | Empties the cells of the range.                                                                  |
| `DO(action, ...)`                   | Runs several actions from one click.                                                             |

### Charts and text views

A page holds charts and text views next to its tables.

A chart draws a range as bars, lines, a pie, or a scatter. Its data is a formula such as `Sales!A1:C9`. The first column labels the points and each other column is a series.

A text view is Markdown with tags that put spreadsheet values into it:

```
## Sales report

{% let total = SUM(Sales!B2:B) %}
We sold **{{ total }}** in all.

{% for name, amount in Sales!A2:B4 %}
- {{ name }}: {{ amount }}{% if amount > 100 %} (a big one){% end %}
{% end %}

{{ BAR_CHART(Sales!A2:B4, "Sales by person") }}
```

`{{ }}` shows one value in the sentence, a range as a table, and the result of `BAR_CHART`, `LINE_CHART`, `PIE_CHART`, or `SCATTER_CHART` as a chart. A formula in a chart or text view is written on a page and not in a table, so it names the table of every cell it reads.

### Controls

A control is a cell that shows an input bound to another cell. `CHECKBOX(cell, label)` and `DROPDOWN(choices, cell)` show that cell's value and write a change back to it.

An action's arguments are evaluated when the button is clicked, not when the sheet recalculates. `=BUTTON("Add one", EXECUTE(A1+1, A1))` is a counter, not a circular reference.

## How it works

```
packages/engine   Formula engine: parser, evaluator, dependency tracking, action planning. No I/O.
packages/shared   Request schemas and limits used by the server and the web app.
apps/server       HTTP API (Hono), database (Drizzle on Postgres or PGlite), authentication (better-auth).
apps/web          Vue 3 app.
e2e               Playwright tests.
```

The engine is pure. Evaluating an action formula returns a description of the effect, and `Workbook.planAction` turns that description into a list of effects such as `setCell` or `sendEmail`. The engine never applies them.

The same engine runs in two places. The browser runs it to show values as soon as a cell changes. The server runs it when a button is clicked: it loads the stored cell inputs, evaluates the clicked cell, plans the action, and applies the effects. The browser sends only the address of the clicked cell, so it cannot ask the server for an effect that the stored formula does not describe.

Cell writes and a record in `action_runs` commit in one transaction. Email is sent after the commit. `action_runs` records who clicked which cell, the effects, and the outcome.

Every spreadsheet belongs to a workspace, and users reach spreadsheets through workspace membership with a role of owner, editor, or viewer. All data access goes through `SpreadsheetRepository`, which checks membership in each query. A spreadsheet outside the user's workspaces is reported as not found.

## Configuration

The server reads environment variables. Development needs none.

| Variable              | Default                 | Meaning                                                                              |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| `DATABASE_URL`        | `.data/pglite`          | A `postgres://` URL, or a directory for the embedded PGlite database                 |
| `AUTH_SECRET`         | a development value     | Signs sessions. Required when `NODE_ENV=production`.                                 |
| `BASE_URL`            | `http://localhost:5173` | The URL browsers use to reach the app                                                |
| `PORT`                | `3000`                  | Port of the API server                                                               |
| `EMAIL_RUNS_PER_HOUR` | `20`                    | Button clicks per user per hour that may send email. Stops use as an open mail relay |

The server applies database migrations at startup. After changing `apps/server/src/db/schema.ts`, run `pnpm --filter @spreadsheet-app/server db:generate` and commit the new file in `apps/server/drizzle/`.

## Development

| Command              | Does                                                                 |
| -------------------- | -------------------------------------------------------------------- |
| `pnpm dev`           | Runs the API server and the web app with reload                      |
| `pnpm check`         | Lint, typecheck, and unit tests                                      |
| `pnpm test`          | Unit and integration tests (Vitest)                                  |
| `pnpm test:coverage` | The same with coverage. Fails if the engine drops below 90% of lines |
| `pnpm e2e`           | End-to-end tests (Playwright). Starts its own servers on other ports |
| `pnpm format`        | Formats with Prettier                                                |

Server tests run against PGlite in memory. Set `TEST_DATABASE_URL` to a Postgres server to run them against real Postgres instead; each test file creates and drops its own database. CI does this on every push.

## Not built yet

- Live sync between sessions. Edits are saved over HTTP and the last write wins. Another session sees changes after a reload.
- Sharing. The data model has workspaces and roles, and the server enforces them, but there is no way to invite someone.
- Email delivery.
- Undo, cell formatting, column resizing, import and export.
- A production build of the server and static serving of the web app. The server runs from TypeScript source through `tsx`.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
