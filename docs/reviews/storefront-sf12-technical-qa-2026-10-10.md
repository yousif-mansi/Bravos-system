# Storefront SF12 technical QA — 2026-10-10

Bounded C batch from accepted HEAD `c1dec083c1f1ed1cd72d4347f259d754e6f802b8`. Issue #42 / SF-12 stays open. Production acceptance, device acceptance, and content acceptance stay open. This is not a launch-ready or full-suite result. The final six-file gate and storefront build stay pending until main records them. Main reviews, verifies, and commits. Operator batch F was not started.

Pinned tools: Node v22.23.3 at `.local/tools/node-v22.23.3-win-x64/node.exe` and pnpm 10.34.5 at `.local/tools/node_modules/pnpm/bin/pnpm.cjs`. Isolated Playwright stack only (API 3011, staff Vite 5174, Next dev 3001, Postgres 55433). Ordinary API 3010, staff 5173, and storefront 3000 stayed closed. Ordinary Postgres 54329 stayed up and was not reset. No production Next process was started.

## Controlled interruption

Main stopped the first C run on purpose for early source review, before any local test stack started. That stop is not a test failure, a quota result, or a completed Playwright run. No new SF12 spec had been executed at that point.

A later controlled stop ended the long relay after `six-file-scroll-padding.log` had already finished red (17 passed, 1 failed, exit 1). Stopping that relay is not a gate pass. `six-file-scroll-padding-2.log` is an interrupted startup that only reached `e2e: starting postgres`. It stays historical.

## Source-review corrections before testing

Independent High review found two false-proof paths. Both were corrected before the indicator run.

1. `tests/browser/storefront-experience.spec.ts` pushed empty-search heading and status into `manualContrast` even when `measureContrast` returned `manual: false`. Both samples now go through `recordContrast` and `expectContrast`. A sample is added to manual evidence only when `manual` is true, and a manual sample must have a null ratio. Solid empty-search text is asserted.
2. `tests/browser/support/storefront-a11y.ts` flattened gradient stops into independent worst-case opaque colors. That bounded-gradient proof and its parser were removed. A visible non-`none` `background-image` or gradient is manual evidence. Backdrop blur over a non-opaque surface is manual. Solid ancestor alpha is still composed, and the walk stops at an actually opaque surface that hides deeper layers. Transparent, image, gradient, and glass backgrounds are not replaced with white. Manual samples are screenshotted and are not treated as a contrast pass.

## What the runs showed

### Quote retry focus was the Next.js dev indicator

`focused-1.log`: **1 failed, 15 did not run, exit 1**. `checkout-recovery.spec.ts` delayed price review failed in `tabTo` because `expectKeyboardFocus` required an outline. The same run also rejected `page.waitForResponse` after the test ended, because the quote waiter was registered before Tab traversal.

The indicator rerun wrote `.scratch/grok-production-20261010/sf12-qa/focus-indicator-next-devtools.json` and `focus-indicator-next-devtools.png`. The focused element was `BUTTON#next-logo`, accessible name “Open Next.js Dev Tools”, inside `#devtools-indicator.nextjs-toast`. Computed style: `focus-visible` true, `outline-style: none`, `outline-width: 0px`, `box-shadow: none`, `border: 0px none`. That control exists only in `next dev`. It is not storefront UI, and its missing outline is not production evidence. Product styles were not changed to paint an outline on it. `tabTo` skips that dev overlay and still requires a visible outline on product controls. The quote waiter is registered only after keyboard focus is on the retry button and immediately before Enter. The delayed-quote rerun then **passed, exit 0** (`focused-retry-2.log`, 1 passed, 24.7s).

### Long category text and the mobile purchase bar

`six-file.log`: **2 failed, 16 passed, exit 1**.

- Arrival at 320px: category name `تصنيف BRAVOS Classic …` had bounds `-305..33` while document `scrollWidth` stayed 320. Evidence: `geometry-arrival-320.json` and `geometry-arrival-320.png`. The home category grid’s name span now has `min-width: 0` and `overflow-wrap: anywhere`.
- Keyboard at 390px: while tabbing toward search removal, focus landed on the collection category link with bounds `x: -235.5`, width `338`, center `x: -66` (`focus-obstruction-category-390.json`). The horizontal category rail now wraps within `max-width: 100%`. On focus, a partially clipped link scrolls to `inline: center`.

After that, product at 320px still failed: gallery “السابق”, “التالي”, and thumbnail buttons were covered by the sticky purchase bar (`geometry-product-320.json`, hit points around y=728 and y=805). `position: sticky; bottom: 0` pulled the bar over the gallery. Making the bar `static` cleared that overlap and let the experience widths pass, then the CSS-zoom check failed because the in-flow bar bottom was `4726` rather than inside the 844px viewport (`focused-experience-3.log`). The journey spec also requires that bar to be in the viewport at 390px (`six-file-2.log`: **17 passed, 1 failed, exit 1**).

