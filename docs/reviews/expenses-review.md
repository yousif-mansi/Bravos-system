# Expenses implementation review

Ticket 07 / GitHub issue #8 is independently accepted on 2026-09-15. Candidate worktree: `.scratch/worktrees/07-expenses`, branch `codex/07-expenses-sol`, baseline `df408b0cfbce26a90a090bab7a94409e20d14af4`; root integrated it onto accepted synchronization commit `2650a40`. Implementation and independent reviews use GPT-5.6 Sol at high effort under the user's updated parallel-work mandate.

The candidate includes an expenses feature, manager-editable categories, employee/manager scopes, immediate effective totals, linked corrections/cancellations, migration 010, and a lazy Arabic staff interface. The implementer reported 4 focused HTTP tests, 1 browser flow, migration checks, typecheck, builds and architecture passing. These reports are not a substitute for final independent verification on integrated code.

## Standards

Independent source review found three issues, all repaired and rechecked:

1. P1: operation replay reloads the current expense rather than its original accepted result. A retry after a later correction/cancellation can acknowledge a different revision.
2. P1: effective details and history are loaded in separate statements without a coherent snapshot; a concurrent correction can make them disagree.
3. P2: active-category validation is not serialized with new expense/correction writes, allowing a concurrent deactivation to race validation.

Employee/branch scoping, effective totals, manager-only changes, and feature imports otherwise conform to the documented architecture.

## Spec

Independent source review found three issues, all repaired and rechecked:

1. P1: replay must preserve the accepted operation result, including when subsequent operations change the expense.
2. P1: a returned expense must have consistent effective revision and linked history under concurrency.
3. P2: the Arabic correction history omits before/after amount, date, category and description even though the API supplies them, preventing inspection of intermediate corrections.

No material scope creep was found. The two P1 findings overlap with Standards but are retained by review axis.

## Repair and independent verification

Operation receipts now retain the accepted revision, and replay loads that revision even after later corrections/cancellation. Repeatable-read snapshots keep effective details and linked history consistent. Active-category reads hold shared locks through expense writes. The Arabic detail view shows complete before/after values for every correction, including intermediate revisions. Focused regression evidence covers replay after cancellation, concurrent reads/corrections and visible history. Root source recheck found no remaining blocking finding in either axis.

Root independently verified the integrated candidate: typecheck, 8 expense/migration HTTP tests, migrations 001–010 roundtrip and deliberate failure rollback, the full expense browser flow (1/1), production builds, bundle separation, and architecture (122 modules / 317 dependencies). Migration integration preserves 009 when reverting 010 and still verifies removal of 009 when reaching the earlier 008 regression. Expense runtime remains online; the new lazy page is excluded from the POS offline precache. No stock or completed-sale behavior changed.

Root logs: `.scratch/sol-implementation/root-07-{typecheck,http,migrate,browser,build,architecture}.log`. The protected user review hash remains unchanged. This is a locally verified feature milestone, not a production release.
