# Names, scripts, and assertions

This plan adds names to documents. A name is an identifier with a formula, and a table or a script holds it. A script is a new kind of block that holds only names. Together they cover four items of `todo.md`: named values, named functions, named ranges, and formula scripts. The plan also adds `ASSERT`, and a reference to a whole table.

The plan describes the code at commit `797a764`. It is a proposal. The decisions in the first table are the author's. Everything under [Proposed design](#proposed-design) and [Open questions](#open-questions) awaits review.

## Progress

Steps 1–7 and step 8's documentation are implemented. Step 7 adds unique whole-table values, column names on table ranges, `QUERY` headings, and scope-aware rewrites for renamed tables and names. The README and help page document ambiguity and qualification. The [monthly budget example](../docs/reference/monthly-budget.json) uses representative October data because `_scratch/google-sheets` is not present in this checkout; its script totals, assertions, and category report are covered by a test.

Step 4 is implemented. `ScriptCard.vue` shows each statement with its value, the browser's engine reads the document's scripts, and completion offers document names, bare and after a script's name. A bare formula such as `ASSERT` has a value for the saved source; a draft source has no live value.

Step 3 is implemented. The server and the file format accept views of kind `script`, `Contents` gives scripts to the engine, and the click path therefore reads names. A script and a table on one page cannot share a name, checked in `checkHolderName` in `apps/server/src/repo/spreadsheets.ts`. Renaming or moving a script, a table, or a page rewrites qualified names such as `Summary!Total`: the parser records them as located references with `qualified` set. Tests are in `apps/server/src/scripts.test.ts` and `packages/engine/src/script.test.ts`. No route was added, so `access.test.ts` and `undo.test.ts` needed no new cases.

Step 2 is implemented in `packages/engine/src/script.ts`, with tests in `script.test.ts`. A script's names come from its source: `ScriptDefinition` carries the source, and `Workbook` reads the names from it.

Step 5 is implemented. `ASSERT` is in `functions/logic.ts`. `Workbook.failedAssertions()` reports failing cells, names, and bare script statements, and `getStatement(scriptId, line)` gives a bare statement's value. The editor header shows the count and opens `AssertionsPanel.vue`.

Step 6 is implemented. A plain table lists its names in `tables.names` (migration 0011), and `PUT /tables/:tableId/names` replaces the list. The names are rewritten with the other formulas a table holds (`nameFormulasAfterRename`, `nameFormulasAfterMove`, `nameFormulasAfterEdit` in `columns.ts`), written through `ContentWriter`, and saved in the file format. `NamesPanel.vue` lists them on a table's block, and "Name this range…" in the cell menu starts one from the selection.

Step 1 is implemented in `packages/engine`: `scope.ts`, `names.ts`, and the name records in `workbook.ts`, with tests in `names.test.ts`. One gap remains:

- `CHECKBOX` and `DROPDOWN` do not accept a name as the cell they write to. `EXECUTE`, `APPEND_ROW`, `CLEAR`, and the data actions do.

## Decisions made

| Question              | Decision                                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Model                 | Tables and scripts both expose names that hold values. A table also has cells, and a data table has columns.                        |
| Scope of a bare name  | The whole document.                                                                                                                 |
| Ambiguity             | A bare word with more than one meaning is `#NAME?`. No meaning wins by being nearer.                                                |
| Qualified name        | `Summary!WithTax(A2)` names the table or script that holds the name. It always works, and it is how a duplicate name is told apart. |
| Function definitions  | `WithTax(amount) = amount * (1 + TaxRate)` is accepted, and means the same as `WithTax = LAMBDA(amount, ...)`.                      |
| Whole-table reference | The bare table name: `QUERY(Sales, "...")`. On another page, `Page!Sales`.                                                          |
| Quotes                | Single quotes always write an identifier and double quotes always write text, so `'Table 1'` alone is a table or a name.            |
| `ASSERT`              | `ASSERT(condition, [message])`, with a new `#ASSERT!` error and a count in the editor header.                                       |
| Names in tables       | Plain tables only. A data table has none.                                                                                           |
| Dependencies          | The graph holds cells only. A cell that uses a name is recorded as reading what the name reads.                                     |
| Acceptance test       | The monthly budget reference document in `todo.md` is usable with scripts in it.                                                    |
| Hardening             | Multi-user races in script editing are out of scope. See `CLAUDE.md`, Project stage.                                                |

