# BRAVOS questionnaire and remaining scope

Updated: 2026-09-08

Read [discovery.md](discovery.md) for accepted decisions and [returns.md](returns.md) for the separate Returns section. All 63 numbered questions are answered. Historical proposals below are not current requirements when superseded by recorded answers. The remaining step is review of the [implementation blueprint](implementation-blueprint.md), including explicitly proposed technical details. Q35 is settled: 14 days in the app, later defect cases outside via WhatsApp.

## Working count

| State | Count |
| --- | --- |
| Numbered questions answered | 63 of 63 |
| Unanswered numbered business questions | 0 |
| Current step | One consolidated architecture/operational draft for final review |
| Remaining review | Proposed stack, calculation edge cases, recovery mechanics, and delivery sequence in the blueprint |
| Launch configuration | Collect real catalog, staff, delivery, and branding values together when needed |

The numbered interview is complete. The blueprint makes the remaining implementation proposals explicit for one shared-understanding review before production implementation, without reopening settled business choices.

## Answered round: Q62-Q63

### Q62: Full paid value and partial returns

Accepted with correction: 850 paid means a refund of 850. Items priced at 300 and 200 with a shared 50 discount receive equal shares of 25, giving item paid values of 275 and 175. The earlier proportional 270/180 example is rejected. The manager determines the final refund through an editable field. Preserve the suggestion and actual refund separately; see D50. General per-unit allocation, low-priced items, rounding, and exchange examples are proposed explicitly in the blueprint.

### Q63: Selecting and restoring stock batches

Accepted: allocate from the oldest available batch first (FIFO), retaining its original cost and moving to the next batch only when needed. For example, 10 units costing 100 and 10 costing 140 remain separate; a three-unit sale uses three from the first batch, leaving 7 old and 10 new. Return sellable units to their original allocated batch. POS/storefront still show total available quantity and the existing variant selling price; only the manager sees costs/batch detail. See D51.

## Answered round: Q54-Q61

Original proposals below are retained for context. Current outcomes take precedence:

- Q54/Q62: full refunds use the amount actually paid; Q62 accepts equal sharing in the two-item example and manager-editable final refunds, superseding the proportional proposal below.
- Q55/Q48: branch drop-off and WhatsApp arrangements are accepted, but shipping-company dealings, fees, remittances, settlements, and similar accounting are outside the app. Retain customer return/refund records and configured checkout area fees.
- Q56: greatest-saving eligible offers, bundles, cheapest eligible rewards, coupon usage/release, Cairo dates, and accepted-price history are accepted.
- Q57/Q63: averaging is rejected. Preserve distinct purchase-cost batches, use FIFO, and restore sellable returns to their original allocated batches.
- Q58: tax/VAT and courier accounting are excluded. Use merchandise/batch-cost/expense management reporting and accepted period rules.
- Q59-Q60: personal staff login/reset, owner recovery, queue visibility/preservation/retry, and password-protected data-only backup/restore safeguards are accepted.
- Q61: domain and hosting will be booked after website completion; no booking is required now and no provider/budget has been selected.

### Q54: Partial refund values and exchanges

How should discounts affect a partial refund or an exchange?

Recommendation: distribute the employee's basket deduction proportionally across item values after configured offers, keeping exact per-unit paid amounts with deterministic rounding. Refund the returned units' original net paid amount without repricing the retained original purchase. For an exchange, credit that value toward the replacement's current selling price after applicable offers, then collect/refund the difference. Example: items worth 300 and 200 after offers, with a further 50 employee deduction, carry net values of 270 and 180.

### Q55: Online return handover and delivery charges

How should online returns be handed back, and who pays transport?

Recommendation: allow either branch drop-off or a courier arrangement made manually through WhatsApp. For an ordinary change-of-mind return, the customer pays applicable delivery/return transport charges unless BRAVOS offers more generous terms; BRAVOS pays the remedy costs for defects or a wrong item. Track actual fees and cash-refund handover separately, without a courier API. Statutory supplier-delay/nonconformity exceptions remain protected. This follows the distinctions in the official law linked below; detailed deadlines and refund transport must comply with the applicable case.

### Q56: Exact offer and coupon behavior

How should automatic offers, bundles, and coupon counts work?

