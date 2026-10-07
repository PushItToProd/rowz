# Decisions

Decisions the author made or approved. Each entry says what was decided, why, and what would reopen it. Newest first. Choices agents made on their own are in [AGENT_DECISIONS.md](AGENT_DECISIONS.md).

## 2026-10-07: New code adds no native `<select>`

**Decision.** No new `<select>` element is added to the web app. A choice from a list uses an in-app dropdown. The existing `<select>` elements stay until a shared dropdown replaces them. This extends the earlier removal of `alert`, `confirm`, `prompt`, and `title` tooltips.

**Why.** A native dropdown opens a popup the browser and operating system draw, which looks and behaves differently on each and cannot be styled or extended, for example with color swatches.

**What would reopen it.** A control for which the native element is the only workable choice, as the file chooser is.

## 2026-10-07: Controls are shown unless there is a reason to hide them

**Decision.** A control is not hidden to make the page look cleaner. A control may appear only in context, such as a toolbar for the selected cell or block, when showing it everywhere is impractical. When unsure, show it. A menu that opens on right-click also opens from a visible button.

**Why.** A person cannot use a control they do not know is there. An ellipsis on every cell would be worse than a toolbar for the selection, so the rule allows context where there is no other way.

**What would reopen it.** Pages that become too cluttered to read in use.

## 2026-10-07: The interface is compact

**Decision.** rowz favors showing more of the document over whitespace. Its models are Excel and Sheets for the grid, and Jupyter notebooks and dashboard tools such as Grafana for a page of blocks.

**Why.** These are the tools the author works in and has been drawing on.

**What would reopen it.** A redesign of the phone-width layout, where compact controls are too small to touch.

## 2026-10-07: Keyboard access comes from a command palette and parameter forms

**Decision.** Everything should be possible without a mouse. A feature gets there through shared means: a command palette that lists every action, and, for an action that needs parameters, a form in a dialog where Tab moves between fields, Enter submits, and Escape cancels. A feature does not get a shortcut of its own for the sake of keyboard access.

**Why.** The author is a keyboard user and does not want agents to fit every feature into the key bindings. Two shared means cover actions without parameters, such as bold or a cell border, and actions with them, such as a chart or a pivot table.

**Four cases beyond the palette and a form.** A context menu opens from the keyboard for whatever has focus. A spatial action such as resize or reorder has a command that does what the drag does. A key moves focus between the regions of a page, since Tab is taken inside the grid. A control inside a popover can be reached and operated from the keyboard.

**What would reopen it.** A feature the palette and a form serve badly.

## 2026-10-07: Where Excel and Sheets differ, Sheets for keys and functions, Excel for table features

**Decision.** When no other rule applies and the two differ, rowz follows Sheets for keyboard behavior and functions, and Excel for table features such as structured references.

**Why.** This matches what rowz already took from each: array functions and `QUERY` from Sheets, and `Table[Column]` from Excel.

**What would reopen it.** The author accepted this as reasonable for now. A case where the default gives a result the author dislikes reopens it.

## 2026-10-07: A name opens for editing on one click

**Decision.** A block's name and a document's name open for editing on one click, not a double-click.

**Why.** The author asked for it. A name has no other use for a single click.

**Not decided.** Whether a script or text block should also open for editing on one click. The author thinks it might be better.

**What would reopen it.** Accidental renames in use.

## 2026-10-07: Closed messages are kept in a history

**Decision.** A passing message or error closes without being dismissed, and recent ones stay available in a history the person can open.

**Why.** A message that closes by itself can vanish before it is read.

**What would reopen it.** Nothing foreseen.

## 2026-10-07: Excel and Sheets bound effort on problems outside the author's priorities

**Decision.** When neither Excel nor Sheets solves a usability problem and it is not among the author's priorities, rowz does not have to solve it. An agent may raise it and add a todo, and does not build a mechanism for it.

**Why.** Agents proposed elaborate handling for cases such as two people editing one cell. The author checked what Sheets does in each, and it was almost always far simpler than the proposal.

**What would reopen it.** The author making such a problem a priority.

## 2026-10-07: rowz prefers correct results to another spreadsheet's mistakes

