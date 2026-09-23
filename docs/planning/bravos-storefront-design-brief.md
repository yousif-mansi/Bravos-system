# Bravos Storefront Transformation — product/design brief

Status: proposed direction for user review, 2026-09-23. Planning only; no storefront implementation authorized by this document.

Baseline: root `main`, commit `15fd3661b29249ca1fc7f3484654476d6c1b2b1d`. The approved [v1 spec](bravos-v1-spec.md), later user decisions, and existing business contracts remain authoritative. The latest user direction explicitly calls for luxury menswear positioning and a premium, masculine, confident, minimal, modern, editorial identity.

## 1. Objective and boundary

Turn the functional public store into a recognizable Bravos fashion-shopping experience. Help a customer discover an item, understand its fit and actual variant price, choose an available size/color, and send a clear guest cash-on-delivery request.

Success is confidence and ease of shopping, supported by real photography and clear information. Visual positioning must not invent claims about fabric quality, craftsmanship, origin, price tier, heritage, popularity, or delivery guarantees.

Preserve backend contracts, current ordering/stock behavior, permissions, completed tickets, and feature architecture. Keep the internal application's design direction and workflows intact. This phase changes the storefront presentation; it does not introduce accounts, wishlists, reviews, loyalty, new payment methods, shipping accounting, or Module Federation.

## 2. Current implementation

| Surface | Existing implementation | Main presentation opportunity |
| --- | --- | --- |
| Home and listing | `/`, with `q` and `category` in the URL; text/gradient hero, search, category chips, product grid | Photography-led entry, clearer category discovery and merchandising hierarchy |
| Product | `/products/[productId]`; image grid, description, availability, combined variant radios, quantity, optional text size guide | Better gallery, prominent selected price, fit/variant clarity and purchase confidence |
| Cart | `/cart`; persistent browser cart, merged variant quantities, live stock refresh, adjustment/removal, subtotal | Clearer line hierarchy and a more obvious route to checkout |
| Checkout | `/checkout`; guest details, configured area fees, coupon, reviewed quote, duplicate-safe submission and request recovery | Shorter perceived form, clearer mobile grouping and honest COD/confirmation language |
| Shared shell | Official horizontal logo, Cairo, Arabic RTL, store/cart navigation, configured social links, aggregate analytics | A coherent retail header/footer with legible trust and contact information |

Relevant existing files:

- [Home/listing](../../apps/storefront/app/page.tsx), [shared layout](../../apps/storefront/app/layout.tsx), [styles](../../apps/storefront/app/globals.css).
- [Public data reads](../../apps/storefront/app/public-catalog.ts), [public contracts](../../packages/contracts/src/public.ts).
- [Product page](../../apps/storefront/app/products/[productId]/page.tsx), [purchase panel](../../apps/storefront/app/products/[productId]/product-purchase-panel.tsx).
- [Cart presentation](../../apps/storefront/app/cart/page.tsx), [cart persistence and coordination](../../apps/storefront/app/cart/cart-provider.tsx), [checkout](../../apps/storefront/app/checkout/page.tsx).

Current local content is not launch content: two products, one category, test names/descriptions, one unrelated PILOT PODCAST image, and one image placeholder. These records were not corrected during inspection. Evaluate layout and behavior separately from that content.

The current local ordering gate is enabled, but no delivery areas are configured. Cart and checkout hydrate correctly at `http://localhost:3000`; quoting cannot proceed until delivery configuration exists. This is a recorded launch-input gap, not authorization to change configuration in this planning pass. Use `localhost` for this Next development preview; its client connection is blocked through `127.0.0.1`. Staff preview remains `http://127.0.0.1:5173`.

## 3. Data flow and supported capabilities

Server-rendered home/product pages read the shared backend. Browser requests go through the storefront's existing `/api/public/*` rewrite. Preserve current freshness and caching behavior during visual work.

| Existing public capability | Design boundary |
| --- | --- |
| `GET /api/public/storefront/catalog` with `q`, `categoryId` | Search and category filtering; returns the complete matching summary array |
| `GET /api/public/catalog/products/:productId` | Product-level imagery, description, optional size guide, explicit variant prices/availability |
| `GET /api/public/catalog/media/*` | Existing public product-media access rules |
| `GET /api/public/storefront/contacts` | Use configured contact links; do not invent numbers or social accounts |
| `GET /api/public/checkout/delivery-areas` | Manager-configured active delivery areas and fees |
| `POST /api/public/checkout/quote` | Authoritative offer/coupon, delivery and final COD totals |
| `POST /api/public/checkout/orders` | Existing guest request submission, operation identity and uncertain-result recovery |
| `GET /api/public/runtime` | Existing ordering gate; browsing/cart remain distinct from permission to submit |

