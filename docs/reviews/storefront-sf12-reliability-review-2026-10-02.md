# SF-12 storefront reliability review — 2026-10-02

This bounded review verifies cart availability retry, failed cart media recovery, and a real shopping journey with aggregate analytics. The only new application behavior is the cart thumbnail fallback in `apps/storefront/app/cart/cart-line.tsx`: a failed image displays Arabic feedback inside the existing reserved photo box; a later replacement media reference renders normally. Existing cart details, quantities, actions, and decorative image alt text remain intact.

Coverage changes are in `tests/browser/storefront-gallery-cart.spec.ts` (two new cases), `tests/browser/storefront-journey-analytics.spec.ts` (one new journey), and the stale acknowledgment assertion in `tests/browser/storefront-experience.spec.ts`. The prior checkout acknowledgment correction and its integration evidence remain unchanged.

## Results

- Initial targeted gate: **2 failed**. The media case failed at the missing Arabic fallback, establishing the application defect before its fix. The availability case failed because a broad status-role locator also matched quantity outputs; the fixture selector was corrected to `.cart-status`. Exact output is retained; this first run is not claimed as a passing retry check.
- Frozen post-fix run: **12/12 passed**, one worker, **1.8 minutes**, in one run: gallery/cart 4, journey 1, experience 1, catalog-media 1, checkout-recovery 5. No additional browser rerun was needed.
- `pnpm typecheck`: passed. `pnpm check:architecture`: passed, 332 modules, 1,005 dependencies, 283 private-import files. `pnpm build`: passed API/internal/storefront builds and bundle separation (33 internal files, 208 storefront files, 3 static entry files). Next BUILD_ID `siXTOH-Yp8id3GPdlvotx`.
- Independent reviews: Standards — 0 documented violations and 0 actionable code smells; Spec — 0 findings.

The cart test retains every saved selection during a slow failed availability read, exposes retry without inventing a stock shortage, and then updates price/stock from a genuine successful read using keyboard Enter. Existing quantities persist and cart-addition analytics do not increase on refresh. The media case preserves photo dimensions, cart data and actions through failure, then loads a manager replacement image.

The journey uses real HTTP routes and the fresh disposable database. Its exact persisted increments are 2 visits (home load plus native GET search load), 1 product view, 2 successful cart additions (actual desktop/mobile additions), 1 accepted order submission (pending COD), and 0 completed online sales. Viewport/selection changes and catalog reads add no events; exact accepted order/event replay adds no counts. The pending order leaves available stock unchanged.

## Source and evidence

Initial HEAD `741fdf84ae7dd4e92a806b97674ba7e8835c3c08`. Pinned Node 22.13.1 / pnpm 10.34.5. Initial/final patches, source hashes, exact commands, logs, process identities and listener scans are retained under `.scratch/storefront-sf12-20261002/`; the detailed record is `verification.md`. The final frozen source hashes are:

| File | SHA256 |
| --- | --- |
| Cart component | `A0797FB834A4232EB1BA5181123B0D8B28BABEE919B7C84EDD1EFE5205C33048` |
| Gallery/cart tests | `789BF22A001752DB98E77AF565FF26A3DC48905FD41FC7824102A05C515B2F34` |
| Journey test | `39549D48F9EB783983F44346034F0A30CE8A0D4F99949933CC25D0C133F1F4DB` |
| Experience test | `2D3187CCCD03308C8AA42B7A07D7D804F9724CE6E2D5ADAA043C7A76C827639F` |

Before/after affected-run hashes match. Original `next-env.d.ts` bytes were restored after runtime/build. Protected Grok review SHA `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A` matches the main agent's historical baseline. Prior SF10 checkout/test/review hashes remain unchanged.

Twenty-four stable development captures are retained in `.scratch/storefront-sf12-20261002/development-screens/`, including:

- `cart-read-failed-phone-390.png`, `cart-read-recovered-phone-390.png`
- `cart-image-fallback-phone-390.png`, `cart-image-replaced-phone-390.png`
- Existing home/product/cart/checkout/not-found captures at 320/390/1440px and gallery/cart desktop captures.

The main agent visually inspected the failed-read and fallback captures at 390px: Arabic fallback wraps within the reserved photo box; quantities/actions remain readable. Availability failure feedback is clearly red, retry is visible, and both saved lines/details fit the phone. The existing dark brand presentation is retained. This is bounded acceptance of synthetic development fixtures.

## Limits

The sole runtime coordinator used isolated Playwright API 3011 / PostgreSQL 55433 / internal app 5174 / Next development server 3001. All named ports (3000/3001/3011/3012/5174/55433/55434/54329) were absent initially and after teardown/build; no operational database or demo was touched. No installs, staging or commits were performed. This dated report preserves historical tickets and reports.

No production preview was launched or retried. Production visual acceptance and SF-11 production performance/device gates remain outstanding; development screenshots and build success do not satisfy them. This was a focused 12-case suite, not the full historical browser/HTTP suite.
