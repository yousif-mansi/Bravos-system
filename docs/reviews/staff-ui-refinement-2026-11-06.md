# Staff interface refinement — 6 November 2026

## Scope and source review

Implemented against baseline `da74d12c205c85627c6d26c0f325604d3f05942a` in the receipt-numbering worktree. Main reviewed all 17 rendered pages of `POS_UX_UI_Redesign_Arabic.pdf` and all nine images in `الصور المقترحة/التعديلات` before implementation. GPT-6.1 Terra agents at high effort implemented bounded page assignments; main integrated shared components, reviewed the changes and screenshots, and ran verification on Windows.

The references informed hierarchy, compact work areas, tables and detail views. Existing Bravos fonts, semantic colors, light/dark themes, logos and feature boundaries were retained. No new package, backend contract, schema, migration or permission change is part of this pass.

## Delivered page changes

| Area | Result | Existing behavior preserved |
| --- | --- | --- |
| Dashboard | Compact sourced KPIs with scope labels, operational attention and quick actions; printer connection setup is secondary. | Permission-dependent metrics, sync/recovery actions and current landing route. |
| POS | Unified product-code/name discovery, compact product tiles, quantity controls, optional customer/discount/coupon disclosure, desktop discovery/checkout split. The checkout body scrolls while totals and completion actions stay visible at 1366 × 768. | Scanner handling, accepted pricing, payment validation, offline persistence, completion with/without printing and recovery. |
| Sales | Branch/authorized online views, search/date/payment filters, 20-row paging, side details. Sale items show product name, code, quantity, accepted price and paid amount. | Existing sale detail retrieval, receipt printing, manager corrections and restricted cost allocations. |
| Online orders | Compact customer/items/total summary, actual WhatsApp link, explicit confirmation/cancellation review dialogs, advanced management/history disclosure. | Required fulfillment branch, physical set-aside acknowledgment, customer agreement, cancellation rules and durable uncertain-operation recovery. |
| Receiving | Five persistent tabs: receiving, location balances, transfers, low stock and history. Compact receipt-level date/supplier controls, multi-line receipt table and totals; history detail panel. | Original receiving/correction APIs, costs/batches, inline supplier/category creation, threshold settings and frozen receiving retries. |
| Transfers | Existing transfer form embedded under Receiving, with review dialog and refreshed location balances. Independent navigation item removed; old `/transfers` links redirect to `/receiving?tab=transfers`. | Source/destination permissions, quantity validation, operation identity and single transfer effect. |
| Returns | One primary reference/phone lookup with advanced filters, compact selected invoice and inspection rows, review before posting, history/details panel. | Original draft/post operations, uncertain recovery, partial quantities, inspection/restocking, actual refund decision and separate recording of money paid; exchange remains secondary. |
| Products | Product list/editor workspace, basic/online/options tabs, retained drafts and dirty-record warning, compact variant-pair controls and taxonomy dialog. | Existing image upload/order, publication status, saved variant identities, optimistic revision and pooled operational inventory. |

Shared `BusinessUi.tsx` supplies keyboard-operable tabs, native modal dialogs, paging and side details. Supporting styles use existing tokens and bounded table scrolling. POS discovery now exposes both code and product-name search in its accessible label.

## Integration findings corrected

- Populated POS completion buttons extended below a 1366 × 768 viewport. The checkout now reserves its footer and scrolls its body. Both completion buttons pass viewport-bound assertions.
- Sale details showed the SKU without the product name. A compact item table now uses the existing sale DTO without recalculating any accepted amount.
- Closing receiving details could clear an uncertain correction's operation ID. Close/switch/edit/cancel actions now preserve that attempt, freeze its values and offer the same retry. A refresh failure after an acknowledged correction is reported separately from a failed mutation.

An independent read-only Terra integration review found no remaining confirmed regression in the repaired correction flow. It also checked role-sensitive actions, drafts, dialogs and the shared UI integration.

## Essential verification

Evidence is under `.scratch/pos-ui-refinement-20261106/`.

