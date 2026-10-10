# To-do workflow

Open items are grouped into sections by where in the product they are. An item's hashtag names its theme, which is the goal it serves, and its priority prefix orders the work. A bug in `BUTTON` sits in the Bugs section and carries `#small-apps`, so it shows up when you look at either.

Items added by AI agents should be prefixed `(Claude)`, `(GPT)`, etc. The author will remove the prefix if they fully endorse the idea, though agents asked to act autonomously should not consider these markers as prohibitions on implementation.

## Priorities

A prefix such as `**P3**` is the author's priority for an item. When instructed to work autonomously, do these items in ascending order: all P0s first, then P1s, and so on. Items with the same priority are co-equal unless you're instructed otherwise. Among them, do smaller, higher-value items before bigger, more complex ones. Remove the prefix when checking an item off. Check items off before making commits.

| Prefix     | Meaning                                                                                                                                                            |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0         | Something that shipped is broken, or the development loop is: a failing or flaky test, a bug in a finished feature                                                 |
| P1 to P9   | Rank, with P1 soonest. The number is not tied to a theme                                                                                                           |
| P10        | Parked. Mostly the hardening under [Before sharing with others](../todo.md#before-sharing-with-others). Not picked up unless the author says so                    |
| P11 to P98 | Backlog, in rough order with the lower number first. Not picked up unless the author says so                                                                       |
| P99 and up | Not planned. Kept so the idea and the reason are not lost                                                                                                          |
| Hold       | Waits for a decision by the author. Not picked up                                                                                                                  |
| Author     | Needs the author first: a decision, a design, or something only the author can supply or run. Not picked up. A priority after it applies once the author has acted |

A sub-item without a prefix takes its parent's. An item that only groups sub-items, such as "more actions", has no prefix. An item with no prefix and no prefixed parent has not been triaged: do not pick it up, and point it out to the author.

A box holds one of three marks:

| Mark  | Meaning                                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------------------------ |
| `[ ]` | Open                                                                                                                     |
| `[x]` | Done                                                                                                                     |
| `[*]` | May be done. A change touched it, and whether the change satisfies it completely is for the author to say. Not picked up |

An agent that marks an item `[*]` keeps the item's priority prefix and adds a sub-item beneath it: `- [ ] **Author** **P4** may be resolved: ...`, with the item's own priority, what is in doubt, and the hash of the latest commit at the time of writing. The author changes `[*]` to `[x]` or back to `[ ]` and deletes the sub-item.

`(e2e-unverified)` at the end of an item means an agent finished it while the end-to-end tests could not be run. The agent removes the mark once the suite passes with the change in it.

`../todos.sh` lists the open prioritized items in order, with sub-items under the priority they take. It leaves out a `[*]` item and lists its `Author` sub-item.

## Themes

rowz is a proof of concept that one person uses on their own machine. Features that make it more useful come before correctness under several users, hostile input, or deployment. The exceptions are serious bugs that one person would hit in ordinary use, and design flaws that would make much later work harder.

A hashtag at the end of an item names its theme. A theme's standing informs the priority its items are given, and the number on the item is what orders the work.

| Theme               | Standing | What it covers                                                                                                  |
| ------------------- | -------- | --------------------------------------------------------------------------------------------------------------- |
| `#small-apps`       | Active   | Documents as small apps: controls, buttons, the log of button runs, block layout, links, and actions            |
| `#codebase`         | Active   | What keeps the work fast and trustworthy: file structure, tests, performance of the editor and engine           |
| `#everyday`         | Next     | What anyone expects of a spreadsheet: number entry, find, frozen headers, wrapped text, in-app dialogs, wording |
| `#formula-language` | Ongoing  | Functions, operators, `QUERY`, and how expressions compose. The drafts in `plans/` propose larger changes       |
| `#data-tables`      | Ongoing  | Follow-ups to data tables: view presets, validation, generated tables, CSV append                               |
| `#formatting`       | Later    | Conditional format follow-ups, borders, carrying formats                                                        |
| `#charts`           | Later    | A charting library, chart options, charts in cells                                                              |
| `#formula-editing`  | Later    | Follow-ups to the shared formula editor: diagnostics, bracket insertion                                         |
| `#documents`        | Later    | The document list, samples and templates, import and export, versions                                           |
| `#agents`           | Later    | An API, a CLI and skill for agents, and comments as a way to give an agent feedback                             |
| `#sharing`          | Parked   | Several users, hostile input, and deployment                                                                    |

Three themes are finished except for the follow-ups tagged above: names and testable logic (document-level names, formula scripts, `ASSERT`), data tables (whole-table references, sort and filter, dropdown columns, conditional formats), and the shared formula editor (one editor everywhere, reference picking, colored references).

A reference document is the acceptance test of a theme: the theme is done when its document is usable, and what gets in the way of building one becomes new items here. They are listed under [Controls, mobile use, and templates](../todo.md#controls-mobile-use-and-templates). The monthly budget and the Gran Turismo 7 comparison are built. The quest tracker is the one for `#small-apps`.

## Keeping the list current

Keep completed work in [the completed-item archive](history/completed-todos.md). Before archiving a completed item, extract unresolved notes as open tasks. Keep detailed proposals in `plans/` and link them from the task. Add new tasks to their product section, preserving author priorities and agent attribution.
