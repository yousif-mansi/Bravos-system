# System update sole-executor report — 2026-11-01

Status: **Approved system-update implementation and focused engineering closure COMPLETE.** A–E is in source. The four remaining Playwright cases passed. After the operational-variant POS source change, typecheck, architecture, API + internal builds, and the four affected HTTP files (sales-sync, offline-promotions, operational-stock, shared-pool) passed. This is not whole-project launch approval and not a whole-repository test fleet.

Owner question “is it finished?”: **Focused engineering closure yes.** A–E yes. Four browser cases yes. Affected static/build/snapshot HTTP yes. Unrelated historical tests (bundles/reporting/coupons/visual/full Playwright) were not rerun and are not claimed; they are also not open blockers for this update.

This file is the checkpoint Main reviews. It separates source that is present, checks that passed, and checks that have not run. A missing check is not a pass.

## Safety confirmation at this checkpoint

- HEAD remains detached `e8a65116ec2edb2692261b100a12b6af2aedd7d9`. No checkout of another branch, reset, clean, stash, commit, push, PR, or merge. The only `git checkout` was restoring generated storefront blobs after `.next-e2e`.
- Git index is empty. `git diff --cached --name-only` returned no names. `git diff --check` exit 0.
- `git diff --shortstat` against HEAD at this checkpoint: **109 files changed, 6906 insertions, 1352 deletions.** `git status --short` showed **151 lines** (same 109 tracked dirty paths and 42 untracked entries).
- Protected review file `docs/reviews/bravos-v1-grok-review.md` was not read. SHA256 via `Get-FileHash` is `61A15B6AE01DC82128AC12DCA00AB8AE3FC380758F7B927E740D3CD0D2256F46`, matching the expected hash.
- Ordinary preview was not stopped, started, or reused. At this continuation’s first command those ordinary ports already had no LISTEN: 54330, 17831, 5177, 3012, 3002. Isolated Playwright used 3011 / 5174 / 3001 and `startPostgresCluster` from the e2e harness. No ordinary database, live migration, print, or OS change.
- Pre-existing receipt-numbering and print-connector edits remain. Migration `036` was not edited.
- `next dev` with `.next-e2e` rewrote storefront config. Restored with `git checkout HEAD -- apps/storefront/tsconfig.json apps/storefront/next-env.d.ts`. Current hashes match HEAD blobs `5772bc6d45302ba3485cd782e80444e0bb054f9e` and `a419cbe4e3a5e8d4b481b851dbf4ac767de069e6`. Index stayed empty.
- Memory guard stayed in force: physical ≥ 3145728 KiB and virtual ≥ 4194304 KiB. User applications were not closed. The guard was not lowered. First command of the four-case continuation: FreePhysicalMemoryKiB=8883236, FreeVirtualMemoryKiB=13917024, GUARD=PASS. After this affected-gate continuation’s HTTP run: 10498192 / 14352368.
- Pinned Node `C:\Users\Yousif Mansi\Desktop\bravos system\.local\tools\node-v22.23.3-win-x64\node.exe` v22.23.3 and pnpm `...\node_modules\pnpm\bin\pnpm.cjs` 10.34.5, with that node directory and `node_modules\.bin` first on PATH, from the first command.
- Receipt contact/paper env was not rewritten. `.env.example` still has `VITE_POS_RECEIPT_PHONE=01017412287` and `VITE_POS_RECEIPT_PAPER_WIDTH=80`. Process env for those keys was empty; `apps/internal/.env.local` is absent in this worktree. Internal Vite build used the existing defaults (paper 80). Storefront was not rebuilt.

## Implemented in source

Behavior A–E is present in the worktree. This section is source presence. Verification is the next section.

- Inventory intake and POS sell by product code and product quantity. Website size/color stay on the Products page. Receipt and batch labels omit a blank operational size/color. `ReceivingPage.tsx` uses `optionText`, `receiptLineLabel`, and `merchandiseLabel`.
- Storefront selection is unchanged: heading “Choose size and color”, color then size. Each option shows the shared retail pool. The product page, bag, and cart use the cumulative cap in `apps/storefront/app/cart/shared-pool.ts`.
- New receiving enters the central warehouse. Manager transfer is idempotent for the same operation id, keeps FIFO batch cost, and does not create or drop quantity. Existing branch balances are not inferred into the warehouse.
- Suppliers store a name. Purchases appear in supplier history and Expenses «مشتريات الموردين» without an ordinary expense row. Operating profit does not deduct acquisition cost again.
- One minimum selling price is enforced per unit after offers, coupons, and the employee discount. A missing floor is skipped. Zero remains a real floor. The requested discount is not rewritten.
- A normalizable phone links a new physical sale to one customer. Anonymous POS and guest checkout stay unlinked. History is manager-only and lists paid products. It has no refund or net-spend columns. Cashiers can look up a name and phone and cannot read history.

