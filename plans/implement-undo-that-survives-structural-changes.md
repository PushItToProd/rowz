# Undo through a server-side change journal

## Context

Ctrl+Z covers cell edits only. The browser keeps the stack (`undoable` in `apps/web/src/stores/workbook.ts`), and `syncStructure` empties it on every row or column edit and every rename, because those rewrite formulas and move addresses. Formatting is not recorded at all.

This plan moves undo to the server. `SpreadsheetRepository.change` already runs every change to a spreadsheet's contents, so it records what each change replaced in a journal table beside `versions`. Ctrl+Z asks the server to put the recorded state back. A stack then survives structural changes because the structural change is itself an entry that is undone first.

Decisions taken with the author:

- The journal lives on the server.
- Ctrl+Z covers every content change: cells, row and column inserts and deletes, renames of pages, tables, and columns, formatting, table resize, column type and formula, naming and removing column names, chart and text view edits, reordering, and creating or deleting pages, tables, and views.
- A button click and a checkbox or dropdown change are undoable. A button's writes undo as one step. Email it sent stays sent.
- A stack belongs to one tab (user id plus the `x-client-id` the tab already sends) and is gone on reload.

Not covered: renaming the spreadsheet and sharing, which do not go through `change`, and restoring a version, which replaces every id and so clears the spreadsheet's journal.

## Journal

New table `journal` in `apps/server/src/db/schema.ts`, with a migration from `pnpm --filter @spreadsheet-app/server db:generate`.

| Column | Purpose |
| --- | --- |
| `seq` bigint identity, primary key | Order of changes. Changes to one spreadsheet run under its lock, so `seq` order is the order they happened. |
| `spreadsheet_id` | Cascade delete. |
| `step` uuid | Entries undone together by one Ctrl+Z. |
| `user_id`, `client_id` | The stack the entry is on. `client_id` is null for a request without the header, and for a step taken off its stack. |
| `undone` boolean | Whether the entry is currently reversed. |
| `rewrites` boolean | The change rewrote references: a row or column insert or delete, or a rename. |
| `label` text | "Delete row 3 of Sales", for the notice after an undo. |
| `data` jsonb | What the change replaced. See below. |
| `created_at` | For pruning. |

Index on `(spreadsheet_id, seq)`.

`data` holds state, not operations:

```ts
interface Recorded {
  pages: { id: string; before: PageRecord | null; after: PageRecord | null }[];
  tables: { id: string; before: TableRecord | null; after: TableRecord | null }[];
  views: { id: string; before: ViewRecord | null; after: ViewRecord | null }[];
  cells: { tableId: string; row: number; col: number; before: string; after: string }[];
}
```

`null` means the thing did not exist. An undo writes every `before`, and a redo writes every `after`. Recording state keeps the inverse of each mutation out of the code: a delete, a rename, and a format change are all reversed by the same apply function.

Cost: an insert or delete near the top of a large table records every moved cell, as large as the write the server already makes. The journal keeps the newest 200 entries per spreadsheet and none older than a day, deleted oldest first by `seq`.

## Server

### `apps/server/src/repo/journal.ts` (new)

- `ContentWriter`: the one place that writes `pages`, `tables`, `views`, and `cells` inside a change. Methods: `insertPage`, `updatePage`, `deletePage`, the same three for tables and views, `setCells`, and `clearCells(tableId, where)`. Each reads the row or cells as they are, writes, and adds to a `Recorded`. A second write to the same thing keeps the first `before` and the last `after`. `deleteTable` and `deletePage` record what the cascade removes: the cells, and for a page its tables and views. The body of today's `storeCells` moves here.
- `applyRecorded(tx, entry, direction)`: checks, then writes. It removes what should not exist (views, tables, pages), upserts pages, tables, and views with their recorded ids, and stores cells.
- The checks that decide whether an entry can still be reversed, described under "When an undo is refused".

### `apps/server/src/repo/spreadsheets.ts`

