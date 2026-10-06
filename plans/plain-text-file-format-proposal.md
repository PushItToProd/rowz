# Plain-text document format proposal

Status: exploratory proposal, captured from the author's discussion on 2026-10-04. This is a possible redesign, not an implementation plan or a finalized format specification. The author supports preserving source text during graphical edits and favors an Obsidian-style editing experience. Other syntax and architecture choices below remain proposals or open questions.

## Intent

Explore a local document tool that combines prose, spreadsheets, structured data, formulas, and scripts in an open textual format. Users should be able to read and edit their documents with ordinary text editors, keep them in version control, and move them between storage providers without depending on a rowz server.

The format takes inspiration from Obsidian's use of Markdown files, Twee's named sections and section metadata, and org-babel's combination of narrative, data, and executable definitions. It should support a single-file document and eventually projects containing several documents, external data files, and scripts.

The intended applications are a web app, possibly an installable PWA, and potentially an Electron app. The storage experience could resemble draw.io: automatic browser storage by default, with options for local files and cloud providers such as Google Drive and OneDrive. Browser access to user-selected files through the File System Access API is desirable where available.

Offline editing and saving whole documents are the initial conceptual scope. Automatic merging of concurrent offline edits and live collaboration would require additional design. No implementation or schedule is authorized by this proposal.

## Author-supported requirements and preferences

- Graphical edits must preserve the surrounding source. Changing a cell in a rendered grid must update its corresponding textual cell without reformatting the whole table or document.
- Favor an Obsidian-style editor: render formatting in ordinary use, and reveal source syntax where the cursor or selection makes it editable.
- Retain access to the complete source so users can inspect and edit every document feature directly.
- Support a useful single-file document, with a path to multi-file projects.
- Allow large datasets to live outside the Markdown document so prose does not have to contain hundreds or thousands of data rows.
- Investigate reuse of rowz's model and implementation before deciding whether this should become a separate application.

These points do not settle heading conventions, fence names, namespace rules, script runtimes, or a particular editor library.

## Starting example

The following captures the author's strawman with minor formatting normalization. Its syntax is illustrative. Fluent queries, field references, relational types, and foreign-language declarations are not claims about current rowz behavior or a complete grammar. The JavaScript and Python examples express desired capabilities, not validated runnable programs.

````markdown
---
# Markdown frontmatter provides config
title: My Sample Curlybase
pages: # specific headings can be hoisted to pages
  - "Page 1"
  - name: "Custom scripts"
    hidden: yes
default_page: "Page 1" # default page to show on open
---

Page 1
======

## My sheet

Sheets are CSV in a code block.

(Side idea: the `"{Total}=SUM(B1:B3)"` syntax creates a single-cell named
range, while `{Items:}...{:Items}` creates a multi-cell range.)

```sheet
{Items:}Foo,1
Bar,2
Baz,3{:Items}
Total,"{Total}=SUM(B1:B3)"
---
# Alternate syntax for named ranges
Items = A1:B3
Total = B4
```

## Another sheet

Sheets can reference one another using named references like `'My sheet'!Total`.

```sheet
Buzz,10
Bing,20
Blah,30
Subtotal,"{Subtotal}=SUM(B1:B3)"
Prev total,"{PrevTotal}='My sheet'!Total"
New total,"=Subtotal+PrevTotal"
```

## Data table: Contacts

Data tables are Markdown tables.

| Contact name | City      | Favorite food |
| ------------ | --------- | ------------- |
| Joe          | Seattle   | Coffee        |
| Andre        | New York  | Pizza         |
| Cornelia     | Paris     | Sushi         |
| Pablo        | San Diego | Sushi         |

## Data table: Contact conversations

| Contact name | Date       | Notes                                           |
| ------------ | ---------- | ----------------------------------------------- |
| Joe          | 2026-08-10 | Told Joe to drink less coffee.                  |
| Cornelia     | 2026-08-10 | Cornelia found a new favorite sushi restaurant. |
| Joe          | 2026-09-07 | Reminded Joe to drink less coffee.              |
| Andre        | 2026-09-15 | Discussed geopolitics and pepperoni pizza.      |

```tableprops
'Contact name':
  type: reference
  foreignKey: "'Data table: Contacts'[Contact name]"
Date:
  type: datetime
Notes:
  type: longtext
```

