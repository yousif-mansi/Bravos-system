# Session-transition Linux follow-up, 2026-10-11

Accepted HEAD `c63f1d6776e5991b808d3dc1f5ed22198ee2200e` on `codex/readiness-issue-reconciliation`, published [PR43](https://github.com/yousif-mansi/Bravos-system/pull/43). This is a Windows test-only repair. No application, API, schema, permission, stock, order, recovery, dependency, or workflow change. No commit, push, merge, issue closure, or deployment. Main owns product, architecture, independent final-source checks, matching hosted validation, and commits.

## Retained results

Hosted Ubuntu run [38102519308](https://github.com/yousif-mansi/Bravos-system/actions/runs/38102519308) at `c63f1d6` remains the Linux evidence: static, build, audit, and HTTP passed (32 files, 247 passed, 1 Windows-only skip of 248). Chromium **161 passed / 1 failed of 162** in 17.2 minutes. Prior selector failures all passed. Raw log: `.scratch/grok-production-20261010/linux-browser-c63f1d6.log`.

The only observed failure is `tests/browser/session-transition.spec.ts:54`, `a delayed old-account logout cannot sign out a newer real cashier login in another tab`. The case started `2026-10-11T01:50:42.960Z` and reported timeout at `01:52:43.057Z` (**120000ms**). The printed error is `page.evaluate: Target page, context or browser has been closed` at `restoreLogoutRace` line 166, invoked from the `finally` at line 109. That evaluate ran after Playwright had closed the context, so it replaced the original awaited-phase error.

Frozen Windows gates at this same HEAD had already passed the full 162-browser set. This batch does not rerun that suite.

## Diagnosis

No product security or deadlock defect was demonstrated. Production CAS in `packages/sales/src/adapters/dexie-pos.ts` `writeIfCurrentRevision` / `markSignedOut`, and the `accountGeneration` still-current checks in `apps/internal/src/session.ts`, remain the authority for refusing a stale logout. The held `installLogoutRace` / `raceProof` wrappers still intercept that real `pos.markSignedOut` path.

`playwright.config.ts` sets test timeout **120000ms** and expect timeout **15000ms**. The logout `click()` can consume the remaining test timeout when the control is missing; the explicit race polls have shorter expectation deadlines. The hosted cleanup error hid the original wait, so the exact stalled action is not established by that log.

The original test order was: `queueOwnerSale`, expire the server cookie through Playwright `page.request`, install the hold hook, click old logout, await `started`. Code review identifies a test-control race in that ordering: server-cookie expiry precedes proof that the intended delayed logout has started.

`staffApi(page, "POST", "/api/auth/sign-out")` clears the shared context cookie. After the queued owner sale, `App.tsx` cashier sync retries `getWorkspace()`. A 401 at lines 276–278 sets `workspace` to `null` without `markSignedOut`. The pathname load 401 at lines 107–111 does the same. `guarded()` can then navigate to `/login` and unmount `AppShell`, removing `تسجيل الخروج` before its click. `LookupPage` checkout 401 can also call `onChanged(null)` and `publishAccount(null)`, advancing generation without entering the intended held logout. These code paths support the ordering repair; the original hosted trace does not prove which path won. Cookie expiry exists so the other tab can do a real fresh login. That need begins after `race.started`.

The repair establishes the intended race explicitly rather than relying on timing before a possible 401 teardown. Increasing timeouts, adding retries, skipping, forcing actions or sleeping would not establish that precondition. Matching hosted validation remains necessary.

## Repair

Write scope is `tests/browser/session-transition.spec.ts` only, plus this report.

1. Install the hold hook while the owner workspace is still on screen. Assert the logout button is visible (15s expect), click it, and require `raceProof().started` before any cookie expiry. Then expire the server cookie through the same request API, then open the newer tab, sign in cashier-b, wait for offline-ready, account generation, release, and CAS false. `installLogoutRace` / `raceProof` still wrap production `markSignedOut` and still record `generationBefore` / `originalAccepted`.
2. Record a local phase name plus last race proof. On failure, attach `logout-race-phase` JSON (phase, `oldSignOutPosts`, proof). No tokens, cookies, or credentials.
3. `restoreLogoutRace` returns when the page is already closed or the evaluate reports a closed target, so timeout cleanup cannot replace the original phase error. A live-page restore failure still throws.

Retained assertions: `oldSignOutPosts === 0`; `proof.originalAccepted === false`; newer cashier display name `كاشير ثان`; active branch `أبشواي`; `currentStaffId` and session `signedOut === false`; before/after newer snapshots exact; old manager sale exact `physicallyCompleted` / `pending` / `21000` including customer facts; foreign queue absent; manager phone `01055557777` absent from the newer snapshot; `localStorage` `bravos.account` and `GET /api/internal/workspace` still the newer cashier. The same-account refresh/CAS case is unchanged. The full `offline-sync.spec.ts` suite is unchanged.

## Commands and exits

Pinned Node `v22.23.3` and pnpm `10.34.5` through `.local/tools/node-v22.23.3-win-x64/node.exe` and `.local/tools/node_modules/pnpm/bin/pnpm.cjs`. `PATH` was prepended with `.local/tools/node_modules/.bin` and that Node directory. Isolated stack only, started by Playwright: API 3011, staff 5174, Next development 3001, PostgreSQL 55433. Ordinary API 3010 (pid 33716), staff 5173 (pid 42584), storefront 3000 (pid 28252), and PostgreSQL 54329 (pid 25840) stayed in listen and were not visited, logged into, written, reset, seeded, or imported. Logs: `.scratch/grok-production-20261010/session-race/`.

| Log | Command / scope | Result | Exit |
| --- | --- | --- | --- |
| `01-focused.log` | `playwright test tests/browser/session-transition.spec.ts --grep "a delayed old-account logout cannot sign out a newer real cashier login in another tab" --workers=1 --reporter=line` | **1 passed (40.4s)** | 0 |
| `02-two-files.log` | `playwright test tests/browser/session-transition.spec.ts tests/browser/offline-sync.spec.ts --workers=1 --reporter=line` | Playwright order was offline-sync then session-transition. **11 passed (1.1m)** | 0 |
| `03-typecheck.log` | `pnpm typecheck` | Scope 23 of 24 workspace projects, each reported Done | 0 |
| `04-architecture.log` | `pnpm check:architecture` | 444 modules, 1063 dependencies, private-import check 385 files | 0 |
| `05-diff-check.exit` | `git diff --check` before this report | No whitespace errors; command produced no output log | 0 |
| `06-diff-check-after-report.log` | `git diff --check` after this report | Same tracked-tree result; the untracked report was not read | 0 |

Exact command lines are in the matching `.command.txt` files. There is no second full-suite browser run and no rerun of a passed gate.

## Cleanup

Next rewrote `apps/storefront/tsconfig.json` and `apps/storefront/next-env.d.ts` during the browser runs. Both were restored to their pre-run bytes: SHA256 `C347427786B19C87BBF31109DD92C04AF9B2B9F19C9DB1026BE6F5C8802D0A5E` and `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`. The generated copies are `tsconfig.json.generated` and `next-env.d.ts.generated` in the log directory. `docs/reviews/bravos-v1-grok-review.md` still has SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. It was already modified in the worktree at handoff and was not edited here. HEAD is still `c63f1d6776e5991b808d3dc1f5ed22198ee2200e`.

Isolated ports 3011, 5174, 3001, and 55433 were free after the runs. No owned e2e or Playwright process remained. Ordinary PostgreSQL 54329 (pid 25840) and ordinary API/staff/storefront pids 33716 / 42584 / 28252 remained.

Windows green on these 11 tests is not a hosted Linux pass. Main's independent gates and a matching Linux run remain the acceptance check. This is not a production, client-launch, or hosting claim.

## Main review and independent verification

Main reviewed the complete test diff against the production session/CAS path. Assertions and test hooks remain intact; no application, contract, database, route, permission, ordering, stock, recovery or dependency edits are included. Main made a small wording correction: the code supports the cookie-expiry race, but the old hosted teardown masked the original awaited phase, so that log cannot establish the exact stalled action.

Independent final-source run under `.scratch/grok-production-20261010/session-race-main-verification/` passed **11/11** account-transition/offline-sync tests in **1.3 minutes**, then typecheck, architecture, whitespace, frozen-source/protected-hash and isolated-process cleanup checks, all exit 0. Generated Next type paths were restored to the verified pre-run bytes. Ordinary development services remained running. This is a fresh affected-suite run, not a second full 162-case Windows run; the previous full Windows pass at `c63f1d6` remains separate evidence.

Matching hosted results and publication status are maintained on [PR43](https://github.com/yousif-mansi/Bravos-system/pull/43). Do not infer hosted acceptance from this local report. Main retains ownership of final integration and launch boundaries.
