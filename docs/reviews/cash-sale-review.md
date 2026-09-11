# Cash-sale ticket04 implementation review

Accepted on 2026-09-11 (Cairo). Baseline: 63ec02345cf3c0c12c3385729b6341c63fb30365. GitHub issue5. Grok wrote all application code and tests; root guided, reviewed both axes and independently verified the final slice.

## Result

Connected Arabic POS supports code/size/color lookup, editable unpaid carts, optional customer details, server-accepted prices, employee deductions and attributed cash completion. Prices and per-unit paid values survive retries and later catalog changes. Sales, FIFO allocations, movements and discrepancies commit atomically with stable identities. Managers see all authorized details including retained batch costs; employees see their own permitted sales without restricted costs.

An already physically completed prepared sale is retained if a competing allocation consumes stock. Its unallocated remainder remains visible, costs remain incomplete, and affected availability stays zero until reconciliation. Pending preparations do not reserve stock. Offline POS and synchronization extensions remain tickets05/06.

## Standards

Final review found no remaining blocker. Sale and operation identities are locked in consistent order before state/stock decisions. Conflicting identities cannot leave partial allocations or query an aborted transaction. Every replay authorizes the viewer, and new completion checks cashier permission for the original branch. Catalog reads avoid nested acquisition of a held transaction pool. Known quantities are checked before unit expansion; later-line allocation failure rolls back earlier writes.

Feature public interfaces, inward dependencies, import/cycle checks and public/internal bundle separation are preserved. Stock keeps separate FIFO cost batches; costs are absent from cashier responses and pending-sale storage. No application changes were made by root.

## Spec

Final focused review found no remaining blocker. Unpaid quotes can be revised or abandoned; submission blocks concurrent edits and prevents stale quote acceptance. Completed operations retain original identities, payload and occurrence time. Check Result distinguishes unpaid preparation from completion and can recover a request lost before reaching the server without another payment or current-stock cart reconstruction. Foreign-operation recovery preserves a tab's own cart and identity; expected-ID cleanup cannot clear a different pending operation.

Verified examples include 300+200 minus50 allocating275/175, zero-total deductions, deterministic piaster allocation, FIFO batches, repeated-line quantity limits, original-branch permissions, cross-cashier privacy and occurrence time distinct from preparation/server recording time.

## Independent verification

| Check | Result |
| --- | --- |
| Typecheck | Passed |
| HTTP against real PostgreSQL | 68 passed,6 files |
| Production builds and bundle checks | Passed |
| Architecture after build | Passed,93 modules and72 private-import files |
| Migrations001–006 | Apply/latest down/reapply, full down/full reapply, and actual failing-runner rollback passed |
| Real browser suite | 27 passed |
| Dependency audit | Zero advisories |
| Whitespace check | Passed |

Root evidence is retained under ignored .scratch/grok-implementation/root-cash-sale-final-results.json and its listed logs. The first browser run exposed a test actionability race: concurrent Playwright clicks waited on a button disabled by the first submission. Grok changed only the test to dispatch two synchronous DOM events and verify one request/sale,12000piasters,quantity1 and stock3→2. A subsequent run exposed an immediate API request before branch selection finished; Grok added an observable active-branch readiness assertion. Root reran all27 browser tests after both test-only fixes; earlier passed backend/build/migration checks remained unchanged. Original failure logs are preserved.

Grok captured actual red/green for several repairs, including unauthorized replay, revoked-branch completion, pool starvation and the final browser submission/recovery defects. Some concurrent tests passed by scheduling before locking was added; no claim is made that every change had a failing-before-passing test. Source review complements the real concurrency checks.

## Limits and preservation

This is connected pending recovery, not the full offline queue. Promotions, Returns, manager corrections, reporting and discrepancy reconciliation retain their queued scope. No production deployment or hosting/domain booking occurred. The unrelated user edit in docs/reviews/bravos-v1-grok-review.md remains unchanged and excluded from the commit (SHA2563361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A).
