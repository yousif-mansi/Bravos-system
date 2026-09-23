# Storefront content and visual asset readiness — SF-00

**Date:** 23 September 2026. **Status:** SF-00 specification and inventory complete; production photography/copy remain pending as listed below. **Scope:** Visual-input specification and readiness review, not production content approval or catalog editing.  
**Roadmap:** [Approved storefront roadmap](bravos-storefront-roadmap.md).

## Readiness decision

Foundation work may use the official logo assets, truthful existing interface copy and unchanged current catalog data. New photographic homepage/product presentations need real approved photography before visual acceptance. Campaigns/editorial are optional and render nothing when absent; shop discovery, prices, variants, cart and checkout remain complete without them.

No catalog records, prices, stock, delivery settings, business data or production media uploads are changed by SF-00. Existing test images remain test content, not evidence of launch readiness. Do not generate fashion imagery that purports to show merchandise or invent product facts.

## Required assets and crop rules

| Input | Required delivery | Acceptance / affected ticket |
| --- | --- | --- |
| Lead hero | One real, approved Bravos/garment photograph; source master, owner/usage permission, focal point and subject description | SF-03: one lead story, no baked-in copy or CTA, no false product association |
| Desktop hero crop | Prefer 16:9, approximately 2400px source width when available; retain garment and subject context | Verify 1024/1440px and short-height windows; never upscale a small source and call it production-ready |
| Mobile hero crop | Prefer 4:5, approximately 1200px source width; explicit crop intent or separate approved photograph from the same story | Verify 320/390px; do not blindly center-crop faces, garments or baked-in branding |
| Product lead image | Actual item, accurate color/texture, consistent neutral treatment; 4:5 wall crop, source around 1600px long edge where available | SF-02/SF-06: readable full garment, no misleading alteration; direct existing catalog media API |
| Additional product views | Back/alternate angle, detail/fabric and on-body fit where supplied | Helpful rather than a fabricated minimum: one-image and no-image states remain supported; preserve source order |
| Optional campaign | Approved photograph, short Arabic caption, existing public destination and documented seasonal relevance | SF-04: zero modules is valid; no blank storytelling sections, placeholder campaigns or invented urgency |
| Optional editorial | Approved factual copy/image and existing destination | At most one island; omit entirely if absent, with no reserved blank space |

These are composition/source requirements, not permission to transform/upload catalog images. Final format/delivery sizes are measured in SF-11. Static editorial assets may have prepared responsive derivatives with the source retained. Catalog images must keep current publication checks, no-store behavior and revocable direct URLs; no persistent optimizer cache.

Wall imagery uses a reserved 4:5 frame. Gallery composition may contain the image within that frame to avoid cutting off the garment. Ratios remain consistent within a wall; editorial compositions may differ only with approved art direction. Reserve dimensions before loading. Do not bake typography into photographs, infer a variant image from its name, recolor garments, invent detail views, or blur away material truth.

## Existing asset assessment

The official SVG horizontal logo is the storefront identity source; never recreate it. Existing primary/mark/wordmark variants remain available for their approved purposes. Sol inspected the files read-only; the main agent reviewed visual suitability separately.

| Existing input | Verified file facts | Readiness |
| --- | --- | --- |
| `logo svg/` and matching `apps/storefront/public/brand/` copies | 16 official SVGs; primary canvas 503×629, horizontal 923×389, mark 361×389, wordmark 539×389. Black/Dark/Ivory/White variants; master/app hashes match. Canvas dimensions are not visible artwork bounds. | Available for shell; no recreation. Horizontal Black remains header identity. |
| `cover.jpg` and matching app brand copies | 2048×774 progressive JPEG, 44,269 bytes; copies identical | Existing brand backdrop, not accepted here as the new responsive hero |
| Local API media `products/613224cd-4467-4503-9030-3580c7433017.png` | 1254×1254 PNG, 1,356,598 bytes; current preview/design brief identifies unrelated podcast artwork | Diagnostic existing data only; not approved garment photography; untouched |
| `.local/e2e-product-media/products/` | 11 identical 1×1 PNG fixtures | Test-only; excluded from visual/performance acceptance |
| Public source assets | No separate hero or real garment-photo set found in tracked storefront public files | SF-03/representative product photography inputs pending |