## Verified

Pinned Node is `C:\Users\Yousif Mansi\Desktop\bravos system\.local\tools\node-v22.23.3-win-x64\node.exe`. Pinned pnpm is `C:\Users\Yousif Mansi\Desktop\bravos system\.local\tools\node_modules\pnpm\bin\pnpm.cjs`, with that node directory and `node_modules\.bin` first on `PATH`. `NO_COLOR` warnings from `FORCE_COLOR` are ignored.

### Earlier focused HTTP evidence, still valid

1. `pnpm exec vitest run --config vitest.config.ts tests/http/operational-stock.test.ts tests/http/shared-pool.test.ts`
   - **2 files, 5 tests passed.** Duration 17.64s. Started 00:44:15 local. Memory FreePhysicalMemoryKiB=5955532, FreeVirtualMemoryKiB=5123356.
   - Covered warehouse exclusion, transfer conservation and same-operation replay, FIFO cost, cumulative quote 3+2 rejected and 2+2 accepted, purchases absent from operating expenses, floor rejection creating no customer, at-floor Eastern-digit phone linking one customer, cashier lookup allowed and history forbidden, manager year history as a product list with no refund or net-spend fields, a pending online order absent until delivered, guest checkout creating no customer, supplier purchase not being an expense, cashier purchase/supplier routes forbidden, website-only price and minimum update, and rejection of a new independent size/color price.
2. Focused suite of migrations, backup, restore, sales-sync, offline-promotions, staff-access, sales, catalog, checkout, order-protection, order-confirmation, order-fulfillment, receiving, and expenses.
   - First run after the sale-500 fix: **5 files failed, 9 passed; 30 failed, 132 passed (162).** Exit 1. Duration 802.59s. Log: `terminal/call-17ce3d5e-3c52-4bdb-8cde-d4d63559ae80-53.log`. Passed: migrations, restore, offline-promotions, staff-access, checkout, order-protection, order-confirmation, order-fulfillment, expenses.
   - Rerun of the five failed files after the pool deadlock fix and the superseded assertions: **2 files failed, 3 passed; 2 failed, 80 passed (82).** Exit 1. Duration 365.09s. Started 01:12:59 local. Log: `terminal/call-ce8ac352-61cd-4de5-9099-cdb7d535ecf6-98.log`. Passed files: sales-sync, receiving, backup.
   - Follow-up of the two remaining assertion-shape tests: **2 files passed; 2 passed, 47 skipped (49).** Exit 0. Duration 30.42s. Started 01:20:01 local. Memory FreePhysicalMemoryKiB=5823948, FreeVirtualMemoryKiB=4672340.
   - Command: `pnpm exec vitest run --config vitest.config.ts tests/http/sales.test.ts tests/http/catalog.test.ts -t "unresolved shortage stays unavailable|public catalog exposes safe live"`.

The sale timeout cause was `allocateSaleLines` reading prices through the pool inside a transaction while `databasePoolMax` was 2. `operationalProductIds` now runs on the transaction client. `prepare()` rejects insufficient stock before pricing. `receiveBatches` maps the missing-variant trigger to the existing validation error. Public `quantitiesByBranchFor` includes the warehouse at 0. Low stock uses the operational variant. Those assertion updates were not weakenings of the operational-stock 201/400 expectations.

### This segment

