# Persistent row and column identity

This plan gives every row and column of every table an id that stays the same when rows and columns are inserted, deleted, or reordered. Storage, the wire protocol, and the undo journal name cells by those ids. The formula engine stays positional, and the server and the web app translate between ids and positions where they call it.

The plan was written from the code at commit `077d26a`. Three commits were added while it was written, through `edfbe5e`. Of those, the plan takes into account only that `access.test.ts` and `undo.test.ts` now fail for a route they do not list. It changes no code.

## Decisions in brief

| Question                 | Decision                                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| Scope                    | Rows and columns of every table, plain or data. One storage model.                                             |
| Row storage              | A `table_rows` table: `id`, `table_id`, and an order key. Inserting a row writes one record.                   |
| Column storage           | An ordered array of column ids on the table record.                                                            |
| Cell storage             | Keyed by `(row_id, col_id)`. A structural edit moves no cells.                                                 |
| A1 references            | Stay positional and are still rewritten on structural edits.                                                   |
| Sort and filter in place | A display setting on the table. The stored order, and so what `A2` reads, does not change.                     |
| Wire                     | The client names a cell by row id and column id. A deleted row or column answers 409. No table version number. |
| Engine                   | Does not learn row ids. `CellId` stays `{ tableId, row, col }`.                                                |
| Undo                     | Entries name cells and rows by id. Refusal rules 1 and 2 narrow to one rule about formula text.                |
| File format and versions | Unchanged. No ids.                                                                                             |
| Data tables              | Hold only the rows that were added. The grid offers one new row below the last.                                |
| Live updates             | A change event carries the changed cells and rows, with a revision number for ordering.                        |
| Limits                   | 1,000 rows per table stays. A new limit caps row records per spreadsheet.                                      |

## Current behavior

Each claim below was checked by reading the file named.

- **Cells are keyed by position.** The `cells` table has the primary key `(table_id, row_index, col_index)`, and `tables` holds `row_count` and `col_count` (`apps/server/src/db/schema.ts`).
- **A save names a position.** `setCells` in `apps/server/src/repo/spreadsheets.ts` reads the table again under the lock and refuses only a cell outside the table or in a formula column. A cell inside the table is written wherever the request's row and column now point.
- **A click and a control input name a position.** `cellParam` in `packages/shared/src/index.ts` is `tableId`, `row`, `col`. `runCell` in `apps/server/src/actions/run.ts` evaluates `workbook.getValue(cell)` for that position under the lock.
- **The client keeps its selection by position across a refresh.** `refresh` in `apps/web/src/stores/workbook.ts` keeps the selected row and column when they are still inside the table. An edit that is open while someone else inserts a row above is then saved to a different cell.
- **A structural edit rewrites every moved cell.** `applyEdit` calls `inputsAfterEdit` in `packages/engine/src/rewrite.ts`, which returns each cell at its new position and an empty input for each position left behind. `ContentWriter.setCells` stores them all and records each in the journal.
- **Undo refuses on any later reference rewrite.** `changeHistory` refuses a step that rewrote references, or created or deleted a page, table, or view, when any later change is in effect. It refuses any step when a later change in effect has `rewrites` set. `applyEdit` and `storeRewrite` set that flag even when no formula changed.
- **Journal entries name cells by position.** `JournalData.cells` in `apps/server/src/repo/journal.ts` holds `[row, col, before, after]`.
- **A data table shows its unused rows.** `GridView.vue` draws `table.rowCount` rows. The engine hides the computed cells of empty rows by counting typed cells per row (`typedInRow` and `trackRow` in `packages/engine/src/workbook.ts`).
- **`APPEND_ROW` scans for the first row below the content.** It evaluates the whole range, finds the last row that holds something, and emits `ensureRows` with the row count it needs (`packages/engine/src/functions/actions.ts`).
- **A remote change triggers a full read.** The events stream in `apps/server/src/routes/spreadsheets.ts` counts changes and sends no content. `apps/web/src/api/live.ts` calls `refresh` for each.
- **Versions and exports carry no ids.** `saveVersion` writes the `spreadsheetFile` format, and `restoreVersion` deletes every page and inserts the file's contents, which gives pages and tables new ids and empties the journal.

Not verified:

