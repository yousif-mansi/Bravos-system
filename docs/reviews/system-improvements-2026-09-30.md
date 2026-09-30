# System improvements — delivery review, 30 September 2026

Baseline: `dacf3c7205ce92f60613fb66ff564e891f2c0da1`. Status: implementation accepted by the coordinating agent after fresh verification and independent review; staging, commit and push are the next delivery step. This report covers the renewed twelve-part internal-system request recorded in [the gap plan](../planning/system-improvement-gap-pass.md), using [the latest operational rules](../planning/phase-1-operational-updates.md). Storefront visual work remains paused.

## Committed foundation and current pass

The baseline already contains branch stock with FIFO cost provenance, inventory-first intake, existing-pair online visibility, exact POS cash/manual-online/split allocation, durable branch-scoped offline sales with automatic retry, POS/RET references, return phone/reference/date lookup, receiving-branch return restoration, and confirmation-based online revenue with cancellation/failed-delivery reversal. The coordinating agent confirmed this baseline was pushed to `origin/main`, with the remote matching `dacf3c7`. This pass extends those foundations; it does not introduce another stock model, payment provider, approval policy or refund policy.

The [Phase 1 verification record](phase-1-operational-updates-verification.md) describes earlier runs, targeted repairs and physical-device limits. Its counts are historical and are not fresh evidence for this working-tree pass.

| Latest requirement | Foundation retained | Current improvement and verification boundary |
| --- | --- | --- |
| 1. Independent branch inventory | Branch balances, branch POS effects and one-branch online fulfillment | Stock guards and source-cost provenance retained and covered by fresh HTTP/browser regressions. |
| 2. Inventory-first product workflow | Catalog identity composed into intake; Products chooses existing SKU/pairs | Added sparse-pair bulk-selection regression so online selection cannot invent combinations or remove POS variants. |
| 3. Clear action feedback | Shared reveal/focus/highlight hook | Extended explicit edit/detail/preview feedback and loading/retry across staff screens; fresh browser checks cover delayed, failed, stale and repeated selections. |
| 4. Concise inventory views | Original/effective receipt facts and separate cost batches | Show current quantity/cost once and preserve original/before/after correction facts in expandable history. Received quantity and remaining stock keep distinct labels. |
| 5. Automatic completed-sale sync | Timer/focus/reconnection retry; durable accepted transaction facts | Queue wording now explains automatic sending/retry. Exceptional malformed-data/account/restore safeguards remain; no-event server recovery and production restart/reconnect checks passed. |
| 6. Readable order numbers | POS/RET references and BRV order sequence | Use `bravos_human_reference` for BRV values beyond six digits; propagate POS/RET references through report feature ports and normal report displays. Boundary tests and report/export checks passed. |
| 7. Return phone/order lookup | Phone/reference/date search and anonymous-sale fallback | Add bounded mixed-channel pagination and consistent digit normalization; preserve original sale branch separately from return receiving branch. More-than-100 and equal-timestamp HTTP regressions passed. |
| 8. Online sales at confirmation | Recognition/reversal facts and protected stock until inspection | Confirmation, replay, cancellation, failed delivery and inspection regressions passed with retained behavior. |
| 9. Useful return history | Return reference/customer/date/amount/status | Order/branch/product summaries and optional recorded reason are shown in Returns; persistence/restore and browser checks passed. |
| 10. Short return labels | Dedicated return/refund/inspection workflow | Concise wording retains eligibility and refund decisions; affected Returns browser checks passed. |
| 11. POS payment clarity | Exact immutable cash/manual-online/split allocation | Split-payment balance displays an explicit excess instead of clamping it to zero. Under/exact/over-payment checks passed; validation policy is retained. |
| 12. Green selection controls | Real checkbox and mutually exclusive radio inputs | Deterministic green background/white tick and mixed mark; green radios, disabled/focus states and forced-colors native fallback. Both-theme, keyboard and forced-colors browser checks passed; main visually reviewed light/dark screenshots. |

Source snapshot: internal receiving, POS, workspace, sales, reports, Returns and staff-management screens; internal selection CSS; returns/online-order/reporting/contracts adapters; API composition; optional-reason migration. The completed pass was independently reviewed: backend review covered 29 paths and UI review covered 27 paths, followed by a clean incremental test review. No outstanding findings remain from these reviews.

