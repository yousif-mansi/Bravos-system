# Storefront integration review after 741fdf8

30 September 2026. Reviewed `741fdf84ae7dd4e92a806b97674ba7e8835c3c08` against its parent `dacf3c7`, the current storefront, and the approved SF roadmap. One Sol 6.1 Medium agent mapped routes/components/APIs; two Sol 6.1 High agents reviewed contracts and order/returns integration. The main agent reconciled the findings and selected the priorities below.

**Decision:** retain the existing storefront architecture, routes, visual direction, and commerce state owners. No public contract migration or storefront rewrite is required by this commit. Complete a bounded commerce integration gate before remaining visual work. One inherited acknowledgment wording issue needs a small correction. This review authorizes no implementation; proposed adjustments await user review.

This was a source and documentation review. No tests, servers, migrations, catalog changes or application edits were performed. The previous system pass's 78 HTTP and 55 browser cases are useful supporting evidence, not a fresh storefront integration run. Existing uncommitted storefront review/ticket files are historical working-tree evidence and remain untouched.

## 1. What actually changed

The comparison `git diff dacf3c7 741fdf8 -- apps/storefront packages/contracts/src/public.ts` is empty. Branch inventory, online-visible pairs, whole-basket branch checks, confirmation accounting and durable checkout recovery were already present in `dacf3c7`.

The direct public-path change is online reference generation: `bravos_human_reference` replaces a six-character-padding expression that could truncate a larger number ([order adapter](../../packages/online-orders/src/adapters/postgres-online-orders.ts)). The storefront already renders and persists the returned reference as an unrestricted string. `BRV-1000000` therefore requires verification, not a new reference parser or public DTO.

Other additions are internal: paged return-source lookup, normalized phone matching, optional return reasons, richer staff return history, report references, staff feedback, and migration 035/backup compatibility. None is a new customer API. Migration 035 adds only the nullable return reason; the storefront needs no new database field.

## 2. Impact by customer journey

| Area | Verified integration | Required disposition |
| --- | --- | --- |
| Product identity and variants | Inventory intake creates catalog-owned identity and actual pairs. Products chooses which existing pairs appear online. The purchase panel renders returned pairs; it does not multiply independent size/color choices. | Keep existing IDs and selection ownership. Test a sparse pair hidden after it was carted; public selection/cart must reject it while POS retains it. No storefront product-creation UI or SKU lookup is needed. |
| Availability and stock display | Public variant quantity is the greatest quantity available in a single branch, not a sum. A=2/B=3 yields 3. Hidden products/pairs are excluded; Coming Soon remains non-orderable; Out of Stock remains browsable. | Keep public `availableQuantity`, `orderable` and `availability` authoritative. Do not expose branch balances, cost batches or a customer fulfillment-branch selector. |
| Whole-basket availability | Two products may each be available but reside in different branches. Cart line checks cannot prove that one branch can supply the whole basket. Quote, submission and staff confirmation enforce that condition. | Preserve the existing whole-basket explanation and recoverable quote errors. Test incompatible combinations and stock changes between quote and submission. Never silently remove lines, split fulfillment or sum branch stock. |
| Product tiles and pricing | Summary cards show a starting price; product selection shows the exact variant price; checkout uses the authoritative quote. Public summaries do not supply new size/color facets or variant-specific photography. | Retain honest starting-price wording and existing supported filters. No new badges, inventory-derived campaigns, fabricated swatches or gallery-to-color mapping. |
| Cart | Stored lines are refreshed through public product reads; unavailable or hidden variants are marked unavailable. Cart totals remain provisional. Adding a line does not reserve stock. | Retain persisted quantities, visible repair feedback and the existing route to price review. No new reservation behavior. |
| Checkout and payment | Guest COD remains the public flow. Cash/manual transfer/split is a POS feature. Sending a request does not recognize revenue or protect stock. | Do not add wallet/InstaPay/split payment to public checkout. Preserve quote invalidation, exact request/operation replay, later cart additions and closed-ordering recovery. |
| Staff confirmation and accounting | Staff select one authorized fulfillment branch and confirm after WhatsApp agreement. Confirmation recognizes sales and protects/deducts stock once. Cancellation/failed delivery reverses revenue; uninspected stock stays protected. | No extra customer confirmation step, branch choice, accounting UI or new client-side purchase event. Staff workflows stay separate from customer navigation. |
| Order references | The existing BRV reference can now grow safely beyond six digits. | Test mobile/RTL rendering, exact persistence and lost-response recovery with `BRV-1000000`. Never truncate, reformat or infer status from the reference. |
| Returns and support | The new `/api/internal/returns/sources-page` and history/reason capabilities require management authorization. Online returns use delivered purchases and the existing 14-day receipt window; refund and inspection decisions remain staff-owned. | Do not call staff lookup from the storefront or expose customer orders through a phone-only search. No public account, tracking, cancellation or self-service return portal is added. |