- `change(spreadsheetId, work)` creates a `ContentWriter`, passes it to `work` with `tx`, and after `work` inserts one journal row when the writer recorded anything, then prunes. `changePage`, `changeTable`, and `changeView` pass the writer on.
- Every mutation method writes through the writer in place of `tx.insert/update/delete` on those four tables: `createPage`, `renamePage`, `reorderPage`, `deletePage`, `createTable`, `updateTable`, `nameColumns`, `formatCells`, `dropColumns`, `updateColumn`, `createView`, `updateView`, `deleteView`, `deleteTable`, `setCells`, `ensureRows`, `editStructure`, and the helpers `rewriteFormulas`, `storeColumnFormulas`, `storeViewSources`. Each sets a label. `editStructure` and the three renames mark the entry `rewrites`.
- `restoreVersion` keeps its raw writes and deletes the spreadsheet's journal rows. `insertContents` stays raw: it also builds new spreadsheets.
- `keepVersion` calls stay. History is the recovery path after a reload, when the tab's stack is gone.
- New `undo(spreadsheetId)` and `redo(spreadsheetId)`: `findSpreadsheet(id, "write")`, then inside `change` pick the caller's step, apply its entries (newest first for undo, oldest first for redo), flip `undone`, and return an `UndoResult`. The apply bypasses the writer's recording: an undo flips entries and adds none.
  - Undo picks the newest step on the caller's stack with `undone = false`. Redo picks the oldest with `undone = true`.
  - A new recorded change by a stack deletes that stack's undone entries.

```ts
interface UndoResult {
  outcome: "done" | "refused" | "nothing";
  label: string | null;
  /** Why, when refused. */
  error: string | null;
  /** What was written, for the client to apply. A null record means the thing is gone. */
  changed: { pages: ...; tables: ...; views: ...; cells: StoredCell[] };
  undoable: boolean;
  redoable: boolean;
}
```

### Request context: `apps/server/src/changes.ts`

The `AsyncLocalStorage` that holds the set of changed spreadsheets becomes a request context that also holds the client id, the step id, and whether the request journaled a step. `announceChanges` fills it from `x-client-id` and a new `x-step-id` header, with a random step per request when the header is absent. `change` reads it through a `currentRequest()` function, as `noteChange` reads the set today. This reaches the repositories `runCell` builds in `apps/server/src/actions/run.ts` without passing arguments through, so a button's `ensureRows` and `setCells` calls share the request's step.

After the handler, the middleware sets the response header `x-undoable: 1` when the request journaled a step for a client.

### Routes

`POST /spreadsheets/:spreadsheetId/undo` and `/redo` in `apps/server/src/routes/spreadsheets.ts`. Both get a line in `writeRoutes()` of `apps/server/src/access.test.ts`.

### When an undo is refused

A refused step is taken off its stack (`client_id` set to null) so the next Ctrl+Z reaches the step under it, and the answer is `outcome: "refused"` with a message. The same rules apply to redo with `before` and `after` swapped.

Call a later entry "in effect" when its `seq` is higher and `undone` is false. Within one stack, undo order means there are none, so these rules only bite when another tab or person has changed the spreadsheet since.

1. An entry that rewrote references, or that created or deleted a page, table, or view, is refused when any later entry is in effect. Its recorded cells no longer describe what the inverse should do: a formula someone typed after a row insert uses the new row numbers, and writing the old cells back would not move it.
2. Any entry is refused when a later entry in effect rewrote references. The entry's `before` text names rows or names that have since changed.
3. Each page, table, and view record must equal the entry's `after`, and each cell's input must equal its `after`. A cell someone else has since retyped fails this.
4. After the write: every table and page a record or cell refers to exists, no stored cell is outside its table or in a formula column, and the limits `setCells`, `createPage`, and `nextPosition` enforce still hold. A unique-name violation counts as a refusal. A failure rolls the transaction back.

Two people typing in different cells of one table can each undo their own edits. Rules 1 and 2 are stricter than necessary for cases such as one person adding a table while another types on a different page. Loosening them needs containment tracking and is left out.

## Shared: `packages/shared/src/index.ts`

`CLIENT_ID_HEADER` (moved from `changes.ts`), `STEP_ID_HEADER`, `UNDOABLE_HEADER`, and `LIMITS.journalEntries`.

