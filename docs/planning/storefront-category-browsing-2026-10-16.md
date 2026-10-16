# Storefront category browsing revision

Owner-directed revision, 16 October 2026. Supersedes the previous selected-products and all-products homepage composition and the prior card-image containment rule.

- Remove storefront search UI, URL/state/helper code and public catalog search filtering. Staff SKU, POS and returns search remain operational features.
- Replace the homepage's duplicated product displays with named category rails. Native swipe, keyboard navigation and explicit Previous/Next controls must reach every product. A category URL remains a focused collection destination.
- Keep `#catalog-title` valid for existing commerce return links. Preserve official image-only hero, English/LTR, Clash/Rose, dark identity, public publication rules, cart/checkout/recovery and analytics semantics.
- Serialize only the first homepage row's first four summaries initially. Lower rows load through the existing category endpoint when approached or explicitly requested; mount additional cards in bounded batches. No shared/persistent availability cache and no full hidden product tree.
- Keep default order and both price directions; preserve zero/null/tie behavior. Remove alphabetical ordering and visible product totals. Do not invent Featured or Newest metadata.
- Product-card titles are centered at all widths, retaining `dir=auto`. Media is approximately 4:5 (sample sources are 1122×1402), edge-to-edge cover with no image padding/margin and rounded frames. Price and stock remain on one line.

Grok implements the application changes. Sol assists with inventory, focused test updates, verification tooling and independent review. Main retains product and integration decisions.

Acceptance requires source review, typecheck, architecture/build gates, affected public API/sort and shopping tests, and a full-page visual evidence matrix. Scroll the complete page in overlapping viewport captures before the full-page screenshot; exercise each rail through its remaining products and inspect representative detail, bag, checkout and information states. Record failures and incomplete verification honestly. Ordinary catalog/order/stock data must not be mutated by visual capture.

Performance claims must distinguish fewer initial browser cards, image elements and serialized summaries from backend work: the existing public read still obtains the summary catalog server-side, and per-category reads are not paginated. No production-vitals claim follows from development screenshots.

No commit, push, deployment or production-data change is authorized by this document.