- I did not run any test or the app. Every statement about behavior comes from reading code.
- I read `GridView.vue`, `apps/web/src/api/client.ts`, `access.test.ts`, `undo.test.ts`, and `concurrency.test.ts` only through searches for specific lines.
- I did not read `evaluate.ts`, `columns.ts`, `views.ts`, or `formats.ts` beyond their exported names. The plan assumes `viewsAfterEdit`, `columnFormulasAfterEdit`, and `formatRulesAfterEdit` take a positional `StructuralEdit` and need no change.
- Whether PGlite accepts `COLLATE "C"` on a column, which the order key needs.
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
```

A row's place in its table is the place of its order key among the table's keys in byte order. A new key is made between two neighboring keys without changing either, so inserting a row writes one record. The `"C"` collation makes Postgres order the keys as JavaScript string comparison does.

A pure module in `packages/shared` makes keys: `keyBetween(before, after)` and `keysAfter(last, count)`. The server alone assigns keys, under the spreadsheet's lock. Keys are never renumbered, because journal entries hold them.

A row id is a UUID. The client makes the id of a row it creates, so it can name the row before the server answers and a retried request is recognized. A counter per table was rejected: undoing a row insert would put the counter back, the next insert would reuse the id, and a save still on its way to the undone row would be applied to the new one.

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
  row_id    uuid not null references table_rows(id) on delete cascade
  col_id    uuid not null
  input     text not null
  updated_by, updated_at
  primary key (row_id, col_id)
  index (table_id)
```

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

The migration runs in two steps, which match implementation steps 1 and 3.

1. Create `table_rows` and add `tables.col_ids`. For each table, insert `row_count` rows and set `col_ids` to `col_count` new UUIDs. The backfill is SQL in the migration file, as `0007_version_blocks.sql` already does for versions. Backfilled keys are a zero-padded row number of fixed width followed by a middle digit, which `generate_series` and `lpad` can produce and which `keyBetween` accepts.
2. Add `row_id` and `col_id` to `cells`. Fill them by joining each cell to the row whose rank by key equals `row_index` and to the element of `col_ids` at `col_index`. Delete any cell that finds no row or column, after counting them: `checkRestoredState` and `setCells` should have kept that count at zero. Replace the primary key, drop `row_index` and `col_index`, and drop `row_count` and `col_count`. Delete every `journal` record, because its entries name positions. A journal entry lives at most one day and belongs to one open tab.

Kept versions need no migration. They are files without ids.

## Formula semantics

**A1 references stay positional and keep being rewritten.** `B2` means the cell in the second row and second column of the stored order. A structural edit rewrites formula text in cells, view sources, and formula columns as it does now.

Storing a reference as row and column ids, and printing it as `B2`, was rejected. A cell would no longer store what was typed. Ranges, open-sided ranges, `$` pins, and fill translation would each need a rule for ids. The export file and the journal would need a translation in both directions. Named columns are the project's answer to positional references, and they are unaffected.

**`[Column]` and `Table[Column]` keep their meaning and their text.** `[Price]` is the Price cell of the formula's own row. `Sales[Price]` is the Price cell of every row of Sales. Because a data table will hold only rows that were added, `Sales[Price]` and `A:A` stop covering unused rows.

**Sort and filter in place are display settings.** A table would store which columns it is sorted by and which rows its filter hides, and the grid would draw rows in that order. The stored order does not change, so `A2` reads the same cell under any sort, and `SUM(Sales[Amount])` includes rows a filter hides. The grid shows each row's stored number, so the numbers are out of sequence while a sort is on.

Reordering the stored rows on a sort was rejected as the default. It changes what every positional reference reads, it shows up for every other person, and it rewrites every order key of the table. A "sort permanently" command can be added later as a structural edit.

Row ids are what make the display setting workable: an edit made in the third row shown is saved to that row's id, and a row that moves on screen after an edit keeps its identity. This plan does not implement sort or filter.

## Wire protocol

**A save.** `PUT /tables/:tableId/cells` takes `{ cells: [{ rowId, colId, input }], appendRows?: [rowId, ...] }`. `appendRows` lists ids the client made for rows to add at the end of the table. The server creates the ones that do not exist, in the same change and the same journal entry as the cells.

