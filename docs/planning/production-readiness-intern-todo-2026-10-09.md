# Bravos production-readiness intern handoff — 9 October 2026

This is an execution checklist for finishing the current candidate and documenting the remaining release gates. It does not declare production readiness. Read the latest coordinator/runtime evidence before acting: completed work must be reconciled, not replayed. Write the final report at `docs/reviews/production-readiness-intern-report-2026-10-09.md` using [the report template](../reviews/production-readiness-intern-report-template.md).

Use **DONE**, **FAILED**, **BLOCKED**, or **NOT_RUN** for every task. DONE requires linked evidence on the identified source and review of its scope. FAILED means executed with a failing outcome; BLOCKED means a named dependency/resource/authorization prevents execution; NOT_RUN means execution has not occurred. Do not use percentages, convert a target test count into a passing count, or combine separate runs into one fictitious fresh pass.

## 0. Coordinate and establish the boundary first

- [ ] Contact the coordinating agent before commands, installations, source edits or service actions. `finish_verification_oct09` owns all active runtime work and may execute this checklist as the current runtime intern without transferring ownership from itself. Any other intern may only read evidence and prepare documentation while that owner is active: no duplicate tests, installs, builds, process starts/stops or source mutation. Another intern must obtain a clear transfer of runtime ownership before executing the commands below.
- [ ] Read `AGENTS.md`, `bravos.md`, `docs/planning/bravos-v1-spec.md`, `docs/planning/phase-1-operational-updates.md`, `docs/architecture/principles.md`, `docs/planning/implementation-progress.md`, `docs/reviews/production-readiness-2026-10-07.md`, and `docs/reviews/candidate-file-inventory-2026-10-09.md`. Read `docs/development/continuous-integration.md`, `storefront-performance.md`, `release-rehearsal.md`, `operator-handover.md`, and `backups/archive-v1.md` / `backups/restore.md` before the affected task.
- [ ] Record root HEAD, candidate diff/untracked paths, tool/runtime versions, source register, evidence directory and owned process/database boundaries. Baseline HEAD at dispatch: `741fdf84ae7dd4e92a806b97674ba7e8835c3c08`. Current runtime workspace: `.scratch/product-ux-review-20261005/runtime`; runtime logs: its `.local/`. The reported prepatch register matches 572 root/runtime source files; count and hashes must be checked again after the security refresh. A source register is not a changed-file count.
- [ ] Read the runtime's latest status rather than taking this snapshot as final: main has reviewed the Next 16.3.8 security source patch and Node 22.23.3/pnpm 10.34.5 pins. Fresh full/production audits and pure script tests were reported as zero advisories and 14 passing cases; frozen-install/static/build/browser gates were pending at dispatch. These reported results need their exact logs and source boundary in the final report.
- [ ] Preserve the incomplete-install HTTP attempt. `runtime/.local/review-http-full-security-final-20261009.log` records 28 collection-failed files, three passing files and 12 passing tests in 65.76 seconds, with missing `better-auth` after an interrupted frozen install. Classify this as an installation/harness failure, not an application verdict, nor a passing full suite. Retain earlier actual application failures and repairs separately.

### Authorized scope and nonnegotiable preservation

The current task finishes bounded security, POS/storefront usability, synchronization/session, optional trusted-clock composition, Windows private-recovery ACL/environment and regression evidence work. Report a newly demonstrated backend/business blocker to main before fixing it. Do not redesign internal screens, change roles/schema/order/stock/pricing/recovery policy, weaken tests, invent customer/stock/cost data, or silently resolve the unanswered opening-CSV purchases-recognition question. That question remains with the owner; existing behavior stays unchanged.

Keep features' domain/application/ports/adapters and public `index.ts` / `node.ts` entry points. Compose API dependencies in `apps/api/src/app.ts`; use contracts/errors at the boundary. No interfeature direct table access or inward-dependency violations. Reuse existing storefront tokens/CSS modules and internal semantic styles. Preserve Phase 1 branch stock, one-branch basket fulfillment, confirmation recognition, reversal/inspection, inventory-first actual variant pairs, original FIFO cost, receiving-branch returns, 14-day policy, cash/manual-online/split allocations, discounts and durable completed offline facts.

