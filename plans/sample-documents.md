# Practical rowz sample documents

Date: 2026-10-04. This is a proposal for the sample collection, not a commitment to implement every candidate.

## What the samples should demonstrate

Build the collection around workflows people can operate: enter something, make a decision, click an action, and read a useful result. A good sample gives someone a reason to keep using the document after exploring its formulas.

The research covered [README.md](../README.md), [CLAUDE.md](../CLAUDE.md), the [help page](../apps/web/src/views/HelpView.vue), the [function reference](../packages/engine/src/docs.ts), and all four documents in [samples/](../samples/README.md). Reddit discussions supplied concrete needs; the proposed rowz designs below are a synthesis, not claims that those users requested rowz or that the discussions represent all spreadsheet users.

The GT7 sample already demonstrates much of the intended approach: several pages, editable assumptions, reusable calculations, a rebuild button, and prose that interprets results. The other three mostly demonstrate tracking and aggregation. Add forms, state changes, historical records, and reports that help someone decide what to do next.

The distinctive opportunity is the combination: a spreadsheet can also be the form used to maintain its records and the document used to explain them.

## Feature coverage

Coverage applies across the collection. Individual samples should use the features that serve their workflow; covering every built-in function is not a goal.

| Capability             | What a sample should demonstrate                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Pages                  | Separate daily operation, records, reports, and configuration. Cross-page references connect them.                      |
| Independent blocks     | Small tables, text views, charts, and scripts arranged in a readable page.                                              |
| Plain tables           | Compact forms, assumption panels, comparison matrices, and named settings.                                              |
| Data tables            | Named and typed columns, structured references, growing records, and formula columns that calculate new rows.           |
| Dropdown columns       | Fixed choices and choices drawn from another table, such as customers, recipes, or equipment.                           |
| Formula controls       | CHECKBOX and DROPDOWN bound to cells elsewhere, allowing controls beside a report.                                      |
| Sorting and filtering  | Useful working queues without changing stored records. Explicit formulas calculate totals intended to reflect a subset. |
| Single-record actions  | BUTTON, EXECUTE, and APPEND_ROW for forms, completion records, and captured values.                                     |
| Combined actions       | DO and CLEAR for saving and resetting a form, or changing status and recording an event.                                |
| Bulk actions           | INSERT for batches, UPDATE for keyed reconciliation, and OVERWRITE for rebuilding generated records.                    |
| Email actions          | A visible message preview followed by an explicit SEND_EMAIL button.                                                    |
| Computed text          | Markdown reports with values, tables, loops, conditions, formatted numbers, and links.                                  |
| Scripts and names      | Readable rules, named calculations, reusable functions, and ASSERT checks.                                              |
| Functions as values    | A practical LAMBDA, including one kept in a cell, plus MAP, REDUCE, BYROW, or BYCOL.                                    |
| Arrays                 | Filtering, sorting, combining, reshaping, and generating data without maintaining copied formulas.                      |
| Queries                | Grouping, calculated expressions, ranking, having, and pivot.                                                           |
| Lookups                | Connect tables by meaningful keys, including missing-match handling.                                                    |
| Charts                 | Bar, line, pie, and scatter charts with formula sources; charts inside text and cells as well as standalone blocks.     |
| Dates and calculations | Due dates, workdays, timestamps, financial scenarios, statistics, and text cleanup.                                     |
| Formatting             | Currency, percentages, dates, column widths, status criteria, and numerical color scales.                               |
| Error visibility       | Failed checks remain discoverable across pages and filtered rows. Handle expected empty results deliberately.           |
| Files and lifecycle    | CSV staging and export, importing samples, saving copies, undo, and history. Sharing can be an optional exercise.       |

## Candidate menu

The eight starred candidates are the recommended first batch.

### Household decisions and recurring work

