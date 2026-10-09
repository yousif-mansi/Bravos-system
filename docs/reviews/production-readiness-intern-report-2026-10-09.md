# Bravos production-readiness intern report — 9 October 2026

This report follows [the execution checklist](../planning/production-readiness-intern-todo-2026-10-09.md) and [the report template](production-readiness-intern-report-template.md). The template file was left unchanged.

Use DONE / FAILED / BLOCKED / NOT_RUN. DONE requires linked evidence and an explicit scope. This report does not assign a completion percentage. Engineering evidence below is separate from owner/content approval, physical-device acceptance, hosted operation, and launch approval.

## Outcome and review state

Report author: Grok continuation session, after the earlier runtime owner `finish_verification_oct09` had left the recorded gate logs.
Runtime owner for those logs: `finish_verification_oct09`.
Coordinating reviewer: main.
Recorded at: 2026-10-09T13:28:00Z, 16:28 Cairo (UTC+3). The last ordinary-database recount is 2026-10-09T13:26:09.020Z. The last git/hash check is 2026-10-09T13:27:54Z.
Bounded engineering outcome: the identified local candidate has recorded installation, audit, static, HTTP, focused browser, reporting, and isolated visual-capture results. Several of those results are red rows followed by separate reruns. They are not one fresh public 37, one fresh internal 28, or one uninterrupted capture.
Production/release outcome: blocked. Representative content, physical devices, true zoom and screen reader, permitted production performance, hosting, an external recovery drill, an internal pilot, and the opening CSV purchases question remain open.
Main review: NOT_RUN.
This report authorizes no staging, commit, push, deployment, domain/hosting purchase, or public-ordering switch.

## Source, runtime and evidence identity

| Item | Actual value / evidence |
| --- | --- |
| Root absolute path and HEAD | `C:\Users\Yousif Mansi\Desktop\bravos system`; `741fdf84ae7dd4e92a806b97674ba7e8835c3c08` (`741fdf8`). Rechecked 16:27 Cairo. |
| Runtime absolute path and source register | `C:\Users\Yousif Mansi\Desktop\bravos system\.scratch\product-ux-review-20261005\runtime`. Security-final register: `runtime/.local/review-source-register-security-final-20261009.json`, 572 paths. Recheck at 13:26:09Z: `runtime/.local/review-source-register-after-locator-repairs-20261009.json`. Pair mismatches 0. Differences from the security-final hashes: 2 (`tests/browser/catalog-media.spec.ts`, `tests/browser/reporting.spec.ts`). |
| Dirty candidate boundary | 51 tracked diffs versus HEAD. Index empty. Classification of the earlier 45 paths: [candidate inventory](candidate-file-inventory-2026-10-09.md). Five tracked paths were outside that 45-file table and are listed in the changed-file section. Untracked `git ls-files --others` also sees `.pnpm-store/`, raw font directories, `Claude outputs/`, `apps/api/.local/`, and scratch evidence. Those stay excluded. |
| Served/browser source | Focused browser runs used the isolated runtime dev servers: API `127.0.0.1:3011`, staff `127.0.0.1:5174`, storefront `127.0.0.1:3001`, database `bravos_e2e`. Platform note `runtime/.local/review-browser-platform-final-20261009.json` at 2026-10-09T12:13:49.970Z: headless Chromium development acceptance, viewport emulation. Ordinary preview after the captures uses API `127.0.0.1:3010`, staff on IPv6 localhost port 5173, storefront port 3000. No production server was started. |
| Node executable/version/checksum | `C:\Users\Yousif Mansi\Desktop\bravos system\.local\tools\node-v22.23.3-win-x64\node.exe`; `v22.23.3`; SHA-256 `9C9245166B4A8E182E0B797DA9C20136117FF24368EAFF1FEC8343A123C8DB0E`. This session rehashed the executable. The same digest is in `runtime/.local/review-final-frozen-boundary-20261009.json`. The zip digest written in `docs/development/local-setup.md` was not re-downloaded or rehashed in this pass. |
| pnpm entry/version | `C:\Users\Yousif Mansi\Desktop\bravos system\.local\tools\node_modules\pnpm\bin\pnpm.cjs`; `10.34.5` from the cached install logs. Root `package.json` `packageManager` is `pnpm@10.34.5`. Engines: node `>=22.23.3 <23`, pnpm `>=10.34.5 <11`. |
| Root package.json SHA-256 | `98F65E0D183BF63235BDD1208436194367BCEE27D44D441EA167DC95E2765887` (root and runtime match). |
| Lock SHA-256 | `76AF25D6D72588F1DE04E894CE859FD5C69C0D3349AF46C41B64F42FD9000526` (root and runtime match). |
| Storefront/API/catalog manifests | `apps/storefront/package.json` `DF89A39A6F05DC2E1B299831E4A6468DAB1BDD4C1356AC05EF3D22A17BEE0138`; `apps/api/package.json` `47408B6EDBD334DCC6E47EAC50EE2E57D1378D995FDF40382041E6A7A6910E43`; `packages/catalog/package.json` `2F54E730E0CC7390F9B92F06B107B2F5DDA9715A0DA2BA03EF97AC74306822B0`. Each root hash matches its runtime copy. |
| Postinstall source freeze | Runtime preflight `runtime/.local/review-install-source-preflight-20261009.json`: sourceCount 572, changedSinceFreeze 0, locks equal, staged 0, protected hash match. That file predates the two locator edits. The 13:26:09Z recheck is the current comparison. |
| Playwright browser/OS | Chromium `140.0.7339.186`; Windows 11 Pro `10.0.26200`; `win32`. Recorded for the development acceptance runs. Hardware was not recorded because SF-11 was not measured. |
| Evidence directories | Gate logs and JSON: `runtime/.local/review-*-20261009.*`. Isolated screenshots and proof: `.scratch/product-ux-review-20261005/after/isolated-captures-20261009/`. Ordinary counts: `.scratch/product-ux-review-20261005/after/live-data-proof-before-20261009.json`, `live-data-proof-after-20261009.json`, and `live-data-proof-after-ordinary-urls-20261009.json`. These paths are scratch evidence and are excluded from the commit boundary. |
| Process/data ownership | Isolated ports 3001, 3011, 5174, 55433, and 55434 were not listening at the 13:26Z check. Ordinary PostgreSQL pid 25840 listens on `127.0.0.1:54329` and `::1:54329`. Ordinary dev, started 2026-10-09T13:17:36.3309561Z, was still the running task: API pid 7292 on `127.0.0.1:3010`, storefront pid 27724 on `:::3000`, staff pid 28592 on `::1:5173`. This pass did not stop them and did not reset `.local/postgres`. |

