# Persistent row and column identity

This plan gives every row and column of every table an id that stays the same when rows and columns are inserted, deleted, or reordered. Storage, the wire protocol, and the undo journal name cells by those ids. The formula engine stays positional, and the server and the web app translate between ids and positions where they call it.

The plan describes the code at commit `4cd8c89`. It was first written at `077d26a` and revised after two reviews, the first of which is in `_scratch/2026-10-01-persistent-row-identity-review.md`. Implementation progress is recorded below.

## Implementation progress (2026-10-02)

Steps 1–11 are implemented. The engine remains positional; storage, the journal, requests, snapshots, and content changes use row and column IDs. The web store translates confirmed and pending ID-keyed inputs into the engine, applies responses and events in revision order, and preserves pending edits through structural updates. All editor mutations, including version restoration, use one ordered queue.

The interrupted implementation's server test type errors and zero-row version fixture are corrected. The web API, store, live events, new-row UI, draft revisions, and test fixtures now use the new protocol. `inputsAfterEdit` and its positional movement tests are removed; formula rewrite cases now exercise `formulasAfterEdit` directly. Documentation describes the enabled behavior.

Implementation decisions carried forward from the snapshot:

- Steps 4, 6, 7, 8, and 10 share migration 0010 because no intermediate version was deployed. It verifies every cell has matching identities before removing positional columns.
- Mutation routes return `{ revision, changed }`; creates return their records plus `change`. Click effects share one transaction, journal step, and revision.
- OVERWRITE removes surplus rows when its range covers every writable column of a data table. Formula columns need not be included. This extends the original full-width condition because action destinations cannot write formula columns.
- Existing data tables retain trailing empty rows during migration. Their formula columns now compute in those rows.

Regression coverage includes pending typing across structural responses, paste growth behind queued insertions, delayed paste selection, selection across newly created columns, overlapping optimistic block and page moves, consecutive failed saves to one cell, repeated Add row clicks, running buttons following IDs, queued version restoration, duplicate and out-of-order content notifications, stale draft revisions, and typing into an empty data table.

### Validation

- Focused store validation passed: 128 tests across `identity.test.ts` and `workbook.test.ts`.
- `pnpm check` passed after the deferred-response regressions: lint, formatting, typecheck, and all 76 test files; 2,852 tests passed and 2 were skipped.
- User-run PostgreSQL validation passed all 415 tests in `_scratch/2026-10-02T06-15-pnpm-e2e-test-postgres.log`. The later run hit an unordered deleted-row assertion; that assertion is now order-independent locally.
- Latest user-run browser validation: 23/25 passed in `_scratch/2026-10-02T06-22-pnpm-e2e-test-postgres.log`, including the two-tab draft-preservation test. The two failures exposed delayed paste selection and optimistic reorder issues. Both fixes now have deferred-response regression tests, and the e2e block-order reader now reads atomically and polls expected orders.
- Docker socket permissions and Node proxy handling prevent integration runs in this sandbox. The user asked agents to request that they run these tests; do not bypass the restrictions.
- Browser and PostgreSQL validation still need a user-run integration pass. See `plans/persistent-row-identity-handoff.md` for the requested run and follow-up.

## Decisions in brief

| Question                 | Decision                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| Scope                    | Rows and columns of every table, plain or data. One storage model.                                                                 |
| Row storage              | A `table_rows` table: `id`, `table_id`, and an order key. Inserting a row writes one record.                                       |
| Column storage           | An ordered array of column ids on the table record.                                                                                |
| Cell storage             | Keyed by `(row_id, col_id)`. A structural edit moves no cells.                                                                     |
| A1 references            | Stay positional and are still rewritten on structural edits.                                                                       |
| Sort and filter in place | A display setting on the table. The stored order, and so what `A2` reads, does not change.                                         |
| Wire                     | Every request that named a row or column by position names it by id. A deleted row or column answers 409. No table version number. |
| Engine                   | Does not learn row ids. `CellId` stays `{ tableId, row, col }`.                                                                    |
| Undo                     | Entries name cells and rows by id. Refusal rules 1 and 2 narrow to one rule about formula text.                                    |
| File format and versions | No ids. The one change: a data table may have zero rows.                                                                           |
| Data tables              | Hold only the rows that were added, which can be none. The grid offers one new row below the last.                                 |
| Live updates             | Responses and events carry the change and its revision, and the client applies both in revision order.                             |
| Limits                   | 1,000 rows per table stays. A new limit caps row records per spreadsheet.                                                          |

## Baseline behavior before implementation

Each claim below was checked by reading the file named. The files that changed between `077d26a` and `4cd8c89` were read again through their diffs.

- **Cells are keyed by position.** The `cells` table has the primary key `(table_id, row_index, col_index)`, and `tables` holds `row_count` and `col_count` (`apps/server/src/db/schema.ts`).
- **A save names a position.** `setCells` in `apps/server/src/repo/spreadsheets.ts` reads the table again under the lock and refuses only a cell outside the table or in a formula column. A cell inside the table is written wherever the request's row and column now point.
- **Four more requests name a position.** `updateColumn` takes a column index, `formatCells` a range of indexes, and `editStructure` an index and a count (`apps/server/src/routes/tables.ts`).
- **A click and a control input name a position.** `cellParam` in `packages/shared/src/index.ts` is `tableId`, `row`, `col`. `runCell` in `apps/server/src/actions/run.ts` evaluates `workbook.getValue(cell)` for that position under the lock.
- **The client keeps its selection by position across a refresh.** `refresh` in `apps/web/src/stores/workbook.ts` keeps the selected row and column when they are still inside the table. An edit that is open while someone else inserts a row above is then saved to a different cell.
- **A structural edit rewrites every moved cell.** `applyEdit` calls `inputsAfterEdit` in `packages/engine/src/rewrite.ts`, which returns each cell at its new position and an empty input for each position left behind. `ContentWriter.setCells` stores them all and records each in the journal.
- **Undo refuses on any later reference rewrite.** `changeHistory` refuses a step that rewrote references, or created or deleted a page, table, or view, when any later change is in effect. It refuses any step when a later change in effect has `rewrites` set. `applyEdit` and `storeRewrite` set that flag even when no formula changed.
- **Undo refuses after a later write to the same content.** `changeHistory` also refuses a step when a later change in effect wrote a page, table, view, or cell the step recorded. `touchSame` in `apps/server/src/repo/journal.ts` compares cells by table, row, and column.
- **Journal entries name cells by position.** `JournalData.cells` in `journal.ts` holds `[row, col, before, after]`.
- **A data table shows its unused rows.** `GridView.vue` draws `table.rowCount` rows. The engine hides the computed cells of empty rows by counting typed cells per row (`typedInRow` and `trackRow` in `packages/engine/src/workbook.ts`).
- **`APPEND_ROW` scans for the first row below the content.** It evaluates the whole range, finds the last row that holds something, and emits `ensureRows` with the row count it needs (`packages/engine/src/functions/actions.ts`).
- **A remote change triggers a full read.** The events stream in `apps/server/src/routes/spreadsheets.ts` counts changes and sends no content. `apps/web/src/api/live.ts` calls `refresh` for each. `refresh` and `load` read through `readSettled` in the workbook store, which waits until no change made in the tab is unanswered.
- **Versions and exports carry no ids.** `saveVersion` writes the `spreadsheetFile` format, and `restoreVersion` deletes every page and inserts the file's contents, which gives pages and tables new ids and empties the journal.

