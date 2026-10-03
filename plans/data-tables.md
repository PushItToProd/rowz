# P2: data tables

## Context

The P1 theme (names and testable logic) is done. `todo.md` lists four open P2 items: sort and filter a data table in place, dropdown columns, basic conditional formatting, and the Gran Turismo 7 reference document that serves as the theme's acceptance test. This plan implements all four.

The author decided four questions on 2026-10-02:

| Question                        | Decision                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Filter                          | One filter formula per table, such as `=[Payout] > 60000`.                                            |
| Ranges while sorted or filtered | A selection is a rectangle of the rows shown. Copy, clear, fill, paste, and delete act on those rows. |
| Dropdown choices                | A list on the column, or a column of another data table.                                              |
| Conditional format condition    | A `COUNTIF`-style criterion on the cell's own value, or a two-color scale.                            |

Earlier decisions that still hold: sort and filter are display settings stored on the table, and the stored row order does not change, so `A2` and `SUM(Sales[Amount])` read the same cells under any sort or filter (`plans/persistent-row-identity.md`, "Formula semantics").

## Storage and wire, shared by the stages

One migration adds two columns to `tables` (`apps/server/src/db/schema.ts`):

- `display jsonb not null default '{"sort":[]}'`, typed `TableDisplay = { sort: { colId: string; descending: boolean }[]; filter?: string }`.
- `conditional_formats jsonb not null default '[]'`, typed `ConditionalRule[]`.

Dropdown settings go in `ColumnDefinition`, which is already stored per column.

Both new columns join `tableColumns` in `repo/journal.ts` and `repo/spreadsheets.ts`, so snapshots, change events, and journal entries carry them. Every write goes through `ContentWriter.updateTable` inside `changeTable`, which makes each one an undo step with no new journal code.

Sort keys and `choicesFrom` name columns by id, so a rename or a column insert needs no rewrite of them. The file format has no ids. `toSpreadsheetFile` in `packages/shared/src/index.ts` writes a sort key as a column index and `choicesFrom` as `{ page, table, column }` names, and `PlacedTable` gains `colIds` for that. Import and version restore (`spreadsheets.ts` near line 725) resolve them back to ids in a second pass, after every table has its new ids.

New routes in `apps/server/src/routes/tables.ts`, each added to the write list in `access.test.ts` and given a round-trip case in `undo.test.ts`:

- `PUT /tables/:tableId/display` replaces the sort and filter. A body with a filter must carry `revision`, as other formula writes do.
- `PUT /tables/:tableId/conditional-formats` replaces the rule list. Ranges name rows and columns by id (`identityFormatRange`), and the server stores positions, as `formatCells` does.

`PATCH /tables/:tableId/columns/:colId` gains `choices` and `choicesFrom`.

## Stage 1: sort and filter in place

### Engine (`packages/engine`)

- New `display.ts`: `displayRows(rowCount, valueAt, sort, shown)` returns the stored row indexes in display order. It sorts stably, so ties keep stored order. It reuses `cellOrder` from `functions/arrays.ts`, moved to `values.ts` so that both use one comparator.
- `Workbook.filterRows(tableId, formula)` parses the formula once and evaluates it for each row with `context({ tableId, row, col: 0 })`, so `[Column]` means that row's cell, as in a formula column. It returns which rows pass and the first error.
- `TableDefinition` gains `filter?: string`. The filter is a new place that holds a formula, so `columns.ts` gains `filterFormulasAfterRename`, `filterFormulasAfterMove`, and `filterFormulasAfterEdit`. `rewriteColumns` and `rewriteNames` already repeat the same per-table rewrite; extract that into one helper and build all three on it.

### Server

- `setTableDisplay` in `SpreadsheetRepository`: refuses a plain table, an unknown column id, and a filter written before the last rewrite (`checkWrittenAt`).
- `storeRewrite` takes `filters` beside `cells`, `views`, `columns`, and `names`. `rewriteFormulas`, `rewriteForMove`, and `applyEdit` pass them.
- `applyEdit` drops the sort keys of deleted columns. `dropColumns` resets `display`.
- `writesFormulas` in `journal.ts` counts a changed filter as formula text.

### Web

The selected cell stays a stored position (`selection: CellId`). Many readers treat it as an engine cell: the formula bar, the format bar, `withStableSelection`, and `refresh`. Only range operations and keyboard movement depend on display order, so the translation goes in one place in the store:

- `rowView(tableId)` gives `rows` (stored row indexes in display order, filtered rows left out), `place(row)`, and `reordered`. It is computed from the engine and `table.display`.
- `selectedRange` becomes a rectangle of display places. A helper maps a display row to its stored row, and to rows past the end for a paste that appends.
- `fillWrites` and `pasteWrites` in `apps/web/src/formula/fill.ts` take an optional `storedRow` function and shift A1 references by the stored distance. `copied` records the stored row of each copied row. `clearSelection`, `copySelection`, `fill`, and `paste` run those functions over display places and map the writes back.
- A new `deleteLines(tableId, axis, indexes)` sends the row ids of the selection. The server already accepts ids that are not adjacent.

`GridView.vue` iterates display places and keeps `data-cell` as the stored address. The row header shows the stored row number. Arrow keys, Shift+arrows, header selection, Ctrl+A, and the fill handle step through display places. `finish` picks the next cell before it commits, so Enter moves down from where the row was. A selected row that a filter hides clears the selection.

