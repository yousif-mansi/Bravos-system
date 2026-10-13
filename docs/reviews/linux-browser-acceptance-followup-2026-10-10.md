# Linux browser acceptance follow-up, 2026-10-10

Accepted predecessor HEAD `c501c32fc7aadd88f7a28cdd3295e4dc069f7789`. This Windows record is not a hosted Linux pass. Application, API, schema, config, dependencies, and `tests/browser/storefront-keyboard.spec.ts` were not edited. No commit, push, merge, issue closure, or deployment.

## Retained hosted result

Hosted Ubuntu run [38043587267](https://github.com/yousif-mansi/Bravos-system/actions/runs/38043587267) at `c1dec08` remains the Linux evidence: static, build, audit, and HTTP passed; Chromium **158 passed / 4 failed of 162**. Log: `.scratch/grok-production-20261010/linux-browser-c1dec08.log`. The four failures were the older-acknowledgement color reset, the opening-stock browser fixture, the blocked-tab recovered-id assertion, and streamed category readiness. Predecessor A2 failures had already passed in that run. This batch does not replace that log.

C had already fixed the keyboard streamed-sort and the more-than-40 category readiness case before this batch. `storefront-keyboard.spec.ts` was read and run only.

## Repairs

No product defect was demonstrated. The three owned specs were the only test edits.

1. `tests/browser/offline-sync.spec.ts`. Repeated online lookups of a product already on screen waited for `GET /api/internal/catalog/lookup` for that code, then for the search button to return to enabled `بحث`, before size and color were selected. The calls are the second sale in the outstanding-ack test, the second and third sales in the older-acknowledgement test, and the second lookup in account recovery. The offline fallback at the pinned-cart test still does not wait for a lookup response. Sale and operation identities, phones, tenders, and the 17500 totals were not changed.
2. `tests/browser/reporting.spec.ts`. Category, size, and color names in the opening fixture are suffixed (`قمصان`, `كبير`, `أسود` plus the existing key suffix). Configuration stays the threshold-only row. A 201 preview is accepted only after `status=ready` and `errors=[]`; a failure prints `file:line:column:code:messageAr`. The same Cairo `period=today` report is captured before this import. Aggregates must be that baseline plus 92000 opening piasters and that baseline plus 7500 purchase piasters. The new Abshway receipt is 20000, the new Fayoum receipt is 72000, and the new purchase is 7500, matched by receipt id across report pages. Filter invariance, the correction reason, the section copy, and purchase/opening separation stay. Earlier rows are not deleted.
3. `tests/browser/sales.spec.ts`. Both tabs gate `POST /api/internal/sales` before tab A completes. A's gate stays until A is closed. B aborts every completion upload until the durable sale, its one-unit effect `{operationId}:{variantId}`, the untouched quantity-two cart, and an empty server list for that id are asserted. B then allows one controlled recovery. The assertion still requires `recoveredIds` to equal that original id once, with one acknowledgement of its operation id. B's later sale keeps a different id and operation id, quantity 2, and the final quantities are `[1, 2]`. Stock ends at 2 from 5. Local sale facts stay.

## Commands and exits

Pinned Node `v22.23.3` and pnpm `10.34.5` through `.local/tools/node-v22.23.3-win-x64/node.exe` and `.local/tools/node_modules/pnpm/bin/pnpm.cjs`. Isolated stack only: API 3011, staff 5174, Next development 3001, PostgreSQL 55433. Ordinary PostgreSQL 54329 stayed in listen (pid 25840). Ordinary API 3010, staff 5173, and storefront 3000 were not started. Logs: `.scratch/grok-production-20261010/linux-four/`.

| Log | Command | Result | Exit |
| --- | --- | --- | --- |
| `01-focused.log` | `pnpm exec playwright test tests/browser/offline-sync.spec.ts tests/browser/reporting.spec.ts tests/browser/sales.spec.ts --grep "an older acknowledgement\|manager sees accepted opening stock\|blocked tab recovers" --workers=1 --reporter=line` | 3 passed (32.5s) | 0 |
| `02-five-files.log` | `pnpm exec playwright test tests/browser/catalog.spec.ts tests/browser/opening-import.spec.ts tests/browser/offline-sync.spec.ts tests/browser/reporting.spec.ts tests/browser/sales.spec.ts --workers=1 --reporter=line` | 28 tests. Playwright order was catalog, offline-sync, opening-import, reporting, sales. **1 failed, 27 passed (2.0m).** The three repaired cases passed in this run: older acknowledgement `[7/28]`, opening stock `[17/28]` after catalog's `أسود` and opening-import acceptance, blocked tab `[27/28]`. | 1 |
| `03-keyboard.log` | `pnpm exec playwright test tests/browser/storefront-keyboard.spec.ts --workers=1 --reporter=line` | 5 passed (1.3m). File not edited. | 0 |
| `04-typecheck.log` | `pnpm typecheck` | Scope 23 of 24 workspace projects, each reported Done | 0 |
| `05-architecture.log` | `pnpm check:architecture` | 444 modules, 1063 dependencies, private-import check 385 files | 0 |
| `06-diff-check.log` | `git diff --check` | No whitespace errors before this report existed. Git printed CRLF conversion warnings for `offline-sync.spec.ts` and `sales.spec.ts` | 0 |
| `07-diff-check-after-report.log` | `git diff --check` | Same result after this report was added | 0 |

There is no green rerun of the five-file command. `02-five-files.log` is the retained red log.

## Unowned catalog failure

`tests/browser/catalog.spec.ts:67` failed at line 204. `GET /api/public/catalog/products/{id}` for `JK-E2E` returned 404; the test expected 200. The failure snapshot still listed `JK-E2E` as `حالة الموقع: مخفي`. `TS-E2E` from the previous catalog test was `متاح`. The spec clicks `حفظ التعديل` and reads the public product without waiting for that save response. This file was not edited, and the five-file command was not run again. It is not an A3 source change and was not treated as a demonstrated application defect.

## Cleanup

Next rewrote `apps/storefront/tsconfig.json` and `apps/storefront/next-env.d.ts` during the browser runs. Both were restored to their pre-run bytes: SHA256 `C347427786B19C87BBF31109DD92C04AF9B2B9F19C9DB1026BE6F5C8802D0A5E` and `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`. `docs/reviews/bravos-v1-grok-review.md` still has SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Isolated ports 3011, 5174, 3001, and 55433 were free after the runs. No owned e2e or Playwright process remained.

Windows green on the focused three cases, the keyboard file, and the 27 other tests in the five-file run is not Linux proof. Main reviews and the hosted suite remain the Linux acceptance.

## Catalog publication save

Predecessor stayed `c501c32fc7aadd88f7a28cdd3295e4dc069f7789`. The only new test edit is `tests/browser/catalog.spec.ts`, case "manager renames taxonomy", at the final publication save. `02-five-files.log` was not rewritten.

The product save route is `PATCH /api/internal/catalog/products/:productId`. There is no PUT. The test registered that response for the existing `product.id` before clicking `حفظ التعديل`. The response was 200 and `publication` was `available`, then the status `تم تحديث المنتج.` was visible, and only then the same public GET ran. It returned 200 with one variant whose size is `XL`. A successful save did not return 404, so no application defect was opened and no app code was changed. Image references, taxonomy, inventory, and the public assertions are the same.

| Log | Command | Result | Exit |
| --- | --- | --- | --- |
| `08-catalog-case.log` | `pnpm exec playwright test tests/browser/catalog.spec.ts --grep "manager renames taxonomy" --workers=1 --reporter=line` | 1 passed (27.5s) | 0 |
| `09-six-files.log` | `pnpm exec playwright test tests/browser/catalog.spec.ts tests/browser/offline-sync.spec.ts tests/browser/opening-import.spec.ts tests/browser/reporting.spec.ts tests/browser/sales.spec.ts tests/browser/storefront-keyboard.spec.ts --workers=1 --reporter=line` | 33 passed (2.9m) | 0 |
| `10-typecheck.log` | `pnpm typecheck` | Scope 23 of 24 workspace projects, each reported Done | 0 |
| `11-architecture.log` | `pnpm check:architecture` | 444 modules, 1063 dependencies, private-import check 385 files | 0 |
| `12-diff-check.log` | `git diff --check` | No whitespace errors. Git printed CRLF warnings for `catalog.spec.ts`, `offline-sync.spec.ts`, and `sales.spec.ts` | 0 |

The six-file command was run once. Next type-path files were restored again to the same pre-run SHA256 values. Protected review SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Ordinary PostgreSQL 54329 stayed in listen (pid 25840). Isolated ports were free and no owned e2e process remained. This Windows result is not hosted Linux proof.

## Main review correction and independent gate

Main found that B's blocked upload asserted against A's first captured request, which assumes A sends first. Main made a small test-only correction after Grok handed off: record every blocked B attempt, abort it, and compare all recorded identities and quantities to the durable original A before releasing recovery. Both tabs remain gated, the server must still have no original sale before release, and the original sale/payment/operation, single acknowledgement, B's cart and final stock assertions remain. This does not change application synchronization.

Grok's 33-test pass above precedes this main review correction; independent verification of the final test source is recorded separately under `.scratch/grok-production-20261010/linux-four-main-verification/`.

Main's independent serial run completed with exit 0 after the correction: the same six complete browser files passed **33 tests in 2.9 minutes**, then `pnpm typecheck`, `pnpm check:architecture` (444 modules/1063 dependencies/385 private-import files), and `git diff --check` each passed. Starting and ending source identity matched; the protected SHA256 remained exact, generated Next type paths were restored, isolated listeners/owned processes were absent, and ordinary PostgreSQL remained running. `results.json` records commands, numeric exits, timestamps, source hashes and cleanup. Review documentation was updated only after these frozen-source checks ended. A fresh matching hosted Linux run remains required; this is no production or launch approval.
