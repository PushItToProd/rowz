# Completed to-do items

Archived from `todo.md` on 2026-10-10. Descriptions and validation notes record the state when written; they are historical, not current work instructions. Open follow-ups remain in [todo.md](../../todo.md).

## Plans

- [x] **P1** implement [persistent row identity](../../plans/persistent-row-identity.md)
- [x] implement [data tables](../../plans/data-tables.md): sort and filter, dropdown columns, conditional formats, and the Gran Turismo 7 sample
- [x] **P1** merge the changes from the design-principles branch #codebase

## Bugs

The original list included a browser QA pass on 2026-10-05 at commit `b236b7f730cea29cd32823ea0c85a5e3357fdcbd` (headless Chromium, 1440×900, Vite dev build; screenshots in `_scratch/qa/`) and the review of 2026-10-01 in `_scratch/2026-10-01-fresh-eyes-review.md`. Their remaining open findings are in `todo.md`.

- [x] **P8** `CLAMP(A1:A3, 0, C1:C2)` with `A3` an error returns `#N/A` for the third cell, not the error: the array path fetches the cells of all three arguments before it checks any of them (`packages/engine/src/functions/math.ts`) #formula-language
- [x] A button cannot be pressed from the keyboard: in the grid, Enter on a selected cell starts editing and Space starts a space-prefixed edit, so the handler cancels the browser's activation of a focused `<button>`; in a text view, the delegated key handler prevents Enter for every descendant including buttons (`apps/web/src/components/GridView.vue`, `TextCard.vue`) #everyday
- [x] **P5** `CHECKBOX` and `DROPDOWN` writes skip the target column's type check that `TEXTBOX` and `NUMBERBOX` now have: `CHECKBOX(A1)` aimed at a number column stores `TRUE`, and `DROPDOWN("abc", A1)` stores `abc`, both leaving a `#VALUE!` cell (`packages/engine/src/workbook.ts`, the final return of the input planner) #small-apps
- [x] **P6** A quoted `QUERY` identifier that looks like a numbered column resolves by position before header lookup: with headers `Other` and `Col1`, `QUERY(A1:B2, "select 'Col1'", 1)` selects the first column, and a header `Col9` in a two-column range gives "The data has no column Col9". A quoted identifier should skip `ColN` resolution (`packages/engine/src/query.ts`) #formula-language
- [x] **P8** `QUERY` groups rows by `JSON.stringify`, which writes every `Map` as `{}`, so two buttons that differ only in their captured names (`QUERY(MAP(SEQUENCE(2), LAMBDA(x, BUTTON("go", EXECUTE(x, C1)))), "select Col1, count(*) group by Col1", 0)`) merge into one group #formula-language
- [x] **P8** Criteria `>""` and `<""` (quoted empty text) take the blank-criterion shortcut and match every non-empty cell; let an explicitly quoted empty operand reach comparison (`packages/engine/src/functions/criteria.ts`) #formula-language
- [x] **P10** A quoted criteria literal containing `*` or `?` still goes through `wildcard()`, so a 255-character quoted literal throws `#VALUE!` from the wildcard length limit even though quoted text is literal #formula-language
- [x] **P5** When an action runs while a formula edit is active, the draft save can clear a pending save's error and the action is then skipped without notice (`stores/workbook/queue.ts` line 30 does not forward `clearPreviousError`) #everyday
- [x] **P6** The Choices panel (`choosingFor` in `TableCard.vue`) is outside the one-open-side-pane state, so it can stay open beside Names or Conditional formats #everyday
- [x] **P6** Escape does not close the Names and Conditional formats panels #everyday
- [x] **P8** After deleting a page from its context menu, keyboard focus falls to the body because the page tab that held it is removed; move focus to the neighboring tab (`PageTabs.vue`, `ContextMenu.vue`) #everyday
- [x] **P7** A right-click on a button, a `<select>`, or a link in a block's header shows the browser's menu, because `openBlockMenu` in `EditorView.vue` returns early for those targets. Open the block's menu there, as a page tab's buttons open the tab's menu. A text field or editor keeps the browser's menu. See "Menus" in [docs/design/ui.md](../../docs/design/ui.md) #everyday
  - (Codex) completed on 2026-10-07: block headers now open the app menu for controls and links, while text inputs and editors keep the browser menu.