1. **★ What can I spend before payday?** Monthly totals can conceal a cash shortage between paychecks, as described in this [personal spreadsheet discussion](https://www.reddit.com/r/excel/comments/1dz1vye/personal_uses_for_excel/). Pages: **This paycheck**, **Bills**, **Cash history**. Generate dated income and payment events, chart projected balances, and report the tightest day. A **Record payment** form appends an actual payment. Seed an annual bill and two paychecks on different schedules.

2. **Household expenses with unequal contributions.** Handle roommates or partners who split rent one way, groceries another, and personal purchases individually. Tables hold people, expenses, participation, and settlements. A dropdown selects the split rule; formula columns calculate obligations. A text view explains outstanding balances, and **Record settlement** appends a payment. Seed a purchase that includes only two of three roommates.

3. **Apartment hunting with explicit dealbreakers.** Pages: **Shortlist**, **Visits**, **Preferences**. Compare effective monthly cost, commute, required features, and ratings using editable weights and a reusable scoring function. Computed prose explains why each leading option qualifies or fails. **Save comparison** records current assumptions and scores. Changing the commute weight should change the ranking.

4. **Moving without losing track of the last dozen things.** Connect boxes, destination rooms, utilities, appointments, and tasks. Keep box IDs as text. Dropdown choices come from Rooms. A filtered page lists unpacked essentials; computed prose identifies unresolved tasks before moving day. **Packed** and **Unpacked** buttons record timestamps. Seed a kitchen essential packed in a box assigned to the garage.

5. **★ Home maintenance with a completion history.** Homeowners describe needing last-completed dates and upcoming work in this [maintenance discussion](https://www.reddit.com/r/HomeImprovement/comments/k863yq/). Pages: **Due now**, **Equipment**, **Service history**. **Complete task** appends date, cost, and notes, then updates the last-service date. Formula columns calculate the next due date. A report groups upcoming work by room or equipment.

6. **Renovation quotes and scope changes.** Compare contractor quotes by scope item, including exclusions and allowances. Separate original commitments, approved changes, and payments. A query produces a comparison matrix; **Approve change** records amount and date. Computed prose explains why the apparent cheapest quote may omit required work. Seed an omitted disposal charge and a change that exceeds the budget.

7. **Keep the car, repair it, or replace it?** Compare repair estimates, operating costs, replacement prices, and financing assumptions over an editable period. Use PMT for loan payments and a reusable cost function. A line chart shows cumulative costs; prose identifies which assumptions determine the ranking. **Save scenario** freezes inputs and results for comparison with later estimates.

8. **★ Meal plan → pantry check → grocery list.** People describe coordinating recipes, leftovers, produce waste, and shopping trips in this [meal-planning discussion](https://www.reddit.com/r/EatCheapAndHealthy/comments/g213og/). Pages: **This week**, **Recipes**, **Pantry**, **Shopping**. Recipe dropdowns and servings generate consolidated ingredient quantities, subtract pantry stock, and group purchases by store. **Build shopping list** writes editable purchase records with checkboxes. Seed a shared ingredient and a leftovers night.

9. **Is the bulk purchase actually cheaper?** Compare pack prices using normalized quantities, membership costs, consumption, and waste. A form selects product and household usage. Formula columns calculate usable unit cost; prose explains the result. **Log purchase** stores actual price and quantity. Seed mismatched package units and a bulk deal that loses after spoilage.

### Personal projects and hobbies

10. **Job search with contacts, resume versions, and next actions.** Applicants connect applications and networking contacts in spreadsheets, as this [job-search example](https://www.reddit.com/r/jobs/comments/kcp5jr/) describes. Pages: **Today**, **Applications**, **Contacts**, **Activity**. Choosing a company reveals contacts; **Log interaction** records an event and follow-up date. Computed prose lists next actions and posting links. Seed two roles at one company using different resume versions.

11. **Semester planner with grade scenarios.** Separate courses, assignments, grading rules, and weekly workload. Formula columns calculate weighted contributions; controls explore remaining-assignment scores. **Record submission** stamps completion and adds an activity record. A report identifies upcoming work and missing grades. Seed a heavily weighted final and grading weights that fail an assertion because they do not total 100%.

12. **Training log with a readable weekly review.** A form records activity, duration, distance, effort, and notes. **Save session** appends and resets it. Queries group weekly volume; line charts show trends; statistics summarize variation. Prose compares the current week with recent weeks and lists notable sessions. Seed a skipped week, mixed activity types, and an unusually long session.

13. **Backpacking gear: dollars per ounce saved.** Compare replacements by weight saved and cost, as in this [gear comparison](https://www.reddit.com/r/Ultralight/comments/bsa7s7/). Pages: **Trip pack**, **Owned gear**, **Possible upgrades**. Checkboxes select packed items; lookups pull weights. A scatter chart plots upgrade cost against weight reduction. A report ranks candidates within an editable budget.

14. **Garden seed starting, planting, and harvest journal.** Gardeners calculate sowing and transplant dates from frost dates and growth intervals in this [planning discussion](https://www.reddit.com/r/gardening/comments/10swaty/). Pages: **This week**, **Seed inventory**, **Plantings**, **Harvests**. **Sow batch** records variety, quantity, and date; **Log harvest** adds yield. Prose lists current tasks; charts compare harvest totals. Keep local timing assumptions editable.

15. **Sourdough recipe scaler and bake journal.** Store baker's percentages; select target dough weight and starter assumptions. A reusable function calculates ingredient quantities, accounting for starter contributions. Prose produces a mixing checklist with formatted weights. **Start batch** freezes the recipe; later entries record timing and results. Seed two successful batches with different hydration and fermentation times.

16. **Book club selection and meeting notes.** Connect candidate books, members, votes, reading status, and meetings. A selector changes a discussion page containing book details, attendance, and submitted questions. **Record meeting** saves selection and notes. Queries rank candidates and summarize completed books. Seed a highly rated book that exceeds the group's page-count limit.

17. **Co-op game crafting project.** Plan a shared build using recipes, required components, stock, and contributions. Formula columns calculate shortages; a query consolidates components across selected projects. **Record contribution** appends an event; **Rebuild requirements** replaces generated rows. Prose lists next obtainable components and completed milestones. Seed projects competing for the same scarce material.

18. **★ 3D-print quote and actual-cost tracker.** Makers describe costs beyond filament: preparation, postprocessing, electricity, wear, and failed attempts in this [pricing discussion](https://www.reddit.com/r/3Dprinting/comments/1k5fdqr/how_would_you_determine_the_real_costs_of_an_3d/). Pages: **Quote**, **Materials and machines**, **Jobs**. A reusable function calculates estimates; a chart shows costs. **Accept quote** freezes quoted values. Failures and actual labor feed an estimate-versus-actual report.

### Solo businesses

19. **★ Freelancer time → invoice → payment follow-up.** Freelancers describe juggling clients, invoices, and missed follow-ups in this [workflow discussion](https://www.reddit.com/r/freelancing/comments/1s0yash/how_are_you_all_tracking_clients_invoices_and/). Pages: **Work log**, **Invoice desk**, **Invoices**, **Payments**. Selecting a client generates a preview from unbilled work. **Issue invoice** stores line items and agreed rates. Partial payments update the balance; an optional email button sends a previewed reminder.

20. **Home bakery costing and order fulfillment.** A user links cake recipes to changing ingredient prices in this [personal-use thread](https://www.reddit.com/r/excel/comments/1dz1vye/personal_uses_for_excel/). Connect ingredients, recipes, sizes, orders, and deposits. Formula columns calculate estimates; **Confirm order** freezes the agreed price. The production page consolidates ingredients and writes a preparation checklist. Seed a custom order, partial deposit, and price increase.

21. **Reseller profit after fees, shipping, and returns.** Track acquisition lots, items, listings, sales, and refunds. Platform dropdowns select fee assumptions; formula columns calculate profit and days held. **Record sale** captures terms and removes the item from the available queue. A report identifies profitable categories and aging stock. Seed buyer-paid shipping and a return that reverses apparent profit.

22. **★ Inventory movements and a reorder desk.** Small operators describe quotes, reservations, payments, and fulfillment happening in different orders in this [nursery-business example](https://www.reddit.com/r/smallbusiness/comments/dveden/). Derive stock from receipts, usage, adjustments, and reservations. **Receive stock** and **Record usage** append movements. Calculate shortages and group purchases by supplier. Assertions expose negative stock and unknown IDs. Seed an unfulfilled reservation and a physical-count discrepancy.

23. **Supplier quote comparison for an actual order.** Compare a basket across suppliers, accounting for pack sizes, shipping, minimum orders, and lead times. A query pivots quotes; a reusable function calculates the cost of satisfying each quantity. Prose identifies the cheapest complete order and unavailable items. **Accept quote** stores selected terms. Seed a cheap supplier whose minimum order makes the total higher.

24. **Repair intake → parts → ready for pickup.** Pages: **Intake**, **Open repairs**, **Parts**, **Completed work**. Dropdowns select customer and device; **Open job** creates a record. Status choices and buttons record diagnosis, approval, and completion events. Prose distinguishes waiting for parts from waiting for decisions. Seed a repeat customer and a repair blocked by an unapproved estimate.

25. **Tool or equipment lending desk.** Connect individually identified equipment, borrowers, loans, and maintenance. Select an available item and borrower; **Check out** records the loan and due date. **Check in** records return and condition. Prose lists overdue items and unavailable equipment. Seed similar tools with distinct IDs and a returned item requiring maintenance.

26. **Retainer usage and scope-change register.** Track included hours, logged work, requested additions, and approved changes. A client selector produces a report explaining remaining allowance and work awaiting approval. **Approve change** captures scope, price, and date. Formula columns calculate usage against the agreement plus approved additions. Seed an unapproved request that would exceed the allowance.

27. **A realistic weekly capacity plan.** Connect workers, projects, time off, and planned hours by week. QUERY pivot produces a person-by-week matrix; color scales show load. A script names capacity and overload calculations. **Publish plan** saves dated allocations. Seed a part-time worker and a deadline week with reduced availability. This supports manual planning decisions; it does not promise an automatic scheduler.

### Work and community coordination

28. **★ Wedding guest list → seating checks → caterer brief.** Wedding workbooks combine guests, RSVPs, budgets, vendors, and schedules, as this [shared workbook](https://www.reddit.com/r/weddingplanning/comments/17qbrhh/wedding_google_sheets_workbook/) demonstrates. Focus on guests, households, meals, seating, and deadlines. Dropdowns assign tables; assertions check capacity. Prose generates meal counts, dietary notes, unresolved RSVPs, and payments. **Save caterer brief** records a dated headcount snapshot.

29. **Club dues and equipment checkout.** Connect members, payments, membership periods, equipment, and loans. Payment and checkout forms append records. Formula columns derive membership and borrowing eligibility. A treasurer's report lists outstanding dues and overdue equipment; a pie chart summarizes income categories. Seed a partial payment and a renewal starting next period.

30. **Volunteer event staffing and expenses.** Tables hold shifts, roles, volunteers, availability, assignments, and expenses. Dropdowns select volunteers; checks identify uncovered positions, missing qualifications, and overlaps. Prose produces the event-day briefing by time and role. **Publish roster** saves assignments, with optional email delivery. Seed an available volunteer who lacks a required qualification.

31. **★ Weekly CSV update with preserved history and notes.** A user describes adding weekly tables, lookups, and report-formula edits in this [reporting problem](https://www.reddit.com/r/excel/comments/1i6cw3s/). Pages: **Import staging**, **Current records**, **Snapshots**, **Weekly report**. Validate keys, update current data while preserving separate annotations, and save dated snapshots. A composite week-and-record key prevents duplicate snapshot rows. Prose describes changes since the previous week.

32. **Release readiness and a saved go/no-go record.** Connect requirements, evidence links, owners, exceptions, and decisions. Checkboxes and choices record completion and disposition. Assertions check evidence and blockers. Prose produces a readiness brief. **Record decision** stores release, timestamp, decision, and counts. Seed completed work with missing evidence to demonstrate document-wide error reporting.

33. **Incident timeline and shift handoff.** Pages: **Current incident**, **Timeline**, **Follow-ups**, **Review**. **Log event** stamps an entry from a form. Controls update mitigation and recovery records. Prose produces a handoff with status, recent events, and outstanding work. Closing the incident captures a summary. Seed a resolved incident with an unfinished corrective action.

34. **SaaS renewals with notice deadlines and accountable owners.** Administrators describe forgotten purchases, departed owners, and auto-renewals in this [renewal discussion](https://www.reddit.com/r/sysadmin/comments/1oeo21h/i_swear_saas_renewals_are_slowly_turning_into_a/). Track owners, costs, payment sources, renewal dates, and notice periods. Sort the queue by action deadline. **Record review** logs renew, cancel, or investigate decisions. Prose lists ownerless services and commitments, with optional email summaries.

35. **Cloud spend review from billing CSVs.** Pages: **Import staging**, **Allocation rules**, **Monthly review**, **Actions**. Lookups assign services or tags to projects; queries group and pivot spending. Charts show trends and distribution. Prose reports changes, unallocated costs, and largest contributors. **Save review** records a dated summary and actions. Seed an unknown tag and a distorting one-time charge.

36. **Hiring pipeline and interview follow-up desk.** Connect roles, candidates, interviews, contacts, and stage events. Dropdowns standardize stages; **Record interview** appends outcome and next action. Queries calculate conversion and time in stage; prose lists candidates awaiting a response. Keep notes distinct from status records. Seed a candidate applying to two roles and a stalled process with an expired next-action date.

## Recommended first batch

| Candidate                | Contribution to the collection                                   |
| ------------------------ | ---------------------------------------------------------------- |
| 1. Payday cash planning  | Familiar need; dates, scenarios, charts, and explanatory prose.  |
| 5. Home maintenance      | Simple, useful action-and-history workflow.                      |
| 8. Meal planning         | Related tables producing an operational document.                |
| 18. 3D-print quoting     | Reusable calculations, frozen quotes, and actual results.        |
| 19. Freelancer invoicing | Records becoming a customer-facing document and explicit action. |
| 22. Inventory movements  | Row actions, derived state, and visible checks.                  |
| 28. Wedding coordination | Pages, controls, reports, and snapshots.                         |
| 31. Weekly CSV reporting | Bulk updates, historical comparisons, and data checks.           |

## Sample quality

Give each document enough records to support an interesting decision. Include ordinary complications: partial payments, leftovers, missing quotes, late tasks, failed prints, unknown mappings, and overlapping commitments. Do not fill the sample with interchangeable placeholder rows.

Open with a useful computed summary and one concrete instruction, such as changing servings from two to four or completing the furnace-filter task. That interaction should visibly change another block or page. Use descriptive names, readable formulas, appropriate formats, and an editable reference date so the example remains coherent months later.

Keep live calculations distinct from historical records. Changing an ingredient price changes a new estimate; an accepted order retains its agreed price. A clicked snapshot captures values. This gives actions a substantive purpose.

Ordinary samples should import without unexplained errors. If a candidate deliberately demonstrates an assertion failure, identify the bad record and explain the correction. A guided edit that triggers and then resolves the check is also useful.

## Implementation constraints

- Actions run on clicks. Background reminders, external API synchronization, and public intake forms require additional features. Keep optional email supplementary so samples work without SMTP.
- Every action in DO reads the state before the click. Calculate intended values from that state.
- Table filters affect display. Reports summarizing a subset must express that subset in their formulas; SUBTOTAL also includes filtered rows.
- ASSERT exposes a failed check. A button that must refuse invalid work needs an explicit condition.
- Formula columns are computed, not stored, and cannot be action targets.
- Conditional formats test the formatted cell's value. Add a computed status or risk column when the criterion depends on other fields.
- Printed invoices, attachment storage, external payments, and automatic scheduling are not promised by these proposals. Text reports, recorded links, and explicit operations use the current app.

## Documentation discrepancies found during research

- README's missing-features list still includes sorting/filtering and conditional formats, although the app implements them.
- The help page says email never delivers, although the server supports delivery when SMTP_URL is configured.

Correct these when implementing the sample collection so the help does not undermine its demonstrations.

## Authoring support

The [create-rowz-document skill](../docs/agent-skills/create-rowz-document/SKILL.md) describes authoring importable raw JSON. The [import helper](../scripts/import-rowz.js) can authenticate, create a document through the API, and report engine diagnostics from its returned snapshot. Review layout and intended interactions in the web UI.
