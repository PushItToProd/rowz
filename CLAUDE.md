# Spreadsheet app

A Rows-style spreadsheet: pages, tables, formulas, and formulas that describe side effects run by buttons. [README.md](README.md) covers the formula language, the architecture, and configuration.

## Commands

- `pnpm check` runs lint, typecheck, and unit tests. Run it before calling work done.
- `pnpm e2e` runs Playwright. It starts its own servers on ports 3100 and 5273 with an in-memory database.
- `pnpm exec vitest run --project engine` (or `server`, `web`) runs one package's tests.
- `pnpm --filter @spreadsheet-app/server db:generate` writes a migration after a schema change.

TypeScript is pinned to 6.0 because typescript-eslint and vue-tsc need its JavaScript API, which TypeScript 7 does not ship.

## Design rules

- **The engine stays pure.** `packages/engine` performs no I/O and has no dependencies. A new side effect is a new variant of `Effect`, an action function that returns it from `plan`, and a handler on the server in `apps/server/src/actions/run.ts`.
- **Recalculation never runs an action.** Action functions evaluate to an `ActionValue` and their arguments are not evaluated until `Workbook.planAction`. Their arguments are also left out of the dependency graph, which is why a counter button is not a cycle.
- **Authorization lives in `SpreadsheetRepository`.** Route handlers reach spreadsheet data only through `c.var.repository`. A new query starts from `findSpreadsheet`, `findPage`, or `findTable`. `apps/server/src/access.test.ts` lists every route and must gain a line for each new one.
- **The client names a cell; the server decides the effect.** The click endpoint takes an address and derives the action from stored inputs.
- **Cells store inputs only.** Computed values are never persisted.
- **Page and table names are unique within their parent, ignoring case,** because formulas resolve them that way. The database enforces it with unique indexes on `lower(name)`.
- Packages export TypeScript source. There is no build step between packages.

## Tests

Tests sit next to the code as `*.test.ts`. Each package has a `testing.ts` with helpers: `workbookWith` and `evaluateFormula` for the engine, `startTestServer` for the server, `mockApi` and `snapshotWith` for the web app.

Server tests call the real app through `app.request()` against PGlite. Each test file gets its own database, and tests within a file isolate themselves by signing up a new user.

## Working in the Claude Code sandbox

- `tsx watch` and the `tsx` CLI fail with `EPERM` because they open a Unix socket. Use `node --import tsx <file>`, which the server's `start` script does.
- Each sandboxed command has its own network namespace. A server started in one command cannot be reached from another command or from the Playwright MCP browser.
- Chromium does not start inside the sandbox. `pnpm e2e` must run outside it.
- Prettier is run on explicit globs, not `.`, because the sandbox places unreadable dotfiles in the working directory.
