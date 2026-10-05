# Sample rowz documents

Import a JSON file from the **Import** button on the spreadsheets list. The records are fictional examples; replace them with your own data after importing.

- [Payday cash planner](payday-cash-planner.json) compares baseline and lean cash forecasts against an editable reserve target, with paychecks, bills, scenarios, a chart, and a low-balance summary.
- [Home maintenance and service history](home-maintenance-history.json) calculates next due dates from service records and includes a form that appends a completion to the log.
- [Meal planning, pantry, and shopping list](meal-planning-pantry-shopping.json) scales ingredient needs by planned servings, consolidates shared ingredients, subtracts pantry stock, and builds an editable purchase queue.
- [3D-print quote and actual cost tracker](3d-print-quote-and-actuals.json) estimates material, energy, wear, labor, and failure costs; accepting a quote freezes the price for later comparison with actual jobs.
- [Freelancer invoicing and follow-up](freelancer-invoicing-follow-up.json) turns unbilled work into frozen invoice lines, tracks partial payments, and highlights overdue balances.
- [Inventory movements and reorder desk](inventory-movements-reorder-desk.json) derives available stock from receipts, usage, and reservations, with reorder thresholds and physical-count checks.
- [Wedding guest list and caterer brief](wedding-coordination-caterer-brief.json) connects households, RSVPs, meals, table capacity, contributions, deadlines, and saved headcount snapshots.
- [Weekly CSV update, history, and notes](weekly-csv-update-history.json) validates staged rows, updates current records by stable key while preserving notes, and upserts week-and-record snapshots.
- [Household inventory and warranties](household-inventory.json) tracks item locations, purchase dates, warranty dates, receipt references, and computed warranty status. The receipt paths are examples, not files included here.
- [One-hour fix queue](one-hour-fix-queue.json) checks task time, tools, and materials against editable settings. It suggests the eligible task with the smallest priority number; it evaluates each task independently instead of packing a set of tasks into the hour.
- [Gran Turismo 7 grind comparison](gt7-grind-comparison.json) compares what grinding one race for 40 hours pays, by how long a run of it takes. The Races data table lists each race with its payout and its shortest and longest run. A button rebuilds the Runs data table from it, with one row per race and minute, and formula columns work out what each run pays. A script block names the `QUERY` pivot that both pages show, a checkbox on the first page adds Spa to it by writing to a cell on the Config page, and a text view works out from the runs when Tokyo beats Sardegna.
- [Monthly budget](monthly-budget.json) compares planned categories with a September 2026 transaction ledger and charts planned versus actual spending by category. Update the date ranges in its formulas when reusing it for another month.
