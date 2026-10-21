# Business UX and Windows verification follow-up — 18 October 2026

## Decision

Grok implemented the bounded UX refinements and Windows test-launcher correction. Main reviewed the source, obtained independent reviews, and accepts this bounded pass after local engineering and visual verification. The original focused browser run had 16 passes and three failures; a separate six-case run passed after the selector/copy corrections and the backup retry fix. These are separate runs, not a fresh 19/19 result. This is not client acceptance, a green hosted CI result, or a release approval.

The staff preview at `http://127.0.0.1:5177` now serves the rebuilt changes, including backup retry. Served assets were checked against the local build. The three practice services remain available. Verification did not submit practice sales, orders, receipts, expenses or refunds; the visual supplement explicitly allowed normal POS snapshot metadata issuance so the real product browser could be inspected. All transactional test writes used isolated test databases.

## What changes for users

| Area / application files | Reason and resulting experience |
| --- | --- |
| `apps/internal/src/pages/ReceivingPage.tsx` | Keep routine receiving first. Move low-stock information ahead of history. Receipt and purchase-batch archives use named expandable sections with bounded scrolling. Selected receipt details and correction forms remain outside the collapsed archive. Replace visible technical variant wording with size/color wording. |
| `apps/internal/src/pages/LookupPage.tsx` | Actual size/color pair buttons are the immediate choice. Existing dropdowns remain available in an explicitly named expandable section. Browsing focuses a visible pair button rather than a hidden select. |
| `apps/internal/src/pages/CatalogPage.tsx` | Individual online variant switches remain primary. Bulk size/color selection is secondary, with its effect on registered combinations explained. |
| `apps/internal/src/pages/OnlineOrdersPage.tsx` | Keep actions, dates, reasons and receiving branches visible. Move exact staff identifiers into attribution details; do not invent employee names. |
| `apps/internal/src/pages/ReturnsPage.tsx` | Use consistent receiving-branch wording and a plain confirmation action for receipt/inspection. Keep the separate refund step and actual owed/paid amounts. |
| `apps/internal/src/pages/ExpensesPage.tsx` | Show the effective expense first. Keep cancellation reasons visible; put the unchanged original record and audit history in a named expandable section. |
| `apps/internal/src/pages/BackupPage.tsx` | Put the data scope and image exclusion in plain language. Keep the unsynchronized-sales warning visible. Detailed contents remain available without pushing the form down. A demonstrated readiness failure now has a real retry using the existing account/version/abort-guarded refresh, preserving password drafts and keeping download disabled until readiness recovers. |
| `apps/internal/src/pages/ReportsPage.tsx` | Make current/global versus period/filter scope explicit beside the figures. Keep opening-stock exclusion and incomplete-cost warnings visible. |
| `apps/internal/src/styles.css`, `styles/tokens.css` | Strengthen field and secondary-action boundaries, primary-action hierarchy, light-theme active navigation, enabled danger-action text and error text. Preserve the existing brand, fonts, themes, focus styling and green checkboxes. |
| `apps/storefront/app/cart/cart-summary.tsx`, `app/checkout/page.tsx` | Remove repeated price-review prose and a false claim about available footer contact links. Keep COD, non-reservation, WhatsApp confirmation and uncertain-submission safeguards. |

