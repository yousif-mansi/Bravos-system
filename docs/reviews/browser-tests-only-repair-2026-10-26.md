# Test-only browser repair — 26 October 2026

The owner chose **Repair tests only first**. Application, catalog performance, styles, stock/order behavior, APIs, schema, permissions and live/practice data are unchanged. This report does not close the full browser acceptance pass.

Baseline: Windows run [40321460951](https://github.com/yousif-mansi/Bravos-system/actions/runs/40321460951), commit `9486aa7`, passed static/build checks and all 260 API tests. Browser acceptance finished **179 passed / 9 failed**.

## Verified changes being published

| File | Repair and retained safeguards |
| --- | --- |
| `tests/browser/offline-pos.spec.ts` | Removes only the losing tab's unrelated sync-error expectation. Its local shortage rejection occurs before synchronization. Retains shortage, Retry, retained cart, no false success, exactly one completed sale and exactly one stock effect. |
| `tests/browser/offline-sync.spec.ts` | Controls snapshot requests across the entire test-owned browser context, not just one page, until the existing acknowledgement release point. Removes only its own handler. Keeps all strict A/B/C pending/acknowledged, retained-fact, stock-version and effect assertions. Context fixture disposal provides cleanup on test failure. |
| `tests/browser/storefront.spec.ts` | Scopes both cart persistence warnings to main content, separating them from the closed mini-bag dialog's warning. Keeps corruption preservation, blocked-storage feedback, Bag not saved and false-success checks. |

Grok implemented the test changes. Main reviewed the diff; an independent read-only review found no blocking issue. No `.first()` workaround, skipped test, raised global timeout or softened stock expectation was introduced.

## Actual Windows verification

Checks used pinned Node 22.23.3 / pnpm 10.34.5 and the isolated checkout at `9486aa7`, with existing PostgreSQL/API/staff test lifecycle and built Next.js 16.4.1 production storefront. The ordinary practice stack was not targeted. The existing 3 GB physical / 4 GB virtual free-memory guard was preserved; an initial blocked launch did not run tests.

- Focused four-case run: **3 passed / 1 failed**. Both offline cases and the cart persistence case passed. The corrected not-found selector reached the existing 44 px target assertion, which failed on a real measured width of **39.984375 px**.
- Subsequent combined run: **30 passed / 1 failed**. All 30 cases in the two complete offline spec files passed. The one additional, unchanged keyboard diagnostic failed. This is not a fresh 31/31 run or a fresh complete browser pass.
- `git diff --check`: passed.

Evidence in the isolated checkout: `.scratch/security-dependency-20261025/tests-only-focused-20261026.log`, `tests-only-offline-keyboard-20261026.log`, and `tests-only-not-found-error-context-20261026.md`. Generated `next-env.d.ts`, screenshots, logs and fixture data are excluded from publication.

## Remaining work and withheld draft

`tests/browser/storefront-experience.spec.ts` has a reviewed main-content Shop locator correction in the isolated checkout, but it is **excluded from this commit** because the corrected case reveals the real target-size failure. The recovery link's CSS supplies `min-height: 44px` without a minimum width. The 44 px criterion was kept; CSS was not changed under the test-only instruction. The candidate selector patch remains reviewable for a later application fix.

The unchanged keyboard case reproduced a document-scroll assertion failure on the touch path: expected 0, observed 129. This differs from the hosted run's 596 px delta. Correct focus, horizontal bounds and focus visibility assertions were retained. The result alone does not establish whether this is native focus scrolling, unsettled setup or a visible product jump; no keyboard test or application workaround was applied.

The four slow category/sort/recovery navigation failures remain outside this pass. Earlier logs show 15–25.5 second render latency. No application read optimization, request caching or timeout increase was made.

Only the three verified test repairs and this report are publication candidates. A fresh hosted run may still fail the explicitly unresolved cases. Do not combine separate local runs with the earlier 179/9 result or claim the full suite is green. No merge, issue closure or deployment is authorized by this report.