## What it looks like

A script named Summary:

```
// Totals for the sales report
TotalSales  = SUM(Sales[Amount])
NumSales    = COUNTA(Sales[Amount])
AverageSale = TotalSales / NumSales
Prices      = Sales!B2:B
WithTax(amount) = amount * (1 + TaxRate)

ASSERT(TotalSales >= 0, "Sales cannot be negative")
```

A plain table named Settings defines the name `TaxRate` for its cell B2.

A cell anywhere in the document reads `=AverageSale` or `=Summary!AverageSale`, reads `=TaxRate` or `=Settings!TaxRate`, and calls `=WithTax(A2)` or `=Summary!WithTax(A2)`.

## Baseline

Each claim was checked by reading the file named.

- **The parser already has bare names.** A word that is not a cell address parses to a `name` node, and `WORD(...)` to a `call` node (`packages/engine/src/parser.ts`, `identifier`). `compute` in `evaluate.ts` looks a `name` up in `context.names` and fails with `#NAME?` when it is missing. `call` looks in `context.names` before the function registry.
- **Single quotes are already identifiers.** The tokenizer makes a `quotedName` token from single quotes and a `string` token from double quotes (`tokenizer.ts`). The parser accepts a `quotedName` only before `!` or `[`.
- **A word after `!` must be a cell, a range, or a table.** `qualifiedReference` in `parser.ts` reads `Table!A1`, `Page!Table!A1`, and `Page!Table[Column]`. `Summary!AverageSale` is a syntax error today.
- **Any expression can be called.** The parser wraps a primary followed by `(` in an `apply` node.
- **A view is a stored source with rewriting and undo.** The `views` table holds `kind` (`chart` or `text`), `name`, `position`, and `source`. `views.ts` in the engine rewrites sources on renames, moves, and structural edits. `updateView`, `moveView`, `createView`, and `deleteView` in `apps/server/src/repo/spreadsheets.ts` run through `changeView`, and `undo.test.ts` has cases for them.
- **A formula column is a formula held by a table.** `columns.ts` rewrites those formulas on renames, moves, and structural edits, with the table as the place they are written.
- **The dependency graph holds cells only.** `DependencyIndex` in `graph.ts` maps a cell to the ranges it reads. `evaluationOrder` marks a cell that reads itself as cyclic.
- **View names are not unique.** `pages_name` and `tables_name` are unique indexes on `lower(name)`. `views` has none.
- **A lambda keeps its defining context.** `LambdaValue` in `values.ts` holds `context`, so a function resolves its references where it was written.
- **The click path builds the same workbook.** `runCell` in `apps/server/src/actions/run.ts` calls `createWorkbook(contents.data)`, and `contents.data` includes the views.

## Proposed design

### Names and what holds them

A name is an identifier and a formula. A table or a script holds it, and the name's formula is written there:

- In a table, a reference without a table name means that table, as in a formula column. `TaxRate = B2` names a cell of the table that holds it.
- In a script, a formula is written on a page and not in a table, as in a text view. It names the table of every cell it reads.

A name's value is whatever its formula evaluates to: a single value, a range, or a function. A name is not a cell, so a range held by a name does not spill and needs no change to how cells hold values.

A name whose formula is one reference is an alias for that reference. It can be written wherever a reference is required, such as the target of `EXECUTE`. This is what a named range is.

The engine's `WorkbookStructure` gains a list of names, each with the id of what holds it, the identifier, and the formula. The engine does not otherwise distinguish a name in a table from a name in a script.

A name matches `[A-Za-z_][A-Za-z0-9_]*`, or is written in single quotes. A name is refused when it reads as a cell address (`AB12`), is `TRUE` or `FALSE`, or is a built-in function. Within one table or script a name is unique, and in a data table it cannot equal a column name.

