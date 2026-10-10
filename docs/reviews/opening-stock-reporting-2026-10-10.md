# Opening stock reporting — 2026-10-10

Owner decision: **Show opening stock separately.** Accepted CSV opening stock is a separate opening balance in management reports, the Arabic report screen, and PDF/Excel exports. It is not a new purchase and it is not an operating expense. Import-acceptance audit dates stay on the Cairo acceptance date. Original batch dates and FIFO stay on the CSV values. No schema migration, stock movement, profit-formula change, permission change, or public API change is part of this decision.

Local evidence only. Main independently verifies the final source. This note does not claim a hosted result, a clean full HTTP suite, or a clean full browser suite.

Toolchain: pinned Node `22.23.3` (`.local/tools/node-v22.23.3-win-x64/node.exe`) and pnpm `10.34.5` (`.local/tools/node_modules/pnpm/bin/pnpm.cjs`). Isolated development PostgreSQL through the existing test harness. No production storefront start.

## What changed

An accepted `opening_import_preview` whose persisted plan has a nonempty `batches` array is the only origin that classifies receipts as opening stock. Every branch receipt from that acceptance shares the preview operation id. Configuration-only accepted imports and unaccepted previews do not. Reporting reads that set through `OpeningImportReportingReader` on the same repeatable-read client as the rest of the report. Receiving does not query opening-import tables.

Ordinary purchases exclude those receipts. Opening intake is reported with its effective quantity and cost and its correction history. Totals do not follow the sales branch, employee, or channel filters. Opening value does not enter expenses or operating profit.

## PDF assertions

`pdfjs-dist` `6.4.299` is a root test-only devDependency. It is not a feature or application dependency and it is not added to API build externals. The installed `DocumentInitParameters` type has no `isEvalSupported` option. The test `getDocument` call does not enable PDF scripting. Optional `@napi-rs/canvas` is present in the lock because pnpm records the pdfjs optional dependency; the test does not import it.

The regression reads the real HTTP PDF with `pdfjs-dist/legacy/build/pdf.mjs`, then `page.cleanup()` and `loadingTask.destroy()`. Summary amounts use the nearest amount to the right of the purchase and opening labels: `450.00` and `920.00`. Receipt ids and costs are taken only from items between the exact observed section headings, carrying section state across pages. Purchase ids and costs stay under Purchases. Opening ids and costs stay under Opening Stock. XLSX keeps the canonical Arabic labels and maps each cost to its receipt id: opening 200 and 720, purchases 400 and 50.

Observed Cairo/react-pdf extraction spellings are accepted only as exact alternatives for those labels and headings. They are extraction compatibility, not a global Arabic normalization and not a claim about PDF visual or accessibility quality. PDF Arabic visual quality is not proved.

## Verification

Logs live under `.scratch/grok-production-20261010/opening-report/`. Earlier red logs were kept. They were not overwritten by later green runs.

