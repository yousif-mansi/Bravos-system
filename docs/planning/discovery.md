# BRAVOS discovery decisions

Updated: 2026-09-08

This document records the ongoing discussion based on [bravos.md](../../bravos.md) and [kickoff.md](kickoff.md). Confirmed entries reflect explicit user answers and refine the baseline. Recommendations remain proposals until the user accepts them.

## Confirmed decisions

### D01: Shared stock and physical availability

The user accepted the Q1 recommendation. The POS shows shared central stock. Physical coordination happens before sale completion, including when the available item is physically at the other branch. The later clarification makes the completion point explicit: the customer has seen/received the merchandise and paid. Physical coordination remains outside this system; no separate branch balances or transfer module are introduced.

### D02: Product lookup and variant quantities

The user accepted the Q2 recommendation. A unique product code opens the product; the cashier then selects size and color. Each variant has its own quantity within the shared central inventory. Stock of one size/color must not imply availability of another.

### D03: Future operation during connection loss

The user wants browser cache/storage and synchronization after connectivity returns. A physical sale is final immediately once the customer has received the goods and paid, with or without internet. A delayed synchronization does not make that completed sale a draft or a transaction still awaiting business approval.

Preserve the completed sale and its employee/branch attribution durably, and synchronize its movement once without silently dropping it on a stock mismatch. Physical possession and payment are the user's basis for allowing offline completion. This decision is captured in [ADR-0001](../adr/0001-complete-physical-sales-offline.md).

The earlier permission to introduce full offline operation later remains: the later Q6 asked about future offline sales and settled their behavior, without explicitly changing the delivery phase. The architecture must accommodate that behavior from the beginning. Q10 subsequently settled the first offline operation scope: cached product lookup, cart editing, and completed cash sales. Stock receiving, price/permission changes, and online-order confirmation require a connection initially. The blueprint proposes discrepancy resolution for final review.

### D04: Customer submission and representative confirmation are distinct

Customer submission alone does not remove or reserve stock. Physical sales take priority over pending online orders. A representative checks availability and confirms an online order later through WhatsApp; if stock is no longer available, the manager can inform the customer and decline/cancel the request.

Q9 settled protection after confirmation: the representative locates and physically sets aside the actual items before WhatsApp confirmation, and other physical/online sales must respect that allocation afterward. Q12 subsequently accepted the main order stages with a correction: deduct available stock immediately at confirmation, without a second deduction at shipment. See D08 for the current lifecycle. "In progress" was an earlier working label; final Arabic labels remain to be chosen for the accepted meanings.

The assigned-employee and manager-backup recommendation is accepted. Actual employee assignment and working-hour values have not been supplied; those are operational configuration to collect without reopening the agreed physical-sale priority.

### D05: Required architecture direction

Before implementation, the user explicitly requested:

1. Clean Architecture.
2. Feature-Based Modules.
3. Clean imports.
4. Local-First Architecture, connected to future offline operation.
5. Module Federation.
6. Code splitting and dynamic imports.

[Architecture principles](../architecture/principles.md) records the implementation constraints. In the subsequent Q7 answer, the user accepted deferring Module Federation: begin with strong feature boundaries and code splitting and revisit federation when a concrete independent-release need appears. This later decision updates item 5 above.

### D06: Out-of-stock website behavior and synchronization visibility

The user requires the website to show an item as out of stock when its inventory is empty. In Q11, the user accepted disabling an unavailable size/color while allowing stocked variants, and showing the whole product as out of stock only when all its sellable variants are unavailable in the latest synchronized inventory. Q13 additionally requires quantity caps and validation of available units at submission; see D09. Q18 settles manual status behavior and explicitly keeps out-of-stock products publicly viewable; see D14.

Technical consequence of D03: the website can react only to inventory changes communicated to it. A final-unit sale in an offline branch can leave the website temporarily showing the earlier quantity until synchronization. Physical possession resolves the branch's ability to complete that sale; it does not communicate the sale to the website during a disconnection. This does not authorize an inventory hold on a pending order or a separate website stock balance.

### D07: Physical set-aside protects confirmed online orders

The user accepted the Q9 recommendation. Before WhatsApp confirmation, the representative locates and physically sets aside the merchandise. Physical sales retain priority while the online request is pending; after confirmation, the items are protected from further physical and online sales. See [ADR-0002](../adr/0002-protect-confirmed-online-items.md).