## Data and API compatibility

Migration `035_return_reason.sql` adds nullable `returns_return.reason`, limited to 500 characters. Existing records stay reason-less; `035_return_reason.down.sql` removes only that column. Draft reason is optional, and the current fingerprint omits absent/empty reasons to retain earlier reason-less operation fingerprints. Fresh real-PostgreSQL checks passed for reason persistence/replay compatibility, backup/restore and migration rollback.

The legacy `/api/internal/returns/sources` array response remains available. The additive `/api/internal/returns/sources-page` response supplies `items` and `nextCursor`; current parsing defaults to 25 items and permits 1–100. Manager authorization remains in the application service. Feature-owned readers filter and perform bounded keyset reads before the returns application merges physical/online results. The cursor binds its version, ordering key and search-filter fingerprint. Fresh regressions passed for stable timestamp/ID/channel traversal, amount/cancellation filtering before limits, and consistent phone matching. Nonempty input without searchable digits fails instead of broadening the search.

The optional reason also affects archive shape. The schema allowlist now recognizes migration 035; the existing feature-owned backup reader includes return columns. Source includes a specifically named migration-034 to migration-035 bridge and feature-owned validation of the exact old return-row shape before adding null reasons. Fresh archive/restore checks passed for the named compatibility profile and reason roundtrip; preview and activation use the same validated conversion. Unknown schemas and incompatible central-stock archives remain rejected. Data-only backup does not restore missing image binaries.

## Fresh verification

Coordinator commands used pinned Node 22.13.1 and pnpm 10.34.5. All log paths and browser output paths below are relative to `.scratch/system-improvements-20260930/`. HTTP tests used fresh temporary PostgreSQL clusters; browser processes were serialized under one coordinator. Operational PostgreSQL 54329 and demo PostgreSQL 55434 were excluded from test ownership.

PowerShell command environment:

```powershell
$env:PATH = "$PWD\.local\tools\node_modules\.bin;C:\Program Files\nodejs;$env:PATH"
```

| Run | Exact selected files / filters | Result | Log |
| --- | --- | --- | --- |
| HTTP guards | `pnpm exec vitest run --config vitest.config.ts tests/http/migrations.test.ts tests/http/backup.test.ts tests/http/order-confirmation.test.ts tests/http/order-fulfillment.test.ts tests/http/analytics-exports.test.ts` | 30 passed, 5 files, exit 0 | `http-guards.log` |
| HTTP returns | `pnpm exec vitest run --config vitest.config.ts tests/http/returns.test.ts tests/http/online-returns.test.ts tests/http/system-order-returns.test.ts` | 25 passed, 3 files, exit 0 | `http-returns.log` |
| HTTP restore boundaries | `pnpm exec vitest run --config vitest.config.ts tests/http/restore.test.ts tests/http/reporting-edgecases.test.ts tests/http/branch-inventory-migration.test.ts` | 16 passed, 3 files, exit 0 | `http-restore-boundaries.log` |
| HTTP reporting | `pnpm exec vitest run --config vitest.config.ts tests/http/reporting.test.ts` | 7 passed, 1 file, exit 0 | `http-reporting.log` |
| Browser core | `pnpm exec playwright test tests/browser/catalog.spec.ts tests/browser/receiving.spec.ts tests/browser/sales.spec.ts tests/browser/staff-feedback.spec.ts tests/browser/product-qa.spec.ts --output .scratch/system-improvements-20260930/browser-core-results --reporter list` | Initial 27 passed / 5 failed, 32 cases, exit 1 | `browser-core.log` |
| Browser operations | `pnpm exec playwright test tests/browser/staff-feedback.spec.ts tests/browser/staff-secondary-feedback.spec.ts tests/browser/returns.spec.ts tests/browser/online-returns.spec.ts tests/browser/order-confirmation.spec.ts tests/browser/order-fulfillment.spec.ts tests/browser/restore.spec.ts --output .scratch/system-improvements-20260930/browser-ops-results --reporter list` | Initial 21 passed / 2 failed, 23 cases, exit 1 | `browser-ops.log` |
| Browser repair / sale regressions | `pnpm exec playwright test tests/browser/receiving.spec.ts tests/browser/sales.spec.ts tests/browser/offline-pos.spec.ts --grep 'lost response then edit, reload\|pending receiving identity survives\|an already-open second tab\|tab A keeps its frozen\|receiving, split sale\|reconnect retries the original accepted sale once without repricing' --output .scratch/system-improvements-20260930/browser-regressions-results --reporter list` | 6 passed, exit 0 | `browser-regressions.log` |
| Production offline gates | `pnpm exec playwright test tests/browser/offline-production.spec.ts --grep 'production offline queue survives restart then automatically syncs after reconnect\|schema 2 completed sales missing paid-unit allocations defer upgrade and keep original facts' --output .scratch/system-improvements-20260930/browser-production-results --reporter list` | 2 passed, exit 0; real built service worker / same-profile restart | `browser-production.log` |
| Secondary feedback repair | `pnpm exec playwright test tests/browser/staff-secondary-feedback.spec.ts --grep 'branch persistence failure\|online detail failure' --output .scratch/system-improvements-20260930/browser-secondary-repair-results --reporter list` | 2 passed, exit 0 | `browser-secondary-repair.log` |
| Workspace types | `pnpm typecheck` | Passed, exit 0 | `typecheck.log` |
| Architecture | `pnpm check:architecture` | Passed, exit 0; 332 modules, 1004 dependencies, private import check 283 files | `architecture.log` |
| Production build / bundle separation | `pnpm build` | Passed, exit 0; API/internal/storefront; internal files 33, storefront files 208, static entry files 3 | `build.log` |