Protected unrelated file: `docs/reviews/bravos-v1-grok-review.md`, SHA-256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Exclude and preserve it. Also exclude existing raw `arabic font/`, `english font/`, untracked `packages/report-export/assets/NotoSansArabic-Regular.ttf`, `Claude outputs/`, `.pnpm-store/`, `apps/api/.local/`, scratch logs/captures, generated builds, databases, credentials and temporary files from the candidate. Do not delete pre-existing files. No staging, commit, push, repository-setting changes, deployment, domain/hosting purchase or public-ordering switch is authorized by this handoff.

## 1. Finish locked installation before testing or building

Dependency order: ownership transfer → source/runtime identity → frozen install exit 0 → dependency/API import/version preflight → tests/static/build. No downstream verdict is valid if this sequence is incomplete.

The Windows portable Node is `.local/tools/node-v22.23.3-win-x64/node.exe`; pnpm entry point is `.local/tools/node_modules/pnpm/bin/pnpm.cjs`. Use the root absolute tools even while working in the isolated runtime. `scripts/pinned-env.ts` must keep child processes on the same Node. In the code below `$bravosRoot` is the root workspace and `$bravosWork` is the coordinator-approved isolated runtime. Save stdout/stderr and exit status per command; these blocks are instructions, not results.

```powershell
$bravosRoot = 'C:\Users\Yousif Mansi\Desktop\bravos system'
$bravosWork = Join-Path $bravosRoot '.scratch/product-ux-review-20261005/runtime'
$bravosNode = Join-Path $bravosRoot '.local/tools/node-v22.23.3-win-x64/node.exe'
$bravosPnpm = Join-Path $bravosRoot '.local/tools/node_modules/pnpm/bin/pnpm.cjs'
Set-Location -LiteralPath $bravosWork
& $bravosNode --version
& $bravosNode $bravosPnpm --version
& $bravosNode $bravosPnpm install --frozen-lockfile --store-dir (Join-Path $bravosRoot '.pnpm-store')
```

- [ ] Require version output `v22.23.3` and `10.34.5`; record the portable Node executable checksum and its verification provenance. Verify `.github/workflows/ci.yml`, root engines/packageManager and installed tools agree.
- [ ] Finish frozen installs in both approved root and isolated workspace, with separate logs. The snippet above is **isolated-only**: its existing store is root `.pnpm-store` (recorded effective `storeDir` ends in `.pnpm-store/v10`). Root uses the existing `C:\Users\Yousif Mansi\AppData\Local\pnpm\store\v10` store recorded in root `node_modules/.modules.yaml`. For root, `Set-Location -LiteralPath $bravosRoot`, then run `& $bravosNode $bravosPnpm install --frozen-lockfile` without the isolated `--store-dir` override. Confirm each workspace's recorded store matches its prior metadata; preserve those distinct stores and do not copy the isolated install command unchanged to root. Do not repeat an already-proven install without reason. Accept only exit 0. Check no lock/manifests changed during install.
- [ ] If exact Next package-body downloads stall, retain failure/status and coordinate the existing exact-tarball prefetch. Verify each fetched tarball against its locked SHA-512 integrity. Do not broad-update dependencies, rewrite the lock, destructively purge the store/node_modules, ignore required optional dependencies/scripts, or delete user material to bypass the failure.
- [ ] Run expected package and API import preflight after successful install. Resolve `better-auth`, `fastify`, `sharp`, `next`, `@next/env`, the Windows SWC package and root `@bravos/inventory` in their owning workspaces; import `apps/api/src/app.ts` without starting a service. Read installed versions, not only manifests. Example read-only preflight commands:

```powershell
& $bravosNode $bravosPnpm --filter @bravos/api exec node --input-type=module -e 'for (const name of ["better-auth", "fastify", "sharp"]) console.log(name, import.meta.resolve(name));'
& $bravosNode $bravosPnpm --filter @bravos/storefront exec node --input-type=module -e 'import { createRequire } from "node:module"; const req = createRequire(import.meta.resolve("next/package.json")); for (const name of ["next", "@next/env", "@next/swc-win32-x64-msvc"]) console.log(name, req.resolve(name));'
& $bravosNode $bravosPnpm exec node --input-type=module -e 'console.log("@bravos/inventory", import.meta.resolve("@bravos/inventory"));'
& $bravosNode $bravosPnpm exec tsx -e 'import("./apps/api/src/app.ts").then(() => console.log("API import OK"))'
```