**A click and a control input.** `POST /tables/:tableId/cells/:rowId/:colId/click` and `.../input`. The paths keep their form and the two parameters become UUIDs.

**When the row or column is gone.** The server resolves ids to positions under the spreadsheet's lock. A request that names a row or column that no longer exists is refused as a whole with 409 and the code `row_deleted` or `column_deleted`. The client puts the cells back as `putBack` does now and says that the row was deleted. A silent drop was rejected: the person would not learn that the edit was lost.

**The client translates when the person acts.** The store turns the selected position into ids when the edit, click, or input is made, and the queued request carries ids. The selection and an open cell editor are found again by id after a refresh, and are cleared when their row or column is gone.

**Responses.** From step 4, every cell the server sends is `{ tableId, rowId, colId, input }`, and the snapshot lists each table's rows as `{ id, key }` in order.

**No table version number.** Ids make it unnecessary for addressing. One race remains: a formula typed while another person's row insert has not yet reached the tab holds row numbers from before the insert. The cell is correct and the references in its text are stale. Step 7 adds a revision number to the spreadsheet for live updates, and the server uses it to refuse such a formula.

A table version number as the first step was considered, because it is smaller: one column and three checks. It turns a misplaced save into a refused one that the person types again, it refuses every save that crosses any structural edit, and step 1 would then delete it.

## Engine

**`Workbook` does not learn row ids.** `CellId`, the dependency index, ranges, spills, and `Effect` stay positional. The engine gains no dependency and performs no I/O.

`TableLayout` in `packages/shared` holds one table's row ids and column ids in order and converts both ways. The server builds layouts from the rows it reads under the lock and uses them in three places: to resolve a request's ids, to build the positional `WorkbookData` it gives the engine, and to turn the positional `setCell` effects of an action plan back into ids. All three happen in one transaction on one read, so they agree.

The web store keeps the document by id: cell inputs keyed by row id and column id, and a layout for each table. It builds the engine's positional data from that. After a row or column edit it updates the layout and builds the workbook again. Today the same edit applies up to 100,000 `setCell` calls, so a rebuild costs no more.

Changes inside the engine:

- `rewrite.ts` exports a function that returns only the formulas a structural edit rewrites. It is the existing private `rewriteInputs` with `editDecider`. `inputsAfterEdit`, which also moves cells, is removed when its last caller is (step 4).
- The engine stops counting typed cells per row, and a formula column computes in every row (step 6).

Putting ids in the engine was rejected. Every range read and every dependency lookup is a loop over row numbers, and an id-keyed cell map would need a translation inside those loops. Relations between tables will need the engine to find a row by id. `TableDefinition` can then carry `rowIds` as plain data, which keeps the engine pure.

## Undo journal and versions

**Entries name things by id.** `JournalData.cells` becomes `[rowId, colId, before, after]`. `JournalData.rows` is added: for each table, `[rowId, keyBefore | null, keyAfter | null]`. Column ids travel in the table record. `ContentWriter` gains `insertRows` and `deleteRows`, and its `deleteTable` records the table's rows so that an undo brings them back with the same ids.

An entry for a row insert holds the new rows and the formulas whose text changed. It no longer holds every cell below the insert, so it stays far under the 8 MB entry limit.

**Refusal rules.** Numbers refer to the rules in the DECISIONS entry "Undo through a server-side journal".

| Rule today                                                                                  | After                                                                                                |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| 1. A step that rewrote references is refused after any later change.                        | Refused only when a later change in effect wrote formula text or rewrote references.                 |
| 1. A step that created or deleted a page, table, or view is refused after any later change. | Unchanged. Narrowing it is a separate piece of work.                                                 |
| 2. Any step is refused after a later change that rewrote references.                        | Refused only when the step would restore formula text. A step that restores typed values is allowed. |
| 3. Each recorded thing must still be as the step left it.                                   | Kept. Two checks are added, below.                                                                   |
| 4. What the undo writes must still fit.                                                     | Kept. "No cell outside its table" becomes a foreign key.                                             |
| 5. A change too large to record is refused.                                                 | Kept.                                                                                                |

Rules 1 and 2 become one rule: an undo or redo is refused when it and a later change in effect conflict, and they conflict when one rewrote references and the other wrote formula text or also rewrote references. Formula text is a cell input that starts with `=`, a view source, or a formula column's formula.