Not verified:

- I did not run any test or the app. Every statement about behavior comes from reading code.
- I read `GridView.vue`, `apps/web/src/api/client.ts`, `access.test.ts`, `undo.test.ts`, and `concurrency.test.ts` only through searches for specific lines.
- How each function in the registry treats a range with no rows. `evaluate.ts` returns a range with an empty list of rows for one, which I read. I did not read the functions that receive it.
- Whether Postgres orders `COLLATE "C"` keys as JavaScript does. I ran a probe against PGlite only: it accepted the collation and the foreign key on `(table_id, row_id)`, and ordered ten mixed keys as JavaScript did.
- Whether `schema.ts` can state a column's collation. I found no such option in the installed drizzle-orm 0.45. If there is none, the collation is written by hand in the migration file, and a test must check that it is there.
- Whether anything outside `countEmails` and the click tests reads `action_runs.row_index` and `col_index`. A search found the table used only in `run.ts`, `spreadsheets.ts`, `schema.ts`, and `click.test.ts`.

## Scope

**Decision.** Every row and every column of every table has an id. Plain grids do not keep positional storage.

Alternatives rejected:

- **Ids for rows of data tables only.** Problems 1 and 2 happen in plain grids as often as in data tables. Two storage models would also put a branch in every path that touches cells: `setCells`, `applyEdit`, the journal, the snapshot, import, and undo. One model has one place that translates.
- **Ids for rows only, with a table version number for columns.** A save or click that crosses someone's column insert would then be refused and typed again. Cells keyed by column index would still be rewritten on a column insert, up to 100,000 of them. Journal entries would still name a column by position, so undo would keep refusing after column edits. Column ids cost one small array per table.

## Storage

### Rows

```
table_rows
  id         uuid primary key
  table_id   uuid not null references tables(id) on delete cascade
  order_key  text collate "C" not null
  unique (table_id, order_key)
  unique (table_id, id)
```

A row's place in its table is the place of its order key among the table's keys in byte order. A new key is made between two neighboring keys without changing either, so inserting a row writes one record. The `"C"` collation makes Postgres order the keys as JavaScript string comparison does.

A pure module in `packages/shared` makes keys: `keyBetween(before, after)` and `keysAfter(last, count)`. Adding at the start or the end of a table must lengthen keys only with the logarithm of the number of rows added, as counting up or down does. Only repeated inserts between the same two neighbors lengthen a key steadily, by about one character for every five inserts in the implemented midpoint generator. In the tested gap between `a0` and `a1`, the 311th insert produces a 65-character key. The server alone assigns keys, under the spreadsheet's lock. How long a key gets depends on the table's history of inserts and deletes, not on how many rows it has now. When a new key would pass 64 characters, the server gives every row of the table a fresh, evenly spaced key in the same change, and deletes the spreadsheet's journal entries, because they hold the old keys. Restoring a version empties the journal for the same kind of reason.

A row id is a UUID. The client makes the id of a row it creates, so it can name the row before the server answers and a repeated request does not add the row twice. A row id from a client is checked like any other input. An id that exists in another table is refused with 409, whichever spreadsheet that table is in, and the answer does not say where the id exists. A counter per table was rejected: undoing a row insert would put the counter back, the next insert would reuse the id, and a save still on its way to the undone row would be applied to the new one.

Alternatives rejected:

- **An ordered array of row ids on the table record.** The journal records a table as it was before and after a change. A table of 1,000 rows would put about 76 KB into the journal for each row added, and any two changes to one table would block each other's undo through the rule that a recorded table must still be as the step left it. Forms that append rows are the case that would suffer most.
- **An integer position, renumbered on insert.** An insert near the top updates up to 1,000 row records. The journal would have to record each, or record the operation in place of the state, which the undo design chose against.

### Columns

`tables.col_ids` is a JSON array of UUIDs in column order. `TableRecord` gains `colIds`. A table has at most 100 columns, a column edit already rewrites the table record (`columns`, `formats`), and the array is journaled with the record at no extra cost.

A `table_columns` table like `table_rows` was rejected for now. It would allow two people's column edits to be undone independently, which is rare, and it would move `ColumnDefinition` out of the table record that the engine, the file format, and the client all read.

### Cells

```
cells
  table_id  uuid not null references tables(id) on delete cascade
  row_id    uuid not null
  col_id    uuid not null
  input     text not null
  updated_by, updated_at
  primary key (row_id, col_id)
  foreign key (table_id, row_id) references table_rows(table_id, id) on delete cascade
  index (table_id)
```

The foreign key on `(table_id, row_id)` makes the database refuse a cell whose row belongs to another table. No foreign key can cover `col_id`, because column ids live in a JSON array. The repository checks that a cell's column id is in its table's `col_ids` wherever cells are written: in `setCells`, in action effects, and when an undo or redo restores cells.

`tables.row_count` and `tables.col_count` are dropped. The row count is the number of `table_rows` records and the column count is the length of `col_ids`. The snapshot gives both to the engine as it does today. `TableRecord`, which the journal stores and compares, holds neither, so one person adding a row does not make another person's recorded table look changed.

### What a structural edit writes

| Edit                      | Today                                                                                                    | With ids                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Insert a row              | Every cell below it, each also in the journal. About 100,000 writes for row 1 of a full table.           | One `table_rows` record for each new row.                   |
| Delete a row              | Every cell below it.                                                                                     | The row's record and its own cells.                         |
| Insert or delete a column | Every cell to its right.                                                                                 | The table record. A delete also removes the column's cells. |
| Any of them               | Formulas that read the table, view sources, formula columns, and format rules, where their text changes. | The same.                                                   |