## Installation and preflight (must precede downstream tests)

| Workspace / check | Timestamp UTC | Exact command / working directory | Exit | Status | Evidence |
| --- | --- | --- | --- | --- | --- |
| Root install abort | 2026-10-09T11:14:23.195Z to 11:14:24.517Z | Root frozen install attempt. Log bytes 253. | Nonzero text `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` | FAILED | `runtime/.local/review-install-root-final-20261009.log`. Removal of `node_modules` was aborted. The store was not purged. |
| Root existing-store install | 2026-10-09T11:15:06.515Z to 11:15:07.833Z | Root `pnpm install --frozen-lockfile` against the existing AppData store. | 0, log text `Done in 1.2s using pnpm v10.34.5` | DONE | `runtime/.local/review-install-root-existing-store-final-20261009.log` |
| Isolated short install | 2026-10-09T11:14:40.716Z to 11:14:42.597Z | Isolated runtime install. | 0, log text `Done in 1.5s using pnpm v10.34.5` | DONE | `runtime/.local/review-install-isolated-final-20261009.log` |
| Root cached install | 2026-10-09T11:51:13.264Z to 11:51:23.389Z | Later root cached frozen install, before the clean HTTP run. | 0, `Done in 10s using pnpm v10.34.5` | DONE | `runtime/.local/review-install-root-cached-final-20261009.log` |
| Isolated cached install | 2026-10-09T11:51:13.599Z to 11:51:27.934Z | Later isolated cached frozen install. | 0, `Done in 14.2s using pnpm v10.34.5` | DONE | `runtime/.local/review-install-isolated-cached-final-20261009.log` |
| Module resolution/API import | 2026-10-09T11:53:24.454Z | Runtime workspace preflight. Resolved Next, `@next/env`, SWC, Fastify, Sharp, inventory import, and API import. | `apiImport: true`, `inventoryPublicImport: true` | DONE | `runtime/.local/review-install-runtime-preflight-20261009.json` |
| Installed-version/source preflight | Same 11:53:24.454Z runtime file; source file has no separate clock | Source count 572, changedSinceFreeze 0, both locks `76AF25D6…`, staged 0. | Recorded fields match | DONE for that instant | `runtime/.local/review-install-source-preflight-20261009.json` |

Root `node_modules/.modules.yaml` `storeDir` remains `C:\Users\Yousif Mansi\AppData\Local\pnpm\store\v10`. The isolated runtime `storeDir` remains `C:\Users\Yousif Mansi\Desktop\bravos system\.pnpm-store\v10`. This pass did not reassign or purge either store. Manifest and lock hashes above still match the reviewed freeze, so these installs did not rewrite the lock.

The incomplete HTTP run at 11:44:57Z happened after the 11:41Z zero-advisory JSON files and before the 11:51Z cached installs. Its missing `better-auth` import is an installation/harness failure. The 11:53:24Z runtime preflight, including a successful API import, sits before the clean HTTP log that starts at 11:53:49Z.

The clean HTTP process then overlapped architecture, typecheck, scratch migration, and build. That overlap is recorded on each of those rows. It does not erase the incomplete HTTP row.

## Command results on the identified candidate

Working directory for the test and build logs is the isolated runtime unless a row says otherwise. Node for the wrapped browser reruns that record `NODE v22.23.3` is the portable executable above. Counts are the counts printed by that attempt. A later green row does not replace the earlier red row.