**Decision.** rowz aims to be more correct than other spreadsheets in what a function returns. A result a reader would call wrong, such as half an emoji from `LEFT`, is fixed even where Excel and Sheets return it. Tolerances other spreadsheets apply so that results match what people expect, such as treating numbers that differ by a tiny floating-point error as equal, are reasonable and are not removed. This is a preference judged case by case, not an absolute.

**Why.** Splitting a character is a functional error. A comparison tolerance is a deliberate accommodation that makes results match expectation.

**What would reopen it.** A case the distinction does not settle.

## 2026-10-05: An action that undo reverses asks for no confirmation

**Decision.** Deleting a row, a column, or a page does not ask for confirmation, because undo restores each of them with its formulas and formats. A confirmation is kept for what undo cannot reverse.

**Why.** A confirmation that guards a reversible action interrupts every use of it to prevent a mistake the app can already put right.

**What would reopen it.** An action whose undo proves unreliable or is refused often enough that people lose work.

## 2026-10-05: A cell reference in a text view carries its number format

**Decision.** A bare cell reference in a template, such as `{{Sales!D1}}`, shows the value with the cell's number format. A computed value has no cell to take a format from and is formatted with `TEXT`.

**Why.** A report that shows `7.5` beside a cell showing `$7.50` reads as a bug.

**What would reopen it.** A need to show a cell's raw value in a text view without wrapping it in a formula.

## 2026-10-05: Committing a formula closes its open parentheses

**Decision.** A formula committed with parentheses left open at its end is saved with them closed: `=SUM(D2:D4` becomes `=SUM(D2:D4)`.

**Why.** Excel and Sheets do this, and at the end of a formula the fix is unambiguous.

**What would reopen it.** A case where the added parenthesis hides a mistake the error would have shown.

## 2026-10-05: A row or column added from inside a range joins it

**Decision.** A range grows when a row or column is added from a row or column inside it, and stays as it is when one is added from outside. With the range `A2:A8`, right-clicking row 8 and choosing **Add 1 row below** makes it `A2:A9`. Right-clicking row 9 and choosing **Add 1 row above** puts the new row in the same place and leaves the range as `A2:A8`. Likewise, adding a row above from row 8 grows the range, and adding a row below from row 9 does not. Columns follow the same rule.

**Why.** Each command then does one thing wherever it is used: what the person selected says whether they are working inside the range. A total under a list grows with the list when a row is added from the list's last row, and a range that ends where it does on purpose is left alone by an edit made beside it.

**Not decided.** Rows that an action adds, such as `APPEND_ROW` and `INSERT`, keep their current behavior until this is considered separately.

**What would reopen it.** Experience with ranges that grow when that was not wanted, or a decision about rows added by actions.

## 2026-10-05: Text functions never split a character

**Decision.** `LEN`, `LEFT`, `RIGHT`, `MID`, `SLICE`, and any other function that counts or cuts text work in grapheme clusters, which are what a reader sees as one character. `LEN("😀")` is 1, `LEFT("😀a", 1)` is the emoji, and a flag or a family emoji, which is several code points, also counts as one.

**Why.** Returning part of a character is wrong output, whatever other spreadsheets do. Counting code points would fix a single emoji and still split the ones built from several.

**What would reopen it.** A cost in speed on long text that the app cannot accept.

## 2026-10-05: Charts are drawn with Apache ECharts

**Decision.** rowz draws its charts with Apache ECharts in place of its own SVG drawing code.

**Why.** A charting library takes over the details that are otherwise each a task here: axis titles, stacked bars, colors, a date axis, labels on hover, and sizing.

**What would reopen it.** A bundle size or a rendering limit that the app cannot accept.

## 2026-10-04: Formula-column editing uses a visibly labeled column session

**Decision.** Formula-column edits target the table ID and column ID and share one session across the inline editor, formula bar, and column popover. Every editor visibly identifies the whole-column effect before submission, with a label such as **Editing formula for every row in Sales[Amount]**. Deleting the originating row leaves the column session intact; deleting the column uses the agreed submit-time error dialog.

**Why.** The current cell editor looks like an edit to one cell until saving applies the formula to every row. The user should see that effect before typing or saving.

**What would reopen it.** A change to how formula columns are edited.

## 2026-10-04: Header picks reference stored columns