3. `pnpm typecheck` (`pnpm -r --if-present typecheck`). Exit 0. Scope 25 of 26 workspace projects, all printed Done, including storefront, internal, api, inventory, sales, catalog, receiving, and print-connector. Memory at start FreePhysicalMemoryKiB=6287156, FreeVirtualMemoryKiB=5169728. This run is after the ReceivingPage label helpers. The Playwright spec is outside those package projects; Playwright executed it in step 6.
4. `pnpm check:architecture`. Exit 0. depcruise: no dependency violations (521 modules, 1336 dependencies). Private-import check passed (446 files). Memory at start FreePhysicalMemoryKiB=5833496, FreeVirtualMemoryKiB=4652552. This run is after the visual spec.
5. `pnpm build`. Exit 0. API `apps/api/dist/main.js` 1.3mb. Internal Vite built in 2.29s plus the service worker, with separate `SuppliersPage`, `CustomersPage`, `TransferPage`, `receiving-stock`, and `cashier-lookup` chunks. Storefront Next.js 16.4.1 compiled successfully, TypeScript finished in 1753ms, 4 static pages generated. `scripts/check-bundles.mjs`: `bundle separation ok: internal files=43, storefront files=111, static entry files=3`. Memory at start FreePhysicalMemoryKiB=5617728, FreeVirtualMemoryKiB=4426332. This build includes the ReceivingPage label helpers.
6. `pnpm exec playwright test tests/browser/system-update-visual.spec.ts --reporter=line`. Exit 0. **1 passed (30.9s).** Memory at start FreePhysicalMemoryKiB=6202420, FreeVirtualMemoryKiB=5003960. E2e API log line `2026-11-01T23:34:44.994Z` (02 Nov 2026 01:34 Cairo). Two earlier launches of the same spec failed in the spec selectors and were not product defects: `getByLabel("من")` also matched «المنتج», and «هاتف الزبون» is rendered only after a cart line exists. The spec was corrected and the third launch passed. Product code was not changed for those two failures.
   - The passing spec signed in as `owner` / `e2e-owner-pass`, selected أبشواي, created one product with two website colors and null price overrides, received 3 into the warehouse, and transferred 3 to أبشواي.
   - Receiving intake showed price, minimum, and quantity, and had no operational size/color control.
   - Transfer form showed source, destination, product, and quantity, including المخزن المركزي.
   - Suppliers showed a name field and the no-debt sentence.
   - Expenses showed «مشتريات الموردين» separate from the operating total.
   - Customers showed name, phone, and paid-product copy, and the main region had no «استرداد» or «صافي».
   - POS search by product code showed selling price, minimum 900, and branch quantity 3, with no size/color selector. The cart line showed the code and not the size name. Customer phone appeared after adding the item.
   - Catalog still has size and color forms. Opening the product showed selling price 1000 and minimum 900, plus the shared price/quantity note.
   - Storefront kept “Choose size and color”. Adding 2 of one color then 2 of the other was blocked at the shared pool of 3. Adding the last 1 filled the bag. Both cart increase buttons were disabled. Checkout stayed available. The same selection heading remained at 390×844.

Screenshots, all under `.scratch/system-update-20261101/visual/`:

| File | Bytes |
| --- | ---: |
| receiving.png | 149095 |
| transfer.png | 46609 |
| suppliers.png | 54904 |
| expenses-purchases.png | 84437 |
| customers.png | 46085 |
| pos-lookup.png | 108169 |
| catalog-product.png | 230124 |
| storefront-product.png | 294602 |
| storefront-product-mobile.png | 164869 |
| storefront-cart.png | 123548 |

Receiving, POS, and the storefront product screenshot were opened after the run. They show the warehouse intake, the product-code sale with price and minimum, and the unchanged size/color selection with bag quantity 3 and one shared price of EGP 1,000.

### This continuation — remaining commands

Pinned invocation used Desktop tools on PATH, then `node.exe` + `pnpm.cjs` directly: Node v22.23.3, pnpm 10.34.5. A first `pnpm exec` without those PATH dirs resolved harness Node v24.22.1 / pnpm 11.25.0 and failed the engines check in 5s; that was not a product test. Ordinary preview stayed up.

Guard before HTTP: FreePhysicalMemoryKiB=6032024, FreeVirtualMemoryKiB=5761612.

1. `pnpm exec vitest run --config vitest.config.ts tests/http/bundles.test.ts tests/http/automatic-offers.test.ts tests/http/reporting.test.ts`
   - **3 files passed, 15 tests passed.** Exit 0. Duration 110.98s. Started 14:51:50 local. Ended 14:53:41.
   - Log: `.scratch/system-update-20261101/logs/http-bundles-offers-reporting.log`
   - Money assertions kept: offers 11000 / 5000 / 6000; bundles 60000 / 1202 / 29399; reporting 50000 / 45000 / 17500 / 27500. `operational-stock.test.ts` was not edited.

