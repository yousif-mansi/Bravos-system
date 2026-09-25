# Bravos storefront implementation roadmap

**Status:** Approved roadmap; SF-02/SF-04/SF-05 authorized for local implementation on 25 September 2026. Earlier execution history and outstanding acceptance gates are recorded below.
**Baseline:** `main`, `15fd3661b29249ca1fc7f3484654476d6c1b2b1d`, 23 September 2026.  
**Authority:** [Approved Experience Evolution Report](../../bravos-experience-evolution-report.md), refined by the user's subsequent Phase 0–5 instructions. The report's internal-system proposals and original phase numbering are outside this roadmap. Its provisional audit hypotheses are not treated as verified defects.  
**Evidence:** Current route/component/API inventory and [local product/design brief](bravos-storefront-design-brief.md). External reference-site claims are inspiration supplied by the report, not independently verified performance evidence.

## Delivery contract

Build a premium Arabic menswear storefront: photography first, warm bone and ink, hard edges, minimal chrome, confident shopping controls. Share official brand assets and brand character with the staff application; do not import its sidebar, dashboard cards, themes, or component language.

Only storefront presentation and its verification are in scope. Preserve routes `/`, `/products/[productId]`, `/cart`, `/checkout`. Home and collection currently share `/` with `q` and `category` query parameters; a collection experience does not require a new route. Preserve server rendering and existing public reads.

Do not change API contracts, database, permissions, pricing, variant identity, central inventory, ordering, quote calculation, idempotency, cart persistence, checkout recovery, or analytics semantics. Hidden products remain excluded; Coming Soon remains non-orderable; Out of Stock remains browsable. Pending orders hold no stock and require later WhatsApp confirmation. COD remains the only public payment method.

No new CMS, recommendation engine, customer accounts, reviews, wishlist, payment provider, animation framework, module federation, or internal-app work. This revised roadmap is approved; execution starts with SF-00/SF-01. Commits still require user approval. `SF-xx` identifiers are not GitHub issue numbers. Publish the agreed tickets to `yousif-mansi/Bravos-system` with blocking relationships. Content-gated tickets must not be represented as immediately executable without their inputs.

Product experience and purchase confidence have higher priority than additional storytelling. Campaign/editorial modules are optional, never empty, and must not block a strong commerce experience. Keep the requested ticket order SF-00 through SF-12. Missing optional story assets are recorded as omitted content, not a reason to hold product, cart or checkout work. No fake production content or catalog/business-data changes are authorized.

## Phase 0 foundation specification

These are approved executable defaults translating the approved direction. SF-01 demonstrates them on real existing pages before downstream rollout; the specific Arabic display face remains a bounded main-agent selection within SF-01.

