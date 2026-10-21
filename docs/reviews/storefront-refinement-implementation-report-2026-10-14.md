# Storefront refinement — main acceptance report

Date: 2026-10-15
Status: bounded implementation and Windows local acceptance complete; ready for owner review. This is not production or launch approval. Nothing was staged, committed, pushed, merged, or deployed.

## Current checkpoint

Branch `codex/ux-purchase-guidance`, base HEAD `acb2edc9f9e35ef6d3aa6b0f983785519dca8bee`, plus the reviewed uncommitted work. This preview is not claimed to be a clean main checkout or an uploaded release.

Grok implemented application/test changes. Sol supplied independent analysis and captures. Main reviewed the source, diagnosed failures, reran affected checks, and inspected critical images. Existing unrelated working-tree changes remain separate from this refinement.

Local development services are running and returned HTTP 200 after the final checks:

- Storefront: http://127.0.0.1:3000/
- Staff: http://127.0.0.1:5173/
- API: http://127.0.0.1:3010/api/public/health

The public catalog still contains 32 products. Capture contexts used only public reads and fresh browser-local bags; API writes, quotes, and orders were blocked. Isolated acceptance fixtures used separate ports/database. No ordinary catalog intake, stock refill, configuration change, or order submission was performed.

## Implemented and reviewed

| Area | Result |
| --- | --- |
| Opening and identity | English/LTR, Clash plus Rose for Arabic text; official image-only hero preserved. More compact mobile ticker, section spacing, and product discovery. |
| Product wall | Studio media, preserved 3:4 ratios, readable price/status rows, two columns at 390 and one below 390. No fake popularity, campaigns, or catalog edits. |
| Variant selection | Native Color and Size groups derived from actual public pairs. Exact IDs/prices, quantity limits, initial selection, and bag behavior retained. Unavailable pairs remain readable and nonorderable. |
| Bag and checkout | Clearer grouping and responsive summaries. Fresh submission and saved acknowledgment retain different truthful wording. Quote, submission, recovery, and ordering rules preserved. |
| Customer confidence | Shipping, Returns, Contact pages use confirmed facts and configured links. Privacy/terms remain an unpublished owner/legal draft. |
| Metadata | Public-product titles, descriptions, canonical/share metadata, safely serialized Product JSON-LD, robots and sitemap. Orderable metadata prices exclude unavailable cheaper pairs. Production URLs require a valid public origin. |
| Optional contacts | Shell no longer awaits optional contacts. Contact read has a 10-second deadline and graceful fallback; mobile footer reserves 96px. No stock/quote/order caching introduced. |
| Focus fixes | Header-aware root scroll padding; rail padding preserves outline space; a small client rail wrapper reveals keyboard-focused cards horizontally without locking wheel scrolling. Server-rendered cards/curation remain on the server. |
| Category labels | Natural-width links and small-phone wrapping stop words being fragmented into narrow columns. Existing categories, routes and filtering behavior unchanged. |
| Test infrastructure | Exact-node rendered-font inspection replaces coordinate hit-testing. Windows post-stop EACCES uses a bounded, fail-closed native listener-table check. This is testkit code, not production database startup behavior. |

No backend, contract, persistence/migration, permission, stock, quote, order, recovery, or pricing-rule source was changed in this pass. Earlier staff/category work in the dirty checkout is not presented as newly implemented or reaccepted here.

## Verification ledger

Evidence folders below are under `.scratch/refinement-20261014/verification/`. Failures remain alongside reruns; these results are not combined into a fictitious fresh full-suite pass.

| Gate | Recorded result | Evidence |
| --- | --- | --- |
| Workspace typecheck, architecture, storefront build | Passed | `static-20261015-020401` |
| Metadata/contact helpers | 7 passed, 0 failed | `helpers-20261015-020551` |
| Windows listener helpers, testkit typecheck, architecture | 9 helper tests passed; both static checks passed | `harness-20261015-081900` |
| First homepage attempt | Failed font-probe harness; post-stop IPv6 probe also errored | `home-20261015-020640` |
| Homepage after harness repair | 1 passed; clean teardown | `home-20261015-081956` |
| Twelve affected commerce/recovery cases | 10 passed, 2 failed | `affected-20261015-082136` |
| Those two cases after correction | 2 passed | `failed-20261015-082834` |
| Homepage plus new rail regression | 1 passed, 1 failed: regression threw before its rAF-aware polling could retry | `rail-20261015-085506` |
| Final application typecheck/build | Both passed after the category correction | `static-20261015-090958` |
| Final dependency architecture check | Passed, including the client rail wrapper | `static-20261015-085435/architecture-result.json` |
| Corrected rail regression plus affected product-wall case | 2 passed, 0 failed; clean teardown | `closing-20261015-091004` |
| Final development health/catalog | Three HTTP 200 responses; 32 public products | `dev-health-final.json` |
| Scoped tracked diff whitespace check | Passed; only normal CRLF-to-LF notices | Main verification |

The commerce selection covers exact variant/override prices, hidden sparse pairs and POS retention, bag modal behavior, stock-repair draft retention, quote review, saved acknowledgment after staff confirmation, lost-response replay without duplication, stale quote rejection, analytics, and keyboard access. Unaffected API/full browser suites and audits were not needlessly repeated; no fresh global security or release claim is inferred from this focused pass.