The rule cannot be dropped entirely, because ids fix which cell an entry means but not what a formula's text means. Two cases show it:

- Ada replaces `=A5` in B1 with `7`. Grace inserts a row above row 5. Ada's undo would restore `=A5`, which now reads a different cell.
- Grace inserts a row. Ada types `=A6` in D1, meaning the cell that was A5. Grace's undo removes the row and does not touch D1, which then reads the wrong cell.

Rewriting restored text through the later edits was rejected for now. The journal would have to record each edit as an operation with the page and table names of that moment, and undo would replay them. It can be added later without a storage change.

The journal gains a `formulas` flag, set by `ContentWriter` when a change writes formula text. `rewrites` is set only when a rewrite changed some text.

Checks added to rule 3:

- A row or column that the step created must hold no cell when the step is undone. Otherwise the undo would delete what someone typed into it.
- A step is refused when a later entry in effect wrote one of its cells. This is the open P1 item in `todo.md` about an undo erasing another person's edit. With cells named by id it is a comparison of ids across at most 200 entries.

A restored row takes its recorded key. When another row has taken that key since, the restored row takes a new key next to it.

**Versions and the export file do not change.** The file names rows and columns by position and has no ids, as the Import and export decision chose. `saveVersion` and export write positions through the layout. A restore or an import gives rows and columns new ids as it already gives pages and tables new ids, and a restore already empties the journal.

## Auto-growing data tables

**No table stores a row count.** A plain grid keeps a fixed set of rows that the person adds to and removes from. A data table holds the rows that were added to it and no unused rows.

**The grid offers a new row.** Below a data table's last row the grid draws one empty row that is not stored. Typing into it sends the cell with a new row id in `appendRows`, and the row and the cell are one undo step. A paste that runs past the end of any table sends `appendRows` for the extra rows, which replaces the `rowCount` request `writeCells` makes today. The resize dialog keeps working: the server adds or deletes rows at the end.

**A row exists until it is deleted.** Clearing every cell of a row leaves an empty row. This keeps a row's id stable for a relation that points at it.

**Naming a table's columns deletes its empty rows at the end**, as any rows are deleted, so formulas that read them are rewritten. `SUM(A1:A20)` over a table with five filled rows becomes `SUM(A1:A5)` and does not grow when a row is added. `A:A`, `A2:A`, and `Sales[Amount]` do grow.

**Actions.** The engine keeps emitting positional effects, and `ensureRows` keeps its meaning. The server's handler adds row records where it now raises `row_count`.

| Action       | Change                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `APPEND_ROW` | No change to the function. On a data table the first row below the content is the row after the last, so the scan finds it at once. |
| `INSERT`     | No change.                                                                                                                          |
| `UPDATE`     | No change. Rows it matches are written by position and resolved to ids under the lock.                                              |
| `OVERWRITE`  | No change in step 6: it empties cells, which on a data table leaves empty rows at the end. Step 8 makes it delete them.             |

`APPEND_ROW(Sales, ...)` with a table name in place of a range needs the whole-table reference syntax that `todo.md` lists separately.

## Live updates

**A change event carries the change.** `ContentWriter` already holds every page, table, view, cell, and row a change wrote. The state each was left in is the same `ChangedContent` that undo returns and the store's `applyChanged` applies.

- `spreadsheets.revision` counts changes. `touch` raises it. The snapshot returns it and each event carries it.
- A tab applies an event whose revision is the next one. For any other revision it waits briefly for the missing event and then reads the spreadsheet again.
- A tab hears its own changes too, marked as its own, and uses them only to advance its revision. Leaving them out, as the stream does now, would look like a gap.
- A change of more than 1,000 cells, or one too large to journal, is announced without content, and tabs read the spreadsheet again.

Row ids make this practical. A tab's unsaved edits are keyed by id, so applying someone else's row insert does not move them to other cells.

An event will hold content, which it does not today. The stream checks read access once, when it opens. From step 7 the stream handler checks `findSpreadsheet(id, "read")` through the repository before it sends each event, so a person whose share ended receives nothing further.

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

### Step 1: rows and columns get ids, and writes name cells by id

