# Opening data import review

Ticket 25 / GitHub issue #26. Baseline: `e24c4fbc29b33c537a8dc9556f911bc3f546d953`. Native Sol HIGH backend and UI lanes implemented the feature. Both source-review axes are clear after repair; root independently accepted the integrated feature on 2026-09-16.

## Required scope

Manager CSV upload, validation and a concrete immutable preview precede atomic acceptance of products/variants, opening stock with separate costs/FIFO chronology, and supported operating configuration. Explicit references can address existing records without silently overwriting them. Actual acceptance has a durable operation identity and replay-safe effects. Image binaries and old paper sales are excluded.

## Findings and disposition

- Repaired and rechecked: imported configuration uses owning-feature validation, including platform contact URLs, area/settings bounds and Inventory quantity/cost/threshold limits. Impossible calendar dates are rejected at preview. Missing explicit references identify their actual input file, physical line and column. Expense audit columns match the owning schema.
- Required preview completeness: include full catalog rows, separate cost batches, and all offer/coupon terms, dates, scopes, combinations and bundle/Buy-X-Get-Y contents. Counts alone are insufficient. Backend/UI coordinated an expanded typed preview.
- Repaired architecture: application-owned transaction ports coordinate eligibility, immutable-state recheck and cross-feature acceptance. The PostgreSQL adapter owns its transaction boundaries and preview persistence; each feature owns its validation and data writes. The original adapter-resident workflow was moved into an application coordinator.
- Maintainability: catalog, stock and configuration parsing is split into cohesive helpers without a generic import framework.
- Receiving chronology: one explicitly identified opening import receipt uses the import date. Individual batches retain their entered receipt dates and FIFO ordering. Do not mislabel every batch with the first batch's date or synthesize a history of old receiving events. Preserve chronology through later batch corrections.
- Duplicate/configuration-state review must cover actual collision keys and settings being changed. Changes to unrelated fields of existing offers do not automatically require invalidating an additive import.
- Final canonicalization repairs reuse Pricing's accepted coupon identity and Expenses' NFKC/whitespace/case canonicalizer in preview and insertion. Existing `WELCOME` conflicts with imported `welcome`; whitespace-equivalent Arabic expense categories cannot be duplicated. Regression evidence and both independent rechecks are clear.
- UI review verified the exact preview operation identity is reused for acceptance, with account-scoped cost-free markers, a Web Lock, and lost-acceptance-response recovery. A proposed extra pre-response preview recovery phase was considered and deferred: an abandoned preview has no stock/catalog/configuration effect, and the input files remain external. This is not a required acceptance-safety defect.

## Verification status

Initial HTTP and browser missing-feature red evidence was observed. All affected package/API typechecks and six real PostgreSQL HTTP cases passed; the final canonicalization recheck passed the same six cases in35.11 seconds. The internal UI typecheck and both real-browser cases passed (2/2 in30.6 seconds), including full preview, account/cross-tab protection and committed-but-lost acceptance recovery. Evidence: `.scratch/sol-implementation/25-runtime-evidence.md` and the UI lane's `.scratch/ticket25-opening-import-browser-green.log`.

The final Standards and Spec reviews have no residual actionable findings. Root passed typecheck across 19 workspace projects, all 180 HTTP tests, production builds/bundle separation, architecture checks, migrations 001–026 and zero-advisory audit. All 89 browser scenarios passed across the 87/89 full run and repaired 2/2 existing-sales recheck; both opening-import scenarios passed in the full run. See [the fulfillment review](order-fulfillment-review.md#root-acceptance) for the exact test-only repair, Windows harness lifecycle evidence and limitations. Final logs: `.scratch/sol-implementation/root-tickets-21-25-results.json` and `root-sales-route-fix.log`.

The unrelated `bravos-v1-grok-review.md` edit remains protected and excluded from implementation staging.
