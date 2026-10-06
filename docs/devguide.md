# Developer guide

This guide maps the parts of rowz that developers most often need to change. For the full product and architecture description, see the [README](../README.md).

## Mental model

A spreadsheet holds pages. Each page holds blocks: tables, charts, text views, and scripts. Tables store cell inputs; charts and text views compute their content from formulas; a script defines names, functions, and `ASSERT` checks. The formula engine runs in the browser for immediate recalculation and on the server when an action runs. The server stores inputs, not computed values.

The engine is pure and has no I/O. An action formula evaluates to a description of an action. When a user clicks its button, the server reads the stored formula, plans its effects, and applies them. The browser sends the cell's row and column IDs, or a view ID and the button's occurrence in it, not an effect to execute.

## Main components

| Area                | Start here                                                                                                                                                  | Common changes                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Formula engine      | [`packages/engine/src/workbook.ts`](../packages/engine/src/workbook.ts)                                                                                     | Evaluation, dependency tracking, array spills, typed and formula columns, action planning        |
| Formula language    | [`tokenizer.ts`](../packages/engine/src/tokenizer.ts), [`parser.ts`](../packages/engine/src/parser.ts), [`evaluate.ts`](../packages/engine/src/evaluate.ts) | Syntax, references, and evaluation behavior                                                      |
| Functions and help  | [`packages/engine/src/functions/index.ts`](../packages/engine/src/functions/index.ts), [`docs.ts`](../packages/engine/src/docs.ts)                          | Built-in functions and the entries shown on `/help`                                              |
| Shared contracts    | [`packages/shared/src/index.ts`](../packages/shared/src/index.ts)                                                                                           | API request schemas, limits, and spreadsheet import/export format                                |
| Web app             | [`EditorView.vue`](../apps/web/src/views/EditorView.vue), [`workbook.ts`](../apps/web/src/stores/workbook.ts)                                               | Editor composition, spreadsheet state, local recalculation, saving, selection, undo, and redo    |
| Grid and formula UI | [`apps/web/src/components/`](../apps/web/src/components/)                                                                                                   | Table interaction, cell rendering, formula editing and completion, charts, text views, and menus |
| API and persistence | [`app.ts`](../apps/server/src/app.ts), [`spreadsheets.ts`](../apps/server/src/repo/spreadsheets.ts)                                                         | HTTP routes, authorization, database changes, history, and formula rewrites                      |
| Actions and effects | [`run.ts`](../apps/server/src/actions/run.ts), [`effects.ts`](../packages/engine/src/effects.ts)                                                            | Effects such as cell writes, table growth, and email                                             |

Useful supporting modules include [`graph.ts`](../packages/engine/src/graph.ts) for formula dependencies, [`template.ts`](../packages/engine/src/template.ts) for text-view templates, [`views.ts`](../packages/engine/src/views.ts) and [`columns.ts`](../packages/engine/src/columns.ts) for formula rewrites, and [`api/client.ts`](../apps/web/src/api/client.ts) for typed web-to-server calls.

## Key patterns

### Add or change a formula function

Implement the function in the appropriate module under `packages/engine/src/functions/` and register it in [`functions/index.ts`](../packages/engine/src/functions/index.ts). Add its syntax, summary, and a working example to [`docs.ts`](../packages/engine/src/docs.ts), then add adjacent tests. Every default function needs a help entry, and the help tests evaluate its example.

Function argument helpers in [`functions/arguments.ts`](../packages/engine/src/functions/arguments.ts) throw `Failure` for invalid arguments; function bodies convert their inputs and compute their result. If a function can allocate an array larger than its inputs, check the result size with `limitCells` before allocating it. The maximum is 100,000 cells.

### Add or change an action

Add an `Effect` variant in [`effects.ts`](../packages/engine/src/effects.ts), make an engine action function return it from planning, and handle it on the server in [`actions/run.ts`](../apps/server/src/actions/run.ts). Recalculation must not run side effects. Action arguments are evaluated when the action runs, and the server decides the effect from the stored formula.