Q12 subsequently clarified the deduction point and accepted the main order flow; Q14 settled unsuccessful delivery handling. Those decisions are recorded below.

### D08: Order stages and deduction at confirmation

On 2026-09-08, the user accepted Q12 with a correction: deduct the item from inventory as soon as it is confirmed through WhatsApp, or leave the decision to the responsible person. Use the explicitly requested immediate-deduction option: the responsible person decides when to mark the order Confirmed, and that action deducts the confirmed quantities automatically. A per-order choice of deduction timing is not specified.

The primary inventory quantity means available stock. Confirmed merchandise remains traceable to its order even while physically awaiting shipment; it is already excluded from this available quantity.

| Accepted stage | Stock effect |
| --- | --- |
| Awaiting confirmation | No stock reservation or deduction; submission still must pass the quantity checks in D09 |
| Confirmed | Responsible person confirms after WhatsApp and physical set-aside; deduct available quantities once |
| Shipped | Record handover to the delivery provider; no further deduction from available stock |
| Delivered | Record completed delivery; no further stock deduction |
| Cancelled before shipment | Release set-aside merchandise and restore its previously deducted available quantity once; cancelling an unconfirmed request adds nothing |

Example: 10 available units become 8 when an online order for 2 is confirmed. Shipment and delivery leave availability at 8. Cancelling that confirmed order before shipment returns the released 2 units to availability, bringing it back to 10.

The earlier proposal to wait until shipment for a physical-stock deduction is no longer the operational inventory rule. If reporting later needs a separate view of merchandise physically held, reserved, or with a courier, define it explicitly without duplicating the available-stock movement. Financial recognition, cost valuation, COD collection/remittance, and customer returns are not decided by this deduction rule.

### D09: Quantity limits and later availability changes

Q13 originally concerned different items becoming unavailable before representative confirmation. The user clarified the following rules for both repeated units and mixed-product baskets:

- If a particular size/color has 2 available units, a new request for 3 is not allowed in either POS or the online store.
- Apply this limit independently to each variant, including its combined requested quantity across multiple basket lines. Quantities of different sizes/colors cannot cover a shortage.
- The online quantity selector permits no more than known availability, and submission must validate the current server-known quantity. Do not knowingly accept an invalid basket merely because staff will later use WhatsApp.
- If stock changes after a valid online submission, the representative handles the shortage through WhatsApp and confirms the actual available items agreed with the customer. Do not silently substitute a product, size, or color. The representative rechecks before the confirmation deduction.
- In-store stock must reflect real merchandise. Employees must not sell more units than are physically available; the system applies its known available quantity as well. The manager-only correction workflow accepted in Q16 is recorded in D12.

Clarification prompted by the user's follow-up: the shortage example concerns a later change, not a system/physical-count mismatch. At submission, actual available stock and system stock both equal 3, so a request for 3 passes validation. The pending request does not reserve those units. A subsequent physical sale of 1 makes actual stock and system stock both equal 2; when the representative later reviews the still-pending request for 3, they must contact the customer before confirming a valid quantity. This example works even with every device online and every sale synchronized immediately. It explains the existing pending-request/physical-priority rules and does not authorize accepting 3 against an already-known balance of 2.

D03 still applies to completed offline sales and their later synchronization. Quantity validation for a new transaction does not authorize silently discarding a sale that was already completed and durably recorded. Offline devices cannot see uncommunicated movements on other devices; that technical limitation has not been removed by the quantity rule.

### D10: Failed delivery and physical receipt

The user accepted Q14. An unsuccessful delivery stays unavailable under Delivery failed / Awaiting return while the courier still has the parcel. Restore only sellable quantities, once, after staff physically receive and inspect the returned parcel. The final receiving action and permissions need specification, but the stock-restoration condition is settled. This does not establish a policy for customer returns after successful delivery.

### D11: Unanswered pending requests

The user accepted Q15. After 48 hours from submission and at least two manual contact attempts, the representative may manually cancel an unanswered pending request, recording Customer unreachable as the reason. Make the waiting period configurable. Pending requests do not hold stock; this rule adds neither automatic cancellation nor automated customer notifications.

### D12: Manager stock corrections

