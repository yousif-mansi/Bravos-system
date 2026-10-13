# Candidate file inventory — 9 October 2026

Provisional review artifact against HEAD `741fdf84ae7dd4e92a806b97674ba7e8835c3c08`. No staging, commit, push, services or business-data writes were performed for this inventory. October 9 final gates and coordinating-agent acceptance remain pending. This list classifies paths; it does not approve their implementation or relabel historical tests as final results.

Snapshot: **45 related tracked files, +1,676 / -542 lines**, plus **20 untracked current engineering/evidence files**. The protected unrelated review is excluded. The main reviewer retained seven further untracked historical records as related authorized supporting documentation, listed separately from current evidence. This inventory is an additional new review artifact and is not included in those counts. Untracked line counts below are file lengths, not Git additions; tracked counts come from `git diff --numstat` without staging.

## Related current candidate paths

| Exact path | Scope/stat | Reason |
| --- | --- | --- |
| `.npmrc` | tracked +1 / -0 | Linux embedded PostgreSQL build allowlist for CI. |
| `apps/api/package.json` | tracked +2 / -2 | Fastify and Sharp security patches. |
| `apps/api/src/app.ts` | tracked +1 / -1 | Wire optional trusted business clock into Returns inventory composition. |
| `apps/internal/src/App.tsx` | tracked +3 / -1 | Restart sync for account generation and active-branch transitions. |
| `apps/internal/src/pages/LookupPage.tsx` | tracked +226 / -60 | Branch-scoped POS discovery and compact checkout workspace. |
| `apps/internal/src/pos.ts` | tracked +39 / -0 | Notify same-tab and cross-tab stock changes after persisted state updates. |
| `apps/internal/src/session.ts` | tracked +31 / -12 | Guard logout against account-generation and session-revision races. |
| `apps/storefront/app/cart/cart-line.tsx` | tracked +5 / -1 | Cart media fallback and repair feedback. |
| `apps/storefront/app/cart/cart-summary.tsx` | tracked +1 / -0 | Accessible cart-to-checkout action state. |
| `apps/storefront/app/cart/cart.module.css` | tracked +9 / -1 | Readable cart repair and adequate action targets. |
| `apps/storefront/app/checkout/checkout.module.css` | tracked +28 / -0 | Customer field grouping and mobile checkout feedback. |
| `apps/storefront/app/checkout/page.tsx` | tracked +31 / -33 | Honest acknowledgment, cart repair, draft retention and mobile address focus. |
| `apps/storefront/app/layout.tsx` | tracked +11 / -8 | Compose memory-only customer draft provider. |
| `apps/storefront/app/page.tsx` | tracked +4 / -1 | Show actual search/category discovery context. |
| `apps/storefront/app/products/[productId]/product-page.module.css` | tracked +4 / -0 | Prevent focused product actions from being covered by purchase bar. |
| `apps/storefront/next.config.ts` | tracked +1 / -0 | Initialize loopback development origin explicitly. |
| `apps/storefront/package.json` | tracked +1 / -1 | Next security patch. |
| `docs/development/backups/archive-v1.md` | tracked +21 / -7 | Clarify current archive compatibility and data/media boundary. |
| `docs/development/backups/restore.md` | tracked +11 / -3 | Clarify supported restore compatibility and operator safeguards. |
| `docs/planning/bravos-storefront-roadmap.md` | tracked +2 / -0 | Historical integration status correction; October 9 acceptance appendix pending main review. |
| `docs/planning/tickets/storefront/SF-03.md` | tracked +1 / -1 | Preserve production-preview rejection and open visual acceptance. |
| `docs/planning/tickets/storefront/SF-11.md` | tracked +5 / -1 | Record attach-only measurement tooling and open production comparison. |
| `docs/planning/tickets/storefront/SF-12.md` | tracked +5 / -1 | Historical bounded quality evidence; October 9 appendix pending main review. |
| `package.json` | tracked +2 / -0 | Linux build allowlist and root public inventory test workspace link. |
| `packages/catalog/package.json` | tracked +1 / -1 | Sharp security patch. |
| `packages/catalog/src/application/catalog.ts` | tracked +1 / -0 | Expose category name in authorized POS lookup result. |
| `packages/contracts/src/index.ts` | tracked +1 / -0 | Declare POS lookup category name. |
| `packages/identity/src/adapters/operator-recovery-outbox.ts` | tracked +3 / -1 | Case-insensitive inherited PSModulePath cleanup retaining private ACL checks. |
| `packages/inventory/src/adapters/postgres-inventory.ts` | tracked +6 / -3 | Optional trusted clock for return claims with SQL default and stored replay preserved. |
| `pnpm-lock.yaml` | tracked +203 / -200 | Approved security patch graph and root inventory workspace link provenance. |
| `scripts/check-bundles.mjs` | tracked +3 / -1 | Distinguish preload CSS metadata from an eager feature import. |
| `scripts/scratch-migrate.ts` | tracked +63 / -1 | Exercise all 35 migrations with rollback and reapply probes. |
| `tests/browser/checkout-recovery.spec.ts` | tracked +134 / -6 | Real quote/recovery and draft-preservation regressions. |
| `tests/browser/checkout.spec.ts` | tracked +157 / -3 | Acknowledgment, reference and checkout behavior regressions. |
| `tests/browser/offline-pos.spec.ts` | tracked +24 / -2 | Offline completed-sale and authentication setup checks. |
| `tests/browser/offline-sync.spec.ts` | tracked +2 / -1 | Scope intended sync alert without weakening business assertions. |
| `tests/browser/sales.spec.ts` | tracked +139 / -122 | Observe persisted completion and context-wide request gates for two-tab behavior. |
| `tests/browser/storefront-experience.spec.ts` | tracked +12 / -4 | Discovery and checkout experience checks. |
| `tests/browser/storefront-gallery-cart.spec.ts` | tracked +218 / -2 | Gallery, cart repair and customer draft continuity checks. |
| `tests/http/catalog.test.ts` | tracked +33 / -2 | Catalog privacy and exact POS lookup response-key regression. |
| `tests/http/receiving.test.ts` | tracked +2 / -1 | Exact response-key fixture repair. |
| `tests/http/reporting-edgecases.test.ts` | tracked +111 / -0 | Cairo month boundary, return clock, replay and stock-once regression. |
| `tests/http/reporting.test.ts` | tracked +2 / -0 | Add timestamp assertions to the existing deterministic reporting fixture. |
| `tests/http/returns.test.ts` | tracked +74 / -56 | Trusted clock regression and Date-only freeze for the free-reward fixture; production pricing unchanged. |
| `tests/http/staff-access.test.ts` | tracked +42 / -2 | Case-insensitive child-environment and real Windows private-ACL regression. |
| `.github/workflows/ci.yml` | untracked 118 lines | Pinned static/build, PostgreSQL HTTP and Chromium workflow candidate. |
| `apps/internal/src/pages/pos/ProductBrowser.tsx` | untracked 60 lines | Bounded POS product discovery component. |
| `apps/internal/src/pages/pos/pos-workspace.css` | untracked 93 lines | Responsive POS workspace styles using the existing dark semantic internal theme. |
| `apps/storefront/app/checkout/checkout-draft.tsx` | untracked 48 lines | Eight editable customer fields retained in memory across client navigation. |
| `docs/development/continuous-integration.md` | untracked 45 lines | Explain CI candidate and hosted-run boundary. |
| `docs/development/operator-handover.md` | untracked 112 lines | Arabic operator and staff procedures; no completed training claim. |
| `docs/development/storefront-performance.md` | untracked 57 lines | Permitted attach-only production measurement procedure. |
| `docs/reviews/dependency-security-2026-10-07.md` | untracked 52 lines | Historical audited security freeze; final lock appendix waits for results. |
| `docs/reviews/product-ux-readiness-2026-10-05.md` | untracked 94 lines | Earlier UX/failure chronology supporting current candidate. |
| `docs/reviews/production-readiness-2026-10-07.md` | untracked 104 lines | Historical preliminary acceptance register; retain pending state. |
| `scripts/measure-storefront-performance.mjs` | untracked 294 lines | Measure already-running permitted production service without launching or seeding it. |
| `tests/browser/pos-workspace.spec.ts` | untracked 333 lines | Real POS discovery, branch-stock and payment workspace coverage. |
| `tests/browser/product-readiness-journey.spec.ts` | untracked 256 lines | Integrated staff/customer readiness journey. |
| `tests/browser/session-transition.spec.ts` | untracked 258 lines | Account transitions, queue attribution and duplicate-safe stock checks. |
| `tests/browser/storefront-integration.spec.ts` | untracked 281 lines | Branch basket, sparse variant, privacy and reference integration checks. |
| `tests/browser/storefront-journey-analytics.spec.ts` | untracked 194 lines | Aggregate discovery/cart/order analytics checks. |
| `tests/browser/storefront-keyboard.spec.ts` | untracked 301 lines | Visible keyboard focus and viewport obstruction regression. |
| `tests/browser/storefront-product-ux.spec.ts` | untracked 211 lines | Current product/purchase quality coverage. |
| `tests/scripts/check-bundles.test.mjs` | untracked 69 lines | Pure checker regression including CSS preload false positive and true eager imports. |
| `tests/scripts/storefront-performance.test.mjs` | untracked 55 lines | Pure measurement-tool tests without opening a service. |

