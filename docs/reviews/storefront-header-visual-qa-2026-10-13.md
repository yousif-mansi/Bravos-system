# Storefront header visual QA — 13 October 2026

Bounded task 01 on `codex/readiness-issue-reconciliation` at `f7507e20f5162987644f424d5a61865828a27e41`. Isolated development evidence only. Header/glass samples remain manual by design. This does not close SF11, SF12, production, device, or launch acceptance.

## Outcome

**Scoped pass for the reviewed header states. No demonstrated defect. No application or test source change.**

Ivory nav text, the gold cart-count badge, and the 3px gold `:focus-visible` outline remain readable on the translucent header at 320, 390, 768, 1024, and 1440 CSS pixels, at rest and after document scroll. The header is `position: static`; after `scrollY = 520` it leaves the viewport and does not sit over later photography. Main's independent capture review and acceptance are recorded below.

## 1. Findings and provenance

Source of the reviewed header:

- `apps/storefront/app/components/store-header.tsx` — wordmark `aria-label="برافوس"`, nav `aria-label="التنقل الرئيسي"`, links المتجر / التشكيلة / CartLink.
- `apps/storefront/app/globals.css` — `:focus-visible { outline: 3px solid var(--store-focus); outline-offset: 3px; }`; `.store-header { background: rgba(12,13,13,.84); backdrop-filter: blur(12px); }` with no sticky/fixed positioning; nav `min-height: 44px`; wrap/center at `max-width: 360px`.
- Tokens: `--store-ink: #f3efe6`; `--store-canvas: #0c0d0d`; `--store-accent: #d9c5a2`; `--store-focus: #e2cda3`. Body canvas plus `radial-gradient(..., rgba(217,197,162,.055), ...)`.

Current-source evidence, not the historical 5/9/10 October files:

| Kind | Path |
| --- | --- |
| Experience suite log | `.scratch/ux-completion-20261013/task-01/storefront-experience-1.log` |
| Copied experience artifacts | `.scratch/ux-completion-20261013/task-01/run-1-test-results/` |
| Header capture log | `.scratch/ux-completion-20261013/task-01/header-capture.log` |
| Header crops / focus / scrolled | `.scratch/ux-completion-20261013/task-01/header-captures/` |
| Contrast bound | `.scratch/ux-completion-20261013/task-01/contrast-bound.json` |

`measureContrast` classified `header-link` as **manual** (`Backdrop blur leaves the surface translucent...`) with `ratio: null`. That helper result is **not** an accessibility pass. `header-cart-count` resolved as a solid surface: `rgb(12,13,13)` on `rgb(217,197,162)`, **11.55:1**, threshold 4.5.

### Conservative compositing bound (declared CSS only)

Method: WCAG 2 relative luminance after source-over compositing of declared colors. Backdrop blur is not flattened and is treated as not lightening beyond the lightest declared behind-pixel (the body gradient stop over canvas). The helper was not changed.

| Pair | Foreground | Worst-case background | Ratio |
| --- | --- | --- | --- |
| Nav text | `#f3efe6` / `rgb(243,239,230)` | glass over gradient ≈ `rgb(14,15,14)` | **16.77:1** |
| Hover accent | `#d9c5a2` | same glass | **11.42:1** |
| Focus outline | `#e2cda3` | same glass | **12.37:1** |
| Cart badge | `#0c0d0d` on opaque `#d9c5a2` | solid (helper) | **11.55:1** |

Unrealistic white-behind glass still **10.92:1**. Assumptions: header is in normal flow, so backdrop-filter samples the body canvas and top radial gradient, not later sibling photography; blur does not invent a lighter color than that gradient stop. This bound does not prove photographic badges, every pixel of a live page, or all WCAG contrast.

### Per-width / state (current captures)

All 15 route×width records: header `position: static`, `background: rgba(12, 13, 13, 0.84)`, `backdrop-filter: blur(12px)`. Nav links and wordmark ≥ 44×44 CSS px. Focus: `:focus-visible`, `outline: 3px solid rgb(226, 205, 163)`, offset `3px`.

| Width | Initial | Focus | Scrolled (`scrollY=520`) |
| --- | --- | --- | --- |
| 320 | Centered wrap; ivory links; gold count. `arrival-320-header.png` | Gold box on المتجر / السلة clearly visible. `arrival-320-focus-store-header.png`, `arrival-320-focus-cart-header.png` | Header out of viewport (`top: -520`). `arrival-320-scrolled-viewport.png` |
| 390 | Single row, logo inline-end. `arrival-390-header.png` | Same visible gold outline. `arrival-390-focus-store-header.png` | Header gone |
| 768 | Single row, readable ivory/gold. `arrival-768-header.png` | Visible outline. `arrival-768-focus-store-header.png` | Header gone |
| 1024 | Same. `arrival-1024-header.png` | Visible outline on السلة. `arrival-1024-focus-cart-header.png` | Header gone |
| 1440 | Same. `arrival-1440-header.png` | Visible outline. `arrival-1440-focus-store-header.png` | Header gone; photography in view without header overlay. `arrival-1440-scrolled-viewport.png` |