The user accepted Q16. Provide an online, manager-only stock adjustment recording the variant, previous available quantity, corrected available quantity, reason, actor, and time. Ordinary cashiers cannot bypass the quantity limit. Count merchandise actually available for sale, excluding quantities set aside for confirmed orders. This decision authorizes a correction action; it does not add full stocktaking sessions, a dedicated damaged/missing-stock module, or silent rewriting of completed transactions.

Detailed coordination with unsynchronized movements and any financial valuation effect remain to be specified.

### D13: Low-stock thresholds

The user accepted Q17. Alert at three available units or fewer by default. Make the default configurable and allow a manager-set threshold for each variant. Evaluate available stock after confirmed-order deductions; do not count reserved quantities as available.

### D14: Website product statuses and visibility

The user accepted Q18 with an explicit clarification: Out of Stock must appear on the product page; the product stays visible on the website for viewing but cannot be ordered.

- Available: customers may order stocked variants, subject to quantity checks.
- Out of Stock: derived automatically for an otherwise publicly available product when all its sellable variants are unavailable. Keep it listed and browsable, display the label on its product page, and disable ordering. Revert to effective availability when stock returns.
- Coming Soon: manager-selected public preview with online ordering disabled.
- Hidden: manager-selected exclusion from the public store.
- Coming Soon and Hidden control the website; they do not by themselves prevent an authorized physical sale with sufficient available quantity.

### D15: Employee visibility into costs and profit

The user accepted Q19. Cost prices, profit figures, and inventory value are visible only to the owner/manager. Ordinary cashiers and order representatives see the selling prices and quantities required for their jobs. Enforce this through data access and responses, including data cached for offline use, rather than merely hiding screen fields. The brief's prohibition on public cost exposure also remains in force.

### D16: Employee visibility into sales history

The user accepted Q20. Ordinary employees can view their own sales in their authorized branch context. The manager can view all employees, both branches, and their combined totals. Ordinary employee access does not include colleagues' sales or manager-wide totals.

### D17: Employees working across branches

The user accepted Q21. Keep one personal account per employee; the manager assigns one or more allowed branches. The employee selects only an authorized branch when starting work. Show the active branch clearly and attribute every sale to that branch and employee. This does not introduce separate branch stock, shared employee accounts, or a shift/cash-drawer module.

### D18: Receiving merchandise

The user accepted Q22. The manager records received variants, quantities, and purchase costs and finalizes stock receiving online. Ordinary employees may assist with the physical count but cannot finalize receiving or access purchase costs. A separate employee quantity-only receiving workflow is not included in the first version.

### D19: Employees may record branch expenses

The user accepted Q23 with a correction: employees can add expenses too. Both the manager and employees may create branch expense records, retaining the proposed basic fields: branch, amount, date, category, and description. Attribute each record to its creator.

Q25-Q27 subsequently settled expense visibility, saved-record corrections, and immediate reporting; see D21-D23. Expense entry has not been added to the accepted first offline rollout.

### D20: Traceable corrections to completed sales

The user accepted Q24. Only a manager may correct an erroneous completed sale, using a linked correction or cancellation with a required reason, actor, and time. Preserve the original record; do not allow a hard delete or an untraceable edit of completed sale lines. Reflect the correction in stock and totals exactly once, according to what actually happened; cancelling a record does not imply that merchandise has physically returned.

This refines the brief's references to deleting sales: the permitted operation retains history. It does not decide customer refund, return, or exchange policies, and does not add a full audit-log browsing interface. Q28 later accepted returns/exchanges in D24; D32, D42, D50, and D51 record the subsequent policies.

### D21: Expense branch and visibility

The user accepted Q25. An employee records an expense against their active authorized branch and may view only expenses they entered in their authorized branch context. The manager can view both branches and all employees' expenses. Employee expense access does not grant access to colleagues' records, branch-wide expense totals, or profit reports.

### D22: Correcting a saved expense

The user accepted Q26. Employees may check and change fields before saving an expense. After saving, only the manager may correct or cancel it, recording the reason and retaining the original details and responsible user/time. Employees ask the manager to resolve mistakes; no separate correction-request workflow is required.

Example: an employee saves 500 EGP instead of 50 EGP. The manager corrects the expense to 50 EGP, preserving the original 500 EGP entry and correction history; reports reflect 50 EGP rather than treating the correction as another expense.