Evidence: [public contracts](../../packages/contracts/src/public.ts), [catalog projection](../../packages/catalog/src/application/catalog.ts), [order service](../../packages/online-orders/src/application/online-orders.ts), [purchase panel](../../apps/storefront/app/products/[productId]/product-purchase-panel.tsx), [cart refresh](../../apps/storefront/app/cart/page.tsx), [cart explanation](../../apps/storefront/app/cart/cart-summary.tsx), and [checkout](../../apps/storefront/app/checkout/page.tsx).

## 3. Required adjustments before visual polish

### A. Correct acknowledgment wording — SF-10, small presentation change

Current checkout line 396 says: “الطلب قيد المراجعة، ولم تُحجز القطع حتى الآن.” This is accurate at initial submission but can be false when reopening a saved accepted attempt after staff confirmation.

The public response is deliberately an immutable submission acknowledgment with `status: "pending"`; it is not a live status query. The browser can restore the accepted response from local storage, and server replay also preserves the original response. [The confirmation regression](../../tests/http/order-confirmation.test.ts) explicitly tests pending acknowledgment replay after confirmation. This is inherited behavior, not a regression introduced by 741fdf8.

Recommended wording: “استلمنا طلبك للمراجعة. إرسال الطلب لا يحجز القطع؛ تأكيده يتم عبر واتساب.” Keep the reference and the amount explicitly labeled as the total the customer reviewed. Avoid “currently pending/unreserved,” payment receipt language, or claiming the originally quoted amount reflects a later WhatsApp revision. Do not change replay semantics or add a tracking API.

Acceptance: initial success, reload of an accepted attempt, and accepted replay after staff confirmation all retain the same reference and show a submission acknowledgment without asserting current stock/status. Uncertain submissions still replay the same operation; no duplicate order or cart subtraction is introduced.

### B. Run a focused storefront integration gate — SF-07/SF-09/SF-10/SF-12

Use isolated data and existing test harnesses. Reuse existing regressions before adding missing cases:

1. One variant across branches A=2/B=3: public quantity/cap is 3, not 5; a request for 4 fails.
2. Product X only in A and Y only in B: both are individually browsable/cartable, but the complete-basket quote fails clearly and preserves cart/customer inputs. Changing to a fulfillable basket allows progress.
3. Stock becomes incompatible between a valid quote and submission: no new pending order is accepted; re-review remains possible. Accepted-response recovery is still permitted after later stock changes.
4. Hide one existing sparse variant pair after adding it to the cart: selectors omit it and refresh marks the stored line unavailable; POS/inventory variants remain intact.
5. Long BRV reference plus lost response, reload and repeated recovery: the same order/reference is recovered and submitted quantities are removed once. Include the acknowledgment wording case above.
6. Verify public catalog/quote/submission/replay safe fields and anonymous denial of the new internal return-source endpoint. No costs, profits, batch allocations, staff details or other customers' histories appear publicly.
7. Re-run relevant public catalog, storefront and checkout HTTP/browser suites, including Coming Soon/Out of Stock/Hidden, exact variant price, quote invalidation, uncertain submission, and recovery after ordering closes. Record exact coverage rather than reusing earlier internal-system counts.

