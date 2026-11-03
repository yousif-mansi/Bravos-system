# BRAVOS

BRAVOS is a men's clothing business with physical branches in Abshway and Fayoum and a planned online store. These terms describe the business concepts established in the requirements brief.

## Language

**Branch inventory**:
The available quantities of products held by one BRAVOS retail branch, independent of the other branch and of the central warehouse. Online orders use an identified fulfillment branch rather than warehouse stock or a separate website balance.
_Avoid_: Shared central quantity, separate website stock

**Available stock**:
The quantity of a product still available for new sales or orders at one location. Every website option of that product draws on this same quantity. It excludes quantities already deducted for completed physical sales or confirmed online orders, including confirmed items still awaiting shipment.
_Avoid_: All merchandise physically present, size stock, color stock

**Stock deduction**:
A reduction in available stock for a completed physical sale or a confirmed online order.
_Avoid_: Shipment when referring to the online order's deduction point

**Branch**:
One of BRAVOS's two physical retail outlets: Abshway or Fayoum. Each branch holds its own stock and identifies its sales, employees, and expenses.
_Avoid_: Separate business, central warehouse

**Central warehouse**:
The physical location that receives new merchandise and supplies the two retail branches. It is not a retail branch and does not fulfill online orders.
_Avoid_: Branch, website stock

**Authorized branch**:
A branch the manager has permitted an employee to work in using that employee's personal account.
_Avoid_: Separate employee account per branch

**Active branch**:
The authorized branch selected for an employee's current work, supplying stock for their new physical sales and identifying their newly recorded branch expenses.
_Avoid_: Automatically changing the branch of an earlier completed sale

**Fulfillment branch**:
The branch selected by staff to supply every item in a confirmed online order.
_Avoid_: Combining stock from multiple branches for one order

**Receiving branch for a return**:
The branch that physically receives and inspects returned merchandise. Sellable returned units join its inventory while retaining their original purchase-cost provenance and sale attribution.
_Avoid_: Automatically restoring stock to the original selling branch

**Manager**:
The owner or authorized manager with access to the whole business, including private cost/profit information and all employees' branch sales and expenses.
_Avoid_: Cashier when referring to full management authority

**Cashier**:
An employee who completes physical sales in an authorized branch and can view their own sales. The cashier's role does not include access to purchase costs, profit figures, or inventory value.
_Avoid_: Manager

**Product**:
A clothing item offered by BRAVOS, identified by its product code, with one selling price and one stock quantity at each location.
_Avoid_: Variant when referring to the product as a whole

**Website option**:
A size and color choice shown to online customers for one product. It records the customer's choice and uses the product's shared stock.
_Avoid_: Separate stock balance, product variant when referring to a quantity

**Product variant**:
A historical size and color identity already stored for a product. New branch sales and new receiving do not ask for one.
_Avoid_: Separate product when referring only to a size or color combination

**Product code**:
The unique searchable code identifying a product and its sellable quantity.
_Avoid_: Barcode, variant code when referring to the product-level search code

**Physical sale**:
A completed sale in which a customer has received the merchandise and paid at a BRAVOS branch, using cash, a manually received wallet/InstaPay payment, or both. It is attributed to that branch and the employee who performed it.
_Avoid_: Online order

**Product barcode**:
A machine-readable representation of the existing product code, identifying the whole product. It does not identify a size/color variant.
_Avoid_: New product identifier, variant barcode

**Product label**:
A tag showing a product's existing code and barcode for identification. Printing additional copies does not create merchandise, record a sale or change stock.
_Avoid_: Sales receipt, individual-unit serial number

**Sales receipt**:
A customer-facing record of one completed branch sale, showing its purchased items, accepted amounts and identifying reference. Printing or reprinting it does not complete another sale.
_Avoid_: Online order acknowledgement, tax invoice

**Split payment**:
A physical sale paid partly in cash and partly through a manually received online transfer, with both amounts together covering the amount due.
_Avoid_: Partial payment, payment-provider settlement

**Sale correction**:
A manager's recorded correction or cancellation of an erroneous completed sale, linked to the original sale with a reason. It preserves the original history and reflects the merchandise and money that actually changed hands.
_Avoid_: Deleting a sale, customer return when referring to a recording error

**Customer return**:
A manager-handled return of merchandise from a completed physical sale or a delivered online order, linked to the original purchase.
_Avoid_: Sale correction, failed delivery

**Refund**:
Money owed back to a customer for a return, with the final amount determined by the manager. The original amount paid provides the suggested value; BRAVOS distinguishes an owed cash refund from one already paid and records merchandise receipt separately.
_Avoid_: Stock restoration, store credit

**Item paid value**:
The portion of a purchase's payment attributed to an item after discounts. For BRAVOS's agreed example, a 50 EGP discount shared equally between items priced at 300 and 200 gives paid values of 275 and 175; this value suggests a partial refund, which the manager may adjust.
_Avoid_: Undiscounted selling price, mandatory refund amount

**Exchange**:
A manager-handled replacement of merchandise from an original purchase with another item or variant, linked to that purchase.
_Avoid_: Editing the original sale, stock transfer

