# Formula language proposal

Status: draft strawman for discussion. This document proposes behavior; it does not describe implemented features or record approved decisions. The author should review the choices below before implementation. Examples use the proposed language unless labeled otherwise.

## 1. Goals

Make Rowz suitable for both small spreadsheet calculations and substantial reusable programs. Preserve reactive recalculation, interactive cell references, stable identities during structural edits, visible intermediate results, and explicit action execution.

Use one expression language in cells, scripts, chart sources, text views, data-table filters, query predicates, and libraries. Records, lists, tables, and values read from workbook blocks participate in the same operations. A library should accept a workbook table without knowing whether its argument came from a stored block, a literal, or another calculation.

Keep existing formulas working. Add a language version to stored documents before introducing incompatible interpretation changes. Do not silently change old Boolean reductions, coercions, reference rules, or query semantics.

Initial implementation does not require package hosting, mutable variables, arbitrary I/O, classes, or user-defined operator overloading.

## 2. Core evaluation model

Every expression produces an immutable value. Local evaluation is deterministic given its inputs and explicit calculation context. The engine performs no I/O. Existing context-dependent functions such as NOW retain their declared recalculation behavior.

Workbook definitions are reactive: changes to their dependencies cause recalculation. Local bindings evaluate sequentially during a calculation. Library module initialization cannot read a workbook or execute an action.

Functions are first-class lexical closures. Workbook functions may capture workbook references; portable library functions receive workbook data as arguments. A captured cell reference retains its defining workbook context, as existing Rowz lambdas do.

Actions remain descriptions of effects. Recalculation never executes them. Actions retain expressions needed for click-time evaluation, including lexical bindings and reference origins. A computed value is not automatically a writable workbook location.

## 3. Values and shared operations

### 3.1 Value kinds

| Kind               | Meaning                                                   | Example                              |
| ------------------ | --------------------------------------------------------- | ------------------------------------ |
| Scalar             | Number, text, Boolean, date, or blank                     | `42`, `"hello"`, `TRUE`, `blank`     |
| Record             | Ordered named fields                                      | `{estimate: 12, error: 0.5}`         |
| List               | Ordered sequence of values                                | `[1, 2, 3]`                          |
| Table              | Ordered columns and ordered rows with rectangular storage | `TABLE([{Name: "Ada", Amount: 12}])` |
| Function           | Parameters and lexical environment                        | `x => x * 2`                         |
| Action             | Deferred description of effects                           | Existing action functions            |
| Presentation value | Chart, Markdown, button, or input control                 | Existing presentation functions      |
| Error              | Failure with a code and diagnostic context                | Existing spreadsheet errors          |

Records and lists can contain nested values. Tables can contain structured values, although legacy numeric and text functions reject incompatible cells. Presentation values expose documented read-only fields through the same field-access protocol as records; they do not expose evaluator internals.

A table is semantically an ordered sequence of records with an explicit ordered schema. An implementation may keep columnar or rectangular storage. Converting a table to row records must not require copying every cell merely to begin iteration.

A list of records is not automatically a table: it may have inconsistent fields, and an empty list has no schema. `TABLE(rows, columns: [...])` constructs a table. Without explicit columns, all records must have the same field set; first-record order determines column order. Later records are aligned by field name. An empty input without columns creates a zero-column table.

A plain grid is a table with positional columns and no user-supplied field names. A data table has named columns. Operations requiring named fields reject an unnamed grid until names are supplied explicitly. Do not invent letter fields that collide with real names.

### 3.2 Shared access protocol

The following operations dispatch on value kind, with explicit behavior rather than implicit conversions:

| Operation              | Record                  | List                   | Table                                                  |
| ---------------------- | ----------------------- | ---------------------- | ------------------------------------------------------ |
| `value.name`           | Named field             | Error                  | Named column as a list                                 |
| `value[key]`           | Field by text key       | Element or slice       | Row record or row slice                                |
| `value[rows, columns]` | Error                   | Error                  | Rectangular selection                                  |
| `MAP(value, fn)`       | Error; use `FIELDS`     | Map elements to a list | Map row records to a list                              |
| `FILTER(value, fn)`    | Error                   | Keep matching elements | Keep matching rows; retain schema                      |
| `ROWS(value)`          | Error                   | Error                  | List-compatible read-only row sequence                 |
| `COLUMNS(value)`       | Error                   | Error                  | Ordered list of column names or positional descriptors |
| `FIELDS(value)`        | Ordered field-name list | Error                  | Error                                                  |

