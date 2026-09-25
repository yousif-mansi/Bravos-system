# SF-02 — Bravos product wall: visual execution proposal

**Status:** Approved for SF-02 application implementation on 25 September 2026; locally implemented and verified for user review, uncommitted.
**Baseline:** SF-01 `fec7ec7`, pushed to `origin/main` (`15fd366..fec7ec7`).
**Scope:** Existing catalog tile presentation only. Search/filter behavior, homepage storytelling, product detail and cart/checkout remain outside this slice.

## Product direction

The wall reads as a continuous field of garment images, followed by compact, plainly readable commerce captions. Photography gets the largest area; the frame itself has no shadow, rounded container, floating badge, quick-buy panel or decorative furniture. One tile opens one product detail page so the customer can choose a real size/color before purchase.

Use the SF-01 bone/ink palette, Cairo for every product name/price/state, and the existing editorial type only for section headings. Do not add another typeface. Missing campaign content has no effect on this wall's usefulness.

## 1. Tile composition

| Element | Proposed rule |
| --- | --- |
| Image dominance | Reserved 4:5 frame. At normal title lengths, roughly 75–82% of tile height on desktop and 65–72% on two-column phones is image; these are composition estimates, not fixed height constraints that clip text. |
| Grid | Four columns at viewport ≥1200px; three at 768–1199px; two at 360–767px; one below 360px. Images may extend through the shell's inner padding to its existing outer 1240px maximum, becoming edge-to-edge on phones; caption insets preserve readable margins. Keep RTL order. Zoom/narrow views can fall back to one column rather than squeeze names. |
| Whitespace | 2px inline gap between image columns; 24px between complete rows. No outer tile box or shadow. Caption spacing/inset is 12px desktop and 8px phone. Image gutters stay tight while text has breathing room. |
| Product name | First line of caption, aligned to logical inline-start (right in Arabic), Cairo 16px/24px, weight 600. Show the actual full name; wrap long names without ellipsis, fixed-height clipping or fabricated subtitles. |
| Price | Next caption line, 15px/24px, weight 500, with a readable 14px `يبدأ من` prefix when price is known. Remains visible without hover. The name leads the text hierarchy; the price stays clear and close to it. |
| Availability | Plain 14px/20px text beneath price: `متوفر`, `غير متوفر`, `قريباً`, using existing availability mapping. Quiet muted treatment for available; stronger ink for unavailable/Coming Soon. No green/red pill or overlay over photography. |
| Repetition | Omit the repeated category caption inside each tile; the current category/search controls still provide that context. No material, collection, savings or popularity subtitle invented from names. |
| Interaction | The whole tile remains one semantic product link. No nested buy button, wishlist, quick view or duplicate image/name tab stops. Focus has a visible inset outline that is not clipped by the narrow gutter. |

Price and state follow the full product name in reading order. Grid rows expand for the longest caption rather than hiding names to force a decorative baseline. Do not make availability dependent on color alone.

## 2. Image behavior

- Preserve the 4:5 slot on load, image failure and missing-image states. Product photography supplied at 4:5 naturally fills it.
- Default existing arbitrary-ratio imagery to **contain** within the neutral frame so the whole garment remains visible. Do not blindly cover-crop a square or wide source. Full-bleed crop acceptance belongs to the approved source-photography workflow; there is no focal-point/crop field to infer here.
- Keep original image bytes, refs and order. No upload, retouch, generated fashion image, source replacement or per-product crop configuration is part of SF-02.
- Desktop hover only underlines the product name, limited to fine pointers. No image scale, crossfade or secondary image: the browse summary provides just `previewImageRef`, not a second image. Do not fetch every product's detail to manufacture a hover gallery.
- Mobile has the same image/name/price/state hierarchy with no hover requirement. One tap opens details. No swipe carousel inside tiles.
- Missing or failed media renders the same neutral reserved frame and honest text such as `الصورة غير متاحة`. An image failure never substitutes another garment or a cached image that the API has revoked.
- Keep the whole-tile accessible name useful: product name, readable price/state and one focus target. Image alternative text must not duplicate long names or invent visual claims. The existing decorative image alt is appropriate when the adjacent linked name already identifies the destination.

## 3. Commerce clarity

| Returned state | Wall presentation | Behavior preserved |
| --- | --- | --- |
| Non-null lowest price | `يبدأ من` + existing EGP formatter result | This is the lowest **listed variant** price, not a quote or guaranteed in-stock option. Never recalculate prices or invent discounts. A real zero remains zero; null is not zero. |
| Null lowest price | `السعر عند الاختيار` | Preserve honest existing wording; no invented number or free-product claim. |
| `in_stock` | `متوفر` | At least one variant is stocked; do not imply every size/color is available or show invented quantities. |
| `out_of_stock` | `غير متوفر` | Tile remains browseable and links to the existing non-orderable detail experience. Do not dim the garment/name until unreadable. |
| `coming_soon` | `قريباً` | Tile remains a browseable preview; no release date, reservation, preorder or enabled purchase action introduced. |
| Hidden | No tile | Continue using the server's public filtering; do not add a frontend bypass or fake empty slot. |

One restrained wall-level clarification may read: **`راجع سعر المقاس واللون وتوفرهما في صفحة المنتج.`** This communicates why a starting price is not the exact selected-variant price. The lowest price can belong to an unavailable variant; the current API is not changed to choose a different minimum. Keep the exact selected price/availability decision on the existing product page.

