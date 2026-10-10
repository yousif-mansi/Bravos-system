# Chromium acceptance repair, 2026-10-10

Branch `codex/readiness-issue-reconciliation`, HEAD `aec5746d0b73b1c92d85cdff62402253e1e00e0e`. Work is uncommitted. This is a local Windows record. It is not a hosted Linux pass, and the storefront is not production-ready.

Hosted run: https://github.com/yousif-mansi/Bravos-system/actions/runs/37976981764/job/113978358626. Node 22.23.3, pnpm 10.34.5, Ubuntu 24.04. Static build and HTTP passed. Chromium ran 160 tests on one worker with no retries: 142 passed, 18 failed, process exit 1. Cleaned log: `.scratch/grok-ci-20261010/browser-job-clean.log`. The 18 failures are in 15 spec files.

Pinned local tools: `C:\Users\Yousif Mansi\Desktop\bravos system\.local\tools\node-v22.23.3-win-x64\node.exe` reported `v22.23.3`. `pnpm.cjs` reported `10.34.5`.

## 1. Root cause and evidence for every hosted failure

No receiving, delivery, restore, stock, price, or permission rule was changed. The server still rejects a receipt without a valid branch, a customer receipt time in the future, and a restore acknowledgement while the preview is not paused or ready.

1. `analytics-exports.spec.ts:3` and `analytics-exports.spec.ts:125`. Both seed a receipt. The hosted log shows `POST /api/internal/receiving/receipts` expected 201 and received 400. The write omitted `branchId`. Receiving validation rejects that with "فرع الاستلام غير صالح." The fixtures now read the active branch and send `branchId`. The 201 check and the later manager-only export checks stay.
2. `automatic-offers.spec.ts:3`. `locator.fill` hit the 120 second test timeout. The test looked for "من تاريخ (القاهرة)" and "إلى تاريخ (القاهرة)". The form labels are "من تاريخ" and "إلى تاريخ". The dates filled into those labels are unchanged.
3. `coupons.spec.ts:6`. Same obsolete Cairo suffix on the date labels, same 120 second fill timeout. The coupon dates and the apply, remove, reapply, and complete checks stay.
4. `corrections.spec.ts:3`. The receipt write returned 400 for the same missing `branchId`. After that fixture included the branch, the history control's accessible name was `مرتجع RET-000001 · طلب POS-000028`. The test had been matching the sale UUID. It now matches `draft.body.reference`. The 80, 100, and payment assertions stay.
5. `offline-sync.spec.ts:271`, "rebase storage failure leaves the sale unacknowledged and not shown as synced". The visible retry is `button.secondary[data-testid=retry-sync]`, and it is rendered only while unsynced work, a sync error, a sync status, or offline state is present. Otherwise the same test id is screen-reader only, and a click does not reach it. The hosted click waited until the 120 second test timeout. The second occurrence now polls for 30 seconds: pending count 0 is acknowledged, and a visible enabled secondary retry is clicked. The earlier retry click in that file was not changed.
6. `online-returns.spec.ts:5`. Deliver returned 400: "وقت استلام العميل يجب أن يكون بعد الشحن ولا يتجاوز الوقت الحالي." `customerReceivedAt` was an unzoned datetime. Linux CI parses that as UTC. A Cairo wall time such as `2026-10-10T05:17:10` is about three hours ahead of UTC `now`, so the server correctly rejects it. The fixture now waits the existing 1100 ms and sends `new Date().toISOString()`. The future-timestamp rule was not changed. This did not fail the same way on Windows Egypt time.
7. `production-login.spec.ts:32`. `getByRole('heading', { name: 'استلام المخزون' })` resolved to two elements because the name was a substring. The assertion now uses `exact: true`.
8. `receiving.spec.ts:91`. The cashier privacy check `getByText(/تكلفة|ربح|شراء/)` matched the category name "تكلفة مؤجلة" from another test in the shared browser database. That is not purchase cost or profit. The original pattern is now limited to `lookup-result`. A separate page-wide check still requires zero matches for "تكلفة شراء", "تكلفة الوحدة", "تكلفة الدفعات", "دفعات التكلفة", "مجمل ربح", and "ربح التشغيل". The failure message includes the matched text.
9. `restore.spec.ts:7`. On Linux the first two pause acknowledgements passed. The third, `acknowledgePausedTill(cashierTill)`, did not show `restore-pause-acknowledged` within 15 seconds. Focus runs before the click and can start sync. The old handler returned immediately while `syncingRef` was set, so the click never posted. The handler now waits out the current sync, reads the snapshot refs, and records the post-sync pending key. Local full suites 1 and 2 failed earlier, on the first manager acknowledgement. Suite 3 captured `409 RESTORE_STALE` with "تغيرت بيانات العمل أو حالة الأجهزة بعد إعداد معاينة الاستعادة. حدّث المعاينة وأعد المحاولة." while the button stayed enabled. The differences panel is shown while the preview can still be `staged`, and acknowledge rejects `staged`. The test now requires `POST /api/internal/restore/previews` to succeed, then the differences panel, then the status text "متوقفة للمراجعة" or "جاهزة للتفعيل", before the tills open. The acknowledgement helper waits for an HTTP OK response. The client retries that same snapshot for up to 12 seconds only when the 409 message is exactly the default stale sentence and `getRestorePause()` still returns the same preview id. Custody and snapshot-mismatch errors are not retried. Server acknowledgement, custody, stock, and recovery rules were not changed.
10. `returns.spec.ts:174`. The exchange quote was 400, and the screen showed merchandise 400, credit 280, and cash 120. The 20 percent offer ended on `2026-09-30`, which was before the 2026-10-09 hosted run and the 2026-10-10 local run. The offer window is now Africa/Cairo today. The expected quote remains 320 EGP, credit 280, cash 40, `finalTotalPiasters` 32000, `exchangeCreditAppliedPiasters` 28000, and `cashReceivedPiasters` 4000.
11. `sales.spec.ts:1319`. The test clicked complete twice and immediately read `GET /api/internal/sales`. The list was empty because the POST had not finished. The test now starts waiting for `POST /api/internal/sales` with status under 400 before the two clicks, then reads the list. The single-sale identity, `physicallyCompleted`, final total 12000, quantity 1, and stock 3 to 2 checks stay.
12. `staff-feedback.spec.ts:4`. The loading copy went stale. The account event could be applied around the held sales response, and the old row remained visible. The test now holds the exact `GET /api/internal/sales`, lets other requests through, dispatches `bravos-account` only after the loading status is visible, and then asserts the old row count is 0.
13. `staff-secondary-feedback.spec.ts:201`. After retry, the order heading was not focused. `reveal()` ran on the next animation frame before the selected heading was committed. `pendingDetailReveal` is set when the detail loads, and an effect calls `reveal()` after `selected` commits.
14. `storefront-evolution.spec.ts:8`. Hosted Linux reported generated `localFont` fallback faces as `document.fonts` status `error`. Those family names end in " Fallback". The intermediate test ignored every family whose name ended in ` Fallback`, required one loaded face outside that set, and required one same-origin `/_next/static/media/` URL among performance resource entries. It did not listen for `requestfailed`, and it did not assert that every font response succeeded. An earlier sentence in this report that said the test required "no failed font network request" was unsupported. Windows did not report those fallback faces as errors. A later local full suite failed this file at `page.screenshot` with `Page.captureScreenshot` after "fonts loaded". That is a separate Chromium capture error. The screenshot assertion was not removed. The main-review rework below replaces the font check.
15. `storefront-keyboard.spec.ts:10` at 320 px, 390 px, and 768 px. Each threw "Keyboard could not reach search within 40 Tab presses." Category links were in the tab order before the search box. Categories accumulated in the shared browser database, so 40 tabs were spent before search. An intermediate tree added untracked `CategoryDiscoverNav`, which put only the active category link in the tab order and moved between categories with arrow keys. That product change was not part of the agreed repair. A 40-tab ceiling does not show that every ordinary category link must leave the tab sequence. The main-review rework removed that component and restored the plain category links.