An edit still reads the whole spreadsheet to find the formulas to rewrite. Reading only the cells whose input starts with `=` is a later optimization and not part of this plan.

Format rules stay positional and are still shifted by `formatRulesAfterEdit`.

### Migration

The migration runs in two parts, in implementation steps 1 and 4.

1. Create `table_rows` and add `tables.col_ids`. For each table, insert `row_count` rows and set `col_ids` to `col_count` new UUIDs. The backfill is SQL in the migration file, as `0007_version_blocks.sql` already does for versions. Backfilled keys are `f` followed by a five-digit zero-padded row index and `V`, for example `f00000V`. The `f` prefix declares a six-digit integer part; the shared generator requires that prefix for logarithmic growth at either end. `generate_series` and `lpad` can produce these keys, and a shared test checks all 1,000 backfilled row indexes. Delete every `journal` record: an entry made before this migration holds table records without `colIds` and no rows, so undoing a table delete would bring back a table with no row records.
2. Add `row_id` and `col_id` to `cells`. Fill them by joining each cell to the row whose rank by key equals `row_index` and to the element of `col_ids` at `col_index`. Count cells that find no row or column and abort the migration with a diagnostic if the count is nonzero: `checkRestoredState` and `setCells` should have kept that count at zero. Do not silently delete unmatched cells. Replace the primary key, drop `row_index` and `col_index`, and drop `row_count` and `col_count`. Delete every `journal` record again, because its entries name cells by position. A journal entry lives at most one day and belongs to one open tab.

Kept versions need no migration. They are files without ids.

## Formula semantics

**A1 references stay positional and keep being rewritten.** `B2` means the cell in the second row and second column of the stored order. A structural edit rewrites formula text in cells, view sources, and formula columns as it does now.

Storing a reference as row and column ids, and printing it as `B2`, was rejected. A cell would no longer store what was typed. Ranges, open-sided ranges, `$` pins, and fill translation would each need a rule for ids. The export file and the journal would need a translation in both directions. Named columns are the project's answer to positional references, and they are unaffected.

**`[Column]` and `Table[Column]` keep their meaning and their text.** `[Price]` is the Price cell of the formula's own row. `Sales[Price]` is the Price cell of every row of Sales. Because a data table will hold only rows that were added, `Sales[Price]` and `A:A` stop covering unused rows.

**Sort and filter in place are display settings.** A table would store which columns it is sorted by and which rows its filter hides, and the grid would draw rows in that order. The stored order does not change, so `A2` reads the same cell under any sort, and `SUM(Sales[Amount])` includes rows a filter hides. The grid shows each row's stored number, so the numbers are out of sequence while a sort is on.

Reordering the stored rows on a sort was rejected as the default. It changes what every positional reference reads, it shows up for every other person, and it rewrites every order key of the table. A "sort permanently" command can be added later as a structural edit.

Row ids are what make the display setting workable: an edit made in the third row shown is saved to that row's id, and a row that moves on screen after an edit keeps its identity. This plan does not implement sort or filter.

## Wire protocol

**A save.** `PUT /tables/:tableId/cells` takes `{ cells: [{ rowId, colId, input }], appendRows?: [rowId, ...] }`. `appendRows` lists ids the client made for rows to add at the end of the table. The server creates the ones that do not exist, in the same change and the same journal entry as the cells. An id that names a row deleted earlier is refused with 409 `row_deleted`: without that, a request repeated after its row was deleted or undone would bring the row back with its old cells. The server knows a deleted id from `deleted_rows`, described under the undo journal.

**A click and a control input.** `POST /tables/:tableId/cells/:rowId/:colId/click` and `.../input`. The paths keep their form and the two parameters become UUIDs.

**Other requests that name a row or column.** Each of these takes a position today and has the same defect as a save. Each takes ids from step 2:

- `PATCH /tables/:tableId/columns/:colId` changes a column's name, type, or formula. Typing a formula into a cell of a formula column goes through this route.
- `POST /tables/:tableId/formats` takes the ids of the first and last row and column of its range. A `null` end still means "to the edge of the table".
- `POST /tables/:tableId/edits` names what it acts on: an insert gives the id of the row or column to insert before, or `null` for the end, and a delete gives the ids to delete. The ids of a delete need not be next to each other by the time the request runs: someone may have inserted a row between two of them. The server sorts them by their position under the lock, groups them into runs of neighbors, and applies each run as one positional edit, last run first, so that an earlier run's positions are not moved by a later one. Rows that were not named are kept. All runs are one change and one undo step.

`PATCH /tables/:tableId` keeps `rowCount` and `colCount`, which mean a size counted from the start of the table and name no particular row.

**When the row or column is gone.** The server resolves ids to positions under the spreadsheet's lock. A request that names a row or column that no longer exists is refused as a whole with 409 and the code `row_deleted` or `column_deleted`. The client puts the cells back as `putBack` does now and says that the row was deleted. A silent drop was rejected: the person would not learn that the edit was lost.

**The client translates when the person acts.** The store turns the selected position into ids when the edit, click, or input is made, and the queued request carries ids. The selection and an open cell editor are found again by id after a refresh, and are cleared when their row or column is gone.

**Responses.** From step 1 the snapshot lists each table's rows as `{ id, key }` in order, and each table record holds `colIds`. From step 5 every cell the server sends is `{ tableId, rowId, colId, input }`.

**No table version number.** Ids make it unnecessary for addressing. One race remains: a formula typed while another person's row insert has not yet reached the tab holds row numbers from before the insert. The cell is correct and the references in its text are stale. Step 8 adds a revision number to the spreadsheet, and from step 10 the server uses it to refuse such a formula. The revision sent is the one the tab had applied when the edit was opened, kept with the draft through the save queue and through the batches of a paste. The revision at the time the request is sent would be newer than the text. The same check covers the formula of a formula column and the source of a chart or text view.

The refusal is broad. A structural edit anywhere in the spreadsheet, made after the edit was opened, refuses the formula, even when the formula names no table the edit touched. With one person using a spreadsheet it never happens. With several it would refuse formulas that took a while to type, so it must be narrowed to edits of the tables the formula names before a spreadsheet is edited by several people regularly. Step 10 adds that to `todo.md`.

A table version number as the first step was considered, because it is smaller: one column and three checks. It turns a misplaced save into a refused one that the person types again, it refuses every save that crosses any structural edit, and step 1 would then delete it.

## Engine

**`Workbook` does not learn row ids.** `CellId`, the dependency index, ranges, spills, and `Effect` stay positional. The engine gains no dependency and performs no I/O.

