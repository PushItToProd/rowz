# Function suite design review

Date: 2026-10-04.

Status: findings and recommendations for author review. This document does not authorize implementation or record every recommendation as an approved decision. In subsequent discussion, the author endorsed table query pipelines for conditional aggregation, proposed explicit `@` for positional intersection, and favored matching dimensions for collection arithmetic. The author also proposed collections stored in one cell with explicit expansion. Detailed semantics and syntax remain proposals; the unresolved choices below distinguish author suggestions from review recommendations.

## Assessment and scope

Rowz has enough functions to be useful. Its biggest design weakness is that expressions do not compose predictably. Individually reasonable spreadsheet conventions interact in ways that let ordinary refactoring change results, discard data, or conceal errors.

Prioritize coherent language rules over expanding the function catalog. Preserve familiarity when it helps a spreadsheet user predict behavior. Change familiar conventions when they make formulas unnecessarily difficult to read or reason about. Compatibility with Excel, Sheets, or Rows.com is not a requirement by itself.

This review covers the function implementations, evaluator, help entries, relevant tests, and decision records. Small executable examples confirmed several surprising behaviors. At review time, `pnpm check` passed with 3,251 tests passed and two skipped. Passing tests establish the implemented behavior; several findings concern behavior the tests intentionally preserve.

Examples in the findings describe current behavior unless labeled as proposals. Pipeline, intersection, and collection-display examples describe unimplemented syntax. [formula-language-proposal.md](formula-language-proposal.md) provides the broader language draft; this review identifies revisions to consider alongside it.

## Things to preserve

- **Actions are values, and recalculation does not execute them.** This is a good replacement for macros. Selecting an action with `IF` is a natural consequence of the model.
- **Named columns, formula columns, named functions, and scripts.** These provide a path from exploratory spreadsheet work to readable programs without requiring users to abandon the spreadsheet.
- **Lazy `IF`, `IFS`, and `SWITCH`.** Users can guard computations without evaluating unused branches.
- **Exact matching by default in `XLOOKUP`.** Returning several cells and evaluating a fallback only when needed are also useful behaviors.
- **Dates are distinct values.** `MIN` and `MAX` preserve date results and reject mixtures of dates and numbers.
- **`ASSERT` and visible errors.** These support trustworthy calculations and deserve consistent error propagation throughout the function suite.
- **A pure engine shared by client and server.** Language improvements should preserve explicit effect planning and keep I/O outside formula evaluation.

## Flaws to address and recommendations

### 1. Whole-column references make refactoring unsafe

With `A1:A3` containing `1, 2, 3` and `B1:B3` containing `10, 20, 30`, these formulas in row 2 produce:

```text
SUM(A:A * B:B)                   → 40
SUMPRODUCT(A:A, B:B)             → 140
LET(vals, A:A, SUM(vals * B1:B3)) → 140
```

A whole column written directly as an operator operand means the current row's cell. A range with an explicit starting row, or a variable holding the column, means an array. Outside a cell, whole-column multiplication operates on every row. These are intentional, tested behaviors in [evaluate.ts](../packages/engine/src/evaluate.ts) and [intersection.test.ts](../packages/engine/src/intersection.test.ts).

Extracting an expression into `LET`, moving it into a script, or replacing `SUMPRODUCT` with multiplication and `SUM` can change the answer. Structured whole-column references such as `Sales[Region]` have the same concern when used directly as operands inside a cell.

**Recommendation, incorporating the author's proposal:** `A:A`, `1:1`, and `Sales[Amount]` should always return collection values. Require explicit `@` for positional intersection:

```text
A:A * B:B       // proposed: elementwise products of the columns
SUM(A:A * B:B)  // proposed: sum of those products
@A:A + @B:B     // proposed: add the two cells in the current row
```

Retain `[Price]` as explicit current-record access; requiring `@[Price]` would add punctuation without clarifying its meaning. Inside pipelines, bare field names follow the stage's row or group scope.

