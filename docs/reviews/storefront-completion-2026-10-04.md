# Bounded storefront engineering verification — 2026-10-04

This pass verifies the current storefront regressions, adds keyboard coverage and an attach-only production measurement tool, and fixes a demonstrated mobile keyboard obstruction. It does not complete whole-store, SF-11 or SF-12 release acceptance. Initial HEAD was `741fdf84ae7dd4e92a806b97674ba7e8835c3c08`; existing uncommitted cart-media fallback, checkout acknowledgment, regression tests and historical documentation were preserved.

## Delivered scope

- `apps/storefront/app/products/[productId]/product-page.module.css`: while a purchase link or product disclosure has visible keyboard focus on mobile, the existing purchase bar uses normal document flow (`position: static`). This prevents it covering the inline accepted-cart link while retaining native Tab access to the bar's own controls. No purchase, availability, pricing, stock, submission or analytics logic changed.
- `tests/browser/storefront-keyboard.spec.ts`: two real-API cases exercise the phone shopping keyboard path and reduced-motion desktop focus. The bounded Tab traversal checks visible, unobscured focus; the phone case verifies one added unit persists after reload. Failure diagnostics retain public fixture geometry and a screenshot.
- `scripts/measure-storefront-performance.mjs`, `tests/scripts/storefront-performance.test.mjs`, and `docs/development/storefront-performance.md`: a repeatable tool for an already-running, permitted, isolated production service, with seven pure checks. It never starts, builds or seeds a server. No production measurements were executed in this pass.
- This dated report and additive SF-11/SF-12 notes record current evidence without replacing historical results.

## Verification

The sole runtime coordinator used pinned Node **22.13.1** / pnpm **10.34.5**, sequential runs, and the existing isolated automated stacks. HTTP fixtures created disposable databases. Browser fixtures used PostgreSQL 55433, API 3011, internal Vite 5174 and Next development 3001. No operational/demo database, production preview, hosting or domain was changed.

| Gate | Result |
| --- | --- |
| Public/catalog/checkout HTTP | **29/29 passed**, four files, 153.13s: catalog 16, checkout 9, storefront 2, storefront-sort 2. |
| Typecheck | Passed. |
| Architecture | Passed: 332 modules, 1,005 dependencies; 283 private-import files. |
| Initial combined browser | **29 passed / 1 failed**, 30 cases, 4.2 minutes. |
| Final phone check | **1/1 passed**, 31.0s, on the accepted CSS. |
| Final affected browser | **9/9 passed**, five files, 1.6 minutes, on the accepted CSS/test hashes. |
| Measurement-tool pure checks | Syntax and help passed; **7/7 tests passed**, 335.72ms. No browser samples. |
| Production build | API, internal, storefront and bundle separation passed: 33 internal files, 208 storefront files, 3 static entry files. Next BUILD_ID `DrTKlZ0Mrm7SOUYHdyAkB`. |

All 30 selected distinct browser cases have passing evidence across the initial and repair runs. This is **not one fresh 30/30 passing run**, and the final CSS was rerun against the nine affected cases. The other 21 cases passed in the initial combined run and were not repeated after the CSS-only correction. Unrelated internal ticket suites were not run.

### Browser repair history

Every failed run is retained; no assertion was removed or weakened to obtain the final pass.

| Log in `.scratch/storefront-completion-20261004/` | Result and reason |
| --- | --- |
| `browser.log` | 29/30 passed. A default role lookup excluded the intentionally hidden mobile add button while quantity had focus. |
| `keyboard-rerun.log` | 1/2 passed, 55.1s. The phone case advanced to another hidden inline-button lookup after stock exhaustion; visible disabled quantity and mobile action checks replaced that incorrect lookup. |
| `keyboard-final.log` | 1/2 passed, 53.9s. The strong focus check exposed the actual inline cart-link obstruction. |
| `affected.log` | 8/9 passed, 3.8 minutes. A trial CSS change cleared the obstruction but a helper waited for a hidden future Tab target, preventing the next Tab. |
| `keyboard-final-pass.log` | Despite its filename, **1/2 passed**, 45.4s. After the helper correction, traversal reached development Dev Tools shadow focus; this was not a passing gate. |
| `final-affected.log` | 8/9 passed, 2.2 minutes. A native scroll-margin attempt did not clear the inline link obstruction. |
| `phone-diagnostic.log` | 0/1 passed. The unchanged strong check reproduced the obstruction and saved `focus-obstruction.png`. Body-only geometry was not persisted by the line reporter; the final diagnostic now writes its JSON file directly. |
| `phone-fixed.log` | 1/1 passed on the accepted static-position rule. |
| `accepted-affected.log` | 9/9 passed on the same final source. |