| Gate / attempt | Timestamp / duration | Exact command / cwd / source | Exit | Collected / pass / fail / skip | Status | Log / JSON / trace |
| --- | --- | --- | --- | --- | --- | --- |
| Full audit, pre-refresh snapshot | Written 2026-10-09T11:15:43.774Z | `pnpm audit --json`. Workspace is the file's recorded run; muted is empty. | JSON written | info 0, low 1, moderate 4, high 1, critical 0; 776 dependencies | FAILED as an advisory snapshot | `runtime/.local/review-audit-full-final-20261009.json` |
| Full audit, security-final | Written 2026-10-09T11:41:08.819Z | `pnpm audit --json` after the Next 16.3.8 refresh. | JSON has empty advisories | info 0, low 0, moderate 0, high 0, critical 0; 776 dependencies; muted `[]` | DONE for that installed tree at 11:41Z | `runtime/.local/review-audit-full-security-final-20261009.json` |
| Production audit, security-final | Written 2026-10-09T11:41:10.594Z | `pnpm audit --prod --json` | JSON has empty advisories | Same severities all 0; 458 dependencies; muted `[]` | DONE for production dependencies at 11:41Z | `runtime/.local/review-audit-prod-security-final-20261009.json` |
| Production audit text gate | Log exists; clock not re-read this pass | `pnpm audit --prod` text | Log text `No known vulnerabilities found` | N/A | DONE as supporting text | `runtime/.local/review-audit-prod-gate-final-20261009.log` |
| Typecheck | Created 11:53:50.015Z, written 11:54:23.003Z. Overlaps clean HTTP. | `pnpm typecheck` in the runtime. Scope line: 23 of 24 workspace projects. | No `ELIFECYCLE` and no `error TS`. Exit code is not wrapped. | 23 project scripts finished `typecheck: Done`, through `apps/api` | DONE for the printed projects | `runtime/.local/review-typecheck-security-final-20261009.log` |
| Architecture | Created 11:53:50.329Z, written 11:54:02.911Z. Overlaps clean HTTP. | `pnpm check:architecture` | No violation text. Exit code is not wrapped. | 335 modules, 1013 dependencies, private-import check 285 files | DONE | `runtime/.local/review-architecture-security-final-20261009.log` |
| Script syntax | 2026-10-09T11:59:17.909Z. Clean HTTP was still running. | `node --check scripts/measure-storefront-performance.mjs` | 0 | N/A | DONE | `runtime/.local/review-performance-syntax-final-20261009.json` |
| Pure script tests | Created 11:39:33.804Z, written 11:39:34.499Z | `node --test tests/scripts/storefront-performance.test.mjs tests/scripts/check-bundles.test.mjs` | Summary shows fail 0. Exit code is not wrapped. | 14 pass, 0 fail, 0 skipped, duration 643.7663 ms | DONE | `runtime/.local/review-pure-14-security-final-20261009.log` |
| Scratch migrations | Created 11:54:42.448Z, written 11:54:55.018Z. Overlaps clean HTTP. | `pnpm migrate:scratch` | Success line present. Exit code is not wrapped. | Apply 001–035, partial revert 035 down through 014, reapply 014–035. The script prints that line only after the full down-to-empty, full reapply, and the deliberate `999_fail_probe.sql` division-by-zero rollback. | DONE for the script's own success line | `runtime/.local/review-migration-security-final-20261009.log`; source `scripts/scratch-migrate.ts` |
| Full HTTP, incomplete install | Vitest start 14:44:58 Cairo; duration 65.76s; log created 11:44:57.155Z, written 11:46:04.185Z | `pnpm test:http` | 1, `ELIFECYCLE` | 31 files collected as 28 failed and 3 passed; 12 tests passed. Cause: `Cannot find package 'better-auth'`. | FAILED, installation/harness. Retained. | `runtime/.local/review-http-full-security-final-20261009.log` |
| Full HTTP, clean | Vitest start 14:53:50 Cairo; duration 1036.39s; log created 11:53:49.679Z, written 12:11:07.017Z | `pnpm test:http` / Vitest 4.1.11, runtime, `vitest.config.ts` | Summary has no failure line. Exit code is not wrapped. | 31 files passed, 246 tests passed. The summary does not list skips. | DONE as the application HTTP result. It overlapped the static gates above. | `runtime/.local/review-http-full-clean-final-20261009.log` |
| Public browser, 14 files | Log created 12:14:32.844Z, written 12:19:09.357Z; Playwright duration 4.5m | The 14 checklist files, runtime Playwright, reporter line. | The summary is a failure. No wrapper EXIT line. | 37 collected; 1 failed (`catalog-media.spec.ts:10`); 36 passed. No skip line. | FAILED | `runtime/.local/review-public-37-final-20261009.log` |
| Catalog-media engine retry | START 12:26:24.144Z; EXIT 1 at 12:26:41.134Z; elapsed 17s | Same spec. PATH Node was v22.13.1. | 1 | Web server failed `ERR_PNPM_UNSUPPORTED_ENGINE` before a test result. | FAILED, harness | Same log as the next row, first half of `review-catalog-media-rerun-20261009.log` |
| Catalog-media locator rerun | RETRY 12:27:27.263Z with Node v22.23.3; EXIT 0 at 12:28:07.137Z; elapsed 40s; Playwright 37.9s | `tests/browser/catalog-media.spec.ts` only | 0 | 1 passed | DONE for this one file. 36 + 1 is not one fresh 37. | `runtime/.local/review-catalog-media-rerun-20261009.log` |
| Focused internal, 4 files | EXIT 1 at 12:31:35.793Z; elapsed 175s; Playwright 2.9m | `offline-sync`, `pos-workspace`, `sales`, `session-transition` | 1 | 28 collected; 2 failed; 26 passed. No skip line. | FAILED | `runtime/.local/review-internal-4-final-20261009.log` |
| Sales two-case rerun | START 12:36:21.132Z; EXIT 0 at 12:36:58.193Z; elapsed 37s; Playwright 35.3s | The two sales cases that failed immediately above. | 0 | 2 passed | DONE for those two cases. 26 + 2 is not one fresh 28. | `runtime/.local/review-sales-two-rerun-20261009.log` |
| Reporting, receipt body | START 12:37:33.159Z Cairo 15:37:33; EXIT 1 at 12:38:10.994Z; elapsed 38s | `tests/browser/reporting.spec.ts` | 1 | 1 failed, 1 passed (35.9s). Midnight guard did not skip. | FAILED, fixture | `runtime/.local/review-reporting-cairo-20261009.log` |
| Reporting, link name | START 12:40:30.325Z Cairo 15:40:30; EXIT 1 at 12:41:12.635Z; elapsed 42s | Same file after the branch id repair. | 1 | 1 failed, 1 passed (40.1s). No skip. | FAILED, locator | `runtime/.local/review-reporting-cairo-rerun-20261009.log` |
| Reporting, card text | START 12:45:20.206Z Cairo 15:45:20; EXIT 1 at 12:46:09.339Z; elapsed 49s | Same file after exact link name. | 1 | 1 failed, 1 passed (47.1s). No skip. | FAILED, stale locator/copy | `runtime/.local/review-reporting-cairo-exact-20261009.log` |
| Reporting, provenance | START 12:50:33.349Z Cairo 15:50:33; EXIT 0 at 12:51:08.942Z; elapsed 36s | Same file after provenance locators. Node v22.23.3. | 0 | 2 passed (33.7s). No skip. | DONE for this file on this rerun. The three red rows stay. | `runtime/.local/review-reporting-cairo-provenance-20261009.log` |
| Isolated capture 1 | START 12:53:44.375Z; EXIT 1 at 12:54:10.067Z; elapsed 26s | Temporary runtime spec. `__dirname` in an ES module. | 1 | `No tests found` | FAILED, harness | `runtime/.local/review-isolated-captures-20261009.log` |
| Isolated capture 2 | START 12:55:36.002Z; EXIT 1 at 12:56:12.776Z; elapsed 37s | Same spec after an ESM path fix. | 1 | 1 failed. `getByRole('status')` matched two elements. | FAILED, harness | `runtime/.local/review-isolated-captures-rerun-20261009.log` |
| Isolated capture 3 | START 12:57:06.518Z; EXIT 1 at 13:00:33.789Z; elapsed 207s | Review control stayed disabled before a delivery area was selected. | 1 | 1 failed | FAILED, harness | `runtime/.local/review-isolated-captures-rerun2-20261009.log` |
| Isolated capture 4 | START 13:01:23.308Z; EXIT 1 at 13:02:17.837Z; elapsed 55s | Native required-field text is on submit, and submit appears after a quote. | 1 | 1 failed | FAILED, harness | `runtime/.local/review-isolated-captures-rerun3-20261009.log` |
| Isolated capture 5 | START 13:03:36.827Z; EXIT 1 at 13:07:03.082Z; elapsed 206s | First variant button was the unstocked pair, so `إضافة إلى السلة` was absent. | 1 | 1 failed. Timeout 180000 ms. | FAILED, harness | `runtime/.local/review-isolated-captures-rerun4-20261009.log` |
| Isolated capture 6 | START 13:07:54.565Z; EXIT 1 at 13:12:20.916Z; elapsed 266s | Split radio is rendered after `قبول الأسعار`. | 1 | 1 failed. Timeout 240000 ms. | FAILED, harness | `runtime/.local/review-isolated-captures-rerun5-20261009.log` |
| Isolated capture 7 | START 13:13:06.513Z; EXIT 0 at 13:13:45.060Z; elapsed 39s; Playwright 36.8s | Same temporary spec. Node v22.23.3. Proof written 13:13:29.907Z. | 0 | 1 passed | DONE for capture generation. Main visual review is NOT_RUN. | `runtime/.local/review-isolated-captures-rerun6-20261009.log`; `after/isolated-captures-20261009/capture-proof.json` |
| API/internal/storefront build + bundle guard | Created 11:54:42.145Z, written 11:55:22.756Z. Overlaps clean HTTP. | `pnpm build` | Success line present. Exit code is not wrapped. | Next 16.3.8 dynamic routes `/`, `/cart`, `/checkout`, `/products/[productId]`. `bundle separation ok: internal files=34, storefront files=201, static entry files=3` | DONE | `runtime/.local/review-build-security-final-20261009.log` |
| Local CI file shape | 2026-10-09T11:38:51.732Z | Parser PyYAML 6.0.3 over the untracked workflow. | Shape file written | Jobs `static-and-build`, `http`, `browser`; 9 SHA-pinned actions; `hostedWorkflowExecuted: false` | DONE for local shape only | `runtime/.local/review-ci-final-shape-security-20261009.json` |
| Hosted Ubuntu CI | Not executed | No publication or hosted run was authorized. | N/A | N/A | NOT_RUN and BLOCKED | Workflow SHA-256 `1EF9976377DF3974807808910EA4B9A8754FF46B4949EBDA0F2E578196EEFE60` is local only. |