### Scripts

A script is stored as a view with `kind: "script"`, and its `source` is the script text. Storage, the access checks, the undo journal, versions, the file format, block ordering, and moving between pages then apply to scripts with one new enum value each. `rewriteSource` in `views.ts` gets a branch that rewrites the references of each statement, as `rewriteTemplate` does for a text view.

The syntax:

- A statement is `Name = formula`, `Name(parameter, ...) = formula`, or a bare formula. A bare formula is for `ASSERT`.
- A statement starts on a line with no indentation. Indented lines continue the statement above, so a long formula can wrap.
- `//` starts a comment that runs to the end of the line, outside a string.
- A statement with an error shows the error on its line. The other statements still compute.

### Names in tables

A plain table record gains a list of names, each an identifier and a formula. A data table has none: its rows can be sorted and filtered for display while `B2` stays positional, so a named cell could appear to point at the wrong row, and its columns already have names. Naming a table's columns is refused while it has names. `DECISIONS.md` records this, and step 6 adds a comment on the list in `structure.ts`. They are kept the way column formulas are: rewritten in the same transaction as a rename, a move, or a row or column edit, and written through `ContentWriter` so undo records them. The file format gains the same list on a table.

The first way to define one is to select a range and choose "Name this range", which writes the name with the selection's address as its formula. A table's names are listed in a panel on its block, where each can be renamed, edited, or removed.

### How a name is written in a formula

| Written                 | Means                                                                         |
| ----------------------- | ----------------------------------------------------------------------------- |
| `TaxRate`               | The one name `TaxRate` in the document                                        |
| `Settings!TaxRate`      | The name `TaxRate` held by the table or script Settings on the formula's page |
| `Page!Settings!TaxRate` | The same, on another page                                                     |
| `WithTax(A2)`           | A call of the function the name holds                                         |
| `Summary!WithTax(A2)`   | The same, qualified                                                           |
| `Sales`                 | Every row of the table Sales on the formula's page                            |
| `Page!Sales`            | Every row of the table Sales on another page                                  |
| `'Table 1'`             | A name or a table, as the bare word would be                                  |

A bare word bound by `LET` or `LAMBDA`, or by `let` and `for` in a text view, means that binding. Any other bare word has these candidate meanings:

- every name of that spelling in the document, whatever holds it
- every table of that spelling in the document

One candidate is the meaning. A table found this way can be on any page, so `SUM(Sales)` works throughout a document that has one table named Sales. `Sales!A1` keeps its meaning of the table on the formula's page. More than one candidate makes the word `#NAME?`, with a message that lists the candidates and shows the qualified form of each. No candidate wins by being nearer: a name in the formula's own script does not beat the same name in another script, and a name does not beat a table. A script that reuses a name from elsewhere in the document therefore shows errors until its uses are qualified.

`A!B`, where `B` is not a cell or a range, has two readings: the name `B` held by `A` on the formula's page, and the table `B` on the page `A`. When both exist it is `#NAME?`. `Page!A!B` then writes the name. The table has no unambiguous form until `Sales[#All]` exists.

The parser records qualified names as located references. A rename of a table, script, or page rewrites them with the existing rename rewrite.

The parser records bare words with their positions. `nameNodesOf` in `scope.ts` reports the words not bound by `LET` or `LAMBDA`; text views also pass in names their `let` and `for` tags bound. Two things use the walk:

- `referencesOf` uses it so a cell depends on a name only where it reads the name.
- Renames use it so a table or name rename changes a bare `Sales` but leaves alone a `Sales` that `LET` bound.

### Names and tables share one namespace on a page

A script and a table on one page cannot share a name, because `Settings!TaxRate` must mean one of them. The repository checks this under the spreadsheet lock when a table or a view is created, renamed, or moved. No index can enforce it, because the names are in two database tables. Chart and text view names stay free.