These signatures describe the new collection API. Existing `MAP`, `FILTER`, `ROWS`, and `COLUMNS` have different spreadsheet meanings. Use distinct initial names such as `MAP_ROWS`, `FILTER_ROWS`, `ROW_RECORDS`, and `COLUMN_NAMES`, or gate the new meanings by language version. Never dispatch between conflicting meanings solely on whether a range happens to have headers.

Field lookup follows Rowz's case-insensitive naming convention. A record or table cannot contain two names equal ignoring case. Field order is observable through field enumeration and display; record equality compares field names and values independently of declaration order. Lists compare positionally. Tables compare ordered schemas and rows. Functions, actions, and presentation values are not structurally comparable in the first version.

Missing fields and out-of-range scalar indexes produce errors. Blank is a present value, distinct from a missing field. `HAS_FIELD(record, key)` and explicit fallback access avoid catching unrelated failures. No implicit truthiness of lists, records, or tables.

### 3.3 Workbook blocks as values

A bare table name continues to produce its table data. `Sales[Amount]` remains a column access and interoperates with columns of calculated tables. A formula holding a table value supports the same selectors as the original table block.

Expose block metadata separately through a pure workbook accessor:

```text
BLOCK("Sales")
BLOCK("Sales").data
BLOCK("Sales").name
```

`BLOCK` resolves a unique block in the current workbook using existing qualification rules; ambiguous names fail. Its result is a read-only record with stable `id`, `kind`, `name`, and documented kind-specific fields:

| Block kind | Additional fields            |
| ---------- | ---------------------------- |
| Table      | `data`                       |
| Chart      | `data`, `title`, `chartType` |
| Text view  | `source`, `rendered`         |
| Script     | `exports`                    |

`BLOCK(...).data` for a table is the same value as the bare table name. Chart data is the evaluated chart source. Text fields are text, not trusted HTML. Script exports form a namespace with the same lookup operations as a record, but may evaluate individual exports lazily.

Metadata reads participate in dependency tracking. Reading a chart or text view introduces its underlying dependencies and can create a cycle; cycles produce diagnostics. Resolving blocks never bypasses server authorization. Cross-workbook access is outside this draft.

A block descriptor is not a write capability. Existing action targets remain explicit references resolved to stable IDs. Computed filtering, sorting, and slicing do not grant permission to write back into their source.

## 4. Lexical syntax

Retain existing numbers, strings, cell references, structured references, error literals, and case-insensitive function names. Double quotes denote text; single quotes denote identifiers, including names with spaces. A doubled matching quote escapes that quote, preserving current formula conventions.

Add `//` line comments and `/* ... */` non-nesting comments to every expression context. Whitespace and newlines are insignificant inside expressions. Script statements end with semicolons; existing newline-based scripts remain supported by the legacy parser. The editor can insert semicolons or format them, but the new grammar does not infer statement endings from indentation.

New reserved words include `let`, `function`, `module`, `import`, `export`, `as`, `and`, `or`, `not`, `if`, `then`, `else`, and query-stage keywords in query contexts. Existing names that collide remain valid in legacy formulas; quoted identifiers escape keywords in the new version.

Brackets currently denote own-row structured references such as `[Amount]`. Preserve that syntax. A bracket containing a bare identifier remains an own-row reference; lists use `LIST(...)` for a single identifier. Empty brackets, comma-separated expressions, and numeric or string entries are list literals. Thus `[Amount]` and `["Amount"]` deliberately differ. The parser must document and diagnose this compromise; replacing list literals with a dedicated delimiter is an alternative for author review.

A standalone `.` is the function-pipe placeholder. `.5` remains a numeric literal. `record.field` is field access. Quoted fields use `record.'Gross Amount'`; computed keys use `record[key]`.

## 5. Operators and conditionals

Retain arithmetic, comparison, concatenation, and reference operators. Add Boolean `and`, `or`, and `not` without changing existing `AND`, `OR`, or `NOT` functions.

Precedence, highest to lowest:

1. Calls, field access, indexing, and reference qualification.
2. Existing exponentiation and unary arithmetic rules, unchanged from the legacy parser.
3. Multiplication and division.
4. Addition and subtraction.
5. Text concatenation.
6. Comparisons.
7. `not`.
8. `and`.
9. `or`.
10. Table pipeline `|` and function pipeline `|>`, equal precedence and left associative.
11. Lambda `=>`, extending over the following expression.

