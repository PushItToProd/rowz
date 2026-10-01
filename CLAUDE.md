# rowz

A Rows-style spreadsheet: pages, tables, formulas, and formulas that describe side effects run by buttons. [README.md](README.md) covers the formula language, the architecture, and configuration.

## Commands

- `pnpm check` runs lint, typecheck, and unit tests. Run it before calling work done.
- `pnpm e2e` runs Playwright. It starts its own servers on ports 3100 and 5273 with an in-memory database.
- `pnpm exec vitest run --project engine` (or `server`, `web`) runs one package's tests.
- `pnpm --filter @spreadsheet-app/server db:generate` writes a migration after a schema change.

TypeScript is pinned to 6.0 because typescript-eslint and vue-tsc need its JavaScript API, which TypeScript 7 does not ship.

## Design rules

- **The engine stays pure.** `packages/engine` performs no I/O and has no dependencies. A new side effect is a new variant of `Effect`, an action function that returns it from `plan`, and a handler on the server in `apps/server/src/actions/run.ts`.
- **Functions report bad arguments by throwing.** The helpers in `packages/engine/src/functions/arguments.ts` (`number`, `text`, `scalar`, `grid`, `fail`) throw `Failure`, and the evaluator turns that into the cell's error. A function body converts its arguments and computes, with no error checks.
- **A function checks the size of an array before making it.** A function whose result can have more cells than each of its arguments calls `limitCells` in `arguments.ts` with the size of the result before allocating it. No array is then larger than the largest table, which bounds the memory a formula can ask for.
- **Every function has a help entry.** `packages/engine/src/docs.ts` holds the syntax, summary, and example the help page shows. A test fails when a function in the default registry has no entry or its example evaluates to an error.
- **Recalculation never runs an action.** Action functions evaluate to an `ActionValue` and their arguments are not evaluated until `Workbook.planAction`. Their arguments are also left out of the dependency graph, which is why a counter button is not a cycle.
- **Authorization lives in `SpreadsheetRepository`.** Route handlers reach spreadsheet data only through `c.var.repository`. A new query starts from `findSpreadsheet`, `findPage`, or `findTable`, which join the one subquery of who may open what (workspace members and shares) and take the access the caller needs: `read`, `write`, or `own`. `apps/server/src/access.test.ts` lists every route and must gain a line for each new one.
- **The client names a cell; the server decides the effect.** The click endpoint takes an address and derives the action from stored inputs. The input endpoint for checkboxes and dropdowns also takes the chosen value, which the server checks against what the stored formula allows.
- **A block is anything that sits on a page within a sheet:** a table, a chart, or a text view. Charts and text views are also views. A rectangle of cells is a range (`CellRange` in the engine, `GridRange` in the web app, which leaves out the table), so that "block" has one meaning.
- **Cells store inputs only.** Computed values are never persisted.
- **Anything that holds a formula is rewritten with the cells.** A rename, a row or column edit, or a move to another page rewrites cell inputs (`rewrite.ts`), the sources of charts and text views (`views.ts`), and the formulas of formula columns (`columns.ts`) in one transaction, and the server returns all three for the client to apply. A new place to keep formulas needs the same treatment.
- **A formula column's cells are not stored.** The column definition on the table holds the formula, and the engine gives each row that holds something a computed cell. The server refuses writes to those cells, and the engine refuses actions that target them.
- **Markdown never renders HTML it was given.** Text views and `MARKDOWN` cells share the renderer in `apps/web/src/markdown.ts`, which has `html: false`. The template engine escapes Markdown in the values it writes in, except a value made with `MARKDOWN`, so neither a view's author nor a cell's content can inject markup.
- **Page and table names are unique within their parent, ignoring case,** because formulas resolve them that way. The database enforces it with unique indexes on `lower(name)`.
- **A change to what a spreadsheet holds goes through `change`** in `SpreadsheetRepository`, or through `changePage`, `changeTable`, or `changeView`, which also hand over the thing being changed. `change` locks the spreadsheet, so changes to it run one at a time, and then calls `touch`, which announces the change to other open sessions and keeps versions. Decide from what is read inside `change`: a table read before the lock may be stale by the time the work runs. A change to something else about a spreadsheet, such as its name or its shares, calls `noteChange` itself.
- Packages export TypeScript source. There is no build step between packages.

## Tests

Tests sit next to the code as `*.test.ts`. Each package has a `testing.ts` with helpers: `workbookWith` and `evaluateFormula` for the engine, `startTestServer` for the server, `mockApi` and `snapshotWith` for the web app.

Server tests call the real app through `app.request()` against PGlite. Each test file gets its own database, and tests within a file isolate themselves by signing up a new user.

## Working in the Claude Code sandbox

- `tsx watch` and the `tsx` CLI fail with `EPERM` because they open a Unix socket. Use `node --import tsx <file>`, which the server's `start` script does.
- Each sandboxed command has its own network namespace. A server started in one command cannot be reached from another command or from the Playwright MCP browser.
- Chromium does not start inside the sandbox. `pnpm e2e` must run outside it.
- Prettier is run on explicit globs, not `.`, because the sandbox places unreadable dotfiles in the working directory.
