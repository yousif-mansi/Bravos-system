# Internal UX functional refinements — 2026-11-03

Verification of the seven internal UX points is complete for the bounded gates. HEAD remains detached `e8a65116ec2edb2692261b100a12b6af2aedd7d9`. No commit, reset, stash, or deploy. Ordinary preview processes were not restarted.

Toolchain for every gate: `C:\Users\Yousif Mansi\Desktop\bravos system\.local\tools\node-v22.23.3-win-x64\node.exe` and `C:\Users\Yousif Mansi\Desktop\bravos system\.local\tools\node_modules\pnpm\bin\pnpm.cjs`, with that Node directory and `node_modules\.bin` first on `PATH`. Recorded runtime: Node `v22.23.3`, pnpm `10.34.5`.

## Requirement status

| Point | Source | This run |
| --- | --- | --- |
| 1. Remove redundant visible explanation | Present | Verified on the captured POS, receiving, and customers screens. Catalog, offers, coupons, transfer, and suppliers were not opened. |
| 2. Sale click confirms; semantic green / amber / red | Present | Verified: no handover checkbox, one durable sale, confirm green `#146c43` on إضافة المورد, green إتمام البيع in the POS shot. Amber and red on other pages were not opened. |
| 3. Compact internal layouts | Present | Verified on receiving at 1440 and 390, the customers split, and POS. Other long forms were not opened. |
| 4. Customer list, search, paid history on one page | Present | Verified by HTTP and the customers screenshot. |
| 5. Product stock for warehouse, Abshway, and Fayoum, including zero | Present | Verified by HTTP and both receiving screenshots. |
| 6. Inline supplier keeps the receiving draft | Present | Verified by the browser spec. |
| 7. Success and error next to the action | Present | Verified for the receipt validation alert and the POS save notice. Other pages were not opened. |

No point is pending inside the gates that were required. Pages outside `tests/browser/internal-ux-refinements.spec.ts` were not opened.

## What the gates showed

- POS has no handover checkbox. The spec completes with `complete-sale` only. The response status is below 300. `GET /api/internal/sales` then contains one sale for phone `01055556677`. The cart footer shows `تم حفظ البيع.` `pos-complete-1440.png` shows both completion buttons green and قبول الأسعار left neutral. The spec does not click print.
- Customer HTTP: cashier list and product-location reads return 403. Manager locations for the stocked product are warehouse 1, Abshway 4, Fayoum 0. The empty product is 0 at all three. The payload has no cost or refund fields. Two sales create two customers. Partial query `1234` returns only نادر. `limit=1` returns a cursor and the next page. Cashier exact lookup still returns 200.
- The first HTTP run returned 403 on the new sale because that case never selected a retail branch. `complete` rejects a session with no cashier branch. The case now posts `/api/internal/active-branch` for أبشواي before the sales, which is the same setup the passing floor sale already uses. The 201, 403, zero, pagination, and cost assertions stayed.
- Browser: inline supplier selects the new id on both supplier fields, keeps code, name, price 250, minimum 200, quantity 4, cost 80, receipt quantity 2, and receipt cost 40. A second create with the same name shows `المورد موجود بالفعل.` and leaves one supplier row. Clearing the product and saving the receipt shows `يجب تحديد المنتج لكل صنف.` and does not add a receipt.
- Chrome reported the confirm background as `oklab(0.470675 -0.0956164 0.0401529)`, which decodes to `rgb(20, 108, 67)` (`#146c43`). The assertion now compares decoded channels with `rgb(20, 108, 67)` and `rgb(15, 107, 60)`. A different color still fails.
- Customers screenshot: search `555566` shows زبون واجهة, and منتجات مدفوعة lists `BRV-001-000001`, the product name, and quantity 1. استرداد and صافي are absent.
- Receiving stock screenshot is filtered to the zero product and shows `0 · غير متوفر` for المخزن المركزي, أبشواي, and الفيوم. The 390 screenshot keeps the table inside the page. After the sale, that shot shows warehouse 1 and the two retail columns unavailable. `غير متوفر` wraps inside the cells. The spec recorded `pageFits` true.

## Screenshots

Directory: `.scratch/ux-refinements-20261103/visual/`

- `receiving-stock-1440.png`
- `receiving-feedback-1440.png`
- `pos-complete-1440.png`
- `customers-1440.png`
- `receiving-narrow.png`

## Checks

| Check | Memory before | Result |
| --- | --- | --- |
| Typecheck contracts, sales, inventory, api, internal | physKB=9153756 virtKB=9217656 | OK for all five. Log `.scratch/ux-refinements-20261103/logs/typecheck.log` ends `TYPECHECK_DONE`. |
| `pnpm check:architecture` | physKB=9225416 virtKB=9331428 | Exit 0. 530 modules, 1339 dependencies, private-import check passed for 455 files. |
| `vitest` `tests/http/operational-stock.test.ts` | physKB=9042916 virtKB=9105084 | Exit 1. 3 passed, 1 failed. The new sale was 403. |
| Same file after the active-branch setup | physKB=7387884 virtKB=7157536 | Exit 0. 4 passed. Duration 19.05s. Log `logs/http-operational-stock-rerun-out.log`. |
| Playwright `tests/browser/internal-ux-refinements.spec.ts` | physKB=8359008 virtKB=8558536 | Exit 1. Color string was `oklab(...)`. |
| Same spec after channel comparison | physKB=7236904 virtKB=7393160 | Exit 0. 1 passed (26.5s). Log `logs/playwright-ux-rerun-out.log`. |
| `pnpm --filter @bravos/api build` | physKB=7651544 virtKB=7913784 | Exit 0. `apps/api/dist/main.js` 1.3mb. |
| `pnpm --filter @bravos/internal build` with `VITE_POS_RECEIPT_PHONE=01017412287` and `VITE_POS_RECEIPT_PAPER_WIDTH=80` | physKB=7680876 virtKB=7882140 | Exit 0. Vite 2.41s, service worker 446ms, precache 49 entries (1148.20 KiB). `dist/assets/SaleSummary-Cqo2P7iD.js` contains both values. |

