# Local client acceptance — main review, 18 October 2026

The isolated practice copy is running on this Windows computer and is ready for local client evaluation. Engineering accepts that session and the assembled business coverage below. This is not client approval, a locked product, a production release, or a claim that every remaining item is done.

Client sign-off stays blank. The only configuration still waiting on the owner is a contact number, and only after the owner supplies one. No further feature is required for this local evaluation.

## Business outcome

A person on this computer can open the English store and the Arabic staff application against one persistent practice database, without Internet and without hosting.

| Surface | Actual address |
| --- | --- |
| Practice API health | http://127.0.0.1:3012/api/public/health |
| Staff built preview | http://127.0.0.1:5177 |
| Storefront, Next development | http://127.0.0.1:3002 |
| PostgreSQL | port 54330, database `bravos_client_acceptance_20261016` |

`.scratch/client-acceptance-20261016/practice-health-20261018.json` records HTTP 200 for all three application addresses. Leave these services running. The ordinary database `bravos_phase1_20260929` on 54329, with 3010, 5173, and 3000, stayed stopped and unchanged. It was not seeded or reset.

The practice catalog was created once through feature APIs: 30 fictional sample products, 120 variants, 60 receipts, 5 units per variant per branch (1,200 units at intake), 30 public images, and four categories (6 jackets, 8 pants, 8 shirts, 8 T-shirts). Fayoum delivery is 5,000 piasters (EGP 50). Markers `seed-result.json` and `seed-complete.json` remain under `.local/client-acceptance-20261016/`. Restart does not refill stock. Later practice sales, the receipt, the return, and the offline sale changed quantities; intake quantity 5 is the starting figure only.

Private logins stay in `.local/client-acceptance-20261016/demo-credentials.txt`. They are not copied here. The encrypted backup and its passphrase stay under `.local/client-acceptance-20261016/` as well.

While the local API is running, the connected store and staff workflows can be evaluated with no Internet. A browser that cannot reach that API is limited to the approved cached cash sale in POS.

## What changed for people

Earlier receiving and bag-wording corrections remain in place. The only new application setting on 18 October is `devIndicators: false` in `apps/storefront/next.config.ts`. It removes the overlapping Next development badge on the mobile commerce controls. Next restarted itself in development. It was not switched to a production start. Main screenshot `dev-badge-fixed-390.png` shows the controls unobstructed. The `nextjs-portal` element is still present. Storefront typecheck passed in `.scratch/client-acceptance-20261016/practice-storefront-typecheck-20261018.log`.

No API, schema, permission, stock, order, or recovery logic change was made. The acceptance script was patched only so the second run could continue after the sale that had already been saved.

The owner explicitly approved the dark staff screens. Keep them. The store stays English. The contact link is unset because the owner has not provided a number. No contact was invented.

## Assembled coverage on this practice database

These are two runs. They are not one uninterrupted pass.

The first run, `.scratch/client-acceptance-20261016/assembled-run-2026-10-18T08-55-45-374Z`, passed role separation, forbidden cost access, a two-unit receipt for sample 009, and one cash sale with a 30 EGP discount (1,699 to 1,669) that reduced branch A only. It then stopped on the mobile product page: Add to bag was looked up in the wrong container. `failure.json` is retained. No online order existed yet. The receipt and `POS-000001` were not replayed or reset.

Grok changed only `.scratch/client-acceptance-20261016/assembled-business-acceptance.mjs`, adding `--resume-after-pos`. The continuation, `.scratch/client-acceptance-20261016/assembled-run-2026-10-18T08-59-53-927Z`, revalidated that original sale with the operations GET, then finished with exit 0. `10-complete.json` is the completion record.