HTTP evidence is **78 distinct cases across 12 files and four invocations**, not one combined full-suite run. Independent HTTP jobs used separate temporary clusters; no shared cluster/database or migrations were run concurrently. Browser evidence is **55 distinct case identities across the recorded invocations**, each passing its final relevant run. Initial failures are retained in the logs. This does not claim one clean 55-case invocation or a re-run of all historical browser/HTTP tests.

Initial browser failures and repairs:

- Four receipt recovery cases still expected the removed `quantity × cost` display. Five assertions were updated to current concise received quantity/unit cost text; operation identity, duplicate protection, batch and stock assertions stayed intact. All four passed together in `browser-regressions.log`.
- The initial staff reset selector matched both `cashier` and `cashier-b`. It now selects the exact login in the staff card. The complete four-case final primary-feedback file passed in `browser-ops.log`, including the same-account loading regression added after the bounded SalesPage patch. The initial core run therefore does not certify one frozen SalesPage revision.
- The secondary branch persistence fixture intercepted the wrong IndexedDB API and did not inject its intended fault. It now faults actual session object-store writes, asserts the branch POST and same-account publication, checks error/unlocked controls, and verifies retry navigation after removing the fault. The online detail fixture supplied a nonexistent status and crashed status rendering; it now uses a valid typed order DTO. Both repaired cases passed together with their original focus/feedback assertions.

## Final distinct browser coverage

| Spec | Final passing identities |
| --- | ---: |
| catalog | 3 |
| product QA | 4 |
| receiving | 11 |
| sales | 11 |
| primary staff feedback | 4 |
| secondary staff feedback | 11 |
| returns | 2 |
| online returns | 1 |
| order confirmation | 1 |
| order fulfillment | 1 |
| restore | 3 |
| offline POS no-event server recovery | 1 |
| production restart/reconnect and legacy quarantine | 2 |
| Total distinct | 55 |


Workspace typecheck passed across all 23 projects. Scoped `git diff --check` passed. All owned test ports closed after verification; the original demo PostgreSQL on 55434 retained PID 21780. Operational 54329 was absent in both initial and final scans. No test launch was rejected.

Selection screenshots are retained under `browser-core-results/product-qa-branch-checkbox-f163d-board-states-in-both-themes/`, including light/dark unchecked, checked, focused, mixed and forced-colors states. Staff reveal screenshots cover delivery editing, expense details, staff reset and sale details. Main visually reviewed light/dark checked states; browser tests assert input semantics and radio exclusivity.

