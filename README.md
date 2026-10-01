# Spreadsheet app

An open source, web-based spreadsheet modeled on rows.com. A spreadsheet holds pages, a page holds several independent tables, and a formula can describe a side effect that runs when someone clicks a button.

```
=BUTTON("Sum range", EXECUTE(SUM(A1,A2),A3))
=BUTTON("Click me!", SEND_EMAIL(A1,A2,A3))
```

The first formula shows a button that writes the sum of A1 and A2 into A3. The second shows a button that sends an email built from three cells.

`SEND_EMAIL` delivers through a mail server when `SMTP_URL` is set. Without one it writes the message to the server log and delivers nothing.

## Quick start

Requires Node 24 and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 and create an account. Development needs no database server: data is stored by PGlite, an in-process Postgres, under `apps/server/.data/`.

### Developing from another machine

To open the dev server from a second machine, put the URL that machine will use in `.env.local` at the repository root:

```sh
BASE_URL=https://devbox.example.com:5173
```

`pnpm dev` gives that file to both processes. The Vite dev server takes its port from the URL, listens on every interface, and accepts the URL's host name. The API server accepts sign-in requests from that origin alone, so http://localhost:5173 stops working while the setting is in place.

Use an `https` URL. The app calls `crypto.randomUUID`, which browsers provide over plain HTTP only on localhost. With an `https` URL the dev server presents a self-signed certificate, which the browser asks you to accept on the first visit.

## Formulas

A cell whose input starts with `=` is a formula. A leading apostrophe forces text: `'=not a formula`.

The app has a help page at `/help` with the full reference. It lists every function with an example whose result the engine computes when the page loads.

| Kind        | Supported                                                                                                                                                                                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Operators   | `+ - * / ^`, `&` for joining text, `= <> < > <= >=`                                                                                                                                                                                                                                                                   |
| References  | `A1`, `A1:B2`, `A:A`, `2:5`, `A2:A`, `$A$1`, `Table2!A1` for a table on the same page, `'Page 1'!'Table 2'!A1:B2` for a table on another page                                                                                                                                                                         |
| Math        | `SUM AVERAGE MIN MAX COUNT COUNTA PRODUCT MEDIAN SUMPRODUCT ROUND ROUNDUP ROUNDDOWN TRUNC MROUND FLOOR CEILING INT ABS SIGN SQRT POWER EXP LN LOG PI SIN COS TAN ASIN ACOS ATAN SINH COSH TANH DEGREES RADIANS MOD QUOTIENT EVEN ODD ISEVEN ISODD GCD LCM FACT COUNTIF COUNTIFS SUMIF SUMIFS AVERAGEIF MAXIFS MINIFS` |
| Statistics  | `MODE STDEV STDEVP VAR_S VAR_P PERCENTILE QUARTILE RANK CORREL COVARIANCE_S COVARIANCE_P SLOPE INTERCEPT FORECAST COUNTUNIQUE COUNTBLANK`                                                                                                                                                                             |
| Financial   | `PMT FV PV NPER RATE NPV IRR`                                                                                                                                                                                                                                                                                         |
| Logic       | `IF IFS SWITCH AND OR NOT IFERROR IFNA`                                                                                                                                                                                                                                                                               |
| Lookup      | `VLOOKUP HLOOKUP XLOOKUP MATCH INDEX ROW COLUMN`                                                                                                                                                                                                                                                                      |
| Text        | `CONCATENATE CONCAT TEXTJOIN JOIN SPLIT LEN UPPER LOWER PROPER TRIM LEFT RIGHT MID FIND SEARCH SUBSTITUTE REPT CHAR CODE ENCODEURL VALUE TEXT FIXED MARKDOWN`                                                                                                                                                         |
| Dates       | `TODAY NOW DATE TIME DATEVALUE YEAR MONTH DAY HOUR MINUTE SECOND WEEKDAY WEEKNUM ISOWEEKNUM DAYS DATEDIF EDATE EOMONTH WORKDAY NETWORKDAYS`. A cell typed as `2026-09-30` is a date                                                                                                                                   |
| Information | `ISBLANK ISNUMBER ISTEXT ISNONTEXT ISLOGICAL ISDATE ISERROR ISERR ISNA`                                                                                                                                                                                                                                               |
| Arrays      | `FILTER SORT UNIQUE SEQUENCE TRANSPOSE TAKE DROP HSTACK VSTACK FLATTEN ROWS COLUMNS MAP REDUCE BYROW BYCOL QUERY`. A result of several values fills the cells below and beside the formula                                                                                                                            |
| Names       | `LET LAMBDA`. A function kept in a cell is called by the cell's address: `=D1(21)`                                                                                                                                                                                                                                    |
| Errors      | `#DIV/0! #VALUE! #REF! #NAME? #N/A #SPILL! #CYCLE! #ERROR!`                                                                                                                                                                                                                                                           |