No Next production build. No full HTTP suite. No full browser fleet.

## Safety

- `git diff --check` exit 0 after the Next restore.
- `git diff --cached --name-only` is empty.
- `docs/reviews/bravos-v1-grok-review.md` SHA256 is `61A15B6AE01DC82128AC12DCA00AB8AE3FC380758F7B927E740D3CD0D2256F46`. The file was not read.
- `git status --porcelain` is 166 lines. The preexisting receipt, connector, and system-update changes remain.
- Playwright rewrote `apps/storefront/tsconfig.json` and `apps/storefront/next-env.d.ts` to mention `.next-e2e`. Both were copied back from `.scratch/ux-refinements-20261103/next-baseline/` and their SHA256 matches that pre-Playwright snapshot. `next.config.ts` never changed (`BE762440C3F444B39A85B5C51985E2D526E67AB2C507B83BAC15615412D52EDE`).
- Listeners left in place: API 3012 pid 16564, staff 5177 pid 28640, storefront 3002 pid 19764, PostgreSQL 54330 pid 29156, connector 17831 pid 12176. E2E ports 3011, 5174, and 3001 are free. No ordinary database was migrated, seeded, or reset.

## Runtime

The API process on 3012 was not restarted, so it can still be serving the source it loaded at startup. The new `apps/api/dist/main.js` is on disk only. The staff dev server on 5177 was not restarted, and this task did not reload a client PWA. The new `apps/internal/dist` build does not prove that preview clients are updated. This verification did not open 3012, 5177, or 3002.

## Implementation files

These were already in the working tree before this verification pass and were not edited again here. Several were already dirty or untracked from receipt numbering and the system update.

`packages/contracts/src/index.ts`, `packages/sales/src/domain/customer-phone.ts`, `packages/sales/src/application/ports.ts`, `packages/sales/src/application/sales.ts`, `packages/sales/src/adapters/postgres-customers.ts`, `packages/inventory/src/application/ports.ts`, `packages/inventory/src/application/inventory.ts`, `packages/inventory/src/adapters/postgres-inventory.ts`, `apps/api/src/app.ts`, `apps/internal/src/api.ts`, LookupPage, ReceivingPage, CustomersPage, TransferPage, SuppliersPage, ExpensesPage, CatalogPage, OffersPage, CouponManager, ReturnsPage, OnlineOrdersPage, StockCorrectionsPage, `apps/internal/src/styles.css`, `apps/internal/src/styles/tokens.css`, `apps/internal/src/pages/pos/pos-workspace.css`, `tests/http/operational-stock.test.ts`, `tests/browser/internal-ux-refinements.spec.ts`, `tests/browser/system-update-visual.spec.ts`, and the browser specs whose handover checkbox `.check()` lines were removed: automatic-offers, coupons, offline-pos, offline-production, offline-sync, pos-hardware, pos-workspace, print-connector, product-labels, receipt-numbering, restore, sales, session-transition.

## Files touched while verifying

- `tests/http/operational-stock.test.ts` — select أبشواي before the two customer sales.
- `tests/browser/internal-ux-refinements.spec.ts` — compare confirm color by decoded RGB channels.
- This report.

The implementation files listed in the earlier copy of this report were already in the tree and were not edited again during verification.

## Local preview refresh — 2026-11-03

The bounded gates above were not repeated. No source file changed for this refresh. The staff build from 2026-11-03 05:45 already contained receipt phone `01017412287` and paper width `80`. `http://127.0.0.1:5177/` serves `apps/internal/dist/index.html` unchanged, including `assets/index-B8RjUxfM.js`. The staff process on 5177 stayed pid 28640. Storefront 3002, connector 17831, and PostgreSQL 54330 were not restarted.

The API process that started at 02:55 was still pid 16564 and returned 404 for `/api/internal/customers` and `/api/internal/inventory/product-locations`. That process and its worktree esbuild child were stopped. A replacement was started with the same preview database, origins, and media directory, outside the tool process tree, as pid 6972. It listens on `http://127.0.0.1:3012`. Unauthenticated calls to both new routes return 401. Startup did not migrate. The preview copy remains 37 migrations ending at `037_operational_stock.sql`. The original `bravos_client_acceptance_20261016` remains 36 migrations ending at `036_receipt_numbering.sql`.

Read-only checks on the copy, then sign-out: the owner account is a manager and received customers HTTP 200 with one existing row and no cost or refund fields. Product locations returned HTTP 200 for 32 products, codes `abshway`, `fayoum`, and `warehouse`, with numeric quantities including zeros. The demo cashier received 403 for both reads and was signed out. No sale, receiving, or transfer was submitted.

A fresh browser context opened the live staff app, showed the customer list, the three-location stock table, and POS with no handover checkbox and green completion actions, then signed out. Images: `.scratch/ux-refinements-20261103/visual/live-customers-1440.png`, `live-receiving-1440.png`, `live-pos-1440.png`. That fresh context does not prove an already-open staff tab has switched. The service worker uses the same POS schema version 4, so a safe update activates after the open tab loads the new worker. Safe step: leave any unfinished cart as it is, do not clear site data or the service worker, and reload `http://127.0.0.1:5177/` once. If the home page shows `في تحديث مستني المبيعات المتأخرة تتبعت.`, sync the queued sales first, then reload once more.