The accepted CSS is `32E693A75F0247845AE4AB36F3797897CCB7804C8D388AED22C2C04A690BF72B`; keyboard spec is `1153D93F097A57726247AA4790F16150B479B4076EB10C4F73544CBA2F434CDB`. Final affected app/test hashes matched their frozen values after the browser run and build. Independent scoped Standards and Spec reviews reported zero findings on the accepted source.

### Commands and retained evidence

Exact commands, expanded initial browser file list, logs, source snapshots/hashes and screenshots are retained in ignored [local evidence](../../.scratch/storefront-completion-20261004/). The initial combined browser command is in `browser-command.txt`; it explicitly selects all `storefront*.spec.ts` files plus catalog-media, checkout and checkout-recovery, with one worker. `affected-command.txt` records the first affected trial. The final accepted command below selects keyboard, commerce, gallery/cart, experience and evolution (2+1+4+1+1 cases). Each repair run used its own output directory and log.

```text
pnpm exec vitest run --config vitest.config.ts tests/http/catalog.test.ts tests/http/checkout.test.ts tests/http/storefront.test.ts tests/http/storefront-sort.test.ts
pnpm typecheck
pnpm check:architecture
pnpm exec playwright test tests/browser/storefront-keyboard.spec.ts tests/browser/storefront-commerce.spec.ts tests/browser/storefront-gallery-cart.spec.ts tests/browser/storefront-experience.spec.ts tests/browser/storefront-evolution.spec.ts --workers=1 --output=.scratch/storefront-completion-20261004/accepted-affected-results --reporter=line
node --check scripts/measure-storefront-performance.mjs
node scripts/measure-storefront-performance.mjs --help
node --test tests/scripts/storefront-performance.test.mjs
pnpm build
```

Initial tracked dirty-file snapshots and the initial patch are preserved. Original `next-env.d.ts` bytes were restored exactly after build (SHA256 `1862AC4BBBC5192D4BF562161DF66EA547ED3E67173100656AB606AE9797DB2B`). Protected Grok review SHA256 remained `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Final named test/preview ports 3000/3001/3011/5174/55433/55438/55448/55456 were closed. No control file created by this pass remained; two pre-existing control files dated 2026-09-21 and 2026-09-29 were preserved. `git diff --check` passed and the index was empty. No staging, commit or push was performed; unrelated dirty files and raw font assets were left untouched.

## Limited visual review and remaining gates

The main agent reviewed the true unfiltered home at 390/1440px, phone add/cart focus, reduced-motion desktop focus and phone image fallback. Branding, cover ratio, separate CTA and dark sections remain; Arabic feedback and focus indicators are readable, and the final cart target is unobscured. Long synthetic categories show minor ordinal wrapping. Missing/revoked media and intentional one-pixel product images limit this to development-fixture readability, not merchandise or brand acceptance.

Current captures are under `accepted-affected-results/`, including `phone-keyboard-add-focus.png`, `phone-keyboard-cart-focus.png`, `desktop-reduced-motion-variant-focus.png`, gallery/cart fallback captures, and evolution `home-390.png` / `home-1440.png`. The initial `browser-results/` also retains the main-reviewed unfiltered home captures. The experience suite's filtered `/?q=BRAVOS` capture is not described as an unfiltered homepage.

SF-11 remains open: no 24-sample production matrix, matched `15fd366`/final production comparison, representative approved photography, interaction traces or production performance acceptance exists. The measurement tool and its pure tests do not satisfy those gates. The historical production-preview launch was rejected by automatic approval review as **“blocked by policy”**; this pass launched no production preview or alternative workaround.

Physical iOS Safari/Android Chrome, complete accessibility/mobile keyboard/safe-area review, approved photography/content, launch delivery configuration, richer representative production visual review, hosting/TLS/monitoring and release approval remain outstanding. No user preview is claimed to be running, and no whole-store or SF-12 completion is claimed.