This step fixes problem 1. It cannot be smaller: the fix needs the client to name what it saw, so the ids, the snapshot that carries them, and the three requests that use them go together. Cell storage does not change.

1. `packages/shared`: the order key module, `TableLayout`, and the request schemas (`cellInput` with `rowId` and `colId`, `cellParam` with two UUIDs).
2. Schema and migration part 1.
3. `ContentWriter`: `insertRows`, `deleteRows`, rows recorded on `insertTable` and `deleteTable`, and `JournalData.rows`. `applyRecorded` restores rows.
4. `SpreadsheetRepository`: `insertTable`, `insertContents`, `applyEdit`, `updateTable`, `ensureRows`, and `nameColumns` keep `table_rows` and `col_ids` in step with `row_count` and `col_count`. A private method resolves a request's ids to positions inside `changeTable` and throws the 409. `getSnapshot` returns each table's rows and `colIds`.
5. `run.ts`: `runCell` takes ids and resolves them against the snapshot it reads under the lock.
6. Web: the store holds a layout for each table, translates when the person acts, updates the layout from the response to each structural edit, and finds the selection and an open editor by id after a refresh.

Tests:

- Shared: key properties with generated input (a key between two keys sorts between them, repeated insertion at one place stays ordered, backfilled keys are accepted), and `TableLayout` both ways.
- Server, new `identity.test.ts`: Ada reads the snapshot, Grace inserts a row above, and Ada's save, click, and control input each reach the row Ada named. The same for a column insert. Each of the three answers 409 when Grace deleted the row or the column.
- Server: after every case in `undo.test.ts`, the number of `table_rows` records equals `row_count` and the length of `col_ids` equals `col_count`. Undoing a row insert, a table delete, and a page delete brings back the same row ids.
- `access.test.ts`: the cells, click, and input lines send ids. The click and input routes keep their place in `writeRoutes` under their new parameter names, which the test's comparison with the registered routes checks.
- Migration: a database built at the previous schema with cells and a data table migrates to the same number of rows and columns for each table.
- Web: a change made at a position sends that position's ids, and a refresh that moves the selected row keeps the selection on it.

### Step 2: limit the rows of a spreadsheet

`LIMITS.spreadsheetRows` and one check where rows are added, next to `checkCellCount`. Import and `checkRestoredState` apply it too.

Tests: an insert, a resize, an import, and an undo past the limit are refused.

### Step 3: cells are stored by row id and column id

Server only. The wire stays as step 1 left it.

1. Migration part 2.
2. `readInputs`, `storeCells`, `clearCells`, and the journal's cell entries use ids. `TableRecord` loses `rowCount` and `colCount`, and the snapshot derives them.
3. `applyEdit` inserts or deletes row records or column ids, clears the cells of deleted rows and columns through `ContentWriter`, and stores only the formulas the engine's new rewrite function returns. For the response it still computes the moved cells with `inputsAfterEdit` and stores none of them. Step 4 removes that.
4. `checkRestoredState` checks formula columns by column id and drops the check for cells outside a table.
5. `action_runs.row_index` and `col_index` keep the position the cell had when it was clicked.

Tests:

- Engine: the rewrite function returns the same formula texts `inputsAfterEdit` returns, for the cases in `rewrite.test.ts`.
- Server: inserting a row at the top of a table with 5,000 filled cells writes no `cells` record and makes a journal entry of a few hundred bytes. Every case in `undo.test.ts` passes unchanged. Export and a kept version of a table hold the same file as before the step.
- Migration: a database at the step 1 schema with cells in several tables migrates to the same snapshot.

### Step 4: the wire and the web store hold cells by id

1. `StoredCell` on the wire becomes `{ tableId, rowId, colId, input }` in the snapshot, `Rewritten`, `ChangedContent`, and `ClickResult`. A structural edit returns the rows it added and removed.
2. The web store keeps inputs by id, builds the engine from them, and builds it again after a structural edit. `applyRewritten`, `applyChanged`, `putBack`, and `unsavedChanges` use ids.
3. The server stops computing moved cells. `inputsAfterEdit` leaves the engine with its tests.

Tests: the store tests for save, rollback, undo, and refresh pass with `mockApi` and `snapshotWith` returning ids. A new store test inserts a row while a save to a lower row is unanswered and finds the saved text in the same row afterward.