`TableLayout` in `packages/shared` holds one table's row ids and column ids in order and converts both ways. The server builds layouts from the rows it reads under the lock and uses them in three places: to resolve a request's ids, to build the positional `WorkbookData` it gives the engine, and to turn the positional `setCell` effects of an action plan back into ids. All three happen in one transaction on one read, so they agree.

The web store keeps the document by id: cell inputs keyed by row id and column id, and a layout for each table. It builds the engine's positional data from that. After a row or column edit it updates the layout and builds the workbook again. Today the same edit applies up to 100,000 `setCell` calls, so a rebuild costs no more.

Changes inside the engine:

- `rewrite.ts` exports a function that returns only the formulas a structural edit rewrites. It is built on the existing private `rewriteInputs` with `editDecider`, and it leaves out formulas in the rows or columns the edit deletes, which `rewriteInputs` alone would return. `inputsAfterEdit`, which also moves cells, is removed when its last caller is (step 5).
- The engine stops counting typed cells per row, and a formula column computes in every row (step 7).
- A table can have zero rows (step 7). A range over it is empty.
- `PlanContext` tells an action whether a table is a data table, so that the append actions can add after the last stored row (step 7).

Putting ids in the engine was rejected. Every range read and every dependency lookup is a loop over row numbers, and an id-keyed cell map would need a translation inside those loops. Relations between tables will need the engine to find a row by id. `TableDefinition` can then carry `rowIds` as plain data, which keeps the engine pure.

## Undo journal and versions

**Entries name things by id.** `JournalData.cells` becomes `[rowId, colId, before, after]`. `JournalData.rows` is added: for each table, `[rowId, keyBefore | null, keyAfter | null]`. Column ids travel in the table record. `ContentWriter` gains `insertRows` and `deleteRows`, and its `deleteTable` records the table's rows so that an undo brings them back with the same ids.

`deleted_rows (row_id primary key, spreadsheet_id, deleted_at)` lists the ids of deleted rows. `deleteRows` adds to it, and `insertRows` removes from it, so an undo or redo that restores a row clears its entry. Entries are pruned at the journal's age limit, when the journal is pruned. A request repeated more than a day after its row was deleted is not guarded against.

An entry for a row insert holds the new rows and the formulas whose text changed. It no longer holds every cell below the insert, so it stays far under the 8 MB entry limit.

**Refusal rules.** Numbers refer to the rules in the DECISIONS entry "Undo through a server-side journal".

| Rule today                                                                                  | After                                                                                                           |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1. A step that rewrote references is refused after any later change.                        | Refused only when a later change in effect wrote formula text.                                                  |
| 1. A step that created or deleted a page, table, or view is refused after any later change. | Unchanged. Narrowing it is a separate piece of work.                                                            |
| 2. Any step is refused after a later change that rewrote references.                        | Refused only when the step would restore formula text. A step that restores typed values is allowed.            |
| 3. Each recorded thing must still be as the step left it.                                   | Kept, with the changes below.                                                                                   |
| 4. What the undo writes must still fit.                                                     | Kept. "No cell outside its table" becomes a check that each restored cell's row and column belong to its table. |
| 5. A change too large to record is refused.                                                 | Kept.                                                                                                           |

Rules 1 and 2 become one rule: an undo or redo is refused when it and a later change in effect conflict, and they conflict when one changed what references mean and the other writes formula text. For the step being undone or redone, "writes" means what the undo or redo would put back. For a later change, it means what the change left in place. Formula text is a cell input that starts with `=`, a view source, or a formula column's formula.

The rule cannot be dropped entirely, because ids fix which cell an entry means but not what a formula's text means. Two cases show it:

- Ada replaces `=A5` in B1 with `7`. Grace inserts a row above row 5. Ada's undo would restore `=A5`, which now reads a different cell.
- Grace inserts a row. Ada types `=A6` in D1, meaning the cell that was A5. Grace's undo removes the row and does not touch D1, which then reads the wrong cell.

Rewriting restored text through the later edits was rejected for now. The journal would have to record each edit as an operation with the page and table names of that moment, and undo would replay them. It can be added later without a storage change.

Two changes that both altered what references mean do not conflict by that alone. Grace inserts a row, Ada inserts another, and neither touches a formula: Grace's undo removes her row by id and nothing else is affected. When formulas are involved, one of the two wrote formula text and the rule applies. Grace deletes a row that `=A5` read, which leaves `#REF!`. Ada inserts a row above. Grace's undo would put back `=A5`, which is formula text, after a change that altered what references mean, so it is refused. Format rules are positional and sit in the table record, so a later edit that shifted them is caught by rule 3.

The journal gains a `formulas` flag, set by `ContentWriter` when the state a change leaves holds formula text it wrote. Whether an undo or redo would write formula text is read from the entry's own data. `rewrites` keeps its present meaning and is set by every change that alters what a reference means: a row or column insert or delete, a rename, and a move, whether or not it changed any existing text. The second case above needs this. If Grace's table held no formula when she inserted the row, her insert changed no text, and Ada's `=A6` still depends on it.

Changes to rule 3:

- A row or column that the step created must hold no cell when the step is undone, apart from the cells the step itself wrote. Otherwise the undo would delete what someone typed into it. The exception lets a step that added a row and wrote into it be undone.
- `changeHistory` already refuses a step when a later change in effect wrote a page, table, view, or cell the step recorded. That check compares cells by id and gains rows.
- A recorded row is compared with the stored one by whether it exists. Its key is not compared.

A restored row takes its recorded key. When another row has taken that key since, the restored row takes a new key next to it. Because keys are not compared, a redo after such an undo is not refused.

**Versions and the export file keep their format, with one loosening.** A table with named columns may have a `rowCount` of 0. A file written before the change still imports, and `version` stays 1. The file names rows and columns by position and has no ids, as the Import and export decision chose. `saveVersion` and export write positions through the layout. A restore or an import gives rows and columns new ids as it already gives pages and tables new ids, and a restore already empties the journal.

## Auto-growing data tables

**No table stores a row count.** A plain grid keeps a fixed set of rows that the person adds to and removes from. A data table holds the rows that were added to it and no unused rows.

**The grid offers a new row.** Below a data table's last row the grid draws one empty row that is not stored. Typing into it sends the cell with a new row id in `appendRows`, and the row and the cell are one undo step. A paste that runs past the end of any table sends `appendRows` for the extra rows, which replaces the `rowCount` request `writeCells` makes today. The resize dialog keeps working: the server adds or deletes rows at the end.