For matching numeric columns, multiplication should agree with `MAP(A:A, B:B, LAMBDA(left, right, left * right))`. `SUM(A:A * B:B)` should agree with `SUMPRODUCT(A:A, B:B)` only after their text and error contracts are aligned; changing reference interpretation alone does not establish that equivalence.

`@` must remain predictable through variables and functions. Proposed expressions such as `@A:A` and `LET(values, A:A, @values)` should agree. Restricting `@` to direct reference syntax would recreate the refactoring problem.

Specify positional intersection before implementation:

- A single-cell reference returns its value.
- A single-column reference selects the formula's stored row position.
- A single-row reference selects the formula's stored column position.
- A proposed rule for a two-dimensional reference is selection at both stored positions. This needs confirmation; reject ambiguous cases instead of guessing.
- A missing corresponding position produces an error. Cross-table intersection uses positions, not matching record identities or keys.
- Calculated collections such as `FILTER(...)` and `SEQUENCE(...)` have no inherent workbook position. Reject `@` unless meaningful reference information survives; do not substitute their first element. Use indexing for extraction.
- Scripts, chart sources, and text views generally have no cell position. Positional intersection there should fail clearly unless an explicit position is supplied.
- Functions containing `@` need a specified origin. Retaining the defining reference context is consistent with existing closures; caller-relative behavior would require an explicit contract. Portable functions should receive values and use indexing.

The collection model therefore needs to distinguish contents from reference location. A local variable can preserve a reference's location without granting calculated collections writable workbook identities. The exact representation remains open.

Resolve this before promoting compositions such as `FILTER(Sales, Sales[Region] = "West")`. If legacy behavior remains, document it prominently and diagnose suspicious uses in the editor. The language proposal's versioning approach can preserve existing documents while new formulas use consistent rules.

### 2. Operators and equivalent functions disagree about arrays

```text
A1:A3 ^ 2       → three squared values
POWER(A1:A3, 2) → #VALUE!
```

`UPPER`, `ROUND`, `ISNUMBER`, and `IF` generally expect single values. Users must remember which operations require `MAP`, even when the operation is obviously per cell. `IFERROR` accepts an array result but does not replace errors inside it.

Explicit mapping is defensible. The inconsistency with operators is the problem. Operators also broadcast singleton dimensions and put `#N/A` in unmatched positions, while `MAP` rejects incompatible dimensions.

**Recommendation:** specify distinct contracts for per-cell functions, aggregates, collection transformations, reference operations, and actions. Prefer consistent array support for ordinary numeric, text, date, and information functions.

The author favors identical dimensions when two collections participate in an elementwise operation. Reject unequal dimensions as an operation-level error, including a column multiplied by a row; do not infer an outer product or manufacture unmatched output cells. Equal cell counts alone are insufficient. Use the existing `TRANSPOSE` to change orientation explicitly:

```text
A:A * TRANSPOSE(1:1)
TRANSPOSE(A:A) * 1:1
```

Both examples still require matching lengths. Prefer `TRANSPOSE` over the suggested `ROTATE`, which could mean cyclic shifting or a 90-degree rotation with reversed order.

Retaining scalar broadcasting is a review recommendation awaiting confirmation: `A:A * 2` has an unambiguous elementwise interpretation. A scalar is distinct from a one-cell collection; specify whether the latter needs extraction before combining it with a larger collection. Request outer products through a separate explicit operation if needed.

Array conditionals need a deliberate evaluation rule. Do not promise lazy evaluation of individual elements if evaluating a branch expression can fail before it produces an array. The language proposal currently takes a different defensible approach: new expression conditionals require scalar Booleans and use explicit mapping for elementwise selection. Choose between these approaches explicitly; do not implement automatic array behavior independently in each function.

### 3. Higher-order functions silently discard callback results

Confirmed examples:

```text
MAP(SEQUENCE(2), LAMBDA(n, SEQUENCE(1, 3, n * 10)))
→ a column containing 10 and 20

BYROW(SEQUENCE(2, 3), LAMBDA(row, row))
→ a column containing 1 and 4
```

The callback returns several cells, but [arguments.ts](../packages/engine/src/functions/arguments.ts) keeps only the first. The result looks plausible, concealing a callback mistake.