| Check | Result and evidence |
| --- | --- |
| Final affected browser suite | **5/5 passed**, one fresh Windows run, `browser-closure.log`. Covers retained receiving drafts; legacy transfer route and balances; product draft tabs/switch warning; seven screen routes at desktop/narrow widths; light theme; cashier sales visibility; online agreement/confirmation; invalid and valid split payments; durable sale and inspected return; uncertain correction retry. |
| Representative existing tests after navigation maintenance | **3/3 passed**, a separate fresh run, `browser-existing-navigation.log`: manager product maintenance/cashier lookup, offline sale preserving 275/175, and receiving correction after a server-committed response loss with one operation ID. |
| Browser test collection | All 216 tests in 52 files collected successfully, `browser-collection.log`. Collection is not execution. |
| Offline sale regression | Passed in the earlier `browser-final.log` run, preserving the 275/175 allocation. That run overall was **4 passed / 1 failed** because it discovered the POS viewport defect. This is separate evidence, not a fresh combined six-test pass. |
| Internal TypeScript | Passed, `typecheck-final.log`. |
| Architecture/import boundaries | Passed, `architecture-final.log` — 537 modules checked, no dependency violations; private-import check passed. |
| Internal production/PWA build | Passed, `build-final.log`; output in fresh scratch `internal-dist-final`, preserving the ordinary preview's existing assets. 53 precached entries; no new dependency. |

The new correction test aborts its first request before the server, then allows the real retry. It asserts identical full payload/operation ID, exactly one recorded correction and resulting stock quantity. The separate existing receiving test covers a server-committed response loss and same-ID recovery.

Historical test navigation was updated to enter the new inventory/product tabs, taxonomy modal and optional POS disclosure. Assertions were retained. The idempotent `openPosOptionalDetails` helper leaves existing quote/finalization helpers unchanged. Only the representative existing cases above were rerun; this is not a claim that all 216 historical tests pass.

Earlier fixture failures and red runs remain beside their reruns. Fixture receiving initially used a retail branch instead of the existing required warehouse intake/transfer flow; the test setup was corrected. A later sale-detail assertion exposed the missing product name. No assertion was removed to conceal either UI defect.

## Visual evidence and boundaries

Viewport-size screenshots are under `visual/`, captured across document scroll positions rather than reduced full-page thumbnails. Main inspected desktop views, populated POS/return states, product editor tabs, inventory tabs/details, online review dialogs, a light-theme sales view and narrow layouts. Useful final captures include `pos-split-payment-1366-768.png`, `sales-detail-split-top.png`, `return-inspection-top.png`, `online-order-pending-top.png`, `catalog-options-top.png`, and `receiving-top.png`. Scratch contains earlier-pass captures too; screenshots are review evidence, not production assets.

The reference's optional concepts were adapted only where existing data and capabilities support them. This pass adds no invented dashboard chart, arbitrary keyboard shortcut, export capability or custom default home. Online order details retain their dedicated route. Saved variants are not offered a misleading removal control that the existing revision contract would reject.

Unsubmitted online-order form drafts can still be lost through ordinary sidebar navigation/browser Back, as before this pass. The page's own Back action and browser unload now warn; uncertain submitted operations retain their existing durable recovery. The PDF's record/tab warnings are implemented without replacing the application's router.

Two pre-existing historical test mismatches were identified without changing their business assertions: `catalog-media.spec.ts` expects a per-variant price input and price 340 despite the baseline editor already using the pooled product price; `system-update-visual.spec.ts` expects a sentence also absent from the baseline editor. Those tests were not executed or represented as green. Resolving these older expectations requires a separate baseline-alignment change, not reintroducing per-variant pricing in this UI pass.

No ordinary business data, printer configuration, physical print output, deployment or hosting setting was changed. The protected review file was checked by hash only and retains `61A15B6AE01DC82128AC12DCA00AB8AE3FC380758F7B927E740D3CD0D2256F46`.

This report records local verification before publication; Git history records subsequent publication status. The running ordinary preview was not restarted or replaced by the scratch build. Generated storefront test configuration was restored; there is no intended storefront change in this pass. The report establishes affected engineering checks and visual review, not full project regression, production launch approval or client acceptance.