## Retained supporting historical records

The main reviewer explicitly retained these seven files as related authorized supporting records. They retain their dates, failure results and historical claims; none closes an October 9 gate. The October 4 maturity percentages and empty-catalog description are historical only, with no current readiness percentage assigned.

| Exact path | Scope/stat | Reason |
| --- | --- | --- |
| `docs/planning/project-delivery-status-2026-10-04.md` | untracked 32 lines | Historical planning context with dated empty-catalog and subjective percentage claims; not current acceptance. |
| `docs/reviews/storefront-completion-2026-10-04.md` | untracked 72 lines | Earlier bounded HTTP/browser/build and measurement-tool evidence. |
| `docs/reviews/storefront-integration-741fdf8.md` | untracked 89 lines | Historical baseline impact/spec review motivating current integration work. |
| `docs/reviews/storefront-integration-fix-verification.md` | untracked 41 lines | Earlier acknowledgment/reference verification and exact approved source boundary. |
| `docs/reviews/storefront-production-visual-review.md` | untracked 42 lines | Historical rejected production-start evidence and uncaptured measurements. |
| `docs/reviews/storefront-sf12-reliability-review-2026-10-02.md` | untracked 43 lines | Earlier reliability pass; source/date boundary retained. |
| `docs/reviews/storefront-visual-followup-2026-10-02.md` | untracked 21 lines | Earlier quote-retry evidence and rejected production visual launch. |