- [ ] Stop if import/resolution fails; diagnose installation before tests. For a Linux runner use its locked platform SWC package instead of the Windows package. Record resolved paths and installed Next 16.3.8 / matching env/SWC, Fastify 5.12.5, Sharp 0.35.5, native library versions, and any version deviation.
- [ ] Match postinstall root/runtime source hashes before further runs. Main-reviewed dispatch identities: root `package.json` `98F65E0D183BF63235BDD1208436194367BCEE27D44D441EA167DC95E2765887`; `pnpm-lock.yaml` `76AF25D6D72588F1DE04E894CE859FD5C69C0D3349AF46C41B64F42FD9000526`; `apps/storefront/package.json` `DF89A39A6F05DC2E1B299831E4A6468DAB1BDD4C1356AC05EF3D22A17BEE0138`. If changed, obtain review and a new source register rather than reuse old evidence.

## 2. Complete engineering gates on the frozen source

After section 1, run only missing gates or gates invalidated by changes/failures. Run sequentially on this shared machine. The command table names exact repository scripts; prepend `& $bravosNode $bravosPnpm` in PowerShell wherever it says `pnpm`, and `& $bravosNode` wherever it says `node`.

| Task | Exact command | Acceptance/evidence |
| --- | --- | --- |
| Full registry advisory snapshot | `pnpm audit --json` | Exit/counts/raw JSON/timestamp; no ignored findings. |
| Production advisory snapshot | `pnpm audit --prod --json` and `pnpm audit --prod --audit-level=moderate` | Distinguish full vs production scope; fail registry errors and moderate-or-higher advisories. No audit `--fix` or ignores. |
| Types | `pnpm typecheck` | All selected workspace projects, exit 0. |
| Import boundaries/cycles | `pnpm check:architecture` | dependency-cruiser and private-import checker both pass; actual module/dependency/file counts. |
| Script syntax | `node --check scripts/measure-storefront-performance.mjs` | Exit 0; no service launched. |
| Pure script tests | `node --test tests/scripts/storefront-performance.test.mjs tests/scripts/check-bundles.test.mjs` | Actual counts; dispatch expectation 14, not an assumed result. |
| 35-migration isolated probe | `pnpm migrate:scratch` | `scripts/scratch-migrate.ts`: 001–035 apply, 014–035 down/reapply, full down-to-empty/reapply, deliberate failing-migration atomic rollback. Own scratch PostgreSQL port 55434; clean only owned resources. |
| Full real-PostgreSQL HTTP suite | `pnpm test:http` | All `tests/http/**/*.test.ts` via `vitest.config.ts`, no file parallelism. Expected selection 246, verify actual collected/pass/fail/skip counts and collection failures. Includes migration, branch migration and release paths. |
| API/internal/storefront and bundle split | `pnpm build` | All three builds and `scripts/check-bundles.mjs` pass. Include actual bundle counts. CSS preload metadata exemption must not permit genuine eager optional-feature imports. |

- [ ] Record the initially failed full HTTP runs, their root causes, approved changed files and affected red/green results. Preserve clock defaults (`SQL now()`), stored canonical replay time, Cairo boundaries, once-only stock/reporting and current-user-only recovery ACL/failure closure. Windows ACL execution is distinct from a Linux CI plan.
- [ ] Use real PostgreSQL testkit fixtures, not mocked transaction acceptance. Do not run migrations, bootstrap, imports, restores, receiving, stock adjustments, sales or orders against the normal preview database.
- [ ] Check `.github/workflows/ci.yml` candidate against `docs/development/continuous-integration.md`: static/build precedes HTTP/browser, pinned actions and runtime, frozen installs, no secret/deploy/write privileges, all failures propagate. A local workflow file or Windows pass does not prove a hosted Ubuntu CI run. Hosted CI remains NOT_RUN/BLOCKED until publication/execution is separately authorized.

## 3. Run the bounded browser acceptance gates

Only the runtime owner may start the Playwright stack. `playwright.config.ts` uses fresh API `http://127.0.0.1:3011/api/public/health`, internal 5174, storefront 3001, one worker, Arabic locale, random `.local/e2e-control-*.json`, `reuseExistingServer: false`, and `scripts/e2e-teardown.ts`. `scripts/e2e-stack.ts` owns a fresh isolated `bravos_e2e` database/media/recovery fixture. Never attach browser transaction tests to API 3010/internal 5173/storefront 3000. Confirm `BRAVOS_API_ORIGIN` is 3011 in browser servers; no ordinary data writes, including visit/product-view analytics.

