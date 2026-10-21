# Storefront taste and copy review

Date: 16 October 2026, Cairo. Branch: `codex/ux-purchase-guidance`. Baseline commit: `acb2edc` with the existing, uncommitted storefront work preserved.

Status: the requested revision is implemented and visually reviewed. Static gates passed. Eight affected browser acceptance cases remain unexecuted because the Windows memory guard refused to start the isolated stack. This report does not convert their earlier results into a fresh pass.

## Direction and changes

Applied `gpt-taste`, `design-taste-frontend`, and `redesign-existing-projects` as a preservation review. The owner's established identity takes precedence over generic skill defaults: official image-only hero, dark palette, Clash Display, Rose Arabic fallback, English/LTR storefront, centered mobile Arabic, and existing studio product imagery. No random font selection, replacement imagery, new animation dependencies, or scroll hijacking.

The voice is short, direct, and factual. Removed “The rotation,” “A few pieces to start your next rotation,” “Find your next piece,” repeated section eyebrows, category numbers, and redundant shopping instructions. The ticker now repeats only “Bravos Menswear”; screen readers receive one phrase, and reduced motion shows one static phrase.

The selected-products section has a single heading/action row and a centered 1024px desktop limit, matching four existing 240px tiles, three 16px gaps, and 16px rail padding. The category directory uses unnumbered typography, two desktop columns, and balanced mobile name/arrow columns. Product frames have 4px corners and quieter lighting while retaining the studio backdrop, uniform 3:4 containment, price/status alignment, green/red availability, hover feedback, and keyboard outline clearance.

Ordering reassurance now explains two useful topics: WhatsApp confirmation and cash on delivery. It explicitly retains the order-request distinction, no reservation before confirmation, and fee/total disclosure before submission. Bag and product copy is shorter. Shipping, returns, and contact pages lost redundant eyebrows; policy paragraphs and configured contacts were preserved.

## Scope

Seventeen application files changed relative to the saved pre-pass snapshot:

- `apps/storefront/app/components/`: home-introduction TSX/CSS, featured-selection TSX/CSS, brand-marquee TSX/CSS, shop-wall TSX/CSS.
- `apps/storefront/app/cart/`: page, cart-summary, bag-preview, and cart.module.css.
- `apps/storefront/app/`: homepage, product page, shipping, returns, and contact pages.

Five browser specs have dependent copy assertions: flagship, experience, gallery/cart, catalog/media, and storefront. Test discovery also exposed pre-existing duplicate `colors`/`sizes` declarations in catalog-media; the UI locators were renamed, and its two stale card-label expectations were aligned with the existing title-case card labels. Assertions and scenarios were retained.

Grok implemented the revision and requested corrections. Main and Sol reviewed the delta. Main made the final two-declaration desktop width correction and the small, demonstrated test-discovery repairs.

No changes in this pass to staff screens, APIs, contracts, catalog records, stock, pricing, order submission, recovery, cart persistence, fonts, analytics events, routes, dependencies, or permissions. The ordinary public catalog still contains 32 products.

## Verification

Evidence root: `.scratch/taste-review-20261015/verification/`.

| Check | Result | Evidence |
| --- | --- | --- |
| Workspace typecheck | Passed | `static-20261015-234827/` |
| Architecture checks | Passed | `static-20261015-234827/` |
| Final storefront typecheck/build after desktop width correction | Passed | `static-20261015-235705/` |
| Independent source review | No remaining findings | Sol review against the pre-pass snapshot, including final desktop width correction |
| Development visual/interaction capture | Passed its checks; 46 screenshots collected | `captures-2026-10-15T23-55-14-310Z-9f0e63bc/manifest.json` |
| Final browser test discovery | Eight cases in six files discovered | `taste-20261015-235919-list/` |
| Fresh browser acceptance execution | Not started; memory guard blocked both attempts | `taste-20261015-235109/`, `taste-20261015-235846/` |
| Scoped whitespace check | Passed | Main diff review |
| Restored local stack and two flagged product-image URLs | HTTP 200 | `final-health.json` |

Capture covered 320, 390, 768, and 1440px: 32 geometry records, eight focus-clearance records, 22 rendered metadata records, reduced-motion behavior, product selection, browser-local bag, checkout presentation, and information pages. There were no capture assertion failures or source changes, no observed quote/order requests, and no business writes from the guarded capture. The capture blocked 62 analytics writes intentionally.

Main inspected desktop/mobile home, the desktop category directory, mobile category centering, and representative saved screenshots. Mobile category name centers measured zero offset from their link centers. The initial `catalog-*-viewport` images were caught during native smooth scrolling and are not accepted as settled collection screenshots; main's direct category review and the other page evidence remain separate.

Diagnostics are retained: six development CSS preload warnings, one Next image LCP suggestion, and 12 `ERR_ABORTED` requests involving development assets and two product images. Captured geometry reported no broken images; both flagged product-image URLs subsequently returned 200. These cancellations do not establish a persistent asset defect, and their precise timing cause was not instrumented. The initial manual page visit preceded API readiness and showed the existing retry surface; retry loaded successfully once the API was listening.

The failed discovery attempt is retained beside successful discovery. It is not an executed browser-test failure. Memory-blocked runs had approximately 3.5GB and 3.3GB available virtual memory against the harness's 4GB requirement. The guard was preserved. The visual capture is not a substitute for the eight acceptance scenarios, and no production Lighthouse/vitals claim is made.

## Handoff

Review at `http://127.0.0.1:3000/`. Staff and API were restored at ports 5173 and 3010. No staging, commit, push, deployment, or issue closure occurred. The protected review file remains SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

The remaining verification action for this pass is to execute the eight discovered cases when Windows memory headroom permits. No additional redesign is queued automatically.