## Explicit exclusions and preservation

- `docs/reviews/bravos-v1-grok-review.md`: unrelated protected dirty file; SHA-256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`; excluded tracked diff is +4 / -1.
- `arabic font/`, `english font/`, `packages/report-export/assets/NotoSansArabic-Regular.ttf`, `Claude outputs/`, `.pnpm-store/`, `apps/api/.local/`, scratch logs/captures, generated builds, local databases, credentials and temporary files are excluded. Preserve existing material in place; this record authorizes no deletion.
- Root `package.json` SHA-256 `FF16B95CCBC0BE3579AB759ECB41ACADC8D07895D5937E4A5CDE4A6E6CA3E2BB`; `pnpm-lock.yaml` SHA-256 `63363450DBE7F3000995A51AE6204D8CDD659DD7B3EE44C75AB9D38398091B8B`. These identities supersede the first October 7 audit freeze at this inventory snapshot. A fresh October 9 audit found six Next 16.3.6 advisory entries (one high, four moderate, one low), recommending at least 16.3.8; security refresh analysis is underway. Final patch/install/audit hashes and results must supersede this snapshot before acceptance.
- The staging area was empty when this snapshot was read. A final preservation/source-register check remains the runtime/coordinating agents responsibility.

## Acceptance still open

Final current HTTP, build, audits, source/register cleanup and read-only preview proof must be recorded from actual runtime results and approved by the main reviewer before dated readiness, roadmap or SF-12 acceptance notes are appended. Even passing local gates leave owner brand/font/real-content review, real iPhone/iPad Safari and Android POS keyboard/offline/reconnect, actual 200% browser zoom/screenreader, representative matched production performance against `15fd366`, hosting/TLS/proxy/durable PostgreSQL/media/monitoring, recovery/training and internal-first pilot acceptance open. Historical `next start` rejection (`rejected: blocked by policy`) remains a production-measurement limitation. No workaround, hosting/domain booking or launch is authorized. The opening CSV purchases classification question remains unanswered and behavior unchanged.

## Prepatch October 9 observations

These observations are runtime-supplied prepatch evidence, not final gate acceptance. The [prepatch source register](../../.scratch/product-ux-review-20261005/runtime/.local/review-current-source-register-before-patch-20261009.json) matches **572 source files** between root and isolated runtime. The earlier 570-file register omitted the final CI workflow and pure bundle-checker test; the two newly synchronized files explain the count change without implying two newly changed business modules.

The reporting-edgecase preflight passed **10/10**, exit 0, in **62.56 seconds**; log: runtime `.local/review-http-reporting-preflight-final-20261009.log`. It is neither the full 246-case HTTP selection nor a substitute for the later security-refresh HTTP log.

## Addendum after the locator repairs — 9 October 2026, 16:28 Cairo

This addendum does not replace the 45-file snapshot above and does not accept the candidate. Gate results, retained failures, and the proposed commit boundary are in [the intern report](production-readiness-intern-report-2026-10-09.md).

Tracked diffs present at `741fdf84ae7dd4e92a806b97674ba7e8835c3c08` and absent from the 45-file table:

| Exact path | Scope/stat | Reason |
| --- | --- | --- |
| `README.md` | tracked +2 / -2 | Point local setup at checksum-verified portable Node 22.23.3. |
| `docs/development/local-setup.md` | tracked +17 / -5 | Record the 9 October Node pin, archive checksum, and child-process rule. The earlier 22.13.1 sentence stays historical. |
| `scripts/pinned-env.ts` | tracked +1 / -1 | Take the child Node directory from `process.execPath` instead of a fixed Program Files path. |
| `tests/browser/catalog-media.spec.ts` | tracked +1 / -1 | Scope the coming-soon assertion to `main` after a strict-mode failure. Assertions were not weakened. |
| `tests/browser/reporting.spec.ts` | tracked +15 / -8 | Send the receiving branch, use an exact reports link, and match sale/return cards by provenance links and the committed report copy. Amount assertions were not weakened. |

The security-final 572-file root/runtime register still matches pairwise. Those two test files are the only paths whose current hashes differ from that register. `docs/reviews/bravos-v1-grok-review.md` remains excluded; its SHA-256 was rechecked as `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. The index was empty. No staging, commit, push, or deploy was performed.

