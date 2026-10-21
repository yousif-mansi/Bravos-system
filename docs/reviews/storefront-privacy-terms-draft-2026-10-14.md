# Storefront privacy and terms — factual inventory and unpublished draft

Date: 2026-10-14
Status: owner and legal review only. This file is not a published policy, not customer-facing copy, and not a claim of compliance.

Do not link this document from the storefront. Do not treat it as terms of sale, a privacy notice, or a retention schedule until the owner and a legal reviewer supply the missing facts below and approve publication.

## What this inventory is based on

Read-only inspection of the current public storefront and the approved business rules it already implements:

- `apps/storefront/app/checkout/page.tsx` — guest checkout fields, quote request, order-request body, and browser storage keys. Quote, submission, recovery, and storage functions were not changed for this draft.
- `apps/storefront/app/checkout/checkout-draft.tsx` — in-memory checkout fields for the current navigation only.
- `apps/storefront/app/cart/cart-provider.tsx` and `cart-types.ts` — bag storage key and stored line fields.
- `apps/storefront/app/analytics-events.ts`, `storefront-analytics.tsx`, and `packages/contracts/src/public.ts` — public analytics event shapes actually sent by the storefront.
- `apps/storefront/app/public-catalog.ts` and `packages/contracts/src/public.ts` — configured contact links only.
- `docs/planning/returns.md`, `docs/planning/phase-1-operational-updates.md`, and `docs/architecture/principles.md` — confirmed order, delivery, and returns workflow. Later English storefront decisions do not add a public returns API.

No new collection, retention, consent, or legal-identity data was invented to fill gaps.

## Data the public storefront already handles

| Item | Where it lives | What the source shows |
| --- | --- | --- |
| Bag | Browser `localStorage` key `bravos-guest-cart-v1` | Product id, variant id, product/size/color names, unit selling price, image reference, quantity, last known available quantity, orderable flag, storage revision, and completed checkout operation ids. |
| Checkout typing | React memory in `CheckoutDraftProvider` | Name, primary mobile, delivery area id, detailed address, alternate phone, landmark, notes, coupon code. The provider comment states these fields are not written to browser storage by the draft itself. Accepted submission clears the draft. |
| Order-request attempt | Browser `localStorage` key `bravos-guest-checkout-v1` | A pending or accepted attempt: operation id, quote id, the customer and address fields above, optional coupon, line variant ids and quantities, and, once accepted, the returned order reference, pending status, submitted time, and reviewed quote. |
| Price review | `POST /api/public/checkout/quote` | Variant ids, quantities, delivery area id, optional coupon code. |
| Order request | `POST /api/public/checkout/orders` | The same customer, address, area, coupon, and line fields, plus operation id and quote id. |
| Delivery areas | `GET /api/public/checkout/delivery-areas` | Configured area id, Arabic area name, and fee. |
| Contacts | `GET /api/public/storefront/contacts` | Optional WhatsApp, Facebook, Instagram, and TikTok URLs. Empty or failed loads stay empty. |
| Analytics events actually sent by the storefront | `POST /api/public/analytics/events` | `visit` with an operation id; `product_view` with product id; `cart_addition` with product id, variant id, and quantity. The storefront client does not send a customer name, phone, or address on these events. |
| Accounts | Public storefront | No customer account, login, or password is collected. |

Purchase cost, profit, and inventory value are excluded from the public pages and public DTOs used above. This inventory does not authorize exposing them.

## Confirmed workflow statements already safe to show customers

These are implemented behavior and approved business rules, not new legal terms:

- The bag does not reserve items. A submitted online order is a request, not a completed sale, until staff confirm it.
- Confirmation is by a Bravos representative on WhatsApp. Payment on the public storefront is cash on delivery. There is no public payment gateway.
- The delivery fee is the configured fee for the selected area and is shown in the price review. No free-shipping rule is configured by this page.
- No delivery date is promised.
- An in-system return can be recorded for 14 days from receipt. The start is physical-sale completion or online delivery. Later defect cases are handled through WhatsApp, not a second public return route.
- A customer may use branch drop-off or arrange a courier externally through WhatsApp. A WhatsApp message does not by itself create a return or refund record.
- The public website does not accept a return submission. No public returns API was added.
- The manager can change the refund amount that was suggested from the amount paid. A customer page must not promise a fixed refund.

## Unpublished draft notice — not for the website

The following sentences are a draft for review. They only restate the table above. They omit every fact that is not in the source.

> Bravos menswear in Fayoum lets a guest place an order request without an account. The bag and an in-progress order request may be stored in this browser so a repeated send can be recognized. Checkout asks for a name, primary mobile number, delivery area, and detailed address. An alternate number, landmark, notes, and coupon code are optional. The order request, including those details and the reviewed cash-on-delivery total, is sent to Bravos for a representative to confirm on WhatsApp. Delivery fees are the configured area fees shown before the request is placed. Bravos records aggregate visit, product-view, and bag-addition events. Configured WhatsApp, Facebook, Instagram, and TikTok links are shown only when Bravos has published them.

Do not add consent checkboxes, cookie categories, retention periods, international transfers, a data-protection officer, a company registration number, or a promise of security from this draft.

## Owner and legal dependencies that block publication

Publication of a privacy notice or terms page needs facts this repository does not contain:

- Legal name of the business, registration or tax identity, and the public postal address, if any of those are to be stated.
- Which branch street addresses, phone numbers, or email addresses may be published. Configured social and WhatsApp URLs are the only contact values the storefront loads. Missing values must stay missing.
- How long order requests, customer addresses, phone numbers, quotes, analytics events, and browser bag/attempt records are kept, and who can delete them.
- Whether any cookie, host, CDN, or analytics tool beyond the three event types above is used in the deployed environment. This draft did not inspect a production host.
- The lawful basis, consent wording, and any age or marketing rule the owner wants to state.
- Whether Egyptian consumer rules give customers rights beyond the 14-day in-system return. The application must not claim that the 14 days ends those rights.
- The customer-facing refund amount rule, if the owner wants one published. Today the manager can edit the suggested amount.
- Governing law, liability limits, and any terms of sale. None are approved in the storefront source.
- A privacy or complaints contact that remains honest when the storefront contact links are unconfigured.
- A decision to publish at a real origin. No domain is hardcoded here.

Until those items are supplied and approved, Shipping, Returns, and Contact may stay published from confirmed workflow facts, and privacy/terms pages must not.
