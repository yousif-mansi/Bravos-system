# Linux browser final follow-up, 2026-10-11

Accepted HEAD `6e67b0ce60aa2a16140a9eb1075c6005685e1d4c`. This is a Windows test-only repair. No application, CSS, API, schema, permission, stock, order, recovery, or dependency change. No commit, push, merge, issue closure, or deployment. Main owns plans, prior reports, and GitHub.

## Retained results

Hosted Ubuntu run [38086689748](https://github.com/yousif-mansi/Bravos-system/actions/runs/38086689748) at `2a59cda` remains the Linux browser evidence: static, build, audit, and HTTP passed; Chromium **160 passed / 2 failed of 162**. Log: `.scratch/grok-production-20261010/linux-browser-2a59cda.log`. Those two failures are the sparse-pair cashier lookup and the arrival presentation probe. `storefront-integration.spec.ts` passed in that hosted run.

Windows final coherence at this same HEAD stopped after the browser gate: HTTP **32 files / 248 tests passed**, then Chromium **160 passed / 2 failed of 162**. Log: `.scratch/grok-production-20261010/final-coherence/02-browser.log`. Those two failures are the arrival presentation probe and integration case 128. The sparse-pair catalog case passed on that Windows run. The runner ended `2026-10-10T22:07:35.585Z` with no owned processes. Ordinary PostgreSQL 54329 stayed up.

## Repairs

No product defect was demonstrated. The only test edits are the three cases below.

1. `tests/browser/catalog.spec.ts`, sparse-pair case. `selectActiveBranch` returns a `WorkspaceDto`. `activeBranch` is `{ id, code, nameAr }`. Both Abshway clicks in this case register `POST /api/internal/active-branch` before the click, require status 200 and that branch object with code `abshway` and name `أبشواي`, then require the existing `active-branch` text. The cashier `GET /api/internal/catalog/lookup?code=SPARSE-E2E` runs only after that. Sparse variant ids, the online pair selection, and the cashier quantity `2` are unchanged. The activation is the real session POST, not a mocked permission.

2. `tests/browser/storefront-experience.spec.ts`, route presentation. The arrival page renders `nav[aria-label="تصفية حسب التصنيف"]` from `CollectionControls`. That nav is `overflow-x: auto`, `min-width`/`min-height` 44px, and `onFocus` calls `scrollIntoView`. The hosted failure was one marker node, the fixture category name, at `-303..-259` in a 320px viewport: a 44px-wide link scrolled out of that rail. The probe still flags viewport overflow for every other node. It suppresses that flag only when the overflow is clipped by this rail and the rail itself fits the viewport. Wrap and clipping checks still run for any of that text that remains visible in the rail. Root `scrollWidth`, hero, story, confidence, title, address, target, contrast, stock, and analytics assertions are unchanged. After the arrival geometry check at 320, 390, 768, 1024, and 1440, the test reaches the fixture rail link with real Tab presses and waits, through the page's smooth scroll, until that focused link is fully inside the rail and the viewport, unobscured, still focused, and at least 44 by 44 CSS pixels. This Windows run did not rebuild the full-suite category count, so it did not reproduce the `-303` box. The four-file arrival checks passed with the rail model.

3. `tests/browser/storefront-integration.spec.ts`, case 128. The Windows failure was `panel.locator(input[value=visible.id]).toBeVisible()` resolving to two checked radios after `panel.getByRole("radio").toHaveCount(1)` had passed. The accessibility snapshot at failure showed one radio in one group. The cart and POS assertions were not reached, and no storage failure was shown. Hosted `2a59cda` passed this same test. After reload, the test waits for one accessible group named `تركيبات المقاس واللون`, then one visible, enabled, checked radio whose value is the intended visible variant. The hidden variant input is still absent. The panel's add button is one visible enabled `أضف إلى السلة`. Cart quantity 1 with `orderable: false`, and POS quantities 2 and 1 for the original pairs, are unchanged. The assertion does not use `.first` or `.nth`.

## Commands and exits

Pinned Node `v22.23.3` and pnpm `10.34.5` through `.local/tools/node-v22.23.3-win-x64/node.exe` and `.local/tools/node_modules/pnpm/bin/pnpm.cjs`. `PATH` was prepended with that Node directory and `.local/tools/node_modules/.bin`. Isolated stack only, started by Playwright: API 3011, staff 5174, Next development 3001, PostgreSQL 55433. Ordinary PostgreSQL 54329 stayed in listen (pid 25840). Ordinary API 3010, staff 5173, and storefront 3000 were not started. Logs: `.scratch/grok-production-20261010/linux-two/`.

| Log | Command / scope | Result | Exit |
| --- | --- | --- | --- |
| `01-focused.log` | `playwright test` the three case titles in `catalog.spec.ts`, `storefront-experience.spec.ts`, and `storefront-integration.spec.ts`, `--workers=1 --reporter=line` | **3 passed (1.0m)** | 0 |
| `02-four-files.log` | `playwright test` `catalog.spec.ts`, `storefront-experience.spec.ts`, `storefront-keyboard.spec.ts`, `storefront-integration.spec.ts`, `--workers=1 --reporter=line` | Playwright order was catalog, experience, integration, keyboard. **13 passed (2.5m)** | 0 |
| `03-typecheck-bad-invoke.log` | `node pnpm.cjs` with no script | PowerShell `$args` swallowed `typecheck`; pnpm printed help. This was not a typecheck. | 1 |
| `03-typecheck.log` | `pnpm typecheck` | Scope 23 of 24 workspace projects, each reported Done | 0 |
| `04-architecture.log` | `pnpm check:architecture` | 444 modules, 1065 dependencies, private-import check 385 files | 0 |
| `05-diff-check.log` | `git diff --check` before restoring generated Next paths | No whitespace errors; generated-file and catalog CRLF warnings | 0 |
| `06-diff-check-after-restore.log` | `git diff --check` after that restore | No whitespace errors; catalog CRLF warning | 0 |
| `07-diff-check-after-report.log` | `git diff --check` after this report was added | Same tracked-tree result; the untracked report was not read | 0 |

Exact command lines are in the matching `.command.txt` files. There is no second full-suite browser run and no rerun of a passed gate.

## Cleanup

Next rewrote `apps/storefront/tsconfig.json` and `apps/storefront/next-env.d.ts` during the browser runs. Both were restored to their pre-run bytes: SHA256 `C347427786B19C87BBF31109DD92C04AF9B2B9F19C9DB1026BE6F5C8802D0A5E` and `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`. The generated copies are `tsconfig.json.generated` and `next-env.d.ts.generated` in the log directory. `docs/reviews/bravos-v1-grok-review.md` still has SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. It was already modified in the worktree at handoff and was not edited here. HEAD is still `6e67b0ce60aa2a16140a9eb1075c6005685e1d4c`.

Isolated ports 3011, 5174, 3001, and 55433 were free after the runs. No owned e2e or Playwright process remained. Ordinary PostgreSQL 54329 (pid 25840) remained.

Windows green on these 13 tests is not a hosted Linux pass. Main's independent gates and a matching Linux run remain the acceptance check.

## Main review and independent verification

Main reviewed the three test diffs against the bounded brief. Branch activation uses the real successful session response. Geometry exceptions apply only to clipping by the named category scroller, which must itself fit the viewport; real Tab focus must reveal the fixture link at all five widths. The product check requires exactly one accessible group and one visible, enabled, checked variant with its exact id, plus one enabled add button. Hidden-pair absence, persisted cart identity/quantity/unavailability and original POS quantities remain asserted. No application or business behavior changes were accepted.

Main's fresh four-file run passed **13 tests in 3.6 minutes**, followed serially by typecheck, architecture (444 modules / 1063 dependencies after generated Next paths were restored; 385 private-import files), diff and protected-source checks, all exit 0. Logs and exact source identity: `.scratch/grok-production-20261010/linux-two-main-verification/`. No isolated listeners or owned processes remained; ordinary PostgreSQL stayed running. Main corrected this report's table formatting and recorded the independent result after that frozen-source run. Matching published Linux checks and the final full browser cycle remain outstanding; results will be maintained on [PR43](https://github.com/yousif-mansi/Bravos-system/pull/43).