The complete CI browser command, including `offline-production.spec.ts` and `production-login.spec.ts`, was NOT_RUN.

Cairo reporting: every reporting attempt on 9 October started between 15:37 and 15:50 Cairo. The midnight guard in `tests/browser/reporting.spec.ts` did not skip. A skip was not treated as a pass.

Overlap, stated once: clean HTTP was created at 11:53:49.679Z and its log was written at 12:11:07.017Z. Architecture and typecheck were created in the same second. Scratch migration and build were created at 11:54:42Z and finished before 11:55:23Z. Script syntax ran at 11:59:17Z. The shared-machine sequence in the checklist was therefore not exclusive for those static commands. Their logs still contain their own results. They were not rerun after ordinary preview services were restored.

## Security patch and compatibility evidence

| Package/runtime | Previous verified value | Final installed value | Dependency path / source identity | Audit/compatibility evidence |
| --- | --- | --- | --- | --- |
| Node / pnpm | Historical local note Node 22.13.1 in `docs/development/local-setup.md`; engines now require `>=22.23.3 <23` | Node `v22.23.3`; pnpm `10.34.5` | Portable executable hashed this session; pnpm.cjs entry | Frozen-boundary JSON and install logs. The 17-second catalog retry shows PATH Node 22.13.1 cannot start the runtime. |
| Next / @next/env / platform SWC | The 11:15Z audit still names Next advisory entries from the earlier install. | Next `16.3.8`, `@next/env` `16.3.8`, `@next/swc-win32-x64-msvc` `16.3.8` | Runtime preflight 11:53:24.454Z; storefront manifest hash above | Build log prints Next 16.3.8. |
| Fastify | Security patch recorded in the candidate inventory | `5.12.5` | API package manifest hash above; preflight | Zero-advisory JSON at 11:41Z |
| Sharp / libvips / librsvg | Security patch recorded in the candidate inventory | Sharp `0.35.5`; libvips `8.18.7`; librsvg `2.63.2` | Preflight `sharp` object | Same preflight JSON |
| Other changed security dependencies | No further package bumps in this pass | Lock hash unchanged from the reviewed freeze | `pnpm-lock.yaml` hash above | No `audit --fix`, no ignore file, muted arrays empty |

The 11:15Z full audit is a point-in-time finding on the tree that produced it. Its advisory ids are GHSA-3w37-wq28-93x7, GHSA-4jqv-mc3x-m676, GHSA-39w2-rjm5-chcv, GHSA-f87g-xv8r-7p7x, GHSA-mcj8-r9mp-w47p, and GHSA-cjq9-62q9-8jv4. This report does not claim those entries were exploited. The 11:41Z full and production JSON files report zero advisories for the refreshed install. That is not a permanent security guarantee. October 7 security documents stay historical; this report does not rewrite them.

## Failure, repair and red/green chronology

