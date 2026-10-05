# Raw JSON authoring details

The current schema is [packages/shared/src/index.ts](../../../../packages/shared/src/index.ts). Read it before using an unfamiliar field. The file format uses names and positions; the API snapshot uses generated IDs and is a different representation.

## Document and block structure

```json
{
  "format": "spreadsheet-app",
  "version": 1,
  "name": "Document title",
  "pages": [
    {
      "name": "Overview",
      "blocks": [
        {
          "type": "text",
          "name": "Introduction",
          "source": "# Document title\n\nA useful opening explanation."
        },
        {
          "type": "table",
          "name": "Settings",
          "rowCount": 2,
          "colCount": 2,
          "names": [{ "name": "BudgetLimit", "formula": "=B1" }],
          "cells": [
            { "row": 0, "col": 0, "input": "Budget" },
            { "row": 0, "col": 1, "input": "500" }
          ]
        },
        {
          "type": "script",
          "name": "Rules",
          "source": "Double(amount) = amount * 2\nASSERT(BudgetLimit >= 0, \"Budget must be nonnegative\")"
        }
      ]
    }
  ]
}
```

Pages and blocks are ordered by their array positions. Do not supply IDs. Block types are `table`, `chart`, `text`, and `script`; a script is a block even where older prose lists only three types.

Names must be unique ignoring case within the scopes the importer checks. Give blocks descriptive distinct names. Bare formula names and whole-table references must have one meaning across the document; otherwise qualify them.

## Cells and dimensions

- `cells` is a sparse array of `{row, col, input}`. Coordinates are zero-based; formula addresses are one-based. File `{row: 0, col: 1}` is B1.
- Every `input` is a string, including `"12.5"`, `"TRUE"`, `"2026-10-04"`, and `"=SUM(A1:A3)"`. Omit empty cells unless a particular operation needs an explicit empty input.
- A leading `=` makes a cell formula. A leading apostrophe forces literal text. A text-typed column preserves text such as `007`.
- `rowCount` and `colCount` describe the table, not the number of sparse entries. Entries must fit its dimensions and positions must not be duplicated.
- Plain tables require at least one row. Data tables can have zero rows. A data table's row 1 is its first record; column names are not stored as a header row.
- A data table's `rowCount` should include actual records, not blank padding for future entry. Cleared stored rows still exist and open-ended appends go after them.
- Use plain tables with spare space for spilled arrays. Write only the spill anchor formula, never the calculated spill cells.

Current limits: 50 pages, 50 blocks per page, 1,000 rows and 100 columns per table, 100,000 stored rows and filled cells per document, 8,192 characters per cell input, 50,000 characters per view source, and a 32 MiB import body. Read the constants if these change.

## Named columns

Supplying `columns` makes a data table. Supply one definition per column:

```json
[
  { "name": "Item", "type": "text" },
  { "name": "Quantity", "type": "number" },
  { "name": "Purchased", "type": "date" },
  { "name": "Paid", "type": "checkbox" },
  { "name": "Status", "type": "choice", "choices": ["Draft", "Confirmed", "Done"] },
  {
    "name": "Customer",
    "type": "choice",
    "choicesFrom": { "page": "Records", "table": "Customers", "column": "Name" }
  },
  { "name": "Total", "type": "formula", "formula": "=[Quantity] * [Unit price]" },
  { "name": "Unit price", "type": "number" }
]
```

The type is `choice`, not `dropdown`. Other types are `any`, `text`, `number`, `date`, `checkbox`, and `formula`. For choices use either `choices` or `choicesFrom`. A choice source must identify an existing data-table column. A formula definition includes its leading `=`. Do not include stored cells in formula columns.

Only plain tables hold `names: [{name, formula}]`. Script definitions omit a leading `=` and are separated by actual newline characters in the decoded JSON string.

## References and formula sources

| Reference                  | Meaning                                                                   |
| -------------------------- | ------------------------------------------------------------------------- |
| `A1`, `$B$2`, `A1:C9`      | Positions in the current table. Absolute markers control copied formulas. |
| `[Unit price]`             | A named-column cell in the current data-table row.                        |
| `Orders[Total]`            | Every stored row of the named column.                                     |
| `Orders`                   | All rows of the uniquely named table.                                     |
| `Orders!A1`                | A table on the current page.                                              |
| `'Records'!Orders!A1`      | A positional reference on another page.                                   |
| `'Records'!Orders[Total]`  | A named column on another page.                                           |
| `Rules!TotalDue`           | A named formula held by a table or script.                                |
| `'Records'!Rules!TotalDue` | A named formula qualified by page and holder.                             |

Quote names containing spaces with single quotes; double an apostrophe inside a quoted name. Avoid identifiers that look like cell addresses. Unique whole-table names and structured references can resolve across pages; explicit positional cross-page references need the page.