Local full suites also exposed defects that were not in the hosted 18:

- `catalog.spec.ts` in browser-full-1 could not select "تيشيرتات". A page-load category list resolved after the create and replaced the new category. `ReceivingPage` now ignores taxonomy lists from a refresh that started before a taxonomy write. Products, receipts, and settings from that refresh still apply. This is not a catalog business-rule change.
- `analytics-exports.spec.ts:121` in browser-full-4 expected 401 after logout and received 403. `publishAccount(null)` clears the workspace and the router shows `/login` before `POST /api/auth/sign-out` finishes, so the cashier cookie can still authorize a 403. The test now waits for that POST to return OK, then still requires 401. A 403 is not treated as logged out. Logout order in `session.ts` was not changed, because local invalidation before the server call is what blocks offline use when the server call fails.
- `storefront-integration.spec.ts:153` in browser-full-4 found two checked radios with the same visible variant id after `getByRole("radio")` had count 1. The product page renders `ProductPurchasePanel` once, with one radio per variant. The assertion was not weakened. The same spec passed in the isolated 11-test rerun. It remains unresolved under full-suite load.

browser-full-3 is not evidence for a product defect count. The API logged `Error: Connection terminated unexpectedly` from the `pg` client, then later requests failed with connection refused. That run was stopped. It is not a 160-test result. The `pg` error handler was not changed.

