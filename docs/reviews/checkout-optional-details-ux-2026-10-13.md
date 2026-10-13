# Checkout optional delivery details — 2026-10-13

Presentation-only change for mobile density. Empty optional delivery details start inside a collapsed native disclosure. This is not a measured conversion change and is not storefront, device, or production acceptance.

## Behavior

The checkout form still shows name, primary phone, delivery area, and detailed address, then the coupon and price-review fieldset. Alternate phone, landmark, and notes stay in that DOM order inside:

`<details><summary>تفاصيل إضافية للتوصيل (اختياري)</summary>…</details>`

The disclosure opens on mount only when the in-memory checkout draft already has a nonempty trimmed alternate phone, landmark, or notes. `onToggle` stores the visitor's later open or closed choice. Closing stays closed while the page stays mounted. Returning to checkout with those draft values still present mounts the page open again. Fields stay mounted; collapsing does not clear, disable, or omit them. No viewport split and no extra draft storage.

Optional controls have no native `required`, `pattern`, `minLength`, or `maxLength`. The notes textarea also has no `name`, which matches the existing field. Concealing them does not hide an invalid control. Required-field validation, quote identity, area fees, totals, submission, stock repair, pending and accepted recovery, acknowledgment wording, and blank-optional omission are unchanged.

Summary uses the native element, a 44px minimum height, and the existing focus outline. The page remains `dir="rtl"`. No custom ARIA role replaces the native disclosure.

## Corrections in this continuation

Relative `details` filters now use a page-rooted `summary` locator. The previous `form.locator("summary")` inner filter looked for a `form` inside each `details` node.

New screenshots use `testInfo.outputPath(...)`. Copies for review live only under ignored `.scratch/ux-completion-20261013/task-03/captures/`.

`browser-2.log` then showed one real failure: at 390px, `getByRole("textbox")` does not match the alternate phone inside a closed `details`, so `toBeHidden` passed on a missing element and `toHaveValue` reported `element(s) not found`. The keyboard spec now uses `includeHidden: true` and asserts the control is attached. That keeps the value, hidden, reopen, and submitted-payload checks.

## Gates

Pinned Node `v22.23.3` and pinned `pnpm.cjs`, with `COREPACK_ENABLE_AUTO_PIN=0`. One Playwright worker. Ports 3001, 3011, 5174, and 55433 were clear before each launch. Full logs are in `.scratch/ux-completion-20261013/task-03/`.

| Log | Result |
| --- | --- |
| `typecheck-1.log` | Exit 2. Retained `defaultOpen` failure. Not a pass. |
| `typecheck-2.log` | Exit 0. Prior `useState` plus `open`/`onToggle` correction. |
| `typecheck-3.log` | Exit 0. This continuation, before the keyboard locator fix. Production source did not change after it. |
| `architecture-1.log` | Exit 0. 444 modules, 1063 dependencies, private-import check 385 files. |
| `architecture-2.log` | Exit 0. Same counts. |
| `browser-1.log` | Interrupted. No `EXIT=` line. Not a pass. |
| `browser-2.log` | Exit 1. 1 failed, 24 passed (2.9m). Keyboard hidden-value lookup above. |
| `browser-3.log` | Exit 0. 25 passed (2.7m). |
| `build-1.log` | Exit 0. `next build` for `@bravos/storefront` only. Checkout route compiled as dynamic. |

`browser-3` covered `checkout.spec.ts`, `checkout-recovery.spec.ts`, `storefront-product-ux.spec.ts`, `storefront-integration.spec.ts`, `storefront-keyboard.spec.ts`, and `storefront-experience.spec.ts`. The passing runs include blank-optional omission, closed disclosure with a retained alternate phone on submit, cart-repair return with the draft shown open, quote and stock responses, and accepted-order recovery. `storefront-experience.spec.ts` needed no edit.

## Captures

Isolated e2e fixtures only. The Next.js dev overlay marker is visible. These are not production catalog or media shots.