Inventory scope is repository/local files, not an assertion about external asset libraries. No source masters, approved campaign captions/crops or structured product-chapter approval records were found. Existing description/size-guide/API copy remains authoritative for current product facts; example import CSV content is development-only. Full factual inventory is retained in `.scratch/storefront-foundation/asset-inventory.md`.

Main-agent visual review of `apps/storefront/public/brand/cover.jpg`: a dark, very wide model photograph with the central Bravos mark, wordmark and “MEN'S WEAR” baked in. Preserve it as the existing brand reference/backdrop. It is **not approved here as the new photo-only responsive hero**: the baked-in branding competes with the shell, and a narrow portrait crop would cut the composition. Request a clean source or another real approved photo for SF-03; do not remove/recreate its logo or manufacture a replacement.

## Placeholder rules

- Missing product media uses a neutral, dimensionally stable fallback with honest text. Never substitute another garment, stock fashion photo or generated item as the product image.
- Existing demonstration/test imagery can exercise current technical flows unchanged; label evidence as diagnostic. It does not pass photography or final performance acceptance.
- No new fake product/category/campaign data. No production “coming soon” story invented to occupy an empty section.
- Missing optional campaigns/editorial produce no section, heading, empty frame or spacer. Commerce is the default complete experience.
- Scratch visual evaluations must be isolated and clearly marked evaluation-only. They cannot become production assets by accident.

## Copy approval requirements

| Copy | Required source / approval |
| --- | --- |
| Hero | One short Arabic lead/caption and one primary CTA with an existing product/category/shop destination; main-agent composition review and owner confirmation of campaign/product claims |
| Product identity, price, variants, availability | Current public catalog/API only; never hard-code replacements in editorial content |
| Alt text | Factual description of visible merchandise/context; no unverified material, fit, model identity or variant association |
| Fit, fabric, care, style | Explicit owner/supplier-provided facts per existing product ID, approval/source recorded; omit any missing chapter rather than infer from names/photos |
| Trust/shipping | Existing COD, configured delivery and later WhatsApp-confirmation workflow. No guessed delivery dates, free shipping, certification, guarantees or stock reservation promises |
| Footer/contact | Existing configured public contact URLs and truthful brand/location copy only |

Maintain a small source record for any new editorial asset/copy: source path, owner/provider, permitted use, related product/category ID if relevant, crop/focal point, alt/caption, approving person and approval date. Unknown approval or usage rights means pending, not approved by file presence.

## Typography decision boundary

Keep Cairo for commerce/body. Main agent selected a single regular-weight Amiri face for editorial headings after reviewing the 390px Arabic/mixed-text comparison; desktop/phone and fallback renders are recorded in `.scratch/storefront-foundation/font-comparison/`. The Arabic WOFF2 is 108,560 bytes. Use local loading with retained license, optional font display and Cairo fallback; actual-page verification still belongs to SF-01. Prices, forms, product identity and cart/checkout headings remain Cairo. [Upstream font project](https://aliftype.com/amiri/) and [distributed license](https://raw.githubusercontent.com/google/fonts/main/ofl/amiri/OFL.txt) identify the font and permitted distribution. Preserve readable line height, unclipped marks and no Latin tracking on Arabic. Font selection does not authorize new marketing copy.

## Missing-input checklist and downstream gates

- [ ] Approved clean hero source, desktop/mobile crops, rights and caption/destination — SF-03 photographic acceptance.
- [ ] Real representative garment photos linked to existing products — SF-02/SF-06 visual acceptance and SF-11 representative performance.
- [ ] Explicit optional product chapter facts — SF-08 displayed chapters only; absent sections stay omitted.
- [ ] Optional campaign/editorial inputs — only if the business has them; never a prerequisite for product or purchase-confidence work.
- [ ] Owner-configured delivery areas/fees for a complete business preview — existing operational configuration outside SF-00/SF-01; isolated automated test fixtures are separate.

SF-00 completion means the requirements and verified readiness inventory are recorded. It does not mean all production assets exist. SF-01 may proceed after that review without adding or changing catalog content.
