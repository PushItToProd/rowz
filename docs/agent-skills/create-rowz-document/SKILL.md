---
name: create-rowz-document
description: Create or improve practical rowz documents as importable raw JSON, using pages, tables, computed text, charts, scripts, controls, and action formulas to support a real workflow. Use for sample documents, reusable templates, and user-specific rowz workbooks.
---

# Create a rowz document as JSON

Deliver an importable document that solves the user's actual problem and makes its next useful interaction obvious. Write the raw spreadsheet file; create pages and blocks in JSON rather than recreating the document through individual API edits.

## Read the current implementation

In the rowz repository, read the relevant parts of:

- [README.md](../../../README.md) for purpose and capabilities, and [CLAUDE.md](../../../CLAUDE.md) for design rules.
- [HelpView.vue](../../../apps/web/src/views/HelpView.vue) and [docs.ts](../../../packages/engine/src/docs.ts) for references, templates, and exact function signatures.
- [packages/shared/src/index.ts](../../../packages/shared/src/index.ts): `spreadsheetFile`, `fileColumn`, format rules, `fileDisplay`, and limits. This is the authoritative file format.
- [samples/](../../../samples/README.md) for implemented examples. GT7 demonstrates advanced arrays, scripts, actions, and cross-page references.

The [sample-document plan](../../../plans/sample-documents.md) contains researched use cases and collection coverage. Use it when choosing samples; do not force its proposed page names or features onto every document.

Read [JSON authoring details](references/json-format.md) before writing a file. Recheck source definitions when changing schema-sensitive fields; prose documentation can lag implementation.

## Design for a real workflow

Identify who operates the document, what they enter, the decision they need, and the useful output. Model real complications such as partial payments, changed prices, missing records, shared ingredients, or overdue work. Resolve routine choices from context; ask only for information that changes the intended workflow.

Arrange pages by use: daily operation, records, reports, and assumptions when those distinctions help. Open with computed text that states the current situation and one concrete next action. Combine small purpose-specific blocks instead of stretching one table across an entire process.

Use named data-table columns for records, formula columns for repeated calculations, and plain tables for compact forms or editable assumptions. Use structured references and descriptive identifiers. Keep shared calculations in named formulas or script functions. A bare name must be unique throughout the document; qualify repeated names explicitly.

Add controls and actions where they reduce work:

- Fixed or table-backed choice columns keep record entry consistent. Formula DROPDOWN and CHECKBOX controls can operate a setting on another page.
- A form with APPEND_ROW and CLEAR can record an event and reset its input fields.
- EXECUTE captures a value or array. INSERT saves a batch; UPDATE reconciles stable keys; OVERWRITE rebuilds generated records.
- Preserve agreed prices, accepted quotes, issued invoices, and historical snapshots as values. Keep new estimates and current summaries live.
- Preview email recipient, subject, and body in the document before an explicit SEND_EMAIL button. Make email optional unless the user requested an email-dependent workflow.

Write reports as computed Markdown: sentences for conclusions, loops for actionable lists, conditions for exceptions, embedded arrays for tables, and charts where they clarify a comparison. A text view should explain the data, not merely repeat a count already beside it. Use TEXT for currency, dates, and percentages in prose. Use MARKDOWN for deliberately generated Markdown links when needed.

Charts take formulas directly. Use grouped or filtered results instead of persisting redundant chart data. Choose bar for comparisons, line for trends, scatter for numerical tradeoffs, and pie for a small composition. Named scripts let a chart and a report reuse the same calculation.

Use formats and grid sizes to make inputs, units, dates, statuses, and results legible. Conditional formats test the cell's own value; create a computed status or risk column when a rule needs other fields.

## Keep the document coherent

- An action runs only when clicked. DO actions all read the state before the click; later actions do not observe earlier writes.
- Action destinations contain writable inputs. Do not write computed formula-column cells. A bulk destination must match the writable columns and intended row behavior.
- Display sorting and filtering do not change formula inputs. Explicitly FILTER or QUERY the subset used in a report; SUBTOTAL includes filtered rows.
- ASSERT makes a failed check visible. It does not automatically disable unrelated buttons. Put an explicit condition around an operation that must reject invalid inputs.
- Handle expected empty queues and missing optional values deliberately. Do not wrap an entire document in IFERROR or hide broken references behind a success-looking default.
- Leave room for spilled arrays in plain tables. Charts and text views can consume arrays directly without a spill table.
- Keep sample dates useful over time: an editable reference date supports reproducible examples; TODAY is appropriate for a genuinely live queue; NOW in an action captures its click time.
- Use available functions and controls. External API fetching, unattended reminders, public forms, attachments, payment processing, print layout, and additional chart types require features outside this authoring task.

## Seed useful examples

For a sample, include fictional records with enough variety to make the report or decision interesting. Give dates, quantities, units, statuses, and links consistent meanings. Do not pretend external receipt paths or example URLs are included files.

The initial document should have no unexplained errors. To demonstrate error visibility, provide a specific edit that triggers an assertion and an exact correction, or clearly identify an intentionally failing example when the user asked for one.

Give the user a short exercise with an observable result: change an assumption, select a different option, submit a form, or complete a task. Explain where the resulting record and report appear. A sample should remain useful after its fictional data is replaced.

## Produce and review

Write UTF-8 JSON with the current `spreadsheetFile` format. Use a serializer when generating repeated records or multiline sources so JSON escaping is correct. Store cell inputs only, with zero-based file coordinates. Do not invent database IDs or persist calculated values in formula-column cells.

If the request includes importing or checking the document in a running app, use [the import helper](../../../scripts/import-rowz.js) as described in [Import and review](references/import-and-check.md). It uses an existing account, imports one new document, reads it back, and reports engine errors without running actions. It needs installed repository dependencies. No custom validation framework or new endpoint is needed.

If credentials, a reachable app, or dependencies are unavailable, deliver the JSON and ask the user to check it by importing it through the web UI. Do not spend the authoring task building alternate validation infrastructure. A sandbox denial requires the user's configuration help under this repository's instructions.

Even when API diagnostics pass, ask the user to inspect the imported document's layout and perform the suggested interaction. Explain the expected result. API diagnostics do not prove that a quote is correct, a report is useful, or a button implements the intended workflow.

Deliver the JSON path, its purpose, the first interaction to try, and any actual validation result. Include the imported document URL if one was created. An import creates a copy; avoid repeated imports as an automatic retry and do not delete or modify existing documents unless requested.