### D23: Immediate expense reporting

The user accepted Q27. A saved employee expense counts in expense reports immediately, without a separate approval queue. Record its creator and creation time. A later manager correction or cancellation updates the expense's reporting effect once while retaining its history. Detailed net-profit formulas remain a separate decision.

### D24: Customer returns and exchanges in the first version

The user accepted Q28. Include a manager-operated workflow for customer returns and exchanges for physical sales and delivered online orders, linked to the original purchase. Q36-Q39 and the dedicated-Returns instruction settle lookup, cross-branch handling, partial quantities, inspection, and cash-refund recording in D32. D42 settles the 14-day app window with later defect cases external; D50-D51 settle equal discount sharing, manager-editable refunds, FIFO, and original-batch returns.

### D25: Optional customer details at the physical checkout

The user accepted Q29. Customer name and phone are optional for a physical cash sale; a walk-in purchase can be completed without collecting either. Required online checkout contact/delivery fields remain a separate workflow, including the already-confirmed phone requirement. This does not add customer accounts or a dedicated purchase-history feature. Q37 subsequently accepted purchase lookup by reference or date/branch/items/amount, with manager verification.

### D26: Employees may apply discounts, with attribution

The user changed the Q30 recommendation: add a discount option for employees and note that the employee applied a discount. Employees may apply a discretionary discount to a physical sale; preserve the discount value and identify the employee who applied it, with a clear indication on the sale that an employee discount was used. The earlier proposal making all discretionary discounts manager-only is superseded.

This permission concerns a sale being prepared. It does not grant employees permission to change catalog prices, create/activate promotions, or edit a completed sale. Q31-Q33 subsequently settled unrestricted employee choice of discount amount, display with an optional reason, and combination with offers; see D27-D29. Q34 and Q46 settled EGP entry after offers, nonnegative totals, and offline use; D50 settles equal sharing for the two-item example; the blueprint proposes general unit allocation and rounding.

### D27: Employee chooses the discount amount without a manager cap

The user rejected the Q31 cap proposal: let the employee set the deduction amount they want. Do not impose a manager-configured percentage/amount limit, a profit-margin limit, or approval based on the chosen amount. Q34 subsequently accepted a zero-total sale and rejection of a deduction that would make the total negative; this is arithmetic validation, not a manager cap.

### D28: Employee discount display and optional reason

The user accepted Q32 with a correction: the reason field is optional. Show that an employee applied a discount in sale details and the manager's sales report, together with the employee, original amount, discount, and final amount. Preserve attribution/time; a missing reason must not block the discount or sale. This does not introduce a separate notification or approval queue, or broaden employees' access to colleagues' sales.

### D29: Employee discounts may combine with configured offers

The user rejected the Q33 prohibition: employees may also discount items already discounted by an offer. Preserve the configured promotion effect and the additional employee discount distinctly. Do not add a manager exception/approval requirement for this combination. Q34 places the employee deduction after offers; Q42 accepts the default offer/coupon combination. D45 and D50 settle subsequent promotion/refund rules; the blueprint proposes general allocation and rounding details.

### D30: Faster interview rounds and visible remaining scope

The user says three questions per round is too few and asks for visibility into the total. Ask the full set of currently answerable decisions in larger rounds, grouping related details and avoiding renewed approval of settled rules. Keep a visible working count and identify dependent follow-ups. An estimate is not a promise of an exact final question count. Record launch configuration separately instead of creating one approval question for every data field.

### D31: Discount calculation order and nonnegative totals

The user accepted Q34. The employee enters one EGP deduction from the physical-sale total after offers. For example, 1,000 minus a 100 offer minus a 50 employee discount gives 850 paid. A zero total is allowed; a deduction producing a negative total is rejected. D50 settles the equal two-item split; the blueprint proposes general unit allocation and rounding for partial returns and reports.

### D32: Dedicated Returns section and accepted return operations

The user accepted Q36-Q39 and explicitly requested a separate Returns section with its own details, instead of putting return controls into the normal sales workflow. From Returns, the manager selects an original transaction from a list and loads its details. Preserve the original sale and link a separate return record. See [returns.md](returns.md) for the concrete workflow and the distinction between accepted behavior and unresolved policies.