Product and cart headers match the same glass/text/focus pattern (`product-320-focus-cart-header.png`, `cart-320-header.png`). Default unfocused ivory is recorded at 320 and 390. Some 768+ “initial” crops still show a leftover pointer-hover accent from the previous viewport’s hover action in the capture script; computed hover is `rgb(217,197,162)` with an accent underline, which is the existing hover rule.

No clipping of nav text, missing focus ring, or unreadable glass state was reproduced.

## 2. Changed files

**No source changes.** `store-header.tsx`, `globals.css`, and `tests/browser/storefront-experience.spec.ts` are unchanged versus HEAD. Scratch capture scripts stay in ignored `.scratch/ux-completion-20261013/task-01/` and are not for commit.

This report is the only intended tracked add.

## 3. Gates and exits

Pinned Node `v22.23.3` (`.local/tools/node-v22.23.3-win-x64/node.exe`) and pnpm `10.34.5` (`.local/tools/node_modules/pnpm/bin/pnpm.cjs`). `COREPACK_ENABLE_AUTO_PIN=0`. PATH: `.local/tools/node_modules/.bin` then the pinned Node directory.

| Run | Command | Playwright | Wrapper exit | Log |
| --- | --- | --- | --- | --- |
| Experience (unmodified spec) | `pnpm test:browser tests/browser/storefront-experience.spec.ts --workers=1` | **1 passed (2.1m)** | **1** | `storefront-experience-1.log` |
| Header capture (scratch only) | `pnpm exec playwright test --config=.scratch/ux-completion-20261013/task-01/playwright.header-capture.config.ts --workers=1` | **1 passed (53.2s)** | **1** | `header-capture.log` |

Both wrapper failures are **globalTeardown** `E2E graceful shutdown failed (500): {"stopped":false}` after `connect EACCES ::1:55433` while stopping isolated Postgres. They are not product-spec failures. The capture rerun does not replace the experience run. Documentation-only: typecheck, architecture, keyboard/evolution suites, and storefront production build were not repeated.

Existing experience assertions kept: `header-link` must remain manual with a glass/backdrop/image/gradient reason; solid samples still go through `expectContrast`; 44px coverage and five-width geometry unchanged.

## 4. Contrast method limits

- Solid-surface ratios in `contrast-samples.json` are machine-checked.
- Glass, gradient, and background-image samples are manual screenshots with null ratios.
- The compositing bound uses declared CSS, not pixel sampling of photography.
- CSS zoom in the experience spec is not browser 200% zoom.
- Chromium `next dev` is not Safari, Android Chrome, screen-reader speech, or production.

## 5. Source, index, hash, processes

| Check | Result |
| --- | --- |
| Branch / HEAD | `codex/readiness-issue-reconciliation` / `f7507e20f5162987644f424d5a61865828a27e41` |
| Index | empty |
| Protected `docs/reviews/bravos-v1-grok-review.md` SHA256 | `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A` |
| `apps/storefront/next-env.d.ts` | restored to `0F70629890B72A0A82E91972CC032C04B658B26C265373CB711CF576BFBF8FCC` |
| `apps/storefront/tsconfig.json` | restored to `C347427786B19C87BBF31109DD92C04AF9B2B9F19C9DB1026BE6F5C8802D0A5E` |
| Preexisting dirty protected review / untracked readiness audit / fonts / `.pnpm-store` | left as found |
| Isolated 3011, 3001, 5174, 55433 | free before and after; leftover task listeners none |
| Ordinary 3010, 5173, 3000, 54329 | free throughout; not started |
| Historical `.local/e2e-control-*.json` | not deleted |
| Ordinary stores/media/queued sales | untouched; fixtures only in disposable e2e DB |

## 6. Remaining owner / device / production gates

Physical Safari/iPhone/iPad and Android Chrome, true 200% browser zoom, screen-reader speech, representative merchandise photography under glass, and production visual/performance acceptance remain open. Isolated `next dev` teardown `EACCES ::1:55433` is a local stack-stop issue for main; this task did not change teardown. Production `next start` / `release:rehearse` were not attempted.

Completion of this task means the evidence artifacts exist and owned processes have exited. The storefront and launch are not complete.

## Main review and independent acceptance

Main inspected fresh header crops at all five widths, including the 320px store focus, 768px cart focus and desktop states. No clipped navigation or missing outline was demonstrated. Main independently recomputed the declared-color compositing ratios: normal ivory16.77:1, hover11.42:1 and focus12.37:1. A hypothetical white backdrop still gives10.92/7.44/8.05 respectively. These are conservative CSS bounds, not photograph pixel sampling or a global accessibility claim.

After Grok exited and released the test environment, main ran the unmodified existing experience file on a new isolated stack with pinned tools: **1 passed (1.1m), complete wrapper exit0**. Full log: `.scratch/ux-completion-20261013/task-01-main/storefront-experience.log`; numeric exit: `exit.txt`. The earlier two Grok wrapper failures remain retained. The IPv6 denial did not recur in this independent execution context; its exact execution-environment cause is not established and no harness code was changed.

Generated Next files were restored to saved bytes; application/browser-test diff is empty, index stays empty and protected hash matches. Isolated and ordinary listed ports were free after verification. Main accepts this bounded header review with no styling change. Full SF12, device, representative-content and production acceptance remain open.
