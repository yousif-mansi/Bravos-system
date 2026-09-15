# Order fulfillment review

Ticket 21 / GitHub issue #22. Baseline: `e24c4fbc29b33c537a8dc9556f911bc3f546d953`. Reviewed and independently accepted on 2026-09-16. Native Sol HIGH agents implemented backend and internal UI in separate worktrees; root reviewed, integrated and verified the sources.

## Scope

Confirmed orders can be shipped and delivered without another stock deduction. Pending cancellation has no stock effect; confirmed pre-shipment cancellation restores retained allocations and releases coupon use once. Failed parcels remain unavailable until inspection. Managers post inspected quantities, restoring only sellable original-batch units; unreceived and nonsellable units remain unavailable. Terminal failed-order closure releases coupon use only after all quantities have been classified.

Inspection drafts can be abandoned and replaced before posting, preserving their history and causing no stock or coupon effect. Delivered source facts and protected allocation provenance are exposed through feature public interfaces for the next online Returns ticket.

## Standards

Final source review: clear after repairs.

- Receipt entry originally interpreted a timezone-free value in the device timezone. It now resolves Cairo wall time explicitly, including DST, and rejects ambiguous/nonexistent instants. The browser scenario runs in `America/New_York`.
- Fulfillment action text is centralized and action switches are exhaustive rather than falling through to failed-order closure.
- Migration 024/025 downgrades have explicit preflight guards before destructive statements when retained fulfillment/disposition/release data exists. The migration runner remains transactional.
- Inventory owns disposition SQL, Pricing owns coupon release, and Online Orders composes their effects on one transaction client. The existing stock-clock and role/privacy boundaries remain intact.

## Spec

Final backend source review: no material findings. Review covered legal transitions, pending/confirmed cancellation differences, partial/multiple inspection, original FIFO restoration, coupon timing, exact replay, actor attribution and customer-receipt provenance. Root also identified and resolved the pending-cancellation database shape and mistaken-inspection-draft recovery before acceptance.

## Verification

Delegated focused evidence, not a substitute for root acceptance:

- Backend tracer: observed missing-route HTTP red, then 1/1 green on port55460.
- Expanded real PostgreSQL suite: 4/4 passed on port55462. Root's combined run also passed the final invalid-jump/duplicate-receipt assertions; final default port is55463.
- Affected backend/API typechecks passed.
- Internal typecheck and focused fulfillment browser scenario passed, 1/1 in31.9 seconds. Test synchronization/locator repairs were made before the final pass.
- Windows forceful PostgreSQL shutdown left verified orphan `io_worker` processes holding ports during failed restarts. Root stopped only the exact orphan workers after checking executable path, parent absence and process identity; those infrastructure failures are not reported as passing tests. The shared test harness now uses the installed native `pg_ctl` for graceful Windows shutdown through an idempotent public subclass override. This also handles the dependency's exit hook without stale process shutdown attempts. Its real Windows lifecycle check passed temporary start/query/stop, repeated stop, same-port restart, persistent-directory preservation, and zero new leftover workers/listeners. Evidence: `.scratch/sol-implementation/15-pg-lifecycle-check.log`.

Evidence lives in ignored `.scratch/worktrees/21-fulfillment/.scratch/sol-implementation/ticket21-focused-results.md` and `.scratch/worktrees/21-fulfillment-ui/.scratch/sol-implementation/21-ui-browser-green.log`.

The unrelated `bravos-v1-grok-review.md` edit is preserved and excluded from implementation staging.

## Root acceptance

Passed typecheck across 19 workspace projects, all 180 HTTP tests in 21 files, production builds and bundle separation, architecture checks, migrations 001–026 including rollback/reapply, and dependency audit with zero advisories. Browser evidence covers all 89 scenarios: 87/89 in the full run, then both failed existing sales cases passed after narrow test diagnostics and a lost-response interception synchronization repair. All new fulfillment/import browser scenarios passed in the full run. The first zero-stock fixture failure was not reproduced; receiving setup now explicitly asserts its response instead of silently continuing.

Playwright's Windows process cleanup could bypass the database's graceful stop and leave a worker holding the test port. The test-only harness now invokes authenticated loopback shutdown before web-server teardown. Both a failing and a passing browser run verified released ports, removed control files and no leftover PostgreSQL workers. This adds no production API endpoint. Direct strict checking of the harness scripts produced no errors; including the Playwright configuration separately exposes its pre-existing environment-type mismatch, while the established workspace typecheck and actual Playwright execution pass.

Final evidence: `.scratch/sol-implementation/root-tickets-21-25-results.json`, `root-sales-setup-diagnostic-2.log`, and `root-sales-route-fix.log`. No failed run is reported as a full pass.