- [x] **P7** A failing assertion in a script name (`Positive = ASSERT(...)`) has no line, so revealing it focuses the script block but cannot scroll to the definition; scroll to the `data-script-line` of the definition (`apps/web/src/stores/workbook/values.ts` near line 69, `ScriptCard.vue` near line 122) #everyday
- [x] **P7** The failing-assertions panel drops the optional error trace, so an assertion propagated from a script function has no Open definition button (`apps/web/src/stores/workbook/values.ts` near line 32, `AssertionsPanel.vue`) #everyday
- [x] **P6** An ambiguous-name message can recommend a qualified name (`Summary!Total`) that is itself still ambiguous, for a name and a table on one holder (`workbook.ts`, near line 961). Offer a spelling that resolves #formula-language
- [x] **P8** `SORTBY` treats error keys and blank keys as equal, so a blank key can stay ahead of an error key; Excel puts errors before blanks, and blanks last (`packages/engine/src/functions/arrays.ts` near line 192, `cellOrder`) #formula-language
- [x] **P7** In `router.ts`, a navigation guard that awaits the leave-document dialog can discard a formula draft after a newer navigation (browser Back) superseded it; check the navigation is still current after the dialog #formula-editing
- [x] **P7** An unfinished quote in one script statement makes later statements look like string content, so bracket pairing stops there; script comment scanning already ends an open quote at the line end (`quoteSpans`, `closeBrackets.ts` near line 23) #formula-editing
- [x] **P6** Apostrophes can pair inside script comments, and apostrophe wrapping of a selected name depends on the selection direction (`closeBrackets.ts` near lines 168 and 169) #formula-editing
- [x] **P8** The column-type warning does not count text cells that become formulas with errors (a Text cell holding `=1/0` turns into `#DIV/0!` when the column changes to Anything or Choice): `inputFitsColumnType` in `packages/engine/src/workbook.ts` near line 148 treats any parsable formula as fitting #data-tables
- [x] **P8** Inline rename in the document list: a whitespace-only name does nothing and says nothing; a list refresh leaves a stale draft that can revert a newer rename made elsewhere (`SpreadsheetListView.vue` near lines 50 and 119) #documents
- [x] **P8** The CSV append confirmation does not say that cells starting with `=` are stored as formulas (as in replace import), so a file can add a button; actions still run only when the button is clicked (`TableCard.vue` near line 151) #documents
- [x] **P4** (Claude) A chart draws at 300 by 150 pixels whatever its data, and its axis labels are about 6 pixels tall. That is the size a browser gives an SVG with no width or height, so the chart's SVG probably has a `viewBox` and no size. Fix it as part of the move to Apache ECharts, which sizes a chart to its block. Resizing a block is a separate item under Tables, pages, charts, and text views #charts
- [x] **P2** (Claude) A cell shows the binary rounding error of its number. `=SUM(C2:C1000)` over 999 amounts with two decimals shows `51487.4899999999`. Excel and Sheets show 15 significant digits, which hides it. Round a number to 15 significant digits for display when the cell has no number format. The `ROUND` item under Fixed is about the value a function returns and does not cover this #everyday
- [x] **P1** (Claude) Rapid keystrokes after Enter or Tab were dropped while the shared formula editor opened or saved: the grid ignored keys once a session existed, and the read-only display field and saving editor consumed keys before focus or save completed. Preserve early characters and replay keys queued during a save. #formula-editing
- [x] **P3** (Claude) A table or page name with a space, written without quotes, gives an error that does not mention quotes. `=SUM(Table 1[Qty])` shows `Expected )` and `=Table 1!B2` shows `Unexpected 1`. Every new table is named `Table 1`, `Table 2`, and so on, so a formula typed by hand meets this first. The document errors panel prints the unquoted form `Table 1!D5` as a cell's address. Clicking a cell to insert its reference writes the quotes. Say in the error that the name needs single quotes when the words before `!` or `[` are a table or page name, or name new tables without a space #formula-language
- [x] **P5** (Claude) A name defined twice in one script was not marked in the script, and a formula that used it was told to do something it could not. With `QtyTotal = SUM(Sales[Qty])` and `QtyTotal = 5` in one script, the script card showed 227 beside both lines. `=QtyTotal` in a cell showed an ambiguity message with the same qualified name twice. Mark the later definition as an error, keep the first usable, and apply the same rule to function definitions. #formula-language
- [x] **P5** (Claude) With a sort on a data table, a selection of a whole column is described by the stored rows at its two ends. Clicking the header of column B while sorted by `Qty` descending made the conditional format panel say "Applies to B4:B20", and the rule it added covers `B1:B`. After the sort was removed, the same selection covered only rows 4 to 20. Keep a whole-column selection as a whole column #data-tables
- [x] **P4** (Claude) An error message at the bottom right stays until its × is clicked, and Escape does not close it. "A column named qty already exists" stayed through several minutes of other work. The banner for a duplicate folder name on the document list stays too, and it moves the list down. Close a message after a few seconds or when the next action succeeds #everyday
- [x] **P6** (Claude) The address of a document that does not exist, and an address the app has no route for, both open the document list with no message. Say that the document was not found #everyday
- [x] **P8** (Claude) The sign-in form and the share panel keep the server's last error after a later attempt that the browser's own validation stops. Submitting the sign-in form empty after a wrong password leaves "Invalid email or password" in view #everyday
- [x] **P5** (Claude) A text view writes a cell's value without the cell's number format. `{{Sales!D1}}` shows `7.5` where the cell shows `$7.50`. The author decided that a bare cell reference in a template carries the cell's number format. A computed value such as `{{Sales!D1 * 2}}` has no cell to take a format from, and `TEXT` formats it #small-apps
- [x] **P6** (Claude) Changing a column's type to Checkbox turns each cell that is not true or false into `#VALUE!` without a warning. In the test the document's error count went from 7 to 14. Say how many cells do not fit the new type before changing it #data-tables
- [x] **P3** (Claude) A click anywhere in a cell of a checkbox column ticks or clears it, so the mouse cannot select such a cell without changing it. Only the box itself should toggle #data-tables
- [x] **P4** (Claude) "Save a copy" opens the copy at once, and the only sign is "(copy)" at the end of the name in the header. A later edit meant for the original goes to the copy. Show a message that the copy is now open, or keep the original open and link to the copy #documents
- [x] (Claude) A whole column of another table, written as an operand, makes a false `#CYCLE!`. With `1` in `Table1!A1`, `=Other!A1+1` in `Table1!A2`, and `=Table1!A:A+1` in `Other!A1`, both formulas show `#CYCLE!`. They should show 3 and 2. `operand` in [evaluate.ts](../../packages/engine/src/evaluate.ts) reads only the formula's own row of `Table1!A:A`, but `Workbook.index` in [workbook.ts](../../packages/engine/src/workbook.ts) records the whole column as a precedent, so the dependency graph has an edge the evaluator never follows. Make the recorded precedent the cell the operand reads. The same applies to a whole row and to `Table[Column]` as an operand.
- [x] (Claude) `QUERY` refuses an alias used in a clause written before the `select` that defines it. `=QUERY(A1:B2, "order by Total select A, sum(B) as Total group by A")` is `#VALUE!` ("The data has no column Total"), and the same query with `select` first works. `AGENT_DECISIONS.md` says clauses may come in any order. [query.ts](../../packages/engine/src/query.ts) resolves names as it parses each clause, so resolve them after every clause is read.
- [x] (Claude) Reproduce, then fix: an undo can erase another person's edit. Ada types `x` in A1. Grace types `y` there and then `x`. Ada's undo finds A1 holding `x`, which is what her step left, and puts back what was there before her, erasing Grace's edit. `assertRecordedMatches` in [spreadsheets.ts](../../apps/server/src/repo/spreadsheets.ts) compares inputs by value, and `changeHistory` looks at later journal entries only to see whether they rewrote references. Refuse a step when a later entry that is still in effect touched one of its cells. Add the case to `undo.test.ts`.
- [x] (Claude) Reproduce, then fix: a response that arrives after the editor has opened another document is applied to that document. `addPage` in the [workbook store](../../apps/web/src/stores/workbook.ts) appends the page and table the server made for document A to the lists of document B, and `renameSpreadsheet` puts back A's record. Other store functions that write after an `await` may do the same and need the same check. `runHistory` already compares the open document's id before applying its answer.

- [x] **P8** (Claude) a Vue warning appears during `pnpm e2e:remote`: injection "Symbol(contextMenuClickGuard)" not found, from `ContextMenu` rendered in `SpreadsheetListView`. Not investigated #codebase
- [x] **P0** the fact that clicking a document name in the document list triggers a rename and you have to explicitly click "Open" to open it is annoying. clicking a document should open it. renaming a document from the document list should be done from the ellipsis context menu that already exists.
  - [x] I assume some agent decided to do this based on some guidance in my design principles, so once you've fixed this, also review those and tell me what motivated doing this. actually, maybe run a `git blame` before you fix the issue and check what commit it happened in to see what that was intended to satisfy
- [x] **P3** A `NUMBERBOX` (cell and text view) sends an empty string when the browser reports an empty value for incomplete input such as `-` or `e` (`validity.badInput`), and an empty string clears the target; refuse the commit instead (`CellView.vue`, `TextCard.vue`) #small-apps
- [x] **P3** `TEXTBOX`/`NUMBERBOX` do not check the target column's type: `abc` into a number column succeeds and leaves a `#VALUE!` cell, and `007` is stored as the number 7 despite the documented text-preserving behavior (`packages/engine/src/workbook.ts`) #small-apps
- [x] **P0** (Claude) A `BUTTON` loses every local name when it is clicked. `=LET(x, A1, BUTTON("go", EXECUTE(x+1, A2)))` shows a button, and clicking it fails with `#NAME? Unknown name 'x'`. `call` in [evaluate.ts](../../packages/engine/src/evaluate.ts) builds the `ActionValue` with the action's arguments, origin, and page, and leaves out `context.names`. `LET` is the case that was run; a `LAMBDA` parameter, a script function's parameter, and a template `let` or loop variable are bound the same way. Keep the bindings in the `ActionValue`, as a `LAMBDA` value keeps its context, and plan the action with them #small-apps
  - A text-view `BUTTON` inside a template loop is one case: an action body that uses the loop variable fails with `#NAME?`, so a button on each row of a loop cannot act on its row. Preserve the bindings for the selected occurrence
