# Linux browser follow-up, 2026-10-10

Branch `codex/readiness-issue-reconciliation`, predecessor HEAD `1e05150b226a93a9aacbe15c7ef3ed985a7a58d7`. Application code was not changed. This Windows record is not a hosted Linux pass.

Hosted run [38033109783](https://github.com/yousif-mansi/Bravos-system/actions/runs/38033109783) checked out merge `8a263cd` of `a3df055`. Static, build, audit, and HTTP passed. Chromium finished 158 passed / 3 failed of 161, exit 1. Log: `.scratch/grok-production-20261010/linux-browser-a3df055.log`.

## Diagnosis

No product defect. The three failures are test timing and locator scope. `listCompletedForStaff` still limits a cashier list to that cashier's sales. `listCompleted` still returns the manager's full list.

1. `offline-pos.spec.ts:73`, line 104. `getByRole('alert')` matched two alerts at once: the autosync float "تعذر مزامنة المبيعات…" and the POS shortage "الكمية المتاحة غير كافية." The shortage locator is now that text alone. The sync alert is still required to be visible. The second completion stays rejected, the cart stays, and one durable 150 EGP sale keeps one quantity-one effect whose id is `{operationId}:{variantId}`.
2. `sales.spec.ts:382`, line 447. The competing `POST /api/internal/sales` returned 400. The hosted log does not include that body. The cashier page removed the upload abort as soon as "تم حفظ البيع." appeared, so the original upload could take the only unit before the competing sale. The abort now stays until a separate owner context receives 201. The assertion prints `JSON.stringify` of that body. Release is an `online` event on the cashier page. The original sale keeps its id, operation id, cashier attribution, and cash tender of 22000 piasters, with unallocated quantity 1. The competing sale is the only stock allocation, quantity 1, and batch remaining is 0. After the cashier signs in again, `GET /api/internal/sales` returns one own sale. The manager list contains the two ids once each.
3. `sales.spec.ts:1319`, line 1380. The local saved notice was checked, then `saleIds` length, before `waitForResponse` at line 1381. The hosted array length was 0. The successful POST response is now awaited before the captured request count. The two synchronous clicks remain. One identity, one 120 EGP sale, quantity 1, and stock 3 to 2 remain.

## Commands and exits

Pinned Node `v22.23.3` and pnpm `10.34.5` through `.local/tools/node-v22.23.3-win-x64` and `.local/tools/node_modules/pnpm/bin/pnpm.cjs`. Isolated stack only: API 3011, staff 5174, Next development 3001, PostgreSQL 55433. Ordinary PostgreSQL 54329 stayed in listen. API 3010 was not listening. Logs: `.scratch/grok-production-20261010/linux-three/`.

| Command | Result | Exit |
| --- | --- | --- |
| `pnpm exec playwright test tests/browser/offline-pos.spec.ts tests/browser/sales.spec.ts --grep "two tabs cannot sell the same remaining cached unit\|lost complete before send\|synchronous double complete" --workers=1` | 3 passed (29.0s) | 0 |
| `pnpm exec playwright test tests/browser/offline-pos.spec.ts tests/browser/sales.spec.ts --workers=1` | 32 passed (1.8m) | 0 |
| `pnpm typecheck` | 23 of 24 workspace projects, all reported Done | 0 |
| `pnpm check:architecture` | 444 modules, 1063 dependencies, private-import check 385 files | 0 |
| `git diff --check` | no whitespace errors; Git printed CRLF conversion warnings for the two spec files | 0 |

The focused Windows run passed. It did not reproduce the three hosted failures. Those remain the red evidence in the Ubuntu log. Next rewrote `.next-e2e` type paths during the browser runs; `apps/storefront/tsconfig.json` and `apps/storefront/next-env.d.ts` were restored to their pre-run bytes. `docs/reviews/bravos-v1-grok-review.md` still has SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Owned Playwright processes had exited; the e2e ports were not left listening.

## Main acceptance

Actual Grok completed with exit 0, session `01a12533-b3cb-7751-a5cb-7e8e5db73356`. Main reviewed the diff against the bounded brief. An independent Sol 6.1 High source review found no actionable defect or weakened assertion; added fields match the actual sale DTOs and IndexedDB effect identity. No application, business-policy or permission change is included.

Independent Sol 6.1 Medium verification then ran both affected files in a fresh serial run: **32 passed (1.8m), exit 0**. Typecheck, architecture, diff check and protected-file verification each exited 0. Architecture checked 444 modules / 1063 dependencies and 385 private-import files. Exact commands and numeric exits are in `.scratch/grok-production-20261010/linux-three/main-verification/results.json`, with individual logs beside it. Generated Next files were restored to their pre-run bytes; no owned processes or isolated listeners remained. These are Windows checks; the subsequent matching hosted run is still required.