| Log | Result |
| --- | --- |
| `http-red.log` | EXIT 1. 1 failed. Start 10:29:18. Duration 42.44s. Opening value was still inside purchases (`137000` vs `45000`). |
| `http-green-xlsx-sort.log` | EXIT 1. 1 failed. Start 10:36:28. Duration 14.31s. |
| `http-green-pdf.log` | EXIT 1. 1 failed. Start 10:37:01. Duration 18.85s. |
| `http-green.log` | EXIT 1. 1 failed. Start 10:49:35. Duration 14.13s. |
| `http-pdfjs.log` | EXIT 1. 1 failed. Start 12:06:34. Duration 21.81s. |
| `http-pdfjs-blocks.log` | EXIT 1. 1 failed. Start 12:07:30. Duration 15.30s. |
| `http-pdfjs-receipt-boundary.log` | EXIT 1. 1 failed. Start 12:13:43. Duration 19.08s. |
| `http-pdfjs-receipt-boundary-2.log` | EXIT 1. 1 failed. Start 12:14:18. Duration 19.31s. |
| `http-pdfjs-green.log` | EXIT 1. 1 failed. Start 12:16:41. Duration 21.09s. |
| `http-opening-stock.log` | EXIT 0. 1 passed. Start 12:17:26. Duration 20.55s. Valid for the source before the final section-boundary and scratch-write corrections. |
| `http-opening-stock-sections.log` | EXIT 0. 1 passed. Start 12:29:47. Duration 35.46s (test 24.28s). Current opening-stock HTTP regression after those two test-only corrections. |
| `http-reporting.log` | EXIT 0. 7 passed. Start 12:18:00. Duration 39.11s. |
| `http-reporting-edgecases.test.log` | EXIT 0. 10 passed. Start 12:18:51. Duration 42.80s. |
| `http-analytics-exports.test.log` | EXIT 0. 4 passed. Start 12:19:35. Duration 17.52s. |
| `http-opening-import.test.log` | EXIT 0. 6 passed. Start 12:19:53. Duration 27.48s. |
| `browser-reporting-analytics.log` | EXIT 0. 6 passed (1.2m). Analytics exports 3, then reporting filters, cashier denial, and opening stock apart from purchases. |
| `typecheck-bad-invoke.log` | EXIT 1. PowerShell named a function parameter `$args`, which shadowed the script name, so pnpm printed help. This is not a typecheck result. |
| `typecheck.log` | EXIT 0. Script printed: `pnpm -r --if-present typecheck`. Scope: 23 of 24 workspace projects. |
| `architecture.log` | EXIT 0. Script printed: `depcruise apps packages --config dependency-cruiser.cjs && node scripts/check-private-imports.mjs`. 444 modules, 1063 dependencies, no violations. Private-import check passed, 385 files. |
| `build.log` | No `EXIT` line. The three-app build started, the API bundle was written, and the internal production build reached its service-worker output. The storefront `next build` line is the last output. The relay, Grok, and Next processes were absent afterward. Main did not terminate this continuation. This is an interrupted build, not a pass and not a failed product test. |
| `build-rerun.log` | EXIT 0. Same root build script: `pnpm --filter @bravos/api build && pnpm --filter @bravos/internal build && pnpm --filter @bravos/storefront build && node scripts/check-bundles.mjs`. Static pages 4/4. `bundle separation ok: internal files=34, storefront files=73, static entry files=3`. This is the completed build gate. |
| `audit-full.json` | EXIT 0. info 0, low 0, moderate 0, high 0, critical 0. 789 dependencies. |
| `audit-prod.json` | EXIT 0. info 0, low 0, moderate 0, high 0, critical 0. 458 dependencies. |
| `audit-prod-moderate.log` | EXIT 0. `No known vulnerabilities found`. |
| `diff-check.log` | `git diff --check` exit 0. Protected `docs/reviews/bravos-v1-grok-review.md` SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. |

The four follow-up HTTP files and the browser run were not repeated after the final test-only assertion change. Nothing in this session is a full-suite result.

Main interrupted an earlier continuation, with no child process, to stop a handwritten PDF tokenizer. That stop is recorded in `interruption-pdf-parser.txt`. It is an architecture decision, not a test result.

`next build` in the completed gate rewrote `apps/storefront/next-env.d.ts` from the committed `./.next/dev/types/` imports to `./.next/types/`. That generated file was copied back. `apps/storefront/tsconfig.json` remains the pre-existing dirty file; its include still lists `.next/types` and `.next/dev/types`, not `.next-e2e`.

At Grok handoff, nothing in this batch was staged, committed, pushed, merged, closed, or deployed.

## Main acceptance

Main reviewed the diff against `a3df055`. Independent Standards and Spec reviews passed the application changes, and a final Sol 6.1 High review passed the corrected export regression. Main also corrected the active CSV guide to include required `branch_code` and describe the existing receiving record per represented branch; no importer behavior changed.

A separate Sol 6.1 Medium verifier executed the following gates serially on the final source on 10 October, from 12:36 to 12:42 Cairo. Evidence is under `.scratch/grok-production-20261010/opening-report/main-verification/`, with exact commands in `commands.log` and numeric exits in `outcomes.log`:

- Five separately executed real-PostgreSQL HTTP files: opening-stock reporting **1/1**, reporting **7/7**, reporting edge cases **10/10**, analytics/exports **4/4**, opening import **6/6**. Each command exited **0**; 28 affected tests in total, not a full HTTP-suite claim.
- Reporting and analytics/export browser files: **6/6 passed**, exit **0**, in one isolated development-harness run.
- Typecheck, architecture, the complete API/internal/storefront build and bundle gate: each exit **0**.
- Full and production audits: each exit **0**, zero advisories (789 and 458 dependencies respectively).
- Generated Next type paths were restored after stopped test/build processes. The protected review file retains its required SHA256. It and unrelated local assets/data/output directories are excluded from this commit scope.

This acceptance covers the bounded reporting change. It does not establish a fresh full project suite, hosted Linux acceptance, representative production performance, physical-device/PDF visual review or launch approval. The previously recorded failures and interrupted runs remain intact.