**A data table can have no rows.** Naming the columns of an empty table leaves none, and so does deleting the last row or an `OVERWRITE` with no data. The grid then shows the column headers and the new-row line. A plain grid keeps at least one row, as now, so removing a table's column names from a table with no rows adds one.

**A row exists until it is deleted.** Clearing every cell of a row leaves an empty row. This keeps a row's id stable for a relation that points at it.

**Naming a table's columns deletes its empty rows at the end**, as any rows are deleted, so formulas that read them are rewritten. `SUM(A1:A20)` over a table with five filled rows becomes `SUM(A1:A5)` and does not grow when a row is added. `A:A`, `A2:A`, and `Sales[Amount]` do grow.

**Actions.** The engine keeps emitting positional effects, and `ensureRows` keeps its meaning. The server's handler adds row records where it now raises `row_count`.

| Action       | Change                                                                                                                                                                                                                                                                                                              |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APPEND_ROW` | On a data table, with a range that is open at the bottom, the new row goes after the last stored row. A cleared row at the end is not written into, because its id may be what a relation points at. With a range that names its last row, and on a plain grid, the scan for the first row below the content stays. |
| `INSERT`     | The same rule as `APPEND_ROW`.                                                                                                                                                                                                                                                                                      |
| `UPDATE`     | Rows it matches are written by position and resolved to ids under the lock. Rows that match none are added by the same rule as `APPEND_ROW`.                                                                                                                                                                        |
| `OVERWRITE`  | No change in step 7: it empties cells, which on a data table leaves empty rows at the end. Step 11 makes it delete them.                                                                                                                                                                                            |

`APPEND_ROW(Sales, ...)` with a table name in place of a range needs the whole-table reference syntax that `todo.md` lists separately.

## Live updates

**A change event carries the change.** `ContentWriter` already holds every page, table, view, cell, and row a change wrote. The state each was left in is the same `ChangedContent` that undo returns and the store's `applyChanged` applies.

- `spreadsheets.revision` counts changes. The snapshot returns it and each event carries it.
- One transaction that holds the spreadsheet's lock produces one revision and one `ChangedContent`. A click calls `ensureRows` and `setCells` as separate changes inside its transaction, possibly on several tables. Each adds what it wrote to the request's context, as `noteChange` does now, and the holder of the lock raises the revision once before it commits. A click whose writes are rolled back produces no revision.
- The response to every change carries the revision the change produced and the same `ChangedContent` its event carries. This includes a button click and a control input, whose response today lists cells and resized tables only.
- A tab hears its own changes on the stream too. Leaving them out, as the stream does now, would look like a gap.
- The store applies responses and events through one function, in revision order. Whatever arrives with the next revision is applied. Anything later waits briefly for the missing revisions, and then the tab reads the spreadsheet again. A tab's own change arrives twice, as a response and as an event, and is applied from whichever comes first. A structural change of the tab's own is therefore in its layout before any later event that depends on it, and a slow response cannot overwrite newer state.
- `applyChanged` becomes the one way the store takes in a change. `applyRewritten` and the code that applies a click's cells and tables go away.
- A change of more than 1,000 cells, or one too large to journal, is announced without content, and tabs read the spreadsheet again.

Row ids make this practical. A tab's unsaved edits are keyed by id, so applying someone else's row insert does not move them to other cells.

An event will hold content, which it does not today. The stream checks read access once, when it opens. From step 9 the stream handler checks `findSpreadsheet(id, "read")` through the repository before it sends each event, so a person whose share ended receives nothing further.

## Limits

- `LIMITS.tableRows` stays 1,000. Row ids do not change what the engine or the grid costs for each row. Raising it still needs the two items `todo.md` names: indexing ranges by row in `graph.ts`, and drawing only the rows in view.
- Rows become records, so a spreadsheet of 2,500 tables of 1,000 empty rows would hold 2.5 million of them, and a snapshot lists every row id. A new `LIMITS.spreadsheetRows` of 100,000 caps the rows of one spreadsheet. A spreadsheet already over it can only lose rows until it is under, as with the cell limit.
- `structuralEditBody.count`, `updateTableBody.rowCount`, and the file format keep using `tableRows`.

## What row ids make possible

None of these is implemented by this plan.

- **Sort and filter in place:** the display setting described under formula semantics.
- **A button in every row:** a click names the button's cell by row id, and the server finds the row's position under the lock. `[Column]` in the button's formula then reads that row.
- **Relations between tables:** a cell holds a row id of another table. The engine receives `rowIds` on `TableDefinition` to find the row.
- **A form that adds a row:** the form sends `appendRows` with an id it made, so a retry does not add the row twice.

## Implementation steps

Each step ends with `pnpm check` passing. The last section lists the steps that also need `pnpm test:postgres` and `pnpm e2e`, which do not run in the sandbox.

| Step | Does                                                        | Fixes                               |
| ---- | ----------------------------------------------------------- | ----------------------------------- |
| 1    | Ids exist, and a save, click, and control input name them   | Problem 1 for cells                 |
| 2    | Column changes, formats, and row or column edits name ids   | Problem 1 for the other requests    |
| 3    | A limit on the rows of a spreadsheet                        |                                     |
| 4    | Cells are stored by id                                      | The cost of a structural edit       |
| 5    | The wire and the web store hold cells by id                 |                                     |
| 6    | The undo conflict rule                                      | Problem 2                           |
| 7    | Data tables hold only their rows                            | Problem 3                           |
| 8    | One revision for each change, applied in order by the store |                                     |
| 9    | Change events carry the change                              | The full read after a remote change |
| 10   | A formula typed against a stale structure is refused        | The last case of problem 1          |
| 11   | `OVERWRITE` deletes the rows it empties                     |                                     |

### Step 1: rows and columns get ids, and a save, click, and input name them

This step fixes problem 1 for cells. It cannot be smaller: the fix needs the client to name what it saw, so the ids, the snapshot that carries them, and the three requests that use them go together. Cell storage does not change.

1. `packages/shared`: the order key module, with renumbering, `TableLayout`, and the request schemas `cellInput` with `rowId` and `colId` and `cellParam` with two UUIDs.
2. Schema and migration part 1, which empties the journal.
3. `ContentWriter`: `insertRows`, `deleteRows`, rows recorded on `insertTable` and `deleteTable`, and `JournalData.rows`. `applyRecorded` restores rows.
4. `SpreadsheetRepository`: `insertTable`, `insertContents`, `applyEdit`, `updateTable`, `ensureRows`, and `nameColumns` keep `table_rows` and `col_ids` in step with `row_count` and `col_count`. A private method resolves a request's ids to positions inside `changeTable` and throws the 409, and `setCells` uses it. `getSnapshot` returns each table's rows and `colIds`.
5. `run.ts`: `runCell` takes ids and resolves them against the snapshot it reads under the lock.
6. Web: the store holds a layout for each table, translates when the person acts, updates the layout from the response to each structural edit, and finds the selection and an open editor by id after a refresh.

Tests:

- Shared: key properties with generated input (a key between two keys sorts between them, repeated insertion at one place stays ordered, adding at either end lengthens keys slowly, backfilled keys are accepted), and `TableLayout` both ways. The test reports how many inserts between the same two keys reach 64 characters.
- Server: the same keys sort the same way in JavaScript and in the database. This runs on PGlite and, with `TEST_DATABASE_URL`, on Postgres. A second test reads the collation of `table_rows.order_key` from the database, in case `schema.ts` cannot state it.
- Server, new `identity.test.ts`: Ada reads the snapshot, Grace inserts a row above, and Ada's save, click, and control input each reach the row Ada named. The same for a column insert. Each of the three answers 409 when Grace deleted the row or the column.
- Server: enough inserts at one place to pass the key length renumber the table, keep the row order and ids, and empty the journal.
- Server: a tab that had a step to undo before the migration has none after it.
- Server: after every case in `undo.test.ts`, the number of `table_rows` records equals `row_count` and the length of `col_ids` equals `col_count`. Undoing a row insert, a table delete, and a page delete brings back the same row ids.
- `access.test.ts`: the cells, click, and input lines send ids. The click and input routes keep their place in `writeRoutes` under their new parameter names, which the test's comparison with the registered routes checks.
- Migration: a database built at the previous schema with cells and a data table migrates to the same number of rows and columns for each table.
- Web: a change made at a position sends that position's ids, and a refresh that moves the selected row keeps the selection on it.

### Step 2: column changes, formats, and edits name ids

1. `packages/shared`: `columnParam` with `colId`, the format range with ids, and `structuralEditBody` with the ids it acts on.
2. `updateColumn`, `formatCells`, and `editStructure` resolve ids with the method from step 1. `editStructure` groups the ids of a delete into runs of neighbors and applies them last run first.
3. Web: the store sends ids for each of the three, taken when the person acts.

Tests:

- `identity.test.ts`: Grace inserts a column to the left, and Ada's change to a column's formula, name, and type reaches the column Ada named. Ada's format of a range and her insert and delete of a row reach the rows she named after Grace inserts a row above. Each answers 409 when what it names is gone.
- `identity.test.ts`: Ada selects rows 2 to 4 for deletion, Grace inserts a row between them, and Ada's delete removes Ada's three rows and keeps Grace's. Formulas that read the table are as two separate deletes would leave them, and one undo brings back all three rows.
- `access.test.ts` and `undo.test.ts`: the column, format, and edit lines send ids.
- Web: typing a formula into a cell of a formula column sends the column's id.

### Step 3: limit the rows of a spreadsheet

`LIMITS.spreadsheetRows` and a check in `ContentWriter` whenever a table is inserted or its row count grows. Import and `checkRestoredState` apply it too. Undo may reduce the row count of a legacy spreadsheet that is already over the limit.

Tests: an insert, a resize, an import, and an undo past the limit are refused.

### Step 4: cells are stored by row id and column id

Server only. The wire stays as step 2 left it.

1. Migration part 2.
2. `readInputs`, `storeCells`, `clearCells`, `touchSame`, and the journal's cell entries use ids. `TableRecord` loses `rowCount` and `colCount`, and the snapshot derives them.
3. `applyEdit` inserts or deletes row records or column ids, clears the cells of deleted rows and columns through `ContentWriter`, and stores only the formulas the engine's new rewrite function returns, which leaves out formulas in deleted rows and columns. For the response it still computes the moved cells with `inputsAfterEdit` and stores none of them. Step 5 removes that.
4. `checkRestoredState` checks formula columns by column id. In place of the check for cells outside a table, it checks that every cell's column id is in its table's `col_ids`. The foreign key covers rows. `setCells` and the action effects make the same column check.
5. `action_runs.row_index` and `col_index` keep the position the cell had when it was clicked.

Tests:

- Engine: the rewrite function returns the same formula texts `inputsAfterEdit` returns, for the cases in `rewrite.test.ts`, and nothing for a formula in a deleted row.
- Server: inserting a row at the top of a table with 5,000 filled cells writes no `cells` record and makes a journal entry of a few hundred bytes. Every case in `undo.test.ts` passes unchanged. Export and a kept version of a table hold the same file as before the step.
- Server: Ada clears B1, Grace deletes the now empty column B, and Ada's undo is refused. No cell with the deleted column's id is stored.
- Migration: a database at the step 2 schema with cells in several tables migrates to the same snapshot.

### Step 5: the wire and the web store hold cells by id

1. `StoredCell` on the wire becomes `{ tableId, rowId, colId, input }` in the snapshot, `Rewritten`, `ChangedContent`, and `ClickResult`. A structural edit returns the rows it added and removed.
2. The web store keeps inputs by id, builds the engine from them, and builds it again after a structural edit. `applyRewritten`, `applyChanged`, `putBack`, and `unsavedChanges` use ids.
3. The server stops computing moved cells. `inputsAfterEdit` leaves the engine with its tests.

Tests: the store tests for save, rollback, undo, and refresh pass with `mockApi` and `snapshotWith` returning ids. A new store test inserts a row while a save to a lower row is unanswered and finds the saved text in the same row afterward.

### Step 6: undo refuses only on a conflict over formula text

This step fixes problem 2.

1. A `formulas` column on `journal`, set by `ContentWriter`. `rewrites` stays set by every structural edit, rename, and move.
2. `changeHistory` applies the one conflict rule. `touchSame` covers rows. `assertRecordedMatches` checks that a created row holds only the step's own cells, and compares a row by whether it exists.
3. A restored row whose key is taken gets a neighboring key.

Tests in `undo.test.ts`:

- Ada types a value, Grace inserts a row above, and Ada's undo and redo succeed.
- Grace inserts a row, Ada types a value elsewhere, and Grace's undo succeeds.
- Each of the two formula cases under "Undo journal and versions" is refused.
- Undoing a row insert is refused when someone typed into the new row.
- Grace inserts a row into a table that holds no formula, Ada types `=A2`, and Grace's undo is refused.
- Grace and Ada each insert a row into a table that holds no formula and no format, and each can undo in either order.
- Grace deletes a row that a formula read, Ada inserts a row above, and Grace's undo is refused.
- The tests `365a37c` added for a later write to the same content pass with ids.
- In a table with no formula: delete a row, insert a row at the same place, undo the delete, redo it, and undo it again. Each succeeds, and after each undo both rows exist.

### Step 7: data tables hold only their rows

This step fixes problem 3. Its items can be committed in the order given.

1. `setCellsBody` takes `appendRows`, and `setCells` creates the rows in the same change. The `deleted_rows` table, written by `ContentWriter` and checked by `setCells`. `writeCells` in the store sends `appendRows` for a paste past the end.
2. A table can have no rows: the file schema and `checkFile` accept `rowCount: 0` for a table with columns, a data table's last row can be deleted, `dropColumns` adds a row to a table that has none, and the engine and the grid handle the empty table.
3. `nameColumns` deletes the empty rows at the end, which can be all of them. `GridView` draws the new-row line for a data table.
4. `PlanContext` says whether a table is a data table, and `APPEND_ROW`, `INSERT`, and `UPDATE` add after the last stored row of one when their range is open at the bottom.
5. Formula columns compute in every row, and `typedInRow` and `trackRow` leave the engine.

Tests:

- `undo.test.ts` gains "write a cell into a new row" and "paste past the end of a table". Each undoes to the same rows as before.
- A save repeated with the same `appendRows` id adds one row. Repeated after the row was deleted, and after the step that added it was undone, it answers 409 and stores nothing. Redoing that step brings the row back. An id that is a row of another table answers 409.
- `APPEND_ROW`, `INSERT`, `UPDATE`, and `OVERWRITE` on a data table through `click.test.ts`: rows are added at the end and the table has no unused row afterward.
- A data table whose last row was cleared: each append action adds a new row and leaves the cleared row's id and emptiness as they were. On a plain grid the same action writes into the cleared row.
- A table with no rows: naming the columns of an empty table, typing into the new-row line, an append action, export, import, a kept version and its restore, and removing the column names. In the engine: `SUM`, `ROWS`, `COUNTA`, `FILTER`, and `QUERY` over `Sales[Amount]` and `A:A`, a formula column, a `for` loop in a text view, and a chart.
- Engine: `Sales[Amount]` and `A:A` cover the rows that exist.
- Web: typing in the new-row line adds a row and moves the line down.

### Step 8: one revision for each change, applied in order

No event carries content yet. Remote changes still trigger a full read.

Before this step, do the P2 item in `todo.md` that sends every change the editor makes through one ordered queue. That item orders the requests the store sends, and this step orders what comes back. Both rewrite the same code in the store. With requests already in one queue, a tab's own responses arrive in the order they were sent, and this step has only events to fit in among them.

1. `spreadsheets.revision`, returned by the snapshot and raised once by each transaction that holds the spreadsheet's lock and wrote something. Changes made inside that transaction merge their content in the request's context.
2. Every response to a change carries its revision and `ChangedContent`, clicks and control inputs included.
3. The web store applies responses in revision order through `applyChanged`. `applyRewritten` and the code that applies a click's cells and tables go away.

Tests:

- Server: a click that grows a table and writes cells in two tables produces one revision and one `ChangedContent` that holds all of it. A click whose writes are refused produces none.
- Web: the existing store tests pass with responses in the new form. Two of the tab's own changes answered out of order end equal to a fresh snapshot.
- Web: a click whose action changes a table's size and its cells shows both in the tab that clicked.

### Step 9: change events carry the change

1. `ChangeFeed.publish` takes the revision and the `ChangedContent`. `change`, undo, and redo supply them.
2. The events route checks read access before each event and sends the content. A tab hears its own changes too.
3. The web store puts events into the ordered path of step 8, applies a tab's own change from whichever of its response and its event comes first, and reads the spreadsheet again on a gap.

Tests:

- Server: an event holds the cells and rows of a save, a row insert, and an undo. A change over the size limit holds none. A person whose share ended receives no content.
- `access.test.ts`: the events route is already in `readRoutes`. Add a case that a viewer's open stream sends content and an outsider's does not open.
- Web: a tab's own structural change whose event arrives before its response, followed by a remote event, ends equal to a fresh snapshot. A response that arrives after a later event changes nothing.
- Web: two events applied in order equal a fresh snapshot, an event out of order triggers a read, and an unsaved edit survives a remote row insert in its row.

### Step 10: a formula typed against a stale structure is refused

1. The store records the revision it had applied when an edit was opened, and sends it with the save.
2. `setCells` answers 409 with the code `stale_formula` to an input starting with `=` when a change that altered what references mean has a later revision. `updateColumn` does the same for a formula and `updateView` for a source. `spreadsheets.rewrite_revision` holds the revision of the last such change, including one that changed no text.
3. The client puts the cell back, keeps the typed text in the editor, and says why.
4. `todo.md` gains an item, with a priority for the author to set: narrow the refusal to structural changes in the tables the formula names, before several people edit one spreadsheet regularly.

Tests:

- Server: Grace inserts a row, and Ada's save of a formula with the earlier revision is refused while her save of a value is stored. A formula saved with the current revision is stored. The same for a row insert into a table with no formulas, for a formula column's formula, and for a view source.
- Web: a draft opened before a remote row insert and saved after the tab applied the insert sends the earlier revision. The batches of a paste all send the revision the paste began with.

### Step 11: `OVERWRITE` deletes the rows it empties

1. A new `Effect`, `deleteRows`, names a table and row positions. The server's handler in `run.ts` resolves the positions to ids under the lock and deletes the rows through `ContentWriter`, with the formula rewrites of any row delete.
2. `OVERWRITE` emits it for the rows past its data when its range covers every column of a data table. For any other range it empties cells as before. With no data it leaves the table with no rows.
3. The click's response already carries everything the delete rewrote, view sources included, through step 8.

Tests: `click.test.ts` overwrites a data table with fewer rows and finds no empty row. `undo.test.ts` gains the case, and its undo brings back the same row ids and cells. An `OVERWRITE` of part of a table's width deletes no row. A text view that reads a deleted row shows its rewritten source in the tab that clicked and in another tab.

## Documentation changes

**`CLAUDE.md`, design rules:**

- "The client names a cell; the server decides the effect" says that the client names a cell, row, or column by id, and that the server resolves them under the lock and answers 409 when one is gone.
- A new rule: positions exist only in the engine. Storage, requests, responses, and the journal name rows and columns by id, and `TableLayout` is the one translation.
- "Anything that holds a formula is rewritten with the cells" says that a structural edit rewrites formula text and format rules and moves no cell.
- "A formula column's cells are not stored" says the engine gives every row a computed cell.
- The rule on `change` adds that row records are written through `ContentWriter`.

**`README.md`:**

- "Working together" under What's missing: a save follows its row and column when someone else inserts or deletes above it.
- "Tables": a data table holds the rows added to it and offers a new row.
- The actions table: `APPEND_ROW` and `INSERT` add rows to the end of a data table.
- "History and files": the undo sentence names the one conflict that refuses an undo. The sentence that the file has no ids stays, and the text says a data table may have no rows.
- "How it works": one paragraph on row and column ids and where positions are computed.
- "Size": the row limit.

**`DECISIONS.md`:** one new entry, "Rows and columns have ids", with the decisions and rejected alternatives of this plan, including those listed under "Decisions made while revising the plan". It names what it replaces in earlier entries:

- Undo through a server-side journal: rules 1 and 2, and the risk about reversing a row insert in a full table.
- Fixes from a code review: "A save still names a cell by its row and column".
- Data tables: "A formula column computes only in rows that hold something" and "Showing only the rows that hold data".
- Deleting and inserting rows and columns: "Known cost".
- Live updates: "A change is announced, not described".

**`todo.md`:**

- Check off the P1 item to give rows a persistent identity and the P1 item on a save that names a cell by row and column, after step 2.
- Remove "shift in SQL if this gets slow" after step 4.
- Take "hide the empty rows" out of the P2 data tables item after step 7.
- Take "send the changed cells with a change event" out of its P3 item after step 9. "Show who else has it open" stays.
- The P2 item on one ordered queue for the editor's changes is done before step 8.
- Add the item on narrowing the stale-formula refusal in step 10.

## Risks

- **The cells migration is the one step that can lose data.** It runs at startup on every instance. Mitigation: the migration test in step 4, an abort on unmatched cells before dropping the positional columns, and a database backup before deploying it.
- **Row count and row records can disagree from step 1 until step 4.** Two things hold one fact until then. The invariant test in step 1 covers every content route in `undo.test.ts`.
- **Order keys grow with a table's edit history.** Inserting again and again at one place lengthens the keys there, and deleting rows does not shorten them. A table that passes 64 characters is renumbered, which empties every tab's undo stack for the spreadsheet. How often that happens in practice is unknown. The key test in step 1 should report how many inserts at one place it takes.
- **Key order must match in Postgres, PGlite, and JavaScript.** It depends on the `"C"` collation. A probe showed PGlite and JavaScript agree on ten keys. Postgres is untested, and `schema.ts` may not be able to state the collation. Two tests in step 1 cover both.
- **A stale formula can still be saved until step 10.** See the wire protocol section.
- **The stale-formula refusal is too broad for several people.** It refuses a formula after a structural edit anywhere in the spreadsheet. Step 10 records the narrowing as a todo.
- **A table with no rows is new to the engine.** Every range read, `extent`, and spill check assumed at least one row. The tests in step 7 name the functions to try, and others may assume a first row.
- **One ordered path for responses and events changes every write in the web store.** Step 8 replaces `applyRewritten` and the click handling. It is the largest change to the store in this plan.
- **Snapshots grow.** Each row adds about 60 bytes, so 100,000 rows add about 6 MB to a snapshot that already holds up to 100,000 cells.
- **Events will carry content.** A mistake in the access check of step 9 leaks cells to a person whose share ended. The stream sends none today.
- **The work passes through `spreadsheets.ts` and the workbook store**, the two largest files, which other sessions edit often. Steps 1, 4, 5, and 8 should each merge quickly.
- **Empty rows change what formula columns show.** A row with nothing typed computes its formulas, so a data table that had empty rows between filled ones shows results in them after step 7.

## Decisions the author accepted

The author accepted each of these on 2026-10-01. The sections above already state them as decided.

1. **Naming a table's columns deletes its empty rows at the end.** `SUM(A1:A20)` over five filled rows becomes `SUM(A1:A5)`. Keeping the rows would leave data tables with unused rows, which is problem 3.
2. **A formula column computes in every row of a data table** (step 7). A row means a record, and the engine loses the per-row counting.
3. **`OVERWRITE` removes the rows it empties in a data table** (step 11), when its range covers every column. The planned action "delete a row that matches a condition" can use the same effect.
4. **The server refuses a formula typed against a stale structure** (step 10). The refusal covers a structural edit anywhere in the spreadsheet since the edit was opened. The author accepted that while one person uses a spreadsheet, and asked for the narrowing to be recorded as a todo when the step is implemented.
5. **A spreadsheet holds at most 100,000 rows.** The limit is raised together with `tableRows`, once the grid draws only the rows in view.
6. **Columns do not get their own table now.** Decide again when relations or per-column settings such as number formats are designed.
7. **Narrowing the undo rule for creating or deleting a page, table, or view is a separate change** after step 6. It does not depend on row ids.
8. **A data table may have zero rows** (step 7). A table that had to keep one row would hold an empty record that formula columns compute in and `ROWS` counts.

### Decisions made while revising the plan

The author asked for these to be recorded here. Each goes into the `DECISIONS.md` entry when the step that implements it is merged, with what to change if it proves wrong.

- **`deleted_rows` entries are kept for one day,** the journal's age limit (step 7). A request repeated more than a day after its row was deleted can bring the row back. Keeping entries forever closes that and grows the table without bound.
- **Renumbering a table's order keys empties the undo stacks of every tab on the spreadsheet** (step 1), because journal entries hold the old keys. How often a table is renumbered in practice is unknown.
- **A key may be 64 characters long before its table is renumbered** (step 1). The number is a guess. The shared test reaches a 65-character key after 311 inserts into the gap between `a0` and `a1`. Other gaps may start with longer keys.
- **`PlanContext` tells an action whether a table is a data table** (step 7), so that the append actions can tell a data table from a plain grid.
- **A delete of several rows by id is applied as one positional edit for each run of neighbors** (step 2), last run first.

Decision 1 covers empty rows at the end of a table, and only when its columns are named. A row whose cells are all cleared later stays as an empty row, so that its id remains valid for a relation that points at it. Whether a data table should delete such rows is left for later and is listed in `todo.md`.

## Verification of this plan's implementation

- `pnpm check` after every step.
- `pnpm test:postgres` after steps 1, 2, 4, 6, 8, and 11. The lock tests and the collation test need real Postgres.
- `pnpm e2e` after steps 1, 2, 5, 7, 8, and 9, outside the sandbox.
- By hand after step 1 and again after step 9, with two browser sessions on one spreadsheet: start an edit in one, insert a row above it in the other, commit the edit, and find the text in the row it was typed in.