## Web

### `apps/web/src/api/client.ts`

- `api.undo(spreadsheetId)` and `api.redo(spreadsheetId)`.
- `api.setCells` and `api.updateTable` take an optional step id, sent as `x-step-id`.
- `check(response)` calls a handler registered with `setJournaledHandler` when the response carries `x-undoable`, the same pattern as `setUnauthenticatedHandler`.

### `apps/web/src/stores/workbook.ts`

- Remove `CellEdit`, `MAX_UNDO`, the `undoable` and `redoable` lists, `replay`, `forgetEdits`, and the `record` argument of `setCells`. `syncStructure` and `refresh` no longer forget anything.
- `undoable` and `redoable` become booleans. The journaled handler sets `undoable = true, redoable = false`. `load` resets both. An undo or redo response sets both.
- `setCells` makes one step id per call, so the 1,000-cell batches of a paste are one step. `writeBlock` makes one and passes it to both `updateTable` and `setCells`, so a paste that grows the table is one step.
- `undo` and `redo` run on the `saves` chain, so they wait for typed edits and later edits wait for them. On `done` they call a new `applyChanged`, which generalizes `applyRewritten`: upsert or remove pages, tables, and views, `syncStructure`, apply cells, then keep the selection if it is still inside a table and otherwise select the first changed cell or nothing. A step that changed more than cells shows `Undid: <label>` or `Redid: <label>`. `refused` shows the message as an error notice.

`FormatBar.vue` and `GridView.vue` keep calling `store.undo`, `store.redo`, `canUndo`, and `canRedo`. `EditorView.vue` already routes to the first page when the open page disappears.

## Docs

- `CLAUDE.md`: a design rule that content writes inside `change` go through `ContentWriter`, and that the round-trip test in `undo.test.ts` must gain a line for each new write route.
- `DECISIONS.md`: a new entry with the choices above and the refusal rules. Update the Version history entry's paragraph on Ctrl+Z and the Live updates line about undo.
- `README.md` and `apps/web/src/views/HelpView.vue` (lines 116 and 845): what Ctrl+Z covers.
- `todo.md`: check off the P0 item.

## Tests

- `apps/server/src/undo.test.ts` (new), through `app.request()` as the other server tests do. `TestClient.request` already takes headers; add a helper that fixes a client id.
  - Round trip for every write route in `access.test.ts` except restore, spreadsheet rename, undo, and redo: snapshot, request, undo, compare with the first snapshot, redo, compare with the snapshot after the request. This test is what catches a mutation that writes around the writer.
  - The todo's case: type a cell, insert a row above it, rename the table, format a range, then undo four times and redo four times.
  - Requests sharing `x-step-id` undo together. A button click that grows a table and writes cells undoes as one step.
  - Two client ids on one account have separate stacks. A request with no client id is journaled and on no stack.
  - Each refusal rule, with a second client making the later change. A refused step leaves the step under it reachable.
  - A new change clears redo. Restoring a version clears the journal. A viewer gets 403. Pruning keeps the newest entries.
- `apps/web/src/stores/workbook.test.ts`: replace the "undo and redo" block and the refresh case at line 1099 with tests against `mockApi` (which gains `undo` and `redo`): the flags follow the journaled handler and the responses, `applyChanged` restores a deleted table with its cells, undo waits for pending saves, a refusal shows a notice.
- `FormatBar.test.ts` and `GridView.test.ts`: adjust to the mocked `undo`.
- `e2e/spreadsheet.spec.ts`: type a value, insert a row, bold a cell, press Ctrl+Z three times, and check the grid.

## Verification

1. `pnpm check`.
2. `pnpm exec vitest run --project server` with `TEST_DATABASE_URL` set, to run the journal against Postgres as well as PGlite. This needs a Postgres server the sandbox can reach.
3. `pnpm e2e`. Chromium does not start in the sandbox, so this runs outside it.
4. By hand in two tabs: confirm each tab undoes only its own edits, and that a row insert in one tab makes the other tab's earlier edit refuse with a notice.
