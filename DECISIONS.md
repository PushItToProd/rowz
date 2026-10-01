# Decisions

Choices made without asking, for review. Each entry says what was decided, why, and what to change if you disagree. Newest first.

## 2026-09-30: LET, LAMBDA, and calling a function kept in a cell

**Decision.** `LET(name, value, ..., result)` and `LAMBDA(parameter, ..., body)` work as in Excel. A function kept in a cell is called by the cell's address: with `=LAMBDA(x, x * 2)` in D1, another cell writes `=D1(21)`.

**Why the cell address is the call syntax.** The todo item asked for a function bound in one cell and invoked from others. Calling by address needs no naming feature, and it reuses everything references already do: the caller depends on the defining cell, renames and row inserts rewrite the call, and `Tools!D1(21)` reaches another table. A named-function feature (a workbook-level list of names) would read better and can be added on top.

**Consequences.**

- A cell address before parentheses always means "call that cell". No built-in function can be named like a cell address, so a future `LOG10` or `ATAN2` needs a different name or a parser exception. A test enforces this for the built-in list.
- An unknown word is now a `#NAME?` error when the formula is computed, not when it is parsed. The result in the cell is the same.
- References inside a function body are read from the defining cell's table, not the caller's.
- A function in a cell cannot call its own cell, because that is a reference cycle. Recursion works by passing the function to itself. Calls nest at most 200 deep.

**To change.** `packages/engine/src/functions/names.ts` holds the two forms. The call syntax is in `Parser.identifier` and `Parser.unary`.

## 2026-09-30: The first batch of added functions

**Decision.** Added 35 functions that other spreadsheets have and that return a single value: the `SUMIF` family, `VLOOKUP`, `XLOOKUP`, `MATCH`, `INDEX`, more math and text functions, the `IS` checks, `IFS`, and `SWITCH`. The help page lists them all.

**Choices that differ between spreadsheets or that I had to pick.**

- `VLOOKUP` and `MATCH` default to the nearest match in sorted data, as in Excel and Google Sheets. Pass `FALSE` or `0` for an exact match. Formulas pasted from those apps behave the same here.
- `XLOOKUP` only does exact matches, and both of its ranges must be a single row or column. Its other match modes can come later.
- A criterion such as `">5"` only matches cells of its own kind: it matches numbers above 5 and never text. An empty criterion `""` matches empty cells, and `"<>"` matches non-empty ones.
- A lookup that finds nothing gives `#N/A`. That error code is back for this purpose.
- `HLOOKUP` is left out. `XLOOKUP` and `INDEX` with `MATCH` cover it.
- Functions that return several values (`FILTER`, `SORT`, `UNIQUE`) wait for array results.
- Dates are not started. There is no date value yet, so `TODAY` and date arithmetic need their own design.

## 2026-09-30: Deleting and inserting rows and columns

**Decision.** A row or column anywhere in a table can be deleted, and one can be inserted before any row or column. The todo item asked only for deleting. Inserting uses the same code, so both shipped.

**How it behaves.**

- Cells past the edit move by one. Formulas anywhere in the spreadsheet that read the table are rewritten to keep reading the same cells.
- A range shrinks when a row inside it is deleted and grows when one is inserted inside it. A formula that named a deleted cell gets `#REF!` in place of the reference.
- The controls act on the selected cell's row and column. Deleting asks for confirmation only when the row or column holds something.
- A table keeps at least one row and one column.

**Why the engine computes it.** The engine function `inputsAfterEdit` takes the workbook and the edit and returns the cell writes. The server applies them in one transaction with the table's new size and returns them, and the browser applies the same list. Shifting rows in SQL would be faster for a large table but would put the rewriting rules in two places.

**Known cost.** Every moved cell is rewritten in the database. Deleting row 1 of a full 1000 by 100 table writes about 100,000 cells.

**To change.** `moveSpan` in `packages/engine/src/rewrite.ts` holds the range rules.

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
