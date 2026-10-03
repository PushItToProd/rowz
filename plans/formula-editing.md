# Shared formula editor

## Inventory and editor choice

Use CodeMirror 6 for every formula-bearing input, with one Vue integration and three modes.

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
- Keep draft text, caret, history, target identity, and starting revision in an editing session owned above page components. Cells and the formula bar transfer the same session when editing the same target.
- Replace the formula-column prompt with a nonmodal popover containing the shared editor, Apply, and Cancel. Preserve the existing confirmation for converting a column and removing its stored inputs.
- Add pure, tolerant engine analysis that returns formula regions, token/reference spans, scoped bindings, and operand positions. Reuse the tokenizer and script/template scanning rules. Incomplete strings, brackets, calls, definitions, and tags must retain assistance for valid surrounding text; strict evaluation remains unchanged.
- Completion operates on formula fragments without requiring `=`. Cell inputs activate formula assistance only after `=`; other modes activate it within their formula regions.
- Offer functions, accessible names, pages, tables, and appropriate columns. Include script parameters, draft definitions, template variables, and lexical `LET`/`LAMBDA` bindings according to engine scope. Qualify ambiguous names and cross-page candidates so selecting a suggestion inserts a valid reference.
- Replace the complete token around the caret, including its suffix. Preserve quoting rules and avoid duplicate opening parentheses. Keep function signature help at the caret; suppress assistance inside strings and comments.
- Highlight formula tokens consistently. Scripts additionally highlight definitions and comments; Markdown highlights prose syntax, template delimiters, keywords, and embedded formulas. Template recognition follows current engine behavior, including tags inside Markdown code spans or fences.
- Color direct references in the active formula region and outline their visible cells with matching colors. Repeated references to the same target share a color. Script editing colors the current statement; Markdown editing colors the current expression. Names receive syntax highlighting without evaluating them to discover grid outlines.

## Reference picking and keyboard behavior

- Automatically intercept grid clicks where a formula operand is expected or a complete reference is selected. Provide a **Pick reference** control for other formula positions. Disable picking in prose, comments, strings, and definition headers.
- Picking preserves the editing target and suppresses selection changes, blur saving, fill behavior, and cell controls. A click inserts one reference; dragging previews a range and commits one undoable text change on release. Further picks replace that insertion until typing or caret movement resumes.
- Generate `A1` within the owning table, `Table!A1` for another table on the original page, and `Page!Table!A1` across pages, with required quoting. Page-scoped editors always name the table. Preserve absolute markers when replacing an existing reference.
- Named-column headers insert `[Column]` in same-table filters and formula-column definitions, and `Table[Column]` elsewhere. Individual cells insert positional addresses. Ordinary row/column headers produce whole-row/column references.
- Translate displayed rows through `rowView`. Accept a drag only when its exact stored cells form one rectangle; otherwise retain the draft and explain how to pick a whole column or clear sorting/filtering. Hidden rows must not silently enter a picked cell range.
- Keep the editor in a temporary dock while browsing other pages. Preserve history, caret, original context, and target identity. Provide **Return to editor**; committing or canceling returns to the original page.
- Preserve completion keys: arrows select suggestions, Tab accepts, and Enter accepts only after arrow-key selection. Otherwise Enter commits single formulas or inserts a newline in scripts/Markdown.
- Without completion, retain cell/formula-bar navigation. Other single-formula fields use Enter to commit and Tab to leave. Multiline Tab leaves the editor; indentation commands use Ctrl/Cmd+[ and Ctrl/Cmd+].
- Escape first dismisses completion, then cancels picking, then cancels the draft. Canceling an active drag restores its pre-drag text.
- Scripts and Markdown retain blur saving. Done and Ctrl/Cmd+Enter also save. Picking, dock transfers, completion clicks, and page browsing during picking do not save.
- Undo/redo edits the draft while an editor session is active. Workbook undo/redo resumes after the session ends. Composition events must not trigger completion acceptance or commits.

## Persistence and implementation sequence

1. Implement tolerant engine analysis and the shared CodeMirror integration, then migrate cells, the formula bar, filters, chart sources, names, and formula-column definitions.
2. Add script and Markdown modes, including scoped completion and existing preview behavior.
3. Add the persistent editing session, reference colors, grid interception, and cross-page dock.
4. Update help, `todo.md`, and decision records. Put user-confirmed interaction choices in `DECISIONS.md`; record implementation choices in `AGENT_DECISIONS.md`.

Preserve existing limits and persistence semantics. Mount an editor only for active editing or formula fields, never for every rendered cell. Failed saves retain the draft; removed targets cannot receive it.

The names endpoint currently lacks the revision check used by other formula writes. Add an optional `revision` request field, send it from the editor, and apply the existing stale-reference-write check before replacing names. Build that replacement from the current name list so unrelated changes survive. No database migration is required.

## Validation and assumptions

- Unit-test incomplete syntax, region offsets, lexical scope, comments, quoting, token replacement, qualified names, and reference generation.
- Test every input’s commit/cancel behavior, limits, read-only handling, save failures, and stale or deleted targets.
- Browser-test completion precedence, cell navigation, local history, composition, reference drag cancellation, structured headers, sorted/filtered rows, matching outlines, and cross-page picking without intermediate writes.
- Verify Markdown preview and script evaluation retain current semantics. Exercise 50,000-character sources without rendering an editor for each cell.
- Run `pnpm check`, the web production build, and `pnpm e2e:remote` before calling implementation complete.

Defaults: retain the formula language and Markdown renderer; add no action execution during editing; defer nested-language editing inside formula strings, automatic bracket insertion, and comprehensive inline diagnostics. CodeMirror feasibility is based on its documented APIs; browser integration and bundle impact must be validated during implementation.