Recommendation: choose the eligible automatic offer giving the greatest saving under the manager's combination settings; then apply the eligible coupon, then the employee POS deduction. Fixed bundles specify their items/quantities and total price. Buy-X-Get-Y discounts the cheapest eligible reward units. Count coupon usage at physical-sale completion or online confirmation, releasing it once for cancelled undelivered orders. Define dates in Cairo time, and keep accepted transaction prices unchanged by later catalog/promotion edits. Basket allocation follows Q54 if accepted; do not treat its answer as already known.

### Q57: Cost method for internal reports

Which purchase cost should be used when the same variant arrives at different costs?

Recommendation: moving weighted average per variant, recalculated from remaining owned merchandise and new receipts. With no intervening sales, 10 units at 100 plus 10 at 140 gives 120 per unit. Keep historical sale costs traceable and correct errors explicitly rather than silently repricing old sales. Merchandise set aside or with the courier still belongs in the relevant owned-stock valuation until the accepted completion event; this does not change available-stock deduction at confirmation. Qualifying inbound costs must be distinguished from ordinary branch expenses. This is a proposed management-reporting method, not a claim about BRAVOS's statutory/tax obligations; [IAS 2 permits FIFO or weighted average for interchangeable inventory](https://www.ifrs.org/issued-standards/list-of-standards/ias-2-inventories/).

### Q58: Profit and reporting periods

How should the internal dashboard present profit, returns, and cash?

Recommendation: show net merchandise sales after discounts/returns, subtract the associated merchandise cost for gross profit, then account for delivery charges/fees and branch expenses for management operating profit. Keep courier cash owed/received separate. Use Cairo-local dates and calendar months; show a return in the period processed while retaining its original-sale link. Actual tax treatment must be supplied before finalizing tax-inclusive formulas; do not assume a VAT rate or call this a tax-filing report. The chosen cost method is decided independently in Q57.

### Q59: Accounts and offline recovery

How should staff sign-in and recovery work?

Recommendation: manager-created personal login-name/password accounts, with staff password resets handled by the manager and separate owner recovery. Existing offline sessions continue under the accepted Q46 policy. Show unsynchronized-sale counts and retry automatically on reconnection; the application must preserve queued sales across logout/update flows rather than erase them. Exact identity provider, session handling, device-loss limits, and secure recovery mechanisms belong in the technical proposal. This does not promise to recover unsynchronized data physically deleted from a device.

### Q60: Protecting and restoring data-only backups

Should data backups be protected, and how should restoration affect current work?

Recommendation: password-protected data downloads saved by the manager outside the browser. Before a full restore, reconcile queued/newer sales and briefly stop writes, then show the preview and require the already-agreed manager confirmation. Do not silently overwrite activity newer than the backup. Include business records/configuration and image references, without image files; identity recovery and exact portable backup format will be specified after service selection.

### Q61: Hosting, domain, and budget constraints

Is there an existing domain, required provider/technology, or monthly hosting budget?

Recommendation: keep separate public-store and internal-app addresses with one shared backend, and compare maintained service options against the budget and offline/stock requirements before selecting a stack. Supply any fixed constraints; otherwise indicate that there are none. Do not ask for passwords or API keys in the interview, and do not purchase or deploy services as part of recording this answer.

## Answered round: Q34-Q53

The text below preserves original proposals, not current pending decisions. The following later clarifications override their original wording:

- Q40: alternate phone, landmark, and notes are optional, as already proposed.
- Q49: required backup is business data without image binaries. Manager-only preview/confirmation for restore was accepted.
- Q51: public store and internal dashboard/POS have separate links; internal screens do not appear in the public website.
- Additional instruction: a dedicated internal Returns section selects the original transaction from a list and loads its details. See [returns.md](returns.md).
- Q35: the user settled 14 days in the system, with later defective-item cases handled outside via WhatsApp. No 30-day in-app route is required; this is application scope, not a claim that statutory rights expire at day 14.
- Q48: report completed orders and final values; remove the proposed shipping-company money/settlement tracking.

### Q34: Discount calculation

Should the employee enter one EGP deduction from the sale total after offers?

Recommendation: yes. For example, 1,000 minus a 100 offer minus a 50 employee discount means 850 paid. Allow a zero total, but reject a deduction that makes the total negative. This is arithmetic validation, not a manager-set discount limit.

