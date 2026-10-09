# Bravos main engineering review — 9 October 2026

This is the coordinating review of [the intern report](production-readiness-intern-report-2026-10-09.md), against main HEAD `741fdf84ae7dd4e92a806b97674ba7e8835c3c08` and the identified uncommitted candidate. The intern report is retained as a historical handoff, including its `Main review: NOT_RUN` state at 16:28 Cairo. This later record supplies the main disposition; it does not rewrite earlier failures into passes.

**Current disposition: bounded local engineering candidate accepted after main review. Production/client-launch acceptance remains blocked.** Source review, fresh affected browser verification, narrow-headline visual review, affected build and release-tooling verification are complete within the scope below. No staging, commit, push, deployment or launch is authorized by this review.

## Standards review

Sol 6.1 High independently reviewed the tracked application/backend changes, relevant new components, CI/scripts and focused regression changes against the fixed HEAD. Documented standards violations: **0 actionable findings**. Smell findings warranting a refactor: **0**. This is a bounded review, not exhaustive proof of every source file.

The trusted Returns clock remains adapter configuration supplied through API composition, with SQL time as the production default and stored replay timestamps preserved. Windows owner-recovery environment cleanup retains private ACL verification and failure closure. The POS category-name addition is an authorized presentation contract field; it exposes no restricted cost/profit data. No new architecture, database migration or permission change was introduced during this main closure.

The subsequent three-file check found no actionable standards or test-quality regression in the narrow CSS fix, headline geometry assertions or identity-aware sales coverage.

## Spec review

Sol 6.1 High found **0 actionable business-rule regressions** within the reviewed candidate. Its two evidence/operation concerns were the refused documented IPv4 staff URL and the earlier shared-machine gate overlap. Their dispositions are separate:

- **Staff URL resolved:** the ordinary Vite process was restarted with a loopback IPv4 command binding. `http://127.0.0.1:5173/` returned 200. No Vite source configuration, routes or authentication behavior changed; ordinary API, Next and PostgreSQL processes were preserved.
- **Gate sequencing deviation disclosed:** the clean HTTP run overlapped static checks, scratch migration and build. Main accepts those successful logs as bounded local evidence, with independent databases for HTTP/migration and the recorded source freeze. They do not prove compliance with the requested exclusive execution sequence. Several raw logs contain success summaries rather than numeric wrapper exits; no exit code is manufactured. The new affected closure run is serialized.

The catalog-media and reporting repairs scope locators to actual customer content/provenance and supply the required receiving branch. Money, refund, stock, privacy and attribution assertions remain. Production ordering, branch inventory, confirmations/reversals, recovery and return policies were not changed by those test repairs.

## Sales failure diagnosis and bounded coverage repair

The original internal selection remains **26 passed / 2 failed**, followed by a separate unchanged **2 passed** rerun. That rerun alone did not establish the cause or combined-suite stability.

The first failed case counted HTTP completions rather than transaction identities. Direct page synchronization and the reconnect retry may overlap; a second request does not by itself demonstrate a second sale. The old red log lacked the operation identities and response statuses needed to determine its actual duplicate effects. The revised test intentionally overlaps uploads and verifies immutable paid facts, one 201 creation, same-identity 200 replays, one persisted sale, exact split tender, acknowledgement and retained FIFO balances. It attaches the actual requests/responses for review.

The second failed case read server sales immediately after local durable-save feedback. The source persists locally before launching synchronization; the red snapshot showed the second sale locally and only the earlier sale on the server. The revised test polls the exact two sale identities and local acknowledgements, preserving distinct operation identity, tender, employee/branch attribution, quantities and stock-once assertions. Application sales logic is unchanged.

Changed closure test: `tests/browser/sales.spec.ts`, SHA-256 `04CE3F509588382F36F4A353EB77E26044A6B6A83EFEC8A98798515CFD4ACAD0`.

## Main visual review

