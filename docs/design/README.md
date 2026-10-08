# Design guidance

These documents record how the author wants rowz to behave, look, and read. They are for anyone who adds or changes a feature, including agents working without the author.

| Document                                   | Read it before                                                |
| ------------------------------------------ | ------------------------------------------------------------- |
| This page                                  | Any feature work or review                                    |
| [ui.md](ui.md)                             | Changing anything under `apps/web`                            |
| [writing.md](writing.md)                   | Writing a label, a message, an error, or help text            |
| [formula-language.md](formula-language.md) | Adding or changing a function, an operator, or formula syntax |

A rule here gives its reason so that it can be applied to a case it does not name. When a rule and its reason point different ways in a new case, follow the reason and record the choice in [AGENT_DECISIONS.md](../../AGENT_DECISIONS.md).

[DECISIONS.md](../../DECISIONS.md) holds the individual decisions these rules generalize, with what would reopen each.

## What rowz is for

rowz is the spreadsheet the author has wanted for years, built to the author's taste. It borrows from Excel, Google Sheets, Apple Numbers, rows.com, Notion, and Vue. Its look also borrows from Jupyter notebooks and from dashboard tools such as Grafana: a page is a column of blocks, each with a visible job, packed densely.

## Product principles

### Follow Excel and Sheets where they agree and the behavior is expected

A person arriving from either should find that the keys and gestures they know do the same thing here. The Tab-then-Enter entry flow and closing open parentheses on commit are examples.

Where the two differ, follow Sheets for keys and functions, and Excel for table features such as structured references. rowz's array functions and `QUERY` come from Sheets, and its `Table[Column]` references from Excel.

Diverge when the author has said the familiar behavior is a nuisance. Arrow keys do not pick references while a formula is being edited, because that gets in the way of correcting earlier text.

### Excel and Sheets set the ceiling for problems outside the author's priorities

If neither Excel nor Sheets solves a usability problem, and it is not among the priorities in [todo.md](../../todo.md), rowz does not have to solve it either. Mention it once, add a todo if it seems real, and continue. Do not design a mechanism for it.

The usual case is simultaneous editing. When two people edit one cell simultaneously, Sheets lets the last submission win, and so does rowz.

### Prefer correct results to matching another spreadsheet's mistakes

A function result that a reader would call wrong is a bug, even when Excel and Sheets return the same thing. `LEFT("😀a", 1)` returns the whole emoji because half a character is not text.

This does not extend to the tolerances other spreadsheets apply so that results match what people expect. Showing 15 significant digits hides binary rounding error, and that is kept.

The test: would a person who sees the result, and knows what the function is documented to do, say it is wrong?

### Errors are always visible, and an error leads to its origin

An error is shown wherever the document is summarized: the header, the page tab, the block, and the document list. An error on an inactive page or in a filtered-out row still counts.

Naming the problem is half of the job. Every place that reports an error also lets the person go to where it arose: the cell, the script line, the function, and the chain of calls between them. A new feature that can fail supplies that link.

A warning on a page tab, a block, or a document in the list is such a place. Clicking it goes to the error, or opens the errors list showing only that page's, block's, or document's errors. The warnings are plain icons today, and [todo.md](../../todo.md) tracks the change.

### An ambiguous thing is an error, not a guess

When what the person wrote has more than one meaning, rowz reports it and lists the meanings. It does not pick the nearest or the first. A silent pick lets one edit change what other formulas read with nothing on screen to show it.

### A display setting never changes what stored data means

Sorting, filtering, collapsing, and hiding change what is drawn. `A2` and `SUM(Sales[Amount])` read the same cells under any of them.

### Ordinary interaction never loses work

Moving focus, switching pages, and clicking another control save the current edit. Discarding takes an explicit act: Escape, Cancel, or a confirmed departure. A save that fails keeps the draft open with the error beside it.

### Samples show what rowz alone does

A sample or template uses data tables, scripts, text views, controls, and buttons where they fit, in preference to reproducing a plain grid from another spreadsheet.

## What is deferred

Phone-width layout, touch, and screen-reader support are not being improved now. Do not break what works, and do not spend effort extending it unless the task is about one of them.

Several users, hostile input, and deployment are parked. The "Project stage" section of [CLAUDE.md](../../CLAUDE.md) says how to rank such findings.