### Q35: Return periods

Does BRAVOS want to offer longer return periods than the general legal baseline?

Recommendation: start with 14 days from receipt for ordinary returns/exchanges and 30 days for defective goods, subject to the applicable exceptions and any stronger rights. Do not set a shorter business policy. See the [official CPA guidance](https://cpa.gov.eg/ar-eg/بيانات-اعلامية/ArtMID/654/ArticleID/6773).

### Q36: Returning at another branch

May customers return/exchange purchases at either branch, including delivered online purchases?

Recommendation: yes. Record the handling branch while linking the reversal to the original sale/order and its original branch/channel.

### Q37: Finding the original purchase

How should the manager find a purchase when the customer supplied no phone number?

Recommendation: use a sale/order reference, with lookup by approximate date, branch, items, and amount when needed. The manager verifies the match; customer contact details remain optional for physical sales.

### Q38: Partial returns and stock

Can a customer return only some items, and when do those items become available again?

Recommendation: allow partial returns up to the quantity not already returned. Inspect received items and restore only sellable quantities, once. Keep unsellable merchandise out of available stock; no separate damaged-stock module is added.

### Q39: Refund recording

How should the system record refunds for cash/COD purchases?

Recommendation: cash refunds, with amount, date, responsible manager, and whether the refund is still owed or has been paid. Do not create a store-credit balance. Online handover arrangements and delivery charges are follow-up details.

### Q40: Online checkout fields

Which details should guest checkout require?

Recommendation: name, mobile number, delivery area, and detailed address; optional alternate phone, landmark, and notes. Use manager-configured area fees. Actual areas and prices can be supplied together as launch data.

### Q41: Online order operations

Who handles routine order stages, and should confirmed orders expire automatically?

Recommendation: the representative handles confirmation, shipment, delivery, failed delivery, and cancellation before shipment; the manager is backup and handles corrections. Confirmed orders do not expire automatically. Existing stock effects remain unchanged.

### Q42: Configured offers and coupons

How should configured offers combine with coupons?

Recommendation: one applicable automatic offer plus one eligible coupon by default, with manager-controlled eligibility, dates, usage limits, and combination settings. The employee can still add their own discount. Exact competing-offer, bundle, and coupon calculations follow this decision.

### Q43: Catalog configuration

How much pricing and sizing flexibility should catalog management provide?

Recommendation: one product price by default, with optional manager-set size/color price overrides; keep each variant's listed price consistent across both branches and the website. Categories, sizes, and colors are editable. Allow an optional size guide per product.

### Q44: Full stocktaking

Does version one need dedicated count sessions and count-comparison screens?

Recommendation: begin with the already-agreed manager stock adjustments; defer a full stocktaking module. This does not remove physical counting or its recorded quantity corrections.

### Q45: Receiving mistakes

How should the manager fix a saved receiving record with a wrong quantity or cost?

Recommendation: a linked correction retaining original values, reason, actor, and time; no deletion of receiving history. Reconcile its stock effect with intervening sales. The treatment of historical costs is a follow-up decision.

### Q46: Offline working rules

Which employee session and pricing rules should apply during an outage?

Recommendation: already-signed-in employees can complete sales using cached prices, still-valid cached offers, and their manual discounts. No fresh offline login initially. Account disablement takes effect on reconnection; preserve earlier completed sales. Session limits and recovery details follow the device/identity decisions.

### Q47: Counting around unsynchronized sales

How should a manager avoid adjusting quantities while tills still hold unsent sales?

Recommendation: synchronize known tills and briefly pause stock-changing work while finalizing the quantity correction. Preserve any late-arriving completed sale and flag discrepancies for manager reconciliation. This does not introduce per-branch inventory or permit discarding a completed sale.

### Q48: Sales and courier money in reports

What should the management dashboard count as online sales and money received?

Recommendation: completed physical sales and delivered online orders count as completed sales; pending/confirmed orders remain separately visible. Show COD money still owed by the courier separately from money received. Cost and profit formulas follow later.

### Q49: Manual backup

What should the manager be able to back up and restore?

Recommendation: a downloadable backup of business data and product images, with restoration restricted to the manager and preceded by a preview/confirmation. Account recovery, encryption, storage destination, and exact restore mechanics depend on the selected services.

### Q50: Devices

Which devices should we prioritize?

Recommendation: desktop/tablet POS, with the manager dashboard and public store also working well on phones. Record any additional device requirements. Exact browser support is part of the technical specification; no native app is added.

### Q51: Visual direction

What visual direction should guide the first designs?

Recommendation: a photography-led clothing storefront with a neutral palette, and a light, high-contrast dashboard/POS with large, clear controls. Existing logo/colors and other brand assets can be supplied together later.

### Q52: Website analytics

Which customer-activity measures should the initial analytics cover?

Recommendation: aggregate visits, product views, cart additions, submitted orders, and completed sales, without individual visitor profiles. Provider, privacy settings, metric definitions, and retention follow the technical choices. Existing manager-only reporting access remains.

### Q53: Opening data and rollout

How much history should we bring into the new system, and how should it launch?

Recommendation: import products, current quantities/costs, and operating configuration, with CSV support; keep old paper sales history outside the initial import. Launch internal operations first, then the public store after stock and workflows are verified. This is sequencing, not removal of accepted first-version features.

## Dependent follow-up groups

These groups are covered by accepted decisions and the concrete proposals in the [implementation blueprint](implementation-blueprint.md). No numbered questions remain. Final shared-understanding review still precedes production implementation; rejected average costs, tax/courier accounting, and a 30-day in-app returns flow are not reopened.

| Group | Remaining decisions | Main prerequisites |
| --- | --- | --- |
| F01 | Equal sharing, rounding, editable refund, exchange examples | Q62 answered; blueprint calculation examples |
| F02 | Online handover/fees | Outside the app under the Q48 correction; retain basic customer return/refund workflow |
| F03 | Offers/bundles/coupon usage and price history | Q56 accepted; implementation examples and pending-order exceptions in the draft |
| F04 | FIFO, valuation, receiving/late-movement corrections | Q63 answered; blueprint batch reconciliation examples |
| F05 | Merchandise profit, final order values, return periods, branch expenses | Q62-Q63 answered; blueprint formulas exclude tax/courier accounting |
| F06 | Accounts, recovery, offline/session and device behavior | Q59 accepted; concrete controls depend on runtime/identity choice |
| F07 | Runtime/database/identity, separate URLs, analytics/privacy, browser matrix | Research now; domain/hosting booking only after website completion |
| F08 | Encrypted data-only backup and safe restore | Q60 accepted; portable format/identity mechanics follow F07 |
| F09 | Returns/order exceptions and launch data | Dedicated 14-day Returns flow accepted; later defect cases external; draft remaining mechanics |
| F10 | First-slice acceptance, dependencies, cutover, final shared-understanding review | All 63 answered; concrete blueprint ready for review; no application implemented |

## Launch data to collect together

Do not turn each configurable value into its own approval question. Collect actual values as one worksheet/list when needed; do not invent production data.

- Categories/subcategories, sizes/colors, product codes/descriptions/photos, opening quantities and costs, listed prices, and any size guides.
- Employee names/accounts and authorized branches; assigned online representative and operating/confirmation hours.
- Fayoum delivery areas and fees, addresses, contact/WhatsApp numbers, and existing courier arrangements.
- Expense categories and initial promotion/coupon definitions once their rules are settled.
- Logo, brand colors/resources, social links, domain/hosting preferences, operating budget, and actual shop devices.

## Return-policy research reference

Checked 2026-09-08. The CPA gives a general 14-day ordinary-return period and 30-day defective-goods period, with exceptions and protections that must remain distinct. Ordinary-return exceptions include certain consumer-caused condition changes, made-to-spec goods, and opened underwear packaging; do not assume all clothing is excluded. These facts are not optional business restrictions.

For distance sales, [Law 181/2018, articles 39-41, official Economic Courts copy](https://elec.eecourts.gov.eg/assets/laws/16%20-%20%D9%82%D8%A7%D9%86%D9%88%D9%86%20%D8%AD%D9%85%D8%A7%D9%8A%D8%A9%20%D8%A7%D9%84%D9%85%D8%B3%D8%AA%D9%87%D9%84%D9%83.pdf) separately addresses withdrawal, return transport charges, and refund timing/method. This is historical research context. D42 and D49 settle the application boundary: 14-day Returns in the app, later defect cases and shipping-company arrangements externally through WhatsApp.
