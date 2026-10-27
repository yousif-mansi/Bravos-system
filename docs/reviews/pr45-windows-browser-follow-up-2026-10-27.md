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

## PR53 fresh-CI investigation and repair

PR53 head `7bceac5` subsequently completed its remote browser run with **183 passed / 5 failed**. Build/static and HTTP jobs passed. The owner requested investigation and Grok implementation of the remaining fixes. The failed run is `40434501142`, browser job `121961039204`; its retained log is `.scratch/pos-hardware-20261027/publication/pr53-browser-failure.log`.

| Failure | Evidence and bounded correction |
| --- | --- |
| Pinned unpaid cart / prior completed sale | The workspace counter initially renders zero before reading durable state. Poll the identified sale's durable acknowledgement before taking the final snapshot, then retain the UI-zero, exact stock and completed-fact assertions. |
| New local sale during held acknowledgement | Install the context interceptor before removing the page abort. After initial readiness, block snapshot refresh during this acknowledgement-only interleaving; snapshot proof could otherwise acknowledge the committed sale while its response is deliberately held. All out-of-order response, payload and quantity assertions remain. |
| Native keyboard traversal of category rows | Position the full target row/rail below the sticky header after native entry traversal and before recording the vertical baseline. Preserve native Tab/Shift+Tab, horizontal position, outline and unchanged-document-scroll checks. Failure diagnostics capture before/after geometry and rethrow. The historical exact scroll mechanism remains unproven. |
| Sorting and shopping-journey category navigation | CI requested the correct destinations, but server responses took 44s and 26.7s, exceeding unchanged 15s URL assertions. No evidence shows ignored clicks. Remove proven availability-read amplification: filter category quantity IDs first, and replace repeated correlated branch/variant sums with grouped reads and separate positive-discrepancy holds. No navigation timeout was increased. |

Grok authored the source/test fixes; independent Sol reviewers checked the synchronization fixtures, keyboard precondition and quantity-query semantics. Main deferred the grouped sum's integer conversion until after the discrepancy CASE, preserving held-zero behavior for large sums. No schema, API shape, stock write, FIFO allocation, price, permission or persistent-cache change was introduced.

The isolated SQL microbenchmark uses the actual old/new query text with a minimal query-relevant schema: two branches, 500 requested variants, 4,000 batches, 7,642 balances and 176 discrepancy rows. It omits unrelated business constraints and includes synthetic zero-discrepancy rows only to exercise the predicate. Results matched an independent oracle exactly for 1, 100 and 500 variants. Median server execution at 500 variants changed from 15.566ms to 4.258ms; at one variant it changed from 0.177ms to 0.190ms. This verifies query work reduction and result equivalence in that fixture; it does **not** establish the cause or elimination of the historical 26/44-second CI navigation stalls. No ordinary database was accessed. The HTTP regressions separately use the real migrated schema.

Current follow-up evidence is under `.scratch/pr53-repair-20261027/`:

| Gate | Result | Evidence |
| --- | --- | --- |
| Catalog HTTP regressions, including branch sums/holds/MAX and category options | 18 passed | `catalog-http-initial.log` |
| All five previously failing browser cases, together | 5 passed in 1.8m | `five-browser-initial.log` |
| Real SQL result comparison and EXPLAIN measurements | Passed, with the limitations above | `availability-benchmark.log` |
| Receiving, sales and order-confirmation HTTP regressions | 54 passed across three files | `stock-http-regressions.log` |
| Workspace typecheck | Passed | `typecheck.log` |
| Architecture/private imports | Passed; 461 modules / 391 files checked | `architecture.log` |
| API, staff and storefront production builds / bundle checks | Passed | `build.log` |
| Full accumulated 188-case browser run | 182 passed / 6 failed in 19.6m; retained red run | `browser-full.log` |
| Follow-up run of all six affected browser files | 21 passed in 4.5m | `readiness-regressions.log` |

The full run additionally exposed branch-selection/readiness gaps in Coupons, Returns and staff-feedback fixtures; the latter also dispatched its account event before establishing that the initial read was held. Storefront initial scrolling in analytics/keyboard tests could use a node before client commit. The mobile cart helper could lose its pre-commit quantity/focus and then target an unavailable inline action. Corrections wait for the existing active-branch, enabled Sort or enabled Preview bag signals, explicitly establish the held request, assert the requested quantity and use the currently accessible Add to bag action. All money, stock, coupon, analytics, stale-response and keyboard assertions remain. No timeout was increased, test disabled, forced click added or failed business operation retried.

The initial row detachment and input reset do not by themselves establish an application hydration defect; their exact browser mechanism remains unproven. Four of the original five cases passed in the full run; keyboard stopped at its earlier readiness gap before the focus traversal. The follow-up 21-case run includes the corrected keyboard scenario at all its supported widths. These scopes are reported separately: there is **no fresh local 188/188 claim** after the final test-only readiness edits.

The owner authorized publication and then requested Grok to repair the fresh CI failures. Main reviewed the final diffs and local evidence before updating the existing PRs. PR54's 38 hardware files remain separate. A complete remote CI pass at the updated PR53 revision, followed by the applicable hardware checks and explicit merge approvals, remains required. No deployment or merge is authorized by this report.