| Area | Contract |
| --- | --- |
| Tokens | Storefront-local semantic canvas, surface, ink, muted text, border, focus, error, success and disabled roles. Warm bone `#FFFFFC`, warm ink `#121110` as starting values; accessible derived roles. Photography supplies chroma. No decorative champagne UI default; status color only when needed. |
| Typography | Two roles: Arabic-capable editorial display and Cairo commerce/body. SF-01 includes selection and a main-agent visual review of one licensed Arabic display face, with a small local font payload and fallback metrics. Exact face is a bounded product decision, not delegated to implementers. No Latin uppercase/tracking applied to Arabic joining text. Latin labels may use restrained tracking. Body 16–18px, metadata 14px, section headings 24–36px, lead headings 32–64px fluid; readable Arabic line heights and no clipped diacritics. |
| Spacing | Shared 4/8/12/16/24/32/48/64/96px scale. Tight image walls, spacious chapter boundaries; no per-screen spacing systems. |
| Surfaces | Flat bone/neutral surfaces, 0–2px corners, restrained hairlines. No floating admin cards, decorative gradients or heavy shadows. |
| Actions | Solid ink primary and hairline/ghost secondary. Clear focus, pending, selected and disabled states; at least 44px interactive targets. Prices and important actions never hidden by hover. |
| Product cards | Presentational `ProductCard` is a wall tile, not a boxed SaaS card: consistent 4:5 image, name, truthful starting price and availability. Four columns on wide screens, two on phones where readable; one only where zoom/narrow layout requires it. No fabricated labels. |
| Images | Reserve intrinsic space; one lead image prioritized, below-fold media lazy. Preserve catalog image order, direct revocable media URLs and publication checks. Static campaign media may use prepared responsive files; never enable a persistent optimizer cache for catalog media. Mobile crop must preserve garment/model context. |
| Shell | Official horizontal logo, public shop/cart navigation, visible bag count and configured footer contacts. No internal routes, invented social links or trust badges. Checkout uses the same identity with quieter navigation. |
| Responsive | Verify 390, 768, 1024 and 1440px plus 320px and 200% zoom. Desktop rail at 1024px and above only if content fits; below that, mobile commerce bar. Use logical RTL spacing/order and safe-area insets. Sticky UI must never obscure focused fields, errors or footer content. |
| Motion | CSS only unless a demonstrated need is separately approved: brief 150–250ms feedback, optional hero entrance up to 400ms without delaying content/LCP. Reduced motion means immediate state changes. No scroll-jacking, campaign motion in checkout, or mandatory image-wall staggering. |

## Ticket sequence

Every ticket below has its own bounded file scope, components, risks, acceptance criteria and verification. Work is taken in the user's order; dependency edges describe technical gates, while absent optional storytelling never blocks downstream commerce work.

| Phase | Ticket | Deliverable | Blocked by |
| --- | --- | --- | --- |
| 0 | [SF-00 — Content and visual asset readiness](tickets/storefront/SF-00.md) | Asset inventory, hero/product requirements, crop and placeholder rules, approved-copy checklist | Approved roadmap revision |
| 0 | [SF-01 — Retail foundation and shell](tickets/storefront/SF-01.md) | Tokens, dual typography, actions, responsive header/footer applied to existing pages | SF-00 readiness specification |
| 0 | [SF-02 — Product wall tiles and image contract](tickets/storefront/SF-02.md) | Shared honest cards/media rules on current browse | SF-01 |
| 1 | [SF-03 — One photography-led homepage story](tickets/storefront/SF-03.md) | Hero and under-image CTA using approved imagery | SF-01 + hero content |
| 1 | [SF-04 — Discovery and optional campaigns](tickets/storefront/SF-04.md) | Strong real-catalog discovery; campaign/editorial sections only with content | SF-02; SF-03 integration when ready |
| 2 | [SF-05 — Collection discovery and visible filters](tickets/storefront/SF-05.md) | Editorial wall, honest search/category chips and supported sorting | SF-02 |
| 3 | [SF-06 — Product gallery and desire-first hierarchy](tickets/storefront/SF-06.md) | Large garment gallery before detailed specifications | SF-02 |
| 3 | [SF-07 — Persistent product commerce](tickets/storefront/SF-07.md) | Desktop rail, mobile bar and clear variants with one state owner | SF-06 |
| 3 | [SF-08 — Factual product chapters](tickets/storefront/SF-08.md) | Fit/fabric/care/style sections only where approved facts exist | SF-06 + product copy |
| 4 | [SF-09 — Clear, trustworthy cart](tickets/storefront/SF-09.md) | Readable line items, totals and recovery/stock feedback | SF-02 |
| 4 | [SF-10 — Calm Arabic COD checkout](tickets/storefront/SF-10.md) | Mobile form, authoritative quote and clear request/recovery states | SF-09 |
| 5 | [SF-11 — Image and production performance gate](tickets/storefront/SF-11.md) | Measured image/CLS/loading performance with media revocation intact | SF-04, SF-05, SF-07, SF-08, SF-10 |
| 5 | [SF-12 — Integrated storefront quality gate](tickets/storefront/SF-12.md) | RTL/accessibility/touch/keyboard/error and behavioral regression evidence | SF-11 |

