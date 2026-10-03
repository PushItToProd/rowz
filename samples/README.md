# Sample rowz documents

Import a JSON file from the **Import** button on the spreadsheets list. The records are fictional examples; replace them with your own data after importing.

- [Household inventory and warranties](household-inventory.json) tracks item locations, purchase dates, warranty dates, receipt references, and computed warranty status. The receipt paths are examples, not files included here.
- [One-hour fix queue](one-hour-fix-queue.json) checks task time, tools, and materials against editable settings. It suggests the eligible task with the smallest priority number; it evaluates each task independently instead of packing a set of tasks into the hour.
- [Gran Turismo 7 grind comparison](gt7-grind-comparison.json) compares what grinding one race for 40 hours pays, by how long a run of it takes. The Races data table lists each race with its payout and its shortest and longest run. A button rebuilds the Runs data table from it, with one row per race and minute, and formula columns work out what each run pays. `QUERY` pivots the runs into the comparison on the first page.
- [Monthly budget](monthly-budget.json) compares planned categories with a September 2026 transaction ledger and charts planned versus actual spending by category. Update the date ranges in its formulas when reusing it for another month.