**Employee discount**:
A discretionary reduction whose amount is chosen by an employee for a physical sale, including on items with an existing offer. Its value and applying employee are recorded; an accompanying reason is optional.
_Avoid_: Catalog price change, configured promotion

**Branch expense**:
A business expense attributed to a branch and recorded by the manager or an employee, identifying its amount, date, category, and description.
_Avoid_: Stock receiving when referring to merchandise purchases, supplier purchase

**Supplier**:
A party from whom BRAVOS buys merchandise. A supplier identifies purchases and has no account balance.
_Avoid_: Creditor, vendor ledger

**Supplier purchase**:
One merchandise receipt and its cost, visible with its supplier and among expenses, without being deducted again as an operating expense.
_Avoid_: Branch expense, duplicate purchase

**Minimum selling price**:
The lowest price per unit a physical sale may accept for a product after every discount. It is one value for the whole product.
_Avoid_: Size minimum, hidden manager override

**Customer**:
A person identified by one full phone number who can be selected again at a physical sale. A sale may stay anonymous.
_Avoid_: Guest checkout account, name match

**Paid purchase**:
Merchandise the customer has paid for: a completed physical sale, or an online order that was delivered.
_Avoid_: Confirmed online order, pending order

**Online order**:
A customer's request to buy items through the online store using guest checkout and cash on delivery, handled by BRAVOS staff.
_Avoid_: Completed sale when an order has only been submitted

**Pending online order**:
A submitted online order awaiting the representative's decision and WhatsApp confirmation. It does not guarantee availability or take stock priority over physical sales.
_Avoid_: Confirmed order, reserved stock

**Requested quantity**:
The number of units of a variant the customer asks for in an order. A pending request does not set those units aside, so its requested quantity can differ from the available quantity later.
_Avoid_: Available quantity, reserved quantity

**Confirmed online order**:
An online order accepted through the representative's WhatsApp confirmation after its actual items have been located and set aside at the fulfillment branch. Confirmation recognizes its sales value and deducts that branch's available stock once.
_Avoid_: Pending request, completed delivery

**Reserved stock**:
Merchandise set aside for a confirmed online order and already excluded from available stock. It may still be physically at BRAVOS while awaiting shipment.
_Avoid_: Sold stock, dispatched stock

**Shipped online order**:
An online order whose merchandise has been handed to the delivery provider. Its quantities were already deducted at confirmation.
_Avoid_: Delivered order

**Delivery failed / Awaiting return**:
An unsuccessful delivery whose sales value has been reversed but whose merchandise has not yet been physically received and inspected by BRAVOS. Its quantities remain unavailable for another sale.
_Avoid_: Customer return after a completed delivery, restored stock

**Cancelled order awaiting inspection**:
A cancelled confirmed order whose sales value has been reversed while its merchandise remains unavailable until staff inspect it.
_Avoid_: Automatically restored stock

**Out-of-stock product**:
A publicly listed product whose shared retail quantity is zero. It remains visible for browsing with an Out of Stock label and cannot be ordered. A size or color stays selectable while that shared quantity is above zero.
_Avoid_: A size that is out of stock on its own

**Coming Soon product**:
A product shown on the public website as a preview, with online ordering disabled. This website status does not by itself prevent an authorized physical sale of available merchandise.
_Avoid_: Hidden product

**Hidden product**:
A product excluded from the public store. This website status does not by itself prevent an authorized physical sale of available merchandise.
_Avoid_: Out-of-stock product

**Low-stock product**:
A product whose available quantity at a retail branch is at or below its configured alert threshold.
_Avoid_: Out-of-stock product when a positive quantity remains

**Stock adjustment**:
A manager's correction of a product's recorded available quantity at a branch after verifying a discrepancy, attributed to that manager and accompanied by a reason.
_Avoid_: Stock receiving, sale cancellation

**Order representative**:
The assigned employee responsible for checking online orders and confirming them with customers through WhatsApp, with the manager as backup.
_Avoid_: Automated confirmation when referring to the representative's decision

**Stock receiving**:
The receipt of purchased merchandise into the central warehouse.
_Avoid_: Branch transfer, website fulfillment

**Stock transfer**:
A manager's record that goods moved from one location to another at the physical handover.
_Avoid_: Dispatch, goods in transit

**Stock batch**:
A group of received units of one product with its own purchase cost and separately tracked remaining quantities at each location. Moving or returning units keeps that original cost.
_Avoid_: Average cost, separate public product

**First in, first out (FIFO)**:
The allocation of sold or confirmed-order units from the oldest available stock batch of that product at the supplying location before newer batches. Sellable returns retain the original allocated batch costs at the branch receiving them.
_Avoid_: Average cost, newest batch first

**Cost price**:
The internal purchase cost retained for a stock batch, visible only to the owner/manager. Receiving units at a new cost does not average or replace the cost of existing batches.
_Avoid_: Selling price

**Selling price**:
The listed price of a product, the same for every size and color, both retail branches, and the website.
_Avoid_: Cost price, size price, color price