| Initial failure / evidence | Classification and demonstrated cause | Approved repair / exact files | Scope preserved | Current affected rerun / result | Remaining concern / owner |
| --- | --- | --- | --- | --- | --- |
| HTTP 28 collection failures, 12 tests passed, 65.76s, missing `better-auth` | Installation/harness after an incomplete runtime install | Cached frozen installs at 11:51Z. No lock edit. | Business code unchanged by that recovery | Clean HTTP 31 files / 246 passed, log written 12:11:07Z | Overlap with static gates, disclosed above |
| Full audit low 1 / moderate 4 / high 1 at 11:15Z | Point-in-time Next advisory snapshot before the retained 16.3.8 install | Already present in the candidate lock and manifests. This pass did not bump packages. | No audit ignore and no `--fix` | 11:41Z full and production audits, all severities 0 | Main still reviews the lock diff |
| Public catalog-media strict mode: two `قريباً` nodes | Locator. The test collected and failed. | `tests/browser/catalog-media.spec.ts` in root and runtime. Coming-soon text is read inside `getByRole("main")`. Hash `91FEAD6D1E7B0D57E0EAF559FBDD6AEE12918EB3033863592E4BAF3EA6BC8589`. | Visibility and stock assertions kept | Engine retry failed on Node 22.13.1. Node 22.23.3 rerun: 1 passed, 37.9s, EXIT 0 | Not a fresh 14-file run |
| Internal sales `:99`: completed payment poll expected length 1, received 2, while the status already contained the saved-sale text | Test observation of two completion records in the poll. Product code was not changed. A double stock deduction was not demonstrated. | None | Sale identity, tender, and stock assertions were not weakened | Same two cases rerun: 2 passed, 35.3s, EXIT 0 at 12:36:58Z | The 28-file collection remains a failed row plus a two-case rerun |
| Internal sales `:1126`: saved sales expected length 2, received 1 | Same run. The second case did not observe both saved sales. | None | Assertion kept | Included in the same 2-passed rerun | Same limit |
| Reporting receipt POST expected 201, received 400 | Fixture omitted the Phase 1 receiving `branchId` | Both copies of `tests/browser/reporting.spec.ts` send `branchId: workspace.body.activeBranch.id` | Cashier privacy assertion kept | Next row still failed for a different reason | See the following rows |
| Reporting `التقارير` matched the nav link and the today tile | Strict locator | Manager click uses `exact: true`. Cashier `toHaveCount(0)` was not given `exact`. | Cashier must still see no reports link | Next row failed on card text | Amount checks were not removed |
| Reporting sale card filtered by the sale UUID text; best-seller and inventory strings differed from `ReportsPage.tsx`; return details show the sale reference | Stale locator/copy. The error snapshot reached the report figures before the card filter failed. | Cards filter on `a[href="/sales?saleId=…"]` and `a[href="/returns?returnId=…"]`. Best-seller text is `وحدات البيع بعد الإلغاء وقبل المرتجعات`. Inventory text is `لقطة إجمالية للمخزون الحالي`. Return details expect `sale.body.reference`. Both copies hash `B2BE86BF7C7545BD614C0F74D3C912CEB780637F64A1BEE041D5B3F53E3B23CF`. | Amount expectations 450, 275, 175, 280, and the employee deduction remained | Provenance rerun 2 passed, 33.7s, EXIT 0, Cairo 15:50–15:51 | Three earlier reporting rows stay red |
| Six capture failures, then one pass | Harness only: ESM path, status locator, disabled review button, submit-time validation, unstocked first variant, tender radios before price acceptance | Temporary spec was deleted after the pass. `zz-isolated-capture-20261009.spec.ts` is absent. Product POS and checkout code were not edited for these failures. | No sale was submitted by the capture. Customer fields stayed synthetic and isolated. | Rerun 6: 1 passed, 36.8s, EXIT 0. 17 PNGs and `capture-proof.json`. | Main has not opened the set. The dev-server issue badge is recorded below. |
| Root `pnpm dev` | The root script calls `pnpm`, and `pnpm` is not on PATH. Portable entry is `pnpm.cjs`. | No package-script edit. The same filters were started with `node pnpm.cjs`. | Ordinary database was not reset | Direct command still running from 13:17:36Z | Exact `http://127.0.0.1:5173/` is refused. See the URL table. |

`ReportsPage.tsx` was not modified. The reporting test was aligned to the copy already committed at HEAD.

## Business acceptance matrix

The clean HTTP log is one 246-test selection on 9 October. It is the HTTP evidence for the rows below. Browser evidence is only the files whose rows appear in the command table. Named browser files that were not in that selection are NOT_RUN here. Historical October 7 captures are not reused as 9 October acceptance.

| Rule/workflow | Status | Exact tests/manual evidence | Actual observed outcome | Limits / owner |
| --- | --- | --- | --- | --- |
| Independent branch balances; receiving/import and actual existing variant pairs | DONE for the clean HTTP selection and the executed browser files | Clean HTTP 246, including the HTTP receiving, opening-import, catalog, and branch-inventory files in `tests/http`. Browser: `pos-workspace` in the 26 passed; `catalog-media` 1 passed on its rerun; `storefront-integration` in the 36 passed. | The clean HTTP summary is 31 files and 246 tests passed. Catalog-media's coming-soon locator was narrowed to `main` and then passed once. | Browser `receiving` and `catalog` specs were not part of this selection and are NOT_RUN. Opening CSV purchases classification is unchanged and unanswered. |
| POS offer/coupon/deduction; 275/175 example; zero/negative; exact cash/manual-online/split | DONE for HTTP plus the reporting rerun and the executed POS/sales browser cases | Clean HTTP sales, promotions, coupons, and offers files. Reporting provenance rerun keeps 275/175 and the 450/280/50 amounts. `pos-workspace` passed inside the 26. The two sales failures were rerun as 2 passed. | The provenance reporting run passed both cases after Cairo 15:50. The capture harness reached split tender fields on isolated data and did not submit the sale. | The first internal sales collection remains failed. This image pass did not confirm the filled 150 and 100 amounts in `pos-branch-tender-1024.png`; main needs to open that PNG. |
| Offline persistence/restart/reconnect/duplicate safety; original employee/branch/tender/price; account transitions | DONE for the executed HTTP and focused browser files | Clean HTTP sales-sync and staff-access files. Browser `offline-sync` 9 cases and `session-transition` 2 cases passed inside the 26. | Those named cases are in the passing portion of `review-internal-4-final-20261009.log`. | `offline-production.spec.ts`, `offline-pos.spec.ts`, and `production-login.spec.ts` were NOT_RUN in this selection. |
| Single-branch whole basket/repeated quantities; pending semantics; confirmation once; reversal vs inspection | DONE for the clean HTTP selection and `storefront-integration` | Clean HTTP checkout, order-confirmation, order-fulfillment, order-protection, and reporting-edgecase files. `storefront-integration.spec.ts` is inside the 36 passed. | Included in the 246 and in the public 36. | Browser `order-confirmation` and `order-fulfillment` were NOT_RUN as separate files. |
| Reference/phone/anonymous Returns; 14 days; paid refund; receiving branch/original FIFO; Owed/Paid | DONE for the clean HTTP selection and the reporting provenance rerun | Clean HTTP returns, online-returns, system-order-returns, and reporting-edgecase files. Reporting rerun follows the return link and expects the sale reference. | The provenance run passed. The receipt fixture now sends the active branch id. | Browser `returns` and `online-returns` were NOT_RUN. |
| Role/cost secrecy, public privacy, manager corrections, expenses/Cairo reporting/replay | DONE for the clean HTTP selection, the cashier reporting case, and the public privacy cases inside the 36 | Clean HTTP staff-access, catalog, expenses, corrections, and reporting files. Every reporting attempt left the cashier `التقارير` count assertion in place, and one cashier case passed on each reporting run. | Final reporting rerun: 2 passed, no midnight skip. | Browser `staff-access` and `expenses` were NOT_RUN. Ordinary preview costs were not printed. |
| Archive compatibility/branch-payment-reference facts; queue/newer-sale reconciliation; private recovery ACL | DONE for the clean HTTP selection on this Windows host | Clean HTTP backup, restore, staff-access, and release-path files. The staff-access candidate includes the Windows ACL regression, and that file is inside the 246. | The 246 summary has no failed file. | An external backup copy, media copy, and staff recovery drill were not performed. Browser `backup` and `restore` were NOT_RUN. |

