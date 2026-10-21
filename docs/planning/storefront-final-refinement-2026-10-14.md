# Bravos final storefront refinement — execution tasks

Owner authorized defining and dispatching this queue on 14 October 2026. Grok implements application/test changes; the main agent owns product choices, scope, integration review and approval. Sol agents support inventories, captures and independent reviews. This is a refinement of the current working tree, not a redesign or rewrite.

## Shared boundaries

- Windows only; pinned `.local/tools/node-v22.23.3-win-x64/node.exe` and `.local/tools/node_modules/pnpm/bin/pnpm.cjs`.
- Read `bravos.md`, current AGENTS instructions and `docs/architecture/principles.md`; later English/branch-stock decisions supersede older conflicting wording.
- Preserve all existing dirty files and assets. No reset, cleanup, database mutation, catalog intake or stock refill. The 32-product ordinary catalog is the review input.
- Public English/LTR with Clash; Rose for Arabic text. Staff app untouched. Official logos unchanged; opening hero remains image-only. All product-card media remain 3:4, with price and truthful stock status on one row.
- No backend/API/contracts/permissions/database/order/quote/recovery/stock/pricing changes. No false campaigns, popularity, reviews, delivery promises, manufacturing facts or contact accounts.
- No dependency upgrade, Linux work, GitHub mutation, stage/commit/push/merge/deploy. Production startup/performance requires a separately authorized environment; do not retry the earlier rejected production-start action through another host/port/script.
- Do not add animation libraries, more persistent motion, generalized component frameworks, or unrelated refactors.
- Protected `docs/reviews/bravos-v1-grok-review.md` must retain SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.
- Keep one task per Grok brief. Shared layout/footer/PDP/test edits are serialized. Main owns server/build/browser-suite execution; implementers do not concurrently start stacks or run broad gates.
- Each report must distinguish implemented, verified, inferred and pending; include changed paths, reasons, remaining concerns and relevant evidence. Retain failures alongside subsequent runs.

## RF-01 — Resolve homepage verification ambiguity

Priority: first integration gate. Scope: `tests/browser/storefront-flagship.spec.ts`; read `app/page.tsx`, `components/home-introduction.tsx`, loading/layout and the existing failure artifacts. Application edits require evidence of a persistent defect and main review of the proposed minimal fix.

Determine why the latest run encountered two `#home-title` nodes: transient hidden Next streaming content, persistent duplicate markup, or another cause. Inspect ancestor visibility and lifecycle rather than assuming a cause. If transient, wait for the page to settle to the required single heading; keep unique-ID and accessible-heading assertions. Do not use arbitrary `.first()`, force clicks, removed checks, sleeps, retries or inflated tolerances.

Acceptance: one accessible hero heading, no persistent duplicate ID, image-only full-width hero, existing ticker/discovery/font checks intact. Main reruns only the previously unresolved homepage case initially. Memory exhaustion/startup failures are environment records, not test passes or presumed application bugs.

Output: `.scratch/refinement-20261014/reports/RF-01.md`, exact diagnosis/evidence and bounded patch if justified.

## RF-02 — Mobile opening, product wall and typography

Scope: home-introduction and brand-marquee TSX/CSS; featured-selection TSX/CSS; shop-wall CSS/product-card/media presentation; storefront tokens/globals. Existing official cover and actual catalog summaries only.

- Compact the ticker into one deliberate band; retain its 44px accessible pause target, keyboard behavior and reduced-motion state. Its control should not dominate the shopping invitation.
- Reduce unearned introductory gaps so a useful product tile/name/price is reached sooner on phones. Keep distinct section boundaries and purposeful whitespace.
- Evaluate a faithful mobile presentation of the existing cover. Do not stretch it or crop away its embedded logo/identity. If a satisfactory crop needs a new asset, document the need and preserve the current image until main approves the composition.
- Preserve all catalog records. Improve apparent garment scale through media presentation and keep the studio frame visible without distorting photos. Editorial selection changes must use real current items, transparent criteria and existing data; do not hardcode product IDs/sample SKUs or fabricate popularity. Escalate any need for new merchandising configuration.
- Keep Clash/Rose; improve role-specific size/weight/line-height and tracking. Aim for at least 12px price/status text at ordinary phone widths, without overflow or splitting the price/status row. Arabic mobile editorial text is centered where appropriate; commerce controls remain readable.

Acceptance: screenshots at 390/1440 plus overflow checks at320/768; preserved 3:4 media, readable aligned metadata, meaningful first-screen shopping hierarchy and visible focus. No new asset/catalog mutation or motion dependency.