## Content gates and report adaptations

- **Photography:** Current local fixtures are two products, one category, an unrelated podcast image and a placeholder. They cannot demonstrate the approved visual ambition or representative image performance. Obtain one approved desktop/mobile hero treatment, real garment photos and short Arabic captions. No photography generation or catalog upload is implicitly authorized by this roadmap.
- **Campaigns:** At most 2–4 real modules per season; zero is valid when no campaign exists. One editorial island maximum. Use existing product/category destinations; no new News route. Never render empty storytelling sections, blank chapter spacing or placeholder campaign cards. Discovery is SF-04's required delivery; optional stories may be omitted entirely. Hero delivery remains content-gated; do not close SF-03 with a fake campaign or let its missing assets halt downstream commerce work.
- **Typography:** The report requests dual type but names no Arabic display face. Main-agent selection/review is included in SF-01; implementers do not substitute an arbitrary Latin serif or add a large font family. Keep commerce Cairo and existing reliable loading unless measured needs justify a small local display font.
- **Honest discovery:** Public browse returns all matching summaries with category, name, availability and lowest listed variant price. Offer default catalog order, Arabic name and starting-price ascending/descending; missing prices last. No newest, best-selling, size/color facets or N+1 detail fetches to fabricate those features. Explain starting prices, including when the cheapest variant is unavailable.
- **Chapters:** The API has description and optional text size guide, not structured fit/fabric/care/style. SF-08 may add a small storefront-only editorial content file keyed to existing product IDs for explicitly supplied factual text, with provenance. It is not a catalog, price or stock store. Omit missing chapters. Never infer fabric, care, fit, variant images or color hex values from product names. No invented complete-the-look recommender or checkout upsell.
- **Variants:** The report's variant-linked image swaps and material line require data that does not exist. Keep product-level gallery independent; show material only from approved copy. Accessible labeled size/color controls must resolve existing variant IDs and impossible combinations must remain unavailable.
- **Image safety:** `next.config.ts` deliberately disables image optimization to avoid serving Hidden/removed media from persistent caches. Keep that decision. Optimize static editorial assets and prepared catalog source files through existing authorized workflows; do not change media APIs/cache behavior.
- **Checkout demonstration:** The current local preview has no configured delivery areas. Automated fixtures can create them in the isolated test database; real preview/launch needs owner-configured areas and fees. Do not seed production/business data as a UI task.

## Parallel execution and file ownership

Start SF-00, then SF-01 after its asset rules/readiness specification is recorded; actual missing campaign/product assets remain explicit later content gates. Preserve SF-01 → SF-02 → SF-03 → SF-04 → SF-05 → SF-06 → SF-07 → SF-08 → SF-09 → SF-10 → SF-11 → SF-12 as the implementation order. Delegate independent inventories, verification and isolated subtasks in parallel within the active scope. Missing optional content does not reserve engineering capacity ahead of purchase-confidence work. The main agent owns creative decisions and integration review; Sol handles bounded implementation and repetitive checks under the user's delegation policy.

`app/page.tsx` is shared by homepage and collection: build isolated components in parallel, then serialize composition edits. `globals.css` and `layout.tsx` have one integration owner; route-specific CSS modules prevent unrelated edits. Product gallery/rail/chapters converge on one product page and must be integrated serially. SF-07 alone owns purchase-panel edits. SF-10 alone owns checkout presentation edits. No concurrent edits to these shared owners.

Read-only behavior boundaries: `app/public-catalog.ts`, `app/cart/cart-provider.tsx`, `app/cart/cart-types.ts`, `next.config.ts`, `packages/contracts/src/public.ts`, `apps/api/**`, all domain/application/adapter packages and migrations. Cart/checkout page files contain both rendering and logic: approved presentation edits do not authorize changing their effects, operation IDs, persistence helpers, stale-response guards or algorithms.

## Completion and review gates