Public browse summaries contain name and lowest listed variant price, so the complete returned result can be sorted locally by Arabic name or price without a new API. Place missing prices last. The minimum includes unavailable variants; label it “يبدأ من” and show the actual selected variant price on the product page. Do not reinterpret it as the cheapest currently stocked price.

No public creation date, popularity score, sales ranking, campaign configuration, or filter facets exist. Do not add “newest”, “bestsellers”, fabricated reviews, or advanced size/color filtering to this phase. Do not fetch every product's detail merely to manufacture browse filters. No new backend pagination or merchandising system is proposed.

## 4. Customer and shopping journey

Working audience: Arabic-speaking menswear shoppers served by Bravos's Fayoum and Abshway operation, primarily using phones. Discovery through a shared link, social/contact channel, or prior branch familiarity is a design hypothesis, not researched demographic evidence. Do not assume an age or income bracket.

Journey: recognize Bravos → find a relevant category/item → assess images, fit and price → select an available variant → review cart → enter delivery/contact details → review the server-priced COD amount → submit a request → await WhatsApp confirmation.

The main friction points are uncertainty about fit, variant availability, delivery coverage/cost, and whether submission is final confirmation. Resolve these near the relevant decision. Keep help available without replacing the shopping flow with a WhatsApp redirect.

Use existing aggregate visits, product views, cart additions, requests and completed-sales reporting to compare outcomes. No individual visitor profiling or new analytics contracts are part of this brief.

## 5. Visual language and photography

- Use the official horizontal Bravos logo in the storefront. Never redraw it. Preserve the supplied mark/wordmark and use their existing variants for contrast.
- Proposed public palette: ivory/neutral surfaces, obsidian text and primary actions, restrained champagne accents. Keep the brand related to the internal system while giving clothing and photography the main visual space.
- Continue Arabic RTL and Cairo with a deliberate headline/body hierarchy. Use concise, professional Egyptian Arabic; avoid administrative language and exaggerated luxury claims.
- Use one strong editorial hero image, a brief headline and one primary discovery action. Avoid autoplay video, rotating hero campaigns and decorative motion in the first slice.
- Product photography should show the actual garment: consistent main crops, front/back, fabric/detail, and an on-body view where available. Plan separate desktop/mobile hero crops rather than cropping away the garment or model's face.
- The supplied `cover.jpg` is a candidate brand image, subject to crop/readability review. It is not a replacement for product photography. Do not reuse the unrelated local catalog image in the approved design.
- Editorial headlines/images may be approved frontend content. Prices, stock, categories, offers, delivery fees and other business data continue to come from existing configuration/APIs.

## 6. Page briefs

### Homepage

Sequence: simple retail header → editorial hero → actual category/collection discovery → product discovery → short factual brand story → trust/contact information.

Hero: show the clothing and identity immediately, with a proposed “اكتشف التشكيلة” action leading to the existing listing. Keep the first useful shopping action visible on a phone.

Collections: present existing categories with approved imagery and links to `/?category=...`. “Collection” here is a presentation of existing categories, not a new backend entity. Avoid empty editorial sections when there is not enough catalog content.

Product discovery: a concise, browsable grid with clear names, price labels and availability. Any editorial selection must be explicitly approved; do not imply sales ranking from default product-code order.

Brand story: brief, factual copy about Bravos menswear and its local presence. Do not invent founding dates or manufacturing claims. Trust sections may explain COD, WhatsApp confirmation, configured delivery coverage, and verified contact details; no invented free-shipping or refund promises.

### Collection/listing experience

Keep the current route/query model. Show category title, search, visible active filters, result count and a clear reset action. Preserve shareable query URLs and useful empty states.

Offer default order, Arabic name, and lowest listed price ascending/descending, using the complete returned summary list. No newest/bestselling options. Use compact mobile controls without hiding active selections.

Cards: consistent image ratio, readable product name, honest starting price and availability badge. The primary action opens the product so the customer chooses an explicit size/color. Out-of-stock and Coming Soon products remain inspectable under existing rules.

### Product page