## Inline formulas

Formulas can be intermixed with Markdown by writing `=` at the start of a line.

=getTop(ContactFavoriteFoodCounts, [Count])

## Formula template syntax

As an alternative to inline formulas, which only work at the start of a line,
you can use Jinja-style interpolation:

{{ =getTop(ContactFavoriteFoodCounts, [Count]) }}

Template syntax also supports control flow statements:

{% for Item, Count in GROUPBY('Data table: Contacts', [Favorite food]).COUNT().SORT_BY('Count') %}
- {{ Item }}: {{ Count }}
{% endfor %}

{% if len(TopFavoriteFoods) > 1 %}
There's a {{ len(TopFavoriteFoods) }}-way tie for the most favorite food!
{{ TopFavoriteFoods }} {# TODO: better example for how to render this #}
{% endif %}

## Formula scripts

```script
ContactFavoriteFoodCounts = GROUPBY('Data table: Contacts', [Favorite food]).COUNT()
TopFavoriteFoods = getTop(ContactFavoriteFoodCounts, [Count])
```

# Custom scripts

### JavaScript

```script:js
export sayHello = () => 'Hello!';
```

### Python

```script:py
# @global
def getTop(data: Table, field: FieldRef) -> Table:
    counts = data.groupby(field).count()
    top_count = counts.sort_by('Count')[0]['Count']
    return counts[counts['Count'] == top_count]
```
````

“Curlybase” is an example title, not an approved product name. The template-output TODO remains an open presentation question.

## Fit with rowz

The proposed format is compatible with much of rowz's existing computational model. The main redesign would concern document ownership, source parsing and editing, local mutations, and application UI.

| Proposed construct                      | Current rowz concept                             | Main additional work                                                 |
| --------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------- |
| Headings promoted to pages              | Named pages containing ordered blocks            | Parse page declarations and assign content to pages                  |
| CSV sheet fence                         | Plain table with positional cells                | Parse cell inputs and retain their original textual locations        |
| Markdown data table                     | Table with named columns and stored rows         | Define table activation, cell encoding, and attached metadata        |
| Named cells and ranges                  | Table names defined by formulas or references    | Parse the proposed shorthand and preserve it during edits            |
| Formula script fence                    | Scripts defining named expressions and functions | Identify and name the script block in the document                   |
| Markdown interpolation and control flow | Text templates                                   | Extend or normalize syntax and connect results to source             |
| Standalone formula line                 | An expression evaluated in page context          | Define its syntax and rendered output                                |
| Table properties                        | Column definitions and display settings          | Define metadata attachment; extend types where needed                |
| External data file                      | Data loaded into a workbook table                | Resolve files, track revisions, and define write behavior            |
| JavaScript/Python function              | Engine function registry or external calculation | Define runtime, value conversion, dependencies, and execution policy |

Relevant existing code:

- `packages/engine/src/structure.ts`: pages, tables, columns, script definitions, and names.
- `packages/engine/src/workbook.ts`: calculation, dependency tracking, script definitions, and action planning.
- `packages/engine/src/script.ts`: named expressions and functions in formula scripts.
- `packages/engine/src/template.ts`: Markdown interpolation, loops, conditions, and rendered table/chart results.
- `packages/engine/src/rewrite.ts`: source-position-based formula rewrites.
- `packages/shared/src/index.ts`: the current JSON document format and serialization helpers.
- `apps/web/src/stores/workbook.ts`: editor state, calculation, selection, and queued server mutations.
- `apps/server/src/repo/spreadsheets.ts`: structural edits, coordinated formula rewrites, effects, and history.

Rowz already separates plain grids from data tables. That distinction corresponds well to CSV sheet fences and Markdown tables with named headers. Named ranges also fit: a definition such as `Items = A1:B3` can use the existing name mechanism, and `Total = B4` can resolve to a writable cell when used as an action target.

The existing template language already resembles the example, but currently uses expressions without a leading `=` and closes control flow with `{% end %}`. The example's optional `=` and separate closing keywords would be syntax changes. Its fluent queries and foreign-language functions are separate language proposals.

The current JSON export identifies content by names and positions and omits persistent IDs and history. It could support an initial interchange experiment. A source-oriented editor would need more information than that export contains, especially the original text and mappings from semantic objects to source spans.

## Text as the authoritative document

Recommended direction for exploration: the user's text is authoritative. Parsed structures, calculated values, grids, charts, and rendered prose are derived from that text and any declared external inputs.

An editable grid cannot become a second independently authoritative copy of its CSV or Markdown source. Its operations must produce text changes that then update the parsed document and workbook. Direct typing and graphical editing must converge on the same contents.

Keep the original text alongside a parsed representation that records delimiters, comments, whitespace, quoting, and source locations. A concrete syntax tree or an equivalent lossless representation is a candidate. A semantic abstract syntax tree followed by a whole-document pretty-printer would not satisfy the preservation requirement.

Preservation expectations:

- Opening and saving an untouched supported file must preserve its bytes, including its line endings and final newline.
- An ordinary cell edit should change the smallest source region needed to encode the new input.
- Adding a row should reuse nearby conventions without realigning all existing rows.
- Renaming a referenced table should edit its declaration and the affected references while preserving unrelated text.
- Comments, unfamiliar metadata, and unsupported fenced blocks should survive application edits and saves.
- Formatting should be an explicit user operation with a clear scope.

The smallest valid edit may be larger than the characters of a value. Adding a comma to a CSV field may require quoting the field; adding a quote requires escaping it. A Markdown cell containing a pipe needs an agreed encoding. That local encoding change does not justify rewriting neighboring cells.

Source maps need more than a row number and column number. CSV fields can span physical lines and have escaped characters. Formula positions within a decoded CSV field must map back to its original encoded text for reference rewrites and diagnostics. The same concern applies to escaped Markdown cells and embedded metadata strings.

## Obsidian-style editing experience

The favored interaction is one document editor that renders inactive syntax and reveals source where it is being edited. A full-source mode should remain available for inspecting complete markup, handling unfamiliar constructs, and recovering from syntax errors.

Possible behavior to explore:

- Headings and emphasis appear formatted while inactive; their Markdown delimiters become visible when the cursor or selection enters the relevant construct.
- A formula interpolation shows its result while inactive and its expression while editing. The result does not replace the expression in the file.
- Formula scripts use syntax highlighting and assistance while editing. Whether inactive scripts show code, exported names, results, or a collapsed summary remains open.
- Sheet and data-table regions render as interactive grids. Clicking a cell can begin graphical editing; a command or deliberate source-navigation gesture can expose the underlying CSV or Markdown.
- Configuration can be rendered as a small properties editor whose changes update the corresponding text.
- Source diagnostics and rendered errors can navigate to each other.

The table interaction needs particular care. Entering a grid to edit a cell should not automatically remove that grid from under the pointer. The implementation must distinguish graphical cell focus from source editing of the containing table. The exact commands and cursor rules are unresolved.

Selections spanning rendered and source regions need defined copy, delete, and navigation behavior. Rendering must not make source inaccessible to keyboard users or change document contents merely because focus moves. Composition input, touch interaction, screen readers, and cursor movement across widgets belong in the editor feasibility work.

### CodeMirror as a candidate

CodeMirror 6 provides decorations for styling or replacing displayed text, widgets for custom DOM content, and transactions for applying document changes. These primitives could support the proposed editor. The existing `plans/formula-editing.md` also proposes CodeMirror for formula-bearing inputs.

CodeMirror would provide editor mechanisms; rowz would still implement the rules for revealing syntax, rendering grids, mapping selections, handling embedded focus, and synchronizing calculations. Replacing a block's display with a widget does not by itself solve spreadsheet editing or navigation.

Prototype the largest interactive widgets early. A grid can have a changing height, independent selection, and internal scrolling. CodeMirror's documentation also distinguishes decorations that can change vertical layout from those computed after viewport layout. Avoid an implementation assumption that every rendered block is as simple as replacing a short inline span.

Recommended history model for exploration: source edits and graphical edits enter one document transaction history. Do not give the grid and surrounding Markdown competing undo stacks. A nested formula editor may have a temporary draft history, but committing its draft should produce a coherent document edit.

Official references: [CodeMirror decorations](https://codemirror.net/examples/decoration/), [document changes](https://codemirror.net/examples/change/), and [reference manual](https://codemirror.net/docs/ref/). These establish the available primitives; the combined editing experience still needs a prototype.

## Parsing and intermediate invalid text

Incomplete source is normal during editing. An unclosed CSV quote, unfinished formula, or half-written template statement must remain editable and savable. Saving a draft should not depend on the entire document passing semantic validation.

Recommended behavior:

- Parse Markdown structure before interpreting embedded languages; recognize fences, inline code, and literal examples so examples do not accidentally become live definitions.
- Parse each recognized data, configuration, script, or template region with its appropriate grammar.
- Report recoverable errors with source locations and keep independent, unambiguous regions usable.
- Preserve unknown syntax as text. Do not execute an unfamiliar language automatically.
- When a region cannot be interpreted safely, offer source editing and a diagnostic instead of replacing it with guessed data.
- If a last valid rendered result is retained while editing, label it as stale. It must not authorize an action against obsolete source.

A broken fence can make the extent of a region ambiguous, so recovery cannot promise that every later block stays active. The parser should favor preserving text and explaining the ambiguity.

The format needs a documented way to quote literal formula lines and template delimiters in prose. Standalone `=` expressions should be recognized only in specified contexts. A string in a normal code example must not trigger calculation or an action.

## Syntax decisions still open

### Pages, headings, and block declarations

Frontmatter can configure which headings become pages, their order or visibility, and the default page. Determine whether headings must be unique, how nested headings behave, and whether page order follows source order or a configuration list.

Separate display labels from reference names where useful. Changing a heading for readability should not necessarily rename a table or script. Optional explicit identifiers or block metadata could provide that distinction without requiring UUIDs in every heading.

Ordinary prose can contain Markdown tables. Decide whether all such tables become data tables or whether activation requires a heading convention, attached properties, or another explicit declaration. Also define how a `tableprops` block attaches to a table when there are several tables or intervening paragraphs.

The format must specify behavior for duplicate declarations and ambiguous references. Existing rowz naming rules are a useful starting point, including case-insensitive lookup and qualification by page or holder.

### Sheet fences and named ranges

CSV is a reasonable encoding for positional cell inputs. Specify CSV dialect, trailing empty fields, multiline values, empty rows, and how the dimensions of a mostly empty grid are declared. A completely empty sheet still needs a representable size.

The inline brace notation and the alternate definitions section are two candidate ways to author names. The definitions section maps directly to rowz's current model and keeps CSV values separate from name metadata. Brace notation might improve readability at the location of a named cell or range, but needs literal escaping and rules for overlapping ranges.

The `---` separator inside a sheet fence needs an unambiguous grammar because CSV data can contain that text. Metadata could instead live in a separate explicitly attached block. If multiple spellings are supported, decide which is preferred for newly created content while preserving an existing file's spelling.

### Markdown tables and column properties

Specify how cells preserve literal text, formulas, blanks, spaces, newlines, pipes, and strings such as `007`. Markdown formatting and spreadsheet input interpretation must not silently change user data.

Table metadata could hold column types, formula-column definitions, reference targets, sorting, filtering, and display settings. Decide how zero-row tables are represented and how formula columns appear in source. Existing rowz stores their definitions and computes their cells; serializing results into the source would change that model.

The proposed `reference`, `datetime`, and `longtext` properties require additional semantics. A dropdown sourced from another table already exists, but it does not establish foreign-key integrity or a relational reference type. Define uniqueness, missing targets, target renames, and deletion behavior before claiming relational guarantees.

Dates and time zones also need explicit treatment. A file-format proposal should not silently replace rowz's current date semantics through a new column label.

### Formulas, templates, and scripts

Decide whether embedded expressions consistently use a leading `=`, permit it optionally, or follow the current template convention. Define which script declarations are exported and whether scope belongs to a block, page, document, or project.

Keep file-format versioning separate from formula-language versioning. A new container syntax does not require adopting the fluent query language in the example. Conversely, changing formula semantics must not silently reinterpret old files. `plans/formula-language-proposal.md` discusses related language changes but is also a draft.

Template rendering should continue to show arrays and charts as structured results, with errors visible at their origin. Decide how those results behave in prose, whether users can select and copy them, and how a derived result is distinguished from an editable stored table.

### Presentation and portability

Readable files still need a place for grid dimensions, formats, conditional rules, row heights, column widths, chart definitions, and view settings. Prefer sparse optional metadata that does not overwhelm the data. Some session settings, such as caret position, can remain outside the portable document.

Define what a generic Markdown viewer can display usefully. Prose and literal data can remain readable; calculated results need rowz or another compatible interpreter. Saving rendered results for publication could be an explicit export feature. Derived caches should never become a second authoritative copy of formulas or inputs.

## Identity, references, and structural edits

Rowz currently uses stable row and column IDs for storage and editor requests while the engine uses positions and names. A source-oriented application still benefits from stable identities during a session, especially when selections, drafts, actions, and queued edits must follow rows through insertions.

The file does not necessarily need to contain every runtime ID. Reopening a file can reconstruct identities, as current imports do. Durable history, changes from external editors, and multi-file references may require optional persistent block IDs or other reconciliation rules. This needs investigation before promising stable history across arbitrary source changes.

Distinguish deliberate graphical operations from direct source changes:

- An application rename command can identify the object and rewrite its references in one source transaction.
- A user typing a different heading may intend a display change, a new object, or a rename. The application should not silently infer every such edit as a rename.
- Inserting a row through the grid can apply spreadsheet reference-adjustment rules.
- Pasting a replacement CSV region in source may not provide enough information to infer which rows moved or were replaced.

Define the semantics of direct structural source edits and provide diagnostics or explicit refactoring commands where intent is ambiguous. Avoid guessing solely from matching values.

Reuse rowz's existing rule that every place holding formulas participates in a structural rewrite. This includes cells, names, scripts, template expressions, charts, formula columns, filters, and any new metadata containing references. Source preservation should extend the existing targeted rewrite approach.

## Local document operations and engine reuse

A possible implementation separates four responsibilities:

1. **Source document:** original file contents, tolerant syntax representation, source locations, transactions, and undo.
2. **Workbook projection:** pages, tables, definitions, and inputs interpreted from a particular source revision.
3. **Calculation:** the existing pure engine, including dependencies, values, templates, and action planning.
4. **Application services:** file access, browser persistence, external runtimes, cloud providers, and execution of permitted effects.

The current server owns much of the document mutation logic. A reusable local document implementation would need structural edits, validation, coordinated rewrites, and application of planned effects. Extract behavior that applies to documents independently of HTTP, authorization, and SQL. Keep server authorization in the server if a hosted mode remains.

Graphical editing would follow this general sequence:

1. Identify the object and its source revision.
2. Compute a valid local text replacement or set of replacements.
3. Apply one source transaction and map selections and source locations through it.
4. Update the affected workbook definitions and inputs.
5. Recalculate dependent values and update rendered regions.
6. Persist the new source through the selected storage implementation.

Source parsing and calculation may eventually run in workers. Any background result must name the revision it used so an older calculation cannot overwrite newer display state or supply a current action plan.

Actions that write several cells or tables should become one coherent source transaction after validating the full plan. Recalculation must continue to perform no effects. Clicking a button executes the stored action against the current interpreted document, and a computed result does not automatically become a writable location.

## External data and multi-file projects

Use relative references for project-owned data where practical so moving a project folder preserves its contents. A possible declaration could associate a logical table name with `data/contacts.csv` and keep its schema and display configuration in the Markdown document. Exact syntax is unresolved.

External source declarations need to distinguish at least these cases:

| Source kind              | Possible edit behavior                       | Questions to settle                                     |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------- |
| Project-owned data file  | Grid edits update that file                  | Encoding preservation, ownership, coordinated saves     |
| Imported snapshot        | Edits update a local copy                    | Refresh and replacement behavior                        |
| Read-only external input | Calculations can read it; writes are refused | Refresh timing, unavailable source diagnostics          |
| Remote data source       | Fetch or refresh through an explicit service | Offline cache, credentials, freshness, execution policy |

Keep file access outside the pure engine. The application resolves declared inputs and supplies their data and revision information to calculation. Missing files should produce visible errors without deleting their declarations or discarding unrelated document content.

A project also needs rules for entry documents, file inclusion, namespace qualification, exported names, and duplicate definitions. Avoid depending on incidental directory enumeration order. Distinguish references within one workbook from importing a definition or table from another document.

Browser access to a project folder depends on the APIs and permissions available to the user. A directory-oriented mode and a portable single-file mode can coexist, but a single selected file does not imply access to all sibling files. Packaging projects into an archive could be explored for transfer; it is not a settled requirement.

Edits spanning multiple files introduce save failure and recovery questions even without collaboration. A rename may update a declaration and several referring documents. Define how unfinished saves are detected and recovered; an in-memory source transaction does not make separate filesystem writes atomic.

External data files reduce prose clutter. They do not by themselves remove rowz's current cell limits, whole-workbook loading, or calculation costs. Lazy loading and larger-scale queries would be separate execution work.

## General-purpose scripting

JavaScript and Python are the largest computational extension in the example. Support would need more than recognizing language-tagged fences.

### Functions used during recalculation

Prefer functions whose dependencies are explicit arguments. A function receiving a table and a field reference can be recalculated when those inputs change. A function that reads arbitrary workbook cells, files, or network resources needs declared dependencies or a broader invalidation policy.

The implementation would need a value contract for blanks, errors, dates, tables, field references, and returned arrays. It would also need rules for deterministic execution, runtime lifetime, time limits, cancellation, exceptions, and versioned dependencies. Python execution in the browser is a separate runtime choice from desktop Python execution.

The current evaluator is synchronous. Worker-based JavaScript, browser Python, and remote execution introduce asynchronous completion. Possible approaches include explicitly executed calculations whose outputs are supplied to the engine, or an asynchronous calculation scheduler. Do not imply that asynchronous runtimes can be plugged into the current synchronous function registry without additional design.

Recalculated functions should retain rowz's separation between calculation and effects. A document that includes code must not gain file or network access merely by being opened.

### Explicitly executed code blocks

An org-babel-like block could run on command and return a value, populate a table, or create an output file. Define which behavior is requested, how arguments are bound, whether runtime state persists, and whether results are cached, rendered, or written into the project.

Explicit execution needs capability and trust rules appropriate to executable documents. Keep that work separate from introducing a readable file format. An early format prototype can support current formula scripts while preserving foreign-language blocks as uninterpreted source.

## Storage, offline use, and save semantics

Editing should succeed locally before a storage destination is available. Persistence then saves the source document or project rather than replaying every edit through a remote rowz API.

Potential destinations:

- Browser storage for automatic saves and recovery. IndexedDB is a better starting point than `localStorage` for document-sized data; OPFS is another candidate for application-private files.
- User-selected files through browser file APIs where supported, with conventional file opening and download fallbacks.
- Local files through narrowly scoped Electron operations.
- Cloud files through provider-specific authentication and read/write integrations.

Distinguish saved to browser recovery storage, saved to the chosen file, and uploaded to a cloud provider. An interrupted upload must not cause the application to discard a locally saved edit or claim the remote file is current.

Browser storage has quotas and deletion/eviction considerations. File permissions can be unavailable or revoked. External editors and other tabs can change the same source. Initially, detect conflicts and preserve separate copies instead of promising automatic semantic merging.

A service worker can make the web app reopen offline after its assets have been cached. Installation as a PWA is additional application work; neither feature substitutes for local document persistence.

Durable user files need explicit format versions, backward-compatible readers, and deliberate migrations. Avoid automatically reformatting a document when its format is upgraded. Preserve unsupported future metadata and explain when the application cannot safely edit a construct.

## Evolution of rowz versus a separate application

The proposal can be developed through several routes:

| Route                                                             | What it establishes                       | Main limitation                                                                   |
| ----------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------- |
| Import/export format for existing rowz                            | Syntax maps to the current model          | Does not establish source preservation or local editing                           |
| New local document implementation with existing editor components | Offline mutations and file persistence    | Surrounding prose still needs a new editing experience                            |
| New document editor sharing the engine and reusable components    | Source-oriented authoring and local files | Substantial parser, editing, and integration work                                 |
| Independent implementation                                        | Freedom to change every concept           | Duplicates existing calculation and reference behavior unless deliberately shared |

Recommended direction for exploration: build a source-oriented document editor that reuses the engine, template evaluator, formula rewrites, and suitable grid components. Decide later whether it belongs in rowz's main app or a sibling app in the repository.

A separate application is reasonable if its navigation, authoring, and file ownership differ enough from the hosted spreadsheet product. That does not require a separate formula engine. A broader computational redesign would become necessary if arbitrary stateful scripts or external runtimes were expected to drive every reactive calculation.

## Suggested experiments

These are proposed experiments, not an approved implementation sequence.

### 1. Interpret a small document

Support a deliberately limited set of constructs: page declarations, sheet fences, named-header tables, current formula scripts, and current templates. Feed their interpreted structure into the existing engine and render a document. Preserve all unrecognized text.

Use the initial example as a design fixture, but replace unsupported expressions with current formulas for a runnable demonstration. Do not make a new query language or Python runtime a prerequisite for evaluating the document format.

### 2. Prove source preservation

Implement one CSV cell edit and one Markdown table cell edit as targeted text transactions. Exercise quotes, commas, pipes, uneven padding, comments, line endings, and neighboring unsupported blocks. Confirm that untouched content survives exactly and that undo restores the original source.

Add a graphical row insertion and table rename to expose the harder interaction between source locations, stable runtime identities, and coordinated reference rewrites.

### 3. Prove the editing interaction

Prototype cursor-sensitive Markdown rendering, expression/result switching, and an interactive table widget in CodeMirror. Confirm that graphical editing and source editing remain accessible, selection mapping is predictable, and focus changes do not rewrite text.

Exercise a large grid and a long document before committing to a widget architecture. Evaluate whether the existing Vue grid can be embedded reliably or needs a different integration.

### 4. Add persistence and external files

Introduce browser autosave and a user-selected file destination. Make recovery state and destination save state explicit. Then prototype a project containing one Markdown file and one editable CSV file, including missing files and partial save failures.

### 5. Reassess the broader redesign

Use the experiments to decide the canonical syntax, authoring modes, ownership of document mutations, and application packaging. Evaluate cloud providers, Electron, richer relational fields, and foreign-language execution independently after the core file/editing contract works.

## Questions for a later design pass

1. Which constructs need an explicit declaration, and which can be inferred from ordinary Markdown?
2. How should a user enter source editing of a table while retaining ordinary grid cell editing?
3. What identity information, if any, should persist in the file?
4. What reference-adjustment semantics apply to direct source edits?
5. Where should presentation metadata live without overwhelming prose and data?
6. How are external files owned, refreshed, edited, and saved together?
7. What names are exported across pages and files, and how are collisions resolved?
8. Which foreign-language functions can participate in recalculation, and which blocks require explicit execution?
9. What content remains useful in a generic Markdown viewer, and what requires a compatible runtime?
10. Should the resulting editor replace rowz's current application, become an alternate mode, or be a sibling application sharing its engine?

## References and related plans

- [Twee 3 specification](https://github.com/iftechfoundation/twine-specs/blob/master/twee-3-specification.md): named passages with optional tags and metadata.
- [Org source-code facilities](https://orgmode.org/guide/Working-with-Source-Code.html): code editing, evaluation, and handling of execution results.
- [Obsidian properties](https://obsidian.md/help/properties): configuration stored in textual frontmatter.
- [CodeMirror decorations](https://codemirror.net/examples/decoration/) and [document changes](https://codemirror.net/examples/change/): candidate mechanisms for rendering and targeted source edits.
- [Browser file access](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access): user-selected files, write access, permissions, and feature detection.
- [Browser storage quotas and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): persistence constraints for browser-owned data.
- [OPFS](https://developer.mozilla.org/en-US/docs/Web/API/File_System_API/Origin_private_file_system): application-private browser files.
- [Offline web application operation](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation): caching the application for offline startup.
- [Formula editing plan](formula-editing.md): shared formula editor and CodeMirror integration.
- [Formula language proposal](formula-language-proposal.md): related, independently proposed language extensions.
- [Names and scripts plan](names-and-scripts.md): background on named formulas, functions, and holders; consult current implementation for implemented behavior.
- [Persistent row identity plan](persistent-row-identity.md): background on stable identities during structural edits; consult current implementation for implemented behavior.