| Continued step | Recorded result |
| --- | --- |
| Store request | Product page, bag, and checkout. Fayoum fee EGP 50. `BRV-000001` total 1,749, pending. Stock and the online report did not change at request time. |
| Confirmation | Customer agreement, then branch A confirmation. Stock and online revenue moved once. Replaying that confirmation did not move them again. |
| Return | Original `POS-000001` received at branch B. Refund 1,669, the amount actually paid. Sellable stock increased on B only. |
| Expense and export | Cashier expense EGP 20. The saved id and amount match the management report. PDF 36,988 bytes. Excel 27,591 bytes. |
| Backup | Encrypted file 1,432,700 bytes. Magic and cleared password fields checked. Archive and passphrase stayed private. |
| Restore | Restore form and its state GET were reachable. No preview, upload, or activation was performed today. An earlier isolated full restore remains separate evidence. |
| Offline cash | Cached cashier sale of sample 011 for 1,699, saved pending. Checkpoint `09-offline-queue`. After reload, the workspace unsynced count was 1. After reconnect it returned to 0 without a second manual post. The same operation id was read back from the server, with branch A reduced by 1 and branch B unchanged. |

Main's assertions on that continuation passed. The page request list recorded `offlinePosts: 0`. That page-level observer does not cover all service-worker traffic, so the reason no request was counted is not established by this run. That count is not a measurement of one HTTP POST. One server operation and one inventory movement are the proof of a single recorded effect. No browser-profile restart was run today; older isolated tests remain the evidence for that case. The four recorded source hashes were unchanged before and after. No off-origin request was recorded. This was not a fresh full suite. Older aggregate runs stay separate history.

## Visual assessment

Sol opened all 23 native PNGs in `.scratch/client-acceptance-20261016/practice-visual-20261018/`. Main reviewed the key shots. The whole vertical homepage was inspected at 1440 and 390. This fresh pass did not open every hidden horizontal card; the earlier review of all 208 supplemental viewport PNGs still stands. No new blocking visual defect was found.

Receiving's document height is 54,005 pixels. The lower page was not fully reviewed. That is a density follow-up, not a demonstrated blocker.

## Historical low-memory preflight

Earlier on 18 October, before the user freed RAM, startup was refused. `resume-preflight-20261018.json` recorded 1,615 MB free physical and 1,296 MB free virtual memory. `resume-final-preflight-20261018.json` recorded 1,098 MB physical and 1,929 MB virtual. Both were below the unchanged 3,000 MB physical and 4,000 MB virtual guard. Those checks are closed history. They are not an open blocker.

The later guard passed with more than 10 GB physical and more than 15 GB virtual memory free. The practice stack then started. The guard was not lowered, and user applications were not closed by the tools.

## Change control

Nothing was staged, committed, pushed, merged, deployed, or closed. Published HEAD remains `6eacfa8` on `codex/ux-purchase-guidance`, PR 44 draft. GitHub was not refreshed for this documentation pass.

Protected review SHA256 remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. That file was not opened or edited.

## Appendix — 16 October gates and hosted CA01

This appendix is prior evidence. It is not the status of the local practice copy.

| Evidence under `.scratch/client-acceptance-20261016/` | Actual result |
| --- | --- |
| `rehearsal-20261016-171027-301/browser.log` | Seven passed, one failed before sale creation because a loose product-label selector also matched the merchandise filter group. |
| `browser-remaining-20261016-172435-057/browser.log` | Four passed in a separate run: corrected sales, fulfillment and failed-parcel inspection, connected reporting, and filtered PDF/Excel exports. Not a fresh eight-case pass. |
| `http-remaining-20261016-172207-995/http.log` | Two selected cases passed: confirmation, cancellation, and failed-delivery accounting, and a cross-branch return to the original cost batch. Twenty-five cases were not selected. |
| `static-remaining-20261016-172038-481/` | Typecheck, architecture, nineteen diagnostics and teardown tests, and fourteen sample-intake guard tests passed. |
| `final-staff-build.log` | Staff build and service-worker generation passed. |
| `staff-visuals/receiving-offset-report.json` | Receipt heading visible at 1440, 1024, and 390. |
| `ca01/native-probe.log` | Fresh isolated local PostgreSQL start, create, and stop passed. |

CA01 hosted diagnostics remain partial. The hosted Windows native PostgreSQL startup cause is still unknown. Local startup is different evidence. No CI job was rerun, and this pass does not claim that CI is all green. Publishing or rerunning that hosted job needs a later approved checkpoint.

The original home and rail captures, isolated loading, error, and retry states, and all 208 supplemental PNGs were reviewed on 16 October. Two legacy-image readiness flags stay recorded. Six targeted load and decode checks passed and did not reproduce them.