Unanswered opening CSV purchases-recognition decision: no owner answer was given. Import and purchases behavior was left unchanged.

## Visual, accessibility and privacy review

Capture proof: `.scratch/product-ux-review-20261005/after/isolated-captures-20261009/capture-proof.json`, `capturedAt` 2026-10-09T13:13:29.907Z. Mode development. Production false. Servers API 3011, staff 5174, storefront 3001. Database isolated `bravos_e2e`. Fixture: synthetic catalog, one stocked variant quantity 2, one unstocked variant, one delivery area, one guest checkout. Effects stay in that isolated database. Seventeen PNGs are on disk. The temporary spec was removed after the pass.

This report pass opened four PNGs. The other thirteen were generated and indexed; they were not individually opened here. Main review of every screenshot is NOT_RUN.

| Capture/check | Route / fixture / viewport / browser | Timestamp/source; dev or prod | Evidence | Findings / result | Main review |
| --- | --- | --- | --- | --- | --- |
| Home/discovery/product variants | Home `/` at 320, 390, 768, 1024, 1440. Product `/products/0740a947-35ba-471a-82b3-4a050aa2e139` at 390 and 1440. Isolated synthetic product. Headless Chromium 140. | Development, 13:13:29.907Z | Opened `home-390.png` and `product-stocked-and-unavailable-390.png`. Remaining home and product widths are in the same directory. | Home 390 shows the Arabic RTL storefront, search, one synthetic product, a from-250 price, and a placeholder image. Product 390 shows stocked size M selected, size L marked unavailable, quantity 1, and price 250. A Next.js development `N` / `1 Issue` badge overlaps variant content. That badge belongs to the development server. It was not hidden in product code. | NOT_RUN |
| Populated/repaired cart and checkout | `/cart` failed, repaired, and populated shots. `/checkout` quote retry, validation, and acknowledgement at 390, plus acknowledgement at 1440. | Development, same proof | Opened `checkout-acknowledgement-390.png` only. | The acknowledgement shows reference `BRV-000001`, cash total 270, cart count 0, and a return-to-store control. A development `N` badge sits at the bottom edge. | NOT_RUN |
| Staff POS/branch/tender/action feedback | Staff `/lookup` at 390, 1024, and 1440. Isolated owner session, branch أبشواي, stocked quantity 2. The harness accepted prices and filled a split tender without submitting. | Development, same proof | Opened `pos-branch-tender-1024.png`. | The page shows branch أبشواي, the price-accepted notice, available quantity 2, the unstocked pair marked unavailable, and accepted original/employee/final amounts 250/0/250. Cash and electronic tender radios are visible. This inspection did not confirm the filled 150 and 100 split amounts in the image description. | NOT_RUN |
| Widths 320/390/768/1024/1440; RTL/mixed text/overflow/sticky actions | Home shots exist at all five widths. Other routes are at the widths listed in the proof. | Development viewport emulation, not OS zoom | Proof JSON plus the four opened PNGs | The opened 390 pages read as RTL. Horizontal overflow was not measured with a separate tool on every width. | NOT_RUN |
| Keyboard/focus/targets/contrast/reduced motion/status/error recovery | `storefront-keyboard.spec.ts` and the other public files inside the 36 passed. | Development Playwright, 12:14–12:19Z | `review-public-37-final-20261009.log` | Those cases passed inside the 36. This pass did not repeat a manual keyboard walk, contrast meter, or reduced-motion check. | NOT_RUN |
| True 200% browser zoom / screen reader | No zoom tool and no screen reader were available. | Viewport emulation is not zoom. | None | BLOCKED. Prerequisite: a qualified tester with a supported browser zoom and screen reader, then main review. | NOT_RUN |
| Eight-field memory draft/uncertain response/privacy/media revocation | `apps/storefront/app/checkout/checkout-draft.tsx` holds `customerName`, `primaryPhone`, `deliveryAreaId`, `detailedAddress`, `alternatePhone`, `landmark`, `notes`, and `couponCode` in React state. `page.tsx` still writes the versioned pending/accepted request through `writeAttempt`, validates it in `validRequest`, and removes a pending attempt only for the matching `operationId`. | Source inspection this pass. Behavior coverage is in the public checkout and catalog-media runs. | Source lines cited above. Catalog-media rerun passed after the `main` scope. | The draft provider does not write customer fields to browser storage. The existing `writeAttempt` localStorage record was left in place, including customer name, phone, and address. No new persistent customer store was added. Public media revocation on a hosted CDN was not tested. | NOT_RUN |

Ordinary `public_analytics_event` after the preview document GETs: 43 rows, 24 `visit`, 10 `product_view`, 9 `cart_addition`. Latest `recorded_at` is 2026-10-07T16:44:54.555Z. No stored analytics row was recorded on 2026-10-09. There was no snapshot taken in the instant before those GETs. Payloads were not printed.

## SF-11 production performance boundary

Status: BLOCKED.

The historical hidden `next start` rejection remains `rejected: blocked by policy`. It was not relaunched, and no alternate port or rehearsal launcher was used. No already-running isolated production server for baseline `15fd366` or for the final build was supplied. `node --check` on `scripts/measure-storefront-performance.mjs` exited 0 at 11:59:17Z, and the 14 pure script tests passed. Those checks do not measure LCP, CLS, or a 24-sample matrix.

Required next action: the owner and operator supply permitted, already-running baseline and final production servers, the same approved catalog and media fixture, and representative photography. Then follow `docs/development/storefront-performance.md` with `--attest-isolated-production` and a new `.scratch` output directory. No customer data and no transaction.

## Ordinary data, development URLs and cleanup proof

