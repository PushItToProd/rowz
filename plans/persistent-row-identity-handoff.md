# Persistent identity handoff — 2026-10-02

## Prompt for the next agent

Finish the implementation of `plans/persistent-row-identity.md` in this working tree. Read CLAUDE.md and the plan's updated progress section first. The original provider's engine/server snapshot was committed by the user; the subsequent web migration, fixes, tests, and docs are currently uncommitted. Do not commit, stage, stash, or otherwise mutate Git without permission (the Codex sandbox will block you anyway). Preserve all existing changes.

Implementation is substantially complete; remaining work is regression coverage and final validation. Do not restart the migration. No subagents were used. No background review jobs exist.

## Implemented

- Fixed server test type errors and zero-row version-restore fixture; lint cleanup. Deleted-row assertions now ignore SQL return order. The 100,000-row limit suite has a 15-second timeout for full-suite contention.
- Migrated web API, snapshots, mutation responses, and live events to ID-keyed cells and revisioned Change responses. Grid tables are projections of server table records plus row records.
- Rebuilt workbook state around confirmed ID-keyed inputs and pending input/append overlays. Responses/events apply by revision; gaps refresh without blocking the mutation queue. Stable selection and drafts follow IDs. Version restore uses the mutation queue.
- Added data-table new-row editing, including zero-row tables and remote appends during drafts. Rapid Add row clicks allocate distinct IDs. Running button state follows IDs. Formula revisions are captured when editing starts; rejected stale drafts reopen.
- Live ready events compare revisions; EditorView loads before subscribing and cancels obsolete subscriptions.
- Removed engine inputsAfterEdit; retained formula rewrite coverage through formulasAfterEdit.
- Updated CLAUDE.md, README.md, DECISIONS.md, todo.md, help/action docs, and plan progress.
- Migrated web test fixtures and added `apps/web/src/stores/identity.test.ts`, component regressions, and an e2e two-tab draft test.

Decisions retained from the original snapshot: migration 0010 combines undeployed steps; one click is one Change/revision/journal step; OVERWRITE removes rows when all writable columns are covered (formula columns excluded); migration retains existing data-table trailing rows. These are documented. The stale-formula guard remains spreadsheet-wide; narrowing it is a todo.

## Latest fixes that need focused review and browser validation

Both are in `apps/web/src/stores/workbook.ts` and all 554 web tests passed after them:

1. Delayed paste completion used to extend the selection after the user had moved on. A browser trace showed Delete consequently clearing E1:E3 as well as the intended G1:G3. `writeCells` now accepts `selectWritten = false`; paste/import pass true and extend selection immediately after optimistic projection. The post-save extension was removed. Add a deferred-response regression: start paste, move selection elsewhere, resolve save, ensure selection remains where the user moved it. Consider growth into newly created columns when reviewing immediate selection.
2. Earlier reorder responses temporarily overwrote later optimistic moves. Added `optimisticBlockOrders`, `optimisticPageOrder`, and `showPendingOrders`. Applying confirmed changes first restores accepted positions, merges the change, remembers confirmed orders, then reapplies pending order. Only the last queued reorder clears its optimistic order. Add deferred-response coverage for two moves where the first response arrives while the second is pending; verify rollback cases still pass.

The e2e block-order helper near `e2e/spreadsheet.spec.ts:567` reads attributes through multiple awaited positional locators; a reorder between reads can return an empty name. Consider making the read atomic with `locator.evaluateAll` and retrying expected orders with `expect.poll`. Fix the test race without hiding production ordering bugs.

## Validation evidence

- `/tmp/full-check3.txt`: pnpm check passed lint/typecheck and 76 suites, 2,848 passed, 2 skipped. This predates the two latest workbook fixes above.
- `/tmp/web-run6.txt`: all 554 web tests passed after those fixes.
- `/tmp/persistent-identity-final-check.txt`: final pnpm check stopped at Prettier because `todo-pending.nocommit.md` has formatting issues. That unrelated file was not edited by this agent; leave its contents intact. ESLint completed, but typecheck and tests did not run in this final attempt. No background check remains running.
- `_scratch/2026-10-02T06-15-pnpm-e2e-test-postgres.log`: PostgreSQL 415 passed, browser 22/24. Both browser failures from that run were fixed (identity-following selection expectation and waiting for inserted-row response).
- `_scratch/2026-10-02T06-22-pnpm-e2e-test-postgres.log`: browser 23/25; the two failures are the latest fixes described above. The new two-tab draft test passed. PostgreSQL 414 passed and one failed on unordered deleted rows; the assertion has since been fixed locally.

## Next actions

1. Inspect the final check output and fix any failures.
2. Add the two deferred-response regressions above and improve the e2e order helper if needed. Run focused web tests, then pnpm check after edits.
3. Ask the user to rerun pnpm e2e and save output in _scratch. They have a script that also runs PostgreSQL; that is fine. No request for another integration run is currently pending.
4. Read their log, fix actual failures, and repeat if needed. Update plan validation with final results. Report remaining limitations accurately. Do not call the work complete while browser validation is outstanding.

## Sandbox restrictions and user preference

Docker socket access fails for pnpm test:postgres. pnpm e2e:remote fails because NODE_USE_ENV_PROXY=1 causes Node 24.21 to reject Playwright's localhost readiness Host header against the proxy address. Do not unset/bypass proxy settings or escalate around sandbox restrictions. The user cannot presently fix these and explicitly said to ask them to run tests. Problems are logged in `/home/joe/Code/ai_workdir/codex_papercuts.md`.

Browser trace files remain under test-results, especially the copy/paste and page block-order failure directories. Zip network records showed the unintended clear-cell payload, so the selection failure was a confirmed application bug.
