# Phase 1 — operational updates after testing

Recorded 2026-09-29. Source: the user's ten requested system updates and follow-up answers in the project conversation. This document supersedes conflicting central-inventory, cash-only POS, and delivery-only online sales recognition wording in the original brief and v1 planning documents. Storefront visual development is paused for this work. Implementation is authorized; commits still require explicit approval.

## Confirmed scope

1. **Branch inventory.** Each branch has independent available stock per actual size/color variant. A physical sale uses its recorded branch. Staff select the fulfillment branch when confirming an online order, and only that branch supplies the stock.
2. **Inventory-first intake.** Inventory is the starting point for product identity, SKU, actual size/color combinations, and received quantities. The Products screen selects existing items through SKU autocomplete instead of recreating variants. Never invent size/color combinations by multiplying independent checkbox selections.
3. **Action feedback.** Editing reveals, focuses, and highlights the appropriate form. Details visibly open; requests show loading, success, failure, and retry where applicable. Respect reduced-motion preferences and retain keyboard focus indicators.
4. **Automatic sale sync.** Ordinary completed offline sales upload automatically when connectivity returns, applying the sale and stock effect once without manager approval. Preserve completed sales, attribution, accepted prices, and duplicate protection. Investigate server recovery without an operating-system online event. The existing exceptional account/restore recovery safeguards are not an ordinary sale-approval workflow.
5. **Readable transaction references and return lookup.** Physical sales and online orders have unique order references. Returns search by customer phone or order reference, retaining the date filter and anonymous-sale fallback. Selecting a purchase displays its lines, quantities, paid values, and date before starting the return.
6. **Online recognition.** Pending requests do not count as sales. Confirmation records the sale value, deducts selected-branch stock once, and affects reporting. Shipment and delivery do not duplicate either effect. The user confirmed that cancellation or failed delivery reverses the sales value, while stock remains unavailable until physical receipt and inspection.
7. **Return history.** Show a readable return number, customer where supplied, date, and amount. Keep internal UUIDs in persistence/API links rather than ordinary display text.
8. **Concise return details.** Use short labels such as Branch and Status; preserve the underlying workflow and necessary decisions.
9. **POS payment allocation.** Cash, manually received online transfer (wallet/InstaPay), or split payment. Show cash amount, online amount, and remaining amount. Validate the exact amount due; no payment gateway or provider verification is introduced. Retain the existing refund policy unless explicitly revised.
10. **Checkbox states.** Checked checkboxes are green with a visible tick, clear unchecked/disabled states, and accessible focus. Mutually exclusive payment choices remain radio controls.

The user confirmed that the existing data is disposable test data and chose to start fresh. Development and verification use a new isolated database. Do not silently allocate old central quantities to a branch or modify the existing local database while preparing this release.

## Follow-up decisions confirmed by the user

- One selected branch must fulfill the entire online basket. Public per-variant quantities reflect what one branch can supply; quote/submission and confirmation also check the whole basket against one branch, rather than summing incompatible branch quantities. Staff resolve shortages before confirmation; no split fulfillment is introduced.
- Inventory intake also collects category, selling price and purchase cost. Products checkboxes control only online visibility of existing variant pairs; POS and inventory variants remain intact.
- A sellable return increases the receiving branch's stock, retaining original purchase-cost provenance and original sale attribution.

## Engineering boundaries