**Recommendation:** require one cell per callback result and reject larger results. Use explicit `INDEX(result, 1, 1)` for intentional extraction. Add a separate operation for callbacks that expand into collections if needed. Future mapping over lists may support nested values, but it should preserve those values without silently truncating them.

Collections contained in one cell must be distinguished from callbacks that accidentally return several output cells. Once nested values exist, a callback may intentionally return a collection as one value. Preserve that nested value under the new API's contract; do not turn it into its first element.

### 4. Coercion depends too much on argument packaging

Ignoring headings and blank cells in numeric aggregates is useful. Applying the same collection strategy to logical aggregates creates surprising results. With `A1:A3` containing `1, 0, 3`:

```text
AND(A1, A2, A3) → FALSE
AND(A1:A3)      → TRUE
```

Direct numeric arguments convert to Booleans. Numeric cells inside ranges are ignored. With no Boolean cells left, `AND` returns true. The rule comes from the shared collection helpers in [arguments.ts](../packages/engine/src/functions/arguments.ts).

**Recommendation:** logical aggregates should convert relevant cells consistently or require Boolean inputs consistently. At minimum, a nonempty numeric range should not silently become an empty Boolean collection. Preserve useful numeric aggregate handling of headings as an aggregate-specific rule.

The proposal's strict Boolean operators and `ALL`/`ANY` provide a cleaner new API. Empty Boolean collections can have the conventional identities, true for `ALL` and false for `ANY`, without treating a collection of incompatible values as empty.

### 5. Error handling conflicts with the error-visibility principle

| Operation                            | Current treatment of errors inside input |
| ------------------------------------ | ---------------------------------------- |
| `SUM`                                | Propagates the error                     |
| `SUMPRODUCT`                         | Treats the error as zero                 |
| `SUMIF` and related aggregates       | Ignore errors in selected result cells   |
| Correlation and regression functions | Skip pairs containing errors             |
| `IFERROR`                            | Leaves errors inside an array unchanged  |
| `COUNTIF(range, "<>x")`              | Can count error cells as matches         |

`SUMPRODUCT` over `[-1, #DIV/0!, 1]` returns zero. Inequality criteria can match errors despite the criterion implementation's comment that errors match nothing. See [math.ts](../packages/engine/src/functions/math.ts), [conditional.ts](../packages/engine/src/functions/conditional.ts), [statistics.ts](../packages/engine/src/functions/statistics.ts), and [criteria.ts](../packages/engine/src/functions/criteria.ts).

A visible error elsewhere in the document does not make a derived total trustworthy.

**Recommendation:** propagate errors in values that contribute to calculations. Conditional aggregates should propagate errors in selected result cells; errors in excluded result cells need not contribute. Define predicate-error behavior explicitly. Counting functions may classify or count errors, but their contracts must say so. Make array error recovery consistent with the chosen array evaluation model.

The pipeline proposal's rule that predicate failures fail the query with row and stage context supports this direction. Aggregation through ordinary functions should retain those functions' error rules.

### 6. Empty results are not consistently ordinary values

Rowz supports empty data tables, but collection operations disagree about emptiness:

- `SORT`, `UNIQUE`, and `MAP` can return empty arrays.
- `FILTER` with no matches returns `#N/A`.
- `DROP` removing everything returns `#N/A`.
- `FLATTEN` over no cells returns `#N/A`.
- `TAKE` and `DROP` reject a zero count.

Width is generally inferred from the first row. With zero rows, the collection loses its column count even when its source table has a known schema. See [arrays.ts](../packages/engine/src/functions/arrays.ts).

Reusable functions then need error handling for ordinary cases such as no matching orders.

**Recommendation:** represent empty collections with retained dimensions and column metadata. Transformations should preserve them. Distinguish an empty collection from a failed scalar lookup. `DROP(data, 0)` should return the input.

Selection should not decide every subsequent aggregate's result. Over no selected rows, `SUM` and count operations can return zero, while `AVERAGE` reports that there are no numbers to average.

