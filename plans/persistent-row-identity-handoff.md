# Persistent identity handoff — 2026-10-02

## Prompt for the next agent

Finish the remaining work for `plans/persistent-row-identity.md`. Read CLAUDE.md and the plan's updated progress section first. The persistent identity implementation and latest fixes are already committed in this working tree. Preserve subsequent changes. Do not commit, stage, stash, or otherwise mutate Git without permission.

The implementation, regression coverage, and local validation are complete. Do not restart the migration. Integration validation passed (see below). No background review jobs exist.

## Implemented

- Fixed server test type errors and zero-row version-restore fixture; lint cleanup. Deleted-row assertions now ignore SQL return order. The 100,000-row limit suite has a 15-second timeout for full-suite contention.
- Migrated web API, snapshots, mutation responses, and live events to ID-keyed cells and revisioned Change responses. Grid tables are projections of server table records plus row records.
- Rebuilt workbook state around confirmed ID-keyed inputs and pending input/append overlays. Responses/events apply by revision; gaps refresh without blocking the mutation queue. Stable selection and drafts follow IDs. Version restore uses the mutation queue.
- Added data-table new-row editing, including zero-row tables and remote appends during drafts. Rapid Add row clicks allocate distinct IDs. Running button state follows IDs. Formula revisions are captured when editing starts; rejected stale drafts reopen.
- Live ready events compare revisions; EditorView loads before subscribing and cancels obsolete subscriptions.
- Removed engine inputsAfterEdit; retained formula rewrite coverage through formulasAfterEdit.
- Updated CLAUDE.md, README.md, AGENT_DECISIONS.md, todo.md, help/action docs, and plan progress.
- Migrated web test fixtures and added `apps/web/src/stores/identity.test.ts`, component regressions, and an e2e two-tab draft test.

Decisions retained from the original snapshot: migration 0010 combines undeployed steps; one click is one Change/revision/journal step; OVERWRITE removes rows when all writable columns are covered (formula columns excluded); migration retains existing data-table trailing rows. These are documented. The stale-formula guard remains spreadsheet-wide; narrowing it is a todo.

## Latest fixes reviewed; browser validation pending

Both are in `apps/web/src/stores/workbook.ts` and all 554 web tests passed after them:

1. Delayed paste completion used to extend the selection after the user had moved on. A browser trace showed Delete consequently clearing E1:E3 as well as the intended G1:G3. `writeCells` now accepts `selectWritten = false`; paste/import pass true and extend selection immediately after optimistic projection. Deferred-response coverage verifies a later selection stays put. A second regression covers a paste that grows into a new column; the store restores that endpoint after resize only while the original selected cell remains active.
2. Earlier reorder responses temporarily overwrote later optimistic moves. Added `optimisticBlockOrders`, `optimisticPageOrder`, and `showPendingOrders`. Deferred-response tests cover both block and page moves while the first response arrives with the second pending. Existing rollback tests pass.

The e2e block-order helper now reads attributes in one `locator.evaluateAll` call and polls expected orders, avoiding mixed DOM snapshots during a reorder.

## Validation evidence

- Focused store validation passed: 128 tests across `identity.test.ts` and `workbook.test.ts`.
- `pnpm check` passed after the new regressions: lint, formatting, typecheck, and 76 test files; 2,852 tests passed and 2 were skipped.
- `_scratch/2026-10-02T06-15-pnpm-e2e-test-postgres.log`: PostgreSQL 415 passed, browser 22/24. Both browser failures from that run were fixed (identity-following selection expectation and waiting for inserted-row response).
- `_scratch/2026-10-02T06-22-pnpm-e2e-test-postgres.log`: browser 23/25; the two failures are the latest fixes described above. The new two-tab draft test passed. PostgreSQL 414 passed and one failed on unordered deleted rows; the assertion has since been fixed locally.

## Integration validation

Done. `_scratch/2026-10-02T10-31-pnpm-e2e-test-postgres.log` shows browser 25/25 and PostgreSQL 417/417. Nothing remains for this plan.

## Sandbox restrictions and user preference

Docker socket access fails for pnpm test:postgres. pnpm e2e:remote fails because NODE_USE_ENV_PROXY=1 causes Node 24.21 to reject Playwright's localhost readiness Host header against the proxy address. Do not unset/bypass proxy settings or escalate around sandbox restrictions. The user cannot presently fix these and explicitly said to ask them to run tests. Problems are logged in `/home/joe/Code/ai_workdir/codex_papercuts.md`.

Browser trace files remain under test-results, especially the copy/paste and page block-order failure directories. Zip network records showed the unintended clear-cell payload, so the selection failure was a confirmed application bug.