| Preservation item | Before evidence/time | After evidence/time | Outcome / discrepancy disposition |
| --- | --- | --- | --- |
| Products/variants/batches/sales/orders | `after/live-data-proof-before-20261009.json` at 2026-10-09T11:15:57.365Z and `live-data-proof-after-20261009.json` at 2026-10-09T12:39:02.716Z: 2/2/2/4/0 | `after/live-data-proof-after-ordinary-urls-20261009.json` at 2026-10-09T13:26:09.020Z: 2/2/2/4/0 | Matches. The 12:39 file was not overwritten. |
| Abshway quantities | 25 and 29 in both earlier proofs | 25 and 29 | Matches. No reset. |
| Active Fayoum fee | `"5000"` piasters, active | `"5000"`, active, name `الفيوم` | Matches. This is preview preservation, not launch-data approval. |
| Other database/config baseline | Migration columns `id`, `applied_at`; count 35; latest `035_return_reason.sql` | Same columns, count, and latest id | Matches. Analytics aggregate recorded above. |
| API 3010 / staff 5173 / storefront 3000 | Direct dev command started 13:17:36Z after root `pnpm dev` failed because `pnpm` is not on PATH. Log: `review-ordinary-dev-20261009.log` and `review-ordinary-dev-direct-20261009.log`. | At the recount window: `http://127.0.0.1:3010/api/public/health` returned 200, 41 bytes, body `{"ok":true,"application":"bravos-public"}`. `http://127.0.0.1:5173/` was refused. `http://localhost:5173/` and `http://[::1]:5173/` returned 200, 645 bytes. Storefront listened on `:::3000` pid 27724. Two earlier non-browser document GETs of `http://127.0.0.1:3000/` returned 200 and 38860 bytes. This report pass did not repeat a storefront GET. | Exact checklist URL `http://127.0.0.1:5173/` is FAILED on this Windows host. The same Vite process answers on IPv6 localhost. `apps/internal/vite.config.ts` sets port 5173 and `strictPort` and does not set `host`. It was not changed. Analytics latest row remains 7 October. |
| Owned E2E/migration resources | Playwright stacks used 3011/5174/3001/55433 and scratch migration used 55434. | Those ports were not listening at 13:26Z. Residual `e2e-control-*.json` count: 149. The capture spec is gone. | Clusters are stopped. Control files were left in place because many pre-existed and this handoff forbids deleting pre-existing files. |
| Protected Grok review SHA-256 | `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A` | Same digest at 16:27 Cairo. Git still shows `+4 / -1` versus HEAD. | Unchanged by this pass and excluded. |
| Git index | Empty at dispatch | `git diff --cached --name-only` printed no paths at 16:27 Cairo. | Empty. Nothing was staged, committed, pushed, or deployed. |
| Final diff/source register | 572-file security-final register, 0 pairwise differences at preflight | 572 compared, 0 current root/runtime pair mismatches, 2 hash differences from that register. `git diff --check` exit 0 with CRLF warnings only. | The two hash changes are the locator repairs. |

Later observation, 2026-10-09T18:10:46Z: the portable pnpm supervisor exited 1. Its log ends with `@bravos/internal` `vite` status `4294967295` and `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL`. There is no compile error in that log. API pid 7292 and storefront pid 27724 from the 13:17Z start were still running afterward. `http://127.0.0.1:3010/api/public/health` again returned 200 and 41 bytes. The original staff pid 28592 was gone. A different Node process, pid 37212, started at 18:10:47Z with `vite --host 127.0.0.1 --port 5173 --strictPort`. Both `http://127.0.0.1:5173/` and `http://localhost:5173/` then returned 200 and 645 bytes. This pass did not launch that host flag and did not change `vite.config.ts`. The 13:26Z refusal of `127.0.0.1:5173` remains the report-time result. PostgreSQL pid 25840 was still listening on 54329.

Exclusions left in place: `docs/reviews/bravos-v1-grok-review.md`, `arabic font/`, `english font/`, `packages/report-export/assets/NotoSansArabic-Regular.ttf`, `Claude outputs/`, `.pnpm-store/`, `apps/api/.local/`, scratch logs and captures, generated builds, local databases, credentials, and temporary tools. `git ls-files --others --exclude-standard` currently lists the pnpm store and those raw assets because they are untracked. They are not part of the proposed commit.

## Changed-file register and documentation reconciliation

The 45 related tracked paths and the untracked engineering/evidence paths classified before this pass stay in [candidate-file-inventory-2026-10-09.md](candidate-file-inventory-2026-10-09.md). An addendum there records the delta below. Line counts are `git diff --numstat` against HEAD.

| Exact candidate path | Tracked/untracked | Why needed | Behavior/scope affected | Current verification / main disposition |
| --- | --- | --- | --- | --- |
| Inventory's 45 related tracked paths and its listed untracked engineering and historical docs | Mixed, as classified in that file | Security pin, POS/storefront/session work, CI and backup docs, tests | As stated in the inventory. This pass did not re-edit those product files. | Main disposition NOT_RUN. HTTP, build, audit, and focused browser logs are now linked above. |
| `README.md` | Tracked +2 / -2 | Document portable Node 22.23.3 | Setup instructions | Not separately executed beyond the version check this session. Main NOT_RUN. |
| `docs/development/local-setup.md` | Tracked +17 / -5 | Record the 9 October Node pin and archive checksum. The 22.13.1 sentence remains historical. | Documentation | Zip checksum was not re-verified this pass. Main NOT_RUN. |
| `scripts/pinned-env.ts` | Tracked +1 / -1 | Child processes use `process.execPath`'s directory. | Runtime path selection | The catalog engine failure shows a PATH Node 22.13.1 still fails engines. Portable Node 22.23.3 was used for the green reruns. Main NOT_RUN. |
| `tests/browser/catalog-media.spec.ts` | Tracked +1 / -1. Root and runtime hash `91FEAD6D…` | Strict-mode coming-soon locator | Test locator only | One-file rerun passed. The 14-file run remains 36 passed and 1 failed. |
| `tests/browser/reporting.spec.ts` | Tracked +15 / -8. Root and runtime hash `B2BE86BF…` | Branch id, exact reports link, provenance cards, committed copy | Test fixture and locators. Amount assertions kept. | Provenance rerun 2 passed. Three earlier rows remain failed. |
| `docs/reviews/candidate-file-inventory-2026-10-09.md` | Untracked, plus this pass's addendum | Keep the 45-file snapshot and record the later delta | Review artifact | Not a product change. |
| `docs/planning/production-readiness-intern-todo-2026-10-09.md` | Untracked | Execution checklist | Handoff | Unchanged by the results. |
| `docs/reviews/production-readiness-intern-report-template.md` | Untracked | Template | Handoff | Left unchanged. |
| `docs/reviews/production-readiness-intern-report-2026-10-09.md` | Untracked, this file | Required report | Review artifact | Awaiting main review. |

