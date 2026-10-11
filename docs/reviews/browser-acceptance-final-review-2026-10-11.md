# Browser acceptance final review, 2026-10-11

Accepted published HEAD `9e66ff94e3ce0a2bcfcb2c7d58ecd2917fa56f1d` on PR 43. This follow-up repairs two hosted browser checks and adds this report. No application, CSS, API, schema, business, permission, stock, order, recovery, dependency, or shared-helper change. No staging, commit, push, merge, deploy, or issue closure. Main owns the plan, GitHub, and the final matching source gates.

## Retained results

Main's full local browser cycle at this HEAD was **161 passed / 1 failed of 162**. The failure was the Coming Soon raw-text locator, which matched one accessible paragraph and hidden streamed markup. Main then corrected only `tests/browser/storefront.spec.ts`. That correction is recorded in the next section. It is already in the worktree and was not edited here.

Hosted Ubuntu run [38100672498](https://github.com/yousif-mansi/Bravos-system/actions/runs/38100672498) at `9e66ff9`: static, build, and audit passed. HTTP was **32 files, 247 passed / 1 Windows-only skip of 248**. Chromium was **160 passed / 2 failed of 162**. The earlier A4 cases passed in that run up to the two checks repaired below. Raw log: `.scratch/grok-production-20261010/linux-browser-9e66ff9.log`.

## Main's existing storefront correction

Main owns this change. This session did not author it, restore it, or rewrite it.

`tests/browser/storefront.spec.ts` uses `getByRole("paragraph")` filtered to the exact existing Coming Soon message, requires count 1, and requires that paragraph to be visible. The no-add assertion still requires count 0. SHA256 before and after this follow-up: `FD09C6153ADB0272E9A910166D52AC276E3BE33BEC0612F3B9E9D11237C0B8DF`.

## Repairs in this follow-up

No product defect was demonstrated. The only edits made here are the two test locators below.

1. `tests/browser/reporting.spec.ts`, case `manager sees accepted opening stock apart from purchases` (line 383). Hosted `next.isEnabled()` failed because `getByRole("button", { name: "الصفحة التالية" })` matched two accessible buttons. `ReportsPage` renders `DetailPaging` twice, both as `nav` with `aria-label="صفحات تفاصيل التقرير"`. Opening stock is `section[data-testid=opening-stock]` and contains no pager button. The purchases section stays on the page. The loop now takes the single `nav` that follows the opening-stock section and then its `الصفحة التالية` button, and requires that button's count to be 1 before `isEnabled()`. A disabled button still ends the walk. An enabled button still clicks and waits for the management-report `GET` response pathname `/api/internal/reports/management` with status 200. The walk remains bounded at 40 pages. Target receipt ids, effective costs, global baselines, and the separate purchase and opening values are unchanged: corrected Abshway opening 1 × 200 ج.م., Fayoum opening 3 pieces with a total cost of 720 ج.م., purchase 1 × 75 ج.م., opening baseline plus 92000 piasters, purchase baseline plus 7500 piasters. Branch filters still must not change the opening total. Both sections stay available. The pager is not bypassed and discovery is not truncated.

   This focused fixture is low volume. Both pagers are rendered, and both next buttons can stay disabled on page 1, so this Windows run may not create the hosted state of two enabled pagers. Passing here does not replace the full source suite or a matching Linux run.

2. `tests/browser/storefront-experience.spec.ts`, collection card in `storefront route presentation remains reachable across supported widths and zoom equivalent`. Hosted `page.locator("a.product-card").filter({ hasText: productName }).toBeVisible()` matched the visible card and a hidden streamed duplicate with the same href. The collection check now uses `fixtureCollectionCard`: an accessible link whose name contains the fixture product name, intersected with `a.product-card[href="/products/{id}"]`. The link name is not exact, because the card's accessible name also includes price and availability. The locator must have count 1, be visible, have the exact fixture href, and contain a heading whose accessible name and text are exactly `productName`. Two accessible cards would fail the count. The check does not use `.first` or `.nth`, and it does not exclude cards by geometry. Geometry, the five-width real keyboard rail reveal, commerce, contrast, stock, private data, and analytics assertions are unchanged. The later card contrast samples and the commerce click stayed on their existing locators. They passed in this run, so they were not rewritten. `tests/browser/support/storefront-a11y.ts` was not edited.

## Commands and exits

Pinned Node `v22.23.3` and pnpm `10.34.5` through `.local/tools/node-v22.23.3-win-x64/node.exe` and `.local/tools/node_modules/pnpm/bin/pnpm.cjs`. `PATH` was prepended with `.local/tools/node_modules/.bin` and that Node directory. Playwright started the isolated development harness with `reuseExistingServer: false`: API 3011, staff 5174, Next development 3001, PostgreSQL 55433, one worker. Ordinary PostgreSQL 54329 stayed in listen (pid 25840). Ordinary API 3010, staff 5173, and storefront 3000 were not started. No production storefront was started. Logs: `.scratch/grok-production-20261010/final-two/`.

| Log | Command / scope | Result | Exit |
| --- | --- | --- | --- |
| `00-preflight.log` | HEAD, listeners, and hashes before the runs | HEAD `9e66ff9`; only 54329/pid 25840 listening; protected and storefront hashes matched | 0 |
| `01-focused.log` | The opening-stock case and the route-presentation case, `--workers=1 --reporter=line` | **2 passed (1.3m)** | 0 |
| `02-three-files.log` | `reporting.spec.ts`, `storefront-experience.spec.ts`, `storefront.spec.ts`, `--workers=1 --reporter=line` | Order: three reporting tests, experience, three storefront tests. **7 passed (1.4m)** | 0 |
| `03-typecheck.log` | `pnpm typecheck` | Scope 23 of 24 workspace projects; each reported Done | 0 |
| `04-architecture.log` | `pnpm check:architecture` | 444 modules, 1065 dependencies, private-import check 385 files | 0 |
| `05-diff-check-empty-pnpm.log` | `node pnpm.cjs` with no script | Harness mistake: an empty argument list ran before `git diff`. pnpm printed help. This was not `git diff --check`. | 1 |
| `05-diff-check.log` | `git diff --check` before restoring generated Next paths | No whitespace errors. One CRLF warning for the still-rewritten `apps/storefront/tsconfig.json` | 0 |
| `06-diff-check-after-restore.log` | `git diff --check` after that restore | No whitespace errors and no warning | 0 |
| `07-diff-check-after-report.log` | `git diff --check` after this report was added | No whitespace errors. The untracked report was not read | 0 |

Exact command lines are in the matching `.command.txt` files. There is no HTTP rerun and no full 162-test browser rerun.

## Cleanup

Next rewrote `apps/storefront/tsconfig.json` and `apps/storefront/next-env.d.ts` during the browser runs. Their mid-run SHA256 values were `96903AB75F62FC904DD835FDC17C66B1E419221717208EB3CA01845FE715B965` and `6FEB180FAA5ACAF19451D0F2662B77FF272D3199FAC6BEC8DFF30152E883762B`. Both were restored to their pre-run bytes: `C347427786B19C87BBF31109DD92C04AF9B2B9F19C9DB1026BE6F5C8802D0A5E` and `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC`. The generated copies are `tsconfig.json.generated` and `next-env.d.ts.generated` in the log directory.

`docs/reviews/bravos-v1-grok-review.md` still has SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. It was already modified in the worktree at handoff and was not edited here. HEAD is still `9e66ff94e3ce0a2bcfcb2c7d58ecd2917fa56f1d`.

Isolated ports 3011, 5174, 3001, and 55433 were free after the runs. No owned e2e or Playwright process remained. Ordinary PostgreSQL 54329 (pid 25840) remained. Ordinary data and the existing untracked outputs, fonts, and store were left untouched.

These Windows results are a local check of the two repaired cases and the three files that contain them. A hosted Linux pass of the full source suite remains Main's matching gate.

## Main final review and independent gates

Main reviewed both Grok locators against the actual UI. The two `DetailPaging` controls are the top and bottom copies of one shared detail-page state, not separate purchase/opening pagers. Selecting the unique lower nav after the opening-stock section preserves the complete shared traversal. Main added a small render-readiness guard: parse each successful report response and wait for that nav to display its exact returned page number before inspecting the next iteration's rows. This prevents reading the temporarily absent report during loading and skipping receipts. The 40-page bound, disabled end and exact target amounts remain. The accessible card retains count1, visibility, exact fixture href and exact title. Main's Coming Soon correction still requires count1/visibility and no add action.

The final test source independently passed all **7 tests across the three files in 1.6 minutes**, then typecheck, architecture (444 modules /1063 dependencies after generated paths were restored; private-import385 files), diff and protected-source checks, all exit0. Logs/source hashes: `.scratch/grok-production-20261010/final-two-main-verification/`. Main authored the Coming Soon and pager-readiness review corrections; Grok authored the scoped pager and collection-card changes. The report wording was corrected after those frozen-source gates; no application change followed them. Isolated listeners and owned processes were absent at handoff; ordinary PostgreSQL remained running. Historical full Windows161/1 and Linux160/2 cycles remain red; these7 passes do not turn either into one fresh162. Final complete browser/build/migration/script/audit checks and matching Linux outcomes are maintained on [PR43](https://github.com/yousif-mansi/Bravos-system/pull/43).
