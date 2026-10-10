# Production-readiness execution — 10 October 2026

The owner authorized Grok to resolve the remaining GitHub engineering issues and prepare technical production readiness. Main owns product/architecture decisions, independent review and publication. Real merchandise inputs, physical-device access and hosting details will be supplied after technical readiness; do not fabricate those inputs or call the project launched.

## Confirmed reporting decision

On 10 October the owner approved **showing CSV opening stock separately from new purchases**. Retain the import-acceptance audit date and original batch dates/FIFO. Opening value is excluded from ordinary purchase totals and shown in its own report group. Preserve inventory, sales/profit, permissions and correction history. This supersedes earlier documents that describe this decision as unanswered.

The accepted opening-import operation **with a nonempty persisted opening-batch manifest** is the reliable classification source. All branch receipts sharing that stockful operation are opening receipts. Configuration/catalog-only accepted imports do not claim stock operations; an ordinary receipt legitimately using their operation ID must remain a purchase. Validate the manifest as an array before checking its length, using a guarded SQL `CASE`. Inventory operations use `receive` for both kinds and cannot distinguish them. Expose an opening-import-owned reader through a public port and compose it into the existing reporting snapshot; no direct cross-feature table reads or schema migration.

Main's testing decision: use a pinned root **development-only** Mozilla PDF.js reader for assertions against actual HTTP PDF exports. Do not introduce a handwritten PDF parser or a dependency in shipped feature/application packages. The first custom test decoder mixed pages and had a delimiter-loop risk; main stopped those implementation attempts for review before broader gates. Retain those failed logs and controlled-interruption records. Verify each summary label with its amount and each exported receipt with its effective cost, rather than checking unrelated lists of labels and numbers.

## Bounded execution queue

| Batch | Status | Scope and acceptance | Evidence / owner |
| --- | --- | --- | --- |
| A — Acceptance repair | Reviewed, committed and pushed; hosted browser still red | Internal stale taxonomy/detail/sync races; browser fixture, font and keyboard repair; no business-policy changes. Fresh historical full browser 161 passed, then independent final-source focused 7 passed; typecheck/architecture/diff passed. Hosted run 38033109783: static/build/audit and HTTP passed; browser 158 passed / 3 failed. | `a3df055`, PR #43, `docs/reviews/grok-ci-acceptance-repair-2026-10-10.md`; main reviewed |
| B — Opening-stock reporting | Reviewed, independently verified and committed | Separate classified totals/details/counts in manager report/UI/PDF/XLSX; preserve global intake scope, audit/FIFO dates, corrections and paging. Five affected HTTP files: 28 passed across separate runs; affected browser run: 6 passed; typecheck/architecture/full build/audits passed. | `1e05150`; `docs/reviews/opening-stock-reporting-2026-10-10.md`; independent logs under `.scratch/grok-production-20261010/opening-report/main-verification/` |
| A2 — Remaining Linux acceptance failures | Reviewed and independently verified; publish for matching Linux CI | Scope the last-unit shortage alert; retain the lost-send upload gate through a separately authenticated competing sale; await uploaded double-click sale before request-count assertion. Grok focused 3 and affected 32 passed; independent affected 32, typecheck/architecture/diff/hash passed. Cashier still sees only their own original sale; a manager verifies both distinct sales. No application or permission changes. | `docs/reviews/linux-browser-followup-2026-10-10.md`; independent High source review and Medium gate logs |
| C — User-flow and accessibility QA | Inventory complete; implementation queued after A2 | Compare existing coverage with SF-12; test supported long Arabic/mixed RTL, critical touch targets, contrast, focus, announcements and failure/recovery paths. Fix only demonstrated defects. No design or state-machine rewrite. | Sol retrieval, main prioritization, next bounded Grok brief |
| F — Operator readiness package | Queued after C, before final coherence | Verify configuration, migration/backup/media/recovery, monitoring, pilot and training procedures against existing tools; provide concrete operator test scripts/checklists. Add only demonstrated missing, sanitized API failure diagnostics. Guides are preparation, not proof of external drills or actual shop use. | Bounded Grok implementation/preparation, main acceptance |
| D — Final technical coherence | Queued after B/A2/C/F | Review diffs against requirements/standards; run final matching HTTP/PostgreSQL/browser/build/security gates. Preserve failures and exact rerun boundaries. Hosted checks must refer to the published source. | Main plus independent verifiers; no overlapping local test stacks |
| E — GitHub integration | Queued behind matching checks/review | Update PR/evidence and issue status. Close only criteria actually met; optional/content-dependent work remains accurately classified. No checkbox-only completion. | Main |

## GitHub issue disposition

Batch B's final Grok continuation completed with exit 0 at 12:36 Cairo. Independent verification subsequently passed the bounded gates above; both audits report zero advisories. Earlier failed export assertions, deliberate parser-review interruptions, a PowerShell invocation error and an interrupted build remain separately recorded. Main corrected the active CSV guide to name required `branch_code` and the existing per-branch receiving records. No production, hosted-browser or physical-device acceptance is inferred.

Current open issues are #1, #33, #37, #38, #39, #40, #41 and #42. The 9 October issue comments supersede stale dependency text in their initial bodies.

- #37/#39/#40: engineering implemented; PR #43 integration and matching acceptance checks remain.
- #33: supplied-cover homepage implemented; final representative brand/content visual acceptance remains. Preserve the later approved dark premium direction and current fonts.
- #38: optional factual chapters, content-deferred. Existing description/size guide remain; omit absent chapters. Missing optional stories do not block commerce or authorize invented facts.
- #41: existing production lab tooling is preparation; representative matched production measurements remain outstanding.
- #42: complete feasible software QA and record actual limitations. Emulation cannot prove physical Safari/Android behavior, screen-reader experience or true browser zoom.
- #1: umbrella delivery remains open until operational and release acceptance, beyond engineering completion.

## Release boundaries and deferred inputs

Keep separate from technical pass claims: approved real assortment/photos/factual copy and final brand review; physical iPhone/iPad Safari and Android checks; true 200% zoom and screen-reader review where unavailable; permitted representative production performance; hosting/TLS/proxy/durable data and media/monitoring; external restore/owner-recovery drill; trained internal pilot; separately approved public ordering/launch.

A prior automatic approval review rejected storefront production startup. Do not evade that restriction through another launcher, port, host or CI workflow. Existing allowed development tests and production builds can proceed. The lab script attaches only to a permitted isolated production service; development timing is never production evidence.

Preserve ordinary business data, queued sales, historical controls and the protected review file. Grok does not stage/commit/push/merge/close issues. Main publishes only reviewed bounded changes under the owner's current go-ahead. No hosting purchase, production deployment or public-ordering switch is performed by this queue.