Dated appendices for `docs/reviews/production-readiness-2026-10-07.md`, `docs/reviews/dependency-security-2026-10-07.md`, `docs/planning/tickets/storefront/SF-12.md`, and `docs/planning/bravos-storefront-roadmap.md` were not added. The checklist allows those appendices only after main review. Their historical results stay as they are. SF-11 stays open.

## External acceptance and residual blockers

| Gate / concrete blocker | Status | Evidence available | Required next action/resources | Responsible owner | Main/client acceptance |
| --- | --- | --- | --- | --- | --- |
| Representative assortment/stock/cost/photos/content/brand/fonts | BLOCKED | Isolated synthetic catalog and placeholder images only. Raw font files exist and are excluded. | Owner supplies and reviews the real Arabic assortment, prices, branch batches, costs, photos, font roles, delivery/contact details, and staff grants. | Owner | NOT_RUN |
| Physical iPhone/iPad Safari, Android Chrome, shop POS hardware | BLOCKED | Desktop headless Chromium viewport emulation only. | Shop staff and engineering run the real devices and record OS, browser, touch, picker, keyboard, offline restart, and reconnect results. | Staff and engineering | NOT_RUN |
| True zoom/screen reader/full accessibility | BLOCKED | Playwright keyboard file passed inside the public 36. No 200% zoom and no screen reader. | A qualified tester runs those tools and main reviews the findings. | Qualified tester | NOT_RUN |
| Permitted representative matched production performance | BLOCKED | Syntax check and 14 pure tests. Hidden `next start` remains `rejected: blocked by policy`. | Permitted baseline `15fd366` and final production servers, approved photos, and both 24-sample matrices. | Operator and owner | NOT_RUN |
| Hosting/domain/TLS/proxy/secure cookies/supervision/persistence/monitoring | BLOCKED | Local preview only. | Choose hosting and a domain only after approval. No purchase and no deploy now. | Owner and operator | NOT_RUN |
| External backup/media copy/recovery/queue drill and staff training | BLOCKED | HTTP backup/restore/staff-access passed inside the 246. Written guides exist. | A named operator and manager perform the external database backup, separate media copy, restore, owner recovery, queued-sale drill, and signed training. | Named operator and manager | NOT_RUN |
| Internal pilot, then separately approved public ordering | BLOCKED | Local engineering logs above. Ordering was not switched. | Reconcile opening data and tills, approve an internal pilot, then make a separate public-ordering decision. | Owner and staff | NOT_RUN |
| Opening CSV purchases-recognition question | BLOCKED | No owner answer. Code left unchanged. | Owner decides whether opening value enters import-period purchases. | Owner | NOT_RUN |
| Hosted Ubuntu CI | NOT_RUN and BLOCKED | Local workflow shape JSON only. | Authorize publication and a hosted run. A local Windows log does not replace it. | Owner / repository publisher | NOT_RUN |
| Exact ordinary staff URL `http://127.0.0.1:5173/` | FAILED at 13:26Z for the documented Vite command | Connection refused then. `localhost` and `[::1]` returned 200 from pid 28592. At 18:10Z a separate `vite --host 127.0.0.1` process returned 200; see the later observation. | Decide whether the documented command should bind `127.0.0.1`. This pass did not change Vite. | Engineering, after main review | NOT_RUN |
| Main review of this diff, the logs, and the 17 screenshots | NOT_RUN | This report and the linked files | Open the diff, the red and green logs, and the PNGs before any commit decision. | Main | NOT_RUN |

## Final main-review gate and handoff

- [ ] Main reviewed exact source diff and changed-file reasons.
- [ ] Main reviewed current logs, counts/skips/failures/repair chronology and source identity.
- [ ] Main opened and reviewed listed screenshots; findings resolved or assigned.
- [ ] Ordinary data, excluded files, protected hash, empty index and owned cleanup verified.
- [ ] Dated status appendices match actual evidence without closing external gates prematurely.
- [ ] Named owners received actionable remaining tasks through authorized coordination; no unauthorized messages/actions.

The six boxes above are unchecked. This session verified the ordinary counts, the protected hash, and the empty index, and it is recording that verification here. Main has not signed those boxes.

Bounded candidate verdict: NOT_RUN. Main has not accepted a bounded engineering candidate.

Remaining work that another intern/operator can execute:

1. Main reviews this report, the dirty diff, and the seventeen PNGs.
2. If main wants a strict sequential rerun of typecheck, architecture, scratch migration, build, and syntax, run them only while the clean HTTP log's overlap is being replaced, and do not attach them to ports 3010, 5173, or 3000.
3. Hosted CI after publication is authorized.
4. SF-11 only after permitted production servers and representative photos exist.
5. External content, hardware, accessibility, hosting, recovery drill, pilot, and the opening CSV answer, each with the owner named above.

Changes made to business policy/data/deployment: none. Locator and fixture edits are limited to `tests/browser/catalog-media.spec.ts` and `tests/browser/reporting.spec.ts`. Ordinary preview counts stayed 2/2/2/4/0, Abshway 25 and 29, and the active Fayoum fee 5000 piasters. No deployment and no public-ordering switch.

Staging/commit/push/deploy authorization: none.

Proposed exact commit boundary, for a later user decision after main reviews this report and the diff:

- The 45 related paths and the retained historical docs in the candidate inventory.
- `README.md`, `docs/development/local-setup.md`, and `scripts/pinned-env.ts`.
- `tests/browser/catalog-media.spec.ts` and `tests/browser/reporting.spec.ts`.
- `docs/reviews/candidate-file-inventory-2026-10-09.md`, `docs/planning/production-readiness-intern-todo-2026-10-09.md`, `docs/reviews/production-readiness-intern-report-template.md`, and this report.

Leave excluded: `docs/reviews/bravos-v1-grok-review.md`, `arabic font/`, `english font/`, `packages/report-export/assets/NotoSansArabic-Regular.ttf`, `Claude outputs/`, `.pnpm-store/`, `apps/api/.local/`, `.scratch/`, `.local/` databases, credentials, tools, generated builds, the 149 e2e control files, and the capture PNGs. Do not stage that boundary until the user approves it after main review.
