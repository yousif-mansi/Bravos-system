# Stock corrections and guest checkout review

Status: accepted on 2026-09-15 after independent review, repairs and root verification. Tickets 16 and 19 bring accepted delivery to 19/28 tickets.

Baseline: `8993585a80c5c2b67534802093b9befbad836f86`. Three GPT-5.6 Sol HIGH agents own isolated stock-correction, checkout API/internal configuration, and storefront checkout lanes. Root coordinates, reviews and verifies the combined application. GitHub issues #17 and #20 plus the approved v1 specification define this batch.

## Standards

Checkout review identified three findings: cart completion could overwrite newer cross-tab work, the new architecture rules were placed outside the configuration's rule array, and public eligibility regression coverage was incomplete. All three source repairs passed the independent narrow recheck. Every cart mutation now shares a Web Lock and reads the current persisted cart before writing, while accepted completion retains its operation marker with the cart. Architecture rules are correctly placed; the HTTP story now exercises initial and changed publication, required fields and inactive areas.

Stock-correction Standards review identified two findings: reconciliation must use retained source-snapshot evidence to reject a post-count snapshot presented as a pre-count sale, and the manager must see the device, occurrence, recording and count-boundary evidence beside the reconciliation action. Both repairs passed independent recheck. A follow-up found that the downstream-record guard queried Returns/Corrections tables from Sales; feature-owned read ports now supply those facts through the API composition root using the same transaction client. That repair also passed the independent narrow recheck. No actionable Standards finding remains.

## Spec

Checkout review found the same cross-tab cart loss; its repair passed the independent Spec recheck. No material backend or delivery-area UI Spec finding remained.

Stock-correction Spec review identified three backend findings: an already allocated late sale must receive the original count-deducted FIFO provenance while its displaced allocation is released; counted-sale quantity must be capped across all corrections rather than once per correction; and the physical-count cutoff must be distinct from the earlier coordination start. All three repairs passed the independent narrow Spec recheck. The immutable correction finalization timestamp records the manager's physical-count confirmation; coordination start remains separately available as `coordinationBoundaryAt` for pause/device evidence. Previously posted Returns or recording corrections produce an explicit rejection before reassignment, preserving their effects for prior correction rather than restoring stock twice.

## Early root review

The initial checkout UI discarded the pending identity on any non-success HTTP response, cleared later carts whenever it reloaded an accepted result, and offered an unsafe reset for conflicted/unreadable saved attempts. Those paths are repaired: ambiguous responses retain the exact identity, acceptance preserves newer cart work, and unresolved evidence remains available. A later independent review caught the remaining render-closure race, leading to the shared cart mutation lock described above.

Root also identified repeatable-read snapshot timing around concurrent submission locks. The adapter now obtains the operation lock before starting its coherent transaction and retries bounded serialization/deadlock conflicts. Accepted replay precedes current stock/price checks, so an already submitted request stays replayable after a physical sale or fee edit.

## Verification

First focused red tests ran against real PostgreSQL: ticket16 failed on its missing coordination endpoint (404 instead of 201), and ticket19 failed on its missing delivery-area endpoint (404 instead of 201). Schema/domain scaffolding had already begun for ticket19; no retrospective red-before-green claim applies to every source file. The initial storefront typecheck and collection of two browser tests passed, but collection is not browser acceptance.

Ticket19's five original PostgreSQL HTTP tests passed after a UUID validator repair. Root independently passed the expanded six-test file on its original port in 14.37 seconds (`root-batch-16-19-checkout-http-recheck.log`). Its three actual browser scenarios passed in 51.4 seconds after test-only Arabic numeral and selector repairs. They verify manager area create/edit, phone-friendly guest fields and discounts, directly delayed accepted response while another tab adds an item, server acceptance followed by a 502 and exact reload replay, stale fee review, and later insufficient-stock rejection. Log: `19-ui-browser-final-rerun.log` under root `.scratch/sol-implementation/`.

The first root checkout rerun failed during database setup, before any assertions. A surviving PostgreSQL `io_worker` retained the finished parent's listening socket: netstat reported the dead parent, while process inspection identified the child and its checkout-lane executable. Root verified the absent parent and exact child path, stopped only that orphan, and reran successfully. No active database or unrelated process was stopped.

Ticket16's revised first HTTP slice passed with explicit acknowledgement bound to the synchronized snapshot; a background refresh alone no longer implies a till observed the pause. Later focused tests exposed a final-held-unit constraint failure, which was repaired and passed its narrow recheck. Internal typecheck and the first actual stock-correction browser story passed (1/1 in 1.1 minutes): two tills, explicit acknowledgement, lost-response replay and a positive correction using retained batch provenance. Review-driven reconciliation regressions remain in progress. The completed checkout API agent assists with only the StockCorrections page and browser test in ticket16's worktree; its backend and POS-pause files remain owned by the original ticket16 agent. Root integrated a source snapshot without merge conflicts; this is not acceptance.

Root's integrated scratch migration gate passed for 001–021: batch down/reapply, full down/reapply and transactional failure rollback. The same verified-orphan Windows cleanup was needed after its assertions completed. A separate legacy-till backfill regression is written and awaits the HTTP gate; it does not treat an old device as synchronized merely because migration 020 discovered it.

Root passed typechecking across 17 workspace packages, production application builds and bundle separation, automated architecture checks, and an audit with zero vulnerabilities. All 159 HTTP tests in 17 files passed in the full run. After the final feature-interface repair, root reran typecheck, the API production build, architecture, and all seven stock-correction HTTP tests; each passed. All 85 browser tests passed in the full combined run, including production offline restart/reconnect, existing Returns/exchanges, and both new workflows. Evidence is saved under ignored `.scratch/sol-implementation/` and each lane's `.scratch/`. The unrelated user edit in `docs/reviews/bravos-v1-grok-review.md` is excluded and retains SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

| Root gate | Result | Evidence under `.scratch/sol-implementation/` |
| --- | --- | --- |
| Typecheck | 17 packages passed; final repair rechecked | `root-batch-16-19-typecheck.log` |
| HTTP | 159/159 across 17 files | `root-batch-16-19-http.log` |
| Final stock HTTP recheck | 7/7 | `root-batch-16-19-stock-http-recheck.log` |
| Production builds and bundle separation | Passed; final API repair rebuilt | `root-batch-16-19-build.log`, `root-batch-16-19-api-build-recheck.log` |
| Architecture | Passed after final repair | `root-batch-16-19-architecture.log` |
| Migration apply/down/reapply and rollback | 001–021 passed | `root-batch-16-19-migrations.log` |
| Browser | 85/85 | `root-batch-16-19-browser.log` |
| Dependency audit | Zero vulnerabilities | `root-batch-16-19-audit.log` |

Standards: three checkout findings and three stock-correction findings, all resolved. Spec: one checkout finding and three stock-correction findings, all resolved. No actionable finding remains on either axis. These are local feature acceptance results; online order confirmation/fulfillment and the remaining release scope are still separate queued tickets.