After HTTP teardown virtual dropped below the guard (3964040 then 3413848). Waited until FreePhysicalMemoryKiB=5119116 and FreeVirtualMemoryKiB=4692992. E2e ports 3011 / 5174 / 3001 were free. Guard at Playwright launch: physical 5239776, virtual 5116564.

2. `pnpm exec playwright test tests/browser/receiving.spec.ts tests/browser/returns.spec.ts tests/browser/storefront-commerce.spec.ts tests/browser/checkout.spec.ts --reporter=line`
   - **2 failed, 17 passed (19).** Exit 1. Wall 14:57:18–15:00:34 (~3.3 min including e2e stack). Reporter printed `(2.8m)`.
   - Log: `.scratch/system-update-20261101/logs/playwright-receiving-returns-commerce-checkout.log`
   - Passed: all 5 checkout tests; receiving tests except the cashier-quantity case (10/11); both returns tests including 320 / 280 / 40 exchange.
   - Failed, then fixture-repaired:
     - `receiving.spec.ts:95` `toHaveCount(1)` on low-stock `PT-E2E` received **2**. Warehouse intake leaves both retail branches at 0. Assertion now expects count 2 and both `الفرع: الفيوم — المتاح: 0` and `الفرع: أبشواي — المتاح: 0`. Cashier branch qty 20 after transfer and no-cost assertions were not weakened.
     - `storefront-commerce.spec.ts:3` initial `M` radio unchecked because shared-pool orderability makes `L` / sand the first public orderable pair. Test now checks color `أسود` before asserting `M`. One price EGP 250, pool of 1, and “Reduce the quantity to 1.” remain.
   - After the run, Next hashes were `b977c78b…` / `13fb5609…`. Restored to HEAD blobs above. Index empty.

3. Offline-POS grep **did not run in that earlier continuation**. It ran in this one after the owner freed memory.

## This continuation — four remaining Playwright cases

Pinned invocation used Desktop tools on PATH, then `node.exe` + `pnpm.cjs` directly: Node v22.23.3, pnpm 10.34.5. Isolated e2e ports were free before each launch. Ordinary preview ports were already idle and were left idle. Guard passed before every heavy command.

1. `pnpm exec playwright test tests/browser/receiving.spec.ts tests/browser/storefront-commerce.spec.ts --grep "manager receives separate cost batches and cashier sees their branch quantity without costs|product commerce keeps one variant and add state across the mobile bar and desktop rail" --reporter=line`
   - First run: **1 failed, 1 passed (2).** Exit 1. Wall 02:15:41–02:17:32. Guard at start FreePhysicalMemoryKiB=9103092, FreeVirtualMemoryKiB=14236708.
   - Log: `.scratch/system-update-20261101/logs/playwright-receiving-storefront-grep.log`
   - Passed: storefront commerce, including one price EGP 250, shared pool of 1, and “Reduce the quantity to 1.”
   - Failed `receiving.spec.ts:95`: `toHaveCount(2)` passed; `toContainText` on the two-row locator hit Playwright strict mode. Both retail rows were present: `الفرع: أبشواي — المتاح: 0` and `الفرع: الفيوم — المتاح: 0`.
   - Fixture repair: assert each branch row with `filter({ hasText }).toHaveCount(1)`. Cashier branch qty 20, 100/140 cost batches, and no-cost cashier assertions were not changed.

2. Rerun of the repaired receiving case only:
   - `pnpm exec playwright test tests/browser/receiving.spec.ts --grep "manager receives separate cost batches and cashier sees their branch quantity without costs" --reporter=line`
   - **1 passed (22.2s).** Exit 0. Wall 02:19:37–02:20:01. Guard 9463408 / 14478360.
   - Log: `.scratch/system-update-20261101/logs/playwright-receiving-rerun.log`

