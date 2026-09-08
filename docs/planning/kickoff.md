# BRAVOS kickoff plan

Date: 2026-09-07

Source: [bravos.md](../../bravos.md). This plan sequences work from the brief; it does not add approved business rules or select a technology stack.

Later confirmed user decisions are recorded in [discovery.md](discovery.md). The requested architecture principles and the later decision to defer Module Federation are recorded in [architecture principles](../architecture/principles.md). Read both before preparing implementation tickets.

## Baseline

BRAVOS needs an Arabic management system, branch POS, and public online store. Abshway and Fayoum use one central inventory together with online orders. Branch-specific sales, expenses, employee access, and reporting remain distinct.

Physical sales are cash only. Online checkout is guest checkout with cash on delivery. Staff confirm and manage online orders. Delivery is limited to configurable areas in Fayoum Governorate.

Physical sales are final when the customer has received the items and paid, including offline, and take priority over pending online orders. An assigned employee confirms online orders through WhatsApp with manager backup. See [ADR-0001](../adr/0001-complete-physical-sales-offline.md) for the confirmed offline behavior; delivery of that capability can still be phased as previously allowed.

The representative locates and physically sets aside online items before WhatsApp confirmation; after that point, they are protected from further sales. The first offline rollout covers cached product lookup, carts, and completed cash sales. The website shows availability per size/color, with a whole product out of stock only when all its sellable variants are unavailable in the latest synchronized inventory.

Out-of-stock products remain listed and viewable with an Out of Stock label on their product page; they cannot be ordered. Managers may set Coming Soon for public preview without online ordering, or Hidden to exclude a product from the public store. These website visibility choices do not prevent authorized POS sales of available merchandise.

As clarified on 2026-09-08, marking an online order Confirmed deducts its quantities from available stock immediately; shipment and delivery do not deduct again. Both checkout and POS enforce each variant's quantity limit. Valid online requests that lose availability before confirmation are reconciled with the customer through WhatsApp.

Protect internal cost data and enforce role permissions on the server. Preserve the responsible user for important operations. A separate full audit-log interface is not confirmed.

The owner/manager alone may view purchase costs, profit figures, and inventory value. Ordinary employees see their own sales; the manager sees all employees and both branches. Each employee keeps one personal account and may operate only in manager-assigned branches, with the active branch clearly shown. These restrictions also apply to downloaded/offline data.

Managers and employees may record branch expenses. Employees use their active authorized branch and see only their own entries; the manager sees all expenses. Saved expenses enter reports immediately without approval. Only the manager may correct or cancel a saved expense, retaining its original details and recording the reason and responsible user/time.

Customer name and phone are optional for physical cash sales. Employees enter an EGP deduction after offers without a manager cap, including offline; zero totals are allowed and negative totals rejected. Sale details and manager reports identify the employee and original/discount/final amounts; the reason is optional. The accepted equal split gives 275/175 for a 300/200 basket discounted by 50; the blueprint proposes general unit allocation and rounding.

The public storefront and authenticated internal dashboard/POS have separate entry URLs and share the same backend/inventory. Returns has its own internal section, list, transaction picker, and details; see [returns.md](returns.md). The manager handles partial unreturned quantities, inspection, sellable-stock restoration once, and cash refunds Owed/Paid. The app uses a 14-day return window; later defect cases are handled externally via WhatsApp. Suggest the actual paid value (850 paid means 850); the manager can edit the final refund. Use FIFO for outbound allocations and restore sellable returns to their original batches.

Required manual backups are password-protected business-data downloads without image binaries, with safe manager-only restore. Prioritize desktop/tablet POS and phone-friendly management/storefront views. Use a neutral/product-photography-led store and light/high-contrast internal screens. Preserve separate purchase-cost batches; never average old/new costs. Begin with CSV opening data/internal operations, then launch the store after verification. Domain and hosting are booked only after website completion.

Completed-order reports show final values. Shipping-company receivables, settlements, fees, and similar accounting stay outside the system; existing checkout area fees and delivery stages remain. Tax/VAT handling is excluded. Merchandise profit/report examples must use the selected cost batches and accepted refund rules.

## Proposed work sequence

The [implementation blueprint](implementation-blueprint.md) consolidates these packages into phased delivery, with explicit technical proposals and acceptance scenarios for final review. Create implementation tickets in GitHub after that review.

