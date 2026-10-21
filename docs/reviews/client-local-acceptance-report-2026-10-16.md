# CA04 — Local client session, 2026-10-16

Pending main review. The earlier documentation pass ran out before this final wording; that incomplete pass is not a completed client session. Documentation only. No server, test, browser, database, build, install, or data change. No application source change. No commit, push, or issue action. Client acceptance and operator acceptance are not claimed. `docs/reviews/bravos-v1-grok-review.md` was not edited; its SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

## Files

- `docs/development/client-local-acceptance.md` — client tasks, then a separate engineer appendix.
- `docs/development/local-setup.md` — clean-clone step 6 limited to a new workspace; existing-instance start; ticket-02 limitation replaced.
- `docs/development/operator-handover.md` — pointer to the client session and the still-empty pilot record.
- `docs/development/sample-catalog.md` — verify is the post-intake check, and `setup:local` does not load the sample catalog.
- This report.

Historical reviews were left as they are. Sample intake code and assets were not changed.

## Stale text

`docs/development/local-setup.md` ended with:

> Managers can maintain products, taxonomy and explicit size/color variants. Cashiers can look up a product by code and select a variant. Available quantity is honestly zero until receiving/inventory (ticket 03). POS checkout, FIFO batches, media upload and the public storefront catalog are not implemented.

`apps/internal/src/App.tsx` now routes `/lookup`, `/receiving`, `/catalog`, `/online-orders`, `/returns`, `/expenses`, `/reports`, `/backup`, and `/restore`. Report export is **تنزيل PDF** / **تنزيل Excel** in `ReportExportActions.tsx`. The storefront serves `/`, `/cart`, and `/checkout`. Receiving shows **حسب الفرع** and remaining batch quantity. That ticket-02 paragraph is now marked historical, with the service-worker limit that is still true: registration requires a production build (`offline-ready.ts`), and `pnpm dev` leaves `devOptions.enabled` false.

The same file now says the running evaluation identity is port 54329 and database `bravos_phase1_20260929`. `pnpm setup:local` defaults `BRAVOS_SETUP_DATABASE_NAME` to `bravos` and, when aimed at `.local`, rewrites `.local/dev.env`. The ordinary start remains `pnpm postgres:dev` then `pnpm dev`, without a replacement `DATABASE_URL`.

`operator-handover.md` had no false “unimplemented POS” claim. One paragraph now points staff to the client session and keeps `operator-pilot-acceptance.md` empty.

`sample-catalog.md` already said apply does not refill consumed stock. The added paragraph says verify expects remaining quantity 5 immediately after intake, and a later legitimate movement is outside that gate.

## Why these eight tasks

The client list follows the journeys already named for CA05, on the screens those journeys already use:

| Task | Who | Screen the person actually opens |
| --- | --- | --- |
| Find and receive | Manager | **المنتجات** filters; **استلام المخزون** then **حفظ الاستلام** |
| Cash, recorded manual transfer, split, and a discount | Cashier | **نقطة البيع**: **قبول الأسعار**, the three payment choices, **إتمام البيع** |
| Stock by branch | Manager, then cashier | **حسب الفرع**, then **الفرع النشط** |
| Customer request, one-branch confirmation, report | Customer, then manager | English category row, **Add to bag**, **Review price**, **Place order request**; **الطلبات الأونلاين** and **التقارير** |
| Return received at the other branch | Manager | **المرتجعات**, **فرع معالجة الإرجاع**, then post |
| Expense, report, export | Cashier, then manager | **المصروفات**; **تنزيل PDF** or **تنزيل Excel** |
| Backup and restore | Manager | **نسخة احتياطية**, then **استعادة البيانات** on the isolated target |
| Offline cash, restart, reconnect once | Cashier | Built staff preview only; **مبيعات غير مزامنة** |

The ordinary demo already shows those 32 products on the two existing links. Writing this guide does not complete the client session, and no new isolated client instance is running. A persistent training database was not prepared. Mutable automated rehearsal uses temporary isolated databases and was run by Main. The client sign-off stays blank. The cashier password was not opened or verified in this pass.

## Main-run evidence

Recorded from Main. This pass did not execute the runs. Main review of the whole candidate remains pending for a later final record.

| Evidence | Result |
| --- | --- |
| `.scratch/client-acceptance-20261016/rehearsal-20261016-171027-301/browser.log` | 7 passed, 1 failed. The failure was a loose `المنتج` selector in `sales.spec` matching the filter group. Grok then fixed that selector to an exact one. A separate 4-case browser run is still pending. |
| `.scratch/client-acceptance-20261016/http-remaining-20261016-172207-995/http.log` | 2 selected tests passed. 25 were intentionally not selected. The selected coverage is cancellation and failed-delivery reversal, and the cross-branch return to the original cost batch. |
| `.scratch/client-acceptance-20261016/static-remaining-20261016-172038-481` | Typecheck passed. Architecture passed. 19 diagnostics pure tests passed. 14 sample-intake pure tests passed. |
| Hosted Windows Postgres | Native cause remains unconfirmed. The local native probe passed and is not the same result as the hosted runner. |
| Staff screenshot delta | Receipt routine is first, the draft stays, and the bag unchanged-price message passes. The sticky-heading CSS fix still needs a fresh geometry check. |
| Storefront supplement | 256 supplement shots. Two `naturalWidth` flags stay recorded. Six focused image checks passed and the earlier failure was not reproduced. This is not a clean capture. |
| Ordinary catalog | Main's public GET at 2026-10-16T16:27Z: 32 public products, 32 with media, 32 in stock. |
| Client or operator signature | Blank. |

Protected review file unchanged: `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

## Later status — 18 October 2026

This 16 October report stays as written, including the failed selector result and the items that were still pending that day. Do not read it as the current handover. The running practice copy, the two-part 18 October rehearsal, and local readiness are in [client-acceptance-main-review-2026-10-18.md](client-acceptance-main-review-2026-10-18.md).
