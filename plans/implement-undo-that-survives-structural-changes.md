# Undo through a server-side change journal

## Context

Ctrl+Z covers cell edits only. The browser keeps the stack (`undoable` in `apps/web/src/stores/workbook.ts`), and `syncStructure` empties it on every row or column edit and every rename, because those rewrite formulas and move addresses. Formatting is not recorded at all.

This plan moves undo to the server. `SpreadsheetRepository.change` already runs every change to a spreadsheet's contents, so it records what each change replaced in a journal table beside `versions`. Ctrl+Z asks the server to put the recorded state back. A stack then survives structural changes because the structural change is itself an entry that is undone first.

Decisions taken with the author:

- The journal lives on the server.
- Ctrl+Z covers every content change: cells, row and column inserts and deletes, renames of pages, tables, and columns, formatting, table resize, column type and formula, naming and removing column names, chart and text view edits, reordering blocks and pages, moving a block to another page, and creating or deleting pages, tables, and views.
- A button click and a checkbox or dropdown change are undoable. A button's writes undo as one step. Email it sent stays sent.
- A stack belongs to one tab (user id plus the `x-client-id` the tab already sends) and is gone on reload.

Not covered:

- Renaming, sharing, unsharing, and deleting the spreadsheet, which do not go through `change`. Deleting the spreadsheet removes its journal by cascade.
- Creating a spreadsheet. Its first page and table are not journaled.
- Restoring a version, which replaces every id and so clears the spreadsheet's journal.

## Order of work

The plan folds in three findings of the code review in `_scratch/2026-10-01-codex-review-2.md`, because this work rewrites the code they are in. A fourth, finding 3, is its own item under Bugs in `todo.md` and comes first.

| Review finding                                              | Where it is handled                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| 1 and 2 (criteria matcher, combined array results)          | Separate work, done.                                                    |
| 3 (queued writes are not reauthorized under the lock)       | Its own item in `todo.md`. Finish it before starting this plan.         |
| 8 (a rename can store formulas over the length limits)      | In `ContentWriter`, step 1.                                             |
| 6 (a failed page move can show the wrong order)             | In the web store, step 4. Undo of a reorder depends on the order shown. |
| 9 (a server update discards a chart source draft)           | In the web store and `ChartCard.vue`, step 4.                           |
| 4, 5, and 7 (rename timestamp, recursive `DO`, `loadError`) | Independent of this plan.                                               |

Steps:

1. Add the journal table and `ContentWriter`, split `locked` out of `change`, and move every content write onto the writer.
2. Add the request context and headers.
3. Add `undo`, `redo`, the refusal rules, and the routes.
4. Change the web client.
5. Update the docs.

## Journal

New table `journal` in `apps/server/src/db/schema.ts`, with a migration from `pnpm --filter @spreadsheet-app/server db:generate`.

| Column                             | Purpose                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `seq` bigint identity, primary key | Order of changes. Changes to one spreadsheet run under its lock, so `seq` order is the order they happened.          |
| `spreadsheet_id`                   | Cascade delete.                                                                                                      |
| `step` uuid                        | Entries undone together by one Ctrl+Z.                                                                               |
| `user_id`, `client_id`             | The stack the entry is on. `client_id` is null for a request without the header, and for a step taken off its stack. |
| `undone` boolean                   | Whether the entry is currently reversed.                                                                             |
| `rewrites` boolean                 | The change rewrote references: a row or column insert or delete, a rename, or a move of a block to another page.     |
| `label` text                       | "Delete row 3 of Sales", for the notice after an undo.                                                               |
| `data` jsonb, nullable             | What the change replaced. See below. Null when the change was too large to keep.                                     |
| `bytes` integer                    | Size of `data` as JSON text, for the byte budget. Zero when `data` is null.                                          |
| `created_at`                       | For pruning.                                                                                                         |

Index on `(spreadsheet_id, seq)`.

`data` holds state, not operations:

```ts
interface Recorded {
  pages: { id: string; before: PageRecord | null; after: PageRecord | null }[];
  tables: { id: string; before: TableRecord | null; after: TableRecord | null }[];
  views: { id: string; before: ViewRecord | null; after: ViewRecord | null }[];
  /** Each change is `[row, col, before, after]`. */
  cells: { tableId: string; changes: [number, number, string, string][] }[];
}
```

`null` means the thing did not exist. An undo writes every `before`, and a redo writes every `after`. Recording state keeps the inverse of each mutation out of the code: a delete, a rename, and a format change are all reversed by the same apply function.

Cells are grouped by table and stored as tuples because an insert or delete near the top of a large table records every moved cell, up to 100,000 of them. Repeating the table id and four keys per cell would triple the size of such an entry.

### Limits

The journal has four limits, all in `LIMITS`:

- `journalEntries`: 200 entries per spreadsheet.
- An age of one day.
- `journalBytes`: 64 MB of `data` per spreadsheet, summed over `bytes`.
- `journalEntryBytes`: 8 MB for one entry.

The byte limits exist because the entry count does not bound storage: one entry can hold every cell of a full table, and cell inputs can be 8,192 characters each.

Pruning runs after each journal insert and deletes entries oldest first by `seq` until the first three limits hold. Deleting oldest first keeps rules 1 and 2 under "When an undo is refused" sound: an entry is never kept after a later entry that would have blocked it is deleted. When pruning deletes part of a step, it takes the rest of that step off its stack (`client_id` set to null), so Ctrl+Z never undoes half a step.

A change over `journalEntryBytes` still succeeds. `ContentWriter` counts bytes as it records and drops the recorded state once past the limit, and the entry is stored with `data` null and its `rewrites` flag. The entry stays in the journal so that rules 1 and 2 still see it. Undoing it is refused with a message that names History, and `keepVersion` already keeps a version before a change to many cells.

## Server

### `locked` and `change` in `apps/server/src/repo/spreadsheets.ts`

`change` opens a transaction, locks the spreadsheet, checks write access under the lock, runs the work, and calls `touch`. The access check under the lock comes from the fix for review finding 3, which this plan assumes is in place. `change` splits in two so that undo and redo can hold the lock without calling `touch`.

- `locked(spreadsheetId, work)` opens the transaction, takes the lock, and checks write access. Undo and redo are queued writes like any other, and running them through `locked` gives them the same check.
- `change(spreadsheetId, work)` calls `locked`, creates a `ContentWriter`, passes it to `work` with `tx`, inserts one journal row when the writer recorded anything, prunes, and calls `touch`. `changePage`, `changeTable`, and `changeView` pass the writer on.

### `apps/server/src/repo/journal.ts` (new)

- `ContentWriter`: the one place that writes `pages`, `tables`, `views`, and `cells` inside a change. Methods: `insertPage`, `updatePage`, `deletePage`, the same three for tables and views, `setCells`, and `clearCells(tableId, where)`. Each reads the row or cells as they are, writes, and adds to a `Recorded`. A second write to the same thing keeps the first `before` and the last `after`. `deleteTable` and `deletePage` record what the cascade removes: the cells, and for a page its tables and views. The body of today's `storeCells` moves here.
- The writer refuses a cell input or column formula over `LIMITS.inputLength` and a view source over `LIMITS.viewSourceLength`, with a 422 that rolls the change back. Route bodies already check what the client typed. The writer's check covers what the server writes itself, which is how a rename that lengthens repeated references stores a formula that import later rejects (review finding 8).
- `applyRecorded(tx, entry, direction)`: checks, then writes. It removes what should not exist (views, tables, pages), upserts pages, tables, and views with their recorded ids, and stores cells. It writes without a `ContentWriter`: recorded states passed the writer's checks when they were stored, and an undo adds no entry.
- The checks that decide whether an entry can still be reversed, described under "When an undo is refused".

### Mutations in `apps/server/src/repo/spreadsheets.ts`