### Step 5: undo refuses only on a conflict over formula text

This step fixes problem 2.

1. A `formulas` column on `journal`, set by `ContentWriter`. `rewrites` is set only when text changed.
2. `changeHistory` applies the one conflict rule, and `assertRecordedMatches` gains the two checks.
3. A restored row whose key is taken gets a neighboring key.

Tests in `undo.test.ts`:

- Ada types a value, Grace inserts a row above, and Ada's undo and redo succeed.
- Grace inserts a row, Ada types a value elsewhere, and Grace's undo succeeds.
- Each of the two formula cases above is refused.
- Undoing a row insert is refused when someone typed into the new row.
- Ada types `x`, Grace types `y` and then `x`, and Ada's undo is refused.
- Delete a row, insert a row at the same place, undo the delete: both rows exist.

### Step 6: data tables hold only their rows

This step fixes problem 3.

1. `setCellsBody` takes `appendRows`, and `setCells` creates the rows in the same change.
2. `nameColumns` deletes the empty rows at the end.
3. `GridView` draws the new-row line for a data table, and `writeCells` sends `appendRows`.
4. In its own commit: formula columns compute in every row, and `typedInRow` and `trackRow` leave the engine.

Tests:

- `undo.test.ts` gains "write a cell into a new row" and "paste past the end of a table". Each undoes to the same rows as before.
- A retried save with the same `appendRows` id adds one row.
- `APPEND_ROW`, `INSERT`, `UPDATE`, and `OVERWRITE` on a data table through `click.test.ts`: rows are added at the end and the table has no unused row afterward.
- Engine: `Sales[Amount]` and `A:A` cover the rows that exist.
- Web: typing in the new-row line adds a row and moves the line down.

### Step 7: change events carry the change

1. `spreadsheets.revision`, raised in `touch` and returned by the snapshot.
2. `ChangeFeed.publish` takes the revision and the `ChangedContent`. `change`, undo, and redo supply them.
3. The events route checks read access before each event and sends the content.
4. The web store applies an event in order through `applyChanged` and reads the spreadsheet again on a gap.
5. The client sends the revision it last applied with each save. `setCells` answers 409 with the code `stale_formula` to an input starting with `=` when a change that rewrote references has a later revision. `spreadsheets.rewrite_revision` holds the revision of the last such change. The client puts the cell back, keeps the typed text in the editor, and says why.

Tests:

- Server: an event holds the cells and rows of a save, a row insert, and an undo. A change over the size limit holds none. A person whose share ended receives no content.
- `access.test.ts`: the events route is already in `readRoutes`. Add a case that a viewer's open stream sends content and an outsider's does not open.
- Server: Grace inserts a row, and Ada's save of a formula with the earlier revision is refused while her save of a value is stored. A formula saved with the current revision is stored.
- Web: two events applied in order equal a fresh snapshot, an event out of order triggers a read, and an unsaved edit survives a remote row insert in its row.

### Step 8: `OVERWRITE` deletes the rows it empties

1. A new `Effect`, `deleteRows`, names a table and row positions. The server's handler in `run.ts` resolves the positions to ids under the lock and deletes the rows through `ContentWriter`, with the formula rewrites of any row delete.
2. `OVERWRITE` emits it for the rows past its data when its range covers every column of a data table. For any other range it empties cells as before.

Tests: `click.test.ts` overwrites a data table with fewer rows and finds no empty row. `undo.test.ts` gains the case, and its undo brings back the same row ids and cells. An `OVERWRITE` of part of a table's width deletes no row.

## Documentation changes

**`CLAUDE.md`, design rules:**

- "The client names a cell; the server decides the effect" says that the client names a cell by row id and column id, and that the server resolves them under the lock and answers 409 when one is gone.
- A new rule: positions exist only in the engine. Storage, requests, responses, and the journal name rows and columns by id, and `TableLayout` is the one translation.
- "Anything that holds a formula is rewritten with the cells" says that a structural edit rewrites formula text and format rules and moves no cell.
- "A formula column's cells are not stored" says the engine gives every row a computed cell.
- The rule on `change` adds that row records are written through `ContentWriter`.

**`README.md`:**

