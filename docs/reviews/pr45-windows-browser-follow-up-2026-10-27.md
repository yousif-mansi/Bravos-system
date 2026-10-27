# PR45 Windows browser follow-up — local verification

Reviewed 27 October 2026, Africa/Cairo. **The three focused Windows browser cases pass locally. PR45 was merged before these follow-up fixes were published.** This report records the separate browser-repair changeset; three-device POS hardware validation is published separately. A local focused rerun does not change the remote check status or prove the complete suite passes.

## Recorded outcomes

Evidence is retained under `.scratch/pos-hardware-20261027/`. Local work uses Windows, Node 22.23.3 and pnpm 10.34.5.

| Check/run | Result | Evidence |
| --- | --- | --- |
| Existing remote Windows browser check | 185 passed, 3 failed; exit 1 | `pr45-browser-current.log` |
| Initial focused local three-case run | 2 passed, 1 failed | `ci-three-initial.log` |
| Focused local rerun | 2 passed, 1 failed | `ci-three-rerun.log` |
| Fresh final focused acceptance after probe correction | 3 passed in 1.2m | `ci-three-final.log` |
| Any later complete Windows browser gate | **Pending; no pass claimed** | Record scope/revision and evidence if run |

The remote failures were `storefront-experience.spec.ts`, `storefront-keyboard.spec.ts` and `storefront-product-ux.spec.ts`. The focused local initial run and rerun both passed keyboard navigation and category-heading/filter recovery. The experience case remained red in both local runs.

The initial local experience failure reported mixed Arabic/Latin product-title clipping at 390px (`223 > 220`). The rerun reported `product-title-clamp` / `box-clamp` at 320px. The probe overspecified the computed `display: -webkit-box` implementation detail for the deliberate two-line title treatment. The correction removed that display requirement while retaining computed clamp value 2, vertical orientation, full title text, direction, centered/wrapping text, two-line bounds and containment checks, alongside the original viewport checks. No assertion was waived globally, and no source card redesign was made. The final fresh run passed all three focused cases.

The not-found recovery button's minimum width of 44px remains a real UI fix, separate from the probe correction. Local passing evidence covers the focused cases only; PR45's recorded result remains 185 passed / 3 failed. This follow-up requires its own subsequent remote run.

## Completion requirements and limits

Any claim about the full Windows browser gate requires an actual complete result at the stated revision. The focused presentation check covers its route, geometry and screenshot assertions; this CI repair does not constitute a new complete storefront design sign-off. Publishing requires the owner's approval.

User applications/data and the protected review document remain untouched. Main review rechecked PR45 through the read-only GitHub CLI on 27 October: head `5b5e400dc9a297790371a3f3e7f96c71d352201b`, merged as `314e3818f896cbb8f0178b43c3d6754c3d75f9ad`, static/build and HTTP checks successful, recorded browser check failed. The owner subsequently authorized publishing the separate CI and hardware changesets. Neither a focused local pass nor POS hardware acceptance establishes production-launch readiness. Further merges require explicit owner approval after required checks pass.
