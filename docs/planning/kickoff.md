# BRAVOS kickoff plan

Date: 2026-09-07

Source: [bravos.md](../../bravos.md). This plan sequences work from the brief; it does not add approved business rules or select a technology stack.

## Baseline

BRAVOS needs an Arabic management system, branch POS, and public online store. Abshway and Fayoum use one central inventory together with online orders. Branch-specific sales, expenses, employee access, and reporting remain distinct.

Physical sales are cash only. Online checkout is guest checkout with cash on delivery. Staff confirm and manage online orders. Delivery is limited to configurable areas in Fayoum Governorate.

Protect internal cost data and enforce role permissions on the server. Preserve the responsible user for important operations. A separate full audit-log interface is not confirmed.

## Proposed work sequence

These are proposed work packages. Create implementation tickets in GitHub once each package has a sufficiently specific scope and acceptance criteria.

| Order | Work package | Result | Decisions needed before finalization |
| --- | --- | --- | --- |
| 1 | Architecture and first-slice specification | Define runtime, data storage, deployment, permission boundaries, and a transaction-safe inventory approach | Record technology choices and their rationale; confirm management devices and initial design direction |
| 2 | Accounts, catalog, central stock, receiving, cash POS | An authorized employee can complete a cash sale against received stock; the owner can see the sale by branch | Specify permissions and SKU/variant identification; define product status interaction with available stock |
| 3 | Expenses, dashboard, reporting | Owner sees business and branch performance, purchase/expense information, and PDF/Excel exports | Specify financial calculations, historical cost treatment, low-stock rules, and reporting definitions |
| 4 | Public catalog and shopping cart | Customers browse/search products and select sizes/colors in an Arabic interface | Confirm branding, catalog structure, and public availability behavior |
| 5 | Guest checkout and order operations | Staff receive and process COD orders using the same central stock | Confirm order statuses, reservation/decrement/release timing, checkout fields, delivery areas and fees |
| 6 | Promotions and communication | Authorized promotion management, coupons, WhatsApp contact, and social links | Confirm eligibility, stacking, dates, bundle/Buy-X-Get-Y behavior, and coupon limits |
| 7 | Analytics, manual backup, release verification | Views/sales insights, a verified manual backup/restore procedure, and end-to-end acceptance checks | Define analytics measures, backup format, access, restore procedure, and supported browsers/devices |

Returns/exchanges and stocktaking remain open scope. Place them into the sequence only after their business rules and inclusion are confirmed.

## First proposed implementation slice

Build the smallest connected internal workflow after the architecture and slice specification are ready:

1. The owner can manage an employee account and its authorized branch context.
2. The owner can create a product and its size/color variants with internal cost and selling price data.
3. An authorized stock-receiving operation increases central stock.
4. An employee finds an item by product code, selects its variant, and completes a cash sale.
5. The sale records branch, employee, timestamp, items, quantities, prices, discounts where authorized, and final total.
6. Stock is updated consistently and the owner can see branch-attributed sales.

Proposed technical acceptance checks for that slice:

- Sales in either branch affect the same central stock record for the sold variant.
- Simultaneous sales cannot oversell the available stock; a failed sale cannot leave a partial stock change.
- Repeating a completed submission does not create a duplicate sale or duplicate stock decrement.
- Unauthorized users cannot change prices, use restricted discounts, cancel/delete sales, or read restricted branch data.
- Internal costs are excluded from all public data responses.
- The Arabic employee workflow can complete the full receiving-to-sale scenario with a real test database.

These checks guide the specification; the application does not exist yet and none has been marked as passing.

## Open business decisions

These come from section 31 of the brief unless another section is named. Resolve them when preparing the relevant specification.

| Decision | Required answer | Affected work |
| --- | --- | --- |
| Returns and exchanges | Whether allowed, time window, refund method, cross-branch rules, reasons, and stock restoration | Returns/exchanges scope and sale reversals |
| Online stock timing | When to reserve/decrease stock and when to release it | Checkout, concurrent selling, cancellations |
| Online order statuses | Final lifecycle and allowed transitions | Staff order workflow and stock effects |
| Delivery areas and fees | Actual Fayoum areas and configured fee per area | Checkout totals and fulfillment |
| Stocktaking | Whether count sessions, comparisons, and reconciliation adjustments are required | Inventory scope |
| Low-stock thresholds | Product, variant, or global rule and how quantities are set | Alerts and reports |
| Category tree | Initial categories and subcategories | Catalog management |
| Checkout fields | Required contact and delivery fields; phone is already required | Guest checkout |
| Size guide | Whether a guide is required | Product details |
| Promotions | Bundles, coupon limits, dates, stacking, and eligibility | Pricing and authorized discounts |
| Activity tracking | Confirm attribution details; decide separately if a browsable log is wanted | Sensitive operations |
| Manual backup | Method, data included, file format, and restore workflow | Operations and release |
| Management devices | Required phone/tablet/browser support | Internal interface design |
| Product statuses (section 5.5) | How manual status interacts with actual available stock | Catalog publication and selling |
| Purchase fields (section 15) | Any needed fields beyond product, quantity, cost, date, and stock effect | Receiving records |
| Branding (section 27) | Visual direction and client-provided resources | Storefront, dashboard, and POS |

Architecture and specification work must also define financial calculations precisely enough to support the requested profit and inventory-value reports. The brief does not select a historical cost method or complete those formulas.

## Ticket readiness

Use GitHub Issues for specs and implementation tickets. Use `needs-info` for a ticket awaiting a business decision and `needs-triage` for scope that still needs evaluation. Mark work `ready-for-agent` only after the specification, dependencies, and acceptance criteria are sufficient to implement it.

The triage skill uses the default five state labels and the separate `bug`/`enhancement` category labels. Setup configuration is maintained under `docs/agents/`.

## Explicit exclusions

Do not add separate branch inventories, stock transfers, barcodes, receipt printers, online card/wallet payments, customer accounts, wishlists/reviews, loyalty, a native app, supplier ledgers, automated customer notifications, or shipping-provider integration unless the user changes the brief.

For complete scope and source priority, consult the business brief rather than treating this abbreviated plan as a replacement.
