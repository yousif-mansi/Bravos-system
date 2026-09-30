# Phase 1 operational updates — verification

Working-tree review against `b946a00212f4d47b38f80fc98e7a8eab09ee9395`. No commit is authorized yet. Requirements and later answers are recorded in [the Phase 1 update](../planning/phase-1-operational-updates.md).

## Scope and review boundaries

- Independent branch quantities with original FIFO cost-batch provenance; one branch supplies an entire online order.
- Inventory-first intake and existing SKU/pair selection for online merchandising.
- Cash, manually received online transfer, and split POS payments; branch-scoped durable offline queues and automatic retry.
- Human-facing POS/return references, phone/order return lookup, receiving-branch restoration, and concise feedback.
- Online sales recognized at confirmation, reversed on cancellation or failed delivery, with stock unavailable until inspection.
- Backup/restore compatibility and explicit rejection of legacy central-stock migration without a fresh start.

Pre-existing storefront design changes, the protected Grok review, local generated files, and the untracked Arabic font are outside this pass. No live database reset, catalog-content replacement, commit, or push was performed.

## Standards

The independent review found a stale Products form could replace newly added inventory variants. The catalog now checks the expected revision and exact existing variant IDs under a row lock before updating. Both current UI update paths supply these guards. The reviewer confirmed the fix; legacy callers can still omit the optional guard.

A later focused review of the offline migration repair found manager queue recovery could bypass the quarantine check. Both the feature service and application wrapper now check upgrade safety before submitting preserved sales; the reviewer confirmed this is resolved.

## Spec

The independent review found connected-sale proof acknowledgement omitted the tender, and cancellation required inspection before recording the revenue reversal. New completed-sale fingerprints now include tender while legacy payloads remain compatible. Cancellation now records its financial effect immediately and supports later stock inspection without a second reversal. Both fixes were re-reviewed.

Integration review also added the restore write guard to the new branch-balance table, repaired its rollback constraint, and made readable references retain all digits beyond 999999.

Browser verification found a prepared quote could bypass the cashier's later payment selection. Initial completion now validates the current tender, while a previously completed sale retries its frozen facts. It also exposed duplicate React keys in branch low-stock rows and an over-restrictive receipt retry guard; branch/variant keys now distinguish rows and an older immutable operation can replay without replacing a newer pending marker.

Production offline verification found the new version-4 upgrade overwrote an earlier quarantine decision for legacy sales with invalid paid-unit facts. It now preserves the blocked marker and original rows. Automatic sync and manager recovery both respect this exceptional data-integrity block; ordinary valid sales still synchronize without approval.

## Verification evidence

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed |
| Architecture/import checks | Passed |
| API, internal, storefront production builds | Passed, including bundle separation |
| Full PostgreSQL HTTP run | 223 passed / 14 failed initially, across 30 files; all initial failures resolved in targeted reruns |
| Migration rerun | 9/9 passed |
| Backup/restore rerun | 7/7 passed, including POS-/RET-1000000 after restore |
| Sales rerun | 3/3 targeted cases passed, including the two initial failures |
| Returns/online returns | 20/21 passed on rerun; revised rollback-guard assertion passed separately; initial stock/query failures resolved |
| Accepted offline tender/proof replay | Focused test passed |
| Windows recovery-permission rerun | All four failed cases passed after process-local PowerShell module-path cleanup; ACL enforcement unchanged |
| Affected browser workflows | 64/64 distinct cases passed across isolated runs |
| Production offline browser workflows | 10/10 distinct cases passed across the initial run and targeted repairs, including restart/reconnect and legacy-data quarantine |
| Restore browser workflows | 3/3 passed together in the final run, including paid offline sale recovery |
| Diff whitespace check | Passed |

The full HTTP run was not repeated after the targeted repairs. Its log is `.scratch/phase1-http-all.log`; the typecheck, architecture, and build logs use `.scratch/phase1-*.log`. The 64-case browser result is assembled by distinct test identity across the focused, core, and final-four reruns; overlapping runs are not counted twice. Production offline evidence is in `.scratch/phase1-browser-offline-production.log`, `.scratch/phase1-browser-offline-production-rerun.log`, and `.scratch/phase1-browser-final-offline-restore.log`. The last log also contains the final three passing restore cases. These results do not claim one clean, combined full-suite run.

The isolated browser stack was shut down after verification. No temporary diagnostic source logging remains. A transient Next.js development startup failure resolved on restart and did not require an application change.

The per-spec browser counts and supporting log map are recorded in `.scratch/phase1-browser-verification-summary.md`. Final root build and post-build typecheck both passed after the offline quarantine fixes.

## Operational boundary

Migration 030 deliberately refuses nonempty legacy central inventory. The user chose disposable test data and a fresh start; deployment must point at a newly initialized database rather than silently assigning old quantities to branches. Physical-device offline testing remains a separate release check.

The local setup command now accepts a validated `BRAVOS_SETUP_DATABASE_NAME`, defaulting to `bravos`. A fresh `bravos_phase1_20260929` database was initialized with all 34 migrations, two branches, and zero stock; the old database was preserved. The ignored prior environment file is `.local/dev-before-phase1-20260929.env`, and setup reused and verified the existing local demo credentials.

Independent review findings: Standards — two resolved (stale product saves and recovery quarantine bypass), none remaining; Spec — two resolved (payment proofs and cancellation timing), none remaining from that review. All selected browser gates passed.
