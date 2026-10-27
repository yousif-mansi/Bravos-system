# Branch POS hardware preparation — Phase 1 review

> **Superseded scope:** Later on 27 October the owner added barcode generation and a third USB barcode-label printer. This report records the verified two-device checkpoint only. Phase 1 is reopened until label generation/printing and the updated integration checks are complete. See the updated preparation plan; do not use this checkpoint as approval for the expanded three-device scope.

Reviewed on 27 October 2026, Africa/Cairo. Implementation and logs began on 26 October UTC.

## Outcome

Software preparation is complete and locally verified for the accepted Windows browser workflow. Actual USB scanner/printer compatibility is **not yet approved**. Exact models and physical tests belong to Phase 2.

Changes are on `codex/pos-hardware-preparation-20261026`, based on `5b5e400`, in `C:/Users/Yousif Mansi/.codex/worktrees/sf12-grok-quality/bravos system`. No feature commit, push, merge or deployment was performed. The ordinary running preview remains on its previous source/runtime. This report does not close unrelated PR45 browser failures or claim a full-system release gate.

The [hardware readiness map](https://github.com/yousif-mansi/Bravos-system/issues/46) has five native child tasks with dependencies. None was automatically closed.

## Delivered behavior

- A USB scanner configured as keyboard input with an Enter terminator uses the existing product-code field. Scanning only identifies the product. Staff explicitly choose size/color and add the variant. Manual input remains supported, including unknown-code feedback.
- Online and cached product-code matching now share trimmed, NFC-normalized, case-insensitive comparison. Staff/branch snapshot checks remain intact. Scanning does not change inventory or complete a sale.
- The existing completion action saves without printing; the second action saves and requests a receipt. Both retain existing quote, payment, handover and stock checks. Printing starts only after durable local sale storage; synchronization continues independently.
- A completed sale exposes explicit receipt reprinting. Printer failure/cancellation never re-runs sale completion. Recovery/reconnection does not automatically print.
- A dedicated same-origin document prints the receipt only. Arabic labels, unchanged product names, size/color, stored quantities/prices/discounts, accepted total and payment allocation remain readable. Receipt text is rendered as text nodes; manager costs, customer phone, discount reasons, internal diagnostics and policies are absent.
- Thermal layouts support 58/80mm rolls, with 48/72mm content widths. Actual paper selection and margins remain Windows-driver settings. Fonts use the existing self-hosted Cairo subsets and cache path.
- Receipt contact is configured as `01017412287` in the isolated staff environment. `VITE_POS_RECEIPT_PHONE` and `VITE_POS_RECEIPT_PAPER_WIDTH` are documented public settings; no new dependencies or settings backend were added.
- Offline receipts use the full durable operation identifier, explicitly local rather than a fabricated server number. A returned server reference is retained as optional local metadata and used when available. Existing manager Returns lookup accepts the raw operation UUID after synchronization; enter the identifier without its descriptive Arabic prefix.
- Pending printing is invalidated on account, branch/context change or unmount. Reprint busy state clears safely even for a same-staff account event. Status says printing was requested, never that physical paper was produced.

## Scope and safeguards

No public storefront/order changes, database migration, permission changes, pricing/payment-policy changes or stock-rule changes. The optional reference field does not enter financial facts, operation fingerprints or stock proofs. No sample/ordinary catalog or branch balances were edited; browser tests used disposable isolated databases.

Grok implemented scanner, receipts, integration and test drafts. Main review corrected test-harness assumptions, the same-staff reprint busy guard, and verified the resulting code. Independent Sol review approved the source after that guard was fixed. A Grok styling run reached its turn limit after applying the narrow button-label/CSS change; its resulting diff was independently checked and included in the passing final build/browser run.

The protected root review file remains SHA256 `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`. Existing unrelated isolated `apps/storefront/next-env.d.ts` and `tests/browser/storefront-experience.spec.ts` changes were preserved and excluded from this work.

## Verification

Commands ran on Windows with Node 22.23.3 and pnpm 10.34.5. Heavy checks started only above the existing 3GB RAM / 4GB virtual-memory guard. Tests launched an isolated API and staff app; they did not reuse the ordinary preview services.

| Check | Result | Evidence under isolated `.scratch/pos-hardware-20261026/` |
| --- | --- | --- |
| Workspace typecheck | Passed | `typecheck-final.log` |
| Final staff typecheck after review corrections | Passed | `internal-typecheck-final.log` |
| Final architecture/private imports | Passed | `architecture-final.log` |
| Final staff production build/PWA | Passed | `internal-build-final.log` |
| Pure receipt/code lookup cases | 9 passed | `receipt-pure-final.log` |
| Existing POS workspace browser suite | 6 passed | `existing-pos-browser.log` |
| Fresh final hardware browser suite | 6 passed in one run | `hardware-browser-clean.log` |
| Built staff preview: offline receipt request, reconnect and safe reprint | 1 passed | `production-offline-receipt.log` |
| Diff whitespace check | Passed | `git diff --check` |

The six hardware cases cover live/cached scanning and explicit variant selection; completion without printing; actual 58/80mm receipt rendering and inert HTML-looking names; offline completion/print/reprint with one server sale/stock effect; rejected local sale storage with no false receipt; and cancelled pending reprint across a same-staff account event. The built-preview case waits for the production service worker/controller before going offline. Native printing is replaced with a browser harness: no paper was printed.

Earlier red runs remain beside their reruns: pure tests initially 8 passed / 1 failed because a JSON-escaping assertion was wrong; initial hardware run 2 passed / 2 failed because a dashboard-only readiness indicator was queried from POS; an intermediate six-case run had 5 passed / 1 failed because the font-delay harness referenced a constructor not exposed by Chromium. These were harness corrections, not waived acceptance criteria. A separate four-case pass and cancellation-case rerun are retained; the final claim of six passed comes from the fresh six-case run.

Rendered evidence inspected: `screenshots/receipt-58.png`, `receipt-80.png`, and `pos-completion-options.png`. The HTML-looking product name is isolated security-test content, not production catalog content. Native dialog return/timeout is not proof of printer acceptance or physical paper.

## Phase 2 checklist

1. Supply exact USB scanner/printer models and supported Windows drivers.
2. Confirm scanner keyboard mode, product-code fidelity and Enter suffix; test repeated scans and ordinary typing.
3. Configure the printer's actual roll width/margins and disable unwanted browser headers/footers if present.
4. With dummy sales only, inspect Arabic/English shaping, long names, multiple items, totals, references, wrapping, paper feed and clipping at the actual width.
5. Print connected and disconnected; reconnect and verify the same sale, server reference and one stock deduction. Check the printed local UUID in manager Returns lookup after sync.
6. Test unplug/reconnect, unavailable printer, cancelled dialog and paper errors. Reprint the saved receipt without recording another sale or collecting payment again.
7. Review operator use before enabling real branch transactions. Add a model-specific adapter only if actual evidence shows the accepted keyboard/Windows-driver path is insufficient.
