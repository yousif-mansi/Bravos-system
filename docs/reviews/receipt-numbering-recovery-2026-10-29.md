# Receipt numbering recovery (2026-10-29)

Sales owns the receipt registry, receipt identities, and `sales_receipt_prefix_seq`. Restore only coordinates those ports.

A current `036_receipt_numbering.sql` archive stores `sales_receipt_registration`, a `receipt_identity` on every sale row, and `salesReceiptPrefixSequence` as a decimal `lastValue` plus `isCalled`. Named schemas `028` through `035` omit all three. Per-sale sequence text is an unbounded positive decimal. Prefix, prefix allocation, and registration generation stay within signed bigint.

`035` staged onto `036` keeps the old sale columns, sets `receipt_identity` to null, and loads an empty registry with prefix state `{ lastValue: "1", isCalled: false }`. `034` does that and sets return `reason` to null. The stored manifest, schema name, and section checksums stay the uploaded archive. `034` onto a `035` server still upgrades only the return reason. Older schemas are rejected before the pause.

Registry rows are unioned at checkpoint reconcile and again at activation. An identical row is kept once. The same id with different fields, or one prefix on two registrations, blocks the preview or rolls activation back. Registrations inserted after the checkpoint stay, including ones with no sale. A missing creator is copied from the live user and staff profile, plus staff ancestors, only when that id is absent from the staged rows. A username collision, a second owner, or a missing creator blocks activation. Grants and operations are not pulled in. Bootstrap detection does not treat a live registration as disposable.

Prefix allocation is `setval(..., false)` to the BigInt maximum of the archived next value, the live next value, and one past the highest retained prefix. It does not read the POS, order, or return sequences. PostgreSQL does not roll `setval` back; a failed activation that reaches allocation can move the next prefix forward and cannot move it backward.

Conflict identities are not renumbered. A canonical `BRV-` reference is kept at full length. Any other conflict text must be 1–80 characters and free of control characters. The database check in `036_receipt_numbering.sql` accepts long canonical claims. PostgreSQL index-size failures are isolated with a savepoint so a numbering conflict cannot roll back the paid sale.

Passive App, Workspace, and stock-correction snapshots omit `receiptRegistrationId`, even when local numbering already exists. Connected POS preparation and the explicit Workspace retry can register an incarnation. Receipt numbering needs that connected preparation before an outage; a paid sale without usable numbering is preserved with its legacy POS reference or an honest pending label. It is not retroactively renumbered.

The existing fresh-owner restore classification can still be affected by ordinary snapshots/known-till rows. Avoiding passive receipt registration removes the new source of interference; it does not prove that the older UI bootstrap behavior has changed. Recovery tests use isolated databases and do not replace an external recovery drill. Copying a whole browser profile to another active till, or losing allocator evidence newer than a recovered server archive, is outside the demonstrated guarantees.