Prioritize gallery, name, selected variant price, size/color, quantity and add-to-cart. Support touch-friendly gallery navigation and accessible enlarged viewing if the chosen visual specification includes it; product imagery remains product-level unless the existing data explicitly provides more.

Make the size/color combination unambiguous. Text choices are the baseline; do not infer color swatches from Arabic names or claim garment colors that are not represented by the data. Any separate size/color controls must still resolve an existing variant ID and honor the current orderable/quantity rules.

Keep unavailable choices visible and disabled. Coming Soon and fully Out of Stock remain viewable but cannot be ordered. Do not add urgency counters or stock-reservation language.

Place the existing optional size guide near selection. Show the exact selected price prominently. Add clear quantity/add feedback and a route to the cart. A compact mobile purchase action is a candidate only if it does not obscure fields, messages or keyboard use.

Confidence copy: COD, area-based delivery fee calculated during checkout, and WhatsApp confirmation after submission. Do not promise arrival dates unsupported by current configuration.

### Cart

Make each image/name/size/color combination and quantity easy to scan. Show current line prices and subtotal, with delivery clearly separate until the area is selected and quoted. Keep removal secondary and checkout primary.

Preserve live stock refresh, changed-price/quantity warnings, explicit adjustment actions, cross-tab coordination and browser-storage recovery. Keep the statement that a cart does not reserve stock. Empty cart leads back to discovery.

### Checkout

Use a mobile-first Arabic layout grouped into contact details, delivery/address, and order review. Required fields remain name, primary mobile, delivery area and detailed address; alternate phone, landmark and notes remain optional. Keep coupon use available but visually secondary.

Use the existing server quote to display merchandise, eligible discounts, delivery and the final COD amount. Changing the cart, area or coupon must retain current quote invalidation. No client-side replacement pricing calculations.

Use an explicit request action, such as “إرسال الطلب”, with nearby COD and confirmation context. Proposed success copy: “استلمنا طلبك. هنتواصل معاك على واتساب لتأكيد التفاصيل والتوفر.” Show the real reference. Do not call the request a confirmed shipment, paid order, or reserved stock.

Preserve the exact submission/recovery operation, ordering-closed screen and retained cart. Improve labels, errors, loading and focus behavior without replacing these mechanisms or changing validation rules.

## 7. Acceptance and remaining inputs

Visual acceptance requires a representative, approved content set: real garment photography, product names/descriptions, categories, useful size guides, campaign copy, verified contacts and public delivery/returns wording. The existing 14-day in-system Returns scope must not be expanded into unsupported customer promises.

Verify desktop and phone layouts, keyboard/touch use, readable RTL text, visible focus/selection/disabled states, labeled fields, clear retry/errors, and no page overflow. Keep working behavior for out-of-stock variants, Coming Soon, Hidden, quantity changes, discounts, changed quotes, pending requests and uncertain submission recovery.

Compare before/after performance using the same representative content and environment. Preserve server-rendered discovery/product data and existing code splitting; reserve image space, size images for their display, and avoid unnecessary gallery/animation dependencies. Do not make the whole storefront a new client-side application.

The full catalog response remains an existing scale limit. This visual phase must not silently redesign that contract; record a separate future need if real catalog size justifies server pagination/filtering.

Real-device offline/internal release checks, opening-stock reporting decisions, hosting/TLS/proxy verification, and launch operations remain separate release work. Local preview is not production certification. Domain/hosting booking stays deferred.

## 8. Proposed sequence and delegation policy

1. User reviews this brief and current screenshots; choose approved imagery/copy direction.
2. Produce a focused visual specification for homepage/listing, product, cart and checkout, with representative content and mobile states.
3. Split only the approved presentation work into bounded tickets: public shell/discovery; product experience; cart/checkout presentation; responsive/accessibility/performance verification. Each ticket names preserved contracts and regression checks.
4. Implement only after approval; do not reopen settled business requirements or refactor working internals for preference.

Apply the user's execution policy throughout: **GPT-6 Sol Medium** for normal exploration, retrieval, route/component inventories and straightforward checks; **GPT-6 Sol High** for deeper file analysis, code review, requirement comparisons, screenshots and verification. Every delegation states a bounded task, constraints and expected evidence. Main agent retains product decisions, UX strategy, architecture decisions, implementation planning and final review.

Decision requested for the next phase: approve or adjust this editorial, photography-led direction and presentation-only scope. No implementation, backend changes or commit are implied by creating this brief.