```powershell
$bravosPublicFiles = @(
  'tests/browser/catalog-media.spec.ts',
  'tests/browser/checkout-recovery.spec.ts',
  'tests/browser/checkout.spec.ts',
  'tests/browser/product-readiness-journey.spec.ts',
  'tests/browser/storefront-commerce.spec.ts',
  'tests/browser/storefront-evolution.spec.ts',
  'tests/browser/storefront-experience.spec.ts',
  'tests/browser/storefront-gallery-cart.spec.ts',
  'tests/browser/storefront-integration.spec.ts',
  'tests/browser/storefront-journey-analytics.spec.ts',
  'tests/browser/storefront-keyboard.spec.ts',
  'tests/browser/storefront-product-ux.spec.ts',
  'tests/browser/storefront-wall-discovery.spec.ts',
  'tests/browser/storefront.spec.ts'
)
& $bravosNode $bravosPnpm exec playwright test @bravosPublicFiles --reporter=line,json
$bravosInternalFiles = @(
  'tests/browser/session-transition.spec.ts',
  'tests/browser/sales.spec.ts',
  'tests/browser/offline-sync.spec.ts',
  'tests/browser/pos-workspace.spec.ts'
)
& $bravosNode $bravosPnpm exec playwright test @bravosInternalFiles --reporter=line,json
```

- [ ] Public collection target is 37 cases in 14 files; focused internal target is 28 cases (2 session + 11 sales + 9 offline-sync + 6 POS). Report actual collection/results, not targets. Retain failed attempts and JSON/traces. Confirm test servers use current served source/dependencies.
- [ ] Focused tests must retain same-tab and cross-tab synchronization, account generation/logout races, branch-scoped availability, immutable completed-sale employee/branch/tender/price/operation identity, duplicate-safe acknowledgements and preserved queued facts. Do not replace persisted completion polling with arbitrary sleeps or weaken assertions.
- [ ] Map coverage to the acceptance matrix below. If a regression or uncovered required scenario justifies broadening, identify the reason and run the named relevant test first. Do not blindly repeat a 60-minute full browser suite. The complete CI browser command is `pnpm test:browser --reporter=line`; complete CI includes `offline-production.spec.ts` and `production-login.spec.ts` built internal previews. Respect their launch authorization/resource boundaries and disclose unexecuted cases.
- [ ] For reporting's existing Cairo-midnight guard, record skipped cases and rerun the affected reporting scenario outside the boundary before claiming its coverage. A skip is never a pass.

### Business acceptance matrix to complete in the report

| Workflow | Required retained behavior | Existing evidence homes / follow-up |
| --- | --- | --- |
| Inventory-first/merchandising | SKU selects existing identities; only actual pairs; selected online visibility never removes POS/inventory variants; independent branch stock | HTTP `receiving`, `opening-import`, `catalog`, `branch-inventory-migration`; browser `receiving`, `catalog`, `pos-workspace`, `storefront-integration`. |
| POS pricing/tender | Automatic offer then coupon then optional employee deduction; 300/200 minus50 →275/175; zero allowed/negative rejected; cash/manual-online/split exact paid amount; no gateway fiction | HTTP `sales`, `offline-promotions`, `coupons`, `automatic-offers`, `bundles`; browser `sales`, `pos-workspace`. |
| Offline/account transitions | Persist before completion feedback; reconnect/server recovery autosync; stable operation/fingerprint; no fresh offline login; logout/update do not lose completed sales or expose another account's privileged cache | HTTP `sales-sync`, `staff-access`, `restore`; browser `session-transition`, `offline-sync`, `sales`, relevant `offline-pos`/production tests if justified. |
| Basket/order/reversal | Repeated variants aggregated; one branch fulfills whole basket; pending holds no stock/revenue; confirmation records once; shipment/delivery no repeat; reversal revenue once, stock only after receipt/inspection | HTTP `checkout`, `order-confirmation`, `order-fulfillment`, `order-protection`, `reporting-edgecases`; browser `storefront-integration`, `order-confirmation`, `order-fulfillment`. |
| Returns/refunds | Phone/reference/anonymous fallback; 14-day receipt window; paid amount suggestion without second discount; manager-edited actual refund; Owed/Paid; receiving branch restocked once with original FIFO cost and sale attribution | HTTP `returns`, `online-returns`, `system-order-returns`, `reporting-edgecases`; browser `returns`, `online-returns`. |
| Role/privacy/reporting | Ordinary staff own/authorized branch data without costs/profit; public has no internal links/data; manager attribution and retained linked corrections; Cairo periods and original/reversal reporting | HTTP `staff-access`, `catalog`, `expenses`, `corrections`, `reporting`, `reporting-edgecases`; browser `staff-access`, `expenses`, `reporting`. |
| Backup/restore/recovery | Protected data archive includes branch/payment/reference facts; incompatible old archives fail; image references are not image restoration; newer/queued sales reconciled; private owner-recovery ACL | HTTP `backup`, `restore`, `staff-access`, `release-paths`; browser `backup`, `restore`. Real operational drill remains separate. |

