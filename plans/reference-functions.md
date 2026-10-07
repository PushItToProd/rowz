# Reference functions

This plan covers `OFFSET`, `INDIRECT`, `ADDRESS`, `ISFORMULA`, and `ISREF` in rowz's formula engine.

## Current reference model

`packages/engine/src/ast.ts` represents a reference as a `CellReference` or `ColumnReference` node. A cell reference stores optional page and table names plus row and column positions. `[Price]` refers to the current row in the formula's table. `Sales[Price]` refers to that named column across the stored rows of Sales.

`packages/engine/src/parser.ts` parses `A1`, `A1:B3`, `Sales!A1`, `'Page 2'!Sales!A1`, and the structured-column forms. `TableResolver` in `packages/engine/src/structure.ts` resolves the names case-insensitively. An unqualified cell reference uses the formula's own table. A page-scoped formula, such as a chart source or text-view expression, has no table of its own and must name a table.

References name positions in a table. The server stores stable row and column IDs. `packages/shared/src/table-layout.ts` maps those IDs to engine positions. `A1` means row 0, column 0 of the table selected by the reference's qualifiers. Structural edits rewrite direct references so they continue to name the same surviving cells. The engine does not store an ID in a `CellReference`.

Sorting and filtering change only the displayed rows. `apps/web/src/stores/workbook/selection.ts` builds a `RowView` from `displayRows`. It translates between displayed places and stored row positions. The engine reads the stored order. `OFFSET` should move from a stored position. It should not count rows in the current sorted or filtered display. A display-place interpretation would make a formula depend on web-only view state. It could target a different cell after a sort.

`readReference` in `packages/engine/src/evaluate.ts` resolves a reference to a `CellRange`. A cell reference without an explicit end, such as `A1`, reads one cell value. A reference with an end, including `A1:A1`, becomes a `RangeValue` even when it covers one cell. `isSingleCell` in `packages/engine/src/ast.ts` treats every reference with an end as a range. `RangeValue` in `packages/engine/src/values.ts` does not retain the table ID or coordinates. An evaluated range therefore does not identify its source cells.

`referencesOf` in `evaluate.ts` extracts static references from a parsed formula AST. `Workbook.index` in `workbook.ts` resolves those references. It registers their ranges with `DependencyIndex` in `graph.ts`. `namePrecedents` adds the static cells read by names to each consuming formula's precedents. `evaluationOrder` finds strongly connected components before formula evaluation. The workbook reports `#CYCLE!` for a static cycle.

Action calls are the exception to static dependency extraction. `referencesOf` returns no references below an action call. `call` stores the action's argument nodes in an `ActionValue` without evaluating them. `Workbook.planAction` evaluates them when the action runs. A reference function must preserve this behavior inside button arguments. `Workbook.targetOf` currently accepts a direct reference node or a name whose formula is one direct reference. It does not accept dynamic action write targets.

`ROW` and `COLUMN` are special forms in `packages/engine/src/functions/lookup.ts`. They receive the argument AST and call `context.resolve` without reading the cell. `ROWS` and `COLUMNS` in `packages/engine/src/functions/arrays.ts` receive evaluated values through `eager`. They see range dimensions but not reference identity. `ISBLANK` and the other information checks also receive evaluated values. `OFFSET`, `ISFORMULA`, and `ISREF` need a reference-preserving argument mode. `INDIRECT` takes text and returns a reference.

The web editor uses `analyzeSource` and `formulaAt` to parse direct references. `apps/web/src/formula/references.ts` resolves those tokens to stored cell rectangles. `referenceOutlines` maps stored rows to visible places, and `FormulaEditor.vue` shows the matching colors. `apps/web/src/formula/picking.ts` uses the same formula analysis to find a reference span to replace. The editor does not evaluate names to find their cells. A reference written inside an `INDIRECT` string is not a parsed reference token, so it cannot currently receive a cell outline or be picked as a reference.

## Proposed semantics