- Preserve feature ownership: catalog owns identities and merchandising; inventory owns branch quantities, FIFO allocations and costs; sales/orders own transaction facts; returns owns return/refund facts. The inventory-first screen composes these capabilities without moving their database ownership.
- Keep the original cost batch as the provenance identity and introduce branch balances keyed by batch and branch. A branch location change must not average costs or lose the original allocation link.
- Inventory branch reads use an explicit branch. Backend aggregate reads are separate and cannot accidentally become POS stock. Continue one shared backend, with distinct branch balances.
- New receiving and opening-import rows carry a valid branch. Corrections, protected online stock, late offline movements and returns must retain branch attribution.
- Offline stock caches and pending-sale effects must be scoped to their branch. Switching branches must not reuse another branch's available quantity. Old queued payloads retain their original fingerprint and stable operation identity.
- Keep online BRV references. Allocate readable POS and return references once on server persistence. Before synchronization, retain an explicit pending local reference; do not fabricate a globally sequential number while offline. Server acknowledgement supplies the final POS reference. Retain legacy identifier lookup for recovery.
- Payment allocation is immutable on completion, included in new replay/integrity checks, and backward compatible with legacy cash-only queued commands. Changing a payment method must not change merchandise revenue.
- Backups and restores must include branch balances, payment facts, readable references and sequence state. Incompatible older archives must fail clearly rather than silently interpret central stock as branch stock.
- Keep permissions, purchase-cost secrecy, 14-day returns, employee discount rules and exactly-once effects unless a listed new requirement explicitly changes them.

## Bounded delivery lanes

| Lane | Main scope | Dependencies |
| --- | --- | --- |
| Inventory | Branch ledger, receiving/import, stock correction and inventory adapters | Fresh database; return destination decision |
| Product management | Inventory-first intake, SKU autocomplete, existing-variant selection | Catalog identity and branch receiving contracts; visibility decision |
| Sales | Tender breakdown, branch POS cache and sync retry | Inventory branch ports; readable sale reference |
| Orders/Returns | Fulfillment branch, confirmed revenue/reversals, readable references, phone lookup and concise UI | Fulfillment and return-location decisions; inventory ports |
| UI feedback | Shared reveal/focus/highlight, checkbox states, meaningful progress feedback | Existing routes and components |
| Integration | API composition, archive compatibility, regression coverage, documentation | All lane contracts |

## Required verification

- Receiving identical variants in A and B creates independent balances; a sale in A changes only A.
- Confirmation selects an authorized branch, validates all repeated variant lines, and deducts once; replay, shipment and delivery do not deduct again.
- Offline sale survives restart, reconnect, delayed acknowledgement and retries; original branch and payment allocation remain intact. Reconnection to a recovered server works without manual approval.
- Cash, online and split amounts validate exactly, including zero-total and exchange-credit cases. Changed tender on replay is rejected. Legacy cash queues remain recoverable.
- SKU suggestions select the existing product. Absent size/color pairs cannot be created by listing selection; zero stock is distinguished from a nonexistent pair.
- Physical/online references are unique and searchable; phone lookup lists matching eligible purchases; date lookup remains usable when the original sale has no phone.
- Confirmed online value appears in the confirmation period, reversal in the actual reversal period, and delivery does not recognize it twice. Stock release still requires inspection.
- Return restoration preserves source cost and applies once to the agreed branch; later corrections remain consistent.
- Backup/restore roundtrip retains all new facts and future references remain unique.
- Typecheck, architecture checks, real PostgreSQL HTTP tests, affected Playwright flows and production builds pass. Review the final diff and disclose any unverified scope before requesting a commit.

## Current status

Implementation and the selected integration verification gates are complete. Branch balances, inventory-first intake, online variant selection, POS payment allocation, automatic retry, readable references, return lookup, and confirmation-based online reporting are implemented. Cancellation can reverse revenue before inspection; uninspected stock remains protected until its separate disposition.

The independent standards/spec review identified stale product saves, payment proof integrity, cancellation timing, and a legacy-queue recovery bypass. The fixes have been re-reviewed. PostgreSQL coverage passed across the initial combined run and targeted repairs; 64 affected browser cases, 10 production offline cases, and 3 restore cases passed across their recorded runs. Typecheck, architecture checks, production builds, and bundle separation passed. See [verification evidence](../reviews/phase-1-operational-updates-verification.md) for the exact boundaries and remaining physical-device release check. A fresh local database is initialized with no stock, preserving the old test database. No commit or push has been made.