Names above are basenames under `tests/http/*.test.ts` and `tests/browser/*.spec.ts`. Map existing current evidence first; do not run every named file again by default.

## 4. Review current visuals, accessibility and media/privacy

- [ ] Capture identified current-source home/discovery, stocked and sparse/unavailable product variants, populated/repaired cart, checkout validation/retry/acknowledgement, and populated staff POS/branch/tender states using isolated data. Store captures/logs in ignored scratch paths and index them in the report. Mark dev vs production, viewport, route, fixture, timestamp and source. Submit screenshots to main for actual review; capture generation alone is not acceptance.
- [ ] Check SF-12 widths 320/390/768/1024/1440px, Arabic RTL/mixed Latin/numbers/long text, horizontal overflow, clipped labels, sticky-bar/keyboard field obstruction, gallery/cart/checkout focus, visible state and ≥44px touch targets. Review the 768px address-focus guard and purchase-bar gallery obstruction against the retained failing chronology.
- [ ] Verify keyboard skip/navigation/filter/gallery/variants/cart/checkout order, no traps, focus visible and unobscured; reduced motion leaves visible usable content; error/loading/success announcements; 4.5:1 normal-text and 3:1 large-text/meaningful-control contrast. Record tool/method/limitations. True 200% browser zoom and screen-reader checks need actual supported tools; viewport emulation or CSS scaling is not zoom.
- [ ] Check empty/not-found, slow/failed requests, missing/revoked images, blocked storage, ordering disabled and lost submission response. Preserve cart and all eight in-memory customer draft fields on repair/navigation; clear that draft after success. The eight-field memory draft must introduce **no new persistent customer-data storage**. Preserve the existing durable uncertain-response recovery attempt exactly: `apps/storefront/app/checkout/page.tsx` already stores its versioned pending/accepted request (including customer name, phone and address) through `writeAttempt` in localStorage. Inspect its existing `readAttempt` / `parseAttempt` / `validRequest` and operation-scoped `removePendingAttempt` recovery/cleanup behavior; do not remove those customer request fields or alter cleanup policy to satisfy a blanket storage prohibition. Verify recovery survives reload without duplicate orders, and no customer PII leaks into URLs, logs or analytics. Retry must not silently lose lines.
- [ ] Verify direct public media revocation after Hidden/removal in isolated fixtures and no persistent Next optimizer/CDN/service-worker bypass; public responses/bundles/caches lack costs/profit/internal data. Reuse `catalog-media.spec.ts`, `tests/http/catalog.test.ts` and bundle guards; report actual coverage versus future hosted CDN checks.

## 5. Keep SF-11 blocked until permitted production resources exist

Historical hidden `next start` was rejected by automatic approval review: **`rejected: blocked by policy`**. Do not relaunch it, create an alternate launcher/port, or use CI/rehearsal tooling as a workaround. Mark SF-11 BLOCKED with the authorization/resource owner. `scripts/measure-storefront-performance.mjs` is attach-only to an already-running permitted isolated production server; it never starts/builds/seeds one. Development timings and pure script passes cannot close SF-11.

- [ ] If permitted running baseline `15fd366` and final production servers are supplied, follow `docs/development/storefront-performance.md` exactly. Supply same approved catalog/stock/media fixture, origin-specific anonymous guest-cart state, product ID, source/build labels, photo provenance/kind, hero note and `--attest-isolated-production`; use a new direct `.scratch` output directory. Do not enter customer data or transact. Even visits/views write analytics, so an ordinary backend is prohibited.
- [ ] Record each full 24-sample matrix: four routes × two viewports × three cold runs, same hardware/browser/throttling, raw LCP/CLS/JS/image bytes/request counts/errors and group medians. Disclose final hero's unequal workload; inspect interaction traces and decorative-motion long tasks separately. Proposed CLS ≤0.1 and phone median LCP ≤2500ms do not imply field p75/INP or automatic signoff. Missing representative approved photography or partial samples keep acceptance open.

