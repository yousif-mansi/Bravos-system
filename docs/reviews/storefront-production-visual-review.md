# Storefront production visual review — post-checkpoint follow-up

Recorded 30 September 2026 (Cairo), after committed and pushed checkpoint `dacf3c7205ce92f60613fb66ff564e891f2c0da1`. This supplements the [evolution verification](storefront-evolution-verification.md) and [partial SF-12 record](storefront-experience-verification.md); their historical results remain unchanged. The user authorized continued production preview, screenshots, brand review and polish after the checkpoint.

## Checkpoint and review scope

The reviewed range is `fec7ec7..dacf3c7`, including the prior `b946a00` work. The checkpoint contains 197 verified paths combining the Phase 1 operational prerequisites and storefront work. Shared catalog, inventory, online-order and API dependencies make the storefront delta dependent on those operational changes; this is not a standalone presentation-only checkpoint. Unrelated protected review edits, generated files, local environments/databases, raw font collections and scratch outputs were excluded. The [scope recommendation](../../.scratch/checkpoint-review/scope.md) and [content audit](../../.scratch/checkpoint-review/audit.md) retain the exact boundaries.

This follow-up makes documentation changes only. It introduces no application, build, catalog, stock or production deployment change.

## Production evidence outcome

| Evidence | Outcome | Boundary |
| --- | --- | --- |
| Production preview | **Uncaptured.** The renewed hidden launch of the pinned Node runtime with `next start --hostname 127.0.0.1 --port 3000` was rejected before execution by automatic approval review. | Exact returned reason: `rejected: blocked by policy`; no further rationale was supplied. Renewed user authorization did not make the launch executable. |
| Planned 24 cold measurements | **0 captured.** | No production LCP, CLS, transfer, request-count or interaction result is claimed. |
| Planned 20 rich demo screenshots | **0 captured.** | No production demo composition or new brand acceptance is claimed. |
| Isolated demo recovery | Last successful QA observation: healthy API `http://127.0.0.1:3012` and PostgreSQL on `127.0.0.1:55434`. | Subsequent listener/API revalidation was also rejected before execution. These are isolated local demo services, not a running production storefront. `http://127.0.0.1:3000` is the requested preview URL, not an available preview. |

The [renewed retry record](../../.scratch/storefront-evolution-verification/production-retry-2026-09-30.md) preserves both rejections and the last successful local service identity evidence. The existing production build ID was read as `fOKYHaM91d1nTKz1MZhWk`; this identifies a build, not an executed preview. No production screenshots or metrics artifact exists for this attempt.

The user can launch the existing local production build in a foreground PowerShell terminal from the repository root, using the recorded Node 22.13.1 / pnpm 10.34.5 path. This command was not executed by this follow-up and assumes the isolated demo API is running; it contains no credentials:

```powershell
$env:PATH='C:\Users\Yousif Mansi\Desktop\bravos system\.local\tools\node_modules\.bin;C:\Program Files\nodejs;'+$env:PATH
$env:BRAVOS_API_ORIGIN='http://127.0.0.1:3012'
$env:BRAVOS_STOREFRONT_DEMO='1'
$env:NODE_ENV='production'
pnpm --filter @bravos/storefront exec next start --hostname 127.0.0.1 --port 3000
```

After a successful launch, the local storefront URL is `http://127.0.0.1:3000`. Stop the foreground preview with Ctrl+C. The [demo guide](../development/storefront-demo.md) describes the separate guarded API/database lifecycle.

## Available visual evidence and remaining gates

The earlier development-server matrix covers five routes at 320/390/768/1440px, with 20 captures, no recorded overflow/font/image/runtime failure and maximum observed CLS 0.00852. The evolution record preserves its initial failures and final focused 7/7 browser rerun, rather than claiming a fresh full-suite pass. Existing main-agent source/CSS and sampled synthetic screenshots found no blocking presentation defect; that assessment accepts the uncropped supplied cover, action below it, centered mobile Arabic and separated sections under the [current execution brief](../planning/storefront-evolution-execution.md). It does not establish a new production brand review.

For this follow-up, the main agent additionally reviewed the existing regression [product capture at 390px](../../test-results/storefront-evolution-store-ac479--layout-or-runtime-failures/product-390.png) and [cart capture at 1440px](../../test-results/storefront-evolution-store-ac479--layout-or-runtime-failures/cart-1440.png). The disposition is to retain the obsidian/ivory/champagne palette, original header/footer logos, current Arabic font roles and centered mobile headings; cart summary hierarchy and the shopping action are readable. These captures provide no evidence justifying further style edits. Synthetic black-pixel merchandise media cannot establish merchandising or photographic art direction. The full-page product capture includes the fixed mobile purchase bar over its initial viewport: live scroll, keyboard and safe-area behavior must be reviewed in production and on real devices before the remaining SF-12 acceptance; the static image alone does not establish a blocking defect.

SF-03 retains the implemented arrival composition; rich demo review remains pending. SF-11 remains open, including matched `15fd366`/final production builds, representative approved merchandise photographs, cold-run transfer/interaction measurements and relevant media revocation evidence. SF-12 remains partial: complete accessibility and integrated journey evidence, physical iOS Safari/Android Chrome, production delivery configuration and hosted TLS/monitoring acceptance remain outstanding. Any future local Chromium measurements are lab evidence, not field p75 or physical-device evidence.

The committed implementation checkpoint is preserved. Production visual QA and storefront launch acceptance are not complete.
