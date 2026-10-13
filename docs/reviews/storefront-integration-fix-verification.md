# Bounded storefront integration fix verification

30 September 2026. Baseline: `741fdf84ae7dd4e92a806b97674ba7e8835c3c08`. This records the authorized SF-10 acknowledgment correction and focused SF-07/SF-09/SF-10 commerce gate recommended by [the integration review](storefront-integration-741fdf8.md).

## Delivered scope

Exactly three application/test paths changed for this delivery:

| Path | Reason |
| --- | --- |
| `apps/storefront/app/checkout/page.tsx` | Replace one acknowledgment paragraph so a saved acceptance reopened after staff confirmation does not claim the order is currently pending or its stock currently unreserved. |
| `tests/browser/checkout.spec.ts` | Assert the corrected acknowledgment on initial acceptance, accepted reload and exact replay after staff confirmation; verify `BRV-1000000` survives lost response/repeated recovery with one order and one cart subtraction. |
| `tests/browser/storefront-integration.spec.ts` | Add four real-API customer journeys for branch caps, incompatible baskets, post-quote stock changes and hidden sparse pairs, with public-response privacy and anonymous staff-return lookup denial. |

The exact approved replacement is:

> استلمنا طلبك للمراجعة. إرسال الطلب لا يحجز القطع؛ تأكيده يتم عبر واتساب.

The reference and the total the customer reviewed remain visible. Submission/replay semantics, stock protection, accounting, public contracts, state ownership and the storefront design are unchanged. No tracking, branch selector, public payment or customer returns workflow was introduced.

## Current verification

The coordinator's final evidence is retained in ignored `.scratch/storefront-integration-20260930/verification.md` and its logs. Runtime: Node 22.13.1 and pnpm 10.34.5.

- HTTP: **39/39 passed** across `catalog.test.ts`, `storefront.test.ts`, `storefront-sort.test.ts`, `checkout.test.ts` and `order-confirmation.test.ts`. Existing coverage was reused; no new HTTP suite was needed.
- Browser: **21 distinct selected cases have passing evidence** across an initial **17 passed / 4 failed** run of seven suites and a focused **9/9 passed** rerun of `checkout.spec.ts` and `storefront-integration.spec.ts`. This was not one 21/21 run. Four test-fixture failures were repaired: worker-regenerated control-file lookup, an untrusted Origin preceding anonymous authentication, and two exact-label timeouts. The latter used accessible textbox names on rerun. The final later import correction was type-only. No application behavior defect was found.
- `pnpm typecheck` and `pnpm check:architecture` passed. Architecture checks covered 332 modules, 1,004 dependencies and 283 files for private-import checks.
- `pnpm build` passed API, internal and storefront production builds plus bundle separation. Storefront Next build ID: `PMBgxcValrZDJTHd5PhTx`.
- Independent High source reviews are clean, including the corrected test fixtures. Final integration test SHA256: `B0CDAD12B2B65FE29F06FEE924F33964438460C7AE4107D0BE6BD4099F49337A`.

The new journeys verify A=2/B=3 exposes a cap of 3 and rejects 4; X only in A plus Y only in B cannot quote together and retains cart/customer inputs through repair; losing the common fulfillment branch after review rejects POST without creating an order and permits renewed review; hiding a carted sparse pair removes its public selector and marks its stored line unavailable while POS retains its original variants and quantities. Actual public catalog, quote, acceptance and exact replay responses reject internal cost/profit, branch, allocation, staff and customer-history fields. A cookie-free request using a trusted staff Origin receives `401 UNAUTHENTICATED` from the new internal return-source endpoint.

All fixture stock changes used the fresh isolated harness database. The existing isolated fictional demo was preserved and restarted on current source without reset/refill. No real catalog or operational database changes were made. Owned test ports were closed after verification. No commit has been made for this delivery.

## Production preview limitation

One renewed, authorized production-preview start was rejected by automatic approval review with the reason **“blocked by policy”** and no further explanation. No alternative launch was attempted. Port 3000 stayed closed; no production runtime screenshots were captured.

The main agent inspected the [development-only recovered checkout screenshot](../../.scratch/storefront-integration-20260930/development-only-screens/checkout-recovered-long-reference-phone-390.png): the revised acknowledgment and `BRV-1000000` fit/read at 390px, with the reviewed EGP 275 total and return action legible; the existing dark panel and branding remain. This is narrow checkout readability evidence. The screenshot is an ignored local artifact, not a committed report attachment.

Browser test screenshots are development-only evidence. This delivery establishes neither production visual/brand or whole-store approval nor SF-11 performance acceptance or final physical-device acceptance. Those remaining gates must be assessed on an authorized production runtime; the successful production build does not replace them.