Main opened all **17 original isolated development screenshots** in `after/isolated-captures-20261009/`: homepage 320/390/768/1024/1440; product 390/1440; cart failure/repaired/populated; checkout retry/validation/acknowledgement; POS 390/1024/1440. The synthetic fixture is not representative launch content.

Cart and checkout show distinct failure/retry states, required-field feedback, preliminary totals and honest pending/no-reservation/WhatsApp acknowledgement. Product availability and disabled variants remain clear. POS captures preserve branch context and split-payment feedback. These captures do not prove physical-device, complete accessibility or final brand acceptance.

The original successful capture log contains a hydration attribute mismatch on `#product-search` involving `caret-color: transparent`; its red development issue badge was therefore investigated rather than dismissed. A fresh hydrated four-capture run using `caret: initial` collected no console/page errors, with no warning suppression or development-badge CSS. Main opened home 320/1440 and product 390/1440; the red badge was absent. Evidence: `.scratch/product-ux-review-20261005/after/main-review-captures-20261009/`, including `console-errors.json`, `capture-proof.json` and the retained initial failed harness attempt. This supports a capture-timing/caret interaction diagnosis, not a production runtime certification.

At 320px the English decorative headline genuinely clipped: its container measured 288px, scroll width 335px, and `PRESENCE.` extended to x351.47. A document-level overflow check missed this because the section clipped its contents. The bounded fix changes only the display heading size at widths ≤360px; Arabic/Cairo, wider layouts, assets, tokens and business data stay unchanged. The existing 320px keyboard case now waits for hydration/fonts and measures each text range for complete one-line containment while retaining prior focus and 44px checks.

- `apps/storefront/app/components/home-introduction.module.css`: SHA-256 `A2F9BFCB2CA35F19F38D2C564A305C77030BB489583F078193C40205A4D58A2F`.
- `tests/browser/storefront-keyboard.spec.ts`: SHA-256 `882CAF0C260631E384B3F8154F9E019F878BA45F833BABC1A1E9E3F709A92B9E`.

## Evidence register and final affected closure

Earlier evidence independently checked: HTTP **31 files / 246 passed**; typecheck **23 workspace projects**; architecture **335 modules / 1013 dependencies**, private-import check **285 files**; pure script tests **14 passed**; migrations **001–035** with rollback/reapply probes; successful full build and bundle guard. Full/production audits after the Next 16.3.8 refresh contain zero advisories with 776/458 dependencies and no muted entries. These are dated local results. Retain the incomplete-install HTTP run, pre-refresh audit findings, failed capture harness attempts and missing numeric-wrapper caveat in the intern report.

The original public run remains **36 passed / 1 failed**, followed by a separate one-file pass. No fresh public 37/37 or full browser-suite result is claimed.

The fresh **32-case** closure selection comprises `offline-sync.spec.ts`, `pos-workspace.spec.ts`, `sales.spec.ts`, `session-transition.spec.ts` (the 28 internal cases) plus `storefront-keyboard.spec.ts` (four additional cases). It is distinct from the old 28-case source/run. It uses pinned Node 22.23.3, traces, JSON and numeric exits; actual attempts follow.

### First fresh 32-case result and trace-reviewed repairs

The first selection recorded **30 passed / 2 failed / 0 skipped / 0 flaky**, exit **1**, 354.09 seconds. It started at `2026-10-09T18:19:36.609Z`; the numeric wrapper finished at `18:25:30.757Z`. All four keyboard cases and the two previously repaired sales cases passed. Evidence: runtime `.local/main-review-internal-keyboard32-20261009.{log,json}`, `.local/main-review-internal-keyboard32-exit-20261009.json`, and `.local/main-review-internal-keyboard32-results/` traces. This red run is retained.

High review diagnosed the newly failing two-tab offline-sync test from its trace: the local pending sale existed; the page's blockers were removed, a retry began, and only then was the context holding gate installed. That retry returned 201 with the original sale/operation/content digest and availability 1. The error page showed zero unsynchronized sales. This proves the request escaped the test gate, not a lost durable sale. The bounded fix installs the context gate before removing page blockers; one held operation, both-tab acknowledgement, one server sale and stock-once assertions remain. The original failure did not reach those post-release assertions and is not relabelled as a completed serialization check.

