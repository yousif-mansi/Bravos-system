# Online order confirmation review

Status: ticket 20 independently verified on 2026-09-15 (Cairo).

Baseline: `b1185b2ef9b93a19cd3de25caebd0ce2773d5359`. GitHub issue #21 and the approved v1 specification define the scope. Three native GPT-5.6 Sol HIGH agents implemented Inventory protection (migration 022), order processing/API (migration 023), and the Arabic staff interface. Root coordinated contracts, reviewed, integrated and independently verified the result.

## Standards

No residual material findings. Confirmation acquires the common stock-clock update lock, rechecks the agreed transaction, protects FIFO stock, claims coupon usage, bumps the stock version, and records confirmation inside the same repeatable-read transaction. Replay returns the retained accepted response before new live-state checks. Feature adapters own their data and compose through public transaction ports. Representatives receive no purchase costs or internal profit facts.

The UI review found and resolved invalid draft quantities silently omitting lines and per-action retries hiding unresolved actions. It now validates every quantity, omits only explicit zero, and uses one order-scoped pending record and Web Lock. Root also identified stale account/route callbacks and queued mutations crossing a login change; lifecycle checks now guard both responses and dispatch. A different retained operation requires explicit retry. The targeted Standards recheck is clear. Production bundle guards verify dynamic loading and exclusion from login imports and the offline service-worker precache.

## Spec

No residual material findings within ticket 20. Original requests remain separate from customer-agreed quotes and confirmed snapshots. Confirmation requires explicit customer agreement and physical set-aside attestation. FIFO protection survives receiving and stock corrections; completed physical sales remain recorded with an unallocated discrepancy when protected stock is unavailable. Authorized representatives and manager backup can record contact attempts and manually cancel unreachable requests after the configurable wait and minimum attempts; no automatic expiry is introduced.

The Spec review identified missing stable replacement transaction-line identities and incomplete typed paid-unit ranges. The repair retains immutable line IDs and exact unit indexes, quantities, listed prices, discounts and paid amounts in agreement/confirmation snapshots. A one-piastre discount over three units, subsequent catalog repricing and exact confirmation replay verify historical values remain unchanged. Future Returns can reference `(orderId, lineId)` without recalculating prices or adding premature Returns persistence. The Spec recheck is clear.

Manager backup can perform pending-order corrections through retained revisions. Shipment/delivery and explicit pre-shipment cancellation/release remain ticket 21. The UI chooses customer-agreed replacements through the existing public-safe catalog.

## Verification

- Observed initial red: public HTTP agreement-quote route returned 404 instead of 201; browser lacked Online Orders navigation. Implementation followed those failures. Logs remain under each lane's ignored `.scratch` directory.
- Root combined typecheck passed across 17 workspace packages.
- Root full HTTP suite passed: **170/170 tests in 19 files**, including eight order-processing stories and three protection stories. Coverage includes competing confirmations, prepared completed cash-sale races, final coupon use, stale review rejection, role boundaries, manual cancellation timing, stock correction protection and exact retained unit values.
- Full browser run passed **85 existing regressions** and exposed a branch-selection timing flaw in the new test helper. After that test-only repair, a focused rerun exposed an unbounded delayed-request simulation. The test now explicitly waits for request interception and uses bounded completion assertions. Root's final affected-file rerun passed **1/1** (26.8 seconds). Together all 86 browser scenarios passed; the failed initial run remains recorded rather than presented as a green full-suite run.
- Production builds and bundle separation passed. Architecture import/cycle and private-interface checks passed.
- Migration 001–023 apply/down/reapply and the failing-runner rollback test passed; the standalone scratch roundtrip passed. Downgrades refuse to discard protected allocation or order-handling history.
- Dependency audit passed: zero reported vulnerabilities.
- Root visually inspected the Arabic order-detail screenshot. Original/customer-agreed versions and the confirmation action are clearly separated.
- `git diff --check` passed. The unrelated edit in `docs/reviews/bravos-v1-grok-review.md` remains excluded; SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

Root evidence: `.scratch/sol-implementation/root-ticket-20-results.json` and its named logs. Heavy runtime used one shared slot. One verified orphan PostgreSQL I/O worker was stopped after its parent exited during Windows test teardown; active databases were preserved. No application changes followed the combined gates; the final changes repaired only browser-test synchronization and recorded verification.
