# Three-device POS hardware preparation — Phase 1 validation

Reviewed 27 October 2026, Africa/Cairo. **Expanded Phase 1 software verification is complete locally.** This report covers software for a USB barcode-label printer, product-code scanner and receipt printer. It supersedes the scope of the [two-device checkpoint](pos-hardware-phase-1-2026-10-27.md). Actual hardware compatibility and printed-paper acceptance remain Phase 2.

## Business behavior

- Generate CODE128 from the exact existing saved product code. The barcode identifies a product; size/color remain explicit cashier choices. No new product or variant identifier is created.
- Prepare label previews and browser printing from authorized saved products and cached POS products. Settings support width 40–160mm, height 20–100mm, 203/300 DPI and 1–100 copies, including fractional dimensions. Quiet zones and minimum readable bar widths constrain the layout; unsuitable settings receive feedback instead of silently shrinking an invalid barcode.
- Label generation/printing has no sale or stock effect. The intended integration is label → decoded product code → existing POS lookup → manual variant → durable sale → receipt → duplicate-safe synchronization.
- Preserve the receipt/scanner behavior recorded in the two-device checkpoint: typed/scanned lookup, completion with or without printing, Arabic receipt labels with original stored names/prices, explicit reprint, local operation reference before synchronization and returned server reference afterward. Print failure remains separate from sale persistence/recovery.
- Label and receipt documents use separate browser print requests. Staff choose the corresponding Windows printer and paper settings; the application does not claim silent printing or physical output.

## Final verification

Windows verification uses Node 22.23.3 and pnpm 10.34.5 in the isolated checkout. Evidence below is under `.scratch/pos-hardware-20261027/`. No application source changed after the final full build.

| Check/run | Recorded result | Evidence |
| --- | --- | --- |
| Final receipt/label pure tests after font correction | 17 passed | `pure-final-after-font.log` |
| Final workspace typecheck | Passed | `typecheck-final.log` |
| Final architecture/private imports | Passed; 477 modules, 1,173 edges, 405 files checked | `architecture-final.log` |
| Final full workspace build and bundle separation | API, staff/PWA, storefront and bundle checks passed | `build-all-final.log` |
| Full dependency audit | Zero reported vulnerabilities | `audit-full.json` |
| Production dependency audit | Zero reported vulnerabilities | `audit-production.json` |
| Fresh expanded hardware/POS browser acceptance | 16 passed in 1.0m | `hardware-browser-accepted.log` |
| Fresh built PWA offline receipt and combined label → scanner → sale → receipt → reconnect | 2 passed in 24.1s | `production-three-device-final.log` |
| Independent Sol review and main source approval | No actionable findings | `final-source-review.md` |

The independent ZXing decoder checked both generated barcode binary data and a rendered SVG. This establishes software decoding of the exact code, including roundtrip preparation; it does not establish that an actual USB scanner reads printed paper.

The preview's `display:none` behavior was corrected. Offline integration then exposed a confirmed font-waiter failure, including in the built PWA. The correction fetches real WOFF2 bytes through the parent application's service-worker path and installs binary font faces in the owned label document. Font acceptance requires successful parsing; origin/file validation, byte caching and a four-second abort bound the work. The precise internal browser-font/network cause is unproven. The final development-browser suite uses a test-only actual-font-response cache fixture to cover development mode without a service worker; it does not mock business APIs. The separately built PWA passes both offline cases using its production service-worker environment, without that font-cache fixture.

Inspected rendered artifacts include `screenshots/label-dialog-fractional.png`, `label-preview-fractional.png` and `label-long-name-max-code.png`, together with the 80mm receipt screenshot. Native printing is mocked by the browser harness: these checks printed no physical labels or receipts. Final acceptance covers software behavior, including font-failure retry, decoded code fidelity, explicit variant selection, offline durable completion, receipt requests and duplicate-safe synchronization.

## Retained red runs and reruns

| Run | Recorded outcome and follow-up |
| --- | --- |
| `labels-receipts-pure-initial.log` | 15 passed / 2 failed; corrected rerun `labels-receipts-pure-final.log` 17 passed; final post-font pure run also 17 passed |
| `hardware-browser-initial.log` | 13 passed / 2 failed; preview visibility corrected |
| `label-browser-rerun.log` | 2 passed / 1 failed; offline print font failure remained |
| `production-label-flow-initial.log` | 1 failed; built PWA reproduced offline failure |
| `label-offline-lifecycle.log` / `production-label-lifecycle.log` | Development / built PWA lifecycle failures retained during font diagnosis |
| `internal-typecheck-font-final.log` | One TypeScript error; `internal-typecheck-font-rerun.log` passed after correction |
| `hardware-browser-final.log` | 15 passed / 1 failed; development receipt-font case remained |
| `hardware-browser-clean.log` | 14 passed / 2 failed; asynchronous lookup race in harness and development font case corrected before fresh 16-case pass |
| `production-parent-font.log` | Combined offline flow passed; existing receipt case failed on an overly broad alert selector; targeted selector corrected before fresh two-case production pass |

These failures were investigated and rerun, not waived. The final claims above come from fresh complete runs of their stated scopes.

## Boundaries and Phase 2

Ordinary running applications and business data remain untouched; tests use isolated disposable data. The protected review document is untouched and was not read for this report. No database, stock, pricing, payment or permissions policy change is authorized by label preparation. The separate [PR45 Windows browser follow-up](pr45-windows-browser-follow-up-2026-10-27.md) retains its own evidence and acceptance status.

Expanded Phase 1's local software gate is satisfied by the final review, fresh browser/PWA results, static/build checks and visual inspection above. No blocking software defect is known in the exercised scope. PR45 was merged as `314e381` before its separate browser repairs were published. The owner then authorized publishing both changesets. The CI follow-up targets the updated main branch; the hardware PR is based on that follow-up branch so its review diff contains only hardware changes. After the CI follow-up is approved and merged, retarget the hardware PR to main and validate its applicable checks. No production-launch or full-system readiness claim follows from this report. Further merges and any issue closure require their applicable approval.

Phase 2 remains physical acceptance using dummy transactions: obtain all three exact device models and Windows drivers; configure scanner keyboard/Enter behavior; establish actual label stock/roll dimensions and receipt margins; inspect printed Arabic/Latin text, barcode quiet zones, clipping and readability; scan real printed labels; test unplug/reconnect, cancellation, paper errors and unavailable printers; confirm offline completion/reconnect and reprinting have one sale/stock effect. Software decoding and mocked print requests cannot replace these checks.
