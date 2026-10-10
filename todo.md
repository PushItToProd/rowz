# To-do

Open work is grouped by product area. Priorities order work; hashtags identify themes. See [workflow rules and themes](docs/todo-workflow.md), [completed work](docs/history/completed-todos.md), and `./todos.sh` for the prioritized list.

- `P0`–`P9`: active work, lowest number first.
- `P10`: parked; `P11`–`P98`: backlog; `P99` and above: not planned. These require an explicit instruction to pick up.
- `Author` requires the author first; `Hold` waits for a decision. Unprioritized work requires triage.
- `[ ]` is open; `[*]` awaits author confirmation. Archive `[x]` items after extracting unfinished notes.
- Preserve agent attribution until the author endorses the idea. Sub-items inherit their parent's priority.

## Author review

- [ ] **Author** (Claude) for the author: review three drafts in `plans/` that no item here acts on. None is an approved decision
  - [formula-language-proposal.md](plans/formula-language-proposal.md): records, lists, and tables as values, one expression language everywhere a formula is written, and libraries
  - [function-suite-design-review.md](plans/function-suite-design-review.md): where the current functions do not compose predictably, with recommendations, table query pipelines, explicit `@` intersection, and collections kept in one cell
  - [plain-text-file-format-proposal.md](plans/plain-text-file-format-proposal.md): a document as Markdown-like text that an ordinary editor and version control can work with, edited Obsidian-style, without a rowz server

- [ ] **Author** (Claude) for the author: `AGENT_DECISIONS.md` has 63 entries (the overnight-work run added more dated 2026-10-07 and 2026-10-08: errors sort before blanks, `Notice.detail`, `TEXTBEFORE` and `TEXTAFTER`, QUERY pivot header types) and nothing marks which the author has reviewed. Its entries are out of date order and four headings have no date. Mark the reviewed ones, or move them to `DECISIONS.md` or delete them as they are reviewed

- [ ] **Author** **P3** (Claude) for the author: bring `docs/design/` in line with the overnight-work commits. An agent run may not edit it
  - [formula-language.md](docs/design/formula-language.md) line 26 ("The engine does not do this yet...") is stale: the `and` and `or` operators and the `AND` and `OR` functions are lazy, and `ALL` and `ANY` exist. Delete the paragraph
  - [ui.md](docs/design/ui.md) still lists the missing danger color for context-menu delete items as an app gap. The color exists
  - [ui.md](docs/design/ui.md) could say that a click anywhere in a named column header, outside its controls and the resize handle, starts renaming

- [ ] **Author** **P3** (Claude) for the author: regenerate `docs/screenshots/editor.png` with `pnpm screenshots`. It shows the removed block header buttons and the text view editor above its preview. The text view layout is checked at 1280x800 only, not at phone width, in the dark theme, or with long content

- [ ] **Author** **P3** (Claude) for the author: review these overnight-work commits closely: 453f7ac (block header buttons removed, five rounds), 75b0a94 (one-click rename), 74f3350 (lazy `AND` and `OR`), 43750ae (`Notice.detail`, which overlaps the open "underlying error" item under Menus, dialogs, and messages). Commit 4e9aa4f lacks the Co-Authored-By trailer

- [ ] **Author** (Claude) discuss and draft a macro memo as an addendum to the formula-language proposal; see [questions](plans/commands-navigation-and-macros.md). #formula-language
- [ ] **Author** (Claude) plan cross-document references after the macro memo; see [planning notes](plans/commands-navigation-and-macros.md). #formula-language