- "Working together" under What's missing: a save follows its row and column when someone else inserts or deletes above it.
- "Tables": a data table holds the rows added to it and offers a new row.
- The actions table: `APPEND_ROW` and `INSERT` add rows to the end of a data table.
- "History and files": the undo sentence names the one conflict that refuses an undo. The sentence that the file has no ids stays.
- "How it works": one paragraph on row and column ids and where positions are computed.
- "Size": the row limit.

**`DECISIONS.md`:** one new entry, "Rows and columns have ids", with the decisions and rejected alternatives of this plan. It names what it replaces in earlier entries:

- Undo through a server-side journal: rules 1 and 2, and the risk about reversing a row insert in a full table.
- Fixes from a code review: "A save still names a cell by its row and column".
- Data tables: "A formula column computes only in rows that hold something" and "Showing only the rows that hold data".
- Deleting and inserting rows and columns: "Known cost".
- Live updates: "A change is announced, not described".

**`todo.md`:** check off the P3 items on the stale save and on sending changed cells, the item on hiding empty rows, and the P1 undo item when step 5 is merged. Remove "shift in SQL if this gets slow".

## Risks

- **The cells migration is the one step that can lose data.** It runs at startup on every instance. Mitigation: the migration test in step 3, a count of unmatched cells before any delete, and a database backup before deploying it.
- **Row count and row records can disagree between steps 1 and 3.** Two things hold one fact for those two steps. The invariant test in step 1 covers every content route in `undo.test.ts`.
- **Order keys grow.** Inserting again and again before the same row lengthens the key by about one character for every few inserts. At 1,000 rows per table the keys stay short. Renumbering a table's keys would invalidate journal entries that hold them, so the plan has no renumbering.
- **Key order must match in Postgres, PGlite, and JavaScript.** It depends on the `"C"` collation, which is unverified for PGlite. A test in step 1 sorts the same keys in all three.
- **A stale formula can still be saved until step 7.** See the wire protocol section.
- **Snapshots grow.** Each row adds about 60 bytes, so 100,000 rows add about 6 MB to a snapshot that already holds up to 100,000 cells.
- **Events will carry content.** A mistake in the access check of step 7 leaks cells to a person whose share ended. The stream sends none today.
- **The work passes through `spreadsheets.ts` and the workbook store**, the two largest files, which other sessions edit often. Steps 1, 3, and 4 should each merge quickly.
- **Empty rows change what formula columns show.** A row with nothing typed computes its formulas, so a data table that had empty rows between filled ones shows results in them after step 6.

## Decisions the author accepted

The author accepted each of these on 2026-10-01. The sections above already state them as decided.

1. **Naming a table's columns deletes its empty rows at the end.** `SUM(A1:A20)` over five filled rows becomes `SUM(A1:A5)`. Keeping the rows would leave data tables with unused rows, which is problem 3.
2. **A formula column computes in every row of a data table** (step 6). A row means a record, and the engine loses the per-row counting.
3. **`OVERWRITE` removes the rows it empties in a data table** (step 8), when its range covers every column. The planned action "delete a row that matches a condition" can use the same effect.
4. **The server refuses a formula typed against a stale structure** (step 7). Only a formula saved in the moment after another person's structural edit is refused.
5. **A spreadsheet holds at most 100,000 rows.** The limit is raised together with `tableRows`, once the grid draws only the rows in view.
6. **Columns do not get their own table now.** Decide again when relations or per-column settings such as number formats are designed.
7. **Narrowing the undo rule for creating or deleting a page, table, or view is a separate change** after step 5. It does not depend on row ids.

Decision 1 covers empty rows at the end of a table, and only when its columns are named. A row whose cells are all cleared later stays as an empty row, so that its id remains valid for a relation that points at it. Whether a data table should delete such rows is left for later and is listed in `todo.md`.

## Verification of this plan's implementation

- `pnpm check` after every step.
- `pnpm test:postgres` after steps 1, 3, 5, 7, and 8. The lock tests and the collation test need real Postgres.
- `pnpm e2e` after steps 1, 4, 6, and 7, outside the sandbox.
- By hand after step 1, with two browser sessions on one spreadsheet: start an edit in one, insert a row above it in the other, commit the edit, and find the text in the row it was typed in.
