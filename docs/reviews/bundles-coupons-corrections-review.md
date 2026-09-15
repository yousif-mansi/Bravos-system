# Tickets 09, 10 and 14 review and integration

Status: accepted after independent Standards/Specification review, scoped repairs and root verification on 2026-09-15 (Cairo).

Three GPT-5.6 Sol HIGH implementers worked in isolated worktrees from source baseline `6004d52ee8382f3d3da97781870b1722d59c7561`. Root integrated their changes and owns verification and acceptance. Two independent reviewers assessed Standards and Specification separately. GitHub issues #10, #11 and #15 define this batch's completion scope.

## Delivered behavior

- **09:** Manager configuration for fixed bundles and Buy-X-Get-Y, including partially discounted rewards. Pricing selects complete applications, disjoint purchase/reward units and cheapest eligible rewards without expanding large quantities into per-unit arrays. Accepted offer details and paid ranges survive later rule edits and support exact Returns.
- **10:** Manager coupon configuration and cashier apply/remove. Automatic offer, coupon and employee deduction remain separate effects. Usage claims are atomic and duplicate-safe. Accepted quotes retain values after rule edits. Legacy no-coupon identities remain byte-compatible; a coupon conflict after physical completion retains the exact local sale with a visible synchronization failure.
- **14:** Online manager-only linked corrections and cancellations for saved sales and posted Returns. Original records remain intact. Explicit merchandise and cash facts apply once, with actor, reason and time. Corrected quantities retain real FIFO allocations; Returns payment uses the effective authorized amount. Arabic views show original/current totals and lines, plus actual cash and stock effects.

Migrations 014–016 accompany these workflows. Cached promotion evaluation/offline overuse reconciliation, exchanges, online checkout/order lifecycle and reports remain assigned to their later tickets. This is local implementation, not a production release.

## Standards review

Concrete findings were repaired and independently rechecked:

- Bundle/coupon HTTP fixtures use a controlled business date; the large-count test checks bounded behavior without a machine-speed assertion.
- Offer concurrency verification uses PostgreSQL blocker/lock metadata rather than matching production SQL text.
- Coupon and correction assertions use authenticated business reads and operation replay behavior. Direct SQL remains only for controlled fixtures and the documented legacy identity probe.
- Return detail, list and payment paths share effective-refund projection. An obsolete batch-restoration helper was removed.

Two broader suggestions were deferred: discriminated offer-detail types/per-kind policies, and a generalized shared monetary allocator. These were maintenance heuristics rather than demonstrated incorrect behavior. The existing validated pricing engine and separate ordered effects remain, with exact combined regression coverage; this batch does not introduce a wider pricing refactor.

Final targeted recheck found no outstanding concrete Standards issue.

## Specification review

Concrete findings and missing evidence were resolved:

- Actual Returns tests verify free and partially discounted rewards after rule edits, exact original-batch restoration, duplicate retries and unchanged sibling paid values. The Arabic browser flow verifies complete fixed bundles and incomplete-bundle fallback.
- Coupon usage rechecks the accepted identity after taking the coupon lock, making concurrent identical callers replay safely. Root combined tests cover free/partial rewards, coupons, employee deductions and subsequent Returns.
- Invalid or stale corrections validate before claiming an operation, leaving no partial receipt/stock/cash effect. Recording undercounts can allocate additional actual FIFO stock and retain paid values for later Returns.
- Return inspection corrections restore the batch belonging to the selected Return units, including separate unsellable Returns from different cost batches.
- Corrected refunds agree with the ordinary Returns payment workflow; prior payments remain actual facts.
- Source-sale cash totals count each original Return refund once even when that Return has multiple corrections. Explicit correction payments/recoveries aggregate separately.
- A sale may be cancelled after its linked Returns are explicitly cancelled; drafts and effectively active Returns still block cancellation. Prior actual stock/cash facts remain visible.
- Arabic correction details include original and current line quantities/values or sellability, including cancellation history.

Final targeted recheck found no outstanding concrete Specification issue.

## Root verification

- Combined final workspace typecheck passed.
- The full HTTP run passed all 124 assertions across 14 files. One receiving-suite teardown failed with Windows `EBUSY` after its assertions passed. Root stopped only the verified orphan test PostgreSQL worker; a clean rerun of receiving, Returns and the final corrected corrections suite passed **18/18 across 3 files**. This includes the added regression, for 125 distinct HTTP tests in the final source.
- Earlier combined pricing verification passed 15/15; the repaired coupon suite passed 7/7 again. Exact combined reward/coupon/deduction refund values are covered.
- All three production applications compiled. Bundle separation passed after replacing a common navigation-label marker with a distinctive correction-screen marker. Named chunk, static/dynamic import, service-worker and public-storefront guards remain enforced.
- Full browser suite: **76/77 passed**. The existing Returns test attempted an unscoped button assertion while search results were updating. Selecting the seeded sale identity repaired the test; both complete Returns and corrections files then passed **2/2**. No product behavior was changed for this repair.
- Final architecture: 173 modules, 484 dependencies; private-import check: 140 files. No violations.
- Migrations 001–016 passed apply, latest-batch reverse/reapply, full reverse/reapply and failed-runner rollback. A stale variable in the scratch script final log was corrected and the entire script rerun successfully.
- Dependency audit: no known vulnerabilities. `git diff --check` passed.

Browser test repairs preserve existing product behavior: bundle fixtures identify variants by identity rather than UUID sort order; coupon Enter verification checks that the cart remains intact and no product search occurs, then uses the existing Accept prices button. The correction browser verifies a 100 EGP refund corrected to 80 EGP and actual payment of 80 EGP.

Evidence is retained under ignored `.scratch/sol-implementation/root-*.log`; lane evidence uses the `09-`, `10-` and `14-` prefixes. The unrelated edit in `bravos-v1-grok-review.md` is excluded, preserving SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.
