# Decisions

Choices made without asking, for review. Each entry says what was decided, why, and what to change if you disagree. Newest first.

## 2026-09-30: Open-sided ranges

**Decision.** A corner of a range may leave out its row or its column. `A:A` and `A:C` are whole columns, `2:2` and `2:5` are whole rows, `A2:A` runs from A2 to the bottom of the table, and `A1:4` covers rows 1 to 4 from column A to the last column. A reference that is not a range still needs both parts.

**Why these meanings.** Each corner contributes what it names. A start corner that leaves a side out begins at the first row or column. An end corner that leaves a side out has no limit on that side. This one rule gives the usual meaning to `A:A`, `1:1`, and `A2:A`, and gives `A1:4` a meaning without a special case.

**Consequences.**

- An open side stops at the table's size. The engine learns the size from the `rowCount` and `colCount` the app already passes with each table.
- A formula in column A that reads `A:A` is a cycle, as in other spreadsheets.
- A one-to-three-letter word followed by a colon is now a column, so `=A1:foo` is the range A1 to column FOO, not an error.

**To change.** `span` in `packages/engine/src/workbook.ts` holds the rule.

## 2026-09-30: Renames rewrite reference text in place

**Decision.** Renaming a page or table rewrites the formulas that name it. Only the characters of each affected reference change. The rest of the formula stays as typed, including spacing and letter case.

**Why.** The engine can already print a formula from its syntax tree, but that output adds parentheses around every operator and would reformat every formula a rename touched. The parser now records where each reference sits in the text, and `rewriteReferences` splices replacements into those positions.

**Consequences.**

- A rewritten reference is written in canonical form: `'table 2'!a1` becomes `Sales!A1`. A name is quoted only when it is not a plain word.
- The rewrite runs on the server inside the rename's transaction, and the response lists the changed cells. The client does not rewrite anything itself.
- A table name with no page qualifier means a table on the formula's own page. A formula on another page that names a table of the same name is left alone.
- Formulas that do not parse are left alone.

**To change.** `packages/engine/src/rewrite.ts` holds the matching rules in `inputsAfterRename`.

## 2026-09-30: Errors can be written in a formula

**Decision.** `#REF!`, `#DIV/0!`, and the other error codes are valid in formula text and evaluate to that error.

**Why.** Deleting a row, column, or table has to leave something where a formula named the deleted cells. Spreadsheets write `#REF!` there. Without this, the rewritten formula would fail to parse and show `#ERROR!`, which hides the cause.
