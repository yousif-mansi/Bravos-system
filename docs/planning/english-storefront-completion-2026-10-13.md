# English storefront and desktop merchandise usability — owner update 13 October 2026

The owner distinguishes implemented logic from a professionally usable product and now authorizes a complete English customer storefront, an image-only opening hero, the supplied licensed Clash Display font, and approximately30sample apparel products with images and sellable branch inventory. Actual merchandise will replace the samples after a hosted preview is online; real content is no longer a prerequisite for completing the preview. This supersedes the earlier Arabic-public-store and no-sample-business-data restrictions. Internal staff screens remain Arabic. Hosting preparation and content replacement are separate from design/functional completion; do not create a circular dependency between them.

The desktop request is specifically product/category organization, **not sidebar regrouping**. Improve Products and inventory intake product discovery using existing categories, names and SKUs; do not redesign the staff shell or business architecture.

## Product decisions

- Preserve official Bravos assets and the dark brand palette. Use Clash Display from the owner's supplied webfont package; keep its license alongside the copied asset. No external font request at runtime. Avoid overly tight spacing or heavy display weights in forms/prices.
- The first home section shows only the cover image, with no visible heading, slogan or overlay copy. Retain an accessible hidden page title. The owner will share a landing-page image or reference; inspect its intended role and crop before replacing the current cover. Downstream category and discovery sections stay clearly separated.
- English customer labels, help, errors, recovery messages, metadata, navigation and price formatting, with LTR layout. Existing DTO/storage fields such as nameAr remain unchanged and may contain English data. Never change contracts to accommodate presentation language. Internal Arabic/auth setup selectors remain intact.
- Preserve current routes, checkout/order/quote/recovery/cart/analytics behavior, stock rules, permissions and APIs. Translate only presentation/error-code messages; unknown server errors get a truthful English contextual fallback rather than leaking raw Arabic or inventing success.
- Build clothing discovery around Pants, Jackets, Shirts and T-Shirts. Strong commerce comes first: clear names/prices/statuses/selection, deliberate photo sizes, bounded hover/reveal motion, readable category boundaries and consistent shopping controls. No fabricated campaigns, reviews, contact accounts, delivery times or factual manufacturing claims.

## Sample range

`assets/sample-catalog/catalog.json` defines30products:8pants,6jackets,8shirts,8tees. Each has one image-matching color and four explicit sizes; five units per size in each configured branch. Sample prices/costs are manifest data, not hard-coded business application rules. Generated images are fictional sample merchandise and their source/prompt/provenance is retained. Codes BRV-SAMPLE-001 through030 make replacement and ownership explicit. Preserve existing products and transactions; no reset, deletion or stock reassignment.

Use an additive, resumable loopback-development HTTP intake script: inventory-first hidden product/pairs, receiving receipt with stable operation ID and immutable payload per branch, media upload through the existing feature API, then revision-guarded publication of those existing pairs. Never write business tables/media-store files directly, refill consumed stock on rerun or modify contacts/delivery/ordering gates. Persist intents/responses and snapshot existing relevant data into ignored local storage. Privately supplied owner credentials are never echoed or committed. Generated asset sources live in the workspace rather than only tool storage.

## Independent Grok execution lanes

| Lane | Exact implementation ownership |
| --- | --- |
| A — English shell and discovery | Storefront layout/fonts/tokens/globals, header/footer, home hero/confidence, collection controls/chips/sort, home page, product wall/media, public-catalog helper and global fallback routes |
| B — English product and bag | Product route/gallery/purchase panel/CSS and cart presentation components/CSS; preserve UX04 quantity correction and provider/storage/price/add logic |
| C — English checkout | Checkout page/CSS and one client-side public error-code message helper if needed; preserve quote/submission/draft/recovery logic and optional disclosure |
| D — Desktop merchandise organization | Internal CatalogPage, ReceivingPage and page-scoped staff CSS; existing full loaded manager lists, category paths, name/SKU filters, counts/clear and selected-record preservation |
| E — Sample intake tooling | New scripts/sample-catalog.ts and focused pure script coverage/documentation; no ordinary data mutation until main reviews and owns execution |
| F — Test/integration adaptation | After A–E stop editing: customer-only English selector/font/hero/LTR updates in affected existing browser tests, retaining business/recovery assertions; internal setup remains Arabic |

Main owns content/image direction, scope, reviewed integration, ordinary-local intake and final appearance. Sol provided read-only inventories. No implementer runs shared servers/tests/builds, commits/pushes or GitHub mutations concurrently. Shared test edits are serialized. No Linux work or production-impacting operation is part of these lanes.

## Completion evidence

Inspect diffs and actual English pages with the30-item catalog, desktop1440 and mobile390screenshots. Run workspace typecheck and storefront/internal builds once after assembled source/test work. Focus browser execution on changed discovery, product/quantity/bag, checkout successful and uncertain submission, and desktop category/intake selection. Verify catalog count/category/variant/media/public-cost exclusion and duplicate-safe receiving through real APIs without submitting ordinary orders/sales. Do not repeat unrelated API/backup/offline/full suites unless a demonstrated regression warrants it. Hosted Windows CI remains a later publication check, not a local pass claim.

Completion means a coherent usable demo store and desktop merchandise workflows, not merely changed strings. Record remaining genuine defects separately from owner-host/device/recovery launch execution. No automatic commit, push, deployment or public opening. Preserve the pre-existing protected review SHA2563361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A and every unrelated local asset/file.
