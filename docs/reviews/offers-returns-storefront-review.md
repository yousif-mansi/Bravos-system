# Tickets08,12,18 review and integration

Baseline: main3f1e9ed. Candidates were captured from isolated Sol HIGH worktrees before repairs and integrated in order08,12,18. All three tickets are independently accepted after the repairs and verification below.

## Standards review

Independent Sol HIGH review identified six actionable issues:

1.08 read catalog inputs and offer rules separately, allowing a price/rule combination that never coexisted in committed state. Preserve coherent quote inputs and accepted prices without holding a transaction while waiting for another pool connection.
2.08 expanded basket quantities into per-unit objects. Preserve counted ranges so valid request bounds cannot cause excessive memory use before shortage rejection.
3.12 returned success for a new refund operation identity after payment without binding that identity. An accepted identity must remain tied to its original content.
4.12 loaded every return and repeatedly hydrated related data. Bound list work and provide access to subsequent records.
5.18 silently treated unreadable cart storage as an empty cart and overwrote it; persistence failures also left an inaccurate saved claim. Preserve unreadable data, surface failure, and handle browser-tab changes.
6.18 accepted unrelated HTTPS hosts for branded contact links. Reject credentials and constrain each platform field to the corresponding service.

These are scoped correctness, durability and bounded-work repairs. No separate Fowler smell was retained as a blocker.

## Specification review

Independent Sol HIGH review found two ticket12 gaps: saved drafts could not be edited, and draft amounts were shown as actual Owed refunds. Drafts must remain editable and effect-free until posting. Manager-authorized refund values remain editable without a new cap or mandatory override reason.

No material scoped specification finding remained for08 or18. Fresh offline promotion evaluation belongs to11; delivered-online Returns belongs to22. Those later features are not prerequisite acceptance failures.

## Integration

Root-directed integration retained all existing expenses/media behavior, combined feature routes and permissions, preserved optional route code splitting and POS service-worker exclusions, and combined migrations001–013. Migration down/reapply checks retain the earlier recovery, expense, pricing and Returns assertions. The existing staff/public separation browser test now waits for the storefront's current catalog heading while preserving its access assertions.

All eight scoped review findings were repaired by Sol HIGH and rechecked by root. Pricing now uses counted ranges and a short read-only repeatable-read quote snapshot before the unchanged stock transaction. Returns has revision-checked draft editing, a neutral draft refund state, immutable original create identity, payment conflicts for unrelated retry identities, and paged summaries. The cart preserves legacy data and failed-storage state, synchronizes received storage events, and validates branded URLs through a shared domain rule.

Root verification after integration:

- Full workspace typecheck passed.
- All108 HTTP assertions passed across11 files. One suite teardown failed with Windows EBUSY while deleting its temporary PostgreSQL directory. After stopping verified orphan test workers, the affected setup-credentials file passed4/4 with clean teardown. No application changes were made for this environment failure.
- All production application builds completed. The bundle check initially matched the storefront-settings navigation label; root narrowed it to the unique form label, preserving the static-import and service-worker checks. The corrected bundle check passed.
- Architecture passed:164 modules,445 dependencies,131 files in the private-import check. Dependency audit reported no known vulnerabilities.
- Migrations001–013 passed apply/down/reapply, complete reverse/reapply and deliberate failed-runner rollback.
- Full browser suite:71/73 passed. Root confirmed two existing test-check defects: repeated same-product lookup did not await its fresh result before selecting variants, and a sale test rejected the normal workspace synchronization retry button. Sol repaired only those test checks, retaining the sale/stock/persistence assertions. Root then reran both complete affected files:20/20 passed, including all nine synchronization and eleven sales cases. This is a full run plus targeted repair verification, not a claim of a second full73-test pass.

Logs are under `.scratch/sol-implementation/root-08-12-18-*.log`. The unrelated user edit in bravos-v1-grok-review.md remains excluded; its SHA256 is3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A.
