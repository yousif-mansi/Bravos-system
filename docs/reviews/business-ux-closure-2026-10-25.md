# Business UX closure and Windows verification — 25 October 2026

This follows the 18 October business UX review. It covers the remaining staff usability defects and the dependency-audit failure, without redesigning the product. Application implementation was delegated to Grok; main reviewed the diffs and ran verification. No production or client-acceptance approval is implied.

## Repository and publication boundary

Current candidate: `codex/ux-closure-20261022`, based on `bd2a94cea1084c86935c6eb538a17dd2ae86e4ac`. GitHub main was rechecked on 25 October and still points to that commit. PR #44 is already merged. Its last main run, [39589220976](https://github.com/yousif-mansi/Bravos-system/actions/runs/39589220976), failed at dependency audit; downstream gates did not establish acceptance of this candidate.

The owner approved committing this reviewed 18-file candidate, pushing `codex/ux-closure-20261022` and opening a PR on 25 October. After publication, inspect a fresh Windows GitHub run before closing the hosted verification gap. This report records the pre-publication evidence; the PR records the resulting commit and checks. No automatic merge, deployment, issue closure or production operation is authorized by this report.

## Changes and business purpose

| Candidate file | Reason |
| --- | --- |
| `apps/internal/src/pages/CorrectionsPage.tsx` | Resolve an exact readable sale/return reference through existing authorized readers; preserve UUID links, ambiguity handling, account-change guards and uncertain-operation IDs. Bind cached display references to their record ID and type. |
| `apps/internal/src/pages/StockCorrectionsPage.tsx` | Show product/SKU, size, color and branch beside late-sale cases; retain audit identifiers in details. Distinguish loading/read failure from a successfully empty list, with a GET-only retry. |
| `apps/internal/src/pages/OffersPage.tsx` | Freeze the submitted draft and competing automatic-offer actions while pending. Keep accepted saves/toggles successful when only the following list read fails; disable stale-row actions until reload. |
| `apps/internal/src/pages/CouponManager.tsx` | Apply the same truthful save/read feedback and draft protection independently to coupons, preserving all coupon validation and pricing inputs. |
| `apps/internal/src/pages/StaffPage.tsx` | Separate accepted account/grant/disable writes from failed list refreshes; expose list-only retry without repeating the write. |
| `apps/internal/src/pages/SalesPage.tsx` | Show confirmed-order loading/error/retry explicitly. Show branch-sales empty copy only after a successful remote read, while retaining locally completed sales on read failure. |
| `apps/internal/src/pages/RecoveryPage.tsx` | Prevent overlapping recovery submissions, freeze both forms during the active request and replace stale success feedback. Existing enumeration-safe wording and endpoints remain. |
| `apps/internal/src/pages/RestorePage.tsx` | Expose the existing guarded explicit state refresh before a preview is selected. Background polling does not erase shared staging/activation warnings. |
| `apps/internal/src/pages/WorkspacePage.tsx` | Make the existing offline-ready status visible using an existing class; readiness conditions and test hook stay unchanged. |
| `apps/internal/src/styles.css` | Scope wrapping to the Opening Import CSV schema text so it cannot widen the narrow RTL viewport. CSV contents and file/import behavior stay unchanged. |
| `apps/internal/package.json` | Patch internal Vite to 7.3.7. |
| `package.json` | Patch Vitest to 4.1.12 and apply the Vite 7.3.7 override. Runtime and package-manager pins remain unchanged. |
| `pnpm-lock.yaml` | Record only the reviewed patch-version family and matching peer resolution changes. |
| `tests/browser/corrections.spec.ts` | Cover exact references, ambiguity, pagination/cursor failure, UUID links, account changes and record-bound recovery labels. Existing business correction case retained. |
| `tests/browser/stock-corrections.spec.ts` | Cover failed/read-retry states, variant/branch identity and unresolved identities without inventory writes. Existing stock-correction workflow retained. |
| `tests/browser/business-ux-feedback.spec.ts` | Cover pending actions, accepted-write/failed-GET feedback, stale-list protection, cashier visibility, recovery feedback, ready-state visibility and branch-sales read recovery. |
| `tests/browser/restore-read-feedback.spec.ts` | Cover explicit read recovery, busy feedback, password-draft retention and absence of restore mutations. |
| This report | Preserve the reviewed scope, verification evidence and remaining publication boundary. |

No backend, API response shape, schema, route, permission, stock, pricing, sales accounting or recovery algorithm changes. No application dependencies were added. The single CSS addition is scoped to import templates. Staff operational search and the current public storefront remain intact.

## Verification evidence already completed

Evidence root: `.scratch/ux-closure-20261022/`. Commands used pinned Windows Node 22.23.3 and pnpm 10.34.5. Failed attempts and separate corrected runs are retained.