Returns/exchanges may be handled at either branch, including delivered online purchases. Record the handling branch while keeping the reversal linked to the original branch/channel. Locate the original transaction by reference or by date, branch, products, and amount, with manager verification. Allow partial returns only up to quantities not already returned. Inspect physically received items and restore only sellable quantities once; no dedicated damaged-stock module is introduced.

Refunds for cash/COD purchases are recorded as cash refunds, with amount, date, responsible manager, and Owed/Paid distinction; no store-credit balance. Later answers settle a 14-day in-system window with later defect cases handled externally, and remove shipping-company financial tracking. D50 confirms actual-paid refunds, equal sharing in the two-item example, and an editable manager-determined refund. Returns processing does not change an original transaction's date or make the physical-sale checkout a returns screen.

### D33: Guest checkout fields

The user accepted Q40 and emphasized that the alternate number and landmark must be optional, as originally recommended. Required: customer name, primary mobile number, delivery area, and detailed address. Optional: alternate phone, landmark, and notes. Delivery fees come from manager-configured areas; the actual area/price list is launch configuration.

### D34: Online order operations and offer configuration

The user accepted Q41-Q42. The representative handles confirmation, shipment, delivery, failed delivery, and cancellation before shipment; the manager is backup and handles corrections. Confirmed orders have no automatic expiry. Existing stock effects remain unchanged.

Use one applicable automatic offer plus one eligible coupon by default, with manager-controlled eligibility, dates, usage limits, and combination settings. Employees may still apply their additional POS discount. Q56 later accepts greatest-saving offer selection, specified bundle contents/prices, cheapest eligible Buy-X-Get-Y reward units, and coupon usage rules in D45; general allocation/rounding examples are proposed in the blueprint.

### D35: Catalog pricing and sizing

The user accepted Q43. One product selling price is the default, with optional manager-set size/color price overrides. Keep a variant's listed price consistent across both physical branches and the website. Categories, sizes, and colors are editable; a size guide per product is optional. Discounts remain transaction-level reductions, not catalog-price edits by employees.

### D36: Stocktaking scope and receiving corrections

The user accepted Q44-Q45. Defer dedicated stock-count sessions/comparison screens; retain physical counting and the already-accepted manager stock adjustment. Correct a saved receiving record through a linked correction retaining original quantity/cost, reason, actor, and time. Do not delete receiving history. Reconcile stock effects with intervening sales; the blueprint proposes traceable historical cost corrections for final review.

### D37: Offline sessions, prices, discounts, and counting

The user accepted Q46-Q47. Already-signed-in employees may complete sales using cached prices, still-valid cached offers, and manual discounts. No fresh offline login initially. Account disablement takes effect when the device reconnects, preserving earlier completed sales. The blueprint proposes session/recovery mechanics for final review.

Synchronize known tills and briefly pause stock-changing work while the manager finalizes a quantity correction. Preserve late-arriving completed sales and flag discrepancies for manager reconciliation. The pause coordinates counting; it does not permit silently deleting a sale completed during an outage.

### D38: Completed sales and final order values

The user initially accepted Q48, then explicitly narrowed it: reports include completed orders and their final values; the system does not get involved in shipping-company dealings. Keep completed physical sales and delivered online orders as the accepted completion events. Pending/confirmed orders remain in the operational order workflow, but do not add courier receivables, remittances, settlements, payments, or fee-reconciliation screens/records. The earlier courier-cash distinction is superseded. Customer-facing delivery-area fees remain part of the accepted checkout configuration and do not imply a courier ledger.

### D39: Data-focused manual backup

The user accepted Q49 with a correction: images are not necessary in the backup; data is the priority. The required manual backup covers business data, including useful image references, without requiring image binaries. Restoration remains manager-only with preview/confirmation. A data-only restore cannot recreate missing image files. Q60 later accepts password-protected downloads saved outside the browser, reconciliation of queued/newer sales, and a write pause before restore. Provider-specific identity recovery and exact portable format/mechanics remain for the technical proposal; no image-backup feature is required.

### D40: Devices, visual direction, and separate internal URL

The user accepted Q50-Q51 and clarified that the dashboard/POS must not appear on the public website and must have a separate link. Prioritize desktop/tablet POS, with the management dashboard and public store usable on phones. Use product photography and a neutral public-store palette, and light, high-contrast internal screens with clear controls.