The rapid-cart case also asserted transport synchronously after local-save feedback. Its trace records an old quantity-one quote followed by the replacement quantity-two quote, then fails with no observed completion request. The original trace does not prove eventual synchronization. The repair records both quote identities, polls the exact replacement server sale and local acknowledgement, rejects old-quote completion, checks every retry's quantity-two/28,000-piaster payment, one creation response, one persisted sale and remaining stock 4. Stale-price editing guards remain. Both repairs are tests only; fresh execution is required.

Final source identities for that rerun:

- `tests/browser/offline-sync.spec.ts`: `382D447E6CC6DFD19F4F129FEFF963BF5D6AB0B1F310518417F1C7E6A51D8C04`.
- `tests/browser/sales.spec.ts`: `F65E365B763525A36FF02B631F3ACF30D57349EA72A44AAA9E88B61FC4A4B088`, superseding the earlier `04CE…` test boundary.

### Fresh repaired 32-case selection

The same complete selection on those final test hashes passed **32/32, 0 failed, 0 skipped, 0 flaky**, exit **0**, in **324.624 seconds**. JSON start: `2026-10-09T18:27:44.399Z`; numeric wrapper finish: `18:33:09.1025682Z`. Main independently read the JSON and exit record. Evidence: runtime `.local/main-review-internal-keyboard32-rerun-20261009.{log,json}`, `.local/main-review-internal-keyboard32-rerun-exit-20261009.json` and the corresponding retained trace results.

Main also decoded the attached completion evidence: the intentional split-sale overlap produced statuses 200/201 with a single sale/operation identity, identical total 85,000 piasters and cash/online amounts 40,000/45,000. The rapid-cart case recorded quote quantities 1 then 2, followed by one 201 completion for the replacement identity at 28,000 piasters. The passing tests separately verify acknowledgements, single persistence, attribution and stock effects. Both failures from the first 32-case selection are now covered within this one fresh passing context; neither original trace is retrospectively called a pass.

### Affected build, captures and release-tooling finding

The affected storefront `next build` completed with exit 0 at 18:33:56 UTC; the separately wrapped bundle guard also exited 0. Its count of 236 storefront files included 163 development artifacts alongside 73 production-area files. Independent High review checked fresh production metadata and explained that the count is not evidence of payload growth. The prior 201-file result lacks an archived subtree breakdown; no exact growth attribution or SF-11 performance conclusion is made.

That inspection found a pre-existing tooling gap: any JavaScript/HTML under `.next` could satisfy the check for a production build. Main authorized a bounded two-file fix: require supported production BUILD_ID/manifest/static assets, exclude the exact `.next/dev` subtree from production scanning/counts, and retain every existing privacy/import/export check. Ten new pure regression cases cover development-only rejection, invalid/missing metadata/assets, traversal into development output, correct production counting and genuine production privacy leaks. The final verification below closes that finding. It required no application rebuild or browser rerun because application source was unchanged.

Main opened all three completed-motion post-fix images in `.scratch/product-ux-review-20261005/after/main-review-headline-fit-20261009/`. The capture test passed, exit 0, in 57.1 seconds, with empty console/page-error collections. At 320px the font is 32px and container/scroll width both 288px; each headline line occupies one complete range and `PRESENCE.` ends at x287.797. The 390px font remains 42px and desktop 118px. Document widths match all three viewports. The narrow fix is visually accepted within this development fixture; final production/brand/content acceptance remains open.

At `2026-10-09T18:36:57.816Z`, the 572-file source comparison had zero changes across the fresh browser/build/capture sequence and zero root/runtime mismatches. All isolated ports were stopped, the 149 historic control files were unchanged, and index/protected hash/data preservation checks passed. The later two-file guard patch is a separate source boundary verified below.

### Final tooling and source closure

