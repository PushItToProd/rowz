# Decisions

Decisions the author made or approved. Each entry says what was decided, why, and what would reopen it. Newest first. Choices agents made on their own are in [AGENT_DECISIONS.md](AGENT_DECISIONS.md).

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