Provide separate entry URLs for the public store and authenticated internal application; dashboard, POS, Returns, and other staff functions live in the internal application and are absent from customer navigation. Both applications use the same business backend and central inventory. The blueprint proposes local/production application boundaries; actual domains and hosting remain unchosen; separation does not imply Module Federation or duplicate inventory.

### D41: Analytics and opening rollout

The user accepted Q52-Q53. Initial analytics cover aggregate visits, product views, cart additions, submitted orders, and completed sales, without individual visitor profiles. Provider/privacy settings and exact metric definitions remain implementation preparation.

Import products, current quantities/costs, and operating configuration with CSV support; do not import old paper sales history initially. Launch internal operations first, then the public store after verifying stock and workflows. This sequencing does not remove accepted first-version features.

### D42: Fourteen-day in-system returns; later defect cases are external

The user clarified Q35: use 14 days only in the system, including defective-item cases within that window. Defect cases beyond 14 days are handled outside the system through WhatsApp. This resolves application scope; it does not assert that consumer rights end after 14 days. Do not add a separate 30-day in-app return route or reopen this as an unanswered product decision. The start point remains customer receipt: physical sale completion or online delivery.

The earlier legal research remains background to this distinction, not a reason to override the clarified software workflow. An external WhatsApp conversation is not automatically imported or treated as a recorded stock/refund movement; ordinary authorized corrections remain available when actual records need reconciliation.

### D43: Refund the amount actually paid

The user clarified Q54: refund the full amount paid by the buyer regardless of discounts applied. Preserve the original payment value; do not deduct the discount a second time or add a return penalty. Do not silently reinterpret this as paying the undiscounted list price. For example, a full return of a purchase actually paid at 850 returns 850.

Q62 subsequently rejects the proportional example in favor of equal sharing and an editable manager-determined refund; see D50. The exchange workflow remains a credit toward the replacement's current selling price after applicable offers with cash collected/refunded for the difference; its credit uses the manager's final refund value.

### D44: Separate purchase-cost batches, without averaging

The user rejected Q57's moving average and requires new-cost merchandise to remain separate from old-cost merchandise. Track each variant's quantities in distinct stock batches retaining their purchase costs; do not overwrite older costs or calculate an average. The variant's available quantity is still the sum of available units across its batches within one central inventory. This does not create separate branch stock or duplicate public products.

Managers can inspect batch costs; ordinary employees still receive allowed selling prices and aggregate quantities without private purchase costs. Q63 subsequently accepts FIFO and original-batch sellable returns; see D51 and [ADR-0003](../adr/0003-preserve-purchase-cost-batches.md).

### D45: Promotion selection, bundles, and coupon usage

The user accepted Q56. Choose the eligible automatic offer giving the greatest saving under the manager's combination settings, then apply the eligible coupon and finally any employee POS deduction. Fixed bundles specify their items/quantities and total price; Buy-X-Get-Y discounts the cheapest eligible reward units. Count coupon use at physical-sale completion or online confirmation, releasing it once for cancelled undelivered orders. Promotion dates use Cairo time; later catalog/promotion edits do not rewrite accepted transaction prices. D50 records the subsequent equal-sharing example and manager-editable refund; the blueprint extends the calculation examples.

### D46: Management reports without tax or courier accounting

The user accepted Q58's management reporting and calendar-period direction, with an explicit correction: no tax or similar charge handling now. Do not add VAT/tax fields, calculations, tax reports, or another tax-registration questionnaire. The Q48 correction also removes courier accounting and fee reconciliation from the earlier Q58 proposal.

Use net merchandise sales after discounts/recorded refunds and the associated batch purchase costs for merchandise gross profit; branch expenses support the internal operating-profit view. Do not introduce courier margin/settlement or tax calculations into that view. Completed-order reports show final order values. Customer-facing checkout delivery fees remain configured separately and are not treated as a measured courier profit margin. Reports use Cairo dates and calendar months; a return affects its processing period while keeping the original-sale link. D50-D51 settle refund and FIFO direction; the blueprint proposes concrete report examples.

### D47: Accounts, recovery, and protected data backups