`not Amount > 100` means `not (Amount > 100)`. Chained comparisons are rejected; write `low <= x and x <= high`. Parenthesize a pipeline when using its result as an operand.

Scalar Boolean operators require Booleans and short-circuit. `FALSE and failing()` returns FALSE. Array Boolean operators operate elementwise and use scalar broadcasting; non-scalar operands must have identical dimensions. Errors in an unneeded element are masked, but evaluating the right expression can still incur work or encounter a whole-expression failure. Do not promise per-element lazy execution of an arbitrary function.

`ALL` and `ANY` explicitly reduce Boolean collections. Empty input gives TRUE for ALL and FALSE for ANY. Neither silently coerces text or numbers.

Add expression conditionals:

```text
if enabled then calculate() else 0
```

Only the selected scalar branch evaluates. Initial conditionals require a scalar Boolean; use explicit mapping for elementwise branch selection. Existing IF retains legacy behavior.

## 6. Local bindings and functions

A braced expression contains zero or more bindings followed by one result expression:

```text
={
  let amounts = Sales[Amount];
  let total = SUM(amounts);
  amounts / total
}
```

Bindings are immutable, sequential, and lexical. A binding is unavailable in its own initializer. Duplicate bindings in the same scope are errors; an inner scope may shadow an outer name. No assignment expression is introduced.

A brace starting with `let` or `function` is a binding expression. Otherwise braces contain a record literal. `{}` is an empty record. A binding expression requires a final result. Record keys may be bare or quoted identifiers:

```text
{estimate: 12, 'Standard Error': 0.5}
```

Functions can be defined locally or in scripts/modules:

```text
function withTax(amount, rate = 0.2) = amount * (1 + rate);
let adjusted = withTax(100, rate: 0.15);
adjusted
```

Default arguments evaluate in parameter order at call time and may use preceding parameters. Arguments are evaluated once, left to right. Named arguments follow positional arguments; duplicate and unknown names fail. Initially named arguments require declared signatures; existing variadic and special-form functions need explicit signature metadata before accepting them.

Lambdas use `x => expression` or `(x, y) => expression`. Function declarations support self-recursion; consecutive declarations form a mutually recursive group. Let-bound anonymous functions do not gain implicit self-recursion. Recursion consumes the same evaluation budget as other computation.

Errors attach function call frames. General recovery remains explicit through existing IFERROR; no exception statements are added initially.

## 7. Function pipelines

```text
Xyz |> FOO(123, .) |> BAR(456, .)
```

Each stage evaluates its incoming expression exactly once. An explicit placeholder binds to that value throughout the stage. Multiple uses share the value:

```text
expensiveCalculation() |> . / SUM(.)
```

A stage without a placeholder must be a call or callable value. A call receives the input as its first positional argument; a callable value is called with that input. Other expressions without placeholders fail with a targeted diagnostic.

Nested pipelines introduce a new placeholder scope in their right stage. Their left operand still sees the enclosing placeholder. Lambdas may capture the enclosing placeholder lexically, but explicit parameter names are recommended when iteration is involved. A placeholder never implies MAP or a row callback.

Implement pipes as hygienic bindings, not source substitution. Preserve source spans for diagnostics and reference rewrites. Pipe construction around action calls must preserve click-time evaluation; it must not eagerly evaluate deferred action arguments. This requires dedicated lowering or deferred environments, not ordinary eager call desugaring.

## 8. Indexing and slicing

Indexes are one-based; negative indexes count from the end, so -1 is the last element. Zero is invalid. Slice endpoints are inclusive. Omitted endpoints select the beginning/end. An omitted dimension, written `:`, selects all entries.

```text
items[2]                          // one value
items[2:5]                        // a list
items[-3:]                        // final three values
Sales[2]                          // one row record
Sales[2:5]                        // a table, preserving schema
Sales[:, 'Amount']                // a column list
Sales[2, 'Amount']                // a cell value
Sales[2, :]                       // a row record
Sales[2:2, :]                     // a one-row table
'Table 1'[:, 'Bar':'Buzz']         // inclusive contiguous columns
'Table 1'[:, ['Buzz', 'Bar']]      // explicit projection/reordering
```