`TableCard.vue` gets a sort and filter bar for data tables: sort keys chosen by column and direction, a filter input using `useFormulaAssist`, the filter's error, and a count of hidden rows. Column header menus add "Sort ascending", "Sort descending", and "Clear sort".

While a table is sorted or filtered:

- "Insert row above" and "below" are disabled. The strip that adds a row at the end still works.
- `formatSelection` accepts a single row or whole columns and otherwise shows a notice, because a format rule covers a run of stored rows.

### Tests

Engine: `display.test.ts`, filter cases in `columns.test.ts` and `rewrite.test.ts`. Server: `display.test.ts` (refusals, rewrite on rename and column edits, stale formula, import and export round trip). Web: `fill.test.ts` with `storedRow`, store tests for each range operation under a sort, `GridView.test.ts` for order, navigation, and row numbers.

## Stage 2: dropdown columns

- `ColumnType` gains `"choice"` in `packages/engine/src/structure.ts` and `COLUMN_TYPES` in shared. `ColumnDefinition` gains `choices?: string[]` and `choicesFrom?: { tableId: string; colId: string }`. `updateColumn` requires one of them for a choice column, checks that the source column is in the same spreadsheet, and `normalized` drops both for other types.
- The engine reads a choice cell as it reads an `any` cell. Checking a cell against another column would make every choice cell depend on that column, and a fixed list should behave the same way.
- Store: `choicesOf(cell)` returns the list, or the distinct non-empty values of the source column in stored order.
- `CellView.vue` takes `choices` and shows a `<select>`. A value outside the list stays, shown as an extra option with a warning style. Choosing calls `store.setCell`.
- New `ChoicesPanel.vue`, opened from "Column holds: A choice…": one option per line, or a data table and column picked from two selects. No `window.prompt`.

Tests: server column tests (validation, file round trip with names resolved, a deleted source column), `CellView.test.ts`, `TableCard.test.ts`.

## Stage 3: conditional formats

- `ConditionalRule` in `packages/engine/src/formats.ts`: the area fields of `FormatRule` plus `{ kind: "criterion"; criterion: string; format: FormatPatch }` or `{ kind: "scale"; low: FormatColor | null; high: FormatColor }`.
- New `conditional.ts` in the engine: `scaleBounds(rule, read, extent)` gives the smallest and largest number in a rule's area, and `conditionalFormatAt(rules, bounds, row, col, value)` gives the format to lay over `formatAt`. It uses `criterion` from `functions/criteria.ts`. A scale sets `CellFormat.shade = { low, high, at }`, which `formatPatch` does not accept from clients.
- `formatRulesAfterEdit` becomes generic over the area, and `applyEdit` runs it on both lists.
- `setConditionalFormats` in the repository: at most 50 rules, and each criterion is built once so that a bad one is refused on save.
- Store: `formatOf` lays the conditional format over the plain one. Scale bounds are computed once per rule for each engine state.
- `apps/web/src/formatStyle.ts`: `cellStyle` blends the two fill shades at `shade.at`.
- New `ConditionalFormatsPanel.vue` on the table card, for any table: lists rules with their ranges, adds one for the current selection, and reuses the color and style controls of `FormatBar.vue`.

Tests: `conditional.test.ts`, a server test for the route and for rules following row and column edits, a store test for `formatOf`, a panel test.

## Stage 4: the Gran Turismo reference document

Create `samples/gt7-grind-comparison.json`, after the author's sheet "GT7 grind comparison v2" (try reading through the Google Drive connector; fall back on `_scratch/google-sheets-exported-to-xlsx/GT7 grind comparison v2.xlsx` if the connector doesn't work):

- A data table `Races`: name, payout with bonus, minimum and maximum duration.
- A data table `Runs`: `Race` as a choice column from `Races[Race Name]`, `Duration`, and formula columns for payout per minute, races per hour, races in 8 hours, races in five 8-hour days, and payout over 40 hours. It is sorted by payout, descending, with a color scale on that column.
- A report page: the explanatory text, and `QUERY(Runs, "… pivot Duration")` in a plain table with a color scale.

The sample is imported in a server test, as a check that the file format carries every new setting. Whatever blocks building it becomes a `todo.md` item.

## Documentation and records

- `CLAUDE.md`: add the filter to the rule "Anything that holds a formula is rewritten in the same transaction", and state that the selection is a stored position while ranges are display places.
- `DECISIONS.md`: the four decisions above.
- `AGENT_DECISIONS.md`: choices made in this plan without the author. A choice cell is not checked by the engine. A sorted table re-sorts as cells change. A row whose filter gives an error stays shown. Multi-row formatting is refused while sorted or filtered. CSV export writes every row in stored order.
- `README.md`, `HelpView.vue`: sort and filter, choice columns, conditional formats.
- `todo.md`: check off the P2 items and remove their prefixes.

## Verification

After each stage: `pnpm check`. After the migration: `pnpm --filter @spreadsheet-app/server db:generate`, add its checksum, then `pnpm check:migrations`.

At the end: `pnpm e2e:remote`, with new cases in `e2e/spreadsheet.spec.ts` that sort a data table and edit a cell in the first row shown, filter and fill down across shown rows, pick a dropdown value, and see a conditional fill. This needs the `playwright` container and access to `127.0.0.1:3200`. If the sandbox blocks it, I will ask the author to run it and not claim it passed.
