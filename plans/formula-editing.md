# Shared formula editor

## Inventory and editor choice

Use CodeMirror 6 for every formula-bearing input, with one Vue integration and four modes: cell input, formula, script, and Markdown template.

| Input location            | Current implementation                             | Mode and context                                          |
| ------------------------- | -------------------------------------------------- | --------------------------------------------------------- |
| Grid cell                 | Input with completion                              | Cell input; page, table, stored row                       |
| Formula bar               | Input with completion                              | Same cell editing context                                 |
| Formula-column definition | Browser prompt; subsequent edits through cells/bar | Formula; page, table, same-row columns                    |
| Existing table name       | Input without assistance                           | Formula; page and owning table                            |
| New table name            | Input without assistance                           | Formula; page and owning table                            |
| Table filter              | Input with completion                              | Formula; page, table, same-row columns                    |
| Chart source              | Input without assistance                           | Formula; page, no implicit table                          |
| Script source             | Textarea                                           | Script; page, definitions and function parameters         |
| Markdown template source  | Textarea with rendered preview                     | Markdown; page, template expressions and scoped variables |

Conditional-format criteria, choice lists, identifiers, and rename fields remain ordinary controls. Formula strings inside functions such as `MARKDOWN` and `QUERY` remain strings.

CodeMirror provides configurable keymaps, completion, history, and decorations suitable for these modes. Use its packages directly with explicit extensions. Formula and template analysis will reuse engine code; a separate Lezer formula grammar is unnecessary for this implementation. Markdown uses CodeMirror’s Markdown language support with template decorations taking precedence inside tags. [Guide](https://codemirror.net/docs/guide/), [completion](https://codemirror.net/examples/autocompletion/), [decorations](https://codemirror.net/examples/decoration/).

Native inputs would require custom highlighting and caret overlays. A second editor implementation for scripts and Markdown would duplicate completion, picking, and keyboard behavior. Choose CodeMirror throughout.

## Editing, completion, and highlighting

- Provide a shared `FormulaEditor` interface for mode, text, editing context, accessible label, read-only state, length limit, and commit/cancel behavior. Context explicitly includes the original page and optional table, row, and holder.
- Keep draft text, caret, history, and target identity in an editing session owned above page components. Cells and the formula bar transfer the same session when editing the same target. A starting revision is not a condition for accepting the draft.
- Editing a formula-column cell targets the column, identified by table ID and column ID. Its inline editor, formula bar, and column popover share that session without intermediate saves. Use formula mode and same-row column context in all three. Show a persistent, visible label such as **Editing formula for every row in Sales[Amount]** from the moment editing begins, including in the inline editor and dock; include the same information in the accessible label. Do not present the edit as affecting only the selected cell. Deleting the originating row does not end the column session; move it to the dock if needed. Deleting the column or table uses the deleted-target dialog on submission.
- Replace the formula-column prompt with a nonmodal popover containing the shared editor, Apply, and Cancel. Preserve the existing confirmation for converting a column and removing its stored inputs.
- Add pure, tolerant engine analysis that returns formula regions, token/reference spans, scoped bindings, and operand positions. Reuse the tokenizer and script/template scanning rules. Incomplete strings, brackets, calls, definitions, and tags must retain assistance for valid surrounding text; strict evaluation remains unchanged.
- Completion operates on formula fragments without requiring `=`. Cell inputs activate formula assistance only after `=`; other modes activate it within their formula regions.
- Offer functions, accessible names, pages, tables, and appropriate columns. Include script parameters, draft definitions, template variables, and lexical `LET`/`LAMBDA` bindings according to engine scope. Qualify ambiguous names and cross-page candidates so selecting a suggestion inserts a valid reference.
- Replace the complete token around the caret, including its suffix. Preserve quoting rules and avoid duplicate opening parentheses. Keep function signature help at the caret; suppress assistance inside strings and comments.
- Highlight formula tokens consistently. Scripts additionally highlight definitions and comments; Markdown highlights prose syntax, template delimiters, keywords, and embedded formulas. Template recognition follows current engine behavior, including tags inside Markdown code spans or fences.
- Color direct references in the active formula region and outline their visible cells with matching colors. Repeated references to the same target share a color. Script editing colors the current statement; Markdown editing colors the current expression. Names receive syntax highlighting without evaluating them to discover grid outlines.

## Reference picking and keyboard behavior

- Automatically intercept grid clicks where a formula operand is expected or a complete reference is selected. Provide a **Pick reference** control for other formula positions. Disable picking in prose, comments, strings, and definition headers.
- Explicit **Pick reference** replaces selected text within a formula region. With no selection, replace the complete reference under the caret if there is one; otherwise insert at the caret. Do not add operators or repair surrounding syntax. For example, selecting `10` in `=10+B2` and picking A1 produces `=A1+B2`. Clicking the control preserves the editor's selection for this operation.
- Picking preserves the editing target and suppresses selection changes, blur saving, fill behavior, and cell controls. A click inserts one reference; dragging previews a range and commits one undoable text change on release. Further picks replace that insertion until typing or caret movement resumes.
- Generate `A1` within the owning table, `Table!A1` for another table on the original page, and `Page!Table!A1` across pages, with required quoting. Page-scoped editors always name the table. All picked positional references are relative, including replacements of references containing `$`. Absolute markers are user-explicit: selecting `$A1` and picking B2:D4 inserts `B2:D4`; the user can then type any desired `$` markers.
- Clicking a named-column header inserts `[Column]` in same-table filters and formula-column definitions, including edits opened from a formula-column cell or the formula bar. This keeps the engine's same-row meaning. Elsewhere insert `Table[Column]`; cross-page picks qualify the table with its page, as in `Page!Table[Column]`, with required quoting. Whole-column structured references cover the stored column, including filtered-out rows. Individual cells insert positional addresses. Ordinary row/column headers produce whole-row/column references; dragging across ordinary headers produces ranges such as `A:C`. Whole-column references include filtered-out rows. Dragging across multiple named-column headers is deferred in `todo.md`; it must not commit a misleading single-column pick.
- Translate displayed rows through `rowView`. Accept a drag only when its exact stored cells form one rectangle; otherwise retain the draft and explain how to pick a whole column or clear sorting/filtering. Hidden rows must not silently enter a picked cell range.
- Keep a formula draft in a temporary dock while browsing other pages, including a cell draft that contains only `=`. Label the dock with the editing target's page, table, and current cell address, or the corresponding target for another formula editor; formula-column drafts use the whole-column label above. Preserve history, caret, original context, and target identity. Provide **Return to editor**; committing or canceling returns to the original page. A literal cell draft, such as `1`, saves before changing pages and does not open the dock.
- Preserve completion keys: arrows select suggestions, Tab accepts, and Enter accepts only after arrow-key selection. Otherwise Enter commits single formulas or inserts a newline in scripts/Markdown.
- While editing, arrow keys move the caret or navigate completion suggestions; they never select grid cells to insert references and do not commit the draft. This also applies after an incomplete operand such as `=B3+` and during explicit picking. Preserve cell/formula-bar Enter and Tab navigation, and ordinary grid arrow navigation when no editor is active. Other existing single-formula fields use Enter to save and Tab to save and move focus. The new-name form uses the exception below. Multiline Tab leaves the editor; indentation commands use Ctrl/Cmd+[ and Ctrl/Cmd+].
- Escape first dismisses completion, then cancels picking. With neither active, Escape cancels a single-line draft without saving; it does not discard a script or Markdown draft. Canceling an active drag restores its pre-drag text.
- Scripts and Markdown have explicit Done and Cancel buttons. Done and Ctrl/Cmd+Enter save; Cancel discards the draft without saving. Leaving a multiline editor normally saves.
- Undo/redo edits the draft while an editor session is active. Workbook undo/redo resumes after the session ends. Composition events must not trigger completion acceptance or commits.

### Reference observations from Google Sheets

The author tested these interactions while planning. They are reference observations, not rowz requirements. With `=B3`, clicking another cell left the editor regardless of caret position or selection. With `=B3+`, clicking another cell inserted a reference, and arrow keys selected cells to insert instead of moving the caret. Moving the caret between `B` and `3` in that incomplete formula and clicking another cell produced a syntax-error dialog; returning to the editor left arrow keys moving the caret. The author found the arrow-key reference picking intrusive when trying to correct an earlier reference and chose the rowz rules above.

## Persistence and implementation sequence

### Per-field submission rules

Completion and reference-picking interactions take precedence over these rules. Escape discards a single-line draft only after completion and picking have been dismissed. A failed save blocks the requested transition as described below.

| Field                                              | Enter                                | Tab or Shift+Tab                                | Clicking outside                                      | Explicit controls                                                          |
| -------------------------------------------------- | ------------------------------------ | ----------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------- |
| Existing named formula, table filter, chart source | Save                                 | Save and move focus                             | Save                                                  | Cancel, where present, discards                                            |
| Formula-column popover                             | Save                                 | Save and move focus                             | Save                                                  | Apply saves; Cancel discards                                               |
| New-name form                                      | Submit the name and formula together | Move between controls without creating the name | Retain the unfinished entry without creating the name | Add name submits; Cancel or closing the form discards the unfinished entry |

The new-name form holds its identifier and formula as one unfinished entry. Only Add name or Enter submits it, using the existing name and formula validation. Moving between its controls does not start another editing target or submit either field separately.

### Confirmed transition behavior

- Switching focus to another editing target or interacting with ordinary page controls saves the current draft, except for the unfinished new-name form described above. Escape in a single-line editor and an explicit Cancel button discard it without saving.
- Formula-editing interactions keep the same session open without saving: grid clicks and drags used to pick references, internal page browsing to find references, completion clicks, and transfers between editors for the same target, including a formula column's inline editor, formula bar, and popover. These exceptions continue the draft; opening another editing target saves it.
- Decide cell behavior from the current draft, not the saved cell input. A draft beginning with `=` is a formula draft, even before it contains an operand. Internal page navigation keeps a formula draft open in the labeled dock; it saves a literal cell draft before navigating. Script and Markdown reference picking uses the formula regions described above.
- Leaving the spreadsheet, closing the tab, or reloading with an unsaved draft prompts for confirmation. Staying retains the draft; confirming departure discards it without submitting a save.
- Parallel editing follows the author's **FAFO** policy: last submitter wins. Add no editor locks, concurrent-edit conflict resolution, or save blocking because references may have changed. Activity indicators are the intended future aid for coordinating editors and are outside this implementation.
- Structural changes during editing do not rewrite the draft or prevent submission. Resolve the editing target through its stable IDs and save the exact submitted formula against the current document. For example, entering `=B2` in B7, then inserting a row between rows 1 and 2, saves `=B2` in the original target's new position B8. Update the visible target label when its position changes. A deleted target still uses the submit-time recovery dialog below.
- A transition that requires saving waits for the save result before switching targets, changing pages, closing the editor, or running the requested page-control action. On failure, stop that transition, keep the same draft and editing session open, restore focus to its editor, and show the save error. The user can retry or cancel; canceling does not replay the blocked action. A failed save does not create a separate background draft.
- Detect a deleted editing target when the user submits, including a save triggered by leaving the editor. Do not proactively interrupt the draft when a refresh reports its target missing; keep its text and session available even if its original component unmounts. Stop the attempted transition and show a Vue modal dialog explaining that the target was deleted and the input was not saved. Include the exact submitted text in a read-only shared editor with the original mode, so the user can select and copy it. Do not use a browser-native alert, recreate the target, or save to another target. A position change alone is not deletion: resolve stable target IDs as usual. Proactive notices of edits or deletion during editing are deferred in `todo.md` under **Before sharing with others**.

1. Implement tolerant engine analysis, the shared CodeMirror integration, and persistent session ownership above page components. Establish target identity, editor transfers, submission rules, and failure handling before migrating cells, the formula bar, filters, chart sources, names, and formula-column definitions. Remove revision-based formula-save restrictions as part of these write-path changes.
2. Add script and Markdown modes, including scoped completion and existing preview behavior.
3. Extend the shared session with reference colors, grid interception, reference picking, and the cross-page dock.
4. Update help, `todo.md`, and decision records. Put user-confirmed interaction choices in `DECISIONS.md`; record implementation choices in `AGENT_DECISIONS.md`.

Preserve existing limits and persistence semantics except for the revision-based formula-save restrictions explicitly removed here. Mount an editor only for active editing or formula fields, never for every rendered cell. Failed saves retain the draft; removed targets cannot receive it.

Remove revision-based stale-reference rejection from formula-editor write paths on the server and update their client handling and tests. Merely omitting the request revision is insufficient: `SpreadsheetRepository.checkWrittenAt` currently rejects formula writes without one. Do not add a revision check to the names endpoint. No database migration is required. Structural edits still rewrite saved formulas according to the project's existing rules; an unsaved draft is accepted literally when submitted.

An existing named formula's editing target is its table ID and case-insensitive name captured when editing starts, not its index in the list. At submission, find that name in the current table's name list and replace its formula while preserving the other entries. If the table or name no longer exists, use the deleted-target dialog; do not recreate it or update the entry now occupying its old index. A rename that changes the spelling beyond case makes the original target missing. Add no stable name IDs or schema changes for this implementation.

## Validation and assumptions

### Implementation progress

Step 1 has started. `packages/engine/src/editing.ts` analyzes formula fragments tolerantly with original-source token and direct-reference offsets, lexical `LET`/`LAMBDA` bindings, and operand-position checks. Existing completion uses those bindings and replaces token suffixes; formula-fragment completion no longer requires `=`.

`FormulaEditor.vue` supplies the shared single-line CodeMirror integration. `formula/session.ts` owns editor state in Pinia independently of page components, including caret and history, stable target identity, transfers without saving, deduplicated submission, and draft retention after failed saves or deleted-target results. Chart sources now use `SessionFormulaField.vue`. `FormulaSessionHost.vue` retains a draft when its field unmounts and provides a Vue recovery dialog only after submitting a deleted target. Internal page browsing preserves chart drafts with a labeled dock and Return to editor; confirmed departure discards without saving. Page-control clicks and workbook writes wait for an active shared draft to save; failed saves block the requested action. Other input locations still use their existing editors.

The server and shared request schemas no longer reject formula writes because of their starting revision, and the client no longer reopens cells for `stale_formula` responses. Optional revision fields remain accepted for existing callers but do not restrict submission. Stable-target submission adapters resolve cells, columns, names, filters, and chart sources against current records; named targets are found by case-insensitive name and preserve other current entries. No migration was added.

Remaining step 1 work includes script/template scanning for tolerant regions, qualified-name completion, migration of cells, the formula bar, names, filters, and formula-column definitions, and their complete transition/failure handling. Formula-column labels and popovers remain unfinished. Step 2 and reference picking/colors from step 3 remain unimplemented. The first chart migration increased the production JavaScript bundle from about 226 KB to 329 KB gzipped; browser tests exercise the mounted CodeMirror editor.

### Required validation

- Unit-test incomplete syntax, region offsets, lexical scope, comments, quoting, token replacement, qualified names, and reference generation.
- Test every input’s commit/cancel behavior, limits, read-only handling, save failures, and moved or deleted targets.
- Test that structural changes during editing do not reject submission or rewrite the draft, including the `=B2` in B7 moving to B8 example. Test that an intervening edit to the same target is overwritten on submission.
- Test that a failed transition-triggered save retains the draft and editor focus without selecting the requested target, changing pages, closing the editor, or running the requested page-control action. Test retry and cancel after failure.
- Test that deleting the target does not interrupt or erase the draft before submission, and that submission opens the Vue error modal with the exact draft in a read-only editor without writing elsewhere. Include deletion that unmounts the original editor component.
- Test named-formula target lookup by table ID and case-insensitive name, preservation of other current names, and the deleted-target dialog when the original name is absent.
- Test that formula-column editing visibly identifies the whole-column effect before submission in every editor, transfers the same draft and history between the inline editor, formula bar, and popover, survives deletion of its originating row, and reports deletion of its column on submission.
- Test each per-field submission rule, including no new-name creation on Tab or clicking outside and no double submission when Enter or Apply is followed by blur.
- Browser-test completion precedence, cell navigation, local history, composition, reference drag cancellation, structured headers, sorted/filtered rows, matching outlines, and cross-page picking without intermediate writes.
- Test explicit picking with selected text, a reference under the caret, and a bare insertion point. Test that arrow keys edit the draft after `=B3+` and during picking, while completion arrows still navigate suggestions.
- Test that replacing an absolute or mixed reference produces a relative picked reference, including `$A1` replaced by `B2:D4`.
- Browser-test that changing pages saves a literal cell draft, keeps a formula draft consisting only of `=` open with its original target labeled, and uses the current draft to decide after changing a literal into a formula or a formula into a literal.
- Verify Markdown preview and script evaluation retain current semantics. Exercise 50,000-character sources without rendering an editor for each cell.
- Run `pnpm check`, the web production build, and `pnpm e2e:remote:codex` (or `pnpm e2e:remote` outside Codex) before calling implementation complete.

Defaults: retain the formula language and Markdown renderer; add no action execution during editing; defer nested-language editing inside formula strings, automatic bracket insertion, and comprehensive inline diagnostics. These deferred features and dragging across multiple named-column headers are tracked in `todo.md`. CodeMirror feasibility is based on its documented APIs; browser integration and bundle impact must be validated during implementation.