Main reviewed the complete incremental two-file diff. Independent Sol 6.1 High integration review found no actionable regression: retained production metadata satisfies the new check, only the exact development subtree is excluded, and all production privacy/import/service-worker/export checks remain active. Final syntax check, both pure suites and retained-build bundle guard ran sequentially under the pinned Node and each has a numeric exit **0**. Main read the actual pure summary and bundle result.

| Command in isolated runtime | Result | Exact local evidence |
| --- | --- | --- |
| `node --check scripts/check-bundles.mjs` | exit 0 | `runtime/.local/main-review-bundle-syntax-final-20261009.log` and matching exit JSON |
| `node --test tests/scripts/storefront-performance.test.mjs tests/scripts/check-bundles.test.mjs` | **24 passed, 0 failed/skipped**, 1,838.423ms, exit 0 | `runtime/.local/main-review-pure24-final-20261009.log` and matching exit JSON |
| `node scripts/check-bundles.mjs` | **34 internal / 73 storefront production-area / 3 static entry files**, exit 0 | `runtime/.local/main-review-bundle-guard-production-final-20261009.log` and matching exit JSON |

The 163 development artifacts remain in place and are excluded from this final production count. The genuine 18:33 production build was retained. No rebuild, browser repeat or production server was needed for this tooling-only patch. Counts do not measure payload size or close SF-11.

Final tooling SHA-256:

- `scripts/check-bundles.mjs`: `93BDE9872646B060BF117F5DE8C8BB617556857C7580F44B7A46BCA8C87736D7`.
- `tests/scripts/check-bundles.test.mjs`: `5F2BE4E0ABB8D2445697F7E65BE3CA176FE007A0CED8CC7CCF41C35A4F4305A7`.

At `2026-10-09T18:42:57Z`, `.scratch/product-ux-review-20261005/after/main-review-bundle-production-final-20261009/closure-proof.json` and `source-final.json` record **572 source pairs / zero mismatches** and exactly these two approved tooling changes since the prior capture closure. Isolated ports are free; 149 historic controls are intact. Ordinary API/staff requests and storefront static HEAD returned 200, with unchanged process/data facts. The index is empty, protected digest matches and `git diff --check` exits 0.

Main closure changes are limited to the display CSS, three browser test files, bundle script/pure test and dated review documentation. Staff IPv4 repair was a run-command change only. No application ordering, stock, payment, permissions, recovery, database or route change was made during this closure. The wider candidate still includes its previously authorized POS, composition/security and UX changes documented in [the candidate inventory](candidate-file-inventory-2026-10-09.md); this sentence does not relabel the entire candidate as presentation-only.

## Preservation and release boundary

Ordinary data remains two products, two variants, two cost batches, four sales, zero orders; Abshway balances 25/29; active Fayoum delivery fee 5,000 piasters (50 EGP). Latest stored analytics is from 7 October. Captures and transaction verification use isolated fixtures. The existing 149 historical end-to-end control files were retained.

The unrelated `docs/reviews/bravos-v1-grok-review.md` remains excluded and protected by SHA-256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Raw fonts, unrelated outputs, dependency stores, local data, generated builds, logs, credentials and screenshot harnesses are excluded from a future commit boundary. Final index, source pairing and owned-process cleanup checks are recorded above.

**Hosted CI remains NOT_RUN and blocked until publication and hosted execution are explicitly authorized.** This supersedes the intern report's ambiguous statement that it is authorized after publication. No publication is performed here.

Still open: approved real assortment/content/photos and final brand/font review; real iPhone/iPad Safari and Android Chrome/offline/keyboard checks; actual 200% browser zoom and screen reader; permitted representative production performance; hosting/TLS/proxy/persistent data/media/monitoring; external restore/owner-recovery drill and staff training; reconciled internal pilot, then separate public launch approval. The historical production-launch rejection (`rejected: blocked by policy`) remains; no retry or workaround was attempted.

The opening-CSV purchases classification is unanswered. Current reporting behavior remains unchanged. SF-11 and SF-12 remain partial; this review assigns no completion percentage or production/launch approval.