The first ordinary API launch failed before application startup because the temporary PowerShell launcher treated its single argument as a scalar; the launcher was corrected and subsequent starts/health checks passed. The existing ordinary PostgreSQL cluster also reported recovery from an earlier unclean shutdown, completed recovery and became ready. It was not reset or migrated. That startup is not an external backup-recovery drill. Both logs remain under the development startup evidence folders.

## Visual acceptance and its limits

Main inspected representative phone/desktop home, product wall, Arabic and English product pages, modal bag, checkout, customer-information pages, and first/last focused cards.

- Integrated post-rail capture: `captures-2026-10-15T08-58-30-908Z-03b22fa5` — 46 images, no scripted failures or source changes. All eight rail focus captures passed; minimum clearance 0.6875px. One settled Product JSON-LD record at every width, no parse errors, broken images, failed assets, application page errors, or HTTP errors.
- English product supplement: `supplemental-2026-10-15T09-02-36-352Z-f7cebc10` — 8 images. Actual Tapered Twill Pants, sizes 30/32/34/36, Black, EGP 1,099. Size 32 and quantity 1 preserved the exact variant and price in both bags. This supplies multi-size coverage; it does not pretend the ordinary product has multiple colors.
- Final category follow-up: `category-captures-2026-10-15T09-08-49-528Z-8ffd6f15` — 4 images at 320/390/768/1440. No horizontal page overflow, ordinary English words stay intact, all measured category targets remain 44px high. These four views supersede earlier category screenshots; the two CSS declarations do not affect PDP or checkout presentation.

These are separate capture passes, not one uniform final-source screenshot suite. Main rejected the first capture set's clipped focus despite its exit 0, then strengthened the capture checks. Earlier lazy-image scrolling and smooth-anchor timing also required capture-script corrections. The failed zero-image supplemental attempt and all superseded sets remain recorded.

Analytics POST failures were intentionally caused by the no-write capture guard. Development preload and Next Image eager-loading suggestions are recorded; they are not production performance measurements. No physical Safari, touch-swipe, screen-reader or true 200% zoom approval is claimed.

## Confirmed findings versus unknown causes

- The historical duplicate homepage ID did not recur in the strict current checks. Its original cause is unproven; no duplicate-hiding application patch or weakened heading assertion was accepted.
- The CDP font probe's failed coordinate cannot be reconstructed from the trace. Exact DOM-node lookup preserves positive Rose glyph proof without guessing why the hit-test failed.
- Windows EACCES came from the post-stop connection probe, not proof that PostgreSQL failed to stop. Why Windows denied that IPv6 connection remains unknown. The fallback verifies all-address listeners and rejects query errors, timeout, malformed output, or an exhausted deadline.
- Header obstruction and rail clipping were demonstrated with actual geometry and images. The first-frame rail test failure was separately traced to Playwright polling-generator error handling; the final regression keeps strict nonnegative clearance checks and native Tab/Shift+Tab.
- One early desktop capture saw two identical JSON-LD records. Later settled reads and all four final capture widths showed one. No unsupported SEO rewrite was made.

## Scope and review boundaries

Application changes are confined to storefront presentation, variant presentation, customer information, metadata, and optional contact rendering. The exact application file inventory versus the pre-pass snapshot is recorded in `verification/refinement-app-changes-final.json`.

Additional test-only source: `packages/testkit/src/owned-port-close.ts`, its wiring in `postgres.ts`, `tests/scripts/owned-port-close.test.mjs`, the affected storefront specs/support diagnostics, and `tests/scripts/storefront-refinement-helpers.test.mjs`. Existing test cases/hooks remain; one focused rail regression was added. No experimental DOM/CSS injection is shipped; diagnostic experiments live only under ignored scratch paths.

The index is empty. Protected `docs/reviews/bravos-v1-grok-review.md` retains SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Do not stage that already-dirty protected file, scratch logs, stores, local databases, tool installations, or unrelated owner assets. Before a commit, review the bounded staged list/diff separately.

## Remaining release gates

1. Owner review of the current preview and explicit approval of the commit scope. No commit/push is authorized by this report.
2. Approve public contact/support details and factual privacy/terms; publish neither invented legal terms nor account links.
3. Physical iPhone/iPad Safari and Android checks, Windows operator pilot, keyboard/assistive-technology and real zoom acceptance.
4. An explicitly approved production runtime/measurement environment. The earlier automated approval review rejected production startup; it was not retried through another port, host or script. This pass established compile and development behavior only, not production LCP/CLS/INP or low-end-device GPU behavior.
5. Domain/hosting configuration, correct public origin, TLS/proxy/trusted-IP settings, monitoring, hosted Windows CI for the approved commit, and operational recovery/rollback verification.

The authorized sample catalog is sufficient for this evaluation preview. Real merchandise is not retroactively treated as a prerequisite to completing it. Existing Arabic records and their photos were preserved; the owner can replace evaluation merchandise through the existing feature workflows when ready.

Recommendation: accept this bounded local refinement for owner review. Do not label the complete project production-ready or the storefront finally launched until the separate release evidence exists.