| Check | Actual result and evidence |
| --- | --- |
| Full and production audits, 22 October | Both reported no known vulnerabilities: `main-audit-full.log`, `main-audit-prod.log`. These are dated results, not a guarantee about future advisories. |
| Focused HTTP integration | 3 files / 42 tests passed, `main-http-focused.log`: staff access, corrections and stock corrections on an isolated database. |
| Workspace typecheck | 23 projects passed, `main-typecheck-initial.log`. Final page changes subsequently passed affected internal typecheck in `main-typecheck-closure-rerun.log`. |
| Architecture | 780 modules / 1,359 dependencies and private-import check over 716 files passed, `main-architecture.log`. Later UI-only deltas introduce no module-boundary changes. |
| Full API/staff/storefront build and bundle separation | Passed in `main-build.log`. Final staff rebuild including import wrapping passed on 24 October in `staff-startup-build-20261024.log`; service-worker generation succeeded. |
| Correction/stock browser suite | 11 passed, `main-browser-identity.log`. |
| First feedback browser run | 6 passed / 5 failed, `main-browser-feedback.log`. Pricing collection globs missed `/id` updates, so fixtures reached the isolated real API rather than holding their mocked writes. Original failure contexts retained. |
| Corrected feedback + new Restore suite | 11 passed / 2 failed, `main-browser-feedback-rerun.log`. Remaining fixture defects were a StrictMode initial-read race and a non-exact password label. |
| Two failed cases after fixture correction | 2 passed, `main-browser-two-case-rerun.log`. This is a separate two-case run, not one fresh 13/13 run. No assertions or tests were removed. |
| Source review | Independent final review and source hashes are recorded separately; no self-reported Grok gate is treated as main verification. |

The above browser runs cover 24 distinct focused cases across four files, assembled from the recorded runs. They are not a fresh whole-project browser run. The original source syntax failure and corrected typecheck remain beside one another. Grok authoring runs that reached their turn limit are not recorded as successful test runs, even where their partial edits were subsequently reviewed and verified.

## Visual evidence and limits

The original desktop run individually inspected 60 native screenshots covering 22 staff screens, long document slices, selected forms and receiving archive bounds. The state run individually inspected 41 screenshots; the narrow/light run individually inspected 56 screenshots. Exact filenames and reviewer ownership are recorded in `main-visual-review.md`, `visual-review-inventory.md`, `visual-review-operations.md`, `visual-review-states.md`, `visual-review-1024.md` and `visual-review-390.md`.

These are 157 individually opened screenshots across separate runs, not 157 different workflows. They do not prove every hidden editor, intermediate archive row, financial operation, physical device, or installed offline restart. Synthetic empty responses were explicitly labeled and did not empty server data. Normal POS snapshot metadata and branch selection are distinct from business transactions.

The original collectors retained failed status. Their runtime-entry comparison incorrectly handled modulepreloads, including the dynamically added PWA loader. Served index hashes and actual assets matched the built application; that flag alone did not establish stale application code. Separately, visual review established genuine missing Restore refresh, false branch-sales empty copy and Opening Import 390 px overflow; these were fixed through Grok and require the targeted after-fix visual follow-up below.

### Final follow-up

Both targeted collectors passed on 25 October against the built staff application:

- `import-narrow/run-2026-10-25T11-59-41-029Z/report.json`: 13 native screenshots, all individually opened by the independent reviewer; main also opened six key frames. Opening Import was inspected through its full document and focused upload input at 390 and 1024 px, in dark and light themes. The document width equals the viewport in all four combinations, with no horizontal overflow. Text wraps without changing the CSV contents. No page errors or blocked business-write attempts were recorded.
- `states/run-2026-10-25T12-00-34-288Z/report.json`: 43 native screenshots, all individually opened by the independent reviewer; main also opened six corrected-state frames. Nine supported read probes each held loading, displayed an injected 503 error, retried via the real existing action, received GET 200 and recovered the UI. These cover Staff, storefront settings, delivery areas, Offers, branch Sales, confirmed online sales, stock corrections, Analytics and Restore. The summary separately records five ordinary probe results, four explicitly synthetic empty-list variants and fourteen skipped checks. Skips and synthetic responses are not financial acceptance or evidence of server-side data deletion.

The branch-sales failure now has error/retry without the false no-sales message. A genuine successful empty response still displays the empty state. Restore exposes its explicit refresh without a selected preview and clears the read error after that action, retaining the existing consequence warnings. Analytics retries with the existing date-submit action; no extra application control was introduced. The PWA modulepreload is now verified as a same-origin built asset with matching bytes rather than incorrectly rejected. Both runs matched served build assets, retained unchanged source/dist hashes and closed their owned browsers.

Exact filenames and limits: `final-import-visual-review-20261025.md` and `final-state-visual-review-20261025.md`. These 56 new screenshots supplement the prior 157, rather than representing 56 new workflows. Final source review (`final-source-review-20261025.md`) found no concrete P0/P1/P2 defect; main rechecked all 17 reviewed content hashes and found no drift. Candidate `git diff --check` passed. Only the two known Next-generated preview type-path edits were restored to HEAD; no unrelated edits were reset.

**Local closure decision:** the demonstrated defects in this bounded pass are implemented, reviewed and verified. No further application feature or redesign is needed for this section. Publication is owner-approved; the GitHub verification portion still requires a fresh successful Windows run. The old red run must not be described as resolved yet.

## Data and change control

The local practice database/catalog/stock and saved account passwords are preserved. Visual collection may read real practice data but must not submit sales, stock corrections, offer changes, imports or restores. Behavioral writes used isolated integration/browser fixtures. No secrets, screenshots, temporary scripts, logs, font folders, dependency caches or unrelated assets belong in the candidate commit.

The protected review file is excluded from inspection and staging. Its SHA256 was verified on 25 October as `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Next-generated local preview type paths are environmental churn and must be restored/excluded, not presented as storefront implementation.

The remaining hosted Windows run is a publication gate, not a request for more features or another redesign. Client acceptance and future release operations remain separate decisions.