The user accepted Q59-Q60. The manager creates personal staff login-name/password accounts and handles staff password resets; the owner has separate recovery. Existing offline-session behavior remains. Show unsynchronized-sale counts, retry on reconnection, and preserve queued sales across application logout/update flows rather than erasing them. Concrete identity/session/recovery controls belong in the technical proposal.

Backups are password-protected data downloads saved by the manager outside the browser. Reconcile queued/newer sales and briefly stop writes before restore, then present the already-agreed preview and manager confirmation. Do not silently overwrite activity newer than the backup. Include business records/configuration and image references, without image binaries; exact identity recovery and portable format remain technical decisions.

### D48: Domain and hosting are booked after website completion

The user clarified Q61: a domain and hosting will be obtained, but only after the website work is complete. No provider, domain name, or budget has been chosen. Continue design and local development planning without making paid hosting or a booked domain a prerequisite. Preserve separate public/internal URLs and one shared backend; provider selection, reservation, and production deployment are later steps. Do not book or purchase services now.

### D49: Online return arrangements stay outside shipping-company accounting

Q55's branch drop-off or manually arranged courier return through WhatsApp is accepted. The recommended ordinary-return versus defective/wrong-item responsibility can guide those external arrangements. The later Q48 scope correction takes precedence over the proposed app fee/handover ledger: shipping-company dealings, charges, settlements, and similar operational accounting stay outside this system. The app retains its accepted customer return/refund record and checkout area-fee configuration; it does not track courier cash or create a carrier integration.

### D50: Equal discount sharing and manager-editable refunds

The user answered Q62: if the customer pays 850, the refund is 850. In a purchase containing products priced at 300 and 200 with a 50 discount, divide the discount equally: the resulting item paid values are 275 and 175. This supersedes the earlier proportional 270/180 proposal; never subtract the discount again during the refund.

The user also explicitly gives the manager control of the final refund amount through an editable field. Keep the original payment and suggested item value traceable while recording the manager's actual authorized refund, responsible user, and payment state. Reports reflect the actual recorded refund; do not silently impose a new amount cap, mandatory override reason, or additional approval queue.

The two-item example does not by itself settle repeated quantities, low-priced units, rounding, or allocation of every promotion type. The [implementation blueprint](implementation-blueprint.md) explicitly proposes those extensions for final review, rather than attributing them to this answer.

### D51: FIFO allocation and original-batch returns

The user accepted Q63. Allocate sold or confirmed-order quantities from the oldest available purchase-cost batch first, retaining that batch's cost and moving to the next only as needed. For 10 units costing 100 and 10 costing 140, a three-unit sale uses three older units and leaves 7 old-cost units and 10 new-cost units.

Restore sellable returned units to their original allocated batches with those costs. Staff and customers continue to see aggregate available variant quantities and selling prices; private batch costs stay manager-only. No average cost, separate branch balances, or separate public product per batch is introduced.

## Final review pending

All 63 numbered questions have answers; see [questionnaire.md](questionnaire.md). The [implementation blueprint](implementation-blueprint.md) now presents the concrete architecture, operational details, examples, and delivery sequence for final shared-understanding review. Accepted business decisions above remain distinct from proposed implementation details. No production application has been implemented.

## Current decision tree

- Accepted equal sharing and manager-editable refunds (D50) -> proposed unit allocation, rounding, and exchange examples in the blueprint.
- Accepted FIFO and original-batch returns (D51) -> proposed historical-cost and late-movement reconciliation mechanics in the blueprint.
- Accepted 14-day app window and dedicated Returns section -> detailed screen/state specification; later defect cases remain external.
- Accepted promotion rules -> deterministic implementation examples and transaction/concurrency checks.
- Accepted reporting scope -> merchandise profit and return-period examples using batch costs, excluding tax/courier accounting.
- Accepted account/backup requirements -> concrete identity, session, synchronization, recovery, export, and restore design.
- Hosting booked later -> research portable/local-development options without purchasing infrastructure.
- Resolved business/device/operational requirements -> researched architecture choices, initial specification, and final shared-understanding review before production implementation.

Module Federation remains deferred. Low-stock thresholds, expense permissions, employee discount freedom, and first-version returns/exchanges scope are settled; do not reopen them without a new conflict or user correction. The linked questionnaire carries the remaining branches rather than treating their absence from this short tree as a decision.
