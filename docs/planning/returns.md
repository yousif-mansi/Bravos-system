# BRAVOS Returns section

Updated: 2026-09-08

This document makes the user's requested Returns workflow concrete. It records accepted behavior from Q28, Q35-Q39, Q54-Q55, Q62-Q63 and the dedicated-Returns instruction, including later corrections. It is not an implemented screen. See [discovery.md](discovery.md) for source decisions and the [implementation blueprint](implementation-blueprint.md) for proposed technical details awaiting final review.

## Placement and access

Returns is a dedicated section of the authenticated internal application, under the separate internal URL. It has its own list and detail view. The normal POS checkout stays focused on completing new sales; return entry and processing happen in Returns.

The manager operates returns/exchanges. The transaction picker can access original physical sales from either branch and delivered online purchases under that manager's existing permissions. Ordinary employee sales visibility is not broadened.

## Accepted flow

1. Open Returns and start a new return.
2. Choose an original transaction from the transactions list. Search by reference, date, branch, products, or amount if needed; customer phone is not mandatory for physical purchases.
3. Load its recorded details: reference, original branch/channel, date, employee, items/variants, quantities, prices, applied discounts, final amount, and any recorded customer details. The original transaction remains unchanged.
4. Select the items and quantities being returned. Show earlier returned quantities and prevent returning more than the unreturned purchased quantity.
5. Record physical receipt/inspection and distinguish quantities that are sellable from those that must remain unavailable. Restore sellable quantities once; no separate damaged-stock module is introduced.
6. Suggest the original paid value and let the manager edit the final refund amount. Record the cash refund as Owed or Paid, including the authorized amount, amount actually paid back, and responsible manager; record the actual payment date when paid. A full refund of a purchase paid at 850 is 850. For items priced at 300 and 200 with a shared 50 discount, the agreed equal split suggests 275 or 175 when one item is returned. Do not deduct the discount again. Shipping-company dealings/handover accounting remain outside the app.
7. Save a separate return linked to the original transaction. Keep the return's details, handling branch, stock effect, and refund record available from Returns. Applying or retrying the same return must not duplicate stock restoration or refund records.

The precise UI layout is a design task. These steps express business dependencies, not an extra approval queue or a requirement for seven separate screens.

## Branch and reporting behavior

A purchase may be returned/exchanged at either physical branch, including a delivered online purchase. Record the branch handling the return and retain the original transaction's branch/channel for attribution. Do not move the original sale into another branch or merge a return into an ordinary new-sale record.

Return merchandise and refund payment are distinct facts: a return can be received while cash is still owed. Unsellable items remain out of available stock. A data-entry correction, a failed-delivery parcel, and a customer return remain distinct operations.

Accepted exchanges credit the manager's final authorized return value toward the replacement's current price after offers. Collect a positive difference or owe/pay a negative difference in cash, without a standing store-credit balance. A value of 280 against replacement 320 collects 40; against replacement 200 it refunds 80. Replacement quantities still obey central availability and protected-stock exclusions and receive a new FIFO allocation; sellable returned units restore to their original batches separately.

## Accepted window and external handling

The in-system return window is 14 days from customer receipt, using physical-sale completion or online delivery as the start. The user will handle defective-item cases beyond 14 days outside the system through WhatsApp. Do not add a separate 30-day in-app flow or claim that this application limit ends statutory rights.

Customers may use branch drop-off or arrange a courier externally through WhatsApp. Do not add courier fee, settlement, or handover ledgers. A WhatsApp conversation itself does not create a stock/refund record automatically.

## Cost batches

Retain distinct purchase-cost batches for old- and new-cost merchandise. Q63 accepts oldest available batch first (FIFO). Restore sellable returned units to the original allocated batches, preserving their purchase costs and the link to the original sale. Do not average returned merchandise into a blended purchase cost.

## Proposed details for final review

Q62 and Q63 are answered. The blueprint proposes deterministic equal allocation across sold units, small-price/rounding handling, and exchange examples. These extend the confirmed two-item example and are explicitly proposed details rather than additional accepted answers.

The manager's editable amount is the actual authorized refund; retain the suggestion separately and use the actual recorded refund in reports. Do not add a new amount cap, approval queue, or mandatory override reason. Original transaction values remain unchanged.

The blueprint also proposes optional notes, linked corrections after stock/money movement, and draft/received refund states. Initial returns remain online, outside the agreed offline POS scope.

The reviewed specification proposes distinguishing immediate exchange credit from actual cash payment, so credit already used for a replacement cannot remain as cash still owed. It also proposes a zero suggestion for a free reward unit's recorded zero paid value, preserving manager editing and the original paid values of retained items. These details do not create a permanent store-credit account or a new refund cap.
