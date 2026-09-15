# Offline promotions, exchanges and receiving corrections review

Status: independently accepted on 2026-09-15 (Cairo). Tickets 11, 13 and 15 are complete after review repairs, integration and root verification.

Baseline: `1caace4e37bb63fec6dfc34cd473098e8b4b38fa`. Three GPT-5.6 Sol agents at HIGH effort implemented isolated candidates; root reviewed, integrated and verified the combined application. The implementation contracts are GitHub issues #12, #14 and #16 and the approved v1 specification. No hosting or domain was purchased.

## Standards

The independent receiving review identified a missing stable correction operation identity in the manager UI and a persistence record derived from a response DTO with fabricated original values. Both are repaired and independently rechecked.

The exchange review identified an incompatible downgrade after credit-backed cash settlement and a refund projection that could invent an outstanding amount after a correction. The downgrade now refuses to erase exchange history before executing destructive statements. Current refund amounts use the effective Return projection, separately retaining the accepted settlement. Both repairs passed the narrow independent source recheck.

Offline pricing review identified inconsistent versioned fingerprints in the exported completion service and snapshots mixing old catalog categories with newer pricing categories. Both are repaired and independently rechecked.

## Spec

The independent receiving review identified missing effective batch cost in linked sale/Return correction facts and replay responses that used newer receiving state instead of the originally accepted result. Both are repaired and independently rechecked. Accepted inventory values and correction history are pinned to their operation; descriptive product/staff labels continue to resolve from current master data.

The exchange review identified cash disappearing from exchange detail when a Return was cancelled without cash recovery. The repaired projection preserves unrecovered actual cash and passed the independent source recheck.

Offline pricing review identified lost quote-evaluation time across midnight and coupon accounting proofs that were not bound to accepted sale contents. Both are repaired and independently rechecked. Accepted pricing time remains separate from actual handover time; coupon accounting validates source, sale, operation, coupon and payload identity before excluding local use.

## Integration checks

Root review requires accepted exchange prices to be displayed before cash handover, credit to remain distinct from cash, original cost and effective corrected cost to remain separately available, and offline coupon use to count every physically completed redemption even when a global limit is exceeded.

The full focused Returns run exposed a concurrent-posting regression under repeatable-read isolation: a waiting transaction could retain a stale remaining-return quantity. Its repair uses the existing lock-then-read transaction behavior, with separately persisted coherent exchange price quotes. The repaired focused suite passed 12/12 before the final cash-projection regressions were added.

The receiving repair passed 12/12 receiving HTTP tests, 7/7 recording-correction HTTP tests, workspace typechecking, and the browser lost-response correction retry. Root independently passed typechecking of merged tickets 13/15 and the combined corrected-batch exchange/replacement-Return HTTP regression. Evidence is saved under ignored `.scratch/sol-implementation/15-repair-*`, `root-13-15-typecheck.log`, and `root-exchange-cost-combined.log`.

Root verified the combined exchange/receiving-cost/second-Return regression at the established HTTP seam. The full HTTP run passed 141/145 tests; four older expectations needed updates for additive safe category/effective-cost fields and the distinction between unprepared connected coupon claims and physically completed prepared sales. The focused recheck passed all four repaired tests, verifying all 145 distinct HTTP tests. The strict connected last-use race still permits only one winner; completed prepared sales are separately tested for preservation and counted overuse. Cashier cost-exclusion assertions remain in place.

Browser verification repaired test setup and action timing: offline cases now load the lookup route before disconnecting, and basket setup reuses an already displayed product instead of racing a second search that resets variant selection. The four integrated coupon browser cases pass, including accepted pricing across Cairo midnight, reconnect, cross-tab accounting and prepared last-use overuse.

The unrelated user edit in `bravos-v1-grok-review.md` remains excluded from this batch.

## Root verification evidence

Evidence is saved under ignored `.scratch/sol-implementation/` with prefix `root-batch-11-13-15-`.

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed across 16 projects |
| HTTP against real PostgreSQL | Full run 141/145; four repaired expectations passed 4/4 in the focused recheck, covering all 145 distinct tests |
| Production builds and bundle separation | Passed for API, internal application and storefront; 20 internal files, 160 storefront files, 3 static entry files |
| Architecture | Passed: 174 modules / 493 dependencies, plus private-import check across 141 files |
| Migrations | 001–019 apply, latest-batch reverse/reapply, full reverse/reapply and actual failed-runner rollback passed |
| Coupon browser regression file | 4/4 passed before the full browser run |
| Full browser suite | 80/81 passed; the repaired saved last-unit recovery fixture passed its focused 1/1 recheck, covering all 81 distinct tests |
| Dependency audit | Zero advisories across 648 dependencies |
| Diff and protected user file | `git diff --check` passed; excluded user review SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A` |

The HTTP suite also verifies that migration 018 refuses downgrade with completed exchanges, preserves migration bookkeeping on failure, and retains accepted cash facts. This deliberate guard prevents a downgrade from converting exchange credit into fictitious cash.

The full browser run includes production offline restart/reconnect coverage. Its one failing recovery fixture manually rebuilt a pending record without the new accepted pricing time, causing strict immutable replay validation to reject it. The one-line fixture repair preserves that field just as the real producer does; application validation was unchanged. Evidence: `root-batch-11-13-15-browser-recheck.log`. The full runs and focused rechecks are reported separately rather than presented as single clean full-suite passes.

Independent review disposition: Standards 6 findings resolved; Spec 5 findings resolved. Neither axis has an outstanding source-review blocker, and required runtime verification is complete. Original failing-test evidence and subsequent regression repairs are retained in the lane logs; no retrospective claim is made that every implementation began with a failing test.

## Test environment repair

Repeated Windows `EBUSY` failures occurred after all HTTP assertions passed. The installed embedded PostgreSQL helper starts process-tree termination without awaiting every child before immediately deleting its temporary directory. The test wrapper now owns deletion, retries bounded transient failures, and validates a direct `bravos-pg-*` child of the temporary directory before deletion. Explicit persistent directories are untouched; exhausted cleanup errors still fail the run. The narrow independent Standards review found no blocker. The root full HTTP run, focused recheck and scratch migration roundtrip completed without the cleanup failure.