- `captures/empty-collapsed-390.png` and `captures/empty-collapsed-1440.png`: disclosure closed; required fields and coupon review remain.
- `captures/empty-expanded-390.png` and `captures/empty-expanded-1440.png`: the three optional fields are shown.
- `captures/expanded-focus-320.png`: 320px expanded summary after focus. The browser test also asserted no horizontal overflow.
- `captures/populated-return-390.png` and `captures/populated-return-1440.png`: after cart repair, optional values are visible in an open disclosure.

## Cleanup

`docs/reviews/bravos-v1-grok-review.md` SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

`apps/storefront/next-env.d.ts` and `apps/storefront/tsconfig.json` were restored to the saved before-bytes (`0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC` and `C347427786B19C87BBF31109DD92C04AF9B2B9F19C9DB1026BE6F5C8802D0A5E`). They are not in the tracked diff. The interrupted dev run had pointed them at `.next-e2e`.

Listeners on 3001, 3011, 5174, and 55433 were closed after the failed run and again after the passing run and the build. No owned process remained. Historical `.local/e2e-control-*.json` files were not deleted. Nothing was staged, committed, pushed, or deployed. Branch remains `codex/readiness-issue-reconciliation` at `f7507e20f5162987644f424d5a61865828a27e41`.

## Limits

No physical device pass. No production `next start`. Fixture copy and the dev overlay are nonrepresentative. Main review and independent verification after Grok's handoff are recorded below.

## Main review and independent acceptance

Main accepted this bounded presentation change after reviewing the complete source/test diff, all seven Grok captures and the independent phone-collapsed/desktop-populated captures. A separate read-only source review found no blocking findings. Requiredness, payload composition, quote/stock handling, omission, recovery and draft clearing remain unchanged. The disclosure permits deliberate closing, preserves mounted values, and opens on return with a populated optional draft.

Main then ran a fresh, serial cycle on the final source from 02:13:23 to 02:16:32 UTC on 13 October 2026:

| Independent gate | Result |
| --- | --- |
| Same six browser files, one worker | **25 passed (2.7m); complete wrapper exit 0**, including teardown |
| Workspace typecheck | Exit 0 |
| Architecture/private imports | Exit 0; 444 modules, 1065 dependencies, 385 private-import files |
| Storefront production build, compilation only | Exit 0; no production server started |

Commands, UTC timestamps and numerical exits are retained in `.scratch/ux-completion-20261013/task-03-main/results.json`, with full logs and seven copied captures beside it. Source identity across the cycle is recorded in `source-before.json` and `source-after.json`; all eight reviewed source/test hashes match. Protected review hash and both generated Next files match their original saved hashes. The index is empty; no isolated listener remains on 3001/3011/5174/55433. No commit, push, merge, deployment, ordinary business-data change or issue closure occurred.

The 320px programmatic-focus capture proves neither keyboard modality nor a painted focus ring by itself. The passing 390px keyboard journey uses Tab, verifies focus/visibility/viewport placement/painted outline and 44px target size, toggles with Enter and checks retained values and accepted submission. Full-page images also show an unfocused skip link within some tall captures. Its fixed, translated source positioning is unchanged; a full-page capture artifact after scrolling is plausible, but these images do not establish an actual viewport overlap. No speculative global CSS correction was made.

Earlier evidence remains separate: the original task relay was stopped for source/test review with an interrupted browser run; its attempted resumed session then produced zero events before a controlled stop. The fresh session `01a132fa-97e1-7e61-9cb8-5193f019c326` completed with relay/process exit 0. The initial type error and the 24-pass/1-fail run remain beside the corrected 25-pass run. Neither interruption establishes a quota failure or a completed gate.

These are current collapsed/expanded/populated states of the final development implementation, not a matched old-build/new-build visual experiment. They do not establish conversion improvement, representative fashion-media acceptance, full SF-12 completion or production readiness. Those launch gates remain open.
