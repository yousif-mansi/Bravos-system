# Bravos customer receipt template — 28 October 2026

## Scope and owner instruction

The owner accepted the corrected diagnostic receipt output and requested the official Bravos logo, order number, client name and all customer-relevant transaction data. This supersedes the earlier omission of customer details from receipt output. Customer name/phone remain optional during checkout. Work is local on codex/pos-hardware-preparation-20261026, based on e8a6511; no commit, push, merge or deployment is included.

## Completed change

- Reuse the existing completed-sale receipt view, dedicated document and safe print/reprint flow.
- Bundle the exact official horizontal black SVG from `logo svg/02_Logo_Horizontal_Black.svg` as inline receipt artwork. It matches the existing public copy byte for byte and needs no additional network request during printing. No logo was recreated.
- Show branch, configured shop phone, labelled saved order reference, Cairo sale date/time, recorded cashier display name, customer name and optional customer phone. A missing name reads `غير مسجل`.
- Show saved product name/code, size/color, quantity/unit selling price, original line total, and paid line total when discounted. Existing discount totals, final amount, cash/online/split breakdown and exchange-credit treatment retain stored figures.
- Preserve the server reference or full explicitly local operation reference. Do not create a receipt number, truncate uniqueness or reprice from the catalog.
- Keep user values as text nodes. Purchase costs, profit, batch/staff identifiers, internal discount reasons and diagnostics are excluded.

Application changes: `apps/internal/src/receipts/receipt-model.ts`, `receipt-document.ts`. Coverage: `tests/scripts/pos-receipt.test.mjs`, `tests/browser/pos-hardware.spec.ts`. Print lifecycle, API/contracts, database, stock, permissions, checkout requirements and sales synchronization are unchanged.

## Verification

Windows, pinned Node 22.23.3 / pnpm 10.34.5; existing 3000 MB RAM / 4000 MB free virtual-memory guard retained. Heavy checks were serialized.

| Check | Verified result | Evidence under `.scratch/receipt-template-20261028/` |
| --- | --- | --- |
| Focused pure receipt tests | 13 passed; final model/test hashes unchanged since run | `root-pure.log` |
| Final staff typecheck | Passed | `root-typecheck-final.log` |
| Final architecture/private imports | Passed; 485 modules, 1175 dependencies, 412 files | `root-architecture-final.log` |
| Final staff/PWA build | Passed; 44 precached entries | `root-build-final.log` |
| Fresh focused browser run | 2/2 passed in 21.6 seconds | `root-browser-final.log`, `test-results-final/` |
| Browser layout captures | 80 mm, 58 mm, long-customer/local-reference 58 mm; no horizontal overflow | `visual-capture-final-source.log`, `visual-preview-evidence.json`, `receipt-80.png`, `receipt-58.png`, `receipt-58-stress.png` |
| Diff whitespace | Passed | `git diff --check` |

The browser preview exercises saved customer data and hostile text, official artwork, both widths and full local references with readable labels. Offline print/reprint checks prove no second sale/stock effect; native browser printing is mocked by that harness.

Initial visual review found narrow-paper labels squeezed into separate-letter lines. Grok corrected only label flex sizing/word wrapping and added a long-text regression. The first focused browser run was 1 passed / 1 failed because the new test filled customer data after accepting prices, invalidating its existing quote. Grok reordered test actions without changing application confirmation behavior. That red run and error context remain in `root-browser.log` / `test-results/`; the stated 2/2 result is a separate fresh run. The initial public-directory raw-SVG import warning was removed by using the identical tracked source SVG. Final type/build/architecture checks ran after that correction.

Grok implemented the application/test changes. An independent source review found no actionable concerns; main reviewed the final diff and actual layout images. The first Grok run reached its configured turn cap; the two bounded follow-ups completed, and main independently ran the recorded verification.

## Paper sample and limits

One explicitly marked demonstration of the final browser-rendered 80 mm template was sent to `Bravos Receipts - Xprinter XP-80TS` on USB003 through the previously verified Windows driver. The print API returned success; a follow-up found Normal status and zero pending jobs. Physical inspection of this new branded sample is still required. This diagnostic raster print is separate from a native browser-dialog-to-paper test.

The demonstration uses in-memory example transaction values, labelled as a sample; it creates no business sale or stock movement. The browser acceptance data is isolated test data. Physical evidence is outside the repository at `C:\Users\Yousif Mansi\Downloads\Bravos-Hardware-2026-10-28\bravos-template-physical-test.json` and `bravos-receipt-template-sample.png`.

The unrelated preexisting `apps/storefront/next-env.d.ts` modification is preserved. The protected review file was not read or edited; the index remains empty. Label-printer/scanner acceptance remains separate hardware work.