A scalar selector removes that dimension; a slice retains it. Selecting several rows and one column returns a list. Selecting one row and several columns returns a record. Selecting slices in both dimensions returns a table.

Endpoints must identify existing entries; invalid endpoints fail instead of silently clipping. A start after the end yields an empty selection with retained schema. Negative steps and strided slices are deferred; reverse with an explicit function initially.

Named column slices use current logical column order. Inserting a column between endpoints includes it. Explicit projections include only the named columns. Duplicate projection names fail. Own-row `[Amount]` and whole-column `Sales[Amount]` continue to work; an unquoted identifier after an arbitrary computed expression is a dynamic selector, while quoted identifiers are static field selectors. Resolution must distinguish this from the legacy structured-reference form before evaluation.

Data-table rows use stored order, matching existing formula references. Display sorting and filtering do not change expression results. A query produces its own ordered value.

## 9. Table query pipelines

Query pipelines operate on table values, including values supplied by blocks, constructors, or library functions:

```text
Sales
  | where Amount > 100 and not Cancelled
  | derive Net = Amount - Cost
  | summarize Revenue = SUM(Net) by Region
  | order by Revenue desc
  | take 10
```

Initial stages:

| Stage                                         | Result                                            |
| --------------------------------------------- | ------------------------------------------------- |
| `where predicate`                             | Matching rows, same schema                        |
| `derive name = expression, ...`               | Add or replace columns                            |
| `select name, expression as name, ...`        | Project and reorder columns                       |
| `summarize name = aggregate, ... by key, ...` | One row per group                                 |
| `order by expression asc/desc, ...`           | Stable ordering                                   |
| `take count`                                  | First count rows                                  |
| `drop count`                                  | Skip first count rows                             |
| `distinct field, ...`                         | Unique projected combinations in first-seen order |

Stage expressions resolve unqualified fields against the incoming row before outer lexical names. `row` explicitly names that row; `outer.name` accesses the enclosing lexical environment. These contextual bindings cannot be redeclared in a stage. Outside queries, ordinary lexical lookup applies.

Derive expressions all read the incoming schema; they do not see siblings introduced in the same stage. Use another derive stage for dependent columns. Replacement preserves column position; new columns append in declaration order. Missing fields fail even on empty tables when statically identifiable.

Summarize expressions run in a group context. `group` is a table of the group's incoming rows, and grouping keys are scalar bindings. In this context `SUM(Net)` aggregates the group's Net column. Non-key fields are group column lists, preventing arbitrary selection of a representative row. Explicit `SUM(group.Net)` is equivalent. Aggregation has no special dependence on function spelling or argument count; ordinary library functions can consume group columns or the group table.

Grouping uses structural equality on scalar keys initially; non-scalar keys fail. Empty ungrouped summarize produces one row, with each aggregate's documented empty-input result. Empty grouped summarize produces zero rows with a known output schema.

Where requires scalar Boolean predicates. Blank comparisons follow the shared new expression semantics, not a separate SQL null system: blank equals blank; ordered comparisons with blank fail. Missing values must be handled explicitly. Sorting puts blanks last in both directions, preserves equal-key input order, and rejects incompatible nonblank key types. Predicate failures fail the query with row and stage context.

Count expressions are evaluated once outside row scope and must be nonnegative integers. Joins, window operations, pivot/unpivot, and nested grouping are subsequent extensions; their ordering, missing-value, and schema rules require separate proposals.

Existing QUERY strings remain available with their current behavior. New queries share expression parsing, function invocation, and diagnostics with formulas. They are not stored as strings inside an opaque query function.

## 10. Modules and reusable libraries

A script can declare a module:

```text
module Finance {
  function discounted(amount, rate, period) =
    amount / (1 + rate) ^ period;

  export function presentValue(cashflows, rate) =
    cashflows
      | derive Discounted = discounted(Amount, rate, Period)
      | summarize Value = SUM(Discounted)
      |> .[1, 'Value'];
}
```

Imports bind a namespace explicitly:

```text
import Finance as finance;
ForecastValue = finance.presentValue(Forecast, DiscountRate);
```

Namespace fields use record-style lookup. Only exported definitions are accessible. Imports do not inject names into workbook-wide lookup. Exported constants must be independent of workbook context. Portable modules cannot contain unqualified cell references or workbook block lookups; workbook scripts may import modules and bind their functions to local data.