The accepted source keeps the gallery frame at `max-block-size: 78svh`. Under 1024px the purchase bar is `position: fixed`, `inset-inline: 0`, `bottom: 0`. While that bar is present, the document root uses `scroll-padding-bottom: 10rem`. The existing gallery keyboard-focus rule puts the bar into normal flow; the existing quantity-row focus rule hides it while exposing the inline purchase action.

`gallery-before-bounds.json` is the rejected cap: `max-block-size` 253.2px (30svh of the 844px viewport) and `scroll-padding-bottom` 256px (16rem). `gallery-after-css-bounds.json` is the retained cap: `max-block-size` 658.32px (78svh) and `scroll-padding-bottom` 160px (10rem). At 320px the frame is 360 by 288, about 43% of the viewport, because the width limits it before 78svh. At 390px the frame is 447.5 by 358, about 53% of the viewport. The fixed bar ends at the viewport bottom. At 320px its top is 702.1875 and its height is 141.8125. At 390px its top is 715.78125 and its height is 128.21875. At scrollY 0 the previous, next, and thumbnail controls are covered. After scroll, each control clears the bar (`clearsBar` and `unobscured` true). At 320px, previous and next end at 684.375 against bar top 702.1875 (scrollY 66), and the thumbnails end at 684.171875 (scrollY 157). At 390px, previous and next end at 684.015625 against bar top 715.78125 (scrollY 86), and the thumbnails end at 683.8125 (scrollY 177). The scrolled screenshots are `gallery-after-320-scrolled.png` and `gallery-after-390-scrolled.png`. This is a dev-layout measurement. It is not production, device, or content acceptance.

`focused-bar-fix.log`: experience, keyboard, and journey analytics **7 passed, exit 0**. That was an intermediate bar run, before the gallery cap was restored to 78svh. It is not the accepted-source gate.

## Gate history

Command prefix for these runs: pinned `node.exe` running pinned `pnpm.cjs`, with that Node directory and `.local/tools/node_modules/.bin` first on `PATH`. Playwright `--workers=1`.

Six-file command, owned by main for the final accepted-source run:

`playwright test tests/browser/storefront-experience.spec.ts tests/browser/storefront-keyboard.spec.ts tests/browser/checkout-recovery.spec.ts tests/browser/storefront-gallery-cart.spec.ts tests/browser/storefront-journey-analytics.spec.ts tests/browser/storefront-evolution.spec.ts --workers=1`

`six-file-final.log`: **18 passed (4.1m), exit 0**. That pass used the rejected gallery source (30svh/42svh caps and 16rem clearance), not the accepted 78svh source. Its typecheck, architecture check, diff check, and storefront build (7.8s, compiled and not started; 444 modules, 1065 dependencies, private-import check 385 files) belong to that rejected-source batch.

`six-file-restored-78svh.log`: **17 passed, 1 failed, exit 1 (2.8m)**. Product at 320px still reported sticky obstructions. The presentation probe measured geometry while smooth scrolling was still moving.

`six-file-scroll-padding.log`: **17 passed, 1 failed, exit 1 (3.1m)**. The probe now sets root `scroll-behavior` to `auto` only while measuring and restores the previous value, so production smooth scrolling stays. The remaining failure is keyboard at 390px. During streamed client navigation, `#collection-sort` resolved to two hidden `disabled` `aria-busy="true"` selects. The URL changed before the visible sort control was enabled.

The final main-owned six-file verification on the accepted source **passed**, as recorded below. SF12 and production, device, and content acceptance stay open.

Earlier red logs stay in `.scratch/grok-production-20261010/sf12-qa/`: `focused-1.log`, `six-file.log`, `six-file-2.log`, `focused-experience-3.log`, `six-file-restored-78svh.log`, and `six-file-scroll-padding.log`.

## Accepted-source keyboard file gate

One run of `tests/browser/storefront-keyboard.spec.ts` only, after the readiness correction. Pinned Node v22.23.3 and pnpm 10.34.5. `--workers=1`. Isolated ports 3011, 5174, 3001, and Postgres 55433. The six-file suite and the storefront build were not started.

`keyboard-sort-readiness.log`: **5 passed (1.4m), exit 0**.

| Gate | Log | Exit |
| --- | --- | --- |
| `pnpm typecheck` | `keyboard-sort-readiness-typecheck.log` | 0 |
| `pnpm check:architecture` | `keyboard-sort-readiness-architecture.log` | 0 |
| `git diff --check` | `keyboard-sort-readiness-diff-check.log` | 0 |

