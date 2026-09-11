# Receiving and central stock review

Baseline: `477b4f85a3e05ff17430923e4416681c998963ac`. Independently accepted on 2026-09-11 (Cairo) for ticket03 / GitHub issue #4. Grok wrote the application and repository tests. The orchestrator reviewed the actual source, reran the required gates, and added an ignored diagnostic solely for independent verification.

## Delivered behavior

Managers can receive merchandise online with quantities, receipt dates and separate purchase-cost batches, inspect receipt details and central stock, and configure the global low-stock threshold or a variant override. Zero-stock variants are included in alerts. Cashier lookup receives actual central quantities without purchase costs. Referenced variants cannot be removed by catalog edits.

A shared database transaction records the receipt, batches, movements and deduplication claim once. Equal retries replay the accepted operation; changed payloads conflict. FIFO ordering uses recorded receipt time and stable batch identity. Actual FIFO withdrawals arrive in the cash-sale ticket; no average cost or branch stock balance is introduced.

Browser submissions retain their operation identity across uncertain responses, edits, reloads, tab closure and concurrent tabs. Only opaque staff-scoped operation metadata and payload digests are persisted; manager purchase costs remain out of browser recovery storage. Receiving remains online-only.

## Findings resolved

Standards and Spec reviewers rechecked the final source without a remaining actionable blocker. Repairs moved persistence ordering out of the domain, included never-received variants in alerts, retained override-clear attribution, and allowed safe removal of unreceived threshold-configured variants. Actual partial-write rollback was verified with a second-line PostgreSQL foreign-key failure followed by a successful retry using the same operation ID.

Receiving recovery repairs retain immutable submission identity, acquire a synchronous submit/check latch before asynchronous hashing, coordinate shared markers with browser locks, conditionally clear only the expected operation, and preserve a tab's local submitted identity when another tab clears or changes shared storage. Catch paths do not overwrite another operation's marker.

## Independent verification

All required gates passed against the final application source:

- Typecheck.
- 45 HTTP tests in five files against real PostgreSQL, including receipt atomicity, duplicate/concurrent operations, permissions, quantities, separate batches, low-stock settings and migration failure rollback.
- Production builds, followed by import/cycle/public-boundary and bundle checks.
- Migration apply/down/reapply, full down, and full reapply through migrations 001–004.
- 15 real-browser tests, including receiving-to-cashier stock lookup, lost responses, reload/close recovery, synchronous double-submit and two-tab marker clearing.
- Dependency audit: zero advisories at every severity.

Evidence: `.scratch/grok-implementation/root-receiving-final-results.json` and the referenced logs. The final ignored browser diagnostic (`root-receiving-cross-tab.spec.ts`, `root-receiving-cross-tab.log`) also passed: A commits six units with a dropped response; B reconciles A and then commits two more units with its own dropped response; A retries its original ID without erasing B's marker; B recovers its own result. Exactly two receipts and batches of six and two remain.

That diagnostic covers a gap in the repository's last regression: its injected marker has an invalid staff ID and therefore exercises missing/invalid marker handling, rather than a valid second operation for the same staff. The genuine same-staff case is independently verified. The prepared Grok test-only brief `.scratch/grok-implementation/03-valid-marker-test.md` can promote this additional coverage into the permanent suite when Grok is available.

## TDD and execution record

Grok executed initial red HTTP tests before the receiving implementation. Repair runs include actual double-submit and storage-clear red failures; the latter lost the Retry button after another tab cleared the marker. Do not infer red evidence for every later recovery variation. Root independently ran the final green suite and supplemental browser diagnostic.

Grok run5 stopped with HTTP 402, `Grok Build usage balance exhausted`, after saving its last repair. Its truncated report is not acceptance evidence; independent verification above is. No fallback implementer was substituted. Further queue implementation requires Grok availability.

The supplemental diagnostic initially failed to start because its scratch config needed an explicit workspace directory, then because an owned test PostgreSQL worker remained after teardown. Root corrected the diagnostic configuration and stopped only the verified workspace worker PID 4524; the diagnostic then passed. The application source was unchanged during root verification.

## Scope and next step

Cash sales, offline operations, receiving corrections, Returns, orders and reporting remain in their owning tickets. This is a verified local development milestone, not production readiness. No hosting/domain purchase or deployment occurred. The unrelated user edit in `docs/reviews/bravos-v1-grok-review.md` was preserved and excluded from the commit; SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

## Permanent regression follow-up

After the user restored Grok availability on 2026-09-11, Grok added the genuine same-account two-operation case to tests/browser/receiving.spec.ts. It retains the earlier missing-marker case and verifies A's retry preserves B's complete pending marker, followed by exactly two receipts and batches6/2. An existing low-stock assertion now allows the whole container to be absent when empty while still rejecting the product's inclusion. No application code changed.

Standards and Spec reviews found no actionable blocker. Root independently passed typecheck and all10 receiving browser tests (34.8s). Logs: .scratch/grok-implementation/root-receiving-regression-typecheck.log and root-receiving-regression-browser.log. The first sandboxed typecheck was blocked by child-process EPERM; the approved run passed. Grok separately passed the same checks after cleaning up an exact owned test worker. No new red product-defect claim is made for this coverage addition. The previously prepared test-only brief is now fulfilled.