Each ticket is demonstrable on an existing route, retains relevant tests/hooks, runs typecheck and affected browser checks, and reports changed files, diff, screenshots, results and limitations. No commit without user approval. New component names in tickets are proposed; existing paths were verified at the baseline. No runtime dependency or architecture refactor is presumed necessary.

SF-01 records an immediate current-fixture production baseline and pins the baseline commit, lockfile, toolchain and measurement procedure before its first application edit. This initial capture is diagnostic, not representative-content acceptance. Once approved assets exist, SF-11 compares a reproducible, isolated production build of baseline commit `15fd366` with the final build against the same catalog fixture set/device/network. Record new hero media separately: the old homepage has no photographic hero, so its absence must not be disguised as an identical image workload. Do not switch or replace the user's running preview to measure the old build. Proposed quality targets: CLS ≤0.1 and mobile lab median LCP ≤2.5 seconds over three cold runs under recorded conditions. These are new targets, not existing measured results or promises of field percentiles. Record image and JS bytes, request count and interaction traces; unexplained regressions block acceptance. Missing representative content blocks a claim of production performance readiness.

Final checks: `pnpm typecheck`, `pnpm check:architecture`, `pnpm build`; targeted Playwright storefront, catalog-media and checkout suites; public storefront/catalog/checkout HTTP suites against the real test PostgreSQL. Add focused assertions for new UI behavior; do not remove tests/hooks or replace real behavior with mocks. Existing unrelated failures must be reproduced/documented, not silently waived or repaired in this phase.

Physical iOS Safari and Android Chrome verification remains a distinct release gate when hardware is unavailable. Automated emulation is not equivalent. Ticket completion and public launch readiness are separate: production content, delivery configuration, real-device evidence and deferred hosting/TLS/monitoring remain launch inputs.

## Approval and execution record

The user approved the roadmap with SF-00 added, storytelling explicitly optional, product/purchase confidence prioritized, and SF-01–SF-12 order retained. This revision finalizes those adjustments before execution. Start SF-00 and SF-01 only in this work cycle. No internal redesign, backend changes, fake production content or catalog mutations are part of this approval.

SF-00 specification/inventory is complete: [readiness report](storefront-content-readiness.md). Missing photography/copy remain explicit content gates. Main agent selected local Amiri Regular for editorial headings after Arabic sample review, with Cairo retained for commerce; SF-01 actual-page verification remains required.

### 24 September 2026 execution exception

The user deferred the current visual/font decision and intends to replace the Arabic font across the storefront at the end. Continue the other storefront issues using the current typography; do not treat the pending SF-02 visual proposal or future font replacement as completed.

For this batch, SF-06 (product gallery) and SF-09 (cart) may proceed in parallel without waiting for SF-02. Use the existing media helpers and direct catalog media behavior; neither ticket depends on a proposed SF-02 `ProductMedia` component. This is a temporary dependency exception for those two tickets, not SF-02 acceptance or a general change to the ticket sequence. Keep each ticket's original acceptance criteria and verification. SF-07 still follows SF-06 and SF-10 still follows SF-09. Hero and campaign work remain gated by missing approved assets; this exception supplies no content or substitute imagery.

SF-06 and SF-09 are implemented and locally verified, pending user review and commit. The [joint review](../reviews/storefront-gallery-cart-review.md) records the exact regression results and evidence. SF-02 and the storefront-wide Arabic font replacement remain pending; real garment imagery is still needed to accept the gallery's final art direction.

SF-07 (persistent product commerce) and SF-10 (Arabic COD checkout) entered local implementation as the next batch. Their predecessor tickets SF-06 and SF-09 are implemented locally, pending user review and commit; this does not close those dependencies in Git. SF-02 and the storefront-wide Arabic font replacement remain deferred. No commit is authorized.

SF-07/SF-10 are now implemented and locally verified: pinned typecheck, architecture, storefront build and checkout HTTP checks passed; affected browser cases passed across combined and targeted runs, with one known baseline checkout locator failure preventing a clean combined browser result. The main agent reviewed product and checkout viewport captures. The [joint review](../reviews/storefront-commerce-checkout-review.md) records exact counts, patches and visual evidence. User review/commit remain pending. SF-02 and the font change remain deferred; representative photography and physical-device checks remain later gates.

