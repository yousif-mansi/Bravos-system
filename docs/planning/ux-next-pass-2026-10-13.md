# Bravos next UX pass — 13 October 2026

The owner requested specific UX improvements, delegated implementation and focused verification instead of repeating already-passing gates. PR43 is merged as `acb2edc`; its tree matches the verified `e3f79c7` candidate. This pass starts on `codex/ux-purchase-guidance` from that merged baseline. Main owns product direction, integration and final review; Grok remains the primary code implementer. Sol supplied a read-only friction inventory.

## The five open issues

| Issue | Current disposition | Work still needed |
| --- | --- | --- |
| #1 — v1 delivery | Keep open as release umbrella | Approved operational data, staff pilot, permitted runtime, hosted security/monitoring, external recovery/rollback and release decisions |
| #33 — homepage story | Existing hero/cover/navigation implemented; final content/brand acceptance pending | Owner-approved representative merchandise/photos/copy and final production visual acceptance; do not invent campaigns |
| #38 — factual chapters | Optional, content-deferred | Approved fit/fabric/care/style facts; absence does not block commerce |
| #41 — performance | Tooling ready; measurements outstanding | Permitted production execution and representative matched measurements; do not substitute dev timings |
| #42 — integrated quality | Engineering coverage exists; targeted UX gaps addressed below | Actual devices, real zoom/speech/manual contrast and final production/customer/operator acceptance remain separate |

These issues are not discarded and cannot be honestly closed by adding unrelated features. Owner/content/device/infrastructure gates remain explicitly open. No production startup workaround, deployment, fabricated content or unrequested architecture work is included.

## Team assignments

| Task | Owner and exact scope | Acceptance |
| --- | --- | --- |
| UX04 — Quantity correction guidance | Grok A: `products/[productId]/product-purchase-panel.tsx`, its existing CSS module, and the existing commerce browser scenario | Invalid whole-number/minimum/remaining-stock quantity explains why Add is disabled. Input description and mobile repair affordance are clear. Valid correction removes feedback; exhausted-stock messaging stays distinct. Existing bounds, selected variant, pricing, add/deduplication and cart logic remain unchanged. |
| UX05 — Keep filter reset in product discovery | Grok B: reproduce in the existing collection-heading scenario first; if confirmed, change only relevant clear/remove/all-category/empty-result link destinations in `filter-chips.tsx`, `collection-controls.tsx`, home `page.tsx` as needed | Clearing the last filter reaches the all-products heading/wall rather than restarting at the large home introduction. Existing query/category/sort semantics and browser Back remain intact. Use a catalog fragment on existing routes, no global URL-helper rewrite. If not reproduced, report no fix rather than manufacture one. |
| Integration and visual review | Main | Inspect actual diffs, retained assertions and isolated 390/1440px captures; no unrelated redesign or inferred conversion gain |

Independent code scopes may run in parallel. Grok B alone owns the local isolated browser stack during UX05 diagnosis; Grok A runs no servers/builds/tests concurrently. Final shared gates are serialized after both implementations stop writing. Protected review, ordinary data/media/queues, fonts, internal app, APIs, contracts, stock/order/recovery rules and dependencies are untouched. No automatic commit or push.

## Verification budget

- Reuse and strengthen the **existing product-commerce case** and **existing collection-heading/filter-reset case**; no new broad duplicate suites or weakened assertions.
- UX05 needs one reproduction and, only if a defect is demonstrated, its focused rerun. Record red and green separately.
- Main runs the two affected cases together once after source review, one worker, using the existing isolated development harness and pinned runtime.
- Run workspace typecheck and storefront compilation once for the assembled changes. Run architecture checks if a new import/public boundary is introduced; no new dependency is planned.
- Do not repeat API, database, backup/restore, offline POS, full162-browser or full254-API runs for presentation-only edits. Broaden only if a real failure or behavioral change warrants it.
- Development screenshots prove layout/feedback only; they do not close representative brand, physical-device or production-performance gates.

## Handoff

Each implementer returns exact files, reasons, retained behavior, actual checks/captures and remaining limitations. Main integrates only reviewed work, reports the focused evidence and requests approval before committing. The next release steps remain the five issue-specific gates above, not an unrelated new feature phase.

## Completed bounded UX work and main verification

Grok A completed UX04 and Grok B completed UX05; both relay results and implementer processes exited 0. Main inspected the assembled seven-file source/test diff, retained commerce assertions, existing URL helper and mobile/desktop CSS. Main added only two portable error-state screenshot hooks to the existing commerce case for visual review. There are no API, contract, database, permissions, price, stock, order, recovery, dependency or internal application changes in this UX implementation.

UX05 was demonstrated before changing production source: clearing the last filter at 390px returned to `/` with scrollY 0 and the catalogue title between y1126.75 and y1161.55 in an 844px viewport. Its strengthened viewport assertion failed. Grok then changed five existing clear/remove/all-category/empty-result links to target `#catalog-title` while retaining query/category/sort construction. Grok ran the same case successfully three times while correcting screenshot capture position; these are repeated runs of one case, not three separate acceptance cases. The earlier red remains in `.scratch/ux-next-20261013/collection/red-baseline.log`.

Main's independent assembled verification on pinned Node22.23.3 used the existing isolated database and development harness, sequentially:

| Gate | Actual result | Evidence |
| --- | --- | --- |
| Existing commerce case + existing collection-heading/reset case, one worker | 2 passed in31.9s; command including teardown exited0 | `.scratch/ux-next-20261013/main/browser.log` |
| Workspace typecheck | Passed; exit0 | `.scratch/ux-next-20261013/main/typecheck.log` |
| Storefront build, compilation only | Passed; exit0 | `.scratch/ux-next-20261013/main/storefront-build.log` |

Exact commands, timestamps and numeric exits are in `.scratch/ux-next-20261013/main/results.json`. No full browser/API/database/backup/offline suite was repeated for the UX changes. No new module boundary was introduced, so architecture checks were not repeated. Generated Next files were restored to their original bytes; the protected review remains SHA2563361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A. The index remains empty.

Main opened the four fresh 390/1440px quantity-error and catalogue-anchor viewport captures in `.scratch/ux-next-20261013/main/browser-output/`. Error guidance and catalogue position are visible and consistent with the current dark design. These are development captures with isolated synthetic fixtures and no product photography. The development Next indicator partially overlays the mobile repair-link area; this is not evidence of a production overlay or final brand acceptance. Real content, physical devices and permitted production visual/performance checks remain outstanding.

### Separate newly observed main CI failure

After the PR merge, main run38415557654 completed with a browser failure:161 passed,1 failed. The exact-tree pre-merge candidate run38338141884 had162 passed. Preserve both results separately. The new failing case is `tests/browser/sales.spec.ts:722`, “two open tabs keep a physically completed marker and save that sale once”: its retry-status poll at line881 expected200 but saw the fallback0 after15000ms. This proves no completed retry response was observed in time; it does not prove an HTTP0 response or a particular root cause. Static/build and PostgreSQL/HTTP jobs passed.

Sol6.1High supplied read-only source/log analysis. A workspace refresh cancelling an in-flight shared synchronization promise, followed by a30-second background retry, is a hypothesis requiring evidence. Grok receives one bounded existing-case local investigation, with no source edits or broad reruns. A Windows pass cannot erase the Linux failure or establish its cause. Keep #1/#42 open until this is resolved alongside their external launch gates. Do not declare the new UX branch or merged main fully release-approved.

The bounded Grok local diagnostic subsequently ran the existing two-tab case once successfully: **1 passed in58.9s**, process including teardown exit0 at2026-10-13T15:25:25.654Z, pinned Node22.23.3/pnpm10.34.5. Full evidence is in `.scratch/ux-next-20261013/sync-diagnosis/browser-run.log` and `run-meta.txt`. Its first launcher attempt failed before any test because Start-Process split the spaced pnpm path (`Cannot find module 'C:\\Users\\Yousif'`); main preserved that separate harness failure under `launch-attempt-1/`, and Grok retained `launcher-quote-error.log`. This was one executed acceptance case following a failed launcher, not two acceptance runs. The Windows pass is separate from the two UX cases and the failed Linux full run.

Main compared watched before/after source hashes: no difference. Protected review remains exact, index empty, and all isolated LISTEN ports are free; runner's `BUSY` after-state rows were TCP TIME_WAIT entries with pid0, not running servers. No synchronization fix was implemented because the Linux root cause is still unconfirmed. Historical proposed follow-up, now **cancelled by the owner**: reproduce/diagnose that single Linux case with lifecycle/request evidence. Do not execute that proposal. Durable-sale/no-duplicate assertions remain important for supported-platform verification; stock and offline architecture are unchanged.

Grok's diagnostic relay and process both completed with exit0 (session `01a135d5-efbf-73b2-abda-be91bfc6a830`); report is `.scratch/ux-next-20261013/sync-diagnosis/report.md`. Main reviewed its source references and retained root-cause uncertainty rather than approving speculative synchronization changes. #42 now records the verified local UX work, separate Windows diagnostic pass and unresolved Linux failure. All five original issues remain open for their actual remaining criteria; #38 is explicitly optional/content-deferred. This UX pass consists of seven reviewed source/test files plus this plan, and remains uncommitted pending owner approval. The pre-existing protected review and unrelated local report/assets are excluded.

## Superseding owner instruction — Windows scope; Linux follow-up cancelled

The owner explicitly rejected Linux support and Linux-specific work after reviewing the above report. The proposed Linux reproduction/investigation is **cancelled**, not a next assignment or release gate. Earlier paragraphs and logs retain historical evidence only; do not resume that task. All subagents and Grok jobs from this pass had already stopped, and no Linux CI jobs are active. All local UX builds and executed tests above ran on Windows. No Linux-specific application or synchronization changes were implemented, so there is no Linux application patch to revert. The two verified platform-independent storefront UX fixes are retained.

The sole Linux execution configuration changed here is `.github/workflows/ci.yml`: all three job runners move from Ubuntu24.04 to Windows2025; Chromium installation drops the Linux OS-dependency installation flag. Existing pinned tools, audit, architecture, build, HTTP, browser and assertion gates remain intact. No deployment platform, architecture, dependencies, business data or stock/order rules are changed. Shared cross-platform code and historical reports are preserved rather than deleted indiscriminately.

This workflow edit is local, uncommitted and unpushed; GitHub's main workflow still has its old runner configuration until an approved commit/push. No full suite is repeated for this cancellation. Perform a structural YAML/runner/retained-gate check only; hosted Windows execution remains unverified until publication. The remaining product priorities are supported-platform customer/operator acceptance and representative content, with the existing operational/device/performance launch gates. A general synchronization defect would still require a demonstrated Windows/supported-browser failure; the historical Linux result is not relabelled as a pass.
