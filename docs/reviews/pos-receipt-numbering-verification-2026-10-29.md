# POS receipt and permanent numbering verification — 29 October 2026

The receipt correction and numbering implementation is locally implemented, reviewed, verified, and running. It is not committed or pushed. This report covers branch POS receipts, not completion of the scanner or barcode-label hardware tests.

## Customer and cashier behavior

- Save and print durably saves the completed sale before opening the normal Chrome/Edge print dialog. Printing, cancellation, failures, and reprints do not sell or deduct stock again.
- Arabic thermal output uses the official Bravos logo, branch/contact, customer details when supplied, original product names/codes/variants, accepted prices, discount breakdown, totals, and payment details. Currency symbols are removed from the receipt only.
- New prepared tills allocate permanent references such as `BRV-001-000001` atomically with the local sale and stock effect. Reprints and retries consume no additional counter. Sales history, detail links, synchronization, recovery, and Returns preserve the printed reference.
- Numbering requires one connected POS preparation before an outage. Open POS while connected before offline selling. A legacy paid sale or sale without usable numbering is preserved using its POS reference or an honest pending label; it is not retrospectively renumbered. Corrupt local metadata gets a new incarnation only on active connected preparation, without rewriting earlier paid records.

## Printing findings

The observed Chrome destination was Save as PDF; the application uses browser printing rather than a PDF-download implementation. The destination was changed to **Bravos Receipts - Xprinter XP-80TS**, USB003, using the installed Xprinter XP-80 driver. Tested preferences: 80(72) mm × 210 mm, 100% scale, no margins, browser headers/footers off, one copy. No silent-printing policy or bridge was introduced.

The actual receipt module printed one sample without recording a business sale. The owner confirmed **“Printed clearly.”** An eight-item preview was inspected on both pages: items 01–05 on page one, 06–08 plus totals on page two. It was cancelled without printing more paper. This confirms the sample layout on the receipt printer; it is not a physical test of every numbering/recovery case or the other two devices.

## Verification and evidence

Evidence directory: `.scratch/receipt-numbering-20261028/`. Earlier red runs remain alongside their reruns; the results below are not presented as one fresh combined suite.

| Check | Recorded result | Evidence |
|---|---|---|
| Full workspace typecheck after final application fixes | Passed | `typecheck-final-2.log` |
| Architecture/import boundaries | Passed | `architecture-final-2.log` |
| Receipt model and numbering pure tests | 23 passed | `pure-final-2.log` |
| Initial affected browser run | 11 passed, 1 failed | `browser-final-1.log` |
| Numbering browser rerun | 6 passed, 1 failed | `browser-numbering-rerun.log` |
| Final differing-server-reference regression | 1 passed | `browser-reprint-route-rerun.log` |
| Built production-preview offline restart/reconnect | 1 passed | `production-numbering-browser.log` |
| API integration batch | 53 passed, 2 failed; four files completely green | `server-integration-1.log` |
| Whole restore file after repairing invalid fixtures and adding activation collision coverage | 8 passed | `restore-full-rerun.log` |
| API build | Passed; the isolated browser harness also rebuilt it | `api-build.log` |
| Staff build with configured receipt contact and 80 mm paper | Passed | `internal-build-with-phone.log` |
| Migration 036 round trip and shape checks | 36 migrations, 17 malformed identities rejected, 5 valid accepted | `schema-evidence.json` |
| Real PostgreSQL index-size behavior | Compression and both 54000 error forms reproduced | `index-error-evidence.json` |
| Native print | Owner-confirmed clear sample; long preview complete | `native-chrome-print-evidence.json` |
| Local activation smoke | Login/30-product lookup/save-and-print/reprint; no runtime errors or sale/print requests | `staff-print-controls.json` |

The first browser failure used a mouse click on a screen-reader-only retry control; keyboard activation now exercises that existing control. The second failure used a Playwright glob that matched the list but missed nested detail URLs. Its explicit-regex replacement proves the target detail response is changed before retaining the conflict assertion. Neither repair removes an assertion or weakens application behavior.

Independent review also found a genuine Sales-page integration defect: fetched server details could replace the original local printed number. The final implementation preserves receipt metadata only when sale ID, operation, seller, active staff account, and branch match. Every financial/detail field remains from the authorized server response. Pure and browser regression evidence covers that boundary.

## Backup, recovery, and local activation

The existing local processes had stopped during the pause. The original PostgreSQL data directory and database were restarted without initialization, reseeding, or password changes. An authenticated encrypted schema-035 backup was downloaded and successfully decoded and checksum-verified before migration: 17,716 records, no known unsynchronized tills. Its archive/key remain local under the ignored evidence directory; neither belongs in Git. The backup excludes unsent browser-only rows and image binaries; existing browser profiles and image files were not cleared or replaced.

Only `036_receipt_numbering.sql` was pending, with no drift or unknown migrations. After application, all 52 pre-recorded business-table counts and fingerprints matched exactly, excluding only the newly added nullable receipt identity field. The API and built staff application now run from this receipt-numbering worktree:

- Staff: `http://127.0.0.1:5177/login`
- API health: `http://127.0.0.1:3012/api/public/health`
- Existing PostgreSQL: 54330 / `bravos_client_acceptance_20261016`.

The smoke check creates no sale and submits no print. Opening POS can register a numbering incarnation and cache the existing catalog; this is expected preparation metadata. The storefront was not changed or restarted in this activation.

Do not run the old schema-035 API against this database or casually apply 036 down after issuing receipts. Recovery preserves the registry union and prefix high-water mark, including registrations made after a restore checkpoint. See `receipt-numbering-recovery-2026-10-29.md` for legacy archive bridges, the existing fresh-owner UI bootstrap caveat, and profile-cloning/disaster-recovery limits.

## Review boundary

Grok implemented the application changes; the primary agent reviewed the diffs, ran the recorded checks, confirmed native print behavior, and activated the local build. Several bounded Grok runs reached their turn limit after writing changes; their partial reports were not treated as completion evidence. Subsequent source review and independent gates determined the final state.

No business rules, accepted prices, stock allocation, permission policies, storefront, drivers, or browser security policies were redesigned. No ordinary business transaction was created by the verification. The protected review file remains byte-identical (SHA256 `61A15B6AE01DC82128AC12DCA00AB8AE3FC380758F7B927E740D3CD0D2256F46`). Git index is empty. Commit/push/PR approval is still required.