These are acceptance checks and test gaps, not assertions that all these behaviors are broken. Existing HTTP coverage already establishes several server boundaries; the missing evidence is their current customer journey and relevant combinations.

### C. Reconcile roadmap status and terminology — documentation only

The September roadmap still opens with warm-bone/Cairo/central-stock language and several tickets say “uncommitted.” Later user decisions and committed source supersede that description. The accompanying dated roadmap note points to this review and the [current dark execution brief](../planning/storefront-evolution-execution.md). Historical reviews and acceptance counts remain intact.

Current baseline: dark obsidian/charcoal, official ivory brand assets, restrained champagne, local Androgy/Thmanyah roles, centered mobile Arabic headings and distinct sections. Preserve it; this review makes no new aesthetic choice. SF-01/02/04/05/06/07/09/10 have committed implementations. SF-03 has an implemented cover composition; SF-08 has description/size-guide disclosure. Remaining content/visual/performance/device acceptance must not be confused with missing implementation.

## 4. Customer experience and future capabilities

Useful future support copy can tell customers to retain the BRV reference and use the configured WhatsApp contact for help or returns. A copy-reference action is an optional convenience, not required to integrate this commit. Do not invent contact details, shipping promises, automatic refunds or a public returns portal. Any policy text should reflect the existing receipt-based 14-day workflow and staff assessment; adding a public workflow would require separate scope and privacy design.

Analytics remains distinct from accounting. The staff analytics UI correctly labels its delivered-order count as orders that reached the customer, but [its definition text](../../packages/analytics/src/application/analytics.ts) still says sales complete at delivery. Recommend a separate small wording clarification: recorded deliveries are an operational metric, while sales recognition occurs at confirmation. Preserve the count and event contracts; this inherited internal wording is not a storefront blocker. The public analytics events remain visit, product view and cart addition; do not add a client-side completed-sale event at submission.

## 5. Updated implementation/resume order

This orders remaining work, not a restart of already implemented tickets. Original SF identifiers and their content/technical boundaries remain.

| Order | Scope | Exit condition |
| --- | --- | --- |
| 1 | SF-10 acknowledgment correction plus SF-07/09/10 integration gate above | Correct customer wording and focused current-catalog/checkout/permission/recovery evidence. No redesign or new contracts. |
| 2 | Production visual review across existing SF-03/05/06/07/09/10 surfaces | Current-main isolated production preview; desktop/mobile screenshots of browse, selection, stock errors, cart, checkout and acknowledgment. Review current brand composition and commerce first; approve any bounded polish from observed findings. |
| 3 | SF-00 remaining inputs and SF-08 factual content | Approved representative garment assets and actual product facts. Retain existing description/size guide when richer facts are absent. Optional campaign/story sections remain omitted; they do not block commerce. Content collection can run alongside steps 1–2. |
| 4 | SF-11 production performance gate | Measured production loading, image transfer, CLS, interactions, font behavior and media revocation with representative inputs. Preserve historical comparison requirements; identify current measured build and do not substitute development metrics or illustrative demo media for production acceptance. |
| 5 | SF-12 final integrated quality gate | Full intended browse-to-pending-request/recovery journey, RTL, keyboard/screen reader, touch/zoom, real iOS Safari/Android Chrome and relevant failure states. Distinguish local acceptance from deferred hosted TLS/monitoring release work. |

SF-02/04/05 require verification in context, not rebuilding. Existing SF-06/07/09/10 state owners remain. Extra stories, new product layouts, animation changes, font replacement, customer accounts, branch selection, public payments and public return APIs are not part of this integration review.

Production storefront visual/performance evidence is still open: previous preview attempts were rejected by automatic approval review, and the later successful system production build does not prove storefront production-runtime acceptance. This review did not retry that launch and does not assert a current blocker or a running preview. Reassess the authorized preview environment at the next execution step; preserve the prior evidence honestly.

## Recommendation

Approve the bounded acknowledgment fix and commerce integration gate first. If those pass, resume production visual review of the current design, then finish content-dependent, performance and quality acceptance. The system improvements strengthen the existing storefront foundation; they do not justify redesigning it.
