# POS hardware preparation — 26 October 2026

> **Expanded on 27 October:** The owner added a USB barcode-label printer and explicitly authorized the remaining local implementation, CI investigation, reviews/builds/tests. Phase 1 now covers all three devices' software; the earlier two-device completion report is a historical checkpoint. Do not push, open a PR, merge or perform physical/live-sales tests without the required later approval.

## Approved scope

The owner authorized software implementation after the client review and follow-up clarifications. All three devices (label printer, scanner and receipt printer) connect through USB; exact models will be supplied later. Software preparation must continue independently of those model details.

- The barcode encodes the existing Bravos product code. Scanning selects a product, never a size/color or cart quantity. The cashier chooses the variant manually. Typed lookup remains available.
- Branch POS offers completion with receipt printing and completion without printing, with existing payment/handover checks unchanged.
- Printing follows durable local completion and does not wait for server synchronization. Printing cancellation, failure and retry do not complete another sale or change stock.
- Reprinting is an explicit action on an already completed branch sale. Recovery and reconnection never trigger unsolicited printing.
- Receipts use Arabic labels and unchanged stored product names, with BRAVOS, branch, configured contact, transaction reference/date, product/variant/quantity/accepted price, relevant discounts and final total. No policies, tax/fiscal claims, purchase costs or internal diagnostics.
- Owner-approved contact: **01017412287**. Keep it in receipt configuration. Support 58/80mm rolls; default 80mm pending actual device verification.
- Only branch POS is covered, with or without internet. E-commerce order documents are excluded.
- Generate valid CODE128 labels from the exact existing saved product code; no new identifier, size/color encoding, price or stock mutation. Prepare adjustable label dimensions/copies and a preview, with quiet zones and sufficient bar width. Printer models and physical dimensions remain Phase 2 inputs. Independently decode generated output in tests and verify the generated-code-to-POS lookup roundtrip.
- Label printing remains separate from receipt printing in the native Windows print dialog. Use existing authorized product views; keep generation local and available from the cached POS path during an outage. Reject unsuitable label dimensions instead of silently shrinking/clipping the barcode.

## Tracker and execution order

The canonical [POS hardware readiness map](https://github.com/yousif-mansi/Bravos-system/issues/46) contains native child issues and dependency relationships. This effort explicitly includes implementation, as authorized by the owner; it is not a planning-only wayfinder session.

| Phase | Task | Depends on |
| --- | --- | --- |
| 1 | [Product-code scanning and offline lookup consistency](https://github.com/yousif-mansi/Bravos-system/issues/47) | Existing authorized POS lookup |
| 1 | [Arabic thermal receipt and isolated print document](https://github.com/yousif-mansi/Bravos-system/issues/48) | Completed-sale contract |
| 1 | [Completion choices and safe reprint](https://github.com/yousif-mansi/Bravos-system/issues/49) | Receipt module |
| 1 | [Product barcode generation and adjustable label printing](https://github.com/yousif-mansi/Bravos-system/issues/52) | Existing saved/cached product identity |
| 1 | [Focused software acceptance and handoff](https://github.com/yousif-mansi/Bravos-system/issues/50) | All preceding software tasks |
| 2 | [USB physical acceptance](https://github.com/yousif-mansi/Bravos-system/issues/51) | Reviewed Phase 1; actual devices/models |

Grok implements; the primary agent reviews architecture, business UX, diffs and evidence. No automatic commit, merge, deployment or issue closure.

## Integration boundaries

The initial scanner adapter supports USB keyboard-emulating input with an Enter terminator in the focused product-code field. This is an explicit device-mode assumption, not proof that an unidentified USB scanner supports it. Reuse authorized product lookup and branch/staff-scoped offline snapshots, with consistent case/whitespace matching.

Use the Windows printer driver through the native browser print dialog. Render a dedicated same-origin receipt document; never print the entire staff page. Keep fonts local/cache-compatible and preserve Arabic/Latin text isolation. The selected Windows paper setup determines the actual physical roll and margins; software layouts alone cannot prove paper compatibility. Do not introduce WebUSB, a local bridge or silent printing without a demonstrated model-specific need.

Use the stored server sale reference when available. Before synchronization, the full durable operation identifier supplies an explicitly local reference; never invent a server sequence or truncate uniqueness. Retaining a returned server reference locally is additive metadata and must not change stock proofs, accepted financial facts or operation fingerprints.

Keep catalog and sales ownership intact. No database migration, public API redesign, new barcode registry, payment policy or inventory rule is needed for this preparation.

## Configuration

The staff Vite environment accepts `VITE_POS_RECEIPT_PHONE` and `VITE_POS_RECEIPT_PAPER_WIDTH` (`58` or `80`). Set them in the staff application's environment before starting/building it; they are public receipt settings, not secrets. The isolated verification checkout uses a gitignored `apps/internal/.env.local`. Missing contact configuration should warn staff without stopping a sale or printing configuration instructions on customer paper.

## Evidence required before Phase 2

The [expanded three-device validation report](../reviews/pos-hardware-three-device-validation-2026-10-27.md) records the completed local Phase 1 software gate: 16 browser cases, two built-PWA offline cases, 17 pure cases, final workspace type/build/architecture checks and zero reported dependency vulnerabilities. Earlier failed runs remain documented separately. Native printing was mocked; physical models, drivers, actual label/paper dimensions and printed-code readability remain Phase 2 inputs. This does not approve publication or production operation.

Verify typed/scanned lookup and manual selection; connected/disconnected completion with and without printing; stored receipt amounts and mixed-language layout at both widths; print failure/cancellation without sale repetition; storage failure without false receipts; explicit reprint and server-reference retention after synchronization; pending-print cancellation across logout/unmount. Run affected type, architecture and browser checks under existing Windows memory guards. Record blocked checks as blocked, not passed.

Phase 2 must inspect actual printed paper and device behavior, including unplug/reconnect and unavailable-printer recovery, using dummy transactions only. Phase 1 completion does not constitute physical-hardware or production approval.