A table can have named columns, which makes it a data table. `[Price]` is the cell of that column in the formula's own row, and `Sales[Price]` is the whole column of the table Sales. A column can be typed (text, number, date, checkbox) or be a formula column, which computes one formula in every row that holds something.

Page, table, and column names in references ignore case. Names with spaces need single quotes.

### Actions

An action is a function that describes a side effect. It does nothing until a button runs it.

| Function                            | Effect                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `BUTTON(label, action)`             | Shows a button. Clicking it runs the action.                                                             |
| `EXECUTE(expression, target)`       | Writes the value of `expression` into the cell `target`.                                                 |
| `SEND_EMAIL(to, subject, body, cc)` | Sends an email. `cc` is optional. `to` and `cc` take addresses separated by commas or semicolons         |
| `APPEND_ROW(range, value, ...)`     | Writes the values into the first row of the range below its content, growing the table if needed         |
| `INSERT(data, range)`               | Adds every row of the data below the content of the range                                                |
| `UPDATE(data, key_columns, range)`  | Writes each row of the data over the row of the range with the same key, and adds the rows with new keys |
| `OVERWRITE(data, range)`            | Empties the range and writes the data from its first row                                                 |
| `CLEAR(range)`                      | Empties the cells of the range.                                                                          |
| `DO(action, ...)`                   | Runs several actions from one click.                                                                     |

### Queries

`QUERY(range, query, [headers])` runs a query written like SQL over a range:

```
=QUERY(A1:D99, "select B, sum(C) where D >= date '2026-01-01' group by B order by sum(C) desc limit 5")
```

It supports `select`, `where`, `group by`, `having`, `pivot`, `order by`, `limit`, `offset`, and `label`. Columns are named by letter, counting from the first column of the range, or by header. A query expression can call any formula function.

### Formats

The toolbar under the formula bar gives the selected cells bold, italic, an alignment, a number format, a text color, or a fill color. Formats are stored per table as rules over ranges, so a whole column is one rule.

### History

The server keeps versions of a spreadsheet: before anything is deleted, before a change to many cells at once, and every ten minutes while it is edited. **History** in the editor restores a version or opens it as a new spreadsheet.

### Files

**Export** in the editor saves a spreadsheet as a JSON file holding its pages, tables, charts, text views, and cell inputs. **Import** on the spreadsheet list creates a spreadsheet from one. The format is the `spreadsheetFile` schema in `packages/shared/src/index.ts`. It identifies things by name and order, with no ids.

Each table also exports to CSV (the values shown) and imports from CSV.

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

The server reads environment variables. Development needs none. `pnpm dev` also reads them from `.env.local` at the repository root, which Git ignores.

| Variable                     | Default                              | Meaning                                                                                                                                        |
| ---------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`               | `.data/pglite`                       | A `postgres://` URL, or a directory for the embedded PGlite database                                                                           |
| `AUTH_SECRET`                | a development value                  | Signs sessions. Required when `NODE_ENV=production`.                                                                                           |
| `BASE_URL`                   | `http://localhost:5173`              | The URL browsers use to reach the app                                                                                                          |
| `PORT`                       | `3000`                               | Port of the API server                                                                                                                         |
| `EMAIL_RUNS_PER_HOUR`        | `20`                                 | Button clicks per user per hour that may send email. Stops use as an open mail relay                                                           |
| `SMTP_URL`                   | none                                 | An `smtp://` or `smtps://` URL of a mail server, with any user name and password in it. Without it email is logged, not sent                   |
| `MAIL_FROM`                  | `Spreadsheet <no-reply@localhost>`   | The address email is sent from                                                                                                                 |
| `REQUIRE_EMAIL_VERIFICATION` | off                                  | Set to `true` to make a new account confirm its email address, through a link sent to it, before it can sign in. Needs `SMTP_URL` to be useful |
| `WEB_ROOT`                   | none, or `../web/dist` in production | The directory of the built web app, which the server then serves. Set it to nothing when something else serves the web app                     |

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
| `pnpm format`        | Formats with Prettier                                                |

Server tests run against PGlite in memory. Set `TEST_DATABASE_URL` to a Postgres server to run them against real Postgres instead; each test file creates and drops its own database. CI does this on every push.

## Not built yet

- Merging of edits made at the same moment. Open sessions see each other's changes within a second, and the last write to a cell wins.
- Inviting someone who has no account yet. A spreadsheet can be shared only with an existing account.
- Column resizing.

## License

AGPL-3.0-only. See [LICENSE](LICENSE).