### Change names, rows, columns, or page placement

Formulas can be stored in cell inputs, the sources of charts, text views, and scripts, formula-column definitions, a data table's filter, and a table's named formulas. A rename, row or column edit, or move that changes formula references must rewrite each applicable location in the same transaction. The server returns rewritten cells, views, and tables for the client to apply. See [`rewrite.ts`](../packages/engine/src/rewrite.ts) for cell inputs, [`views.ts`](../packages/engine/src/views.ts) for charts, text views, and scripts, [`columns.ts`](../packages/engine/src/columns.ts) for formula columns, filters, and named formulas, and `rewriteFormulas` and `rewriteForMove` in [`SpreadsheetRepository`](../apps/server/src/repo/spreadsheets.ts).

### Add an API or persisted data change

Route handlers live in `apps/server/src/routes/`; request schemas and shared limits live in [`packages/shared/src/index.ts`](../packages/shared/src/index.ts). Route handlers access spreadsheet data through `SpreadsheetRepository`, which enforces read, write, and owner access.

Changes to spreadsheet content go through the repository's `change`, `changePage`, `changeTable`, or `changeView` helpers. They lock the spreadsheet, check write access under the lock, then perform the change and update history/live notifications. Read data inside the change callback when it may have changed before the lock was acquired. Add each new route to one of the lists in [`access.test.ts`](../apps/server/src/access.test.ts). A route that changes something also needs a round-trip case in [`undo.test.ts`](../apps/server/src/undo.test.ts), or a line in its `NOT_JOURNALED` list when Ctrl+Z should not undo it. Both tests compare what they cover with the routes the app registers and fail for one that is left out.

For a database schema change, edit [`db/schema.ts`](../apps/server/src/db/schema.ts), run `pnpm --filter @spreadsheet-app/server db:generate`, and commit the generated migration under `apps/server/drizzle/`.

### Change editor behavior

The Pinia store in [`stores/workbook.ts`](../apps/web/src/stores/workbook.ts) owns most spreadsheet state and mutation flows. [`GridView.vue`](../apps/web/src/components/GridView.vue) handles grid interaction and [`CellView.vue`](../apps/web/src/components/CellView.vue) renders cells. `EditorView.vue` assembles the page from table, chart, text-view, and script components.

Every place a formula is typed uses the CodeMirror editor in [`FormulaEditor.vue`](../apps/web/src/components/FormulaEditor.vue): cells, the formula bar, formula columns, names, filters, chart sources, scripts, and Markdown templates. A draft is a session in [`formula/session.ts`](../apps/web/src/formula/session.ts), which names its target by ID and keeps its text and undo history while the field that started it is unmounted. [`SessionFormulaField.vue`](../apps/web/src/components/SessionFormulaField.vue) binds a field to a session, and [`FormulaSessionHost.vue`](../apps/web/src/components/FormulaSessionHost.vue) shows a draft whose field is not on screen. Completion is in [`formula/assist.ts`](../apps/web/src/formula/assist.ts) and reference picking in [`formula/picking.ts`](../apps/web/src/formula/picking.ts).

The typed API client in [`api/client.ts`](../apps/web/src/api/client.ts) derives route types from the Hono app. When adding a route, update its request schema, server handler, client call, store flow, and UI as needed.

## Reading and testing path

For an initial tour, read the README's “How it works” section, then [`Workbook`](../packages/engine/src/workbook.ts) and the parser/evaluator. Continue with the web workbook store and editor, followed by the server repository and route tests.

Tests sit beside the code as `*.test.ts`. Server tests exercise the real app against PGlite. Common commands:

```sh
pnpm check
pnpm exec vitest run --project engine
pnpm exec vitest run --project server
pnpm exec vitest run --project web
pnpm e2e
```

The project requires Node 24 and pnpm. Packages export TypeScript source, so there is no build step between packages. Chromium does not start inside the Claude Code or Codex sandbox, so an agent runs `pnpm e2e:remote`, which keeps the browser in the `playwright` container of `compose.yaml`.