| Function                                              | Proposed meaning in rowz                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ADDRESS(row, column, [absolute], [table], [page])`   | Return text for a one-based row and column. Use rowz's A1 grammar and `$` markers. Use `1` for `$A$1`, `2` for `A$1`, `3` for `$A1`, and `4` for `A1`; default to `1`. When a table or page is supplied, format the same `Table!A1` or `Page!Table!A1` qualifier used by ordinary references. In a cell formula, omitted qualifiers mean the formula's table. A page-scoped formula needs a table argument. |
| `ISFORMULA(reference)`                                | For one cell, return whether its stored input is a formula. Accept an explicit one-cell range such as `A1:A1` and test its cell. Reject a reference covering multiple cells. A formula-column cell counts as a formula because its column definition supplies the formula. A spill destination does not count because it has no formula input of its own.                                                   |
| `ISREF(value)`                                        | Return whether the expression produces a reference. Direct cell references and ranges count, including `A1:A1`; structured-column references count too. Text such as `"A1"` does not. `INDIRECT` and `OFFSET` results should count once the engine preserves reference identity.                                                                                                                            |
| `OFFSET(reference, rows, columns, [height], [width])` | Return a reference shifted from the base by row and column counts in stored table positions. Default height and width to the base reference's size. Require positive dimensions. Return `#REF!` for a negative position. Follow ordinary reference reads when the result extends beyond the table extent.                                                                                                   |
| `INDIRECT(reference_text)`                            | Parse rowz reference text, resolve it in the formula's existing table or page context, and return a reference. Support the same positional, named-column, table, and page qualifiers as the parser. Do not add R1C1 syntax unless the parser gains that syntax separately.                                                                                                                                  |

`ADDRESS` should format a rowz reference, not invent a separate quoting rule. `formatReference` and `quoteName` in `ast.ts` already write `$` markers and quote page and table names. `ADDRESS` returns text, so the returned text is not itself a dependency or a reference until passed to `INDIRECT`.

`ISFORMULA` needs formula-status access for the referenced cell. `EvaluationContext` exposes `read`, but not the cell input. Add a narrow context method for formula status or input inspection. Do not infer formula status from the evaluated value. A formula can return any value. An escaped literal can contain formula-like text.

The current special-form mechanism lets `ROW` and `COLUMN` inspect direct reference AST nodes. It does not preserve references returned by nested calls. `ISFORMULA` needs reference identity to locate the cell input. `ISREF` needs it to distinguish a reference from an ordinary value. `OFFSET` needs it to shift its base reference. A reference-aware argument mode or a first-class internal reference value can carry the table ID and rectangle. Ordinary arithmetic and value functions must continue to read cell values. The reference value must let `ISREF(OFFSET(...))` inspect a returned reference. It must also let `SUM(INDIRECT(...))` read the returned range values.

The app-specific `ADDRESS` signature and the scalar behavior of `ISFORMULA` need author confirmation. `ADDRESS` has no current table context in page formulas. The parser supports A1-style positional references, but not R1C1. The proposed signature omits the standard R1C1 flag. It has separate table and page qualifiers because a rowz page can contain several tables.

New function bodies should convert arguments with helpers in `packages/engine/src/functions/arguments.ts`. Helpers such as `scalar`, `number`, `integer`, and `text` throw `Failure` when argument conversion fails. `fail` throws `Failure` directly. The `PureFunction` and `ActionFunction` contracts in `packages/engine/src/functions/registry.ts` require function failures to be thrown. The evaluator in `packages/engine/src/evaluate.ts` converts `Failure` into a formula error.

## Dynamic dependencies

`INDIRECT` chooses a target from evaluated text. `OFFSET` chooses a target from its base reference and evaluated offsets. `referencesOf` cannot discover those targets from the AST alone. Without another dependency path, a formula can keep a stale result when its dynamic target changes. It can also read a formula cell before that cell has been computed.

There are three implementation choices:

1. **Treat dynamic-reference formulas as volatile.** Re-evaluate them on every cell or structure change. Then invalidate their dependents. `Workbook` already tracks formulas that read the clock in `volatileCells`. `recalculateVolatile` refreshes them. Extending volatility to cell changes is the smallest graph change. Evaluating every dynamic formula can make an ordinary edit expensive. Recalculation still needs an ordering rule so a dynamic read sees a computed target.
2. **Record dynamic dependencies during evaluation.** When a reference-valued function resolves a target, record that range for the active formula or name. Replace old dynamic ranges when that formula or name is re-evaluated. Add the ranges to `DependencyIndex`. This preserves incremental invalidation. It gives the graph edges to order formulas and find cycles. It needs a re-evaluation strategy when evaluation discovers an edge after the current order was computed.
3. **Restrict `OFFSET` to statically analyzable arguments.** Require a direct base reference and literal row and column offsets, for example. Resolve the target while indexing the AST. This keeps the graph static. It prevents uses where offsets come from cells. It does not solve general `INDIRECT`.

