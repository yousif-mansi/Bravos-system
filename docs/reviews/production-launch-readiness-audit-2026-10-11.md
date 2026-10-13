# Bravos production launch readiness audit — 11 October 2026

**Subsequent checkpoint, 13 October 2026:** this audit retains its original point-in-time findings. The demonstrated production configuration weakness was corrected and independently verified in [the configuration-guard review](production-config-guard-2026-10-13.md). See [the current remaining-work plan](../planning/remaining-work-2026-10-13.md) for later header/checkout acceptance and publication status. The pending production/content/device/operator/hosting/recovery gates are not waived.

## Executive readiness summary

**Recommendation: NO-GO for production launch, including internal production reliance.** The published candidate is ready for human integration review and planning a separately authorized isolated production rehearsal. It is not yet a verified hosted release.

The latest complete Linux CI is green at the exact PR #43 candidate, `f7507e20f5162987644f424d5a61865828a27e41`: **162 browser tests passed; 247 HTTP integration tests passed with one explicitly Windows-only skip; static, architecture, pure-script, build and production dependency audit jobs passed.** No new blocking implementation defect was demonstrated by this bounded source audit. Green CI does not prove real-device offline behavior, production runtime, secure hosting, restore/rollback operability, representative storefront performance or staff acceptance.

Eight GitHub issues remain open. #37, #39 and #40 have implemented and verified software awaiting reviewed integration. #33, #41, #42 and umbrella #1 still have mandatory acceptance work. #38 is an optional content-dependent enhancement and need not block commerce launch.

The historical storefront launch rejection occurred **before execution**, with the recorded reason `rejected: blocked by policy`. Its exact policy trigger is unknown. It is not demonstrated evidence of an application startup defect. Production runtime/visual/performance evidence remains missing; the refusal must not be bypassed.

Priority now is release evidence and operational preparation, not redesign or further feature expansion. No production secrets or business data were inspected or altered. No tests, services, migrations, merges, deployments, issue changes, commits or pushes were performed for this audit. The sole new workspace artifact is this report; the index remains empty.

## Verified current state and evidence boundaries

Live GitHub and Git queries were refreshed on **2026-10-11 at 05:22 UTC / 08:22 Cairo**, with a subsequent read-only protection/ruleset check. This is a point-in-time assessment, not a future status guarantee.