Initial modules reside inside the workbook. Later external libraries are bundled with exact versions and content hashes. Opening a workbook performs no network fetch. An explicit installation/update operation resolves dependencies and stores source plus a lock manifest. Import cycles are rejected initially; recursion inside one module is allowed. Library updates do not silently alter workbook calculations.

Pure library functions may return action values only if declared as action-producing functions. Such declarations preserve deferred arguments and contribute no recalculation dependencies from click-time-only expressions. Implement this after the pure module system; do not infer action behavior merely from a function's latest returned value.

Type annotations are optional and staged. Initial runtime contracts can describe scalars, lists, records, functions, and tables with required named columns. A later static checker should accept additional fields for read-only record/table parameters, so a library requiring Amount and Period accepts a larger workbook table. No annotation makes a value mutable or grants workbook access.

## 11. Recalculation, identity, and rewriting

Workbook access is explicit in the resolved expression tree. Local variables, module exports, fields, and query columns must not be mistaken for workbook names by dependency discovery.

Dependencies are conservative initially: both conditional branches are included, as are potential workbook reads in callable closures. Resolving an unknown callable conservatively invalidates affected calculations instead of risking stale results. Pure portable functions depend only on argument dependencies. Dynamic block lookup initially depends on the relevant workbook name catalog and all potentially read blocks; optimize later with recorded reads.

New selectors over direct workbook tables participate in structural rewrite rules. Quoted field selectors refer to stable column identities after name resolution; column renames update source text. Named slice endpoints retain endpoint identities. Computed selectors such as `table[key]` are value lookups and cannot generally be rewritten; renaming a field may make them fail. Diagnostics and rename previews must identify that limitation.

Calculated tables have field names but no writable workbook identities. Optional provenance can aid inspection, but actions cannot treat it as a target automatically. Metadata IDs are opaque and do not replace authorized reference resolution.

All formula-bearing content must be rewritten in the same transaction: cells, views, formula columns, filters, script definitions, and workbook module source. External bundled module code contains no workbook references and is not rewritten.

## 12. Display and interoperability

Scalars display normally. Tables spill rectangular values, preserving column metadata separately; headers are shown only through an explicit display option or conversion. Lists spill vertically when their elements are displayable cell values. Records use an inspectable summary; `AS_TABLE(record)` explicitly renders fields and values. Nested structures do not silently stringify or flatten.

Charts accept compatible table values regardless of origin. Text-view iteration accepts lists or table rows and exposes record fields. A text interpolation of a structure uses a documented renderer or explicit conversion, never executable HTML. Formula columns can compute structured values, with inspection available from the cell editor.

Legacy functions receive adapters only where conversion is unambiguous. A numeric reducer may accept a numeric list or table column. A lookup requiring a rectangle rejects a record. Legacy MAP continues to map grid cells; new row mapping has a separate entry point until versioned API migration.

The client protocol must carry structured values, column metadata, and bounded previews. It must distinguish dates, blanks, errors, and presentation values without relying on ambiguous JSON object keys. Functions and closures are inspected through descriptors; never serialize evaluator contexts to the browser.

## 13. Limits and diagnostics

Retain allocation checks before creating arrays. Extend limits to list elements, record fields, table cells, nesting depth, function calls, query intermediate results, and total evaluation steps. Check expanding operations before allocation; charge recursive and repeated work against a shared budget. Errors identify the exhausted limit and relevant expression.

Source spans survive parsing, binding, and lowering. Diagnostics include module, function, query stage, and row where useful. The editor offers field completion, function signatures, module exports, and previews of pipeline schemas and intermediate values. Running a preview never executes an action.

## 14. Implementation analysis

### 14.1 Current starting points

- `packages/engine/src/ast.ts` has scalar literals, references, operators, names, calls, and applications. It needs structured literals, selectors, lexical blocks, functions, module forms, and query stages.
- `tokenizer.ts` and `parser.ts` implement formula syntax. `query.ts` has a separate SQL-style parser that constructs some shared expression nodes. `script.ts` splits statements using lines and definition patterns. The new language needs a shared tokenizer/expression parser plus explicit script/module grammar.
- `values.ts` represents ranges as rectangular rows with optional column names. It needs structured values and a table/row access protocol without breaking existing scalar-cell assumptions.
- `evaluate.ts` implements elementwise operators and closure application. It needs lexical environments, strict Boolean operators, collection operations, budgets, and call-frame diagnostics.
- `scope.ts`, `graph.ts`, and `workbook.ts` discover names and manage dependencies. New lexical and query bindings need a resolver that classifies names before dependency analysis.
- `rewrite.ts`, `columns.ts`, `views.ts`, and `script.ts` manage formula rewrites. New direct selectors, module source, and block reads must join those paths.
- `functions/registry.ts` describes arity and pure/special/action behavior. Named parameters, defaults, contracts, and action-producing user functions require richer signature and evaluation metadata.
- `docs.ts` holds function help and executable examples. Syntax documentation and editor assistance need coverage beyond the function catalog.