For pipelines, retain the proposal's distinction: an ungrouped `summarize` over empty input produces one row using each function's empty-input contract; grouped summarization produces zero rows with a known output schema.

### 7. Column names disappear through ordinary transformations

A data-table range carries column names, allowing:

```text
QUERY(Sales, "select Category, sum(Amount) group by Category")
```

But `FILTER`, `SORT`, `TAKE`, and other transformations construct arrays without retaining those names. Queries over transformed data can lose named-column access.

`QUERY` also mixes headings with data. It consumes explicit or inferred header rows and sometimes emits headings as an ordinary first row. Header inference depends on the types present in the data. See [query.ts](../packages/engine/src/functions/query.ts).

**Recommendation:** preserve column metadata through row transformations. Define how projection and stacking transform names. Keep headings in metadata and provide an explicit display conversion when headings need to appear as cells.

The pipeline proposal already makes tables schema-bearing values and separates header display from table data. That is the right foundation for composable queries.

### 8. Actions need stronger composition semantics

Local bindings disappear from deferred actions:

```text
BUTTON("Save", LET(amount, 42, EXECUTE(amount, C1)))
```

The button is constructed, but action planning fails with `Unknown name 'amount'`. Returning an action from `LAMBDA` has the same problem. Actions retain syntax and origin, but not lexical bindings. See [evaluate.ts](../packages/engine/src/evaluate.ts) and [workbook.ts](../packages/engine/src/workbook.ts).

Append operations also collide:

```text
DO(APPEND_ROW(D:E, 1, 2), APPEND_ROW(D:E, 3, 4))
```

Both operations plan writes to the same destination row, so the later write replaces the earlier one.

The documented snapshot reads of `DO` are useful for swapping cells and saving inputs before clearing them. Appending several rows still requires coordinated destination allocation.

**Recommendation:** preserve lexical bindings in deferred actions while resolving workbook reads at execution time. Specify capture behavior for both values and deferred expressions. Coordinate append destinations and define conflicting-write behavior across combined actions. Snapshot reads and coordinated append placement can coexist.

Action names and data handling also need attention:

- `EXECUTE` writes values. `WRITE` describes that operation more clearly.
- `INSERT` appends. `APPEND` describes its behavior more clearly.
- `UPDATE` inserts unmatched keys as well as updating matches. `UPSERT` communicates that behavior.
- `OVERWRITE` can delete surplus data-table rows. Make that consequence explicit in the API and help.
- Bulk data actions remove completely empty input rows. Preserving or discarding those rows should be a documented choice.

See [actions.ts](../packages/engine/src/functions/actions.ts). The language proposal's deferred lexical environments should address composition before action-producing libraries are added.

### 9. Lookup defaults and inference need simplification

`XLOOKUP` is the strongest lookup design in the suite and should be the normal lookup presented in help and completion.

`MATCH`, `VLOOKUP`, and `HLOOKUP` default to approximate matching. A forgotten argument can return a plausible incorrect result. `MATCH` accepts numeric modes outside its documented set.

Two-dimensional `LOOKUP` chooses its search direction based on whether the input is wider or taller. Adding a row can change how the same range is interpreted. See [lookup.ts](../packages/engine/src/functions/lookup.ts).

**Recommendation:** use exact matching as the default in a new canonical API and request approximate matching explicitly. Validate modes. Avoid inferring lookup direction from aspect ratio.

`XYLOOKUP` is a useful convenience. An API accepting separate row-key and column-key vectors would support layouts without requiring a header row and header column around the result cells.

### 10. Related functions have unnecessary argument-order exceptions

One universal argument order is unnecessary. Constructors, searches, and transformations have different natural reading orders. Consistency within related operations is more valuable.

