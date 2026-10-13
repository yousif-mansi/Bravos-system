# Bravos remaining-work execution — 13 October 2026

The owner authorized task-by-task completion with Grok as implementer, emphasizing user experience and the final appearance. Main owns scope, product and architecture decisions, diff review, independent verification and visual acceptance. Sol may collect evidence and review scopes; Sol does not replace Grok as implementer in this queue.

Starting identity: `codex/readiness-issue-reconciliation` / `f7507e20f5162987644f424d5a61865828a27e41`. PR #43 was rechecked OPEN/unmerged, with its matching Linux checks green. Existing protected/local dirt and the untracked 11 October audit remain outside task diffs. Do not interpret prior engineering passes as production sign-off.

## Execution queue

| Task | Bounded result | Status / acceptance |
| --- | --- | --- |
| 01 — Header/navigation visual QA | Current isolated development captures across 320/390/768/1024/1440px; header text/glass/focus assessment; minimal existing-style correction only if a defect is demonstrated. | Accepted for this bounded scope. Main reviewed all five widths/focus states and independently recomputed the CSS bound; no product/test changes. Both Grok wrappers exited1 on IPv6 cleanup denial; a fresh main experience run passed1/1 with complete exit0 and clean teardown. Earlier failures retained. Manual helper samples remain manual; full SF12 stays open. |
| 02 — Production configuration guard | Implement a minimal guard for the audit's demonstrated nonempty-secret/HTTP-origin fail-fast weakness, preserving development and the existing explicit loopback rehearsal. No secrets or environment files are changed. | Accepted after source review and fresh independent43-test/typecheck/architecture/all-app-build cycle, all exits0. No trust-policy, permission, API/business or environment-file change. Grok's initial31-character fixture failure is retained beside its passing rerun. See the dated config-guard review and task02-main logs. |
| 03 — Checkout optional-detail presentation | Native disclosure for alternate phone, landmark and notes: initially collapsed when empty; initially open on return with nonempty optional draft. Keep controls mounted and all payload/quote/repair/recovery behavior intact. Preserve dark brand direction and current fonts. | Accepted after final source/test review, seven current-state captures and a fresh independent25-test/typecheck/architecture/storefront-build cycle, all exits0 including browser teardown. Grok's interrupted run, type error and24-pass/1-fail run remain separate from its corrected25-pass run. This is subjective UX polish, not a measured conversion gain or matched old/new build comparison. Full production/physical-device/representative-brand acceptance remains open. |
| 04 — Production runtime and performance evidence | Resolve the recorded execution refusal, then verify exact production artifact/runtime and the matched SF-11 matrix plus interactions on an explicitly permitted isolated target. | Blocked on permitted execution and representative content. Never retry via another launcher/port/host/CI as a workaround. Development captures/builds do not complete this task. |
| 05 — Real device and operator acceptance | Actual Safari/iPhone/iPad and Android; true browser zoom and screen-reader speech; offline/restart/reconnect custody; six operator pilot scenarios with real results and signatures. | Requires devices, people and operational testing. No automated or emulated substitute, fabricated result or checkbox-only completion. |
| 06 — Hosted release and recovery acceptance | Real HTTPS/proxy/service account, durable data/media/recovery storage, backup/restore/rollback drill, monitoring/alerts, reconciled inventory, internal-first pilot and separate public approval. | Requires owner-provided infrastructure/data and explicit production-impact approval. Existing guides prepare the work; they do not prove execution. |

The optional factual chapters in #38 remain content-deferred and do not block commerce. Campaigns remain optional; never create empty stories or invented facts. #37/#39/#40 remain implemented pending reviewed PR integration; do not rewrite working flows to manufacture new tasks.

## Review and delivery contract

Each Grok brief states the objective, exact files, constraints, gates and report contract. Only one implementer owns shared files and local test ports at a time. Grok does not stage, commit, push, merge, deploy or alter GitHub issue status. Main checks tests for weakened assertions before rerunning them, inspects the actual diff and screenshot files, and records confirmed results separately from hypotheses and external limitations.

Use pinned Node 22.23.3 / pnpm 10.34.5 and the existing isolated Playwright stack. Preserve ordinary business data, queued sales, protected-file hash and historical failure evidence. Restore only generated Next path churn to saved before-bytes. Source changes were held uncommitted for concrete review. The owner's subsequent 13 October instruction authorizes publication of this reviewed checkpoint by commit/push; PR merge, deployment, production launch and public-ordering changes remain unapproved.