3. `pnpm exec playwright test tests/browser/offline-pos.spec.ts --grep "cashier completes an offline cash sale from an issued snapshot and keeps 275/175|local stock effects reject selling three of two remaining units across repeated rows" --reporter=line`
   - First run: **2 failed (2).** Exit 1. Wall 02:22:11–02:23:06. Guard 9451632 / 14468648.
   - Log: `.scratch/system-update-20261101/logs/playwright-offline-pos-grep.log`
   - Both failed at price accept with `المتغير المحدد غير موجود.` POS cart lines use `operationalVariantId`. Issued snapshot `products.variants` still listed website-option IDs. `priceOfflineCart` could not find the operational id. 450 / 275 / 175 and the shortage message were not reached.
   - Product fix: `priceOfflineCart` indexes `product.operationalVariantId` with the product selling price and minimum. Snapshot issuance and catalog coverage also include that operational id in listed prices. Seed receipts use `operationalVariantId`. Local stock cache/overlay and `cachedQuantitiesFromSnapshot` pin product-level available quantity on the operational id.
   - Fixture for three-of-two: POS now merges repeated adds of the same product into one line. `fill("2")` after two adds is 2 of 2 remaining. The test now `fill("3")` so merged quantity is three. Shortage, no accepted prices, disabled handover, empty local sales/effects remain.

4. Rerun after the pricing fix:
   - Same offline-POS grep. Wall 02:28:30–02:29:10. Guard 9697072 / 14610368.
   - Log: `.scratch/system-update-20261101/logs/playwright-offline-pos-rerun.log`
   - **1 failed, 1 passed (2).** Exit 1. Three-of-two passed. 275/175 accepted 450 then failed complete with `الكمية المتاحة غير كافية.` because the local stock cache was still keyed only by website-option variant ids, so operational remaining was 0.
   - Follow-up source: LookupPage snapshot cache, browse quantities, and Dexie snapshot availability/overlay write the operational id with `product.availableQuantity`.

5. Rerun of 275/175 only:
   - `pnpm exec playwright test tests/browser/offline-pos.spec.ts --grep "cashier completes an offline cash sale from an issued snapshot and keeps 275/175" --reporter=line`
   - **1 passed (20.4s).** Exit 0. Wall 02:31:23–02:31:45. Guard 9597628 / 14481112.
   - Log: `.scratch/system-update-20261101/logs/playwright-offline-pos-275-175-rerun.log`
   - Kept 450 accepted total and sale details 275 / 175, receipt `BRV-\d+-\d+`, unsynced count 1.

Storefront config after `.next-e2e` was restored to the HEAD blobs above. No Playwright/e2e LISTEN remained. No nested agents were started.

## This continuation — affected static, build, and snapshot HTTP

Pinned Node v22.23.3 / pnpm 10.34.5. Guard passed before each heavy command. Isolated Vitest PostgreSQL; ordinary ports stayed without LISTEN. No further application edits.

1. `pnpm typecheck` (`pnpm -r --if-present typecheck`)
   - Exit 0. Scope 25 of 26 workspace projects, all printed Done, including `packages/sales`, `apps/internal`, and `apps/api`.
   - Wall 02:37:49–02:38:31. Guard 9663512 / 14421080.
   - Log: `.scratch/system-update-20261101/logs/typecheck-after-pos-fix.log`

2. `pnpm check:architecture`
   - Exit 0. depcruise: no dependency violations (530 modules, 1339 dependencies). Private-import check passed (455 files).
   - Wall 02:38:37–02:38:49. Guard 9627036 / 14515544.
   - Log: `.scratch/system-update-20261101/logs/architecture-after-pos-fix.log`

3. `pnpm --filter @bravos/api build` then `pnpm --filter @bravos/internal build`
   - Both exit 0. API `apps/api/dist/main.js` 1.3mb in 140ms. Internal Vite built in 2.61s plus the service worker (`cashier-lookup-CImRU-O7.js` 43.63 kB). Storefront Next.js was not rebuilt.
   - Wall 02:38:59–02:39:22. Guard 9666448 / 14574912.
   - Log: `.scratch/system-update-20261101/logs/api-internal-build-after-pos-fix.log`