## 2. Files changed and why

Tracked diff after removing the generated Next type-path rewrite, excluding the protected review file: 20 files, 190 insertions, 64 deletions. One new untracked component is listed separately.

| File | Why |
| --- | --- |
| `.gitignore` | Ignore `.next-e2e/`, the Playwright storefront output directory. |
| `playwright.config.ts` | Pass `BRAVOS_NEXT_DIST_DIR=.next-e2e` and the existing API origin `http://127.0.0.1:3011` to the storefront dev server. Port stays 3001. |
| `apps/storefront/next.config.ts` | Use `distDir` only when `BRAVOS_NEXT_DIST_DIR` is set, so the ordinary server on port 3000 can keep `.next`. `reactStrictMode` stays on. |
| `apps/internal/src/pages/WorkspacePage.tsx` | Stop dropping a restore-pause click during sync, and retry only the exact default stale 409 for 12 seconds while the same preview remains the pause. |
| `apps/internal/src/pages/OnlineOrdersPage.tsx` | Focus the order heading after the selected detail commits. |
| `apps/internal/src/pages/ReceivingPage.tsx` | Ignore a stale taxonomy refresh that would hide a category just created. |
| `apps/storefront/app/components/home-introduction.tsx` | Render the new category nav instead of a plain list of links. Pending review, not an accepted product decision. |
| `apps/storefront/app/components/category-discover-nav.tsx` | Untracked. Roving tabindex for category links. Pending main review. Not claimed accepted. |
| `tests/browser/analytics-exports.spec.ts` | Send `branchId`. After logout, wait for a successful sign-out POST, then require 401. |
| `tests/browser/automatic-offers.spec.ts` | Use the current date labels. |
| `tests/browser/coupons.spec.ts` | Use the current date labels. |
| `tests/browser/corrections.spec.ts` | Send `branchId` and match the return reference. |
| `tests/browser/offline-sync.spec.ts` | Click the visible secondary retry in the rebase-storage case only. |
| `tests/browser/online-returns.spec.ts` | Send an absolute customer receipt time. |
| `tests/browser/production-login.spec.ts` | Exact heading name. |
| `tests/browser/receiving.spec.ts` | Keep cost secrecy, and stop matching an unrelated category name. |
| `tests/browser/restore.spec.ts` | Wait for the preview POST and for paused or ready status before acknowledgement. Recovery and price assertions stay. |
| `tests/browser/returns.spec.ts` | Offer window is Cairo today. Amount assertions stay. |
| `tests/browser/sales.spec.ts` | Wait for the sale POST before reading the list. |
| `tests/browser/staff-feedback.spec.ts` | Hold the stale sales response across the account event. |
| `tests/browser/storefront-evolution.spec.ts` | Ignore only generated " Fallback" font faces. Real font load checks stay. |