These choices apply the requested design skills in preserve mode. They do not authorize a dashboard redesign or a new component library. The usability references are [WAI design guidance](https://www.w3.org/WAI/tips/designing/), [form labels](https://www.w3.org/WAI/tutorials/forms/labels/) and [Fluent action hierarchy](https://fluent2.microsoft.design/components/web/react/core/button/usage/).

The browser test changes open the specific newly expandable sections before interacting with their controls and update intentional wording/focus assertions. Business assertions and hooks remain. Main's independent review found a Locator-scoping defect in the new `tests/browser/support/open-lookup-lists.ts`; Grok corrected it to a relative `details:has(#lookupSize)` selector. The subsequent browser checks exercised the corrected helper; the POS visual supplement also confirmed pair focus and preserved dropdown selection.

## Evidence and limits

All current logs below are under `.scratch/business-ux-ci-20261018/`.

| Check | Actual result |
| --- | --- |
| Baseline visual/contrast audit | Runtime evidence established faint field boundaries (1.24 dark / 1.45 light), light active-navigation text at 3.53, and a receiving document over 54,000 pixels tall. These are **before** measurements, not measurements of the new CSS. Nine representative native screenshots were individually opened; the remaining 133 baseline captures are unreviewed. See `ux-baseline/review.md`. |
| Independent UI source review | No additional definite functional regression identified beyond the helper defect subsequently corrected. Covers draft/detail reachability, visible warnings, attribution, pair selection and specific disclosure interactions. See `ux-final-independent-review.md`; that review's helper hash is historical. |
| UI syntax transform | Ten changed TSX files parsed successfully using esbuild. `ui-syntax-review.log`. This is not TypeScript typecheck. |
| Workspace typecheck | Passed across 23 workspace projects in `final-typecheck-corrected.log`. The earlier TS2375 failure is retained in `final-typecheck.log`; Grok corrected the native child's optional `pid` type. The later backup-only edit also passed affected internal typecheck in `backup-retry-typecheck.log`. |
| Architecture | Passed: 780 modules / 1,359 dependencies and the private-import check over 716 files. `final-architecture.log`. The later backup edit adds no imports or module boundary changes. |
| Staff build | Passed in `final-staff-build.log`, then passed again after the backup retry in `backup-retry-build.log`. Service-worker generation passed. |
| Pure Windows launcher/diagnostics/teardown tests | **28 passed, 0 failed**, pinned Node 22.23.3. `windows-start-pure-corrected.log`. Earlier 5-pass/4-fail launcher-only result is retained in `windows-start-pure-initial.log`. |
| Affected browser test discovery | **53 tests collected in 9 files**, exit 0. `affected-test-discovery.log`. None was executed by that command. |
| Native Windows database probe | Passed with a fresh `native-probe-completion.json`: quoted database name, successful `select 1`, stop, process exit 0 and no listener left on owned port 55501. `windows-native-corrected.log` is empty because this successful probe is intentionally quiet. |
| HTTP integration | **34 files / 260 tests passed**, exit 0, pinned Node 22.23.3. `final-http.log`. No overlap with another heavy verification run. |
| Focused browser run | **16 passed / 3 failed** in `final-browser.log`: backup and expense summary role selectors; receiving's old exact sentence after stock and branch text were combined. Artifacts preserved in `browser-first-run-artifacts/`. |
| Corrected browser recheck | **6 passed**, exit 0, in `final-browser-corrected.log`: all three backup cases, expense correction, and both affected receiving cases. Includes all three previously failed cases, actual readiness failure/retry with draft retention, encrypted download, role isolation and late account-change protection. Not a fresh full 19-case run. |
| Controlled readiness failure | Before fix: error visible, no retry, exit 1; retained in `ux-error-probe-before-fix/`. After fix: actual failure, retry GET 200, recovered readiness and error-text contrast **7.13:1**, exit 0 in `ux-error-probe/report.json`. Main opened both after PNGs. |
| Diff whitespace | `git diff --check` passed. CRLF normalization warnings are not runtime failures. |
| Practice health | API 3012, staff 5177 and storefront 3002 returned HTTP 200 in the final `post-verification-health.json` check. Staff serves the rebuilt changes and its served build identity was checked. Storefront stays Next development. |
| Memory preflight | Historical blocked check at 15:45 UTC: 3,203 MB physical / 1,885 MB virtual in `final-memory-preflight.json`. The owner then freed memory; the unchanged 3,000/4,000 MB guard passed before each later heavy run. The earlier blocked status is resolved. |

Earlier business acceptance remains recorded separately in `client-acceptance-main-review-2026-10-18.md`. Those successful sales, confirmation, return, backup and offline-sync checks are historical evidence. They do not prove this new staff build was visually reviewed.

## Windows hosted CI

Fresh GitHub inspection confirms PR **44** remains open/draft on `codex/ux-purchase-guidance`, published head `6eacfa8a4846275cfe8294a48df31ee109fcd659`. Run **38912267680** has successful static/build checks and failed HTTP/browser jobs. This follow-up has not been published or rerun in GitHub.

Confirmed: the pinned embedded-postgres dependency loses the reason when its native server closes before readiness. The hosted browser job failed before tests started; HTTP setup failures then produced secondary teardown errors. The underlying hosted native exit cause is **unknown**. Missing parent environment, locale and DLL problems remain hypotheses, not established root causes.

`packages/testkit/src/windows-postgres-start.ts` now launches the installed Windows binary with inherited environment, `LC_MESSAGES=C`, bounded readiness and useful redacted native failure details. `packages/testkit/src/postgres.ts` retains the owned child, uses an escaped database identifier through the public client on Windows, and stops the owned process before deleting temporary data. It does not write into dependency-private process fields. Existing diagnostic and port-close helpers remain required dependencies. The CI script-test command includes the new launcher tests.

The first implementation failed local review: database creation depended on an unset private dependency process, and four tests treated `assert.rejects` as returning an error. Grok corrected those defects and the owned-child fallback. Independent final review established no remaining P0/P1 source defect; see `ci-final-independent-review.md`. The earlier native probe reproduced the database-creation failure; its exit 0 does **not** make it a pass. The separate corrected probe and the full Windows HTTP suite now pass locally; they do not establish the underlying historical hosted exit cause.

Conditional limit: an exceptional failed kill can leave an owned process and its scratch directory behind. The code avoids deleting unconfirmed-live data. Supervise the isolated native probe's owned port/process on failure; require a fresh completion marker plus the current exit code. Do not treat an older marker as evidence of a new pass.

## Visual review and remaining sequence

The independent reviewer individually opened all 22 native PNGs in `ux-after-build/`; main opened 12 key images. Brand, readable controls, scope labels, selected details and the default desktop backup action were accepted without a new blocking visual defect. Actual field-side border contrast is **5.04 dark / 3.43 light**; light active-navigation text is **14.78**. The approved dark identity and Cairo remain.

That first collector had evidence gaps, preserved in `ux-after-build/visual-review.md`: its initial 2,219px receiving-height reading preceded a late detail render, and the last 308px of the settled **2,527px** document was not captured. The archive panels also extended slightly beyond that first frame. POS snapshot metadata was blocked and a pending-only order list hid the existing delivered order. These were collector gaps, not demonstrated application defects.

The six PNG supplement in `ux-supplement/` reaches POS and the actual delivered `BRV-000001` directly, verifies visible pair focus and preserved dropdown selection, captures the settled receiving bottom, and shows both 448px archives fully inside the viewport at their content bottom. Main opened all six. No page errors or horizontal overflow were recorded. The delivered order has no enabled danger control, so no live destructive-button hover pass is claimed. Two normal snapshot metadata POSTs are recorded; no sale/order/stock command was submitted.

One supplemental phone framing check placed the backup button on the fractional viewport boundary; it is retained as a failed capture-boundary check, not called an application failure. The separate `ux-final-frames/` run passed all recorded checks and generated four PNGs, all opened by main. It shows the order status/date/attribution together, the settled receiving bottom, both archive bounds and the complete phone backup action (Y891–942 inside a 1,000px viewport). No page errors, horizontal overflow or business writes were recorded. Served assets match the new build and source hashes remained stable.

Across these separate runs, 34 after-build PNGs were individually inspected: the independent reviewer opened all initial 22; main opened 12 of those plus all six supplement, two corrected error/recovery, and four final-frame images. This does not claim every intermediate archive row, every staff page at every width, or a live enabled destructive-button hover was reviewed. The original storefront-wide visual evidence is separate; this pass did not redesign its layouts.

Remaining procedure: present this reviewed pass for owner approval before staging/publishing. After an approved publication, inspect a fresh Windows GitHub run before claiming the hosted failures resolved. Client acceptance remains the client's decision. No additional feature or storefront redesign is required to complete this bounded pass.

## GitHub issue scope

Five issues remain open; this pass closes none automatically. Their older Arabic/search/real-photo criteria are superseded by later user decisions.

| Issue | Current disposition |
| --- | --- |
| #33 — Homepage story | Image-only hero direction supersedes the older story requirement. Confirm the actual current homepage visually; do not add a campaign to satisfy obsolete wording. |
| #38 — Product chapters | Optional factual sections; never fabricate facts or empty storytelling. Not a required addition to complete sample-catalog commerce. |
| #41 — Production performance | Actual permitted production measurements remain separate from this local UX pass. Development preview is not production performance evidence. |
| #42 — Integrated quality | Keep current after-build visual/runtime verification and client acceptance separate from older engineering results and external release gates. |
| #1 — Delivery umbrella | Mixed engineering, owner acceptance and release criteria. Do not close on the strength of local source edits. |

## Change control

No API contracts, routes, schema, permission rules, stock/order/recovery algorithms or business data were changed in this bounded pass. Application edits are presentation, focus and disclosure organization; the launcher changes affect development/test infrastructure. Existing unrelated dirty files and prior category/sample-catalog work remain separate review scope.

Nothing was staged, committed, pushed, merged, deployed or closed. The index remains empty. The protected review file was not opened or edited; its SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.