- Every mutation method writes through the writer in place of `tx.insert/update/delete` on those four tables: `createPage`, `renamePage`, `reorderPage`, `reorderPages`, `moveTable`, `moveView`, `deletePage`, `createTable`, `updateTable`, `nameColumns`, `formatCells`, `dropColumns`, `updateColumn`, `createView`, `updateView`, `deleteView`, `deleteTable`, `setCells`, `ensureRows`, `editStructure`, and the helpers `storeRewrite`, `storeColumnFormulas`, and `storeViewSources`. Each sets a label.
- These mark the entry `rewrites`: `editStructure`, the three renames, `moveTable`, and `moveView`. Marking it in `storeRewrite` covers the renames and moves in one place, since both reach it through `rewriteFormulas` and `rewriteForMove`.
- `createSpreadsheet` stops calling `createPage`. It calls `createFromFile` with a file of one page named `Page 1` holding one table named `Table 1` of `DEFAULT_TABLE_SIZE`. Creation then never enters `change`, so it writes no journal entry, and a new spreadsheet and an imported one are built by the same code. Without this the first page would be an undoable step whose undo removes the spreadsheet's only page.
- `restoreVersion` keeps its raw writes and deletes the spreadsheet's journal rows. `insertContents` stays raw: it also builds new spreadsheets.
- `keepVersion` calls stay. History is the recovery path after a reload, when the tab's stack is gone.

### `undo` and `redo`

New `undo(spreadsheetId)` and `redo(spreadsheetId)`. Each calls `findSpreadsheet(id, "write")` and then runs inside `locked`, not `change`: an undo records nothing, and it calls `touch` only when it wrote.

- Undo picks the newest step on the caller's stack with `undone = false`. Redo picks the oldest with `undone = true`. A step's entries are those with its `step` id and the caller's `user_id` and `client_id`, so a step id that another person's request also used selects nothing of theirs.
- `done`: apply the entries (newest first for undo, oldest first for redo) in a nested transaction, flip `undone`, and call `touch`. The spreadsheet's contents changed, so other sessions hear of it and versions are kept as for any change.
- `refused`: the nested transaction rolls back whatever the apply wrote, the step is taken off its stack in the outer transaction, and `touch` is not called.
- `nothing`: no step to pick. Nothing is written and `touch` is not called.
- A new recorded change by a stack deletes that stack's undone entries.

Skipping `touch` matters because it announces a change to every open session, each of which re-reads the spreadsheet, and it can keep a version.

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

The `AsyncLocalStorage` that holds the set of changed spreadsheets becomes a request context that also holds the client id, the step id, and whether the request journaled a step. `announceChanges` fills it from `x-client-id` and a new `x-step-id` header, with a random step per request when the header is absent. An `x-step-id` that is not a UUID is answered with 400. `change` reads the context through a `currentRequest()` function, as `noteChange` reads the set today. This reaches the repositories `runCell` builds in `apps/server/src/actions/run.ts` without passing arguments through, so a button's `ensureRows` and `setCells` calls share the request's step.

After the handler, the middleware sets the response header `x-undoable: 1` when the request journaled a step for a client.

### Routes

`POST /spreadsheets/:spreadsheetId/undo` and `/redo` in `apps/server/src/routes/spreadsheets.ts`. Both get a line in `writeRoutes()` of `apps/server/src/access.test.ts`.

`GET /spreadsheets/:spreadsheetId` adds `undoable` and `redoable` for the caller's stack to the snapshot it returns. The route adds them. `getSnapshot` in the repository is unchanged, because versions and formula rewrites also call it. A tab reads these flags when it re-reads the spreadsheet after a remote change, which is how it learns that a restore or pruning emptied its stack.

### When an undo is refused

A refused step is taken off its stack (`client_id` set to null) so the next Ctrl+Z reaches the step under it, and the answer is `outcome: "refused"` with a message. The same rules apply to redo with `before` and `after` swapped.

Call a later entry "in effect" when its `seq` is higher and `undone` is false. Within one stack, undo order means there are none, so rules 1 to 3 only bite when another tab or person has changed the spreadsheet since.