`apps/storefront/next-env.d.ts` and `apps/storefront/tsconfig.json` were rewritten by Next during Playwright to import `.next-e2e` types. After browser-full-6 stopped, both were written back to the committed `.next` paths. `git diff` shows no content change in either file. The intended isolation remains `next.config.ts`, `playwright.config.ts`, and `.gitignore`.

`docs/reviews/bravos-v1-grok-review.md` is dirty against HEAD and was not edited in this continuation. Its SHA256 is still `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

## 3. Commands, logs, exits, and Linux limits

Playwright used only the isolated stack: API 3011, internal 5174, Next dev 3001, scratch PostgreSQL 55433. One stack at a time. No retry override and no new skip. No `next start`.

Hosted, do not add to local totals:

- `browser-job-clean.log`: 160 tests, 1 worker, 18 failed, 142 passed, exit 1. About 20 minutes.

Local red and green runs, each counted alone:

| Log | Result | Exit |
| --- | --- | --- |
| `repro-focused-1.log` | 18 tests, 8 failed, 10 passed, 7.2m | 1 |
| `repro-focused-2.log` | 18 tests, 2 failed, 16 passed, 4.9m | 1 |
| `repro-focused-3.log` | 2 passed, 1.1m | 0 |
| `browser-full-1.log` | 160 tests, 2 failed, 158 passed, 14.5m | 1 |
| `repro-catalog-restore.log` | 2 passed, 40.4s | 0 |
| `browser-full-2.log` | 160 tests, 1 failed, 159 passed, 12.1m | 1 |
| `repro-restore-3.log` | 1 passed, 39.3s | 0 |
| `repro-restore-4.log` | typecheck exit 0, then 1 passed, 38.6s | 0 |
| `browser-full-3.log` | Invalid. Started 160. API `Connection terminated unexpectedly`, then connection refused. Stopped. No pass/fail total. | none |
| `repro-restore-5.log` | 3 tests, 1 failed, 2 passed, 1.5m. Recovery button count was 0. | 1 |
| `repro-restore-6.log` | 1 failed. Deferred sale was still pending. | 1 |
| `repro-restore-7.log` | 1 failed. Page text contained the recovery button phrase. | 1 |
| `repro-restore-8.log` | 3 passed, 35.7s, after the temporary probe was removed | 0 |
| `browser-full-4.log` | 160 tests, 4 failed, 156 passed, 12.0m | 1 |
| `repro-full4-failures.log` | 11 passed, 1.8m. The four browser-full-4 files, before the later analytics and restore waits. | 0 |
| `repro-analytics-restore-9.log` | 6 passed, 57.6s. Analytics and restore after those waits. | 0 |
| `browser-full-5.log` | Invalid launch. pnpm ran `playwright test "--" "--reporter=line"`. Log says `No tests found`. Not a 160-test result. | 1 |
| `browser-full-6.log` | Unfinished. See below. | none |

browser-full-6 command id is `call-1f7e5cab-a352-45c9-b889-95c258c57d00-75`. Background task id is `01a1240a-93e9-79e3-9275-c57e37bf3d6e`. The command was `pnpm exec playwright test --reporter=line`, with output in `.scratch/grok-ci-20261010/browser-full-6.log`, then `EXIT:$LASTEXITCODE`. The log contains `Running 160 tests using 1 worker`. The last test line is `[51/160] tests\browser\offline-production.spec.ts:35:1`, the production precache test. The log then contains the allowed internal Vite production build and ends at `built in 3.57s`. There is no test failure, no passed/failed summary, and no `EXIT:` line. File mtime is 2026-10-10T07:24:35+03:00, the same moment as relay `finishedAt` `2026-10-10T04:24:39.724Z`. The relay status `completed` and exit 0 are the agent session, not Playwright. When this continuation looked, no Playwright process was running and ports 3011, 5174, 3001, and 55433 were free. Another full suite was not started.

Checks, also separate:

- `checks.log`: typecheck 0, architecture 0, `git diff --check` 2. The only failure was an extra blank line at the end of `online-returns.spec.ts`, later removed.
- `checks-2.log` and `checks-3.log`: typecheck 0, architecture 0, diff check 0. These predate the analytics sign-out wait, the restore preview wait, and the final type-path restore.
- `checks-4.log`, after the type-path restore and on the current source: Node `v22.23.3`, pnpm `10.34.5`, `TYPECHECK_EXIT:0`, `ARCHITECTURE_EXIT:0`, `DIFFCHECK_EXIT:0`. Git printed CRLF warnings only. Those warnings do not fail `git diff --check`.

Linux-only gaps, not re-run on Ubuntu in this repair:

- Unzoned delivery timestamps are in the future on UTC and are accepted as local time on Windows Egypt Standard Time.
- Next `localFont` " Fallback" faces were reported as font errors on Linux and were not reproduced on Windows.
- The hosted restore failure was the third acknowledgement with no response body. Local full suites failed earlier, on the first acknowledgement, with a captured 409 while the preview was still staged. A finished 160-test Windows run after the acknowledgement and preview-response changes does not exist.

## 4. Decisions, unresolved cases, and human gates

- Test output uses `.next-e2e` so Playwright's Next dev server on port 3001 can run beside the ordinary server. This is not a production launcher, an alternate public port, or permission to run `next start`.
- The 12 second acknowledgement retry follows the server's own "refresh and retry" sentence. It does not change who may acknowledge, what snapshot is sent, or what stock and sales the restore keeps.
- The analytics 401 check was not widened to accept 403.
- The 30 second differences timeout was not raised. The test waits for the preview POST that the button already starts, inside the existing 120 second test budget.
- `CategoryDiscoverNav` roving tabindex was an unrequested product choice and was not accepted. The main-review rework removed it. The sentence above records that intermediate state.
- The duplicate purchase radio and the screenshot protocol error passed in isolation and failed once inside browser-full-4. They are not closed.
- browser-full-6 has no numeric test result. Do not read the first 50 started tests as a pass count.
- Hosted CI is not claimed green. A new hosted run is a human release gate.
- No domain, hosting, backup of production data, or launch claim is made.
- No schema, API contract, or business-policy change was required, and none was made.

## 5. Protection and ordinary stack

Protected hash still matches: `docs/reviews/bravos-v1-grok-review.md` SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

Not modified by this repair: `.pnpm-store/`, `Claude outputs/`, `apps/api/.local/`, `arabic font/`, `english font/`, and `packages/report-export/assets/NotoSansArabic-Regular.ttf`.

At the start of this continuation, `.local` contained five files named `e2e-control-*.json`, not 149. None were deleted. There is no `.local/e2e-control` directory. No branch switch, reset, clean, or checkout discard was used.

Ordinary API port 3010 was still pid 7292, and ordinary PostgreSQL port 54329 was still pid 25840. Port 5173 was free and was not started. Port 3000 was free. The ordinary Next dev process that had been on pid 2744 is gone with the previous session and was not restarted. Playwright's isolated ports were free. Ordinary catalog data was not edited.

No git add, commit, push, merge, deploy, or log upload was done.

## What is complete and what remains

Complete: the 18 hosted failures were reproduced or traced to the log and source, the working tree contains the bounded test and UI fixes above, and `checks-4` passed typecheck, architecture, and `git diff --check` on that source. The report exists. The work is uncommitted.

Not complete at the close of the previous continuation: browser-full-6 died at test 51 of 160 with no Playwright exit, so that log is not a local 160-pass result. Hosted Linux had not been re-run. `CategoryDiscoverNav` was waiting for the main review. The duplicate-radio and screenshot flakes were unresolved. The storefront is not production-ready, and this document does not say that it is. The main-review rework below is the later result.

## Main-review rework, 2026-10-10

Main review required two source changes and one report-only note. Brand fonts, body and commerce styles, catalog APIs, routes, and restore recovery logic were left as they were. No git add, commit, push, merge, deploy, or log upload was done.

### Files

| File | Reason |
| --- | --- |
| `tests/browser/storefront-evolution.spec.ts` | Replace the suffix-wide fallback ignore with the font proof below. The first product navigation now requires HTTP 200. |
| `tests/browser/storefront-keyboard.spec.ts` | Remove the fixed 40-tab ceiling. Bound Tab by the rendered tabbable controls and detect a focus cycle. Add a fixture that publishes 41 category products and tabs through those links to search. |
| `apps/storefront/app/components/home-introduction.tsx` | Restored to the baseline plain `Link` map. `git diff` on this file is empty. |
| `apps/storefront/app/components/category-discover-nav.tsx` | Removed. It was untracked. A copy is at `.scratch/grok-ci-20261010/category-discover-nav.tsx`. |
| `apps/storefront/next-env.d.ts`, `apps/storefront/tsconfig.json` | Next dev rewrote these to `.next-e2e` during Playwright. After browser-full-7 they were written back to the committed `.next` paths. `git diff` shows no content change. |

`WorkspacePage.tsx` was not edited in this rework. The existing acknowledgement path still waits for sync, sends the snapshot refs, and retries the same snapshot for up to 12 seconds only when the 409 message is exactly the default stale Arabic sentence and the preview id is unchanged. Preview generation, snapshot custody, and exactly-once acknowledgement stay on the server. The exact Arabic match is fragile, and this rework does not add an error-contract field or widen the retry.

Tracked diff after the type-path restore, excluding the protected review file: 20 files, 388 insertions, 62 deletions.

### Font coverage

Generated dev CSS in `apps/storefront/.next-e2e` names the real faces `commerce`, `editorial`, and `display`. Commerce is thmanyahsans Regular 400, Medium 500, and Bold 700. Editorial is thmanyahserifdisplay Regular 400 and Bold 700. Display is Androgy Demo 400. The only local-only faces are `commerce Fallback`, `editorial Fallback`, and `display Fallback`, each with `src: local(Arial)` and no `url()`. The test does not treat an arbitrary ` Fallback` suffix as ignorable. The browser-full-7 code exempted every parsed face whose src matched `local(` and contained no `url()`, so another local-only family would also have been exempt. It did not enforce the three diagnosed names.

On every route and width the test:

- Calls `document.fonts.load` for commerce 400, 500, and 700, editorial 400 and 700, and display 400, including weights the route does not use.
- Requires each of those six loads to return a face with that family, that weight, and status `loaded`.
- Requires a stylesheet `url()` face for each of the six. Relative `url()` values are resolved against the stylesheet href. Resolving them against the page URL pointed at `/media/...` while the browser requested `/_next/static/media/...`.
- Checks computed roles: home body commerce 400, `#home-title` editorial 400, the first `p[lang="en"]` display 400, and `#catalog-title` editorial 400. Discovery uses body commerce 400 and `#catalog-title` editorial 400. Product, cart, and checkout use body commerce 400 and `main h1` editorial 400. Those cart and checkout headings also carry `page-title`. The module rule won in this run, so the expectation stays editorial 400. No font or commerce CSS was edited.
- Records font responses and `requestfailed`. A font entry with status `failed`, or with an HTTP status outside 200–399, fails the test. Every recorded font URL must be `http://127.0.0.1:3001`. Each required `url()` must appear in that traffic.
- A `document.fonts` status of `error` failed unless the family was in that wider local-only set. The narrow edit below replaces that exemption.
- Keeps the scroll-width and CLS checks, the browser-error list, and the full-page screenshots.

### Category navigation and keyboard

`HomeIntroduction` again maps each category to an ordinary collection link. Public browse builds its category list from published products, so creating 41 empty categories left the home nav at the five categories that already had products (`repro-main-review-1`, received 5, expected greater than 40). The fixture now creates one shared size, one shared color, and 41 categories, each with one published product, through the existing catalog routes. It does not remove links or shrink the fixture to get under a cap.

`tabTo` still presses Tab. The step limit is the number of rendered `a[href]`, `button`, `input`, `select`, `textarea`, `summary`, and `[tabindex]` controls that are not disabled, `aria-disabled`, hidden, inert, or inside a closed `details` element unless they are the `summary`. Repeating a focused element's parent-index path throws before the bound is exhausted. Disabled unavailable radios stay unfocused. Visible outline, viewport, and unobscured checks stay. The new test requires more than 40 links in "اكتشف تصنيفات المتجر", then requires more than 40 real Tab stops whose href contains `category=` before "ابحث عن منتج" is focused.

### Runs

| Log | Result |
| --- | --- |
| `repro-main-review-1.log` | `EXIT:1`. 7 failed. Product documents returned Next 404 "المنتج غير موجود" while those products were later listed on the home catalog. The category count was 5. Font assertions were not reached. |
| `repro-main-review-2-evolution.log` | `EXIT:1`. 1 failed. `GET /products/f1f74ee2-6f8f-43bc-a5d4-cd2c1efcd297` was 200. The font check failed because stylesheet `url()` values were resolved against the page. No API or product-route change was made between this 200 and the earlier 404. |
| `repro-main-review-3.log` | `EXIT:0`. 7 passed in 1.7m. `storefront-evolution.spec.ts`, `storefront-keyboard.spec.ts`, and `storefront-journey-analytics.spec.ts`. |
| `checks-5.log` | Before browser-full-7, while Next type paths still named `.next-e2e`. Node `v22.23.3`, pnpm `10.34.5`. `TYPECHECK_EXIT:0`, `ARCHITECTURE_EXIT:0`, `DIFFCHECK_EXIT:0`. Protected SHA256 still `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. |
| `browser-full-7.log` | One fresh `pnpm exec playwright test --reporter=line`. Started `2026-10-10T06:31:52Z`, finished `2026-10-10T06:44:57Z`. `Running 161 tests using 1 worker`. `161 passed (13.0m)`. `EXIT:0`. The extra test is the category-link fixture. No retries, skips, or exclusions were configured. This count is this run only. |
| `checks-6.log` | After restoring `.next` type paths. Node `v22.23.3`, pnpm `10.34.5`. `TYPECHECK_EXIT:0`, `ARCHITECTURE_EXIT:0`, `DIFFCHECK_EXIT:0`. CRLF warnings only. |

browser-full-6 remains unfinished and is not part of the 161. browser-full-3 remains the invalid API crash and is not part of the 161. browser-full-5 remains `No tests found`.

The product-page 404 in `repro-main-review-1` did not recur in `repro-main-review-2`, `repro-main-review-3`, or browser-full-7. No backend, schema, or contract change was made for it. The screenshot protocol error from browser-full-4 and the duplicate checked radio from browser-full-4 did not fail inside browser-full-7. Both assertions are still present. No restore or API crash occurred in browser-full-7, so the acknowledgement retry was not widened and no new response or `pg` evidence was captured.

### Unchanged protection, index, and ordinary data

Protected `docs/reviews/bravos-v1-grok-review.md` still hashes to `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

Not modified: `.pnpm-store/`, `Claude outputs/`, `apps/api/.local/`, `arabic font/`, `english font/`, and `packages/report-export/assets/NotoSansArabic-Regular.ttf`.

`.local` still has the same five `e2e-control-*.json` files and no `.local/e2e-control` directory. None were deleted. This report does not claim that 149 root control files were preserved.

After browser-full-7, ordinary API port 3010 was still pid 7292 and ordinary PostgreSQL port 54329 was still pid 25840. Ports 3000, 3001, 3011, 5173, 5174, and 55433 were free. Ordinary catalog data was not edited. Staff 5173 and storefront 3000 were not started.

### Limits

This is a local Windows Next dev result. It is not a hosted Ubuntu run, not a physical-device pass, and not a production `next start` pass. Linux can still report `local(Arial)` fallback faces as `document.fonts` status `error`. The browser-full-7 exemption was every local-only rule, and the narrow edit below limits it to the three generated `local(Arial)` faces. That edit was not re-run on Ubuntu. Unzoned delivery timestamps can still be in the future on UTC. The storefront is not production-ready. Hosted CI is not claimed green. No broad next-phase implementation is included. Main still needs to review this diff.

## Fallback-family intersection, 2026-10-10

browser-full-7 remains the historical full result: 161 passed, one worker, 13.0m, exit 0, log `.scratch/grok-ci-20261010/browser-full-7.log`. That run used the wider local-only exemption. This edit came after it. The full suite was not rerun. Hosted CI was not rerun.

The only source change is `tests/browser/storefront-evolution.spec.ts`. Parsed `CSSFontFaceRule` values whose src contains `local(` and no `url()` must use a family in exactly `commerce Fallback`, `editorial Fallback`, or `display Fallback`. Each of those rules must serialize as `local(Arial)` only. Quoted and unquoted `Arial` are accepted. Any other `local()` name, any `url()`, or any other token in that src fails. The permitted error set is the intersection of those parsed rules and those three names. A `document.fonts` status of `error` for any other family fails. The test also requires that intersection to contain all three names. The six real family/weight loads, role checks, font network checks, scroll width, CLS, browser errors, and screenshots are unchanged. No app, runtime, backend, or config file was edited.

Focused run `.scratch/grok-ci-20261010/repro-fallback-intersection.log`: Node `v22.23.3`, pnpm `10.34.5`, started `2026-10-10T06:52:35Z`, finished `2026-10-10T06:53:20Z`. `pnpm exec playwright test tests/browser/storefront-evolution.spec.ts --reporter=line`. `1 passed (44.3s)`. `EXIT:0`.

Next rewrote `apps/storefront/next-env.d.ts` and `apps/storefront/tsconfig.json` to `.next-e2e` during that run. Those generated path lines were written back to the committed `.next` paths. No other change in those files was kept.

Protected `docs/reviews/bravos-v1-grok-review.md` was not edited. This section does not replace the 161-pass record and does not claim a new full or hosted pass.

## Main acceptance review and independent verification, 2026-10-10

Main reviewed the application, configuration, and browser-test diffs against `aec5746d0b73b1c92d85cdff62402253e1e00e0e`. Independent SPEC and Standards reviewers have no remaining actionable findings after the explicit fallback-family/source restriction. The exact Arabic acknowledgement retry condition remains a disclosed maintenance concern. This repair contains no backend, schema, contract, route, permission, stock, or ordering-policy changes.

A separate Sol 6.1 Medium verifier ran the affected tests on the final source, with pinned Node `22.23.3` and pnpm `10.34.5`:

| Verification | Result | Evidence |
| --- | --- | --- |
| Evolution, keyboard, and journey analytics browser specs | 7 passed (1.4m), exit 0 | `.scratch/grok-ci-20261010/main-verification/focused-browser-output.log` and `focused-browser.log` |
| Typecheck | Exit 0 | `.scratch/grok-ci-20261010/main-verification/typecheck.log` and `static-gates.log` |
| Architecture | Exit 0 | `.scratch/grok-ci-20261010/main-verification/architecture.log` and `static-gates.log` |
| `git diff --check` | Exit 0 | `.scratch/grok-ci-20261010/main-verification/static-gates.log` |

Main independently read the numeric exits and browser counts. Before static checks, main restored only the observed Next-generated `.next-e2e` type-path rewrites; both type files again have an empty content diff. Browser-full-7 remains the earlier fresh 161-pass full run before the final test-only restriction; the independent 7-pass run verifies that restriction without claiming another full-suite pass.

The bounded local engineering repair is accepted for commit review. Nothing is staged, committed, pushed, merged, or deployed. The protected review file remains excluded. Publication requires user commit approval; hosted Ubuntu CI must then be rerun on the published repair. Production preview/performance, representative content and final brand review, physical-device/accessibility checks, operational pilot, external recovery rehearsal, and hosting remain separate release gates. This is not production or launch approval.