Output: RF-02 report with before/after screenshots supplied by the capture lane and any unresolved asset decision.

## RF-03 — Clear size/color selection and compact mobile commerce

Scope: `app/products/[productId]/product-purchase-panel.tsx`, `product-page.module.css`, optional page-local presentation helper and focused variant/commerce coverage after coordination.

Replace the repeated pair list with clearly labeled native color and size radio groups derived exclusively from existing `PublicProductVariantDto` pairs. Text color labels are sufficient; do not infer fabricated hex swatches from names.

Preserve the existing initial first-orderable variant. Changing color retains the current size when that exact pair is orderable; otherwise select the first orderable existing pair for that color. Sizes for the selected color are visible and unavailable pairs disabled. Colors with no orderable pair remain visible but disabled; do not invent Cartesian-product pairs. Every accepted selection resolves to the original exact variant ID. Preserve quantity reset and feedback clearing on variant changes.

Keep `addToCart`, `cart.add` payload, remaining/in-cart quantity calculations, quantity validation, orderable guards and persistence intact. Price, selected labels, quantity guidance and both commerce surfaces use the same selected variant. Keep Coming Soon/Out of Stock nonorderable.

Compact the mobile bar and make its current size/color/price unmistakable. Preserve repair anchors, quantity-focus/keyboard behavior, accessible controls and add feedback. Do not introduce a second independently managed cart/selection state or new viewport animation system.

Acceptance: sparse pairs cannot produce invalid combinations; stock-zero/coming-soon disabled; exact override prices and selected IDs reach the existing cart; quantity/in-cart limits and repair still work on phone/desktop. Prefer updating the existing focused commerce test and one sparse-pair case over a new broad suite. Shared test edits wait for RF-01.

Output: RF-03 report, selection mapping explanation, diff and named affected checks.

## RF-04 — Checkout hierarchy and customer confidence

Scope: checkout page/CSS and cart presentation/CSS; footer navigation and new storefront-only Shipping, Returns and Contact information pages if supported by the confirmed facts. Preserve all existing entry URLs; no staff routes or new public return/order APIs.

Reduce repeated operational copy while retaining the important distinctions: bag is not a reservation; submission is a request; WhatsApp confirmation follows; COD and configured delivery fees apply. Preserve fresh-versus-saved receipt wording, required/optional fields, disclosure, coupons, quote validity, uncertain submission and recovery.

Improve form grouping, primary/secondary action hierarchy and summary clarity. Align sticky-summary offsets with the header token; tall content must remain reachable. Do not change validation or submission handlers.

Customer information may state confirmed workflow and the existing 14-day in-system returns window, with later cases handled through WhatsApp. Use configured contact links only. Do not invent universal return eligibility, delivery times, free shipping, payment gateways or new refund promises. Missing contact data requires an honest fallback.

Privacy/terms are owner/legal dependent: prepare a factual data/workflow inventory and a draft for review; do not publish invented retention, consent, company identity or legal terms, or claim compliance. This dependency does not block other implementation tasks.

Acceptance: customer-facing English, keyboard/mobile-readable forms and information; authoritative review/submission/recovery unchanged. Focused existing checkout and saved-acknowledgment coverage retained.

Output: RF-04 report and an explicit list of owner-dependent policy details.

## RF-05 — Product SEO and sharing

Scope: root/page/product metadata, a small storefront-owned metadata helper, sitemap/robots routes if warranted; RF-04 customer pages after their routes are settled.

Add real product title/description and suitable share-image metadata. Generate structured product information only from public selling-price/variant/availability DTOs; never expose costs or assert fake ratings. Never imply a product is purchasable when Coming Soon/out of stock.

Canonical/sitemap URLs depend on a configured public origin. Do not hardcode a purchased domain, localhost in production metadata, or invent an origin. Before a domain is supplied, preserve a usable local preview and document the configuration dependency. Review cache behavior so new metadata does not make stock decisions stale.

Acceptance: metadata reflects the selected public product; hidden products/private values absent; JSON safely serialized; unavailable origin handled explicitly. Use focused metadata checks rather than rerunning the full commerce suite.

Output: RF-05 report with representative rendered metadata and remaining origin dependency.

## RF-06 — Measured performance and optional rendering dependencies

Scope: layout/footer/public-catalog contact loading; next.config and media components for analysis first; ambient/header styles only when evidence supports a correction. Serialize after RF-04/RF-05 because layout/footer are shared.