**Recommendation: use dynamic dependency recording as the target design.** `invalidate` follows dependency-index edges to transitive dependents. `setCell` also invalidates a former spill anchor. It retries blocked array formulas in the same table. Clearing a spill queues readers of the former spill cells and blocked formulas in that table. Volatility would re-evaluate every dynamic formula on each cell change. It would also invalidate their dependents. That cost grows with the number of dynamic formulas and their dependents. Volatility still needs an ordering rule so dynamic reads see computed target values. Static restrictions would make `OFFSET` surprising. They would not solve normal `INDIRECT` inputs.

Record dynamic ranges for cell formulas. Replace them when a selected reference changes. Rerun affected evaluation until dependencies and values settle. Keep direct references in the existing static graph.

Names and lambdas also need dynamic dependency handling. `DependencyIndex` stores dependents as `CellId` values. It has no name nodes. `Workbook.index` expands static name precedents into each consuming cell's dependency entry. `nameValue` caches each name's result by workbook epoch. Store dynamic ranges on a `NameRecord`. Expand those ranges into the dependency entry of every consuming cell, as `Workbook.index` does for static name precedents. Replace the entries when a name resolves a different target. A write to a dynamic target must invalidate every consuming cell and its transitive dependents. The invalidation advances the epoch, so `nameValue` recomputes the name. Expand dynamic ranges through nested names too.

`callFunction` in `packages/engine/src/evaluate.ts` evaluates a lambda body in its captured `fn.context`. `INDIRECT` and `OFFSET` inside a lambda resolve in that captured context. They do not resolve in the caller's context. Attribute dynamic ranges read by a lambda body to its active consuming cell formula. If a name invokes the lambda, store those ranges on the name's `NameRecord`. Expand them into every consuming cell's dependency entry, as described above.

## Rewriting and text references

`rewriteReferences` and `referenceEdits` in `packages/engine/src/rewrite.ts` parse formula text and replace the spans of reference nodes. `inputsAfterRename`, `inputsAfterMove`, and `formulasAfterEdit` use this path for direct references. Repository changes also rewrite formula-bearing views, formula columns, filters, and named formulas.

The parser treats a string as a string node. It does not parse reference syntax inside the string. A table or page name passed as text to `ADDRESS` is not rewritten on rename. A reference string passed to `INDIRECT` is not rewritten on rename. Row and column edits cannot rebase coordinates embedded in `INDIRECT` text. `ADDRESS` output is computed text, not stored formula syntax. `rewrite.ts` cannot update that output after the fact.

Document this limitation in the function help and README. Text references can stop naming the same object after a rename or structural edit. Use direct references or named columns when formulas must follow renames and row or column insertions. `OFFSET`'s base reference remains a normal AST reference. The existing rewrite path updates it. Its computed offset uses the resulting stored position.

## Cycles, limits, and permissions

`evaluationOrder` detects cycles from edges present in `DependencyIndex`. It cannot find dynamic self-references or mutual cycles before those edges are recorded. Add newly observed edges before accepting a computed value. Check the updated graph for cycles. Return `#CYCLE!` when the graph has a cycle. Remove old dynamic edges when inputs change. Otherwise a formula that moves away from a cycle can remain falsely cyclic. `MAX_ATTEMPTS` handles arrays that repeatedly invalidate their own inputs. It does not replace dynamic cycle detection.

The engine is pure. It resolves references only through `TableResolver`. A dynamic string must not open files, URLs, or another document. Cross-page references can reach any page in the same document. Shared access applies to the document as a whole. The repository has no separate page or table permissions. Dynamic references do not change that rule.

`Workbook.extent` uses explicit row and column counts when they are present. For a plain grid, it derives each unspecified dimension from stored cell records and spill cells. An empty plain grid has a zero-by-zero inferred extent. `readReference` does not create cells. A missing single-cell read returns `null`, even beyond the extent. A multi-cell read clips its end to the extent. A range that starts past the extent reads no cells.

Preserve those read rules for `OFFSET` and `INDIRECT`. On a plain grid, "outside the table" means beyond the rectangle inferred from existing cells and spills. A single-cell target outside that rectangle reads as `null`. A multi-cell target clips to that rectangle. A target that starts beyond the inferred extent reads no cells. Neither function creates cells or grows the table. A negative row or column position cannot name a valid cell. Return `#REF!` for a negative position. Before materializing a resulting range as an array, call `limitCells` from `packages/engine/src/functions/arguments.ts`. It caps function-created arrays at 100,000 cells. Keep open-ended ranges bounded by the table extent. Preserve explicit row and column limits on data tables.

The dependency index is optimized for single cells and ranges filed by table and column. Dynamic ranges should use the same index. Replace old entries without scanning every formula. A volatile fallback would scan or invalidate every dynamic formula on each edit. Its cost grows with the number of dynamic formulas and their dependents.

