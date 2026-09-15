# Delivered online Returns review

Ticket 22 / GitHub issue #23. Native Sol HIGH backend and UI lanes extend the existing dedicated Returns workflow. Baseline `e24c4fbc29b33c537a8dc9556f911bc3f546d953` plus the frozen ticket 21 dependency. Root accepted the integrated change on 2026-09-16.

## Scope

Delivered online purchases retain their real source/channel and immutable confirmed paid-unit values. They have no invented physical sale or original branch. The selected handling branch remains separate. The 14-day Cairo receipt window, inspected sellability, original allocation batches, editable refund components, cash Owed/Paid and exchange settlement extend the existing physical workflow.

Partial returns suggest retained merchandise payment. A cumulative final return can include the remaining checkout charge once. Manager-authorized merchandise and checkout-charge amounts remain explicit, including through linked corrections. Delivered returns never release coupon usage.

## Standards

The backend composes public Online Orders and Inventory readers with Returns/Corrections in one transaction. The reviewed lock sequence is stock clock, source order, protected allocations/batches, then Return. Migration 027 enforces exactly one physical/online source and retains a guarded downgrade.

One heuristic finding was considered: direct posting and exchange posting repeat parts of locked-draft persistence. Root retained the two explicit operation entry points because their shared `planReturn` calculation already centralizes the unit/refund rules and their completion/settlement effects differ. Review and focused tests found no behavioral divergence; this is not an acceptance blocker.

UI review repaired duplicated refund calculation and pending-operation persistence, separating pure refund calculations, HTTP operations and shared browser persistence. Source review is clear after adding the explicit handling-branch label, customer identity and actor/Cairo-time details. A query deep link loads the exact authorized Return and rejects stale responses.

A provisional reporting reader introduced N+1 queries and additional private-table joins. It was removed entirely from this ticket, including its types and exports. Ticket 23 owns a replacement through period-filtered bulk projections at each feature's public boundary.

## Spec

Two material backend findings were repaired and independently rechecked:

- Aggregating prior returns into a prefix lost exact paid/free unit identity after an earlier return was cancelled or reduced. Active persisted unit spans and hole-aware selection now preserve the actual available units. Correction span records are retained in `recording_online_return_unit_value`.
- Corrections could target the beginning of the original order line instead of the corrected Return's batch spans. Stock and protection changes now derive from the exact current/desired spans, including later-batch reversals and upward quantity/sellability changes. Protection and stock changes remain atomic.

The focused Spec recheck found no residual material issue in those repairs. Physical Returns retain their existing movement path.

## Verification

- The initial public HTTP tracer observed the missing online source behavior before implementation.
- Affected package/API typechecks passed after a nullable reporting-field repair.
- Five new public HTTP cases against PostgreSQL passed in 20.57 seconds, including exact unit/batch correction regressions.
- Physical compatibility covers 15/15 cases across the full run's 13 unchanged passes and the repaired two-case recheck. The failures were assertions forbidding any `source` property in bounded history summaries; the approved generic contract includes only `{kind,id}`. A subsequent test-only expected-ID typo was also corrected. The final assertions retain the no-line-details requirement. Existing Corrections passed 7/7.
- Returns/internal/API typechecks and all focused browser checks passed: online Returns 1/1, physical Returns/exchanges 2/2, Corrections 1/1. The new scenario also opens the exact Return deep link. One test-only Node/browser Arabic punctuation mismatch was repaired by computing the expected Cairo display in the browser.
- Root integrated the clean backend/UI and extended migration 027 gates, including an actual guarded downgrade case. Root typecheck, all 186 HTTP tests in 22 files, production builds/bundle separation, architecture, migrations 001–027 roundtrip/failure rollback, and zero-advisory audit passed.
- All 90 browser scenarios passed across the full run's 89/90 and the repaired 1/1 recheck. The existing lost-acknowledgement privacy test left an asynchronous response listener active after test completion (`response.json: Test ended`). A bounded response wait now captures the intended cashier snapshot, and the test waits for its deliberate lost-response callback before removing that route. All business/privacy assertions remain. The focused case passed in 39.3 seconds including setup/teardown. No application fix was needed for this test lifecycle failure.

Evidence is in ignored `.scratch/sol-implementation/22-*`, `root-ticket22-*` logs and `root-ticket22-results.json`. That result file retains the original browser failure; `root-ticket22-sync-recheck.log` records the repair. No failed or interrupted run is counted as a pass. The unrelated `bravos-v1-grok-review.md` edit remains protected.