Prevent optional contact links from blocking the initial shopping shell; use a bounded, graceful contact-loading strategy without changing/caching stock, quote or order requests. Avoid layout shifts in the footer.

Measure image bytes and displayed dimensions before changing delivery. Current originals are already compressed WebPs; the hero is only about44KB. `unoptimized` prevents responsive byte selection, but do not flip global optimization blindly. Propose a minimal reference/contract-compatible thumbnail strategy for main review. Do not add arbitrary image proxies, unrestricted remote fetching, private-IP allowances or new dependencies.

Assess ambient layers/header blur on modest hardware before adding effects. Reduced-motion and touch behavior must remain appropriate. Development diagnostics and source budgets are not production LCP/CLS/INP proof. Production measurements remain an explicitly approved release task.

Acceptance: optional-contact failure cannot stall browsing, stock stays fresh, media protections unchanged, and any performance claim has its matching measurement/environment. No speculative optimization refactor.

Output: RF-06 report with measured baseline, implemented justified changes and deferred production measurements.

## RF-07 — Final integrated quality and review checkpoint

After application editing stops, reconcile only affected tests. Main/Sol verification performs one appropriate Windows typecheck/architecture/storefront build cycle plus the focused homepage, sparse variant/add, bag, checkout and saved-recovery cases. Repeat only failed or newly affected checks. Check memory headroom before browser startup; do not terminate unrelated applications.

Capture accepted-source desktop/mobile home, catalog, PDP, bag and checkout; inspect focus, reduced motion, RTL text within English layout, touch sizing, error/retry and asset consistency. Physical devices, screen reader/zoom, operator pilot, hosting/TLS/proxy/monitoring and external recovery/rollback remain separately recorded release evidence when unavailable.

Produce a concise final report distinguishing completed code, verified behavior, unresolved defects and owner/infrastructure gates. Record changed files and reviewed diff; verify protected hash, empty/unrelated index boundaries, unchanged backend/contracts and ordinary catalog. Main approves quality before requesting a commit decision. No automatic publication.

## Dispatch order and status

**Current status — 15 October 2026:** Grok's implementation queue and the bounded follow-up fixes have finished. Main reviewed the source and accepted the local Windows refinement after affected static checks, focused browser runs, and desktop/mobile visual review. The detailed ledger retains failures and separate reruns; it does not claim one fresh full-suite pass. See [main acceptance report](../reviews/storefront-refinement-implementation-report-2026-10-14.md).

Closing corrections cover the font/Windows teardown harness, sticky-header focus clearance, keyboard visibility in the featured rail, and readable mobile category labels. The final two affected browser cases passed. Application source, catalog data, production runtime, and Git publication remain distinct: no ordinary business data changed, and no commit/push/deployment was made. Physical-device/operator acceptance, approved production measurements, policy/contact details, hosting and recovery gates remain outside this local acceptance.

The dispatch notes below record earlier checkpoints and are historical; they do not mean RF-04 through RF-07 are still queued.

1. RF-01 and RF-03 can start together: distinct implementation files. Test execution and shared test edits remain serialized.
2. RF-02 follows RF-01/RF-03 review so global/PDP typography integrates coherently.
3. RF-04 then RF-05 establish confidence content and its metadata.
4. RF-06 follows shared layout/footer work; media-delivery changes require the measured proposal review.
5. RF-07 closes the integrated pass and records remaining external release gates.

RF-01 and RF-03 Grok processes finished with exit 0 and reports. Independent review confirmed RF-03's sparse-pair mapping and found missing size/price previews on unavailable products. Grok corrected those previews; main source review permits the queue to advance, with browser verification still pending. RF-01's root cause remains unproven; its test change does not establish a resolved homepage defect.

All five remaining briefs have been delivered to the sequential queue. RF-02 is at Grok; RF-04, RF-05, RF-06 and RF-07 are queued. The runner waits at a main-owned source-review checkpoint after every task and carries reviewed constraints to the next worker. It stops on a failed worker; it never commits or deploys. Current status: `.scratch/refinement-20261014/queue/status.json`; briefs/reports/results are in the adjacent folders. Source-reviewed status is not a browser pass, final quality approval or launch approval.

RF-02 subsequently returned exit 0 and its source review permits RF-04 to start. Mobile hero/ticker/spacing/type changes still require real visual/geometry checks; leading/trailing featured-card focus outlines must be checked because mobile rail padding was reduced. RF-04 is dispatched next; RF-05/RF-06/RF-07 remain queued. No final RF-02 visual acceptance is claimed.