### 14.2 Recommended compiler organization

Use parse -> resolve -> evaluate, with optional lowering after resolution. Parse nodes retain spelling and spans. Resolution assigns symbol identities and classifies workbook references, local names, module members, fields, and query bindings. Evaluation uses that resolved representation.

Centralize tree traversal and binding-aware analysis. Adding a node currently requires touching several independent switches; a shared visitor reduces omissions in dependency discovery, diagnostics, printing, and rewriting. Keep a source-preserving syntax tree or edit map alongside any lowered tree. Printing a lowered pipe as nested calls would degrade the author's source during a rename.

Do not model every table stage as an opaque ordinary function. Query stages need schema and scope information. They can execute through shared collection primitives after resolution. Likewise, preserve deferred action syntax until planning; lowering it to eager local bindings would change behavior.

### 14.3 Incremental delivery

1. **Resolve semantic decisions and versioning.** Agree on literal ambiguity, blank behavior, collection API names, indexing, and deferred actions. Add document language versioning and compatibility fixtures.
2. **Shared parsing and resolution infrastructure.** Add spans, visitors, lexical symbol resolution, and signature metadata while preserving existing formula behavior.
3. **Local syntax.** Implement comments, lexical blocks, lambdas, named arguments, scalar Boolean operators, and pure function pipes. Update autocomplete and source rewrites.
4. **Structured values.** Introduce records/lists and the table protocol, adapters, allocation budgets, wire encoding, inspection, and explicit display conversion.
5. **Selectors and query pipelines.** Implement indexing, named slices, table stages, grouped evaluation, schema diagnostics, dependency tracking, and transactional rewrites.
6. **Workbook modules.** Implement imports/exports, portable-function restrictions, recursive definitions, call limits, and module editing.
7. **Block descriptors and presentation integration.** Expose authorized block values, detect view cycles, and support structured values in charts/text views.
8. **External library bundles and action libraries.** Add pinned dependencies and deferred lexical environments after the pure language is stable.

These are coordinated engine, server, and client changes. Structured values are the largest cross-cutting change; Boolean spelling and lexical blocks are comparatively contained. Queries depend on table semantics, and libraries depend on resolution and closures. Avoid publishing a library API before those rules settle.

### 14.4 Validation required during implementation

This proposal changes documentation only. Future implementation should add behavior tests for each new syntax and value kind, not just parser snapshots. Cover lexical shadowing, closure capture, single evaluation of pipes, nested placeholders, short-circuit errors, empty schemas, grouped results, slice identities, dynamic selectors, column renames, dependency invalidation, recursion budgets, and legacy compatibility.

Server integration must verify that rewrites of all new formula holders are atomic and undoable. Access tests must cover new block lookup routes if any; the engine API itself does not authorize access. Web tests must cover structured-value transport, inspection, spill behavior, and completions. Run `pnpm check` for implementation changes and migration checks after any schema migration. Browser validation should use the repository's Codex remote Playwright command when needed.

## 15. Decisions for author review

- Keep single quotes for identifiers and double quotes for text.
- Use `|` for table stages and `|>` with lexically bound `.` for ordinary value piping.
- Use one-based inclusive slices, including contiguous named column slices.
- Preserve `[Field]` as an own-row reference despite its conflict with single-element list literals.
- Use strict new Boolean semantics and version incompatible coercion changes.
- Treat tables as schema-bearing ordered row collections; keep unnamed grids positional.
- Preserve bare table names as data values and expose block metadata through BLOCK.
- Keep computed values separate from writable references.
- Require explicit library inputs, namespaces, and pinned external dependencies.
- Defer action-producing library functions until click-time lexical capture is specified and implemented.

Alternatives remain open. No choices in this draft should be added to DECISIONS.md solely because this document exists.