Whole-column positional arithmetic can select the formula's own row. Use an explicitly bounded/open range such as `A1:A` or range-consuming functions when computing an array. Scalar functions such as IF do not automatically map over arrays; use MAP or formula columns.

Chart blocks contain `type`, `name`, `source`, and `chartType` (`bar`, `line`, `pie`, `scatter`). Their source is a formula expression; existing samples use expressions without a leading `=`. The first column supplies labels or scatter x-values; remaining columns supply series. Text headers can name series.

Text blocks use `source` containing Markdown and template tags. Expressions inside tags have no leading `=`:

```text
{% let total = SUM(Orders[Total]) %}
Outstanding: **{{ TEXT(total, "$#,##0.00") }}**.
{% if total > BudgetLimit %}Review the budget before confirming.{% end %}
{% for item, amount in DROP(QUERY(Orders, "select Item, sum(Total) group by Item"), 1) %}
- {{ item }}: {{ TEXT(amount, "$#,##0.00") }}
{% end %}
{{ BAR_CHART(HSTACK(Orders[Item], Orders[Total]), "Orders") }}
```

An array expression renders as a table; chart values render as charts. QUERY returns a result header for named data tables, including when its third argument is `0`. That argument controls input header rows. Remove the result header with DROP when a loop should iterate only data rows. Verify the current QUERY semantics in docs.ts when combining it with other arrays. HTML is not a supported text-view layout mechanism.

## Controls and actions in cell inputs

```text
=DROPDOWN('Records'!Customers[Name], B2)
=CHECKBOX(B3, "Include completed")
=BUTTON("Save", DO(APPEND_ROW('Records'!Log!A:C, NOW(), B2, B4), CLEAR(B2), CLEAR(B4)))
=BUTTON("Snapshot", EXECUTE(SUM(Orders[Total]), B5))
=BUTTON("Rebuild", OVERWRITE(Rules!GeneratedRows, 'Records'!Generated!A:C))
```

Controls live in cells distinct from their target input cells. Formulas read the target value, not the control value. Native choice and checkbox columns do not require separate bound controls.

APPEND_ROW takes a range then scalar values; INSERT, UPDATE, and OVERWRITE take data then a range. UPDATE key columns are one-based within that data/range; multiple keys use a vector such as VSTACK(1, 2). Open-ended destinations in data tables append after the last stored row. CLEAR clears cells without deleting stored rows. OVERWRITE can delete surplus rows when it covers all writable columns.

Targets must exclude formula columns. Keep writable columns contiguous when that simplifies bulk actions. Do not assume the engine can update a computed field or automatically join tables inside QUERY; use lookups or constructed arrays for related data.

Guard incomplete forms explicitly, for example show instructions with IF until required values are present, then show the BUTTON. A diagnostic can plan a visible button without executing it, so avoid an initially invalid button in an otherwise healthy sample. Actions all read the pre-click state; if a button increments a counter and appends its new value, both expressions must use the old value plus one.

## Formats, conditional rules, and grid sizes

Ranges use zero-based inclusive starts and ends. `null` ends extend to the current edge and follow table growth. A whole-column format example:

```json
{
  "startRow": 0,
  "endRow": null,
  "startCol": 3,
  "endCol": 3,
  "format": { "numberFormat": "$#,##0.00", "align": "right" }
}
```

Put such entries in `formats`. Supported style fields are `bold`, `italic`, `align` (`left`, `center`, `right`), `color`, `fill`, and `numberFormat`. Colors are the named palette: red, orange, yellow, green, blue, purple, gray. Use supported TEXT number formats.

Put conditional entries in `conditionalFormats`, with the same positional range fields. Either use `kind: "criterion"`, a COUNTIF-style `criterion`, and `format`, or `kind: "scale"`, `low`, and `high` palette colors. Earlier rules win. Rules test each formatted cell's own value; they do not accept arbitrary spreadsheet formulas.

```json
{
  "startRow": 0,
  "endRow": null,
  "startCol": 4,
  "endCol": 4,
  "kind": "criterion",
  "criterion": "Overdue",
  "format": { "fill": "red", "bold": true }
}
```

Optional `gridSizes` has `rows` and `columns` arrays of `{index, size}`. Row heights are 30–500 pixels; column widths are 40–1,000. Entries must identify distinct existing positions.

## Saved display order

A data table can have:

```json
{
  "display": {
    "sort": [{ "column": 2, "descending": false }],
    "filter": "=[Status] <> \"Done\""
  }
}
```

Sort columns are zero-based file positions. Include `sort: []` if saving only a filter. Display settings do not change stored rows or what ordinary aggregate formulas read.