- [x] **P6** (Claude) `ROUND(1.005, 2)` is 1, and Excel and Sheets give 1.01. 1.005 is stored as a binary fraction slightly below 1.005, and `ROUND` rounds that. Amounts of money land on such halves often. Round the shortest decimal form of the number instead #formula-language
- [x] **P9** (Claude) `LEFT("😀a", 1)` returns half of the emoji, and `LEN("😀")` is 2. `LEFT`, `RIGHT`, `MID`, `LEN`, and `SLICE` count UTF-16 code units. Make every text function that counts or cuts characters work in grapheme clusters, using `Intl.Segmenter`, so that a flag or a family emoji is one character too. See [DECISIONS.md](../../DECISIONS.md), "Text functions never split a character" #formula-language
- [x] **P2** conditional formatting criteria doesn't handle strings -- I made a conditional format with a condition like `="foobar"` but it didn't apply (maybe b/c it was a data table column with formula values)
- [x] **P2** `QUERY` treats single quotes as delimiting string literals which contradicts the outer formula languge syntax. this isn't exactly a bug but I consider it a severe enough misfeature I'm classing it as one - we should probably have single quotes delimit identifiers in `QUERY` syntax instead so you can write queries like `=QUERY(People, "select 'Favorite food', count(*) group by 'Favorite food'")`. (as this is a pre-production app I don't care if this breaks anything) #formula-language
- [x] Wildcard criteria can stall synchronous formula evaluation. [criteria.ts](../../packages/engine/src/functions/criteria.ts:28) turns `*` and `?` into a backtracking regular expression, then tests cell text at [line 56](../../packages/engine/src/functions/criteria.ts:56). A crafted criterion and long near-matching text can trigger catastrophic backtracking. Formula evaluation has no time limit, and the server evaluates workbook formulas while handling action clicks. Use a matcher with bounded runtime.
- [x] Combined array results can exhaust memory before spill limits apply. [arrays.ts](../../packages/engine/src/functions/arrays.ts:129) caps each `SEQUENCE` call at 100,000 cells, but `HSTACK`, `VSTACK`, and `FLATTEN` have no aggregate output cap ([lines 155–184](../../packages/engine/src/functions/arrays.ts:155)). [workbook.ts](../../packages/engine/src/workbook.ts:654) materializes the result before checking whether it can spill into the table. Preflight the combined result against a workbook-wide cell budget before allocating it.
- [x] Queued writes are not reauthorized after acquiring the spreadsheet lock. `change` in [spreadsheets.ts](../../apps/server/src/repo/spreadsheets.ts) takes the lock and runs the work without checking access again, so a write that waited on the lock runs even when the caller was downgraded or removed while it waited. `changePage`, `changeTable`, and `changeView` already read their target again under the lock with `"write"`. The methods that call `change` directly (`createPage`, `reorderPages`, `restoreVersion`) and the public `lockSpreadsheet`, which button clicks use, check only before the lock.
  - Fix it in one place: `change` calls `findSpreadsheet(spreadsheetId, "write")` on the transaction right after `lockSpreadsheet`, and the public `lockSpreadsheet` makes its check after taking the lock. The checks callers make before `change` stay, because they answer 403 or 404 without waiting for the lock.
  - `share` and `unshare` stay outside the lock. A transaction at read committed sees a role change that committed before the check ran.
  - Test: one connection holds the spreadsheet's lock while an editor's write waits, the owner downgrades the editor, the lock is released, and the write gets 403. This needs two connections. If the PGlite setup cannot make one wait on another, run the test only with `TEST_DATABASE_URL`.
  - Update the `change` rule in `CLAUDE.md` to say `change` checks write access under the lock.
  - The undo plan (`plans/implement-undo-that-survives-structural-changes.md`) builds on this and should start after it.
- [x] when editing a script and unfocusing it, if a table cell is already selected that's above or below the fold, the UI will scroll the whole page up/down to show that cell, which is really annoying
- [x] In `TableCard.vue` (column type conversion), the handler sets `sessions.columnPopover` after the confirmation dialog without checking the card is still mounted #data-tables
- [x] Documents made from one template get the same name, so copies are hard to tell apart in the document list; number them or ask for a name (`SpreadsheetListView.vue`) #documents
- [x] The template picker's button has `aria-controls="document-templates"` while the panel is removed from the DOM when closed #documents
- [x] **P2** right-clicking the lower part of a page tab shows the page tab context menu with its bottom part hidden behind a table on the page (other element types may do the same). Keep the menu above every block: stack it above blocks, or render it in a top-level layer, and keep it inside the viewport #everyday
- [x] **P2** right-clicking the buttons that move a page left or right, or delete it, shows the browser's native context menu and not the page tab context menu. Show the tab menu from anywhere on the tab, including its buttons #everyday
- [x] **P2** the page tab's delete button is a gray "x", which looks like "close this tab", a non-destructive action, and not "delete this tab", which it is. Make it a trash can icon, or at least a red "x", with a label and tooltip that say it deletes. Undo can bring a deleted page back, but if the person makes other changes before they notice, they must undo all of those changes first #everyday

## Formula language and functions

- [x] support more reference styles: `A:A`, `A:Z`, `1:1`, `1:4`, `A1:4`, etc.
- [x] renaming a page or table rewrites the formulas that name it
- [x] support the thing where `=A:A+B:B` is equivalent to `=A1+B1` in any cell in 1:1 (and so on)
- [x] add more formulas:
  - [x] common functions other spreadsheets have: SUMIF/COUNTIF family, lookups (VLOOKUP, XLOOKUP, INDEX, MATCH), more math and text, IS* checks, IFS, SWITCH
  - [x] action formulas: insert rows into tables, etc. (APPEND_ROW, CLEAR, DO)
  - [x] widget formulas: dropdown boxes, checkboxes
  - [x] lookup/database formulas: `FILTER`, `SUMIF`, `COUNTIF`, etc.
    - [x] array results that spill into neighboring cells (needed by FILTER, SORT, UNIQUE, MAP)
  - [x] `LET`
  - [x] `LAMBDA` - should be possible to bind a function in one cell and then invoke that function from other cells to create custom user defined functions
  - [x] `MAP` and `REDUCE`
  - [x] `QUERY`
  - [x] (see docs/rows-functions.md; 50 added, the rest triaged there) investigate what functions rows.com offered and filter out the ones that are just for specific data integrations, AI crap, or overly-obscure math stuff -- just try to identify
  - [x] dates and times: a date value type, TODAY, NOW, DATE, date arithmetic, and date display
- [x] dropdown autocompletion of formula names and identifier names
- [x] (Claude) XLOOKUP and INDEX could return a whole row or column now that arrays exist
- [x] (Claude) MIN and MAX over a range of dates; a TEXT function to show a date or number in a chosen format
- [x] (Claude) financial functions (`PMT`, `PV`, `FV`, `NPV`, `IRR`, `RATE`, `NPER`), trig, and line fitting
- [x] **P1** named functions and values at the workbook level, so `=double(5)` works instead of `=D1(5)`
  - (Claude) plan before implementing. A name that holds a formula is a new place formulas are kept, so renames and row and column edits must rewrite it, and undo must record it
- [x] **P1** support creating named ranges of one or more cells
- [x] **P1** (Claude) plan one mechanism for document-level names before implementing the two items above. It should cover named values, named functions, named ranges, and the formula scripts under Ambitious ideas. A script block that holds `Name = formula` lines could cover all four, and rewriting and undo would then be extended for one new place that holds formulas
  - (Claude) implemented in [plans/names-and-scripts.md](../../plans/names-and-scripts.md)
- [x] add an optional trailing default argument to `IFS` for when no condition is true #formula-language
- [x] **P4** `MAP` doesn't take built-in function names as args - `MAP(A:A, UPPER)` should work but right now it errors with `#NAME?`
- [x] **P7** regex functions (`REGEXMATCH`, `REGEXEXTRACT`, `REGEXREPLACE`) on a regex engine with a time bound
- [x] **P10** `TEXT` writes a number of 1e21 or more as `1e+21` followed by the format's decimals
- [x] **P10** the web app's fill and chart axis build dates without `dateFromMs`, so they skip the year 0 to 9999 check.
- [x] **P4** support better operators: #formula-language
  - [x] infix `and`/`or`/`not` for boolean operations (`A and (not B or C)`)
  - [x] `!=` in addition to `<>`
- [x] make the help page's navigation sticky so it stays visible as the user scrolls. update it to reflect the section they're currently looking at, too (e.g. by making the currently visible section bold)
- [x] **P7** add `start` and `step` args to `SEQUENCE`
- [x] **P5** make the `and` and `or` operators stop at the first operand that decides the answer, so `B1 <> 0 and A1 / B1 > 2` works as a guard. They previously called `AND` and `OR`, which evaluate every argument (`packages/engine/src/evaluate.ts`) #formula-language
  - [x] **P6** make the `AND` and `OR` functions stop early too, and add `ALL` and `ANY`, which evaluate every argument and return an error found in any of them. Say in the help entries that `AND` and `OR` differ from Excel and Sheets here. See [docs/design/formula-language.md](../../docs/design/formula-language.md)
- [x] **P2** errors that come from a function are hard to trace. With a script function `PayoutByDuration(with_spa) = QUERY(Runs, "select Race, sum('Payout (40 hrs)') " & IF(with_spa, "", "where Race <> 'Spa' ") & "group by Race pivot Duration")` and a cell `=PayoutByDuration(FALSE)`, the cell shows `#VALUE!` with "The data has no column Spa", and the person has to hunt for the source. Let them go from the error back to where it arose (the function, the line, the call chain) #formula-language

- [x] add `CLAMP(val, min, max)`, equivalent to `IFS(val < min, min, val > max, max, 1=1, val)`
- [x] **P4** make `CLAMP` eager again: it evaluates all three arguments, so `=CLAMP(-1, 0, 1/0)` is `#DIV/0!`. An agent made it lazy, like `IFS`, by reading the author's `IFS` equivalent literally. The equivalence describes the result for arguments that have values and nothing more. Update the help entry and the README sentence about `CLAMP` to match #formula-language

- [x] **P6** date helpers except for `TO_TIMEZONE` since we don't use time zones here
- [x] other text - `SLICE`, `SLUGIFY`, `DECODEURL`, `BASE64`, `BASE64DECODE`, `DOMAIN`, `RELATIVE_URL`
- [x] **P7** `LOOKUP`, `HLOOKUP`, `XYLOOKUP` (skip `FLOOKUP` for now)
- [x] **P6** `SUBTOTAL`, `ARRAY_CONSTRAIN`, `FILTER_COLUMNS`, `RANGE_CONTAINS`
- [x] **P6** `CHOOSECOLS` #formula-language
- [x] **P6** `SORTBY` #formula-language
- [x] **P6** `SCAN` for running totals, balances, and cumulative state #formula-language

## Grid editing and navigation

- [x] allow deleting rows and columns in tables (also inserting)
- [x] up and down arrow keys should move up and down rows when in input mode
- [x] support dragging and bulk applying formulas (range selection, fill handle, Ctrl+D/R, copy/cut/paste)
- [x] add context menus for actions like inserting/deleting rows/columns
- [x] (Claude) filling a number or date series: `1, 2` filled down should continue `3, 4`
- [x] (Claude) select whole rows and columns by clicking their headers, and Ctrl+A

- [x] bug: the formula bar doesn't save changes when it loses focus
- [x] hitting enter with the formula bar focused should return focus to the cell -- you can type input and try to hit enter and it'll just stay focused instead of acting like you hit enter in the cell input (I suspect possibly b/c of a conflict with the suggestion behavior)
- [x] **P4** one formula editor for every place a formula is typed: cells, the formula bar, formula columns, names, filters, chart sources, scripts, and Markdown templates
  - [x] plan shared editing support across single-formula inputs, multiline scripts, and formulas embedded in Markdown; use CodeMirror as specified in [the implementation plan](../../plans/formula-editing.md)
  - [x] implement tolerant formula-fragment analysis, a shared single-line CodeMirror component, and persistent session primitives with retained editor history and failed-save handling
  - [x] connect the shared session to page transitions and migrate single-formula fields, including deleted-target recovery and removal of revision-based save restrictions
    - [x] remove revision-based formula-write refusals from request validation and the server; update stale-write client handling and tests
    - [x] migrate chart sources, retain unmounted drafts, add deleted-target recovery, and block actions after failed shared-draft saves
    - [x] migrate existing named formulas and filters; use CodeMirror in the new-name form with explicit creation rules
    - [x] migrate cells, the formula bar, and formula-column definitions with shared history, whole-column labels, and a nonmodal popover
  - [x] syntax highlighting for formulas in scripts and Markdown
  - [x] add CodeMirror Markdown language support for prose highlighting
  - [x] coordinate completion, reference picking, reference colors, and keyboard behavior across these editors, including replacing the formula-column prompt
- [x] hitting tab with the formula bar focused should have the same effect as hitting tab with the cell itself selected
- [x] show cell errors in a popover on hover instead of using a native browser tooltip
- [x] **P4** (Claude) clicking a cell or dragging over a range while a formula is being typed writes its reference at the caret, as Excel and Sheets do
- [x] **P4** (Claude) color each reference in the formula being edited, and outline the cells it names in the same color
- [x] **P6** (GPT) Add automatic bracket insertion to the shared formula editor. Deferred from [the initial implementation](../../plans/formula-editing.md). #formula-editing
  - [x] **P5** (Claude) close open parentheses when a formula is committed. `=SUM(D2:D4` shows `#ERROR! Expected )` today, and Excel and Sheets add the missing parenthesis. The author decided that a commit closes them. Only parentheses left open at the end of the formula are closed #formula-editing
- [x] **P6** in the codemirror editors, let me hit cmd+D/ctrl+D when I have some text highlighted to select multiple instances of that text
- [x] **P4** the formula editor shown in a cell doesn't completely fill the cell - the div with classes `session-formula-field grid__editor` has 6px of padding on left and right (maybe a Firefox quirk?) while the div with class `formula-editor` doesn't fill the full height of the cell either. -- note this is mostly an aesthetic thing. it doesn't necessarily have to fill the cell, it just needs to be less obvious that it doesn't
- [x] **P7** when a spill error is caused by table dimensions, show a “Resize to fit” button in its popover
- [x] **P6** Clearly explain why an array result cannot spill: when the table is too small, say e.g. “The result needs 12 rows and 26 columns, but the table is only 11 rows and 15 columns”; when existing values block it, say e.g. “but one or more cells in A1:P26 already have values.” Do not name a target cell when the table dimensions are the reason it cannot fit.

- [x] implement the handy tab+enter workflow from Excel and Sheets -- if you select a certain cell with the mouse or arrow keys, use tab to traverse multiple cells (optionally entering values into any or none of them), then input a value into a cell and submit that value by hitting enter, it'll drop to the next row in the column where you started
  - example: in a table, select C3. hit tab 3 times (optionally entering values in any cells in C3:E3 along the way) - now you're in F3. hit enter to focus the cell input (or just start typing), type anything (or nothing), and hit enter to submit. the selection should move to C4.

- [x] add a long thin "+" button along the full width/height of the bottom/right side of each table for adding rows/cols. this way I can just click anywhere along the range
- [x] right-clicking the row and column "+" strips opens a context menu to add 5, 10, or 15 rows or columns, or enter a custom count
  - [x] **P8** (Claude) a growth menu with every item disabled (the spreadsheet is at its row limit) cannot be dismissed with Escape from the keyboard, because no button takes focus and the menu has no `tabindex`. [ContextMenu.vue](../../apps/web/src/components/ContextMenu.vue)
  - [x] **P8** (Claude) the row "+" strip's left click ignores the spreadsheet-wide row limit: `rowsFull` in [TableCard.vue](../../apps/web/src/components/TableCard.vue) checks only the table's own limit, so at the spreadsheet limit the strip stays enabled and the server rejects the click
- [x] support resizing a whole table by just setting its width and height in cols/rows (warn the user and show a confirmation prompt if resizing will delete data)
- [x] dragging over col/row headers should select multiple full columns/rows
- [x] when multiple rows/columns are selected (either via row/col selection or by selecting specific cells), the context menu's "insert [row/column]" actions should become "insert N [rows/columns]", where `N` is the number of selected rows and cols as appropriate
  - if I select C:E using the column headers and right click, I should see "Insert 3 columns left" and "Insert 3 columns right"
- [x] don't show "Insert row" actions in a column header's context menu and don't show "Insert column" actions in a row header's context menu
- [x] when a row/col is inserted into a range used in a formula, the formula's range should be auto-updated to include the range.
  - e.g. if we have A1 = 1, A2 = 2, A3 = 3, A4 = `SUM(A1:A3)` and the user right clicks and inserts a row above or below A2, the range should be updated to `A1:A4`
  - (Claude) this already works. `inputsAfterEdit` in [rewrite.ts](../../packages/engine/src/rewrite.ts) turns `SUM(A1:A3)` into `SUM(A1:A4)` for a row inserted before row 2 or row 3, and into `SUM(A2:A4)` for one inserted before row 1
- [x] **P4** allow resizing rows heights and column widths
  - [x] by clicking and dragging on the borders of the row/col headers
  - [x] by a "resize [row/column]" ctx menu item shown when right clicking on row/col headers
  - [x] **P8** (Claude) dragging a header border to resize did not work by touch. [GridView.vue](../../apps/web/src/components/GridView.vue) now uses pointer events with pointer capture and `touch-action: none` on the handles.
- [x] when multiple cells/cols/rows are selected, allow deleting the columns or rows containing them from the context menu
  - [x] if I select C:E, give me a "Delete columns C-E" option. likewise for rows.
  - [x] if I select C3:E6 and right click on the selected range, show me both "Delete columns C-E" and "Delete rows 3-6"
- [x] **P2** (Claude) draw only the rows and columns in view. `GridView` makes a cell component for every row and column of a table, 100,000 of them for a table of 1,000 rows and 100 columns, and a page shows every table on it. Each edit also triggers the one ref that holds the engine, so everything that read a value through it is computed again. Do this before raising `tableRows` #everyday
  - (Claude) measured in headless Chromium against the Vite dev build on 2026-10-05, after importing a CSV of 1,000 rows and 5 columns into a table 8 columns wide (8,000 cells, 19,165 DOM nodes): the first keystroke in a cell took 1.9 s, each later keystroke about 0.6 s, a commit 1.1 s, and an arrow key 0.19 s. In a 20-row table the same steps took 183 ms, 67 ms, 126 ms, and 34 ms. Scrolling stayed at 60 frames a second. The measurements do not separate drawing from the engine rebuild described under Server, performance, and reliability
  - Windowed rendering implemented on 2026-10-06 with row and column overscan, retained editors/focused cells and headers, stable configured row heights, layout observation, and full rendering for small tables and printing. Fixed duplicate child keys and verified Vue template compilation directly. The author reports all 55 e2e tests pass and all review fixes are done. DOM-count tests for 1,000 x 8 and 1,000 x 100 mount only the window, assert fewer than 500 cells and 1,500 descendant elements, and compare against calculated totals of 8,000 and 100,000 unwindowed cells. Printing and window restoration are tested separately on 201 x 1; no large unwindowed baseline is mounted. This session cannot report measured counts or unit-test runtimes because Vitest fails before collecting tests with ENOENT under /tmp.
- [x] find and replace within a block, page, or document
  - [x] **P4** standalone find without replace - search just the current document #everyday
    - [x] **P4** allow filtering by just the current page or block #everyday
  - [x] **P4** find and replace within a document #everyday
  - [x] **P5** cross-document search #everyday
  - don't implement cross-document find and replace -- too risky
- [x] **P5** freeze header rows and columns so they stay in view while a table scrolls #everyday

## Tables, pages, charts, and text views

- [x] add new item types in pages: charts, data tables, and text template views
  - [x] charts - just support basic pie, bar, scatter, and line plots initially as an MVP
  - [x] data tables are tables with specific named and typed columns
    - columns can be referenced using syntax like `'Table 1'[Column Name]`
    - formula columns are a type
  - [x] text template views are the more interesting one. these should be Markdown with some syntax (JSX component tags? some template syntax?) that allows rendering data in a template: values, lists, tables, and eventally charts. it should be possible to invoke formulas. for example, if we used Jinja-style syntax, it'd be possible to write something like (I'm not wedded to this syntax, just using it as an example -- feel free to suggest an alternative if it's friendlier to parse and evaluate):

    ```markdown
    Total sales for the month were ${{ SUM(Sales!B:B) }}.

    ## Top sales categories:

    {% let sales_categories = 'Sales Summary'!A:B %}
    {% let top_categories = SORT(sales_categories, 2)[:10] %}

    {% for category, amount in top_categories %}
    - **{{ category }}:** ${{ amount }}
    {% end %}

    {{ pie_chart(sales_categories) }}

    ## Top 10 deals: <!-- this renders as a table -->

    {{ SORT(Sales!A:C, 2)[:10] }}
    ```
- [x] (Claude) Rows' data actions: `UPDATE(data, key_columns, range)` (upsert by key), `OVERWRITE(data, range)`, and `INSERT` of several rows
- [x] (Claude) reorder the tables, charts, and text views on a page (arrows beside each one)
- [x] **P1** (Claude) give rows and columns persistent identities in storage, snapshots, and editor requests. All implementation steps of `plans/persistent-row-identity.md` are implemented
- [x] **P1** finish steps 4–11 of `plans/persistent-row-identity.md`: ID-keyed cells and journal entries, narrower undo conflicts, appended rows, revisioned content events, stale-formula refusals, and OVERWRITE row deletion
- [x] data tables: sort and filter in place, dropdown columns, and `QUERY(Sales, ...)` over a whole table with its column names as headers
  - (Claude) after row identity, which sorting and hiding rows depend on
  - (author) sorting and filtering are display settings of a table. They leave the stored row order alone, so `A2` keeps its meaning
  - [x] reference an entire data table by its unique name; `QUERY(Sales, ...)` uses the table's column names as headers
  - [x] `QUERY` shows named columns in its output, including for ranges such as `Sales!A:C`
  - [x] sort and filter a data table in place (`plans/data-tables.md`, stage 1)
  - [x] dropdown columns (`plans/data-tables.md`, stage 2)
- [x] when errors appear in a rendered markdown block, show the errors as a chip with the error message. e.g. writing `{{ A+nonexistentvar }}` currently just renders `#NAME?` verbatim, but not even what name is invalid
- [x] **P6** allow collapsing a block to just its header, so a long table is easy to scroll past #small-apps
- [x] **P6** limit a block taller than a set height to that height and scroll its contents on their own #small-apps
- [x] **P4** when updating a formula column's formula, use an in-page editor with proper formula support (modal or popover or maybe just hijack the formula bar), not a browser `input` popup
- [x] move a table, chart, or text view to another page, and reorder pages
- [x] **P6** when a chart has dates on one axis, they should be spaced out like numeric data, not categorical -- right now if I have a plot with `2018-08-22`, `2019-03-04`, `2019-12-03`, `2020-03-01`, `2021-08-25` on the X-axis, those points all appear equally horizontally spaced, but they should have variable width gaps proportional to the number of days between them just like they would if they were ordinary numbers and the X-axis should have dates at regular intervals covering the time period #charts
- [x] **P4** draw charts with Apache ECharts, in chart blocks and in text views. Import only the chart kinds and components in use, since the whole library is large. Do this before the other chart items, which it changes. See [DECISIONS.md](../../DECISIONS.md), "Charts are drawn with Apache ECharts" #charts
- [x] **P10** show labels on charts on hover #charts
- [x] allow editing markdown views by just double clicking on the text (instead of clicking "Edit"). save and exit edit mode when the user unfocuses the input (instead of requiring user to hit "Done") (keep the "Edit" and "Done" buttons for user convenience)
- [x] **P6** duplicate the "Add table", "Add chart", "Add text" buttons at the top and between each item so you can insert them anywhere
- [x] **P1** add an `assert` function that can be used for testing. if a sheet has any failing assertions, show a visible warning in the menu bar with a link the user can click to see the failing assertions
- [x] **P2** update user-facing docs to use "Block" nomenclature for tables/charts/text/etc.
- [x] **P5** add context menus when right clicking on pages tab and block headers/margins #small-apps
  - [x] page actions: delete, move left/right
  - [x] block actions: whatever each block supports
    - block context menu should appear when right-clicking on the card around it but not the controls within it. keep a button in the upper right with a vertical ellipsis that I can click to show the same menu as well
- [x] **P6** allow creating links to navigate directly to a page, table cell, block, etc. #small-apps
- [x] **P4** (Claude) a block added below the visible part of the page is not scrolled into view, so nothing seems to happen after "Add chart". Scroll to a new block and put the keyboard focus in it #small-apps
- [x] **P5** (Claude) the label of a `TEXTBOX` or `NUMBERBOX` in a cell is cut to one letter at the default column width ("N…" for "Name"), because the input keeps a fixed width. Let the input shrink before the label does #small-apps
- [x] **P7** (Claude) a column's name is renamed by double-clicking its text. A double-click elsewhere in the header cell does nothing. Take the double-click anywhere in the header outside the resize handle #data-tables
- [x] **P4** open every name that is renamed in place for editing on one click, not a double-click: a document's, a page's, a block's, a column's, and a name in the Names panel (`EditableName.vue`). See [docs/design/ui.md](../../docs/design/ui.md) #everyday
  - where a click on the name already does something, rename only on a click on the thing already selected: the active page's name, and a selected column's name. A click on another page's tab still switches page, and a click on a column's header still selects the column
- [x] **P4** remove the row of action buttons from each block's header. The ellipsis menu and the right-click menu already list the same actions, so a table shows each of its nine three times. Keep the name and the ellipsis. See [DECISIONS.md](../../DECISIONS.md), "A menu's actions are not repeated as buttons" #small-apps
  - [x] the block changes size between showing and editing. Keep its place and size in both, ideally the full width of the page
  - [x] the editing state looks unstyled beside the rest of the block
  - [x] show the preview to the right of the text being edited, not below it

## Formatting

- [x] cell formatting (bold, italic, alignment, colors, number formats)
- [x] formula to render Markdown in cell (`MARKDOWN(text)`; inline formatting only, since a cell is one line)
- [x] (Claude) number formatting for cells (text views and formulas can use `TEXT(value, format)`)
- [x] **P6** create context menu item to add conditional formatting to the selected cell or range #formatting
  - [x] basic conditional formatting (`plans/data-tables.md`, stage 3)
  - [x] **P5** (Claude) wrap long text within a cell #formatting

## Actions and automation

- [x] **P3** run a `BUTTON` in a text view through a view click endpoint
- [x] **P3** (Claude) show the runs of a document's buttons to the people who can open it: who clicked, when, what it wrote and sent, and how it ended. `action_runs` records all of this and nothing shows it #small-apps
  - [x] (Claude) first make a run say what kind it was. `runViewInput` in [run.ts](../../apps/server/src/actions/run.ts) stores a text-view input's occurrence in the `buttonIndex` of its run, so a text-view input commit and a text-view button click look the same. A checkbox or dropdown change in a cell is likewise recorded like a cell button click
  - [x] (Claude) `runViewButton` and `runViewInput` repeat the same find, lock, find again, and render steps. Share them when this area is next changed
- [x] **P3** (Claude) a button can ask for confirmation before it runs, for an action that clears cells or sends email #small-apps

## Menus, dialogs, and messages

- [x] **P4** show a delete item in a context menu in the danger color #everyday
- [x] **P4** (Claude) turn on ESLint's `no-alert` for `apps/web`, so `alert`, `confirm`, and `prompt` cannot come back #codebase
- [x] identify where we should use in-app modals instead of browser-based `input` and alerts -- we have specific tasks for a couple of these already so this would just cover identifying anything I missed
  - (Claude) [docs/native-browser-ui-audit.md](../../docs/native-browser-ui-audit.md) lists them with replacement options
- [x] **P4** (Claude) replace the native `prompt`, `confirm`, and `alert` calls with in-app dialogs, following the audit. The 13 former confirmation call sites use the shared dialog host. #everyday
  - [x] remove the prompts for reversible deletes: deleting a row, a column, or a page, including ranges, is undone with its formulas and formats. See [DECISIONS.md](../../DECISIONS.md), "An action that undo reverses asks for no confirmation"
  - [x] (Claude) update end-to-end tests to interact with the in-app dialogs.
- [x] **P3** opening a side pane should close the one already open. With History open, the Errors button opens the errors pane behind it, and it shows only after History closes #everyday

## Controls, mobile use, and templates

- [x] rebrand the app as "rowz" instead of "Spreadsheet". don't change package names but just update the UI. make the name configurable via an env var as well so it's easy to update in the future.
- [x] update the page title to show the name of the spreadsheet being edited or, for the help page, "Help". include the app name `rowz` at the end - e.g. `Help | rowz` or `My budget | rowz`
- [x] **P4** remove awkward or unnecessary agent-written wording from the UI and help text #everyday
  - [x] remove "Select a cell to insert or delete its row or column." from the table view - that functionality is obvious
  - [x] replace Claudeslop phrasing like "what it holds"
    - replacements the author approved:
      - `HelpView.vue`, shortcut list: "Edit the selected cell, keeping what it holds." becomes "Edit the selected cell's current contents."
      - `HelpView.vue`, data tables: "Right-click a column to choose what it holds." becomes "Right-click a column to set its type."
      - `HistoryPanel.vue`, restore prompt: "Put the document back as it was on {date}? What it holds now is kept as a version, so this can be undone." becomes "Restore the version from {date}? The current document is saved as a version first, so you can undo this."
  - [x] revise "row of this column" help text in autocomplete
    - (Claude) the text is "column of this row", in `assist.ts`, shown beside a `[Column]` suggestion. The author approved "this row's value". A `Table[Column]` suggestion says "column of Sales", which can stay
  - [x] revise "Write the one meant" in `workbook.ts`
    - (Claude) it is in the engine's two ambiguous-name messages, in [workbook.ts](../../packages/engine/src/workbook.ts). The author approved: "Total has more than one meaning: February!Total, March!Total. Use one of these qualified names." For a name and a table on one holder, the same sentence with the two meanings listed
- [x] make errors highly visible throughout the document
  - [x] show a button in the editor header whenever the document has errors, like the failing-assertions indicator; open a popup listing all errors with links to their locations
  - [x] show a warning triangle on blocks and pages that contain errors
  - [x] show a warning triangle on documents that contain errors in the document list
- [x] **P1** on the document error reporting: clicking a specific error button should go to where the error manifested, since the "Raised in ..." link already says where it originates. Example: the error button reports `#VALUE!` in `'Payout by duration'!A1` but clicking it takes you to the "Formulas" script block, which shows the cause and not the effect, so the person has to notice that `'Payout by duration'!A1` is a different block that is off screen and scroll to find it. Repro: https://gmktec.zane.network:5173/s/c29f6ea5-4b22-4ed8-849f-1d792fbcf6a1/p/741937bc-f856-4dce-a94c-2e7f30e20b5f (shared with the claude@asahi.zane.cloud user) #everyday
- [x] **P2** text in the document error listing should be selectable and copyable. Today clicking and dragging registers as a button click, so no text can be selected. The person wants to copy an error to a to-do list or to share it with an agent or a collaborator in chat #everyday
- [x] (Claude) say "document" instead of "spreadsheet" in the UI and help page, as the README does
  - [x] use "Resize to fit" for the button in the cell error popover and its help page mentions (`CellError.vue`)
- [x] mobile friendly UI (layout, touch targets, tap twice to edit)
  - [x] **P3** a text or number input bound to a cell (esp. useful in Markdown)
- [x] **P5** add an in-app samples and templates gallery; selecting an example copies it into the user's account #documents
- [x] generate example documents with multiple pages
  - [x] **P1** a [monthly budget example](../../docs/reference/monthly-budget.json): a data table of inflows and outflows, each with a category and an account, and reports of the month's amounts grouped by category and by account
    - (Codex) `_scratch/google-sheets` was absent from this checkout, so the example uses representative October transactions instead of source-sheet data.
  - [x] a comparison of high-payout races in Gran Turismo 7, after https://docs.google.com/spreadsheets/d/1rZxgfay0Gjq7MuSmOkioZC4srW5yerPfiYR0XAXcE3c ([sample](../../samples/gt7-grind-comparison.json))
    - (Claude) the source sheet could not be read: the Google Drive read was denied and `_scratch/google-sheets-exported-to-xlsx` is absent from this checkout. The races, payouts, and durations are representative, and the columns follow `plans/data-tables.md`. Compare it with the real sheet and replace the data.
    - (Claude) `Runs[Race]` written on another page than the table is `#REF!`, though `QUERY(Runs, ...)` with the bare name works. A column reference needs the page, as in `Data!Runs[Race]`. Decide whether a unique bare table name should work as the table of a column reference too.
      - [x] **P6** (Claude) the error for a column reference to a table on another page is "There is no table Sales with a column named Qty", which does not say that a table of that name is on another page. Have the message name the page that holds the table #formula-language
    - [x] **P7** (Claude) `QUERY ... pivot Duration` writes the pivoted numbers as text headers (`"6"`, not `6`), so a header cannot be compared as a number. #formula-language
    - (Claude) each run is entered by hand with a race picked from the dropdown, so one race at one duration appears once. A way to build the grid of every race at every duration from `Races` would remove the hand-entered rows.
  - [x] **P4** a few standard templates in the style of Sheets and Excel (invoice, contacts list, to-do list), and one or two in the style of Access and FileMaker #documents
- [x] add screenshots to the README
- [x] **P5** plan to add keyboard shortcuts #everyday
  - (Codex) completed on 2026-10-07: Ctrl/Cmd+Arrow jumps through the displayed data region; Home, End, Ctrl/Cmd+Home (A1), Ctrl/Cmd+End (bottom-right of the used range, or A1 when empty), PageUp, PageDown, Ctrl/Cmd+B, and Ctrl/Cmd+I are supported, with Shift extending navigation selections.
- [x] **P5** allow renaming, deleting, and duplicating docs from the docs list view #documents
  - (Claude) the list also has no search and no choice of sort order, and it allows two documents with one name: importing an exported file makes a second "QA Sales Book"

## Import and export

- [x] "Save as"/"Save a copy" for duplicating an existing document
- [x] import and export (to files on disk): a JSON file for a whole spreadsheet, and CSV for a table
- [x] **P6** CSV import - support appending to a data table instead of replacing it #documents
  - (Codex) completed on 2026-10-07: data-table CSV headers map case-insensitively, plain grids append by position, and one undo reverses the append.

## Undo and collaboration

- [x] undo that survives structural changes (insert or delete a row, rename), and undo of formatting (I'm inclined to tie this into verison history -author)
- [x] (Claude) undo and redo (persistent version history): the server keeps versions, and History restores one or opens a copy
- [x] (Claude) Ctrl+Z and Ctrl+Y for single edits within a session
- [x] (Claude) live sync between sessions: open sessions re-read the spreadsheet when another changes it
- [x] **P1** saves, button clicks, and checkbox/dropdown changes name their row and column by persistent IDs, so intervening inserts cannot redirect them
- [x] **P2** (Claude) send workbook-store mutations, including undo and redo, through one ordered queue. Requests enter it when the person acts; formatting, renames, and deletes wait for earlier saves. Version restoration uses the same queue
- [x] (Claude) route version restoration through the workbook mutation queue and save indicator

## Accounts and email

- [x] (Claude) sharing UI: share a spreadsheet with another account as editor or viewer
- [x] (Claude) email verification at sign-up, switched on with `REQUIRE_EMAIL_VERIFICATION`
- [x] (Claude) real email delivery behind the `Mailer` interface (set `SMTP_URL`)
- [x] **P6** allow users to create folders to organize their sheets

## Server, performance, and reliability

- [x] (Claude) production build of the web app, served by the server
- [x] **P2** (Claude) apply a cell edit to the engine in place. `syncStructure` in the [workbook store](../../apps/web/src/stores/workbook.ts) builds a new `Workbook` from every cell of the document, and one cell edit calls it four times: twice in `writeCells`, once in `applyChanged` when the server answers, and once when `saveCellChanges` finishes. Each new engine also makes every cell on screen compute its value again. Measured in Node with one formula per cell: a document of 50,000 cells takes 402 ms to build and 194 ms to compute, and the engine's own `setCell` followed by reading every cell takes 19 ms. At 10,000 cells the figures are 130 ms, 44 ms, and 2 ms. It was not measured in a browser. Call `setCell` for cell writes and their rollback, and build a new engine only when rows, columns, tables, names, or scripts change. Drawing only the rows in view, under Grid editing and navigation, does not cover this #codebase
  - (Claude) browser timings for a table of 8,000 cells are under that item. They include both costs
  - `applyChanged` also checks every stored input against its table's rows and columns on each change, with a search of the tables and of the column ids for each input. Do that only for the tables a change touched
- [x] **P0** (Claude) investigate and fix timing-dependent undo in "cell drafts keep history across pages and save literal text before navigation" #codebase
  - (GPT) reproduced `1` → `=` → `=B2` restoring `1` with CodeMirror's default 500 ms grouping. Cell literal/formula transitions now use `isolateHistory("full")`; regression tests cover rapid and delayed edits across editor transfers, redo, and reverse transitions.
- [x] **P0** Investigate a flaky e2e test: `e2e/data-tables-and-formatting.spec.ts:5` ("a spreadsheet is exported to a file and imported again, and a table to and from CSV") failed once in a full `pnpm e2e:remote` run (15.1s) and passed when the spec file ran alone. Added waits for chart editing to finish and saves to settle, and a reload to verify CSV persistence. Reproduction and browser validation remain blocked by sandbox `EPERM` connecting to `127.0.0.1:3200`; the original cause is unconfirmed #codebase
- [x] **P2** (Claude) split the largest files by concern. The repository modules share the one access subquery and `change`, which keeps the rule that authorization lives in one place #codebase
  - (done) `repo/spreadsheets.ts` split by repository concern
  - (done) workbook store split by store concern
  - (done) `styles.css` split into ordered CSS files with the same cascade
  - (done) end-to-end spec split by feature, with test names and bodies preserved
  - (author) many tasks touch these files, and reading them probably raises the tokens each task uses
- [x] (Claude) code review of 2026-10-01 (`_scratch/2026-10-01-codex-review.md`): all 20 findings addressed, see AGENT_DECISIONS.md
- [x] (Claude) run `pnpm e2e` and the server tests against Postgres (`TEST_DATABASE_URL`) after the review fixes: neither runs in the sandbox
  - (author) e2e run and full CI run are passing as of `87b20ea`
- [x] (Claude) make the tests that guard a design rule find what they guard. `access.test.ts` and `undo.test.ts` ran over lists of routes written by hand, so a new route that nobody added passed both, and the stream at `/spreadsheets/:id/events` was missing from `access.test.ts`. Each now compares what it covers with the routes the app registers and fails for one that is left out
- [x] **P5** (Claude) a lint rule that keeps `packages/engine` free of imports from outside it and of Node and browser globals. Its `package.json` has no dependencies, and nothing fails if one is added #codebase

## Test gaps

- [x] **P5** Add tests for `BASE64DECODE` with malformed padding or trailing bits made of valid alphabet characters (`"A==="`, `"AA=A"`, `"AB=="`), and for `SLICE("abcdef", -4, -1)` (negative end index). #codebase
- [x] **P5** Add tests for `LOOKUP` and `XYLOOKUP` with empty search ranges, empty or single-row `XYLOOKUP` ranges, and mismatched key types. #codebase
- [x] **P5** Add tests for the date range helpers (`LASTXDAYS`, `LASTXWEEKS`, `LASTXMONTHS`, `DATEINTERVAL`) at the year 0 and 9999 boundaries, with negative and fractional counts, and for `LASTXMONTHS` clamping around February and month ends. Add `TIMEVALUE` with fractional seconds and more `YEARFRAC` day-count edge cases. #codebase
- [x] **P2** The `SUBTOTAL` tests for codes 7/107 and 10/110 use values 1, 2, 3, where `STDEV` and `VAR_S` are both 1, so swapped mappings would pass. Use a fixture such as 1, 2, 4. #codebase
- [x] **P5** The spill-resize keyboard tests (`press()` in `GridView.test.ts`) dispatch keydown straight to `.grid` and select cells with `mousedown`, so they do not check that the grid actually has focus when Alt+Enter is pressed. Add a test with real focus. #codebase

## Planning/ideas

- [x] **P1** come up with a good name to refer to all "page components" - tables, charts, text templates, etc. -- I guess "page components" could work but feels kinda generic. `Card` is used in the component names. "card types"? -> Block

## Original formula-script sketch

The local script feature is complete. Cross-document reuse remains open in `todo.md`.

- "formula scripts" - let the user write scripts like so:
  ```
  // Script name: SalesSummary
  TotalSales = SUM(Sales[Amount])
  NumSales = COUNT(Sales)
  // could also just write `AverageSale = AVERAGE(Sales[Amount])`
  AverageSale = TotalSales / NumSales
  ```
  - make the values in the function script accessible so you could write `=SalesSummary[AverageSale]` or maybe `=SalesSummary.AverageSale` to reference a computed value
  - this would also enable defining functions
    ```
    MyFunc = LAMBDA(...)
    OtherFunc = LAMBDA(...)
    ```
  - support reusable function scripts that can be shared across sheets