This architecture run reported **444 modules, 1063 dependencies**, and the private-import check passed **385 files**.

At 390px the sort locator is the visible combobox named «ترتيب المنتجات». The test waits until that control is enabled, `aria-busy="false"`, and holding the settled value before Tab and before each ArrowDown: `default`, then `name`, then `price-asc`. ArrowDown, the sort URLs, chip removal, and the quote, order, stock, and cart assertions stay in place. The category test waits until «اكتشف تصنيفات المتجر» is visible, polls until more than 40 published links are rendered, then still requires more than 40 real Tab crossings.

`apps/storefront/next-env.d.ts` and `apps/storefront/tsconfig.json` differed from the saved baselines only by generated `.next-e2e` type paths. Both were restored from `.scratch/grok-production-20261010/sf12-qa/next-env.before.d.ts` and `tsconfig.before.json`. There was no semantic edit in either file. After restore they match those baselines and are clean against HEAD. Isolated ports 3011, 5174, 3001, and 55433 were not listening at handoff. Ordinary ports 3010, 5173, and 3000 stayed closed. Postgres 54329 was still listening. No production Next process was started.

Protected `docs/reviews/bravos-v1-grok-review.md` SHA256 before and after: `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. This batch did not edit that file, `docs/planning/production-readiness-execution-2026-10-10.md`, or `docs/reviews/linux-browser-followup-2026-10-10.md`. Those three files already had unrelated working-tree edits and were left as found.

## Coverage and the SSR seam

Keyboard coverage at 320, 390, and 768 still uses real Tab. The 390 journey removes a filter chip, changes sort with ArrowDown, edits cart quantity, adds and removes a line, and completes invalid checkout correction, quote, submission, and acknowledgment. The sort control is waited on as the visible accessible combobox, enabled, not busy, and holding the settled value (`default`, then `name`, then `price-asc`) before each ArrowDown. The more-than-forty category test waits until the category navigation is visible and polls until more than 40 published links are rendered, then still requires more than 40 real Tab crossings. Checkout recovery and gallery/cart recovery use `tabTo`, 44px target checks, and the existing Arabic status, alert, and live text. Quote, stock, order, attempt, and analytics identities were not loosened. `cart_addition` behavior in the journey spec is unchanged and passed in the independent six-file run.

## Main review and independent verification

Main reviewed the final application/test diff and the 320/390px gallery captures. The rejected image caps were removed; category wrapping, focus visibility and mobile scroll clearance remain the only application changes. No API, schema, route, permissions, ordering, stock, quote, recovery, typography or ordinary business-data change is included. The initial Sol High contrast review was incorporated; the final Sol reviewers hit their usage limit, so main completed the final source/visual review and ran the independent gates directly.

Independent evidence: `.scratch/grok-production-20261010/sf12-main-verification/results.json`, 20:32:37–20:36:43 UTC. One fresh six-file run: **18 passed (3.3m), exit 0**. Typecheck, architecture (**444 modules, 1063 dependencies; 385 private-import files**), storefront production build (compiled only), diff check and protected/source-state check all exited **0**. Next generated type paths were restored; the source identity and protected hash matched before/after, owned processes ended, and isolated listeners were closed. Ordinary PostgreSQL remained running.

The first independent runner invocation exited 1 before starting a gate because its default output buffer could not hold the preexisting untracked dependency-store paths. Main increased only the ignored verification harness's capture buffer. `startup-failure.txt` retains that harness failure; it is not a browser or product failure. No rejected-source result is combined with this final fresh pass, and no full-suite, hosted-head, device, production-performance or launch acceptance is inferred.

`apps/storefront/app/public-catalog.ts` loads the catalog and product with server `fetch` (`cache: no-store`, `BRAVOS_API_ORIGIN`). `page.route` cannot see that SSR fetch. There is no existing `BRAVOS_*` error seam or public test hook. None was added. Empty search and not-found are covered in the experience spec. Cart and checkout client failures stay on the existing route seams. A later test-only server fixture, outside production code, would be needed before a forced SSR catalog error can be machine-checked.

## Limits

Contrast ratios are machine-checked only for resolved solid surfaces. Gradient, CSS background-image, and backdrop-blur samples stay manual, with screenshots, and are not called accessible. An `<img>` behind a translucent badge is not pixel-sampled. Disabled controls stay exempt under WCAG 1.4.3 and 1.4.11. DOM focus and live-region roles are not screen-reader speech. CSS zoom in the experience spec is not browser 200% zoom. Dev timing and the dev-tools overlay are not production evidence. Physical devices, screen-reader speech, real browser zoom, and representative production performance remain external.