**Decision.** Named-column header clicks insert structured references; ordinary column header clicks insert positional whole-column references. Both include filtered-out rows. Ordinary header drags produce whole-row or whole-column ranges. Defer dragging across multiple named-column headers and track it in `todo.md`. Cell drags include exactly the picked cells and are accepted only when those cells form one stored rectangle. Cross-page references qualify the table with its page.

**Why.** Header picks request whole columns. Cell picks request the displayed cells the user actually picked.

**What would reopen it.** A future design for picking ranges of named columns.

## 2026-10-04: Reference picking preserves ordinary caret movement

**Decision.** Explicit Pick reference replaces selected formula text, otherwise the complete reference under the caret, otherwise inserts at the caret. It adds no operators and does not repair surrounding syntax. Further picks replace that insertion until typing or caret movement resumes. Arrow keys move the caret or navigate completion suggestions while editing; they never pick grid references or commit the draft.

**Why.** The author finds Google Sheets' arrow-key reference picking intrusive when correcting earlier text in an incomplete formula. Its observed behavior is recorded in [the plan](plans/formula-editing.md) for reference.

**Absolute markers.** Picked positional references are always relative, even when replacing a reference containing `$`. Selecting `$A1` and picking B2:D4 inserts `B2:D4`. The user types any desired absolute markers explicitly.

**What would reopen it.** Experience using reference picking in rowz.

## 2026-10-04: Single-formula fields save on Enter and focus changes

**Decision.** Existing named formulas, filters, chart sources, and formula-column popovers save on Enter, Tab, or clicking outside, subject to completion and formula-editing exceptions. Tab saves before moving focus. Escape or Cancel discards. Apply explicitly saves a formula-column definition. A new name is one unfinished entry containing its identifier and formula: only Add name or Enter submits it. Tab moves between its controls without creating the name; clicking outside retains the unfinished entry.

**Why.** Existing formulas follow the ordinary save-on-focus-change behavior. A new name needs an explicit submission of both fields.

**What would reopen it.** Experience using these controls.

## 2026-10-04: Named-formula editors identify targets by table and name

**Decision.** Identify an existing named formula by its table ID and case-insensitive name captured when editing starts. On submission, find it in the current name list and update its formula while preserving other entries. If it is absent, use the deleted-target dialog. Add no stable name IDs or schema changes.

**Why.** This gives the editor a target independent of the name's list index with the current storage model.

**What would reopen it.** A feature requiring a named-formula editing session to follow a rename.

## 2026-10-04: Parallel editing uses last submitter wins

**Decision.** Parallel editing follows the author's **FAFO** policy. Accept the last submitted edit without locks, conflict resolution, or blocking a formula save because its references may have changed. Stable target IDs keep the write attached to its target after moves; the draft's formula text is saved literally against the current document. For example, `=B2` entered in B7 saves as `=B2` in B8 if a row was inserted above the target during editing. Saved formulas continue to follow the existing structural-rewrite rules. Deleted targets use the submit-time recovery dialog.

**Why.** rowz is a proof of concept with one user. Coordination between future simultaneous editors should come from activity indicators. Blocking saves in an attempt to prevent conflicting edits can harm the editing experience.

**Implementation scope.** The shared-editor plan removes existing revision-based stale-reference rejection from its write paths and adds no such check to names. Activity indicators remain deferred.

**What would reopen it.** An explicit author decision to provide stronger conflict handling. Concurrent editing alone does not justify adding it.

## 2026-10-04: Formula drafts save on ordinary focus changes

**Decision.** Switching editing targets or interacting with ordinary page controls saves the current draft. Escape discards a single-line draft; it does not discard a multiline script or Markdown draft. Multiline editors provide an explicit Cancel button. Leaving the spreadsheet with an unsaved draft prompts for confirmation; confirming departure discards the draft without saving.

**Why.** Ordinary interaction should preserve the user's work. Escape, Cancel, and confirmed departure express a choice to discard it. Concurrent editing is not a priority during the proof of concept.

**Formula-editing exceptions.** Reference picks, page browsing to find references, completion clicks, and transfers between the inline editor and formula bar for the same target keep the draft open without saving. Page changes save literal cell drafts; formula cell drafts, including just `=`, remain open in a dock labeled with their original target. The current draft determines which behavior applies.