Completion is measured against the [launch acceptance audit](../reviews/production-launch-readiness-audit-2026-10-11.md), not the existence of code or reports. Current production recommendation remains No-Go until the required evidence and owner decisions are recorded.

## Accepted checkpoint for GitHub publication

Grok implemented product code; main reviewed diffs, tests and images and independently verified each task. Task01 made no product-code change because its bounded review demonstrated no header defect. Task02 closes the demonstrated fail-fast configuration weakness; task03 reduces optional-field density while preserving commerce behavior. No new feature or architecture redesign is required by these results.

The following sixteen paths are the reviewed publication scope. The historical audit is included so the published planning links resolve:

| Purpose | Files |
| --- | --- |
| Production guard and coverage | `apps/api/src/config.ts`; `tests/http/config.test.ts` (new); `tests/http/checkout.test.ts`; `docs/development/release-rehearsal.md` |
| Checkout disclosure | `apps/storefront/app/checkout/page.tsx`; `apps/storefront/app/checkout/checkout.module.css` |
| Preserved commerce journeys and added disclosure assertions | `tests/browser/checkout.spec.ts`; `tests/browser/checkout-recovery.spec.ts`; `tests/browser/storefront-product-ux.spec.ts`; `tests/browser/storefront-integration.spec.ts`; `tests/browser/storefront-keyboard.spec.ts` |
| Review evidence and task queue | `docs/reviews/storefront-header-visual-qa-2026-10-13.md` (new); `docs/reviews/production-config-guard-2026-10-13.md` (new); `docs/reviews/checkout-optional-details-ux-2026-10-13.md` (new); `docs/reviews/production-launch-readiness-audit-2026-10-11.md` (new, historical audit); this planning document (new) |

The preexisting protected review, local stores/media/fonts and other unrelated untracked content remain excluded. The earlier audit is deliberately included as dated historical evidence, with a pointer to the subsequent configuration correction. Generated Next files were restored byte-for-byte. No API contracts, database schema, routes, role permissions, catalog data, stock/order/quote/recovery logic, dependencies or test hooks were changed. Production configuration validation is deliberately stricter; hosted operators must supply strong non-example secrets and explicit canonical HTTPS origins. Passing these checks does not prove secret entropy or deployed security.

PR #43 was rechecked OPEN at `f7507e2` during independent verification. Its matching CI remains green for that published candidate; the new local changes have not been submitted to hosted CI, reviewed for merge or integrated into main.

## Next evidence required, in order

1. Publish this reviewed checkpoint under the owner's commit/push approval, then obtain hosted CI at the exact resulting candidate. PR merge still requires approval. Existing older CI must not be relabeled as testing these new changes.
2. Establish an explicitly permitted isolated production-runtime target. The historical pre-execution denial remains `rejected: blocked by policy`, with unknown exact trigger. Do not retry through an alternative launcher/port/host/CI to evade it. Follow [release rehearsal boundaries](../development/release-rehearsal.md); record exact artifact, configuration, runtime, teardown and permission provenance.
3. Obtain owner-approved real photos/product facts/contact copy, then evaluate final brand quality and the matched performance matrix using [the existing procedure](../development/storefront-performance.md). Campaigns and factual chapters remain optional. Do not replace missing facts with invented production content.
4. Complete actual Safari/iPhone/iPad and Android testing, true200% browser zoom, spoken screen-reader feedback and offline till restart/reconnection. Complete the [operator pilot form](../development/operator-pilot-acceptance.md) with real results: payment modes, queued-sale custody, branch fulfillment/confirmation/cancellation, returns and reconciled totals. Automated emulation does not sign these gates.
5. With owner-provided hosting and explicit operational approval, verify TLS/proxy/IP handling, secure sessions, durable database/media/recovery paths, monitoring and alert delivery. Rehearse external backup retrieval, restore and rollback on named targets using [the recovery checklist](../development/backups/restore.md). Agree recovery objectives and incident owners.
6. Sign internal-first cutover with public ordering disabled; approve public opening separately after all mandatory public gates pass. No production-impacting operation is authorized by this checkpoint.

## Unattended verification handoff

After publication, the existing GitHub Actions workflow runs the full nondeployment engineering gates on the exact candidate. Grok prepares a bounded reporting script; main reviews it before background execution. The script waits for that candidate's workflow, retains exact run/job identities and full available logs, records actual pass/fail/skip counts where parseable, snapshots PR/open-issue status, and generates a final Markdown report with the remaining owner/device/infrastructure gates. It does not edit application code, repair tests automatically, merge, close issues, deploy or retry the denied production startup. A failed/cancelled/timed-out run stays failed and is reported for review; it is not relabeled by historical evidence.