No `جديد`, `الأكثر مبيعاً`, discounted strike-through, sale percentage, low-stock urgency, delivery promise or other unsupported label. No stock/order behavior changes and no quick-add bypass of variant selection.

## 4. Performance and media safety

- Keep SSR browse data, existing public helper/DTO and direct `/api/public/catalog/media/...` URLs. Next image optimization remains disabled; preserve `no-store` and per-request Hidden/removed-media revocation. No CDN/optimizer/service-worker cache introduced.
- Reserve dimensions with the frame aspect ratio and use accurate `sizes` for the proposed columns. `sizes`/CSS alone do not generate smaller catalog files or reduce their source bytes; do not claim otherwise.
- At most one genuinely above-fold lead media request may be prioritized. The current large homepage lead can put all product tiles below the first viewport; do not blindly retain `priority={index === 0}`. Use normal/lazy loading for wall media when below fold. Loading-order behavior is explicitly verified.
- Reuse existing Next/React capabilities. No masonry, animation, carousel or image package. Product cards/wall remain server-rendered; only a small media fallback leaf may need client state for failed-image handling. Do not hydrate the whole catalog to handle one broken image.
- Keep failed-image recovery bounded; no repeating failed requests, detail-fetch-per-card, stock polling or placeholder animation that shifts layout.

## 5. Visual examples

Evaluation-only URL: `http://127.0.0.1:3021/` (prepared in ignored `.scratch/storefront-wall/proposal/`). This is a static design specimen, not a new app route or catalog.

The examples use the existing neutral-review approach: official shell/logo, generic clearly labeled title specimens and neutral 4:5 image space. State cases demonstrate available/unknown-price/out-of-stock/Coming Soon, plus missing/failed image presentation. The null-price specimen uses Coming Soon rather than claiming stock: the current backend returns null when no variants exist. If sample numeric prices are shown, they are read-only values from the current public preview and explicitly not offers or a new catalog record. No fashion images or product claims are fabricated.

Required views: 1440px four-column wall; 768px three-column wall; 390px two-column wall; 320px one-column fallback; visible keyboard focus and fine-pointer hover. This can establish hierarchy, rhythm, RTL and commerce clarity. Final crop/photography quality cannot be approved from neutral placeholders; SF-00 real-asset gates remain.

Main-agent visual review is complete: the 1440px and 390px examples and availability-state detail were inspected. Layout checks confirm 4/3/2/1 columns at 1440/768/390/320px, reserved 4:5 frames, specified caption sizing, visible focus and no horizontal/caption overflow. The draft uses only existing read-only preview price values (500/300 EGP), detached from the explicitly generic sample names. No application tests were rerun because application code is unchanged; these are specimen checks, not implementation acceptance.

Evidence: `.scratch/storefront-wall/proposal/README.md`, `verification.json`, `screenshots/1440.png`, `390.png`, `320.png`, `768.png`, `states-1440.png`, `hover-1440.png`, `focus-390.png`, and `media-fallbacks-1440.png`. Restart the static preview with `node .scratch/storefront-wall/proposal/server.mjs` from the repository root if needed. SF-01 typography preview on port 3020 remains separate.

## 6. Authorized implementation boundary

| File/component | Intended responsibility |
| --- | --- |
| `apps/storefront/app/page.tsx` | Replace only repeated product-grid/card markup; retain server fetch, routes, search/category controls, empty state and query semantics |
| `app/components/shop-wall.tsx` (new) | Responsive grid and optional single price clarification |
| `app/components/product-card.tsx` (new) | Existing product link, full name, formatted starting price and availability caption |
| `app/components/product-media.tsx` (new) | Direct image URL, reserved ratio and bounded missing/failed fallback |
| `app/components/shop-wall.module.css` (new) | Scoped wall/tiles/responsive/focus rules; do not change shared gallery/cart `.photo-frame` behavior |
| `tests/browser/storefront.spec.ts`, `catalog-media.spec.ts` | Preserve existing hooks/assertions; add focused wall/starting-price/failure/viewport checks only where needed |

`public-catalog.ts`, `next.config.ts`, contracts, APIs, catalog/media storage, stock/orders and all business data are read-only. SF-03+ UI, filters/sorting, product commerce rail and checkout remain outside this proposal.

## Acceptance and approval gate

- [x] Main agent visually reviews desktop/mobile examples and all caption states before requesting approval.
- [x] User authorized this visual proposal and bounded SF-02 implementation on 25 September 2026.
- [ ] After implementation: full names and prices readable, correct state labels, one useful link per tile, no clipping/overflow at defined widths and zoom.
- [ ] Missing/broken media keeps dimensions; direct media and Hidden/removal revocation tests still pass.
- [ ] No fake labels/content, catalog writes, API/logic changes, extra runtime dependencies or gallery fetches.
- [ ] Run typecheck and affected storefront/catalog-media Playwright suites; inspect loading requests and preserve current behavior/tests. Report unrelated pre-existing failures explicitly rather than silently fixing them.

The 25 September authorization covers this wall language and bounded SF-02 execution, followed by SF-04 and SF-05. The current storefront font remains in place for this batch; its replacement is deferred. Application implementation and local verification are recorded in the [joint review](../reviews/storefront-wall-discovery-review.md). Final photography/art-direction and physical-device/performance gates remain; commits still require user approval.