The read-only [October 9 before proof](../../.scratch/product-ux-review-20261005/after/live-data-proof-before-20261009.json) preserves **two products, two variants, two batches, four sales, zero orders**, Abshway balances **25 and 29**, and the active Fayoum fee **5,000 piasters (50 EGP)**. The helper first wrote a fixed October 7 filename and its output was copied to this dated October 9 file; do not use the fixed filename as evidence of an October 7 timestamp. The preview remains limited local business data, with no representative launch-content approval implied.

## Main-review addendum — 9 October 2026

The [main review](production-readiness-main-review-2026-10-09.md) records the latest candidate boundary, verification and bounded disposition. Earlier inventory snapshots and failed runs remain historical.

The current tracked boundary contains 52 changed paths, including the excluded protected `docs/reviews/bravos-v1-grok-review.md`. The increase from the earlier 51-path snapshot is solely `apps/storefront/app/components/home-introduction.module.css`. Current sales and keyboard test changes strengthen verification. The final approved bundle-guard hardening affects `scripts/check-bundles.mjs` and `tests/scripts/check-bundles.test.mjs`; its verification is recorded separately from the earlier application closure. The main-review report is related untracked review documentation.

The 572-file source comparison at 18:36 UTC preceded those two guard changes; final source pairing is recorded separately in the main review. Original exclusions remain in force. Hosted CI has not executed; publication and hosted execution still require explicit approval. This addendum grants no staging, commit, push, deployment or launch authorization.
