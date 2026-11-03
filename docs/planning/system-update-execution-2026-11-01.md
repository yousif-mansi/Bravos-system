# System update execution — 2026-11-01

Working checklist for the sole-executor update. Approved behavior is in the owner handoff. This file does not delay implementation.

## Baseline

- Detached HEAD `e8a65116ec2edb2692261b100a12b6af2aedd7d9`. Empty index. Pre-existing dirty receipt-numbering and print-connector work stays, including migration 036.
- Protected review hash checked only: `61A15B6AE01DC82128AC12DCA00AB8AE3FC380758F7B927E740D3CD0D2256F46`.
- Ordinary preview (`bravos_client_acceptance_20261016`, ports 54330 / 3012 / 5177 / 3002 / 17831) is not migrated, reset, or printed.

## Model

- Migration `037_operational_stock.sql` adds the central warehouse branch, one hidden operational variant per product, product-level batch identity, a nullable minimum price, suppliers, customers, transfers, and nullable accepted floors. Down refuses once warehouse stock, transfers, suppliers, customers, or floors exist. Existing branch balances stay where they are.
- Sentinel size/color ids exist only so the variant row can satisfy the current foreign keys. Staff, storefront, and receipts do not ask for them. `purpose` is the discriminator.
- Legacy receipt payloads that name a retail branch and a real variant still post. The staff receiving screen does not offer that path. New product intake is warehouse-only.
- New selling prices use the product default. Stored size/color overrides are kept and are not chosen as the new price. Historical sale and quote prices stay.
- A missing or null floor means no floor. Old offline queues sync once at their accepted amounts.
- Paid online history is an order whose current status is `delivered` and which has a `delivered` fulfillment event. Confirmation is not payment.
- Customer identity is the full normalized phone. Historical sales stay unlinked when the stored name is non-empty and differs. Online history matches the primary phone only, at read time.

## Phases

1. Checklist and baseline — this file.
2. Schema, contracts, backup/restore bridge from 034/035/036 onto 037.
3. Warehouse receiving, transfers, supplier link, stock conservation.
4. Inventory and POS stop asking for size/color. Products owns website options. One price and one minimum.
5. Post-discount unit floor, snapshot floor, old queues.
6. One purchase visible from the supplier and from expenses, excluded from operating expenses.
7. Phone reuse and paid-product history, Cairo month and year, manager view.
8. Isolated tests and a focused staff/storefront pass.
9. Final report in `docs/reviews/system-update-sole-executor-report-2026-11-01.md`.