1. An entry that rewrote references, or that created or deleted a page, table, or view, is refused when any later entry is in effect. Its recorded cells no longer describe what the inverse should do: a formula someone typed after a row insert uses the new row numbers, and writing the old cells back would not move it.
2. Any entry is refused when a later entry in effect rewrote references. The entry's `before` text names rows or names that have since changed.
3. Each page, table, and view record must equal the entry's `after`, and each cell's input must equal its `after`. A cell someone else has since retyped fails this.
4. After the write: every table and page a record or cell refers to exists, the spreadsheet has at least one page, no stored cell is outside its table or in a formula column, and the limits `setCells`, `createPage`, and `nextPosition` enforce still hold. A unique-name violation counts as a refusal. A failure rolls the nested transaction back.
5. A step with an entry whose `data` is null is refused: the change was too large to keep.

Two people typing in different cells of one table can each undo their own edits. Rules 1 and 2 are stricter than necessary for cases such as one person adding a table while another types on a different page. Loosening them needs containment tracking and is left out.

## Shared: `packages/shared/src/index.ts`

`CLIENT_ID_HEADER` (moved from `changes.ts`), `STEP_ID_HEADER`, `UNDOABLE_HEADER`, and the four journal limits in `LIMITS`.

## Web

### `apps/web/src/api/client.ts`

- `api.undo(spreadsheetId)` and `api.redo(spreadsheetId)`.
- `api.setCells` and `api.updateTable` take an optional step id, sent as `x-step-id`.
- `check(response)` calls a handler registered with `setJournaledHandler` when the response carries `x-undoable`, the same pattern as `setUnauthenticatedHandler`.

### `apps/web/src/stores/workbook.ts`

- Remove `CellEdit`, `MAX_UNDO`, the `undoable` and `redoable` lists, `replay`, `forgetEdits`, and the `record` argument of `setCells`. `syncStructure` no longer forgets anything.
- `undoable` and `redoable` become booleans. The journaled handler sets `undoable = true, redoable = false`. `load` and `refresh` set both from the snapshot. An undo or redo response sets both. `HistoryPanel.vue` already refreshes after a restore, so the restoring tab's flags clear by the same path as every other tab's.
- `setCells` makes one step id per call, so the 1,000-cell batches of a paste are one step. `writeBlock` makes one and passes it to both `updateTable` and `setCells`, so a paste that grows the table is one step.
- `undo` and `redo` wait for every write the tab has in flight, and later writes wait for them. Otherwise Ctrl+Z pressed right after a change undoes the step before it. Today the tab's writes run on three chains (`saves`, `reorders`, and `pageReorders`) and view updates run on none. Undo and redo join `saves` and first await the other two chains and the view updates below.
- On `done`, `undo` and `redo` call a new `applyChanged`, which generalizes `applyRewritten`: upsert or remove pages, tables, and views, `syncStructure`, apply cells, then keep the selection if it is still inside a table and otherwise select the first changed cell or nothing. A step that changed more than cells shows `Undid: <label>` or `Redid: <label>`. `refused` shows the message as an error notice.
- `moveBlock` and `movePage` stop rolling back to the order captured when each move began (review finding 6). Each keeps the last order the server accepted. A failed move shows that order, and only when no later move is queued: a later move sends the whole order, so its success makes the server match what the tab shows. `applyChanged` updates the accepted order when an undo changes positions.
- `updateView` runs one request at a time per view, so an older response cannot replace the record a newer one returned (review finding 9).

### Components

- `ChartCard.vue` keeps its source draft while the input has focus, as `TextCard.vue` does with `editing`. Today it overwrites the draft whenever `props.view.source` changes, and after this plan an undo in the same tab is one more way for that to happen (review finding 9).
- `FormatBar.vue` and `GridView.vue` keep calling `store.undo`, `store.redo`, `canUndo`, and `canRedo`. `EditorView.vue` already routes to the first page when the open page disappears.

## Docs