| Family                 | Current inconsistency                                                       | Recommendation                                                                                |
| ---------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Conditional aggregates | `SUMIF` puts the result range last; `SUMIFS` puts it first                  | Prefer selection followed by ordinary aggregation; avoid another canonical conditional family |
| Higher-order functions | `MAP` and `BYROW` start with data; `REDUCE` starts with the accumulator     | Consider `REDUCE(data, initial, function)` for the new API                                    |
| Writes                 | `APPEND_ROW` starts with destination; bulk writes start with data           | Pick a consistent mutation convention                                                         |
| Controls               | `CHECKBOX` starts with target; `DROPDOWN` ends with target                  | Prefer target first consistently                                                              |
| Date differences       | `DAYS(end, start)` reverses the order used by `DATEDIF` and `YEARFRAC`      | Prefer start, end consistently                                                                |
| Text positions         | `MID` and `FIND` use one-based positions; `SLICE` uses zero-based positions | Prefer one convention in the new API                                                          |

Boolean and numeric mode arguments also vary. `SORT` accepts a Boolean plus a special numeric `-1`. Financial payment timing treats any nonzero number as beginning-of-period timing.

**Recommendation:** validate documented choices. Add named parameter metadata before accepting named options. Clear option names will make long financial calls easier to read. The proposal's ordinary function pipe can help with composition, but it should not be used to justify confusing signatures.

### 11. Text functions should preserve text

```text
SPLIT("001,02", ",") → numbers 1 and 2
```

`SPLIT` converts numeric-looking pieces before the user asks for conversion, losing leading zeros and preventing reliable split/join round trips. See [text.ts](../packages/engine/src/functions/text.ts).

A dropdown similarly parses a single string as a comma-separated list, even when it comes from a one-cell array. One option named `"a,b"` becomes two choices. See [controls.ts](../packages/engine/src/functions/controls.ts).

**Recommendation:** `SPLIT` should return text. Use `VALUE` for explicit conversion. Dropdowns should consume values; shorthand option-list parsing should be explicit.

Additional inconsistencies:

- `CHAR` and `CODE` use Unicode code points, but `LEN`, `LEFT`, and `MID` use UTF-16 code units. They can count an emoji as two or return half of it. Specify a consistent character model; code points are a practical initial improvement, while grapheme clusters need a separate choice.
- Criteria support `*` and `?` without a way to escape literal occurrences. Add escaping if these criteria remain supported.
- `JOIN`/`TEXTJOIN` and `CONCAT`/`CONCATENATE` need preferred spellings in help and completion. Aliases need not have equal prominence.
- Statistical names mix `STDEVP` with `VAR_P` and `COVARIANCE_P`. Consistent sample/population suffixes would improve discovery.

### 12. Date conversions and intervals need clearer contracts

`TO_DATE` interprets numbers using the 1899-12-30 epoch, while numeric coercion of Rowz dates uses days since 1970. A generic conversion name conceals that difference.

`DATEINTERVAL` returns two endpoint cells. It does not provide interval membership, overlap, or enumeration operations. The `LASTX...` helpers introduce a concept with little supporting functionality.

**Recommendation:** name spreadsheet-serial conversions explicitly and document units and epochs together. Either give intervals supporting operations or present the helpers clearly as endpoint-pair constructors. Distinguish rolling periods from complete calendar weeks and months.

There is also a precision problem: date values can contain milliseconds, but literal formatting omits them. Writing such a date through an action can lose precision. Preserve supported precision through formatting, parsing, and persistence. See [dates.ts](../packages/engine/src/dates.ts) and [functions/dates.ts](../packages/engine/src/functions/dates.ts).

## Conditional aggregation and the pipeline direction

The original review called out missing `AVERAGEIFS`. The subsequent discussion changed that recommendation: extending the conditional aggregate family is not a meaningful functionality priority. Every new aggregate should not require an `${OPERATION}IFS` sibling.

Selection followed by aggregation is already a clearer pattern:

```text
AVERAGE(FILTER(Sales[Amount], Sales[Closed]))
MEDIAN(FILTER(Sales[Amount], Sales[Closed]))
COUNTUNIQUE(FILTER(Sales[Customer], Sales[Closed]))
```

Comparison-based conditions need the whole-column semantics fix described above. Empty results and error propagation also need consistent contracts.

A proposed generic conditional aggregation function should not be named `MAPIFS`: mapping transforms each element, while aggregation combines a collection. First-class built-in functions would let a user define such a convenience in Rowz itself, but the pipeline is the preferred long-term authoring experience.