- [ ] **Author** (Claude) compare the Gran Turismo 7 sample with the real source sheet and replace its representative races, payouts, and durations. See [the archived sample notes](docs/history/completed-todos.md#controls-mobile-use-and-templates). #documents
- [ ] **Author** (Claude) decide whether a unique bare table name should resolve in a column reference across pages, such as `Runs[Race]`; currently it needs `Data!Runs[Race]`. #formula-language

## Bugs

- [ ] **Author** **P2** entering a value like `$10,000` (verbatim) into a numeric data table column produces a `#VALUE!` error (`$10,000 is not a number`) #everyday
  - (Claude) the cause is `parseNumber` in [values.ts](packages/engine/src/values.ts), which every typed cell and every conversion of text to a number uses. It also refuses `10%`, `1,234`, and `VALUE("$1,234.50")`, in plain tables as well as typed columns, so those entries become text. `=5%` is a syntax error because the formula language has no percent operator. Decide which of these to accept in one change
- [ ] **P8** `printNode` does not round-trip a column name with leading or trailing whitespace because the tokenizer trims whitespace inside brackets #formula-language
- [ ] **P7** A confirmation prompt names the button as it was when the dialog opened, but confirming sends the same cell identity or loop occurrence; if the formula or the rendered loop changes while the dialog is open, a different action can run under the old prompt (`apps/web/src/components/TextCard.vue`, `apps/server/src/actions/run.ts`) #small-apps
- [ ] **P7** A windowed table leaves rows and columns out of the DOM, so a screen reader sees a partial grid with no `aria-rowindex`, `aria-colindex`, or total counts (`apps/web/src/components/GridView.vue`) #everyday
- [ ] **P6** Browser Find (Ctrl+F) cannot find a value in a row or column of a large table that is not drawn; the document search items under Everyday would cover this #everyday
- [ ] **P7** `repo/spreadsheets/context.ts` has runtime import cycles with `documents.ts` and `history.ts`; they work because the shared column constants are read inside functions, but a top-level use would break at load. Move the shared constants out of `context.ts` #codebase
- [ ] **P6** While a cell save is pending or the editor is opening, IME composition input (for example Japanese after Tab) is not queued with the other fast keys, and the grid's key handler has no `isComposing` check, so composed text can be lost or inserted literally (`apps/web/src/components/SessionFormulaField.vue`, `GridView.vue`) #formula-editing
- [ ] **P5** The fast-key fix covers the cell editor. The table filter field's own case (ten Tab presses with no pause stay in it, but with 120 ms between them the first leaves it) was not checked #formula-editing
- [ ] **P8** A button keeps a snapshot of its local names, but a `LAMBDA` value in that snapshot still reads the original context, which a template `let` can change later: `{% let x = 1 %}{% let f = LAMBDA(x) %}{{ BUTTON("go", EXECUTE(f(), Table1!A2)) }}{% let x = 2 %}` writes 2 when clicked. Copy the lambda contexts too (`packages/engine/src/evaluate.ts`) #small-apps
- [ ] **P10** A `TEXTBOX` commit of exactly 8,192 formula-like or numeric-looking characters gains a leading apostrophe and exceeds the stored-cell limit, so the write fails; make the control's limit one less than the cell limit #small-apps
- [ ] **Author** **P5** `FILTER_COLUMNS` and `FILTER` skip the error check on later conditions for a column that an earlier condition already rejected (`keep[col] &&= boolean(flag)` short-circuits), so a later `#DIV/0!` is hidden by an earlier `FALSE`. `AND` propagates it. Decide whether to check every condition cell, and test it. #formula-language
- [ ] **P9** In `SpreadsheetListView.vue`, an older successful request can clear a newer request's error, and cancelling a delete clears the error #everyday
- [ ] **P8** Displayed-value search searches a Markdown cell's raw text (`**hello**`, link destinations) and not the rendered text (`apps/web/src/stores/workbook/search.ts`) #everyday
- [ ] **P8** The origin-trace link in the cell error popover is not reachable by keyboard: the popover is teleported to the end of `<body>` and closes on focusout, so Tab leaves before reaching it (`CellError.vue`, `ErrorTrace.vue`). The errors list has the same link #everyday
- [ ] **P8** deleting a page with the page tab's standalone trash button bypasses `ContextMenu.vue` and can still lose keyboard focus; move focus to the neighboring tab there too (`PageTabs.vue`) #everyday
- [ ] **P11** `useCopyFeedback.ts` creates its 2-second timer after the clipboard promise resolves, so a copy that completes after the panel unmounts leaves a timer running #everyday
- [ ] **P10** On a narrow screen, frozen columns can cover every non-frozen column (three default-width columns are 360px, wider than a 320px viewport); cap the frozen width at part of the grid's width or ignore the freeze below a width (`GridView.vue` near line 367, `grid.css` near line 79) #small-apps
- [ ] **P11** Collapsed-block preferences: a `getItem` failure replaces the in-memory set with an empty one, so navigating away and back can lose preferences while storage is unavailable (`apps/web/src/blockCollapse.ts` near lines 33 and 46) #small-apps
- [ ] **P11** Collapsed-block preferences leave a localStorage key for each document, including deleted ones and ones with nothing collapsed; remove the key when a document is deleted or its set is empty (`blockCollapse.ts`, `SpreadsheetListView.vue` near line 307) #small-apps
- [ ] **P9** two of the four advice branches in `qualifiedMeaning` (`workbook.ts`, the "Use X for the table" and "Rename ... or ..." cases) and the "Rename the named value" text in `bareMeaning` look unreachable and have no test; simplify to the reachable cases or add tests that reach them #formula-language
- [ ] **P9** Renaming the first of two same-name definitions in one script leaves `renamedNames` seeing the name in the after-set, so formulas that used it are not rewritten and then resolve to the second definition (`apps/server/src/repo/spreadsheets/views.ts` near line 83) #formula-language
- [ ] **P9** Formula assist lists a duplicate script definition twice and qualifies it as if ambiguous (`apps/web/src/stores/workbook/values.ts` near line 67) #formula-editing
- [ ] **P8** With several cursors from Ctrl+D in the formula editor, accepting an autocomplete suggestion updates only the primary cursor's token (`FormulaEditor.vue` near line 173) #formula-editing
- [ ] **P9** With several cursors from Ctrl+D, picking a reference changes only the primary match and drops the other cursors (`apps/web/src/formula/picking.ts` near lines 24 and 286) #formula-editing
- [ ] **P7** The bracket-pairing code (`apps/web/src/formula/closeBrackets.ts`) rescans the whole document on every edit (the state field) and on every bracket input (the language data provider), including in Markdown where the result is unused; keep the quote spans incremental or limit the scan to the nearby text #formula-editing
- [ ] **P9** With several cursors from Ctrl+D, bracket pairing uses the main selection's rules for every cursor, so `(` can pair inside a string or comment at another cursor (`closeBrackets.ts` near line 148) #formula-editing
- [ ] **P9** The escaped-quote handler in `closeBrackets.ts` (near line 178) can rewrite a skipped quote closer into doubled quotes while an IME composition is active #formula-editing
- [ ] **P7** The Wrap text format does nothing for a choice-column value or a `TEXTBOX` cell, which render as native controls (`CellView.vue` near lines 213 and 346), so the toolbar shows it pressed while the value stays clipped #formatting
- [ ] **P7** A chart legend with many or long series labels can be clipped by the chart card's maximum height (`charts-text-views.css` near line 69, `ChartView.vue` near line 211) #charts
- [ ] **P2** The flaky export/import e2e test (`data-tables-and-formatting.spec.ts:5`) failed once more in a full run (20.2s) after the hardening commit and passed in 11 later full runs; earlier fixes added waits for chart editing and saves and a reload to check persistence, but the original cause remains unconfirmed; capture its trace on the next failure (`pnpm e2e:remote` with Playwright trace retained) #codebase

- [ ] **P8** After a reload the Undo button is disabled, though the server keeps the journal of changes. Undo should continue across a reload #everyday

## Formula language and functions

- [ ] support optional named arguments to formula functions
  - [ ] **P6** plan before implementing so we can see how hard this would be #formula-language
  - example use case: `=QUERY(Table1!A:A, "select *", column_headers=False)`
- [ ] **Hold** functions that expect one value (IF, UPPER, ...) do not work cell by cell on a range; only operators do. MAP is the workaround. #formula-language
  - [ ] Related: `=UPPER(A:A)` could mean this row's cell, as `=A:A & ""` now does. -- that is, if e.g. D2 = `=UPPER(A:A)`, it should be equivalent to `=UPPER(A2)`
- [ ] **P6** (Claude) a built-in function registered with the `lazy` helper cannot be passed as a function: `MAP(A1:A3, ISERROR)` is `#NAME? Unknown name 'ISERROR'`, and the same goes for `IF`, `IFERROR`, `INDEX`, `XLOOKUP`, and the rest. `evaluate.ts` accepts a built-in name as a value only when its definition has `callableAsValue`, which `lazy` in `arguments.ts` sets to false. See "Functions compose" in [docs/design/formula-language.md](docs/design/formula-language.md) #formula-language
- [ ] **P99** user-defined formula functions, evaluated client-side in a sandbox (maybe something like QuickJS or Pyodide) #formula-language
- [ ] **P15** consider how to support recursive lambdas, so that the `f(f, 5)` workaround documented in `/help` is not required #formula-language

- [ ] **Author** (Claude) review the smaller candidates left in [docs/rows-functions.md](docs/rows-functions.md) and determine which to include (previously marked `[/]`, an undefined status).
- [ ] **P6** the reference functions `OFFSET`, `INDIRECT`, `ADDRESS`, `ISFORMULA`, `ISREF` #formula-language (plan: plans/reference-functions.md)
- [ ] **P7** random numbers #formula-language
- [ ] **Hold** consider resolving an ambiguous bare word by nearness: a name in the formula's own table or script first, then names and tables on the formula's page. The author considers this dangerous and has not decided to do it. If it is done, every use of a word with more than one meaning in the document is marked with a yellow wavy underline. See [DECISIONS.md](DECISIONS.md), "An ambiguous name is an error" #formula-language
- [ ] **Hold** consider having a rename qualify the bare words it would make ambiguous. Renaming the name `Y` to `X` while a table `X` exists would first rewrite each bare `X` to `'Page 1'!X` #formula-language
- [ ] **Hold** (Claude) consider Excel's structured references for parts of a data table: `Sales[#Data]`, `Sales[#Headers]`, and `Sales[#All]`. The bare table name already means the data rows (see [plans/names-and-scripts.md](plans/names-and-scripts.md)) #formula-language
- [ ] **P99** `FLOOKUP` #formula-language

- [ ] **Author** **P7** literal substring predicates: choose their function names. Regex functions, `TEXTBEFORE`, and `TEXTAFTER` are complete. #formula-language
- [ ] `TEXTBEFORE` and `TEXTAFTER` follow-ups:
  - [ ] **P8** verify whether an empty delimiter with `|instance_num| > 1` follows Excel; `TEXTBEFORE("abc", "", 2)` returns `"a"` here, but Excel may return `""`
  - [ ] **P8** support array-valued `if_not_found`; `scalar()` currently returns `#VALUE!`, but Excel accepts an array fallback
  - [ ] **P8** broadcast `instance_num`, `match_mode`, and `match_end` over arrays; only `text` broadcasts today
- [ ] **P6** reusable function ergonomics: parameter help for user defined functions and better arg-specific errors #formula-language
- [ ] **P7** formula-checking: "array-aware assertions and explicit approximate numeric comparison" #formula-language

## Grid editing and navigation

- [ ] **P9** (GPT) Support reference picking by dragging across multiple named-column headers. Deferred from [the shared formula editor](plans/formula-editing.md); choose how a range of named columns is represented before implementing. #formula-editing
- [ ] **P10** (GPT) Add nested-language editing assistance inside formula strings, such as the query text passed to `QUERY`. Deferred from [the shared formula editor](plans/formula-editing.md). #formula-editing
- [ ] **P5** (GPT) Add comprehensive inline diagnostics to the shared formula editor. Deferred from [the initial implementation](plans/formula-editing.md). #formula-editing
- [ ] **P7** a row or column added from inside a range joins it, and one added from outside does not. With `SUM(A2:A8)`, "Add 1 row below" on row 8 makes it `SUM(A2:A9)`, and "Add 1 row above" on row 9 leaves it alone. The two put the new row in the same place, so the request has to say which row or column the person added from, and `inputsAfterEdit` in [rewrite.ts](packages/engine/src/rewrite.ts) has to take it. The same goes for columns and for every other place that holds a formula. Rows that an action adds (`APPEND_ROW`, `INSERT`) are left as they are and need a separate decision. See [DECISIONS.md](DECISIONS.md), "A row or column added from inside a range joins it" #everyday
- [ ] **P8** merge cells across selection - support merging multiple cells across one or more rows and one or more columns #everyday
- [ ] **P7** support hiding rows and columns #everyday
- [ ] **P8** support hiding pages #everyday
- [ ] **P7** (Claude) a key that moves focus between the regions of a page: the grid, a block's header, the next block, and an open side panel. Tab is taken inside the grid. See the keyboard section of [docs/design/ui.md](docs/design/ui.md) #everyday
- [ ] **P10** a focus history: when focus changes between pages, blocks, and cells within a document, let the person go back to the previous selection. Do not push focus changes into the browser's navigation history (explicitly rejected: following a link to a document, clicking around, then pressing Back to leave becomes annoying). Keep a separate history inside the app, with back and forward buttons in the toolbar #everyday
- [ ] **P20** add support for setting and navigating to vim-style named marks #everyday

- [ ] (Claude) plan quick switcher navigation; see [planning notes](plans/commands-navigation-and-macros.md) #everyday
- [ ] (Claude) plan per-user settings for custom keybindings, command short names, and recents; see [planning notes](plans/commands-navigation-and-macros.md) #everyday

## Tables, pages, charts, and text views

- [ ] **P8** export variables declared in Markdown templates as named values, like script declarations and named ranges in tables #small-apps
- [ ] **P3** add a way to save multiple sort and filter view presets for each data table #data-tables
- [ ] **P6** explore adding a generated, dynamically sized data table block type defined by the output of a formula, so changing the result's row or column count does not require manually managing table dimensions; the implementation approach is open and needs to consider conditional formatting and other proprrties as well (may also be addressed by the proposal to support conditional formatting and sorting when rendering data tables in markdown) #data-tables
- [ ] **Author** **P9** (Claude) consider deleting a data table's row when its last cell is cleared. `plans/persistent-row-identity.md` keeps such a row, so that its id stays valid for a relation that points at it, and deletes empty rows only at the end of a table when its columns are named #data-tables
- [ ] **P9** (Claude) pivot tables as a block or table feature (`QUERY` already has a `pivot` clause) #data-tables
- [ ] support chart formulas in tables
  - [ ] **P7** `SPARKLINE` for a single cell #charts
  - [ ] **P7** `PIE_CHART`, `LINE_CHART`, etc. (implement after merging cells is done so the user can merge however many cells they want to show this) #charts
- [ ] **P7** chart options: #charts
  - [ ] axis titles
  - [ ] stacked bars
  - [ ] colors
- [ ] **P7** support conditional formatting and sorting when rendering a data table in Markdown, or allow embedding an existing table/sheet in a Markdown view so its conditional formatting is applied #data-tables
- [ ] **P3** add a new type of block (in addition to tables, charts, and text): a row, which can itself contain one or more table/chart/text components laid out side-by-side #charts
- [ ] **P10** support nested pages #small-apps
- [ ] support reordering things by dragging and dropping
  - [ ] **P7** pages #small-apps
  - [ ] **P6** rows and cols by dragging and dropping their headers (including when a range of them is selected) (but no need to handle dragging and dropping a selected range of cells - only do it if the user has specifically selected full rows or columns) #everyday
  - [ ] **P7** blocks #small-apps
- [ ] **P7** data tables - allow choices to be drawn from a formula's result (when the formula value changes, keep the raw underlying value in the cell but flag it visibly as invalid) #data-tables
- [ ] **P7** (Claude) the editor for a formula column's formula looks unfinished beside the other panels: its heading is small, "Pick reference" is smaller than the other buttons, and Apply and Cancel touch. See `_scratch/qa/15-formula-col.png` #formula-editing
- [ ] **P7** double clicking a cell in a formula column should open the formula column formula editor instead of editing in the cell
- [ ] **P1** when I double click on a named table column header, the column name disappears and the header cell goes blank -- textbox doesn't appear until I click again
- [ ] **P7** (Claude) the row of "Add table", "Add chart", "Add text", and "Add script" buttons between every two blocks takes a line of each gap on a page of five blocks. Consider showing the rows between blocks only when the pointer or the focus is in the gap, and keeping the first and last #small-apps
- [ ] **P8** a drag that selects text inside a block's or document's name, or a drag selection ending on the already selected column's name, starts renaming on mouseup; check for pointer movement before opening the editor #everyday
- [ ] **P8** decide whether owned document names should also be links: middle-click or Ctrl-click opens shared document names in new tabs, while only the Open link opens an owned document (`SpreadsheetListView.vue`) #small-apps
- [ ] **P4** the text view's editor, as the author saw it on the `overnight-work` branch. See "Editing in place" in [docs/design/ui.md](docs/design/ui.md) #small-apps
  - [*] clicking "Pick references" takes focus from the editor, which ends the edit, so the button cannot be used. Treat the editor's own controls and popovers as part of the editor when deciding that focus has left
    - (Claude) the button is logically disabled while the caret is outside a `{{ }}` expression (`canPick` in `FormulaEditor.vue`). It uses `aria-disabled` so its `mousedown.prevent` handler can preserve focus, and `requestPicking` ignores it when the current caret cannot accept a reference
    - [ ] **Author** **P4** the "Pick references" item may be resolved: the fix was made from reading the code (a disabled button was the likely cause) and passed the unit and e2e suites, but nobody confirmed it in a browser. Check that clicking the button keeps the text view edit open. Latest commit when written: 39d83d7
  - [ ] **Author** try leaving the editor only on an explicit Save, not when focus leaves the text. The author finds the return to the rendered view on a single click outside annoying. This changes the focus-change saving that "Editing in place" describes, so update [docs/design/ui.md](docs/design/ui.md) if the author keeps it
- [ ] **P8** investigate opening a script or text block for editing on one click without catching clicks meant for something else. The author wants one click to start editing, and a drag that selects rendered text must not start it. Some apps wait briefly after the click and start editing only if the pointer stays put, so a click followed by scrolling or moving away does nothing. Find what the technique is called and how other apps tune it, then try it out. Double-click stays until then #small-apps

- [ ] Block sizing:
  - [ ] **P6** allow adjusting block display widths and heights to make them larger or smaller -- tables should just be scrollable if they're larger than their block, charts should resize to fit, text should word wrap and be vertically scrollable #charts
  - [ ] **P8** make block heights customizable, following the maximum-height limit for long blocks #small-apps
    - (Claude) chart card widths were observed to vary from 364 px to 443 px to 521 px with chart type and error messages.
  - Chart heights are included in these requirements (formerly an unprioritized inbox item).

## Formatting

- [ ] **P6** in data tables, conditional formatting should be a column property #formatting
  - okay, I guess when I create rules covering a whole column of a data table it does intelligently set it to e.g. `F1:F` so it covers the whole thing, but that behavior doesn't feel obvious from the way it's presented
- [ ] more formatting:
  - [ ] **P8** borders #formatting
  - [ ] conditional formatting followups:
    - [ ] **P6** allow a criterion formula to refer to the current cell with a placeholder such as `X` or `X()`, e.g. `X>10` #formatting
    - [ ] **P6** support relative references in criterion formulas, e.g. `X()>X(0,+1)` for “this cell is greater than the value to its right” #formatting
    - [ ] **P8** calculate color range values with a formula, e.g. `CLAMP(X(), -5, 5)`, and use those results to choose colors #formatting
    - [ ] **P7** allow HTML color names and hex RGB codes for conditional formatting colors #formatting
      - [ ] **P7** make color dropdowns comboboxes that show current options on click, suggest valid HTML color names while typing, and accept hex codes beginning with `#` #formatting
        - (Claude) the toolbar's text and fill color dropdowns and the conditional format panel's list color names as words, with no swatch of the color
    - [ ] **P6** allow a formula to return a conditional formatting color, including HTML color names such as `red` or `purple` and numeric values, so a user-defined function can control coloring #formatting
    - [ ] **P8** advanced color range settings: #formatting
      - [ ] choose arbitrary colors for minimum, midpoint, and maximum points
      - [ ] choose each point's value as the range minimum/maximum as appropriate, a fixed number, a percent, or a percentile
    - [ ] **P8** support more conditional formatting types, including text decoration (bold, italics, etc.) and cell borders #formatting
      - Formula-based formatting may initially need a separate formula for each formatting type; revisit the design when struct types are supported
    - [ ] **P10** explore user-configurable ways to combine multiple conditional formatting rules: #formatting
      - [ ] mix colors applied by multiple rules
      - [ ] split a cell background into segments colored by each applicable rule
  - [ ] **P8** carrying formats through copy, fill, and paste #formatting

## Actions and automation

- [ ] more actions:
  - [ ] **P7** delete a row (or rows) that matches a condition #small-apps
  - [ ] **P7** targeted update of rows matching a condition as an alternative to the full replacement #small-apps
    - [ ] **P99** typed (or at least column-name-aware) updates of data tables: s.t. like `MUTATE(Products, [Category] = "GPU", [Price] = [Price] * 2)` (i.e. double the value of `Price` for all rows in `Products` where `Category` == "GPU") #small-apps
  - [ ] (Claude) insert rows at a position: an empty row, or one with values, above or below a given row of a table. `Effect` in [effects.ts](packages/engine/src/effects.ts) has `setCell`, `ensureRows`, `deleteRows`, and `sendEmail`, so a formula can add a row only at the end of a range, and placing one elsewhere means rewriting the rows after it. The web app's `editTable` already inserts a row before a given row. Useful to buttons now, and the first of the structural actions a macro needs #small-apps
  - [ ] **P7** fetch CSV/JSON/etc. from a URL #small-apps
  - [ ] **P10** call a webhook #small-apps
    - (Claude) needs the outbox under Before sharing with others, and a rule for which addresses a server may call, so a formula cannot reach the server's own network
- [ ] **P10** (Claude) scheduled actions: Rows' `SCHEDULE`, `REPEAT`, `REFRESH`. Needs a server scheduler and a rule for whose permissions a scheduled run uses #small-apps

## Menus, dialogs, and messages

- [ ] **P5** a delete chosen from a menu should be confirmed in or beside the menu, not in a dialog in the middle of the screen: the item changes to "Confirm deletion?", or a small confirmation opens next to it. A second click counts only after a short delay, so an accidental double click does not confirm. Build both forms far enough for the author to choose. Keep the dialog where the confirmation explains what will be lost. See [DECISIONS.md](DECISIONS.md), "Removing a whole container is confirmed, beside the menu" #everyday
  - [ ] confirm deleting a page, which is not confirmed today
  - [ ] show a notice with Undo after a delete that is not confirmed, such as a row or a column
- [ ] **P5** (Claude) give a notice and an error dialog a place for the underlying error, shown word for word in monospace below the summary, and rewrite save and request failures to the form in [docs/design/writing.md](docs/design/writing.md): what could not be done and why, then what to do #everyday
- [ ] **P5** a command palette that lists every action, and a form dialog for an action that needs parameters (Tab between fields, Enter submits, Escape cancels). These are how a feature becomes usable from the keyboard without a shortcut of its own. Plan a shared command registry and keybinding table as part of this work; see [planning notes](plans/commands-navigation-and-macros.md). (Claude) #everyday
- [ ] **P5** replace every native `<select>` with a shared in-app dropdown ([audit](docs/native-browser-ui-audit.md), priority 2), then add a lint rule that refuses `<select>` in `apps/web` #everyday
- [ ] **P6** replace native `title` tooltips with an in-app tooltip ([audit](docs/native-browser-ui-audit.md), priority 3), then add a lint rule that refuses the `title` attribute in `apps/web` #everyday
- [ ] **P6** keep a history of recent messages and errors, so a notice that closed can be read again #everyday
- [ ] **P7** tabs along the top of a context menu for the menus of the things that contain the clicked one: a right-click on a cell shows Cell, Row, Column, Table, and Page, and choosing one shows that thing's menu. Each menu then holds one thing's actions. Plan before implementing. The author will decide whether to keep it after seeing it in use. See [docs/design/ui.md](docs/design/ui.md) #everyday

## Controls, mobile use, and templates

- [ ] **P6** (Claude) make the warning triangle on a page tab, a block, and a document in the list a control: clicking it goes to the error, or opens the errors list showing only that page's, block's, or document's errors. They are plain icons today (`ErrorWarning.vue`). See "Errors are always visible, and an error leads to its origin" in [docs/design/README.md](docs/design/README.md) #everyday
- [ ] **P7** (Claude) review the existing interface text against [docs/design/writing.md](docs/design/writing.md) and fix what breaks it #everyday
- [ ] **P8** review more published style guides for interface text (Material Design, Apple's Human Interface Guidelines, the Microsoft Writing Style Guide) and extend [docs/design/writing.md](docs/design/writing.md) from them. The Atlassian error-message guidance and Microsoft's Windows writing style page are already used #everyday
- [ ] **P10** revamp the phone-width UI so it is less cramped. The editor header is the tightest part: it holds the back arrow, the spreadsheet's name, the saving indicator, Share, History, Export, and Help on one line. #everyday
  - (Claude) at 390 px wide on 2026-10-05, the error count button covers the document's name, "Save a copy" and Help are cut off, the page scrolls sideways (475 px of content), the format toolbar runs off the right edge, and 73 of the editor's 134 controls are smaller than 24 px in one dimension. A table scrolls inside its card as intended. See `_scratch/qa/32-mobile-editor.png`
- [ ] **P6** allow checkboxes, inputs, and other controls to target a named range; require the target to contain exactly one cell #small-apps
- [ ] more controls:
  - [ ] **P8** a date picker #small-apps
  - [ ] **P8** a time picker #small-apps
  - [ ] **P8** a combined date and time picker #small-apps
  - [ ] **P8** a slider input for picking a value from a range #small-apps
  - [ ] **P8** a numeric value input roughly like (don't use this as a literal template; make it nicer) "<button>-</button> <input value="100"> <button>+</button>" where you can increment and decrement the value using the -/+ buttons (but also still support editing the number directly) #small-apps
- [ ] **P6** cell validation - require the value to match a pattern, regex, or custom formula #data-tables
- [ ] **P6** touch: select a range, fill by dragging, and a long-press menu on Android+iOS #everyday
- [ ] **P8** allow users to create and reuse their own document templates #documents
- build reference documents in rowz as far as its features allow, at the end of each theme
  - [ ] **Author** **P3** a video game quest tracker, after https://docs.google.com/spreadsheets/d/1cwsRONdpXMJAvjpamauZ391NrTXX1gEdeTrx1Rf324o #small-apps
  - [ ] **P10** revise/augment the samples after we've added formatting, conditional formatting, etc. #documents
- [ ] **P8** use icons to make the toolbar denser #everyday
- [ ] **P9** (Claude) the grid does not tell a screen reader which cell is selected: it has no `aria-activedescendant`, and a cell has no label naming its address. Every button and input checked has a label #everyday

- [ ] Improve help documentation:
  - [ ] **P7** (Claude) the help page is about 60,000 characters with a list of sections and no search. Add a search field that filters sections and functions #everyday
  - [ ] Split the help page into pages by section, with sidebar navigation, a floating table of contents, and full-text search.
  - [ ] Show complete formula examples with their inputs using embedded table, text, script, and chart blocks.

- [ ] (Claude) generate the Gran Turismo comparison grid for every race and duration from `Races`, replacing hand-entered combinations. #documents
- [ ] (Claude) add search and a choice of sort order to the document list; decide whether duplicate document names are acceptable. #documents

## Import and export

- [ ] **P99** (Claude) import from .xlsx #documents
  - (author) not planned. Supporting Excel's format means handling how Excel behaves. Someone coming from Excel exports to CSV and imports that
- [ ] **P7** CSV export - two modes: rowz-compatible and data export (selected from a dropdown on the "Export CSV" button) #documents
  - [ ] rowz-compatible: keep verbatim formulas (so the user can reupload it and have their rowz behavior stay the same).
  - [ ] data export: the output is an export that has all calculations materialized so it can be used with any tool that supports reading CSVs

## Undo and collaboration

- [ ] **P9** named versions #documents
- [ ] **P8** (Claude) History keeps a version before every delete, including one undone seconds later. About fifteen minutes of editing left at least ten versions, three of them "Before deleting row 4 of Table 1". Consider dropping a version when the delete it preceded is undone, or joining versions made within a short time #documents
- [ ] **P10** (Claude) store versions compressed or as differences if large spreadsheets make them costly #codebase
- [ ] **P10** show who else has a spreadsheet open #sharing
- [ ] **Author** **P7** (Claude) comments on cells, blocks, pages, and whole documents #agents
  - (author) comments are also a way to give feedback to an AI agent on a document it created or edited, which makes them useful to one person

- [ ] **P1** add a trash bin for deleted docs instead of nuking them right away #documents

## Accounts and email

- [ ] **P10** (Claude) invitations for people without an account, password reset, and resending a confirmation link #sharing

## API and agent tools

- [ ] **P8** provide a documented API for creating, reading, and editing documents, with an API explorer #agents
- [ ] **P7** create a CLI tool and a skill for AI agents to create and work with rowz documents; document key features and when they are useful so agents use them effectively #agents
- [ ] **P6** turn the guidance in [docs/design/](docs/design/README.md) into agent skills (interface work, interface text, formula language), linked into `.agents/skills` for Codex as `create-rowz-document` is #agents

## Server, performance, and reliability

- [ ] **P1** conduct a review of the codebase and find all the places that need updating to align with the design principles #codebase

- [ ] **Author** **P8** investigate whether the previously flaky Postgres test still fails; identify the test and reproduce the failure before deciding on a fix #codebase
- [ ] **Author** **P1** the Codex sandbox cannot run the project's checks: Vitest fails before collecting tests with `ENOENT` creating `/tmp/<random>/{ssr,client}` (and `site.test.ts` gets `EROFS` creating `/tmp/site-*`), and `pnpm e2e:remote:codex` fails with `EPERM` connecting to `127.0.0.1:3200` or with Docker socket access denied. Give the Codex sandbox a writable temp directory (for example `TMPDIR` inside the workspace, or a writable `/tmp`), loopback access to the Playwright container's port, and write access to `~/Code/ai_workdir/codex_papercuts.md`, so Codex can run `pnpm check` and the e2e suite itself instead of the orchestrator running them #codebase
- [ ] **P6** replace UUIDs in document URLs with shorter unique IDs, targeting 14 characters from a URL-safe alphabet such as `[A-Za-z0-9._-]` #documents
  - That alphabet has 65 characters, so 14 characters allow about 24 septillion values. Example: `2WRhRE4C3O.EaQ` instead of `277690de-bc98-4310-9a84-ab5f27a02086`.

- [ ] **P10** (Claude) two checks on every save read more as a document grows. `checkCellCount` counts every cell of the document after each write that is not a clear, and `pruneJournal` reads every journal entry of the document after each journaled change. Keep a count on the spreadsheet row, and prune only when a limit could have been passed. This is small at today's limits #codebase
- [ ] **P10** (Claude) cache a range's values across the formulas that read the same range. Each formula reads every cell of its range again when it is recalculated, so 50,000 formulas that each read a 1,000-row column take about 10 s after one edit in that column: 50 million cell reads. 1,000 such formulas take about 0.2 s, so this matters only at the extreme. The cache needs invalidation inside the evaluator: a cached range is stale once any cell in it changes, including a cell an array result fills or gives up. #codebase
- [ ] **P10** (Claude) index the ranges of a column by row in the dependency index. `transitiveDependents` in [graph.ts](packages/engine/src/graph.ts) scans every range that crosses a cell's column for each cell it reaches, so one edit costs the number of cells reached times the number of ranges in their columns. Deferred because the size limits keep it small: a table has at most 1,000 rows, so a chain down one column costs about 12 ms, and the worst case that fits in a spreadsheet (1,000 cells reached in a column that 99,000 ranges cross) is estimated at 1 s. Do it before raising `tableRows`: at 20,000 rows one edit measured 4.7 s, and the time grows with the square of the row count #codebase

## Before sharing with others

These items harden rowz for several users, hostile input, or a deployed server. They are parked while one person uses rowz on their own machine. Review findings of that kind go here.

- [ ] **P10** Cross-document search (`apps/server/src/repo/spreadsheets/search.ts`) scans and ranks every readable document before applying the document limit, and the list UI does not abort in-flight requests; bound the work per request and abort superseded requests #documents
- [ ] **P10** The Runs panel lists runs by people whose share has ended, with their name and email, because `action_runs.user_id` outlives a share (`apps/server/src/repo/spreadsheets/runs.ts`). Show a former member as such, without the email #small-apps
- [ ] **P10** A text-view input commit can overwrite a newer value written from another tab, because its fingerprint names the target but not the value it was rendered with; include the rendered value and answer 409 on mismatch #sharing
- [ ] **P10** A text-view `BUTTON` click sends only its occurrence index, so a stale view whose conditional content shifted can run a different button; send a render token or the button's label/action fingerprint and answer 409 on mismatch #sharing
- [ ] **P10** `ContextMenu.vue` moves focus to the menu only on mount. If the focused item becomes disabled while the menu stays open (for example another tab uses the last row capacity), focus can leave the menu and Escape stops working. Keep focus on the menu when its focused item is disabled, and test it. #sharing
- [ ] **P10** `REGEXREPLACE` replacement expansion appends a part per `$n` reference even when it expands to empty, so a huge replacement cell (`"$1"` repeated millions of times) bypasses the step and output limits; count replacement parts against the step budget (packages/engine/src/functions/regex.ts) #sharing
- [ ] **P8** A folder named "Unfiled" is indistinguishable from the root group in the document list and Move menu; label the root group differently or reserve the name #sharing
- [ ] **P10** The document list can omit a document when another tab deletes its folder between the assignment and folder queries in `apps/server/src/repo/spreadsheets.ts`; read both in one snapshot or treat assignments to missing folders as unfiled #sharing
- [ ] **P10** (GPT) Notify the user during editing if the cell being edited has been edited or deleted elsewhere. The shared formula editor initially reports a deleted target only on submission, with a Vue error modal containing the draft in a read-only editor for copying. See [the formula-editing plan](plans/formula-editing.md). #sharing
- [ ] **P10** (GPT) Add activity indicators showing other sessions' editing targets to help people coordinate parallel edits. Deferred from [the shared formula editor](plans/formula-editing.md). Follow the author's FAFO policy: indicators do not lock targets or block saves. #sharing
- [ ] **P10** The CSV append confirmation previews the mapping from the table as it was when the dialog opened, and the server maps the rows against the current columns; a rename or a plain/named switch in another session can change the mapping after confirmation, and a table deleted while the request waits for the lock gets 404 and not 409 (`TableCard.vue` near line 128, `repo/spreadsheets/tables.ts` near line 148, `context.ts` near line 289) #documents
- [ ] **P10** Copied deep links drop a reverse-proxy path prefix: `deepLinks.ts` builds root-relative `/s/...` paths and `clipboard.ts` resolves them from the origin root #small-apps
- [ ] **P10** explore Yjs + Hocuspocus for sync #sharing
- [ ] **P10** When another session adds a table while this user's "Add chart" request is pending, the new-block focus step can focus the other session's table (`AddBlockRow.vue` captures block IDs before the request) #sharing
- [ ] **P10** The column-type warning counts cells before the dialog and does not recount after confirmation, so another session's edits can make the count stale (`TableCard.vue` near line 343) #sharing
- [ ] **P10** Numbering a copy's name ("Plan (2)") uses the client's document list, so two tabs with stale lists can pick the same name and the server permits both (`SpreadsheetListView.vue` near line 153, `files.ts` near line 241) #sharing

- [ ] **P10** (Claude) `personalWorkspace()` in [spreadsheets.ts](apps/server/src/repo/spreadsheets.ts) puts a new spreadsheet, an import, and a copy into the caller's oldest workspace membership whatever the role. Once a user can belong to a shared workspace, a new spreadsheet or "Save a copy" can land in a workspace that other members read, and the caller may not own it. Choose a workspace where the caller is an owner, or one made for the caller. #sharing

- [ ] **P10** (Claude) The capacity the growth menu offers can be stale while an insert is pending. [TableCard.vue](apps/web/src/components/TableCard.vue) computes it from table records that update only when the server answers. With five spreadsheet rows left, choose "Add 5 rows", reopen the menu before the response arrives, and choose it again: the second request is rejected by the server. #sharing

- [ ] **P10** (Claude) A stale tab can insert a block at the wrong place. The insert-block requests send only a numeric index ([AddBlockRow.vue](apps/web/src/components/AddBlockRow.vue)), and the server checks it against the current block count, not against the order the client saw. With two tabs showing `[A, B]`, one inserts `X` at the top, and the stale tab then inserts at index 1: the block lands before `A` in `[X, A, B]`. Send the ID of the block to insert before (or after) instead. #sharing

- [ ] **P10** (Claude) Give one evaluation a budget, including aggregate array allocation, text length, and steps. `EvaluationContext` in [evaluate.ts](packages/engine/src/evaluate.ts) carries a mutable allowance of cells read, cells made, characters of text made, and steps (calls of a `LAMBDA`, rows of a `QUERY`, effects planned). The helpers in `arguments.ts`, `QUERY`, the template engine, and action planning charge it, and a formula that runs out is an error in its cell. The server evaluates a whole document when a button is clicked, in the one Node process and under the document's lock, so without this one formula can stall every user. #sharing
  - The rule in `CLAUDE.md` that `limitCells` "bounds the memory a formula can ask for" is true of one array only. Reword it when the budget exists.
  - [ ] **P10** (Claude) One formula can hold many arrays in memory at once. `limitCells` in [arguments.ts](packages/engine/src/functions/arguments.ts) caps each array at 100,000 cells, and nothing caps their total. `=SUM(SEQUENCE(100000), SEQUENCE(100000), …)` fits roughly 600 such arguments in one 8,192-character cell, about 60 million cells alive together. Carry a cell allowance through one formula's evaluation and charge each array made against it. #sharing
  - [ ] **P10** (Claude) Text has no length limit short of the JavaScript string limit. `REPT` and `&` can build text of hundreds of millions of characters, and every text function, including the wildcard matcher in [criteria.ts](packages/engine/src/functions/criteria.ts), takes time in proportion to it. Cap the length of text a formula can make. #sharing
- [ ] **P10** (Claude) evaluate a click's document off the main thread, with a time limit. `runCell` builds and computes the whole workbook in the request handler, which stops the one Node process from answering anyone else until it finishes. The evaluation budget in this section bounds the work; a worker thread is what can stop a formula that is already running #sharing
- [ ] **P10** (Claude) Reproduce: two failed saves to one cell may leave a value on screen that the server never held. A1 holds `old`. Type `two`, then `three` before the first save is answered, and have both saves fail. The first failure leaves the cell alone because it now holds `three`. The second restores its `previous`, which is `two`. The reviewer read this in `setCell` and its rollback in the workbook store. Nobody has run it. #sharing
- [ ] **P10** (Claude) send email from an outbox. `runCell` in [run.ts](apps/server/src/actions/run.ts) commits the cell writes and then sends, so a server that stops in between leaves the run `pending` and the email unsent, and clicking again repeats the cell writes. Store each message with the run in the same transaction and have a sender deliver and retry it #sharing
- [ ] **P10** (Claude) a click names the run it is, so a click sent twice runs once #sharing
- [ ] **P10** a limit on the recipients of one `SEND_EMAIL`, separate from the hourly limit #sharing
- [ ] **P10** (Claude) refuse to start in production on development defaults. With `NODE_ENV=production`, [config.ts](apps/server/src/config.ts) requires `AUTH_SECRET` but falls back to PGlite under `.data/` for `DATABASE_URL` and to `http://localhost:5173` for `BASE_URL`. Require both #sharing
- [ ] **P10** (Claude) require a confirmed email address before an account can send email. `REQUIRE_EMAIL_VERIFICATION` is off by default, so on an instance with `SMTP_URL` set anyone can sign up and send 50 emails an hour to any address. Either turn verification on whenever `SMTP_URL` is set, or refuse `SEND_EMAIL` from an unconfirmed account. Also add a limit on email for the whole instance #sharing
- [ ] **P10** limits on per-block and overall document size (make sure to enforce on upload as well) to avoid gigantic docs #sharing
- [ ] **P10** narrow stale-formula refusals to structural changes in the tables a formula references before several people edit one spreadsheet regularly #sharing
- [ ] **P10** (Claude) a compiled server build and a Dockerfile, verified by building and running it #sharing
- [ ] **P10** (Claude) several server processes: the change feed is in memory (Postgres LISTEN/NOTIFY would do) #sharing
- [ ] **P10** (Claude) trusted proxy configuration for better-auth's rate limiting, as a config variable #sharing

## Ambitious ideas - don't implement until further consideration

- **P9999** idea to think about: support offline work on spreadsheets, stored in local storage, and let users create and edit local spreadsheets even without an account. features like sharing, sending emails, automation, etc. would still require an account, but users could use the client side functionality freely without signing up.
- "table functions" - functions defined by a table editor. mark specific cells as inputs and a specific cell/range as the output. then when the function is invoked, evaluate the operations defined by this table (note: this shouldn't mutate the table in place)
- forms for submitting new rows to tables
- programmatic construction of documents
  - one approach:
    - create new actions to support editing other documents programmatically (by default require the user's approval for access before the first time. after that the document gains permission to edit the other doc whenever)
    - create new actions that allow creating new docs programmatically (in this case, by default, the doc that executed the creation action gets permission to edit the other doc)
    - -> then it'd be possible to have a `DO` block that makes a copy of a document and edits it

- **P999** user-defined macros so you could create your own syntax -- hypothetical use case with made-up syntax (so I'm not wedded to it looking like this): `SWITCHON(x, [A]*[B]/[C])(x > 1000, "foo", x > 100, "bar", x > 0, "baz", default="nope!")` which could possibly be defined something like, uh... idk what the macro definition syntax should actually be but somehow that would get munged into `LET(x, [A]*[B]/[C], IFS(x > 1000, "foo", x > 100, "bar", x > 0, "baz", default="nope!"))`

- (Claude) protected ranges: cells that only some people may change
- (Claude) a layout for printing
- (Claude) export to .xlsx
- (Claude) numbers and dates shown in the reader's locale

- allow table cells to contain structs/arrays/nested tables

---

(End of document. Don't add anything below this and don't remove this line. Any items below this line were added by an agent that naively appended to this file.)