## 6. External release gates: assign owners, do not fabricate completion

| Gate | Required next action / owner | Completion evidence |
| --- | --- | --- |
| Real content/brand/fonts | Owner supplies and reviews representative Arabic catalog, prices/branch batches/costs, photos, font roles, delivery/contact details and staff grants | Dated explicit owner approval and source/provenance; limited two-product preview is insufficient. |
| Physical hardware | Shop staff + engineering test actual iPhone/iPad Safari, Android Chrome and shop desktop/tablet | Device/OS/browser versions; touch/native pickers/safe areas/mobile keyboard/offline restart/reconnect result. Emulation does not satisfy. |
| Accessibility tools | Qualified tester + main review true 200% zoom/screen reader/reduced motion/contrast | Browser/assistive-tool versions, method and findings; assign unresolved issues. |
| Hosted operation | Owner chooses hosting/domain only at approved completion point; operator prepares trusted TLS/proxy/secure cookies, supervised services, durable PostgreSQL/media, monitoring/log retention | Permitted hosted verification and restart/persistence proofs. No purchase/deploy now. |
| Recovery/training | Named operator + manager verify external database backup and separate media copy, restore/owner-recovery/queued-sale drill, staff procedures | Isolated drill results and training/signatures using `operator-handover.md` and backup/release guides. Written guides alone do not count. |
| Internal-first pilot/public launch | Owner/manager/staff reconcile opening data and tills, approve internal pilot, then separately approve public ordering | Pilot issues resolved, queue/stock reconciliation and dated authorization; do not toggle ordering now. |
| Opening CSV purchases classification | Owner answers existing question about opening value entering import-period purchases | Leave current code unchanged until explicit answer; report unanswered decision. |

## 7. Preserve normal development, document and close for main review

- [ ] Runtime owner cleans only its identified temporary processes/control files/clusters. Never stop unrelated services or recursively delete a computed unverified path. Record ownership, cleanup outcome and residual resources.
- [ ] Restore healthy ordinary development URLs through the authorized existing workflow after isolated tests: API `http://127.0.0.1:3010/api/public/health`, staff `http://127.0.0.1:5173`, storefront `http://127.0.0.1:3000`. Use read-only health/route proof and avoid analytics-producing public visits against ordinary data; identify method and any effects honestly.
- [ ] Compare read-only before/after ordinary database proof: two products, two variants, two batches, four sales, zero orders; Abshway remaining balances 25 and 29; active Fayoum delivery fee 5,000 piasters. These are preview-preservation facts, not launch data approval. Include migration/other configuration baseline if present in the proof. Any deviation requires explanation and main disposition, never a silent reset.
- [ ] Refresh source register, `git diff --check`, `git status --short`, `git diff --cached --name-only`, and protected-file SHA-256. Require empty index and unchanged unrelated review. Preserve all exclusions in place. Update exact candidate inventory/counts/reasons without confusing unchanged source-register files with changed files.
- [ ] Prepare dated appendices for `docs/reviews/production-readiness-2026-10-07.md`, `docs/reviews/dependency-security-2026-10-07.md`, `docs/planning/tickets/storefront/SF-12.md` and `docs/planning/bravos-storefront-roadmap.md` only from actual evidence and after main review. Keep their historical failure dates/results. Keep SF-11, representative content, hardware, hosting, recovery and pilot gates open where incomplete. Do not rewrite history or stale subjective percentages into current acceptance.
- [ ] Complete `docs/reviews/production-readiness-intern-report-2026-10-09.md`: all command timestamps/runtime/source hashes/exits/counts/skips; initial failures/repairs; screenshots/main comments; security versions; data/index/protected-file preservation; changed-file reasons; external blockers and owners. Main reviews final diff, evidence and screenshots before accepting a bounded engineering candidate. Deliver that report and checklist even if external gates remain blocked. Record the proposed exact commit boundary, then obtain the user's approval after main's report/diff review; do not stage/commit/push in advance. Deployment requires separate explicit authorization.
