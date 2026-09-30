# System improvement pass — remaining gaps

30 September 2026. Baseline: `dacf3c7`. This implements the user's renewed twelve-part system request before further storefront work. Four read-only Sol 6.1 audits preceded implementation. The earlier Phase 1 foundations are committed; this pass preserves them rather than rebuilding them.

## Current workflow and requirement coverage

| Requirement | Current implementation | Remaining work |
| --- | --- | --- |
| Branch inventory | Batch/branch balances, branch POS deductions, selected single-branch online fulfillment, receiving and returns preserve FIFO provenance. | Retain and verify existing guards; no second inventory model. |
| Inventory-first products | Receiving creates catalog-owned identity and actual pairs; Products selects an existing SKU, with autocomplete and size/color/pair visibility checkboxes. | Add a regression for bulk selection of sparse existing pairs; no product-flow rewrite. |
| Action feedback | Shared reveal/focus/highlight hook already used by catalog, receiving, returns and several editors. | Complete missing explicit edit/detail/preview feedback, loading and retry on remaining staff screens. |
| Inventory clarity | Receipt and batch views repeat original/effective quantities and costs. | Show actionable current facts once; retain before/after facts in expandable correction history. |
| Offline synchronization | Completed sales retry automatically on a timer, focus and reconnect; no ordinary manager approval. | Correct manual-sounding queue wording; preserve exceptional corrupt-data/account/restore recovery safeguards. |
| Order numbers | POS/RET references exist; online BRV formatting still truncates above six digits. Some reports display UUIDs. | Fix BRV formatting and propagate existing readable references through report readers/DTOs. |
| Return search | Phone/reference/date lookup exists, but merged results silently stop at 100; phone normalization differs by channel. | Add bounded paged lookup, consistent phone matching and explicit original-branch context. Keep anonymous-sale reference/date fallback. |
| Online revenue | Confirmation recognizes revenue and selected-branch stock once; cancellation/failed delivery reverses revenue, inspection controls stock restoration. | Preserve behavior and exercise existing regressions. |
| Return history | Readable return number/customer/date/amount/status exist; order, branch, product summary and reason are incomplete. | Add useful summaries and an optional recorded return reason; do not display internal identifiers. |
| Return wording | Many labels already simplified. | Finish concise labels while preserving eligibility, inspection and refund information. |
| POS payments | Cash/manual online/split with exact allocation already exist. | Show an explicit excess when entered payment exceeds the amount due; keep validation unchanged. |
| Checkbox states | Native green accent exists, but white tick is browser-controlled; internal radios retain beige accent. | Deterministic green/white checkbox states and green radio selection, with native semantics and forced-colors fallback. |

## Architecture and data/API impact — main-agent decisions

- Catalog continues to own product identity; inventory owns stock and costs. Inventory-first is the staff workflow, not permission to duplicate catalog tables.
- No stock, payment, synchronization, pricing, refund or permission-policy rewrite. Existing migrations 030–034 remain intact. Do not reset or populate the operational database.
- Inventory simplification is presentation-only. Current received quantity and remaining stock describe different facts; label them clearly. Preserve all original/corrected facts and cost batches, showing correction detail only when relevant.
- Return history gains an **optional** free-text reason. Existing records remain valid with no reason. A nullable additive migration is justified for this missing business fact; update feature-owned persistence, backup/restore and archive compatibility deliberately. Older reason-less request fingerprints/replays must remain valid. Do not invent historical reasons or make a reason mandatory.
- Preserve valid branch-aware migration-034 backups through a narrowly validated compatibility path that supplies a null reason after checking original archive integrity. Unknown schemas and incompatible central-stock archives remain rejected. Preview and activation must use the same deterministic conversion.
- Keep the legacy return-source array endpoint compatible. Introduce a bounded paged source-search endpoint (`/api/internal/returns/sources-page`) and DTO for the current UI. Feature-owned sales/order readers perform filtering and keyset reads; the returns application merges bounded pages. Stable time/channel/ID ordering must avoid omissions and duplicates, including equal timestamps. Apply cancellation/amount filters before limiting candidates. Preserve return eligibility and role authorization.
- Normalize phone search consistently for both channels while preserving stored display values. Nonempty input that contains no searchable digits must not turn into an unrestricted search.
- Reuse the existing `bravos_human_reference` database formatter for large BRV numbers. Reports receive existing POS/RET references through feature ports/adapters rather than querying another feature's tables. Keep internal IDs for links, never as a routine display fallback.
- Feedback changes reuse the existing reveal hook. Only explicit user actions move focus/scroll; background polling must not. Async details preserve account/request identity, offline fallback, error visibility and retry.
- Payment choices remain mutually exclusive native radio inputs. Checkboxes retain actual input semantics, mixed/disabled/focus states, reduced-motion behavior and forced-colors support. No storefront restyling belongs to this pass.

## Bounded implementation lanes and files

1. **Inventory presentation:** `ReceivingPage.tsx`, receiving browser coverage and a sparse-pair catalog browser case. No API/schema changes.
2. **Sales clarity:** `LookupPage.tsx`, `WorkspacePage.tsx`, payment browser assertions. No transaction or sync changes.
3. **Orders/returns integration:** returns/sales/online-orders/reporting feature interfaces and adapters, internal contracts/API composition, Returns/Reports UI, one additive reason migration, feature-owned backup/restore paths and focused HTTP/browser tests. This lane exclusively owns shared contracts and migrations.
4. **Primary staff feedback and controls:** Sales, Expenses, DeliveryAreas and Staff screens, shared internal selection CSS and focused feedback tests.
5. **Remaining explicit-action feedback:** Corrections, Restore, OpeningImport, Branch, Offers/Coupons, StorefrontSettings and OnlineOrders screens. Preserve polling and uncertain-operation recovery. Separate tests from lane 4.
6. **Integration/review:** one owner runs browser/server suites to avoid conflicting shared test ports. Independent review checks diffs and boundaries before staging.

## Migration and verification plan

- Create and test the next unused additive migration for optional return reason, with rollback. Test existing reason-less records, fingerprint/replay compatibility and data-only backup/restore. No legacy stock redistribution or new demo seed is required.
- Test BRV references across 999999/1000000, readable report references, phone formatting across both channels, more than 100 matching purchases, stable mixed-channel pagination and filtering before page limits.
- Test optional reason persistence/history/detail, original sale branch versus receiving branch, order selection, date/reference lookup and existing return/refund/inspection boundaries.
- Test sparse variant bulk selection without new pairs or POS visibility loss; concise batch/receipt facts and expandable before/after corrections without losing retry coverage.
- Test partial/excess/exact payment feedback and ordinary automatic reconnect synchronization without manual action. Retain malformed legacy queue quarantine checks.
- Verify important explicit opens, repeated selection, delayed/failed/stale detail requests, focus/highlight/retry, both themes, white tick/green selection and radio exclusivity.
- Run appropriate real-PostgreSQL HTTP and affected Playwright suites per lane, then workspace typecheck, architecture checks and production build. Do not relabel historical runs as current evidence; record exact commands/results and limits.
- Review/stage only this pass, excluding the already-uncommitted storefront review notes, generated files, raw assets and protected review. The user authorizes committing and pushing the completed verified system changes at delivery. Storefront completion remains paused.