| Order | Work package | Result | Decisions needed before finalization |
| --- | --- | --- | --- |
| 1 | Architecture and first-slice specification | Define runtime, data storage, separate public/internal URLs, permissions, and safe shared-stock operations | Record portable local-development choices and identity/sync details; hosting/domain booking waits until completion |
| 2 | Accounts, catalog, central stock, receiving, cash POS | An authorized employee completes a cash sale; the owner sees branch attribution | Specify discount allocation, receiving cost treatment, correction/concurrency details, and opening import |
| 3 | Expenses, dashboard, reporting | Owner sees business/branch performance and PDF/Excel exports | Specify batch-based merchandise costs, refund-period effects, and branch expenses; exclude courier/tax accounting |
| 4 | Public catalog and shopping cart | Customers browse/search products and select sizes/colors in Arabic | Supply catalog/brand data; implement accepted visibility, variant pricing, and optional size guides |
| 5 | Guest checkout and order operations | Staff receive and process COD orders using the same central stock | Supply delivery areas/fees and hours; specify remaining transition/price-change exceptions |
| 6 | Promotions and communication | Authorized promotion management, coupons, WhatsApp contact, and social links | Specify deterministic examples for accepted greatest-saving offers, bundles, cheapest reward units, and coupon usage |
| 7 | Dedicated Returns section | Manager selects an original transaction and handles a linked return/exchange with its own details | Apply manager-editable refunds, equal discount sharing, and original-batch restoration within 14 days; review the blueprint's calculation/correction details |
| 8 | Analytics, manual backup, release verification | Aggregate insights, data-only backup/restore, and acceptance checks | Define provider/privacy settings, backup/restore mechanics, exact browser support, and cutover verification |

Returns/exchanges are included in the first version, in their own section; the blueprint supplies proposed remaining mechanics for final review before implementation. Full stocktaking is deferred beyond the accepted manager-only adjustment and coordinated physical counts.

## First proposed implementation slice

Build the smallest connected internal workflow after the architecture and slice specification are ready:

1. The owner can manage an employee's personal account and assign its authorized branches. The employee selects an allowed active branch for work.
2. The owner can create a product and its size/color variants with internal cost and selling price data.
3. The manager records received variants, quantities, and purchase costs online as distinct cost batches, increasing pooled central stock without averaging costs.
4. An employee finds a product by its unique product code, selects size and color, and completes the physical sale when the customer has received the items and paid. Each variant has a separate quantity within the shared central inventory. If an item is elsewhere, physical coordination happens before completion.
5. The sale records branch, employee, timestamp, items, quantities, prices, discounts and the applying employee, and final total. Customer name/phone and discount reason are optional. Apply the employee EGP deduction after offers, allow zero totals, and reject negative totals; equal sharing is accepted and general unit allocation/rounding is proposed in the blueprint.
6. Stock is updated consistently and the owner can see branch-attributed sales.

Proposed technical acceptance checks for that slice:

- Sales in either branch affect the same central stock record for the sold variant.
- Synchronized stock-changing operations are processed atomically against the known balance. Check requested quantities per variant across the entire basket; a known balance of two cannot accept a request for three. The system does not claim globally current stock while a branch has unsynchronized sales.
- When offline support is introduced, a completed physical sale is preserved durably and synchronized without losing or duplicating its effect. Pending online requests do not block it; known stock discrepancies are surfaced rather than silently deleting a completed sale.
- Repeating a completed submission does not create a duplicate sale or duplicate stock decrement.
- Unauthorized users cannot change catalog prices, finalize stock receiving, correct/cancel completed sales, or read restricted branch data. Employee EGP discounts follow offers with no manager cap, including offline; retain attribution, permit empty reasons/zero totals, reject negative totals, and verify the agreed equal split with the blueprint's proposed unit allocation/rounding.
- A manager's correction/cancellation preserves the completed sale's original history, records reason/actor/time, and applies the actual stock and total corrections once. No completed sale may be permanently deleted.
- Internal costs are excluded from public data and ordinary employee responses/caches; profit figures and inventory value are manager-only. Ordinary employees cannot read other employees' sales.
- The Arabic employee workflow can complete the full receiving-to-sale scenario with a real test database.

These checks guide the specification; the application does not exist yet and none has been marked as passing.

## Decision status and launch configuration

These map section 31 of the brief and later answers to the affected work. All 63 numbered questions are answered; technical proposals and acceptance examples are consolidated in the blueprint.

The completed questionnaire and final review status are maintained in [questionnaire.md](questionnaire.md). The [implementation blueprint](implementation-blueprint.md) awaits final shared-understanding review; its new technical details are proposals, not recorded user answers.