| Item | Verified state |
| --- | --- |
| Repository | `yousif-mansi/Bravos-system` |
| Local branch and remote candidate | `codex/readiness-issue-reconciliation`, both `f7507e20f5162987644f424d5a61865828a27e41` |
| Local main and remote main | Both `741fdf84ae7dd4e92a806b97674ba7e8835c3c08`; candidate not integrated |
| [PR #43](https://github.com/yousif-mansi/Bravos-system/pull/43) | OPEN, non-draft, MERGEABLE, merge state CLEAN, no merge timestamp, no submitted human reviews; review requested from `AhmedHarera` |
| Candidate scope against main | Ten commits; 132 files; 10,123 insertions / 831 deletions. Includes application, reporting, contracts, dependencies, test harness, tests and documentation changes. The PR is not merely a test repair. |
| Final commit | `f7507e2` changes the delayed-logout acceptance test and two review/planning documents. Its final test-only scope does not describe the entire PR. |
| [Latest CI run 38104919322](https://github.com/yousif-mansi/Bravos-system/actions/runs/38104919322) | Completed SUCCESS at exact candidate; all three required-by-procedure jobs successful; browser job completed 02:39:25 UTC |
| CodeRabbit status | SUCCESS status context, not human approval or evidence that production gates are passed |
| Branch safeguards | GitHub protection endpoint returns `Branch not protected`; repository rulesets endpoint returns `[]`. Current approval/check requirements are procedural, not enforced by these GitHub controls. |
| Working tree | Preexisting modified protected review and untracked local stores/assets remain. No unrelated workspace dirt is included in the published candidate by this audit. |
| Protected review | `docs/reviews/bravos-v1-grok-review.md` SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A` |

### Gate provenance

| Gate | Evidence actually available | What it does not establish |
| --- | --- | --- |
| Linux browser | Fresh matching run: **162/162 Chromium passed**, 14.4 minutes; complete raw log retained in `.scratch/grok-production-20261010/linux-browser-f7507e2.log` | Safari, Android hardware, actual browser zoom, screen-reader speech, hosted production or representative brand quality |
| Linux HTTP/PostgreSQL | Fresh matching run: **32 files; 247 passed / one skipped of 248**. Platform-specific Windows PowerShell-path test at `tests/http/staff-access.test.ts:386` is intentionally skipped on Linux. | Actual host configuration, permissions, deployed schema, backup retrieval or real restore drill |
| Static/build/script | Fresh matching CI: pinned Node **22.23.3**, pnpm **10.34.5**, frozen install, all-workspace typecheck, import/dependency boundaries, script syntax and pure tests, all three builds and bundle separation | Production service startup or production performance |
| Dependency audit | Current CI runs `pnpm audit --prod --audit-level=moderate` successfully. Retained local final-coherence full and production JSON audits report zero advisories at unchanged dependencies. | A comprehensive security review; CI's threshold alone does not prove there were no low or development-only advisories. Advisories can change after this snapshot. |
| Windows full gates | Retained `final-coherence-final/results.json` at **c63f1d6**: browser 162, typecheck, architecture, 24 pure tests, scratch migrations 001–035, builds and audits passed. HTTP 248/248 was reused from **6e67b0c**, guarded by unchanged relevant source. | A fresh Windows 248-test run at f7507e2; historical reused evidence must retain its source identity. |
| Migration behavior | Matching HTTP migration tests **9 passed**; retained scratch apply of 001–035 and partial 035–014 down/reapply | Permission to run down migrations on business data, target-host migration duration or a deployed rollback procedure |
| Production runtime | Historical Ticket 28 loopback rehearsal exists; current production builds pass | A current f7507e2/schema-035 production startup, hosting configuration or performance acceptance |

Historical red runs and separated reruns remain historical. In particular, c63f1d6 Linux had 161 passed / one failed; it is superseded for the candidate by the fresh matching f7507e2 162-pass run, not retrospectively relabeled. Earlier October 9 mixed runs do not substitute for this final result. Dated pending fields in the October 10 execution snapshot are historical; live PR checks provide the latest outcome.

The governing requirements are the approved v1 spec plus later explicit updates. [Phase 1 operational updates](../planning/phase-1-operational-updates.md) supersede central-stock/cash-only/delivered-recognition wording: branch inventories, manual online/split tender, single-branch whole-order fulfillment, confirmation recognition and cancellation reversal, and receiving-branch return stock. Opening CSV stock is separately reported, without changing retained dates, FIFO costs or audit history. Dark storefront direction and optional storytelling also supersede earlier art-direction wording.

## Production startup root-cause analysis

### Confirmed findings

| Record | What it proves |
| --- | --- |
| `.scratch/storefront-evolution-verification/preview-launch-rejection.md:3` | September 30 successful build followed by two production Next launch attempts refused before execution. Hidden `Start-Process` and foreground pnpm methods both recorded `rejected: blocked by policy`; no PID/owner file created; no further rationale supplied. Intended loopback storefront port 3000 / isolated API 3012. |
| `.scratch/storefront-evolution-verification/production-retry-2026-09-30.md:3` | Renewed authorization at dacf3c7 still produced a pre-execution refusal. A subsequent combined listener/read-only API/evidence-write command was separately refused with the same message. Historical last-seen isolated service identities are not current runtime proof. |
| `.scratch/storefront-production-visual-20261002/verification.md:3` | October 2 renewed, bounded production/demo launch again received a CreateProcess/tool rejection before execution. No successful production startup or capture followed. |
| Same October 2 record, line 9 | An older build rewrote public API requests to 3011. Rebuilding for 3012 passed. This was a separate build-target mismatch, not evidence that the approval refusal was caused or repaired by that mismatch. |
| [Tracked production visual review](storefront-production-visual-review.md) | Production captures/measurements remain unexecuted. Development screenshots and timings are distinctly recorded, not production sign-off. |
| [Execution plan](../planning/production-readiness-execution-2026-10-10.md), line 48 | Existing restriction prohibits retry through alternate launchers, hosts, ports, CI or a rehearsal workaround. |

**Confirmed proximate cause:** the command-execution approval boundary prevented process creation. **Exact root policy rule: undetermined.** The original approval decision payload, rule identifier and full rationale were not found in the bounded saved workspace records. The surviving reports are contemporaneous records of the returned refusal, not the original complete decision transcript.

### Unproven hypotheses and separate incidents

Hidden/background processes, a particular port, production mode, credentials, environment variables or an application defect might be suggested as explanations, but none is supported as the policy trigger. There is no recorded Next runtime exception from those refused attempts because execution did not begin.

The ordinary DEV API's later empty inherited `BRAVOS_LOOPBACK_REHEARSAL` flag caused strict configuration validation **after execution**. A local helper correction removed the inherited empty variable; this is a separate incident. It cannot explain or clear the earlier production Next pre-execution refusal.

Historical commands using Node 22.13.1 are not current launch instructions: the repository now pins Node 22.23.3. Runtime pin correction is necessary for a future permitted attempt, but is not a verified cause of the approval refusal.

### Required resolution and acceptance

1. Retrieve the existing original tool-call/approval outputs if available, with command, timestamp, execution context and visible decision; do not extract secrets or private model reasoning.
2. Have the approval/resource owner identify the specific refusal condition and establish an explicitly permitted execution path. If the original decision cannot be retrieved, record the cause as unknown and the new permission and scope separately.
3. Only after explicit authorization, freeze source/build/lockfile and named isolated database/media/ports. Verify current ownership and artifact API rewrites. Do not blindly rerun historical commands against ordinary port 3000 or live business data.
4. Obtain current production process readiness, runtime logs, screenshots and measurements on that authorized target. The existing measurement script attaches to an already-running permitted isolated production server; it does not authorize or launch one.

Acceptance is a successful, provenance-recorded production run and complete required captures, with the authorization recorded. A build pass or an alternative launcher is insufficient. This audit did not retry startup.

## Architecture, security and operational assessment

Four Sol 6.1 read-only audits covered standards/security, specification/issues, operations and startup forensics. Standards and Spec findings remain separate below. No preference refactor or new feature is recommended.

## Standards

Feature ownership remains intact in the reviewed opening-stock reporting path: `OpeningImportReportingReader` is declared in the reporting port and wired in `apps/api/src/app.ts:542`; the opening-import adapter uses bounded parameterized reads of accepted import manifests. Reporting manager authorization and separate opening-stock totals remain in place. Logout generation/revision checks and IndexedDB transactional compare-and-set preserve another account's session and durable sales. Cashier catalog enrichment uses an explicit safe projection without purchase cost/batch fields. Unexpected-operation diagnostics retain a generic response and log generated request ID/static route template, not customer bodies or raw exceptions. Recovery ACL enforcement remains intact. No hard architecture-standard violation or demonstrated blocking candidate defect was found in these inspected paths. This bounded review is not an exhaustive penetration test.

## Spec

The candidate follows the superseding branch/tender/confirmation/return rules rather than historical central-stock wording. Opening-stock separation is explicitly authorized and has real-database/export coverage. Commerce, cart and checkout preserve existing variant IDs, quantity checks, authoritative quotes and duplicate-safe recovery. Missing real-device, representative performance and operator evidence are unresolved acceptance gates, not silently missing implementation. Optional factual chapters remain omitted when facts are unavailable. No demonstrated wrong business behavior or unauthorized scope expansion requiring a fix was found in the reviewed diff. Automated traceability anchors do not establish that every possible policy edge is exhaustively tested.

## Controls and remaining proof

| Area | Confirmed implementation | Remaining production acceptance |
| --- | --- | --- |
| Configuration | Production skips local dev env loading; API binds loopback. Production cookies are secure except tightly restricted loopback rehearsal. Public ordering defaults closed. External media/recovery paths required. | Choose real hosting topology, exact HTTPS origins and routing; unset rehearsal exception; provision strong secrets privately; verify environment under service account. Rehearsal example is not hosted config. |
| Auth and permissions | Signup/reset/admin bypass routes disabled; personal accounts and feature permissions; 12-hour sessions, HttpOnly/Lax/secure cookies. Matching staff-access/privacy tests pass. | Real TLS login/logout, role/branch restrictions, public/staff isolation, recovery custody and revocation/reconnect on actual host/device. No production secrets were read. |
| Configuration weakness | `apps/api/src/config.ts:45` requires only nonempty auth secret; origins at lines 21–23 default to HTTP loopback. Installed Better Auth 1.7.3 rejects its production default secret, but only warns for short/low-entropy secrets and accepts HTTP URL schemes. | Mandatory deploy preflight verifies cryptographically generated secret and explicit HTTPS origins. Minimal prospective hardening: fail-fast production validation for short/placeholder secrets and non-HTTPS origins outside the existing explicit rehearsal exception, with isolated config tests. Do not claim length checks prove entropy or silently rotate existing secrets. This baseline weakness is demonstrated in source; no deployed weak secret is demonstrated. |
| Proxy and rate limits | Forwarded client headers are replaced using connection `request.ip`; no `trustProxy`. Tests enforce three sign-in attempts per ten seconds per connection address. | Behind a reverse proxy, clients share its address and sign-in bucket. Choose/test the real topology; if per-client attribution needs a patch, restrict trust to that known proxy and test spoof rejection. Do not broadly trust X-Forwarded-For. |
| Deployment | API build, internal static build and Next build pass. Vite dev/preview API proxy exists; Next public rewrite target is selected during build. | Real service manager, internal static `/api` reverse proxy, correct build-time public API target, restart/crash/graceful-stop proof, durable paths and inaccessible private recovery/media internals. Loopback API needs a compatible same-host proxy; container topology is not automatically supplied. |
| Migrations | Shared advisory lock, prefix/history drift detection, per-file transaction and bookkeeping. API startup applies pending migrations. Release interface is status/apply only. | Verify named target identity/history, privileges including restore's staging-database creation/maintenance access, backup before first API start or apply, lock/duration on representative data. No SQL-content checksum or entire-release transaction is claimed. 030 refuses populated central inventory; use a fresh explicitly approved target, not inferred branch allocation. |
| Backup | Read-only consistent snapshot; scrypt/AES-GCM encryption; schema/table validation; tested archive download. Data archive excludes credentials/sessions/recovery tokens, image binaries and unsent browser queues. | Verify off-browser archive storage/password custody and separate image copy. Define backup interval, retention, off-host storage and recovery objectives with owner. Account for 128 MiB plaintext /192 MiB complete archive limits and process memory. |
| Restore/recovery | Current schema 035; only named 034→035 compatibility bridge; constrained staging, preview, fingerprint recheck, pause/till checks, activation and fresh-target owner recovery tested. | Actual drill under chosen service account and host: archive validation, media recovery, owner recovery/reset, active tills and eligible queued-sale recovery exactly once. Preserve unsupported retained records for manager resolution. Historical central-stock archives cannot be made compatible by header edits. |
| Rollback | Failed activation rolls back business table mutations. Application restore preserves live-only facts and blocks conflicting stable keys. | A merge checkpoint cannot undo an activation. Release migrations have no rollback command and commit per file. PostgreSQL sequence changes are nontransactional; no exact sequence rollback claim. Establish verified external PostgreSQL backup restoration to a named isolated/fresh target, compatible binary/schema decision, media recovery, queue reconciliation and switchover authorization. Never use scratch down commands on business data. |
| Observability | Liveness endpoint, bounded unexpected-operation diagnostics and graceful shutdown are implemented/tested. Fastify request logging disabled. | Health 200 does not prove database/media/commerce readiness. Configure concrete availability/database/media/disk/recovery-permission/backup-age checks, retained service/proxy logs, alert destinations and primary/backup incident owners. Diagnostics do not cover every parser/auth/framework path. |
| Data integrity and pilot | Software covers branch balances, FIFO, late/offline sale preservation, confirmation/reversals, returns/refunds, opening-stock reporting and duplicate-safe processing. | Reconcile actual opening stock by variant and branch, batches/costs, staff grants, delivery fees and operational configuration; run signed real staff pilot. Existing ordinary preview is test data, not verified launch inventory. |
| Performance/accessibility | Direct image revocation rules, reserved dimensions, font declarations, reduced-motion/keyboard/geometry and selected solid-surface contrast tests. | Next images are deliberately unoptimized to preserve media access behavior: prepare appropriately sized source images. Measure representative production, interaction long tasks and full manual contrast. Actual Safari/Android, native keyboard/safe-area, screen-reader speech and true 200% browser zoom are missing. |

No confirmed deployed exploit, lost-sale incident or broken current production database was established. There is no inspected production deployment to certify. Deployment and recovery gaps are hard launch risks even without a new application defect.

## Open-issue acceptance matrix

Criterion numbers below follow each current GitHub issue body's ordered acceptance list. Later approved scope controls interpretation. Evidence links refer to repository source at f7507e2; tests cited passed in the matching Linux suite unless a narrower/historical boundary is stated.

| Issue / present status | Criteria mapped to evidence | Remaining action, owner and release treatment |
| --- | --- | --- |
| [#1 — BRAVOS v1 delivery](https://github.com/yousif-mansi/Bravos-system/issues/1), ready-for-human | A01–A36 have automated traceability across staff access/privacy, catalog, FIFO/sales, offers/coupons, orders, synchronization, corrections, returns, expenses, reporting/exports, backup/restore, import and areas. Physical A33 remains explicitly required by `bravos-v1-spec.md:385`. Later branch/tender rules at `phase-1-operational-updates.md:9`; opening-stock classification/regression at `packages/reporting/src/application/reporting.ts:123` and `tests/http/opening-stock-reporting.test.ts:59`. These are coverage anchors, not exhaustive acceptance certification. | Keep open until reviewed integration, technical host acceptance, real data, recovery/rollback drill, devices, content/performance and signed internal pilot plus separate public approval. Owner/operator/main reviewer. P0 safety and P1 public acceptance gates. |
| [#33 — SF-03 homepage story](https://github.com/yousif-mansi/Bravos-system/issues/33), ready-for-human | C1/C3: supplied cover, separated caption/CTA and real category links in `home-introduction.tsx:16`. C2/C4: reserved 2048×774 image, priority and sizes at line 17; later full-cover decisions supersede historic crop rules. C5: filtered views omit arrival in `app/page.tsx:26`; collection controls remain. C6: one image; no carousel/video/countdown. C7: richer optional story content absent; representative imagery/brand acceptance not demonstrated. Evolution and five-width experience tests provide development evidence. | Owner supplies representative approved merchandise/photos/copy; main conducts final production brand review. Preserve approved dark direction; optional campaigns need no empty replacement. P1 public gate; not an automatic hero redesign. |
| [#37 — SF-07 persistent commerce](https://github.com/yousif-mansi/Bravos-system/issues/37), ready-for-human | C1: height-conditioned desktop rail `product-purchase-panel.tsx:45`, mobile safe-area/focus styles `product-page.module.css:480`. C2: single variant/quantity owner and guarded add callback at panel lines 31/64. C3/C4: exact variant price, valid pairs and cart-aware remaining cap at lines 37/108/122/146. C5: mobile price/change/add at 177. C6: add acknowledgment/cart link at 169/184. C7: existing description/guide at product `page.tsx:42`; no invented chapters. Commerce, journey, keyboard and experience suites pass. | Implemented; main/human reviewer checks and integrates PR #43. Closing directive already exists in PR. Do not close manually before merge; device/full accessibility still belongs to #42. P1 integration step; no additional feature required by this audit. |
| [#38 — SF-08 factual chapters](https://github.com/yousif-mansi/Bravos-system/issues/38), needs-info | C1: existing product description/guide preserved. C2–C5: separate approved Fit/Fabric/Care/Style mapping and chapter-specific behavior are not implemented/demonstrated; absent facts produce no fabricated sections. C6: approved chapter-present product/provenance and present-versus-omitted verification missing. | Optional P2 deferred enhancement. Owner provides facts/provenance; bounded implementation only when requested. Keep open; does not block working commerce or performance measurement. |
| [#39 — SF-09 cart](https://github.com/yousif-mansi/Bravos-system/issues/39), ready-for-human | C1: line identity/variant/price/quantity/subtotal/remove in `cart-line.tsx:27`. C2: provisional total, no reservation and COD in `cart-summary.tsx:20`. C3: stock/excess feedback and checkout gate at line 23. C4: hydration/storage/error/retry states in cart `page.tsx:81`; refresh at summary 28. C5: aggregation/persistence/cross-tab/corrupt storage and retained cart tests in `storefront.spec.ts` and gallery/cart suite. C6: geometry/focus/failed-media tests plus keyboard suite. | Implemented, awaiting human-reviewed integration through PR closing directive. Representative device/production approval remains #42. P1 integration step. |
| [#40 — SF-10 Arabic COD checkout](https://github.com/yousif-mansi/Bravos-system/issues/40), ready-for-human | C1/C2: required/optional/mobile fields at checkout `page.tsx:431`; invalid feedback at 521. C3: authoritative quote at 546. C4: input-key/stale response guards at 59/160 and changed-fee/stock regression. C5: accurate pending acknowledgment/reference/WhatsApp at 375 and closed/uncertain states. C6: persisted operation/recovery at 214/296/645, reload/lost-ack/cross-tab coverage. C7: focus/geometry/feedback coverage. C8: missing areas explicit at 420/427/477 and tested. Checkout draft retention is in-memory only, not a claim of durable customer draft storage. | Implemented, awaiting human-reviewed integration through PR closing directive. Do not alter confirmation, stock, COD, quote or recovery policy. P1 integration step. |
| [#41 — SF-11 production performance](https://github.com/yousif-mansi/Bravos-system/issues/41), needs-info | C1/C2: tooling ready in `scripts/measure-storefront-performance.mjs`; reproducible definitions/comparison in `storefront-performance.md:53`. C3: interactions are separate and unmeasured. C4: cover/font setup exists; representative image optimization/transfer proof missing. C5: direct media revocation tests in `catalog.test.ts:803` and `catalog-media.spec.ts:10`; optimizer deliberately off. C6: geometry/reduced motion exists; representative CLS/runtime performance unmeasured. C7: no complete representative matched baseline/final matrix. | P1 public launch gate. Owner supplies approved representative assets/permission; engineering/operator measure already-permitted production baseline 15fd366 and final under same fixture/conditions. Each build needs 24 cold samples: four routes ×two viewports ×three runs, plus interaction traces. Disclose unequal new-hero workload, redirects/incomplete requests and all regressions. Development/tiny synthetic captures cannot close this. |
| [#42 — SF-12 quality gate](https://github.com/yousif-mansi/Bravos-system/issues/42), ready-for-human | C1: PostgreSQL-backed journey/analytics and single-branch integration tests. C2: five viewport widths; CSS zoom only. C3: keyboard, 44px geometry and selected solid-surface contrast; gradients/images/backdrop/translucent badges remain manual. C4: failed read/media/storage/empty/closed/uncertain states covered. C5: labels/live regions/reduced motion exist; actual speech and mobile keyboard not proven. C6: visibility/quantity/quote/recovery regressions pass. C7: exact matching full CI green. C8: physical Safari/Android unexecuted. C9: bounded source/development screenshot reviews exist; final human integration/content/production sign-off missing. | P1 public gate; offline POS hardware is also P0 internal safety evidence. Main/operator/owner record actual iPhone/iPad Safari and Android Chrome, true 200% browser zoom, screen-reader speech, complete manual contrast and representative production visual/performance acceptance. Keep open. |

The three PR closing directives are `Closes #37`, `Closes #39`, `Closes #40`. Their open status is appropriate while PR #43 is unmerged. #1/#33/#38/#41/#42 should not be closed solely because software checks pass. No issue status was changed in this audit.

### Umbrella #1 software traceability

These source anchors map the original A01–A36 scenarios to current automated evidence. HTTP files are under `tests/http/`; browser files under `tests/browser/`. The matching Linux suites pass except the named Windows-only skip. Follow the later operational update when an original scenario contains superseded branch/channel/accounting wording. A test anchor establishes covered assertions, not every conceivable edge or actual operator acceptance.

| Scenario | Verifiable test anchors | Remaining acceptance boundary |
| --- | --- | --- |
| A01 staff/branch permissions | `staff-access.test.ts:72,92,114,641` | Actual configured accounts/grants and hosted login |
| A02 restricted data | `catalog.test.ts:400,596`; `offline-pos.spec.ts:976` | Actual host/public boundary and cache custody |
| A03 catalog/variants | `catalog.test.ts:37,192,283,320` | Authoritative launch catalog |
| A04 public availability states | `catalog.test.ts:719` | Representative content/stock |
| A05 retained FIFO costs | `sales.test.ts:282` | Actual branch batches/costs |
| A06 combined variant quantities | `sales.test.ts:232`; `checkout.test.ts:191` | Reconciled opening counts |
| A07 intake/POS/attribution journey | `product-readiness-journey.spec.ts:11` | Real staff pilot |
| A08 employee deduction | `sales.test.ts:311` | Operator understanding of final values |
| A09 equal discount allocation | `sales.test.ts:311` | Operator refund examples |
| A10 offers/bundles/coupons | `automatic-offers.test.ts:103`; `bundles.test.ts:119,209`; `coupons.test.ts:112,363` | Owner-approved live rules |
| A11 allocation competition | `order-confirmation.test.ts:347,370` | Physical set-aside and discrepancy procedure |
| A12 accepted command replay | `sales.test.ts:566,604`; `checkout.test.ts:203` | Release/restore queue reconciliation |
| A13 pending order holds no stock | `checkout.test.ts:142` | Staff WhatsApp procedure |
| A14 stages and cancellation | `order-fulfillment.test.ts:46,114` | Confirmation recognition/reversal pilot |
| A15 failed-delivery inspection | `order-fulfillment.test.ts:186` | Actual physical receipt/inspection |
| A16 contact/wait policy | `order-confirmation.test.ts:201,452` | Owner configuration and staff training |
| A17 offline completed sale | `offline-pos.spec.ts:3` | Actual devices, restart/reconnect |
| A18 acknowledgement/tabs | `offline-sync.spec.ts:105,182,337`; `sales-sync.test.ts:450` | Real network/device behavior |
| A19 storage/logout preservation | `offline-pos.spec.ts:126,235`; `session-transition.spec.ts:22,54` | Physical device/storage custody |
| A20 late sales/coupon preservation | `order-protection.test.ts:105`; `offline-promotions.test.ts:199` | Manager discrepancy acceptance |
| A21 revocation/recovery | `sales-sync.test.ts:514,679,753` | Real reauthentication/owner recovery |
| A22 coordinated corrections | `stock-corrections.test.ts:53,160,327` | Known tills and count/pause procedure |
| A23 Returns selection/window | `returns.test.ts:622,783,814` | Real receiving-branch return pilot |
| A24 paid refund suggestion | `returns.test.ts:622`; `sales.test.ts:311` | Manager actual refund and Owed/Paid pilot |
| A25 original/corrected cost | `returns.test.ts:914`; `receiving.test.ts:275,392` | Actual cost/batch custody |
| A26 exchange settlement | `returns.test.ts:50,157,240,350` | Staff settlement training |
| A27 expenses/corrections | `expenses.test.ts:19,81` | Actual accounts/branch reporting |
| A28 Cairo/branch/report totals | `reporting.test.ts:46,257,327`; `reporting-edgecases.test.ts:54,188` | Real pilot totals reconcile |
| A29 online value/reversal | `reporting.test.ts:396,506`; `reporting-edgecases.test.ts:731,857` | Confirmation/reversal pilot |
| A30 exports/aggregate analytics | `analytics-exports.test.ts:51,149,247` | Owner review of representative output |
| A31 encrypted backup/restore | `backup.test.ts:202`; `restore.test.ts:40,301,429` | External recovery/rollback drill |
| A32 opening import/generation | `opening-import.test.ts:52,155,217`; `restore.spec.ts:7` | Fresh target, real stock and retained queue |
| A33 Arabic/critical browsers | Experience/keyboard/journey suites; `bravos-v1-spec.md:385` requires devices | Physical devices, true zoom, speech/manual contrast remain open |
| A34 promotion administration | `automatic-offers.test.ts:46`; `bundles.test.ts:51`; `coupons.test.ts:51` | Approved rules and role assignment |
| A35 areas/fees/optional fields | `checkout.test.ts:71,307` | Owner-approved actual areas/fees |
| A36 coupon release/free returns | `order-fulfillment.test.ts:114,186`; `returns.test.ts:274` | Staff handling of actual cancellation/return |

Opening-stock purchase exclusion is a later explicit requirement with additional coverage in `opening-stock-reporting.test.ts:59` and the reporting browser/export tests; it does not alter historical receipt or FIFO dates.

## Ranked blockers and ordered execution plan

**Priority interpretation:** P0 items below are immediate launch-safety hard stops, not a claim of a proven critical code vulnerability. P1 items are mandatory release/integration/public acceptance gates. P2 items can remain deferred with clear limitations. Order expresses dependencies; independent preparation may proceed in parallel without shared source edits or production operations.

| Order / priority | Action and acceptance criteria | Owner / dependency |
| --- | --- | --- |
| 1 — P1 | **Freeze and review release candidate.** Record f7507e2 plus main identity, complete 132-file diff review and human approval. Preserve dirty/protected files. Merge/publish only when explicitly authorized. Run CI on resulting main SHA and record artifact/build/lockfile/runtime identity. Until then no claim that main contains the candidate. Consider narrow branch protection requiring review and the three jobs; if deferred, record the named manual release approver and prohibition on bypass. | Main engineering/human reviewer; approval required before merge. Settings are not changed by this report. |
| 2 — P1 | **Resolve startup refusal and permit current isolated production verification.** Recover decision details or record unknown cause plus explicit newly permitted scope. Successful current source/schema runtime with owned processes, correct rewrites, no runtime errors, logged restart/shutdown and complete provenance. No alternate-launcher workaround. | Approval/resource owner + engineering. Can investigate records now; actual startup requires explicit authorization. |
| 3 — P0 | **Define and verify deployment security/topology.** Approved host plan, TLS, exact staff/public/auth HTTPS origins, secure cookies, strong generated secret provisioning without printing values, isolated private directories, durable PostgreSQL/media, service manager and correct public/static API routing. Validate client IP/rate limiting and spoof rejection through actual proxy. Verify required staging-database capabilities and role scope. Rehearsal exception must be unset for hosted use. | Owner chooses/provides host; operator prepares; engineering verifies. Domain/hosting booking remains deferred until authorized. |
| 4 — P0 | **Prove recovery and rollback before business writes.** Saved decryptable encrypted business archive, separately copied media and verified external PostgreSQL backup restored to a named isolated target. Demonstrate owner recovery/password reset, restore preview/activation, compatible schema and eligible queued-sale replay exactly once. Document unsupported retained-sale handling, RPO/RTO agreed by owner, incident decision maker, fresh-target switchover and rollback evidence. Never treat merge restore as undo. | Database/operator + owner; named targets and approval before data-affecting operations. Can use isolated approved fixture for rehearsal; actual production backup proof follows target provisioning. |
| 5 — P0 | **Validate launch data and real offline operations.** Owner-signed branch counts and variant pairs, historical cost batches, prices, assigned staff roles/branches, delivery areas/fees and configuration. Real tills complete cash/manual-online/split sale, disconnect/restart/reconnect, queued once, revocation/logout preservation, discrepancy handling, online confirmation/cancellation/inspection and cross-branch return. Reports and physical quantities reconcile. No disposable preview data promoted by assumption. | Owner/manager/staff + physical-device QA. Unsent queues must be retained through all release steps. |
| 6 — P1 | **Prepare truthful customer content and production brand review.** Approved representative real merchandise/photos/product facts, correct official logos/fonts, no unrelated artwork/test catalog. Produce production screenshots at required phone/tablet/desktop widths for home/list/product/cart/checkout; owner/main accept branding, legibility and commerce clarity. Optional campaigns/chapters stay absent without content. | Business owner supplies; engineering verifies isolated preview first. Authorize catalog import separately. |
| 7 — P1 | **Finish #41 and #42 evidence.** Matched permitted baseline/final 24-sample production matrices with source/build/fixture/browser/hardware/throttle provenance, image bytes and hero accounting, gallery/filter/add/field/motion traces, disposition of regressions. Confirm acceptance budgets with owner: currently proposed CLS ≤0.1 and phone route median LCP ≤2500ms under documented lab conditions. Physical Safari/Android, real 200% zoom, screen-reader spoken feedback, keyboard/touch/safe-area and manual image/glass/gradient contrast pass with saved findings/reruns. Any demonstrated defect receives a bounded fix and affected regressions. | Engineering QA/operator; depends on permitted runtime and representative content. Lab results are not field p75/INP or physical-device proof. |
| 8 — P1 | **Operational monitoring and handover.** Working availability/database/media/disk/recovery-path/backup-age checks, retained redacted service/proxy logs, tested alert to named primary/backup, restart procedure, backup schedule/retention and incident runbook. Health 200 alone not accepted. Training and completed operator acceptance form with actual results/evidence and owner signature. | Operator + owner/manager; can prepare while host/content/device work proceeds. |
| 9 — P0 release decision | **Internal-first cutover, then separate public opening.** Reconcile all known tills; approved maintenance/pause plan; target history/backup verified before API's auto-migrations; exact main artifact starts with public ordering disabled. Sign internal pilot first. Only after all public gates pass and explicit owner go decision, enable ordering once under controlled restart and verify one identified end-to-end customer order/branch/accounting flow. Monitor through agreed observation window. | Owner gives explicit production-impact approval; engineering executes authorized runbook. This audit authorizes none of these operations. |
| 10 — P2 | **Deferred work.** Optional factual product chapters/campaigns only when approved content exists. Additional server-rendered failure-injection coverage, richer observability or credential-role separation only when a demonstrated need warrants isolated work. Record single-API-host and archive-size/manual-recovery limits; do not expand architecture to solve hypothetical scale. | Main product/architecture judgment; not prerequisites for the present commerce scope. |

An isolated config hardening patch is justified by the demonstrated fail-fast weakness, but is a proposal, not implemented work. It should preserve the tightly bounded loopback rehearsal and avoid secret rotation, new permission policies or business changes. Actual deployed correctness remains mandatory whether or not the patch is approved.

### Work separation

**Engineering can do without production data changes:** human diff review, acceptance evidence reconciliation, retrieve saved approval decisions, draft host preflight/rollback plan, review representative fixture specifications, and evaluate the bounded config guard proposal. Once separately authorized and properly supplied, engineering can perform isolated production measurements, screenshots and regression repairs.

**Requires business owner:** approved facts/photos/copy, authoritative stock/cost/configuration, staff assignments, policy wording/contact details, performance target acceptance, recovery objectives, pilot signature and internal/public release decisions. Do not fabricate these inputs.

**Requires physical devices and operators:** offline completed-sale custody across restart/reconnect, native keyboards/install/update/font behavior, Safari/Android safe area, actual zoom and screen-reader speech, staff training and real operational reconciliation.

**Requires external infrastructure/resource approval:** hosting/domain when authorized, TLS/reverse proxy, service accounts/secret custody, persistent database/media, secure backup destination, monitoring/alerts and external recovery/rollback drill. Unknown approval policy rationale cannot be solved by silently changing execution method.

## Launch acceptance checklist and precise Go/No-Go rules

Use a named release record with source SHA, artifact/build IDs, lockfile/runtime, target identity, date, evidence links, signer and any explicitly accepted limitation. An unchecked item or blank result is not a pass.

### Engineering candidate acceptance

- [x] Published candidate f7507e2 identified; exact matching Linux full CI green.
- [x] Windows-only Linux skip explained; historical/reused results retain boundaries.
- [x] Bounded Standards and Spec audits found no actionable candidate defect.
- [ ] Human PR approval recorded; integration explicitly authorized.
- [ ] Resulting main/release SHA has successful required gates and immutable build identity.
- [ ] No protected/local/temp data included in the release artifact or new commit.

### Internal production acceptance — all required before reliance

- [ ] Actual host topology/TLS/origins/private secrets/service account verified; rehearsal exception off.
- [ ] Correct staff/public routing, secure login/logout, real role/branch isolation and proxy rate limiting verified.
- [ ] Named database history/schema and permissions verified; pre-start backup exists before auto-migration.
- [ ] Durable media/recovery directories proven under restart; secrets/token handling and backup ownership tested.
- [ ] External database and separate media recovery completed on named isolated target; rollback/switchover plan rehearsed.
- [ ] Eligible queued sales replay once; unsupported retained sales preserved and assigned for resolution.
- [ ] Real stock/configuration and cost batches reconciled; actual offline/reconnect devices pass.
- [ ] Monitoring/alerts, retention, incident primary/backup, agreed recovery objectives and service restart tested.
- [ ] Completed signed operator pilot form and training; public ordering remains closed.
- [ ] Explicit owner approval for internal cutover, with observed runtime and reconciled state.

### Public storefront acceptance — internal acceptance plus all below

- [ ] Earlier execution refusal resolved by a permitted scope; current production runtime/captures recorded.
- [ ] Real representative catalog, truthful facts/fees/contact information and owner-approved visual/content review.
- [ ] #41 complete matched production performance matrices and interactions; agreed budgets/regressions accepted.
- [ ] #42 physical Safari/Android, real zoom, actual screen-reader speech and complete manual contrast evidence.
- [ ] All supported customer journeys pass on release build, including shortage, closed ordering, retry and recovered acknowledgment.
- [ ] No unresolved critical/high security or data-integrity defect, broken core workflow, unexplained duplicate/missing sale, incorrect branch balance or unsafe rollback path.
- [ ] Named owner explicitly approves public ordering; controlled order smoke check and monitored observation window recorded.

**NO-GO triggers:** any missing mandatory evidence above; mismatch between tested and deployed build/configuration; unknown target/data migration behavior; weak/unmanaged secrets or insecure transport; unrecoverable business/media data; unpreserved queued sales; unresolved core/device/accessibility/performance defect; missing operator or owner decision. CI success does not waive these.

**GO for internal production** only when engineering candidate and internal acceptance are fully evidenced and approved, with public ordering closed. **GO for public launch** only after internal acceptance plus every public condition and separate owner approval. Optional #38 chapters and empty campaign sections are not required. An accepted limitation must be concrete and must not waive security, transaction integrity, recoverability or a mandatory business requirement.

**Current verdict:** candidate software is green and suitable for reviewed integration. Production launch remains **NO-GO**. The highest-value next step is human PR review followed by an authorized, provenance-recorded production rehearsal; in parallel prepare owner content, device/operator sessions and the host/recovery plan. This report neither merges the PR nor authorizes deployment.

## Evidence index and audit preservation

- Live GitHub: [PR #43](https://github.com/yousif-mansi/Bravos-system/pull/43), [matching CI](https://github.com/yousif-mansi/Bravos-system/actions/runs/38104919322), linked open issues above; read-only protection/ruleset queries.
- [Production readiness execution snapshot](../planning/production-readiness-execution-2026-10-10.md), [bounded main review](production-readiness-main-review-2026-10-09.md), [SF-12 technical QA](storefront-sf12-technical-qa-2026-10-10.md), [operator-readiness review](operator-readiness-2026-10-10.md).
- [Release rehearsal and hosted boundaries](../development/release-rehearsal.md), [backup archive profile](../development/backups/archive-v1.md), [restore and external recovery checklist](../development/backups/restore.md), [operator pilot form](../development/operator-pilot-acceptance.md), [production performance procedure](../development/storefront-performance.md).
- Ignored raw evidence retained locally: `.scratch/grok-production-20261010/linux-final-f7507e2.json`, matching raw HTTP/browser logs, `final-coherence-final/results.json`, and the startup rejection records listed above. Ignored scratch records are local evidence, not automatically uploaded GitHub artifacts; retain/export sanitized logs through an approved evidence workflow if reviewers need durable off-machine access.
- Four subagents performed read-only analysis; no implementation was delegated. Final synthesis and release judgment belong to the main reviewer.
- Preexisting protected modification and untracked local assets were preserved. No application/source/business-data/protected-file changes, staging, commit, push, merge, deployment, issue closure or production-start retry occurred.

Standards: **0 actionable candidate findings**, no worst candidate violation; Spec: **0 actionable implementation findings**, required external acceptance remains incomplete. The baseline configuration weakness and operational gates are separately documented above.