4. `pnpm exec vitest run --config vitest.config.ts tests/http/sales-sync.test.ts tests/http/offline-promotions.test.ts tests/http/operational-stock.test.ts tests/http/shared-pool.test.ts`
   - **4 files passed, 25 tests passed.** Exit 0. Duration 95.12s. Wall 02:39:39–02:41:18. Guard 10372956 / 14293216.
   - Log: `.scratch/system-update-20261101/logs/http-affected-after-pos-fix.log`
   - Covered accepted-snapshot acknowledgements and once-sync, FIFO 100 then 140, offline promotion/coupon snapshot prices after live rule change, retained overused-coupon sales, storefront shared retail pool with warehouse exclusion, floor rejection, paid history as a product list, and one-item cumulative cart cap. Bundles, reporting, coupons, and supplier-only HTTP were not rerun.

5. Pure Dexie/offline unit discovery: **no existing non-browser test covers the operational-id stock overlay.** `packages/sales` has no `*.test.ts`. `tests/scripts/pos-receipt.test.mjs` uses `offlineFromQuote` for receipt numbering, not quantity cache. The four already-green Playwright cases remain the Dexie coverage. No new tests were written. Those four browser cases were not rerun.

## Files changed relative to the already dirty tree

The 104 tracked modifications and the untracked receipt/print-connector tree were already the executor worktree. This continuation did not revert them. Additions and edits that belong to the system update, on top of that receipt work:

- `packages/inventory/src/application/ports.ts` and `packages/inventory/src/adapters/postgres-inventory.ts` — transaction-local `operationalProductIds`; missing-variant trigger mapped to the validation error; product-pool allocation parameters.
- `packages/sales/src/application/sales.ts` — sale allocation no longer reads prices inside the transaction; prepare checks stock before pricing.
- `packages/sales/src/adapters/postgres-sales.ts`, `packages/returns/src/adapters/postgres-returns.ts`, `packages/online-orders/src/adapters/postgres-online-orders.ts` — advisory-lock text casts.
- `apps/internal/src/pages/ReceivingPage.tsx` — product-level warehouse intake, price and minimum, and labels that omit a blank operational size/color.
- `apps/internal/src/pages/LookupPage.tsx` — product-code sale and operational receipt purpose.
- `apps/internal/src/pages/TransferPage.tsx`, `SuppliersPage.tsx`, `CustomersPage.tsx` — untracked staff screens.
- `apps/storefront/app/cart/shared-pool.ts` and `bag-preview.tsx` — cumulative shared cap.
- `tests/http/operational-stock.test.ts`, `tests/http/shared-pool.test.ts` — untracked A–E and cart-cap coverage.
- `tests/http/catalog.test.ts`, `sales.test.ts`, `sales-sync.test.ts`, `receiving.test.ts`, `backup.test.ts` — superseded override and shared-quantity assertions, updated only after those tests failed.
- `tests/browser/system-update-visual.spec.ts` — untracked focused visual spec added in this segment.
- `apps/api/src/app.ts` — diagnostic log added and removed.
- Earlier fixture-only: `tests/http/automatic-offers.test.ts`, `bundles.test.ts`, `reporting.test.ts`; `tests/browser/returns.spec.ts`, `storefront-commerce.spec.ts`.
- This four-case continuation:
  - `tests/browser/receiving.spec.ts` — two-row low-stock locator uses per-branch `toHaveCount(1)`.
  - `tests/browser/offline-pos.spec.ts` — seed receipts use `operationalVariantId`; three-of-two fills quantity 3 on the merged line.
  - `packages/sales/src/application/offline-pos.ts` — offline cart pricing resolves `operationalVariantId`.
  - `packages/sales/src/application/sales.ts` — snapshot listed prices and catalog coverage include the operational id.
  - `packages/sales/src/adapters/dexie-pos.ts` and `apps/internal/src/pages/LookupPage.tsx` — local stock cache/overlay pins product-level quantity on the operational id.

## Pending

None for this approved system-update focused closure.

Not run, and not claimed as this update’s fleet: full Playwright, the other 17 receiving/returns/storefront/checkout cases from the earlier 19-file run, visual spec, bundles/reporting/automatic-offers browser specs, `tests/http/coupons.test.ts`, `tests/http/reporting-edgecases.test.ts`, offers/bundles/reporting HTTP files, storefront production build, physical printers, staging, commit, push, PR, merge, deploy. Those are outside this closure. They are not open blockers.

## Resume pointer

Stay in this worktree. Approved A–E implementation and focused engineering verification are complete. Work remains uncommitted with an empty index. No further executor action is required for this update unless Main asks for launch, commit, or an unrelated suite.