Action arguments must remain out of the recalculation graph. A dynamic reference inside a button is evaluated only when `Workbook.planAction` plans the click. If dynamic write targets are supported, the server must derive the action from stored inputs under the spreadsheet lock. `apps/server/src/actions/run.ts` follows this rule for cell actions. The request identifies the clicked cell by stable IDs, and the engine resolves it to a position from the locked contents. The engine represents planned writes by table and position. `SpreadsheetRepository.applyEffects` in `apps/server/src/repo/spreadsheets/cells.ts` resolves each position through `TableLayout.identity` in `packages/shared/src/table-layout.ts`. It writes the stable row and column IDs.

## Tests and help

Add engine tests next to the relevant code:

- Parser tests for reference strings with quoted names, table qualifiers, page qualifiers, and structured columns.
- Function tests for `ADDRESS` output with quoted names and table or page qualifiers.
- Function tests for one-cell and range references, `$` modes, stored-position offsets, missing tables, bad dimensions, and out-of-table results.
- Workbook and graph tests for changed dynamic targets and recalculation order.
- Workbook and graph tests for replacement of old dependencies, dynamic self-cycles, and mutual cycles.
- Workbook tests for name caches, lambda context, and formula-column cells.
- Tests showing that a sort or filter does not change `OFFSET`, and that direct `OFFSET` base references still rewrite after renames and row or column edits.
- Tests showing that `INDIRECT` and `ADDRESS` text is not rewritten, that invalid reference text returns the chosen reference error, and that a dynamic range cannot exceed `limitCells`.
- A test that action arguments remain unevaluated and are not registered as cell dependencies during recalculation.
- Web tests for direct reference highlighting and the documented behavior of strings that contain reference text.
- Dynamic result highlighting would need evaluated reference metadata. `analyzeSource` alone cannot find it.

Register functions in `packages/engine/src/functions/index.ts`. Add one entry per function to `packages/engine/src/docs.ts`. `docs.test.ts` requires every registered function to have a working example. `apps/web/src/views/HelpView.vue` builds the function list from `functionDocs`. The new entries will appear there automatically.

Update the References section in `HelpView.vue` if the new semantics need examples. Update the README feature list, which currently names `INDIRECT` and `OFFSET` as missing. Document the text-rewrite limitation beside both functions.

## Implementation phases and estimates

Estimates include engine changes, focused tests, and help text. Dynamic dependency support is shared infrastructure. It carries most of the implementation risk.

| Phase | Work                                                                                                                                                                                                          | Estimate                                                       |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1     | Define an internal reference-preserving value or argument mode. Add an input-status query to `EvaluationContext`. Implement `ADDRESS`, `ISFORMULA`, and `ISREF`.                                              | `ADDRESS` S; `ISFORMULA` M; `ISREF` M; shared reference mode L |
| 2     | Record and replace dynamic dependency ranges. Preserve evaluation order, invalidation, and `#CYCLE!` detection. Implement `OFFSET` using stored positions and table bounds.                                   | `OFFSET` L; graph support L                                    |
| 3     | Parse evaluated text with the existing formula parser, resolve it in the caller's context, and implement `INDIRECT` through the dynamic dependency path.                                                      | `INDIRECT` L                                                   |
| 4     | Update the web help, README, reference-picking/highlighting documentation, and the function examples. Add any dynamic outline behavior only if the engine exposes evaluated reference metadata to the editor. | S to M                                                         |

Implement `ADDRESS` and the information functions first. They do not need runtime text parsing. Implement `OFFSET` before `INDIRECT` because its base is an AST reference that existing rewriting understands. Implement `INDIRECT` after the reference-value and dependency contracts are in place.

## Questions for the author

- Should `OFFSET` count stored rows, as proposed, or visible places in a sorted and filtered table? Stored rows match formula references and work in the pure engine.
- Should `ADDRESS` accept the proposed rowz signature with optional table and page names? Should it support only A1 syntax, or should R1C1 syntax be added to the parser first?
- Should `ISFORMULA` accept only one cell, or return a Boolean array for a range? Should formula-column cells count as formulas, as proposed?
- Should `ISREF` recognize only direct references, or every expression that evaluates to a reference, including `OFFSET`, `INDIRECT`, names, and future reference-returning functions? The latter needs reference identity preserved through evaluation.
- Should `INDIRECT` accept only reference syntax, or also names that resolve to a single reference? Should it accept structured column references?
- Is dynamic dependency recording the accepted target, including dynamic reads through names and lambdas, even though it is the largest shared change?