**Save failures.** A transition that requires saving waits for success. If saving fails, stop the transition, keep the draft open with editor focus, and show the error so the user can retry or cancel. Keep recovery in the active editor without a separate background draft.

**Deleted targets.** Wait until submission to report that an editing target was deleted. Show a Vue modal dialog with the save error and exact entered text in a read-only shared editor so the user can copy it. Preserve the draft until submission even if the original editor component unmounts. Proactive notices of edits or deletion during editing are deferred under **Before sharing with others** in `todo.md`.

**What would reopen it.** Experience using the shared editor. Parallel editing follows the separate policy above.

## 2026-10-03: Errors are always visible

**Decision.** Error visibility is a core product principle. rowz puts errors front and center throughout a document, including errors on inactive pages and in filtered-out rows. A prominent header indicator opens a list of errors with links to their locations. Blocks, pages, and documents in the document list carry warning triangles when they contain errors. Cell errors show explanations in an in-app popover.

**Why.** An error in a traditional spreadsheet can disappear into a remote corner of a large document. rowz should make errors impossible to overlook, so a document's calculations and logic can be trusted only after its errors have been addressed.

**What would reopen it.** The presentation can change, but errors must remain visible without searching individual cells or visiting every page.

## 2026-10-02: Sorting, filtering, choices, and conditional formats

Four decisions shape how a data table is shown.

- **One filter formula per table**, such as `=[Payout] > 60000`. It is written in the table, so `[Column]` means the row's own cell, as in a formula column.
- **A selection is a rectangle of the rows shown.** While a table is sorted or filtered, copy, clear, fill, paste, and delete act on those rows.
- **A dropdown column takes its choices from a list on the column, or from a column of another data table.**
- **A conditional format tests the cell's own value** with a `COUNTIF`-style criterion, or shades a range with a two-color scale.

Sort and filter are display settings stored on the table. The stored row order does not change, so a position such as `A2` reads the same cell under any sort or filter.

**What would reopen it.** A filter that is several conditions the person edits separately, a conditional format that reads other cells, or a view of one table with its own sort and filter.

## 2026-10-02: An ambiguous name is an error

A word written alone in a formula, such as `Total` or `Sales`, can mean a name or a table anywhere in the document. When it has more than one meaning it is `#NAME?`. This holds for two names of one spelling, whatever holds them, and for a name and a table of one spelling, on any page. No meaning wins by being nearer to the formula: a name in the formula's own script does not beat the same name in another script.

The qualified form always works: `February!Total` is the name `Total` held by the table or script February, and `'Page 1'!Sales` is a table on another page.

**Why.** A rule that prefers the nearest meaning lets one edit change what other formulas read without any of them showing it. Take a table `X` on page 1 and a name `Y` on page 2. `SUM(X)` reads the table from any page. Rename `Y` to `X`, and under a nearest-wins rule every `SUM(X)` on page 2 reads the renamed name, with nothing on screen to say so. With the error, each of those formulas shows `#NAME?` and lists both meanings.

**What this costs.** Copying a script, or using a common name such as `Total` in two places, makes every bare use of it an error until it is qualified. The author chose the stricter and simpler rule knowing this, and may reconsider if it proves too painful in use.

**The convention that follows.** Give names distinct spellings, or write them qualified. A document with a February block and a March block that each define `Total` works when its formulas say `February!Total` and `March!Total`. The README and the help page recommend this.

**What would reopen it.** Two changes were considered and deferred, and both are in `todo.md`. One resolves an ambiguous word by nearness and marks every use of a word with more than one meaning in the document, with a yellow wavy underline. The other makes a rename qualify the bare words it would make ambiguous before it applies.

## 2026-10-02: Only a plain table holds names

A plain table can define names for its cells and ranges. A data table cannot.

**Why.** A name in a table is a formula such as `B2`, which names a position. A data table's rows can be sorted and filtered for display while the stored order, and so what `B2` reads, stays the same. A named cell could then appear to point at a row other than the one it reads. A data table's columns already have names, and `Sales[Price]` covers what a named range would be used for there.

**What would reopen it.** A way to name a cell of a data table by its row's identity.