## Delivery and release limits

This is a local implementation pass, not a production release. Physical-device offline operation and hosted/TLS deployment remain separate release checks unless new evidence explicitly closes them. No domain/hosting booking, operational database reset, stock reassignment or live publication is part of this report.

Only the verified system pass should be staged at delivery. Pre-existing storefront planning/review changes, protected review edits, generated files, fonts/raw assets and local runtime outputs require separate scope decisions. The user has authorized commit/push of the completed verified system changes; implementation is accepted, while staging, commit and publication outcome remain the coordinating agent's responsibility.

## Selected delivery files

The coordinating agent selected these 60 files for the system commit. This list records scope before staging and does not claim a completed commit.

### API composition

- `apps/api/src/app.ts`

### Browser coverage

- `tests/browser/catalog.spec.ts`
- `tests/browser/online-returns.spec.ts`
- `tests/browser/product-qa.spec.ts`
- `tests/browser/receiving.spec.ts`
- `tests/browser/returns.spec.ts`
- `tests/browser/sales.spec.ts`
- `tests/browser/staff-feedback.spec.ts`
- `tests/browser/staff-secondary-feedback.spec.ts`

### Feature packages and migration

- `packages/backup/src/adapters/encrypted-archive.ts`
- `packages/contracts/src/index.ts`
- `packages/online-orders/src/adapters/postgres-online-orders.ts`
- `packages/online-orders/src/application/ports.ts`
- `packages/persistence/src/migrations/035_return_reason.down.sql`
- `packages/persistence/src/migrations/035_return_reason.sql`
- `packages/report-export/src/document/report-sheets.ts`
- `packages/reporting/src/application/reporting.ts`
- `packages/restore/src/adapters/postgres-restore.ts`
- `packages/restore/src/application/ports.ts`
- `packages/returns/src/adapters/postgres-reporting.ts`
- `packages/returns/src/adapters/postgres-restore.ts`
- `packages/returns/src/adapters/postgres-returns.ts`
- `packages/returns/src/application/ports.ts`
- `packages/returns/src/application/returns.ts`
- `packages/returns/src/domain/fingerprint.ts`
- `packages/returns/src/domain/source-search.ts`
- `packages/sales/src/adapters/postgres-sales.ts`
- `packages/sales/src/application/ports.ts`
- `packages/sales/src/index.ts`
- `packages/sales/src/node.ts`

### HTTP coverage

- `tests/http/backup.test.ts`
- `tests/http/migrations.test.ts`
- `tests/http/online-returns.test.ts`
- `tests/http/reporting.test.ts`
- `tests/http/restore.test.ts`
- `tests/http/returns.test.ts`
- `tests/http/system-order-returns.test.ts`

### Internal application

- `apps/internal/src/pages/BranchPage.tsx`
- `apps/internal/src/pages/CorrectionsPage.tsx`
- `apps/internal/src/pages/CouponManager.tsx`
- `apps/internal/src/pages/DeliveryAreasPage.tsx`
- `apps/internal/src/pages/ExpensesPage.tsx`
- `apps/internal/src/pages/LookupPage.tsx`
- `apps/internal/src/pages/OffersPage.tsx`
- `apps/internal/src/pages/OnlineOrdersPage.tsx`
- `apps/internal/src/pages/OpeningImportPage.tsx`
- `apps/internal/src/pages/ReceivingPage.tsx`
- `apps/internal/src/pages/ReportsPage.tsx`
- `apps/internal/src/pages/RestorePage.tsx`
- `apps/internal/src/pages/ReturnsPage.tsx`
- `apps/internal/src/pages/SalesPage.tsx`
- `apps/internal/src/pages/StaffPage.tsx`
- `apps/internal/src/pages/StorefrontSettingsPage.tsx`
- `apps/internal/src/pages/WorkspacePage.tsx`
- `apps/internal/src/returns-api.ts`
- `apps/internal/src/returns-pending.ts`
- `apps/internal/src/styles.css`

### Planning and review

- `docs/planning/phase-1-operational-updates.md`
- `docs/planning/system-improvement-gap-pass.md`
- `docs/reviews/system-improvements-2026-09-30.md`