A name and a table can be spelled the same. Each bare use is then `#NAME?`, as above. Creating or renaming either one is not refused, so a table rename cannot fail because of a name elsewhere in the document.

### Evaluation and dependencies

A name is evaluated on demand, in the context of what holds it, and its value is kept until a cell changes.

The dependency graph does not learn about names. A cell that uses a name is recorded as reading everything the name's formula reads, followed through names that use other names. A change to `Sales!B5` then recalculates every cell that uses `TotalSales` or `AverageSale`, by the graph as it is. A cell that a name reads and that uses the name reads itself, which `evaluationOrder` already reports as `#CYCLE!`. A cycle among names alone is found when the names are resolved.

This choice is inside `Workbook`. Making names nodes of the graph later would change nothing outside it. That would be the reason to revisit: many cells reading one name that reads many ranges, where filing the ranges under each cell costs more than one node would.

### A reference to a whole table

`Sales` alone means the rows of the table Sales. For a data table, the value is its stored rows and carries the column names. `QUERY` uses carried names as headers, which also resolves the item "`QUERY` doesn't show col names" for `Sales!A:C`. For a plain table, the value is the whole grid.

Excel's `Sales[#Data]` and `Sales[#Headers]` are a separate item in `todo.md`.

### ASSERT

`ASSERT(condition, [message])` is a pure function. It returns `TRUE`, or fails with the error code `#ASSERT!` and the message. It works in a cell, in a name, and as a bare statement in a script.

`Workbook` reports the cells, names, and script statements whose value is `#ASSERT!`. The editor header shows the count when it is not zero, and opens a list where each entry goes to its cell or script. A bare statement is identified by its script and line.

### The web app

A `ScriptCard` shows the source and, beside each statement, its value or error. A range shows its size. A function shows its parameters. The editor is a plain text area until the shared formula editor of the formula editing theme exists. `FormulaAssist` offers names and table names.

## Steps

Each step ends with `pnpm check` passing.

1. **Engine: names.** Names in `WorkbookStructure`, the lookup of bare and qualified names, on-demand evaluation with a kept value, the walk that finds unbound bare words, dependencies through names, ambiguous and refused names, and aliases as references. The parser's qualified name and the bare quoted name.
2. **Engine: scripts.** Parse a script into statements, including the function form. Rewrite script sources in `views.ts`.
3. **Server and shared: scripts.** Accept `kind: "script"`. Check script and table names against each other. Rewrite qualified names when a script is renamed or moved. Pass names to the workbook on the click path. Add cases to `access.test.ts` and `undo.test.ts` for what is new.
4. **Web: the script block.** `ScriptCard`, an "Add script" button, values beside statements, and completion of names.
5. **ASSERT.** The function, its entry in `docs.ts`, the `#ASSERT!` code, the report from `Workbook`, and the header indicator.
6. **Names in tables.** The list on the table record with its migration, rewriting and undo, the file format, "Name this range", and the names panel.
7. **Whole-table references.** The bare table name, column names carried on a range, `QUERY` headers from them, and rewriting of bare words on a rename of a table or a name.
8. **Documentation and the reference document.** README and help page sections. Both state that an ambiguous name is an error and recommend distinct names or the qualified form, with `February!Total` and `March!Total` as the example. Build the monthly budget and record what gets in the way in `todo.md`.

The planned order grouped script support in steps 1–5, named ranges in step 6, and whole-table references with data-table work in step 7. Bare-word rewriting also supports a future "rename this name" command and can be implemented after step 2.

## Open questions

1. **Struct values.** `todo.md` has a note on cells that hold structs, arrays, and nested tables. A script read as a whole (`Summary`) could then be a struct of its names, and `Summary!Name` a field of it. Nothing here builds that, and nothing here prevents it.

## Remaining gaps

- `CHECKBOX` and `DROPDOWN` do not accept a name as their target cell; `EXECUTE` and the data actions do.
- A bare formula such as `ASSERT` shows a value for the saved script source, not while a draft is being typed.
- The reference budget example could not be based on `_scratch/google-sheets`, because that directory is absent from this checkout.