Proposed syntax:

```text
Sales
  | where Closed
  | summarize
      AvgAmount = AVERAGE(Amount),
      TotalAmount = SUM(Amount),
      MedianAmount = MEDIAN(Amount),
      Orders = ROWS(group)
```

The `ROWS(group)` expression uses the current row-count meaning of `ROWS`. The language proposal also discusses changing `ROWS` into a row-sequence accessor. Resolve that naming conflict before implementation and give row counting a distinct spelling if necessary.

Adding `by Region` applies the same calculations per region. Derived columns make intermediate computations readable:

```text
Sales
  | where Closed
  | derive NetAmount = Amount - Refund
  | summarize
      AvgNet = AVERAGE(NetAmount),
      TotalNet = SUM(NetAmount)
    by Region
  | order by TotalNet desc
```

The strongest rule in the proposal is that aggregation has no special dependence on function spelling. Inside `summarize`, `Amount` is the group's column and `group` is its table. A user-defined `TrimmedMean(Amount)` or `RevenueSummary(group)` should work through ordinary invocation. Do not rebuild the conditional-aggregate catalog as a hard-coded list of functions recognized by `summarize`.

Preserve schemas and source locations between stages. Offer field completion and previews of intermediate values. Predicate and aggregation failures should identify the stage, expression, and relevant row or group. These features make pipelines useful for debugging as well as authoring.

## Contained collections and explicit display

The author proposed converting ranges into arrays that remain in one cell by default, then explicitly expanding their results. This addresses a separate need from positional intersection: intermediate collections should be usable as values without automatically occupying neighboring cells.

**Recommendation:** distinguish collection contents, dimensions, and display. Containing a collection in one cell should change its presentation, not its arithmetic. Prefer one collection model with explicit conversions and display operations over separate arithmetic rules for contained and spilling values.

The author's illustrative syntax was `{A:A} * {1:1}`. There are two possible interpretations to settle:

- If conversion preserves dimensions, one operand remains a column and the other a row. Multiplication must still fail under the matching-dimensions rule.
- If conversion produces one-dimensional lists, matching-length operands can multiply pairwise. Make that dimensional conversion explicit. Flattening a rectangle also needs a specified traversal order or a separate operation.

An illustrative explicit conversion is:

```text
products = LIST_VALUES(A:A) * LIST_VALUES(1:1)
```

`LIST_VALUES` is a placeholder API name, not an approved function. It illustrates converting both inputs to lists instead of using containment to imply dimensional conversion. Ordinary conversion to a calculated collection may discard reference information, so positional `@` would then be unavailable.

Do not reuse `HSTACK` and `VSTACK` to request display expansion. They already combine collections horizontally and vertically. The initial suggestion also reversed their established directions: `HSTACK` adds columns; `VSTACK` adds rows. Keep stacking independent of spilling.

Possible display APIs, with names and signatures still open:

```text
SPILL_COLUMN(products)
SPILL_ROW(products)

// Alternative using the proposed named-argument syntax:
SPILL(products, direction: "down")
SPILL(products, direction: "across")

// Preserve the dimensions of a rectangle:
SPILL(HSTACK(left, right))
```

Braces already denote records and local binding expressions in the language proposal; `{A:A}` would add another meaning. Brackets also conflict with current-row `[Column]` syntax. Settle the value model before choosing containment notation.

Contained values need inspection, bounded previews, structured-value transport, and defined text/chart behavior. Specify how a consumer reads a collection stored in one cell and how nested collections display. Spilling should preserve dimensions and column metadata and report occupied destinations or insufficient table dimensions through the existing spill-error mechanism. Existing automatic-spill behavior needs an explicit compatibility policy.

## Functionality to add

Prioritize additions that improve composition:

1. **Projection and computed sorting.** Named column selection and sorting by expressions. Pipeline `select` and `order by` can provide the main authoring syntax; `CHOOSECOLS` and `SORTBY` are possible function conveniences.
2. **Running computations.** `SCAN` or equivalent support for running totals, balances, and cumulative state. Window operations need explicit ordering rules.
3. **Text processing.** Regular-expression matching, extraction, and replacement; literal substring predicates; text-before/text-after helpers. These address common data-cleaning work.
4. **Named data operations.** Pipeline filtering, derivation, grouping, and ordering first; joins and column-aware updates afterward. `QUERY` already provides substantial capability, but strings make parameterization, completion, and refactoring harder.
5. **Reusable function ergonomics.** Built-ins usable as values, parameter help for user-defined functions, and argument-specific errors. For example, `BYROW(data, SUM)` should be expressible under a clear collection contract.
6. **Formula checking.** Collection-aware assertions and explicit approximate numeric comparison. Assertions should support reusable checks without requiring users to encode floating-point tolerance repeatedly.
7. **Interval operations if intervals remain a language concept.** Membership, overlap, endpoint access, and explicit enumeration would make the date helpers composable.
8. **Contained collection values and explicit spilling.** Support intermediate arrays in one cell, inspection, explicit dimensional conversion, and display expansion without repurposing stacking functions.

Do not prioritize `AVERAGEIFS` or similar catalog completion. Additional specialized mathematical functions rank below these capabilities unless a concrete use case calls for them.

## Documentation and developer ergonomics

Each function's help should document accepted types, collection behavior, empty-input behavior, error propagation, comparison rules, argument defaults, and units where applicable. A successful example alone does not establish these contracts.

Prefer argument-specific diagnostics over `Expected a single value`: identify the function, parameter, received type or dimensions, and a useful correction. Function call frames and pipeline stage locations should survive evaluation.

Help and completion should present canonical spellings first and identify aliases. User-defined functions should receive the same signature assistance as built-ins. Pipeline completion should know the incoming schema, and inspection should show intermediate values without executing actions.

## Priorities

The author sets implementation priorities. The ordering below reflects ordinary single-user failures and choices that affect later language work.

### First: fix concealed errors and lost data

- Preserve lexical bindings in deferred actions.
- Coordinate append destinations within `DO` and specify conflicting writes.
- Reject silently truncated callback results.
- Propagate contributing errors through aggregates and correct criterion handling of errors.
- Preserve text through `SPLIT` and date precision through action writes.

These are correctness problems independent of whether the pipeline proposal is implemented.

### Second: settle foundational semantics

- Make whole-column and whole-row references consistently return collections; require explicit `@` for positional intersection and specify how reference location survives bindings.
- Preserve empty collection dimensions and column metadata.
- Require matching dimensions for collection arithmetic; decide scalar broadcasting explicitly.
- Separate collection contents and dimensions from containment and spilling. Resolve conversion and display syntax alongside records and lists.
- Define collection evaluation, coercion, and error recovery consistently.
- Resolve conflicting old/new collection function names and the language-version strategy.

Settle these rules before publishing a reusable library API. Implement incompatible changes with explicit migration or versioning, following the language proposal, so old calculations do not silently change.

### Third: build the table pipeline experience

- Implement shared parsing and resolution with schema-aware stage scopes.
- Deliver `where`, `derive`, `select`, `summarize`, and `order by` with ordinary function invocation in group scope.
- Support multiple summary expressions, user-defined reducers, and empty grouped/ungrouped results.
- Preserve transactional reference rewriting and dependency tracking.
- Add field completion, intermediate previews, and contextual errors.

This replaces the need to expand the conditional aggregate family and addresses several missing capabilities together.

### Fourth: simplify and extend the APIs

- Promote exact lookup defaults and remove dimension-based lookup inference from the new canonical API.
- Improve mutation names, argument ordering, validated options, and named parameters.
- Add running computations, text-processing functions, and formula checks.
- Standardize character semantics, date conversion names, and aliases.
- Extend pipelines with joins and window operations after their ordering and missing-value contracts are specified.

The most urgent problems are lost action bindings, colliding appends, silent callback truncation, and concealed contributing errors. The largest long-term improvements are explicit positional intersection, predictable collection arithmetic, schema-preserving values with independent display rules, and table pipelines that compose ordinary functions.