- `CLAUDE.md`:
  - A design rule that content writes inside `change` go through `ContentWriter`, and that the round-trip test in `undo.test.ts` must gain a line for each new write route.
  - The rule on `change` gains `locked`: it holds the lock and the access check, `change` adds the journal and `touch`, and undo and redo use `locked` directly because they call `touch` only when they wrote.
- `DECISIONS.md`: a new entry with the choices above, the refusal rules, and the journal limits. Update the Version history entry's paragraph that begins "Ctrl+Z covers cell edits only" and the Live updates line "Undo survives a remote change to cells".
- `apps/web/src/views/HelpView.vue`: the shortcut row for Ctrl+Z and Ctrl+Y, and the History section's paragraph that begins "For a change to cells made a moment ago".
- `README.md`: the "History and files" section says what Ctrl+Z covers and when History is the way back.
- `todo.md`: check off the P0 undo item.

## Tests

- `apps/server/src/undo.test.ts` (new), through `app.request()` as the other server tests do. `TestClient.request` already takes headers; add a helper that fixes a client id.
  - Round trip for every route in `writeRoutes()` of `access.test.ts` except restore, spreadsheet rename, sharing, unsharing, spreadsheet deletion, undo, and redo: snapshot, request, undo, compare with the first snapshot, redo, compare with the snapshot after the request. The two move routes need a second page as the destination. This test is what catches a mutation that writes around the writer.
  - The todo's case: type a cell, insert a row above it, rename the table, format a range, then undo four times and redo four times.
  - Requests sharing `x-step-id` undo together. A button click that grows a table and writes cells undoes as one step. A step id reused by a second user undoes only the caller's entries. A malformed step id gets 400.
  - Two client ids on one account have separate stacks. A request with no client id is journaled and on no stack.
  - Each refusal rule, with a second client making the later change. A refused step leaves the step under it reachable.
  - A new change clears redo. Restoring a version clears the journal, and the next snapshot reports nothing to undo. A viewer gets 403.
  - Creating a spreadsheet writes no journal entry, and an undo right after answers `nothing`.
  - A `refused` and a `nothing` outcome leave `updatedAt` and the version list as they were, and publish nothing to the change feed.
  - Pruning keeps the newest entries under each limit. An entry over `journalEntryBytes` is stored without data, the change succeeds, and its undo is refused. Pruning part of a step takes the rest off its stack. The byte tests lower the limits through repository options so they need no megabytes of cells.
  - A rename that would lengthen a cell formula, a column formula, or a view source past its limit gets 422 and changes nothing.
- Access under the lock: the test the finding 3 fix adds gains a case for undo, where an editor's undo waits on the lock, the owner downgrades the editor, and the undo gets 403.
- `apps/web/src/stores/workbook.test.ts`: replace the "undo and redo" block and the refresh test "keeps what can be undone when only cells changed, and forgets it when a table did" with tests against `mockApi` (which gains `undo` and `redo`): the flags follow the journaled handler, the responses, and a refreshed snapshot; `applyChanged` restores a deleted table with its cells; undo waits for pending saves, reorders, and view updates; a refusal shows a notice.
  - A failed page move followed by a successful one leaves the second move's order showing. Two failed moves show the order before both.
  - Two overlapping `updateView` calls leave the later record in the store.
- `ChartCard.test.ts`: a change to `view.source` while the input has focus keeps the draft.
- `FormatBar.test.ts` and `GridView.test.ts`: adjust to the mocked `undo`.
- `e2e/spreadsheet.spec.ts`: type a value, insert a row, bold a cell, press Ctrl+Z three times, and check the grid.

## Verification

1. `pnpm check`.
2. `pnpm exec vitest run --project server` with `TEST_DATABASE_URL` set, to run the journal against Postgres as well as PGlite. This needs a Postgres server the sandbox can reach.
3. `pnpm e2e`. Chromium does not start in the sandbox, so this runs outside it.
4. By hand in two tabs: confirm each tab undoes only its own edits, that a row insert in one tab makes the other tab's earlier edit refuse with a notice, and that restoring a version in one tab disables Undo in the other.