### 25 September 2026 execution update

The user authorized implementation of the reviewed [SF-02 product-wall proposal](sf02-product-wall-proposal.md) and then SF-04/SF-05. SF-02, SF-04 and SF-05 are in progress under their existing ticket boundaries; this authorization supersedes the earlier SF-02 proposal-approval gate and the temporary deferral of SF-02 implementation. Continue with the current typography. The storefront-wide Arabic font replacement remains deferred to the end and is not an acceptance result for this batch. Commits still require user approval.

SF-04's required result is discovery using the real public catalog. Zero optional campaign/editorial stories is a valid delivery while approved assets and copy are absent. SF-03 hero/content and SF-08 factual product chapters remain gated by their specific approved inputs. Do not create campaign claims, product facts, placeholder stories or nonexistent content-present test results to close those tickets.

The previously failing closed-ordering checkout locator was resolved on 25 September; its focused rerun passed 1/1 in [the checkout closeout log](../../.scratch/storefront-foundation/checkout-locator-closeout/focused-pass.log). The historical SF-06/SF-09 and SF-07/SF-10 combined browser results remain as recorded in their reviews. This focused pass does not establish a clean rerun of either full combined suite.

SF-02/SF-04/SF-05 are now locally implemented and verified for user review. The [joint wall and discovery review](../reviews/storefront-wall-discovery-review.md) records the 12/12 combined browser pass, 2/2 sorting tests, 18/18 HTTP guards, typecheck, architecture and build results, independent reviews and viewport evidence. This verification covers current real-catalog discovery with zero optional stories. Approved campaign content, representative photography, final font selection and physical-device/performance gates remain separate. No commit is authorized or made.

### Commit authorization

After reviewing the completed batch, the user authorized a commit of the reviewed storefront work. This includes SF-02/SF-04/SF-05 and the previously reviewed SF-06/SF-07/SF-09/SF-10 changes covered by the latest combined regression run. Earlier pending-commit statements above describe the historical state. Unrelated local files and the protected original review are excluded. Push and further implementation are not part of this commit step.

Next priorities are approved photography and factual copy for SF-03/SF-08, the remaining SF-11/SF-12 performance and integrated quality checks (including server-outage recovery and physical devices), and the user's deferred Arabic font replacement followed by layout verification. Missing representative assets still prevent final photography/performance acceptance; optional campaigns remain optional.

| Ticket | GitHub issue |
| --- | --- |
| SF-00 | [#30](https://github.com/yousif-mansi/Bravos-system/issues/30) — completed readiness specification |
| SF-01 | [#31](https://github.com/yousif-mansi/Bravos-system/issues/31) |
| SF-02 | [#32](https://github.com/yousif-mansi/Bravos-system/issues/32) |
| SF-03 | [#33](https://github.com/yousif-mansi/Bravos-system/issues/33) |
| SF-04 | [#34](https://github.com/yousif-mansi/Bravos-system/issues/34) |
| SF-05 | [#35](https://github.com/yousif-mansi/Bravos-system/issues/35) |
| SF-06 | [#36](https://github.com/yousif-mansi/Bravos-system/issues/36) |
| SF-07 | [#37](https://github.com/yousif-mansi/Bravos-system/issues/37) |
| SF-08 | [#38](https://github.com/yousif-mansi/Bravos-system/issues/38) |
| SF-09 | [#39](https://github.com/yousif-mansi/Bravos-system/issues/39) |
| SF-10 | [#40](https://github.com/yousif-mansi/Bravos-system/issues/40) |
| SF-11 | [#41](https://github.com/yousif-mansi/Bravos-system/issues/41) |
| SF-12 | [#42](https://github.com/yousif-mansi/Bravos-system/issues/42) |
