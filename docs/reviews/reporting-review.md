# Management reporting review

Ticket 23 / GitHub issue #24. Baseline: accepted commit `9d988d311679f635a3307b94161dc9c5317a1a96`. Sol HIGH backend and UI lanes implemented the reporting feature; Claude (root) separated it from the concurrently integrated ticket 24 work, ran independent Standards and Spec reviews, repaired the findings and verified the result. Ticket 24 exports and analytics remain uncommitted and are not part of this acceptance.

## Scope

Manager-only Arabic reports cover today, a Cairo day or a Cairo calendar month, with branch, channel and employee filters. Completed physical sales and Delivered online orders count at final value; pending, confirmed, shipped and failed orders stay in the operational counts. Returns count in their posting period at the actual authorized refund, keep their original sale or order link and attribute to the original branch rather than the handling branch. Reports show purchases, effective expenses, best sellers, low stock, available and protected inventory value, merchandise gross profit and operating profit. Unknown costs are marked incomplete instead of zero. Reports are projections over owning-feature facts; no reporting table or migration is added.

The reporting service also provides the bounded export snapshot and row limit that ticket 24 consumes. Export routes, PDF/Excel rendering and analytics are ticket 24.

## Integration separation

The root checkout contained tickets 23 and 24 integrated together, with unresolved merge markers in `scripts/scratch-migrate.ts` and `tests/http/migrations.test.ts`. The ticket 23 candidate removes every ticket 24 package, migration, route, page, storefront event and shared-file addition, resolves both conflicts to the integrated ticket 23 side and regenerates the lockfile (workspace links only). Every remaining file was compared with the verified `23-reporting-ui` worktree. The reporting browser test uses the worktree version: the root copy had a ticket 24 edit sending `totalPiasters`, which the committed Returns contract rejects.

## Standards

Independent review found one P2 and five P3 findings. Resolved:

- Reporting's `node.ts` composed eight other features' `/node` adapters. The snapshot unit of work now lives in `packages/reporting/src/adapters/postgres-reporting.ts` and receives feature readers from `apps/api/src/app.ts`, following the opening-import composition. The unused catalog dependency was removed.
- Reporting errors carry `code = "VALIDATION"`; the export row-limit error has an Arabic message and uses the ordinary 400 mapping.
- Missing referenced records during report composition are server faults (500), not client validation. Arithmetic overflow remains a validation error because narrowing the period resolves it.
- Purchase receipt corrections expose and display the responsible manager's name.
- A `reporting-domain-inward-only` dependency rule was added.

One finding was withdrawn: the cashier 403 is already covered over HTTP. Physical sale headings keep the sale ID, which is the system-wide physical sale reference. Heuristic duplication/data-clump suggestions were not applied, to avoid refactoring accepted code. The narrow recheck found no remaining or new Standards issue.

## Spec

Independent review found three P2 and several P3 items. Resolved:

- A sale cancelled without restoring stock previously removed its consumed batch cost. Cancelled sales now keep allocation cost adjusted by actual correction merchandise facts; revenue and completed count stay zero. Recheck found that a cancelled late sale with unallocated units must stay visibly incomplete; that is also repaired.
- New HTTP coverage verifies confirmed and in-transit protected value separately from available value, and a delivered online Return with merchandise 450 plus checkout charge 50 (A29 breakdown, original branch null, restored cost).
- With the online channel filter, the operating-profit card explains that branch expenses are not deducted.

The disabled/demoted-manager case was not added: only the owner holds the manager role, and existing staff-access tests cover session revocation. Final Spec verdict: all five acceptance criteria met. Untested low-risk areas are coupon/offer attribution in report details and cost after later discrepancy reconciliation.

## Verification

Red before repair: the unrestored cancellation and purchase-correction name assertions failed on the pre-repair source; the incomplete cancelled late-sale assertion failed before its repair. The protected-value/online-Return test passed on first run (coverage gap, not a defect).

Environment: the user's desktop Linux workspace ran typecheck, builds, architecture, migrations, audit and focused tests. Browser binaries could not be downloaded there, so the identical candidate ran the full HTTP and browser suites in a Linux cloud workspace. Earlier accepted tickets were verified on Windows; this run is not a Windows result.

| Check | Result |
| --- | --- |
| Workspace typecheck | Passed |
| Focused reporting HTTP | 14/14 |
| Full HTTP against real PostgreSQL | 200/200 in 24 files, single run |
| Production builds and bundle separation | Passed; reports load as `management-reports` and stay out of the POS precache |
| Architecture | Passed: 226 modules / 690 dependencies; private-import check 190 files |
| Migrations 001–027 apply/down/reapply | Passed; no new migration |
| Dependency audit | No known vulnerabilities |
| Full browser suite | 88/92; three failures (offline storage failure, order fulfillment date entry, synchronous double complete) passed their focused recheck 3/3 |
| Pre-existing browser failure | `online-returns.spec.ts` fails identically on unchanged `9d988d3` in this environment (customer receipt time rejected as not after shipment); not caused by ticket 23 |
| `git diff --check` | Passed |

Evidence: ignored `.scratch/claude-ticket23/` (`root-23-*` logs and the candidate patch). Earlier Sol lane evidence remains in `.scratch/sol-implementation/23-reporting-*.log`.

The accompanying Windows testkit repair was independently verified by the lane: embedded PostgreSQL uses synchronous I/O on Windows, shutdown checks IPv4/IPv6 listener closure, repeated stop and same-port restart work, and temporary/persistent directory handling remains correct. Evidence: `.scratch/sol-implementation/15-pg-lifecycle-sync.log`. This does not test PostgreSQL's asynchronous worker I/O path on Windows.

The unrelated user edit in `docs/reviews/bravos-v1-grok-review.md` is preserved and excluded.