| Decision | Required answer | Affected work |
| --- | --- | --- |
| Returns and exchanges | Dedicated manager section; either branch, partial quantities, sellable restoration once, cash Owed/Paid, and 14-day app window accepted. Later defect cases are external. Q62 accepts equal sharing and editable refunds; Q63 accepts FIFO/original-batch restoration; shipping-company dealings stay outside | Returns/exchanges and reporting |
| Employee permissions | Costs/profit/inventory value and online stock receiving are manager-only; employees see their own sales/expenses and use one account across manager-assigned branches. Saved expense changes are manager-only. The blueprint proposes the remaining access/reconnect mechanics | Accounts, POS, management, offline data |
| Completed-sale corrections | Accepted: manager-only linked correction/cancellation with reason, actor/time, original record retained, and actual stock/total effects applied once. Detailed correction scenarios and customer returns/refunds remain separate | POS, inventory, reporting |
| Branch expenses | Accepted: manager and employees record branch, amount, date, category, and description; employee entries use the active authorized branch and employees see only their own records. Reports include saved expenses immediately without approval. Manager-only correction/cancellation retains history and updates the reporting effect once | Expenses, permissions, reports |
| Online stock timing | Deduct available stock at representative confirmation; never deduct again at shipment/delivery. Before-shipment cancellation releases the allocation; failed delivery restores sellable units only after physical receipt/inspection. The blueprint proposes permissions and exception corrections | Checkout, concurrent selling, cancellations |
| Online order statuses | Accepted stages remain; representative handles routine transitions/cancellation before shipment, manager is backup and corrects mistakes. Arabic labels and exceptional transitions are proposed in the blueprint; actual hours are launch configuration | Staff order workflow and stock effects |
| Unanswered requests | Representative may manually cancel after configurable 48 hours and at least two contact attempts, with a reason. Confirmed orders do not expire automatically | Order follow-up |
| Offline sales | Cached prices/offers/manual discounts and completed cash sales; no fresh offline login. Manager-created personal logins/resets, visible pending counts, retry, and queue preservation across logout/updates accepted. Session/recovery controls are proposed in the blueprint | POS, shared stock, synchronization |
| Architecture delivery | Apply Clean Architecture, feature modules, clean imports, local persistence/sync preparation, and code splitting. Module Federation is deferred; the blueprint proposes the stack for final review | Starter application, deployment, dependency enforcement |
| Delivery areas and fees | Actual Fayoum areas and configured fee per area | Checkout totals and fulfillment |
| Stocktaking | Full sessions/comparison deferred. Online manager adjustment records previous/corrected quantity/reason/actor; synchronize known tills and briefly pause stock changes while finalizing. Preserve/flag late sales; exact coordination/reconciliation mechanics remain | Inventory scope |
| Low-stock thresholds | Accepted: default of 3 available units or fewer, configurable globally with a manager-set override per variant | Alerts and reports |
| Category tree | Initial categories and subcategories | Catalog management |
| Checkout fields | Required name, primary mobile, area, detailed address. Optional alternate phone, landmark, notes. Manager-configured delivery fees | Guest checkout |
| Physical-sale customer details | Name/phone optional. Manager finds original purchases by reference or date/branch/items/amount and verifies the match | POS, purchase lookup |
| Size guide and catalog pricing | Optional guide per product; product default price with optional variant overrides, consistent across both branches and website. Categories/sizes/colors editable | Product details and catalog |
| Promotions | Greatest-saving eligible automatic offer under manager settings, then coupon, then employee deduction. Fixed bundle contents/prices, cheapest Buy-X-Get-Y rewards, usage at POS completion/online confirmation and release for cancelled undelivered orders accepted. Finalize allocation/rounding examples | Pricing and authorized discounts |
| Activity tracking | Retain responsible actor/time on important records; a full browsable audit-log UI remains outside scope | Sensitive operations |
| Manual backup | Password-protected data download outside browser; no images. Reconcile queued/newer sales and pause writes before manager preview/confirmed restore. Exact portable format, identity recovery, and verification remain technical design | Operations and release |
| Management devices | Desktop/tablet POS and phone-friendly manager dashboard/storefront accepted; exact browser matrix remains | Internal interface design |
| Product statuses (section 5.5) | Accepted: automatic Out of Stock for publicly available products with no sellable variants, retaining catalog/product-page visibility while disabling ordering; manual Coming Soon preview and Hidden exclusion. POS selling remains possible with sufficient available stock | Catalog publication and selling |
| Purchase fields (section 15) | Core receiving fields and linked corrections accepted. Preserve separate purchase-cost batches, never average/overwrite old costs. Q63 accepts FIFO and return to the original allocated batch | Receiving records |
| Branding (section 27) | Photography/neutral storefront and light/high-contrast staff UI accepted; separate public/internal URLs. Actual logo/colors/domain resources remain launch data | Storefront, dashboard, and POS |

Architecture/specification must complete merchandise-profit and inventory-value examples using retained purchase-cost batches and accepted refunds. Do not use a weighted average or add tax/courier accounting. FIFO and manager-editable refunds with equal discount sharing are accepted; the blueprint makes the remaining operational/calculation proposals reviewable.

## Ticket readiness

The [full v1 specification](bravos-v1-spec.md) was approved on 2026-09-08 after the Grok review and corrections. Implementation and testing decisions are accepted; older pending/proposed wording in supporting notes records their review history. See [implementation progress](implementation-progress.md) for GitHub publication, tickets and delegated implementation status.

Use GitHub Issues for specs and implementation tickets. Use `needs-info` for a ticket awaiting a business decision and `needs-triage` for scope that still needs evaluation. Mark work `ready-for-agent` only after the specification, dependencies, and acceptance criteria are sufficient to implement it.

The triage skill uses the default five state labels and the separate `bug`/`enhancement` category labels. Setup configuration is maintained under `docs/agents/`.

## Explicit exclusions

Do not add separate branch inventories, stock transfers, barcodes, receipt printers, online card/wallet payments, customer accounts, wishlists/reviews, loyalty, a native app, supplier ledgers, automated customer notifications, shipping-provider integration/settlement accounting, or tax/VAT handling unless the user changes the scope. Domain and hosting bookings wait until website completion.

For complete scope and source priority, consult the business brief rather than treating this abbreviated plan as a replacement.
