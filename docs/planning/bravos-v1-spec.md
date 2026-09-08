# BRAVOS v1: Central inventory, branch POS, management and online store

Status: approved for local implementation on 2026-09-08 after the Grok review and corrections. The user's instruction to complete planning and get started accepts the implementation decisions, operational defaults and testing boundaries below. No application tests had run at approval. Domain/hosting booking remains deferred until website completion.

Reading guide: the [implementation decisions](#implementation-decisions) carry forward the reviewed stack, calculation and recovery choices; the [testing decisions](#testing-decisions) use the API with a real database plus focused browser coverage. Recommendation/proposal wording retained below records the decisions' review origin; those choices are now accepted, subject to the stated implementation verification gates.

## Problem Statement

BRAVOS sells men's clothing through its Abshway and Fayoum branches and is preparing an online store. Paper records and manual stock tracking make it difficult to know current availability, separate each branch's performance, identify who performed an operation, and calculate profit using the merchandise's actual purchase costs.

Both branches and the website must use one central inventory. Physical cash sales must remain completed when internet access is unavailable, while online requests are checked and confirmed later through WhatsApp. The system must preserve these different workflows without losing completed sales, deducting stock twice, exposing private costs, or cluttering checkout with returns and administrative work.

## Solution

Deliver an Arabic system with a separately addressed authenticated staff application and a branded public store, sharing the same business backend and central inventory. Staff receive merchandise into separate purchase-cost batches, complete cash sales, process online requests, handle returns in a dedicated section, record expenses and view authorized reports. Customers browse products, select stocked variants and submit guest cash-on-delivery requests for representative confirmation.

Preserve original transactions and record corrections, returns, stock movements and responsible users explicitly. Allocate merchandise from the oldest available cost batch first and restore sellable returns to their original batches. Prepare local persistence and duplicate-safe synchronization from the beginning, with a complete offline cash-sale workflow delivered before its operational rollout. Build and verify locally; domain and hosting booking follow website completion.

## User Stories

### Staff, branches and permissions

1. As the owner, I want one dashboard covering Abshway and Fayoum, so that I can manage the whole business while separating each branch's activity.
2. As the manager, I want to create a personal login name and password for each employee, so that work is attributed to its actual operator.
3. As the manager, I want to reset staff passwords and disable accounts, so that I can manage access without shared credentials.
4. As the owner, I want a separate account-recovery route, so that losing access to my account does not lock the business out permanently.
5. As the manager, I want to assign each employee one or more authorized branches, so that one personal account supports permitted work across branches.
6. As an employee, I want to select an authorized active branch and see it clearly, so that my sales and expenses are attributed correctly.
7. As an employee, I want to view my own sales and expenses in my authorized branch context, so that I can check my work.
8. As the manager, I want to view every employee's sales and expenses, so that I can oversee both branches.
9. As the manager, I want purchase costs, profit and inventory value restricted to management, so that staff and customers receive only the data their work requires.
10. As the manager, I want important operations to retain their responsible user and time, so that I can understand changes without needing a separate enterprise audit-log interface.

### Catalog and central inventory

11. As the manager, I want to maintain product names, unique product codes, descriptions and images, so that merchandise is recognizable to staff and customers.
12. As the manager, I want editable categories and subcategories, so that the catalog follows BRAVOS's merchandise organization.
13. As the manager, I want editable sizes and colors with explicit product variants, so that each sellable combination has its own quantity.
14. As the manager, I want one default selling price per product with optional variant overrides, so that pricing supports real product differences.
15. As the manager, I want the same listed variant price across both branches and the website, so that catalog pricing is consistent.
16. As the manager, I want an optional product size guide, so that I can help customers choose sizes where useful.
17. As the manager, I want to choose Available, Coming Soon or Hidden publication behavior, so that I control what appears in the public catalog.
18. As a customer, I want out-of-stock products to remain browsable with the label on their product pages, so that I can still inspect their details.
19. As a customer, I want only available sizes and colors to be orderable, so that another stocked variant does not imply my selected variant is available.
20. As a cashier, I want permitted sales of available merchandise to remain possible regardless of its website visibility setting, so that publication status does not prevent legitimate store work.
21. As the manager, I want both branches and online orders to consume one central variant balance, so that there are no independently maintained branch or website inventories.
22. As the manager, I want to receive variants with quantities, purchase costs and receipt dates online, so that new merchandise increases central stock with traceable costs.
23. As the manager, I want new-cost units to remain separate from old-cost units, so that receiving merchandise never averages or overwrites older costs.
24. As the manager, I want sales and confirmed orders to allocate from the oldest available purchase-cost batch first, so that costs follow the agreed FIFO method.
25. As a cashier, I want total available quantities and selling prices without private batch costs, so that I can sell efficiently within my permissions.
26. As the manager, I want linked corrections to receiving records that retain original details, reason, actor and time, so that mistakes can be reconciled without deleting history.
27. As the manager, I want to correct available quantities online after verifying a discrepancy, so that recorded stock reflects actual sellable merchandise.
28. As the manager, I want known tills synchronized and stock-changing work briefly paused before finalizing a quantity correction, while excluding confirmed set-aside items and preserving late sales for reconciliation, so that correction does not free reserved stock or apply a movement twice.
29. As the manager, I want a low-stock alert at three available units or fewer by default, so that I can identify variants needing attention.
30. As the manager, I want configurable global and per-variant low-stock thresholds, so that alert levels fit different products.

### Physical sales and employee discounts

31. As a cashier, I want to find a product using its unique code and select its size and color, so that checkout records the correct variant.
32. As a cashier, I want to edit cart items and quantities before completion, so that I can match the merchandise the customer is buying.
33. As a cashier, I want quantity validation across all lines for each variant, so that repeated lines cannot exceed known stock.
34. As a cashier, I want to complete a cash sale when the customer has received the merchandise and paid, so that the recorded completion matches the real sale.
35. As a cashier, I want customer name and phone to be optional for physical sales, so that walk-in checkout does not require invented customer information.
36. As a cashier, I want to choose an EGP deduction after configured offers and any eligible coupon, so that I can apply the discount I agreed with the customer.
37. As a cashier, I want that deduction to work on promotional merchandise without an amount cap or approval queue, so that my accepted discount permission is usable.
38. As a cashier, I want an optional discount reason and validation that permits zero but rejects negative totals, so that the amount is recorded without unnecessary obstacles.
39. As the manager, I want sale details and reports to identify employee discounts alongside original, discount and final amounts, so that I can see who reduced a sale.
40. As the manager, I want each completed sale to retain its branch, employee, time, variants, quantities, prices and discounts, so that reporting has a reliable source.
41. As the manager, I want authorized linked corrections or cancellations of erroneous completed sales that reflect whether merchandise and cash actually moved, so that cancelling a record alone does not imply goods were returned or cash was refunded.
42. As a cashier, I want retrying a completed submission to return the existing sale, so that a double click or lost response does not create another sale or stock deduction.

### Offline cash sales and recovery

43. As an already signed-in cashier, I want cached product lookup, cart editing and cash-sale completion during an outage, so that physical selling can continue.
44. As an already signed-in cashier, I want to use cached prices, still-valid cached offers and manual discounts, so that checkout remains useful without connectivity.
45. As a cashier, I want completed offline sales to be stored durably with my identity and branch, so that reconnecting does not turn a finished sale into an unapproved draft.
46. As a cashier, I want a visible unsynchronized-sale count and retry on reconnection, so that I can tell which completed work still needs to reach the server.
47. As a cashier, I want queued completed sales preserved across restart, logout and application updates, so that routine device use does not erase business records.
48. As the manager, I want completed offline sales retained when central stock has changed, so that a discrepancy can be resolved without deleting a sale that actually happened.
49. As the manager, I want reconnected devices to apply current access restrictions while preserving prior completed sales, so that revocation and recovery do not conflict.
50. As a customer, I want the website to use the latest synchronized availability, so that its quantity controls reflect all stock information currently known to the system.

### Public store and guest checkout

51. As a customer, I want an Arabic branded clothing storefront with product photography, so that I can browse BRAVOS's merchandise clearly.
52. As a customer, I want product search and category browsing, so that I can find relevant merchandise.
53. As a customer, I want product descriptions, images, prices, sizes and colors, so that I can choose the actual variant I want.
54. As a customer, I want to add products to a cart and adjust quantities within known availability, so that I can prepare a valid order.
55. As a customer, I want the submitted cart rechecked against current availability, so that an old cart cannot knowingly order three units when only two remain.
56. As a customer, I want checkout without creating an account and payment by cash on delivery, so that ordering follows BRAVOS's accepted process.
57. As a customer, I want checkout to request my name, primary mobile, delivery area and detailed address, so that staff can contact me and arrange delivery.
58. As a customer, I want alternate phone, landmark and notes to be optional, so that I can add helpful details without being forced to supply them.
59. As a customer, I want to see the configured fee for my Fayoum delivery area and the final order value, so that I understand the amount requested.
60. As a customer, I want WhatsApp contact and social links, so that I can communicate with BRAVOS using its existing channels.
61. As a customer, I want a clear order-submission result, so that I know my request awaits staff confirmation.
62. As the manager, I want public and internal applications at separate entry URLs, so that customers encounter the storefront and staff use authenticated business screens.

### Online order operations

63. As the representative, I want submitted guest orders in the internal application with customer and item details, so that I can handle them through WhatsApp.
64. As a cashier, I want pending online requests to hold no stock, so that unconfirmed requests do not block physical sales.
65. As the representative, I want to verify and physically set aside available merchandise before WhatsApp confirmation, so that a confirmed order is protected from further sales.
66. As the representative, I want to record the actual items and quantities agreed with the customer after a shortage, so that I do not silently substitute or confirm unavailable merchandise.
67. As the representative, I want confirmation to deduct available stock automatically once, so that stock changes at the agreed confirmation point.
68. As the representative, I want shipment and delivery to update order progress without further stock deductions, so that fulfillment does not reduce stock again.
69. As the representative, I want to cancel pending or confirmed orders before shipment according to the accepted workflow, so that only a prior allocation is released.
70. As the representative, I want failed deliveries to remain unavailable until physically returned and inspected, so that items still with a courier cannot be resold.
71. As the representative, I want contact attempts recorded and manual unreachable-customer cancellation after the configured wait and minimum attempts, so that follow-up is traceable.
72. As the representative, I want confirmed orders to remain confirmed until an explicit next action, so that they do not expire automatically.
73. As the manager, I want to act as the representative's backup and correct exceptional order mistakes, so that order handling can continue when needed.
74. As the manager, I want Delivered orders and their final values in completed-order reports, so that reporting excludes requests still awaiting completion.

### Dedicated Returns and exchanges

75. As the manager, I want a dedicated Returns section with its own list and details, requiring a connection initially, so that returns do not clutter normal POS checkout.
76. As the manager, I want to select the original purchase from a transaction list and load its details, so that a return is linked to what was actually sold.
77. As the manager, I want to find purchases by reference or verified date, branch, items and amount, so that a missing physical-sale phone number does not prevent lookup.
78. As the manager, I want to process physical and delivered online returns at either branch, so that the handling branch can differ from the original sale's branch or channel.
79. As the manager, I want the original sale preserved and the return linked separately, so that its attribution and original values remain available.
80. As the manager, I want partial returned quantities limited to units not previously returned, so that the same purchased unit cannot be returned twice.
81. As the manager, I want a 14-day in-system window from customer receipt, so that the app follows the agreed return scope while later defect cases stay external through WhatsApp.
82. As the manager, I want to record physical receipt and inspection, so that only sellable returned quantities re-enter available inventory.
83. As the manager, I want sellable returns restored to their original allocated cost batches once, so that returned merchandise retains its original purchase cost.
84. As the manager, I want a full refund suggestion to use the amount actually paid, so that a purchase paid at 850 suggests 850 without another discount deduction.
85. As the manager, I want a 50 discount shared equally between products priced at 300 and 200, so that their suggested partial-refund values are 275 and 175.
86. As the manager, I want to edit the final refund amount while retaining the suggestion, so that the recorded refund reflects my actual decision.
87. As the manager, I want cash refunds recorded as Owed or Paid with amounts, responsible manager and payment date, so that receipt of goods is separate from payment of money.
88. As the manager, I want an exchange to credit my final authorized return amount against the replacement's current price after offers, collecting or refunding the cash difference, so that the original purchase remains traceable without a permanent store-credit balance.

### Expenses, reporting and analytics

89. As an employee or manager, I want to record a branch expense online with amount, date, category and description, so that ordinary operating costs are captured.
90. As an employee, I want my expenses attributed to my active authorized branch and account, so that their ownership is clear.
91. As the manager, I want saved expenses included in reports immediately, so that reporting does not depend on an approval queue.
92. As the manager, I want linked corrections or cancellations of saved expenses, so that original details remain available and totals change once.
93. As the manager, I want current-day, daily and calendar-month sales views with branch separation, so that I can assess performance at useful periods.
94. As the manager, I want purchase, expense, best-selling-product and low-stock reports, so that I can manage daily operations.
95. As the manager, I want inventory value and merchandise profit based on retained batch costs, so that newer purchase prices do not replace older costs.
96. As the manager, I want operating-profit information after branch expenses, so that I can understand merchandise performance without a tax or courier accounting subsystem.
97. As the manager, I want actual recorded refunds reflected in their processing period with original-sale links, so that refund decisions and historical sales remain understandable.
98. As the manager, I want report exports to PDF and Excel, so that I can retain and share relevant business reports.
99. As the manager, I want aggregate visits, product views, cart additions, submitted orders and completed sales, so that I can assess the store without individual visitor profiles.

### Backup, opening data and rollout

100. As the manager, I want a password-protected manual business-data backup that I can save outside the browser, so that I retain a recoverable copy of the important data.
101. As the manager, I want the required backup to work without image binaries, so that the data backup remains focused on business records.
102. As the manager, I want restore preview and confirmation after reconciling queued or newer work, so that restoration does not silently overwrite activity.
103. As the manager, I want CSV-supported opening products, quantities, cost batches and configuration, so that I can begin with current records rather than importing old paper sales history.
104. As a cashier, I want a clear high-contrast desktop/tablet POS, so that normal checkout is easy to operate.
105. As the manager or a customer, I want usable Arabic management/storefront views on phones, so that browser access supports everyday devices.
106. As the owner, I want the website completed before domain and hosting are booked, so that development follows the agreed purchase timing.
107. As the owner, I want internal operations launched before public ordering is enabled after verification, so that opening stock and workflows are checked before customers order online.

### Promotion administration and delivery settings

108. As the manager, I want to create, edit and activate percentage or fixed-amount offers for selected products, categories and seasonal dates, so that campaigns follow configurable business rules.
109. As the manager, I want to define bundle contents, quantities and prices and Buy-X-Get-Y eligibility/rewards, so that the agreed promotion types work consistently.
110. As the manager, I want to maintain coupon codes, eligibility, dates, usage limits and combination settings, so that offers and coupons can be controlled without a software release.
111. As a cashier or customer, I want to apply an eligible coupon to the current basket, so that its reduction is shown before cash-sale completion or order submission.
112. As a cashier or customer, I want the greatest-saving eligible automatic offer followed by the eligible coupon, so that configured reductions are applied consistently before any additional employee POS deduction.
113. As the manager, I want coupon usage recorded at POS completion or online confirmation and released once for cancelled undelivered orders, so that retries and cancellations do not corrupt usage limits.
114. As the manager, I want to maintain supported Fayoum delivery areas and fees used by checkout validation and totals, so that the actual area list and charges remain editable operating data.

## Implementation Decisions

### Confirmed architecture and ownership constraints

- Use Clean Architecture: business rules and application use cases remain independent of UI frameworks, persistence libraries and transport implementations. External adapters depend inward and are wired at application entry points.
- Organize by business capability with intentional public interfaces. Prevent cross-feature private imports, direct writes to another feature's owned data and dependency cycles through automated checks. Use aliases and focused exports without a project-wide import that includes every feature.
- Maintain separate public and authenticated internal builds and entry URLs, one backend and one logical inventory. Server authorization and role-filtered data apply to responses, exports and caches. Public code must not contain internal screens or privileged modules.
- Prepare durable local cash-sale records and duplicate-safe synchronization at the foundation. Code splitting must keep heavy optional features out of the initial POS load while caching the entire essential offline checkout path. Module Federation is deferred until a concrete independent-release need arises.
- Keep categories, prices, delivery fees, low-stock thresholds and promotion configuration editable instead of embedding operating data in application logic.

### Accepted stack and feature contracts

Use a TypeScript/pnpm workspace, a Next.js public storefront, a React/Vite internal PWA, a Fastify API, PostgreSQL with the standard PostgreSQL driver and versioned migrations, and Dexie/IndexedDB for local POS data. This is the researched recommendation from the blueprint, not a hosting purchase or a claim that dependencies have already been verified together.

The API is a single deployable application initially. Public and internal frontend gateways route to the same use cases while exposing only permitted operations. Use same-origin browser gateways and verify secure session cookies, trusted origins and CSRF handling with the identity integration. Select maintained compatible dependency versions during foundation work; a local database instance still needs verification.

| Feature | Ownership and public contract |
| --- | --- |
| Catalog | Maintain product/variant/category/image/publication data and provide role-filtered catalog views; availability is obtained through Inventory. |
| Pricing | Maintain listed prices and promotion/coupon rules; evaluate a basket and produce a retained price/discount breakdown. |
| Inventory | Own central variant availability, batches, allocations, movements and discrepancies; expose allocate, release, restore and adjust operations. |
| Receiving | Own receipt records and linked corrections; coordinate batch creation and stock effects through Inventory. |
| Physical sales | Own completed cash sales and recording corrections; coordinate pricing, stock and attribution through declared interfaces. |
| Online orders | Own guest requests, customer delivery details, contact attempts and order transitions; coordinate confirmation allocations and coupon use. |
| Returns | Own original-purchase selection, returned quantities, inspection, refunds and exchanges; coordinate original-batch restoration and linked replacement sales. |
| Expenses | Own branch expense records and their effective values after linked manager corrections. |
| Identity/access | Own staff provisioning, identity mapping, sessions and role/branch grants; authorize business operations at their boundary. |
| Reporting/operations | Provide authorized read models, exports, aggregate analytics, opening import and coherent backup/restore coordination. |

A use-case transaction coordinator lets feature operations share one database transaction without bypassing feature ownership. Share only small common primitives and explicitly safe contracts; do not share private cost models with browser bundles. Product image storage is an adapter, local during development and selected for persistent hosting later.

### Records and atomic operation contracts

Retain stable identifiers for staff/branch grants, products and variants, receipts and cost batches, physical sales and lines, online orders and lines, stock allocations and movements, returns/refunds/exchanges, expenses, offers/coupons/usages, delivery settings and linked corrections. Record both original values and effective linked changes. Do not use a current catalog row as the historical transaction's price or cost source.

Each stock-changing command carries a stable operation identity and validated business inputs. The proposed common command envelope records operation/device identity, authorized actor/branch context, claimed occurrence time and a payload fingerprint; the server independently records receipt time. Actor/branch fields supplied by a browser are not proof of permission.

| Business operation | Required observable result |
| --- | --- |
| Finalize receiving | Manager-only and online; receipt/batches/movements increase central availability together. |
| Complete physical sale | Preserve a final cash sale with original prices/discounts and staff/branch attribution; apply its stock effect once, including later offline synchronization. |
| Submit online request | Validate selected variant quantities and required checkout data; alternate phone, landmark and notes remain optional in API validation as in the UI. Create a pending request with no allocation or stock deduction. |
| Confirm online order | Require the assigned representative grant or manager backup; confirm the WhatsApp-agreed basket after physical set-aside, revalidate availability, allocate FIFO and deduct once with accepted prices and coupon usage. Ordinary cashier/expense permissions do not authorize confirmation or routine order transitions. |
| Ship or deliver | Apply a permitted stage change; never deduct availability a second time. Delivered is the completed-order reporting event. |
| Cancel before shipment | Cancel once; release a confirmed allocation and eligible coupon usage once; an unconfirmed cancellation restores nothing. |
| Receive failed parcel | Require physical receipt/inspection; restore only sellable quantities from its retained allocations once. Proposed final posting is manager-authorized, with staff able to record receipt/inspection information. |
| Post customer return | Manager-only online; validate original purchase, time window and cumulative quantities; record inspection/refund and restore sellable original-batch quantities once. |
| Complete exchange | Manager-only online; record the linked return and replacement, check replacement quantities against available stock excluding protected allocations, allocate FIFO and settle the cash difference once. Returned sellable units restore their original batches through a distinct movement. |
| Correct a saved record | Manager-only linked change with original details, required correction reason and actor/time. Derive any reversal from the recording error and actual merchandise/cash movements; cancellation itself is not proof of returned goods or a cash refund. Customer returns stay in Returns. |
| Add expense | Manager or employee in an authorized branch; save once with attribution and immediate reporting effect. |

Use database uniqueness, foreign-key and nonnegative available-batch constraints, plus deliberate locking/concurrency control. The operation receipt, business record, allocations, movements and coupon effects commit together. Retry transient conflicts safely; a repeated accepted operation returns the original result and a reused identity with changed contents produces a reviewable error. Do not split one business confirmation into independently committed feature updates.

### Catalog, quantity and price rules

One product code identifies the product; the operator/customer selects the size/color variant. Aggregate repeated basket lines for quantity validation. Known available quantity two cannot permit three, even if separate rows individually look valid. Physical coordination and actual possession precede a branch sale; the central stock model does not introduce location transfers.

Available stock excludes completed cash sales and confirmed online allocations, including merchandise set aside or awaiting shipment. An otherwise public product becomes Out of Stock when every sellable variant is unavailable; its page/listing remain visible and ordering is disabled. Coming Soon previews without ordering; Hidden excludes from the public store. Those publication choices alone do not block an authorized POS sale of available merchandise.

Use one listed variant price across both branches and online, with a product default and optional manager variant override. Store accepted transaction values so later catalog/promotion edits cannot rewrite a completed sale or confirmed order.

### Discounts, promotions and partial paid values

Confirmed calculation order: greatest-saving eligible automatic offer under manager combination settings, then eligible coupon, then any employee POS deduction. Default to one automatic offer and one eligible coupon. Support percentage/fixed discounts, selected products/categories, seasonal dates, fixed-content bundles, Buy-X-Get-Y using cheapest eligible reward units, and coupon codes. Manage rules online as the manager; staff cannot create or activate promotions.

An employee chooses the EGP deduction without an amount/percentage/margin cap or amount-based approval, including on promotional merchandise. Preserve offer and employee effects separately. The discount reason is optional; zero total is valid and a negative total is invalid. Coupon use counts at physical completion or online confirmation and is released once for cancelled undelivered orders. Dates use Cairo time.

The accepted mixed-purchase example is 300 + 200 with 50 off: allocate 25 to each and retain paid values 275 and 175. Proportional values 270/180 are superseded.

Recommended generalization for final review:

- Store money as integer piasters and persist per-unit paid-value allocation at transaction acceptance.
- Share basket-wide fixed deductions equally across eligible sold units, independent of the number of displayed cart rows. Cap a unit's allocated reduction at its remaining price and redistribute any excess among units with value remaining.
- Merge repeated identical variant rows and use stable variant/unit order for leftover piasters; the allocated discount must exactly equal the accepted deduction.
- Attach item-specific offers to affected units; calculate percentage reductions against affected prices with exact-total rounding. Allocate fixed-bundle savings and fixed basket coupons with the same equal/capped rule over their eligible units.
- Example: two units at 300 and one at 200 with 60 off become 280, 280 and 180. Units at 10 and 100 with 50 off become 0 and 60. One EGP split among three eligible units becomes 0.34, 0.33 and 0.33 in stable order.
- Offline use validates cached eligibility/dates and locally known usage. If later synchronization reveals a global coupon overuse, preserve the already completed cash sale and price while recording the discrepancy for management; connected confirmation still enforces central usage atomically.

Two promotion edge cases remain explicit proposals for the existing final review:

- Propose a manager-authorized terminal cancellation of an undelivered failed order after receipt/inspection, releasing its consumed coupon usage once. This is an explicit failed-order closure, not permission for ordinary pre-shipment cancellation while a parcel is still in transit. Failure or stock restoration alone does not release usage. A pending request consumed nothing; a Delivered customer return does not release usage under this proposed default. Any later choice to release on Delivered returns would be a separate business-policy change.
- Persist reward-unit paid values with the accepted price breakdown. A genuinely free reward unit suggests a zero refund, while a discounted reward suggests its stored paid value. Zero paid value does not prevent an otherwise valid return, and the manager may still edit the refund. Do not reprice retained sibling units when only the reward is returned.

### FIFO, stock reconciliation and historical costs

Keep each receipt's cost and available quantity separate. FIFO is accepted; propose receipt time followed by stable batch identity as the deterministic tie-breaker. Ten units costing 100 plus ten costing 140 remain distinct. Selling three uses three cost-100 units, leaving seven old and ten new; a sellable one-unit return restores one to the original cost-100 batch.

Online confirmation allocates the batches used later for Delivered cost reporting. Cancelling releases those allocations; failed-parcel receipt restores only inspected sellable quantities. Sellable customer returns restore their original sale allocations without blending into a new cost.

The coordinated count policy is already accepted: synchronize known tills and briefly pause stock-changing work before the manager finalizes a quantity correction, preserve late completed sales and flag discrepancies. The mechanics below implement that accepted policy; the pause itself is not a new optional proposal.

Recommended reconciliation details for final review:

- For indistinguishable returned units from a purchase spanning batches, consume that purchase's earliest remaining unreturned allocation. Never substitute the current receipt cost.
- Receiving cost corrections retain the original cost and apply an explicit linked effective-cost adjustment to remaining/allocated quantities. Quantity corrections account for intervening sales; they do not overwrite consumed history.
- Carry those linked adjustments through a later return: an original allocated cost of 100 explicitly corrected to 140 must restore effective batch value and reverse effective sale cost of 140, retaining the original 100 and linked 40 adjustment. It must not leave 40 charged to a fully returned sellable unit. A new receipt at 140 by itself does not correct or reprice the older batch.
- Record the count boundary and device acknowledgements for the accepted synchronization/pause policy. A server cannot force a disconnected cashier to observe the pause.
- A late completed sale is retained. Allocate available FIFO units without consuming a protected confirmed-order allocation; preserve any unallocated remainder for manager reconciliation. Identify cost/profit as incomplete while unresolved, keep affected availability from being offered prematurely, and reconcile the actual missing receipt/count/movement before releasing more stock.
- A late sale already reflected in a physical count must not reduce the corrected balance again. Preserve occurrence, synchronization and count-boundary information so the manager can resolve this explicitly.
- Positive corrections identify an actual batch/cost source. Never manufacture zero or average cost to make a discrepancy disappear.

### Offline persistence and synchronization

Accepted first offline scope is cached lookup, cart editing and completed cash sales for an already signed-in employee. Receiving, stock/price/permission changes, expenses, customer returns and online-order confirmation require connectivity initially. Business completion and synchronization status are separate facts.

Recommended mechanics for final review:

- Commit the sale, lines and outbox entry in one local transaction before displaying it as saved. Keep network calls outside this transaction. If persistence fails, do not falsely report success; preserve recovery information without claiming that exchanged goods/cash were reversed.
- Cache required POS code/assets and role-appropriate catalog/pricing data before enabling offline use. Request persistent browser storage where available and surface unsynchronized work clearly; no recovery promise covers data physically erased before synchronization.
- Retry at startup/reconnection and through a manual action. Background browser synchronization is optional; browser closure cannot guarantee request delivery.
- Return acknowledged operation identities and an associated stock snapshot/version. Rebase remaining unsynchronized effects atomically against that snapshot so acknowledging a sale cannot deduct it twice or temporarily make its item available again.
- Coordinate tabs on the same device. Preserve queues through logout, account switching and versioned application/storage migrations; defer an update if safe migration cannot be established.
- Continue the previously authenticated local identity until sign-out during an outage, without fresh offline login. On reconnection revalidate identity and branch/role grants. A revoked identity cannot start new connected work; existing completed records remain available for manager-assisted recovery. An expired session requires reauthentication or recovery without losing its queue.
- Keep restricted cost/profit views online-only initially. A new account on a shared device cannot see the previous account's records, even while its queued sales remain preserved. Do not accept a client timestamp as sole proof of authorization before revocation.

### Staff identity and data security

The accepted staff-facing experience is manager-created login name/password, manager staff resets and separate owner recovery. Proposed provider is Better Auth with PostgreSQL, username and admin plugins behind an identity adapter. Its account creation requires an email-shaped value; the proposed adapter generates an immutable internal identifier under a reserved non-deliverable domain, so employees do not need personal email addresses.

Use library-managed password hashing and sessions, disable public signup and staff verification/mail routes for those internal identifiers, and configure separate owner recovery. Before relying on this adapter, prove provisioning with username normalization/uniqueness, Arabic display names, any configured Arabic login-name validation, manager reset without staff email, owner recovery and session revocation. Verify the chosen same-origin gateway/cookie configuration end to end. Do not expose service secrets or password data through catalog, employee or backup-facing business responses.

### Online order lifecycle and dedicated Returns

Accepted online stages are Pending/Awaiting confirmation, Confirmed, Shipped, Delivered, Cancelled before shipment, and Delivery failed/Awaiting return. Pending requests hold nothing. The representative locates and sets aside the actual merchandise before confirmation; confirmed merchandise is protected from both branches and online allocations.

Retain original requested details. Proposed pending-order revisions record the customer-agreed quantities/items/prices following WhatsApp contact and revalidate before confirmation; no silent substitutions or repricing of confirmed orders. The representative handles routine transitions with manager backup and manager-only corrections. Unreachable cancellation is manual after the configurable 48-hour default and at least two attempts, with a reason. Confirmed orders have no automatic expiry. Shipping-company accounting, fees owed/received and courier integration are outside the app.

Returns is a separate internal list/details workflow. The manager selects an original physical or Delivered online transaction, verifies the match and selects quantities not already returned. Record original branch/channel and return-handling branch separately. Receipt/inspection controls stock restoration; cash refund status does not itself restore stock. Apply the 14-day window from physical-sale completion or online customer receipt; later defect cases are external through WhatsApp.

Accepted refund behavior: suggest actual paid value without deducting discounts again; 850 paid suggests 850, and the 300/200 minus 50 example suggests 275 or 175. The manager can edit the final refund without a new cap, approval queue or mandatory override reason. Preserve suggested, authorized and actually paid values with manager attribution and payment date. Use actual authorized refunds in reports, keeping cash Owed/Paid distinct.

Accepted exchange behavior uses the manager's final authorized return value as credit against the replacement's current price after offers: collect the difference when the replacement costs more, or owe/pay the cash difference when it costs less, without a standing store-credit balance. Credit 280 with replacement 320 requires cash collection 40; credit 280 with replacement 200 requires a cash refund of 80.

Replacement quantities obey the same central per-variant limits as a new sale, combining repeated lines and excluding protected online allocations, and receive a new FIFO allocation. Record inspected sellable return restoration to the original batches separately. Only stock actually made available by that restoration may contribute to replacement availability; an unsellable or merely expected return cannot cover a shortage.

Recommended operational details for final review:

- Use an editable return draft with no effects, followed by a posted received/inspected return and separately recorded refund payment. Optional notes do not make an ordinary customer's explanation mandatory.
- Calculate the deadline as receipt time plus 14 Cairo calendar days, inclusive at that cutoff. Validate before, at and after the cutoff without adding another defect window.
- Post-save return corrections are manager-only linked corrections with required correction reason and actual stock/cash adjustments. Changing a paid record does not automatically pay again or claim that cash was recovered.
- Record immediate exchange credit separately from actual cash settlement, retaining the full replacement merchandise value. Credit 280 applied to replacement 320 is not a cash refund of 280 plus cash receipt of 320: it is linked credit 280 and cash collected 40. For replacement 200, credit applied is 200 and cash 80 is Owed/Paid. Do not leave already-applied credit recorded as cash still owed or mark it as cash physically paid.
- For online full-transaction returns, suggest the entire recorded customer payment including its checkout delivery charge. For partial returns, suggest returned merchandise paid values without automatically refunding that charge. Preserve a merchandise/checkout-charge breakdown for reporting while the manager controls the total; this is not a courier financial ledger.
- A failed parcel received before any Delivered sale belongs to order handling, while a customer's return after delivery belongs to Returns.

### Reporting, analytics and expenses

Record expenses with branch, amount, date, category, description and creator. Employee entries use the active authorized branch and are visible only to that employee in the authorized context; managers see all. Saved entries enter reports immediately. Only the manager corrects/cancels a saved expense through a linked change with original values, reason, actor/time and one effective reporting change.

Physical cash completion and online Delivered are the completed-sale events. Pending/Confirmed orders remain operational orders. Use Cairo dates and calendar months; keep returns in their processing period while retaining original-sale attribution. A return's handling branch does not rewrite the original branch/channel. Required views cover current/day/month/branch sales, purchases, expenses, best sellers, low stock, inventory value and merchandise/operating profit, with PDF/Excel exports under the same data permissions.

Recommended formulas and display details for final review:

- Completed-order reports show final order value. Merchandise 450 plus configured customer delivery charge 50 gives final value 500; merchandise-profit sales basis remains 450. Do not infer courier remittance, receivables or margin from that charge.
- Net merchandise sales equal completed merchandise paid values minus posted merchandise refunds, using the manager's actual authorized refund allocation.
- Net merchandise cost equals allocated completed-sale batch costs minus the original costs of returned sellable merchandise, plus explicit linked cost adjustments. Unsellable returns do not reverse cost into sellable inventory.
- Merchandise gross profit is net merchandise sales minus net merchandise cost. Management operating profit subtracts effective branch expenses. No tax/VAT or courier-margin calculations are included.
- Example: merchandise revenue 450 and cost 240, followed by authorized merchandise refund 280 and sellable original cost 150 restored, yield net sales 170, net cost 90 and gross profit 80. Expense 20 gives operating profit 60.
- Inventory valuation distinguishes available merchandise from confirmed/in-transit allocations awaiting completion and flags unresolved costs. Unknown costs must not silently become zero; already-recognized historical sales are not repriced by new receiving costs.
- Aggregate visits, product views, successful cart additions, accepted order submissions and completed sales are distinct counts, without persistent individual profiles or claims of unique-person conversion. Deduplicate business counts with accepted operation identities.

### Manual backup, opening import and release

Accepted backup is a manager-created password-protected business-data download saved outside the browser. Image binaries are not required; references may be included. Restoring missing image files is not promised. Reconcile queued and newer records and pause writes before the manager previews and confirms restoration. Never silently overwrite newer activity.

Recommended backup design for final review: a versioned encrypted archive with manifest, counts, checksums, stable business/actor IDs, original records/corrections, batch allocations, configuration and operation-deduplication records. Use maintained authenticated-encryption tooling. Exclude active sessions, reset tokens and service secrets. Identify known unsynchronized devices because a central-data backup cannot include their unsent records.

Restore into staging, validate links/totals and show differences before activation. Keep the pre-restore snapshot, revoke sessions and use a restore-generation marker to route late old-device operations to reconciliation. Restore staff/actor mappings; re-provision credentials through manager reset where necessary and use separate owner recovery/bootstrap. A restore drill must prove this behavior before release.

Opening CSV import carries products, current quantities, separate cost batches and operating configuration, without old paper sales history. Recommended import behavior is validation and a preview before an atomic accepted import, retaining an import identity so retries cannot duplicate opening stock. Use labelled demo data during development; collect real catalog, batch ordering/costs, staff/branch grants, delivery fees/areas, contacts, hours, branding and device information together before cutover.

Build foundation and the receiving-to-cash-sale workflow first; then complete offline operation, Returns/exchanges, corrections, expenses, promotions and management reporting; then finish the public storefront/order workflows and release verification. This is sequencing within full v1 scope. Website completion precedes domain/hosting booking; deploy internal operations first and enable public ordering after production stock/workflows are verified. Offline capability must pass its acceptance gate before a shop relies on it.

## Testing Decisions

### Accepted test boundaries

Use **one primary business-test boundary: the application's public HTTP operations, authenticated as the relevant role, with the real test database and production business adapters**. Assert returned business results and subsequent authorized reads. This exercises authorization, validation, use cases, persistence and transactions together while allowing internal refactoring. Prefer this over a separate mock-driven test suite for every repository or internal function.

Add a focused **real-browser boundary only where HTTP tests cannot prove the required behavior**: offline local persistence and synchronization, restart/update/account-switch recovery, Arabic interface usability and public/internal page separation. Inspect privacy in browser responses/caches as well as rendered controls. Keep browser coverage focused rather than repeating every pricing table through the UI.

The repository currently contains planning/configuration and skills only: no application, migrations, production adapters or test harness provide existing test seams or test examples. The first implemented receiving-to-sale scenario becomes the reference integration test. The first persisted offline sale/reconnect scenario becomes the reference browser recovery test. No tests in this specification have been executed or marked passing.

Tests should observe business behavior, remain deterministic through controlled time and isolated test data, and use distinct request identities and independently authenticated roles for concurrency/access scenarios. Use real database concurrency and real browser storage for the features that depend on them; do not substitute in-memory mocks for those guarantees. Introduce narrower pure-rule tests only if they add meaningful coverage that the primary boundary cannot reasonably provide.

### Acceptance scenarios

| ID | Scenario and required evidence | Boundary |
| --- | --- | --- |
| A01 | Manager provisions staff and allowed branches; staff sign in, select only permitted branches, and cannot invoke manager-only operations or read colleagues' records. An ordinary cashier cannot confirm/change order stages; an assigned representative and manager backup can perform permitted transitions. | HTTP; focused browser login |
| A02 | Public and employee responses/exports/caches omit costs, profit, inventory value and unauthorized records; direct endpoint calls cannot bypass hidden controls. | HTTP and browser cache inspection |
| A03 | Product code is unique; variant price/quantity selection is correct; category, size/color and publication settings remain editable. | HTTP; catalog smoke flow |
| A04 | Available/Out of Stock/Coming Soon/Hidden have the agreed public visibility and orderability; out-of-stock product pages remain accessible. | HTTP and browser |
| A05 | Receiving distinct costs retains separate batches; old 10 at 100 plus new 10 at 140, followed by a sale of three, leaves 7 old and 10 new. | HTTP with real database |
| A06 | Known quantity two rejects a basket requesting three, including duplicate variant rows; different variants cannot cover the shortage. | HTTP; quantity-control smoke flow |
| A07 | Receiving, cash sale, branch attribution and manager sales view form one complete workflow; customer name/phone can be absent. | HTTP and one browser workflow |
| A08 | Employee discount is allowed on offers without a manager cap; optional reason is accepted; zero succeeds and negative fails; report attribution is retained. | HTTP |
| A09 | 300/200 minus 50 gives 275/175, not a proportional split; reviewed multi-unit, capped low-price and piaster examples conserve exact totals. | HTTP pricing/sale operations |
| A10 | Offer eligibility, best-saving selection, bundle contents, cheapest reward units, stacking, coupon usage/release and Cairo date boundaries match the rules. | HTTP with controlled time |
| A11 | Two confirmations, or a connected POS allocation and a confirmation, competing for one available unit cannot allocate it twice. Transaction failure leaves no partial order/movement/coupon effect. If a cash sale was already physically completed, preserve that business fact and reconcile its unallocated remainder instead of silently rejecting it because the competing allocation won. | Concurrent HTTP with real database |
| A12 | Lost responses and repeated command identities return the original accepted result with one sale/stock/refund effect; changed content under the same identity fails explicitly. | HTTP with interruption/retry |
| A13 | Pending submission passes current quantity validation but allocates nothing; a later physical sale may force a customer-agreed revision before confirmation. | HTTP |
| A14 | Confirmation deducts once; shipment/delivery deduct nothing further; pending cancellation restores nothing; confirmed pre-shipment cancellation releases once. | HTTP |
| A15 | Failed delivery stays unavailable until receipt/inspection; only sellable quantities are restored, under the reviewed posting permission. | HTTP |
| A16 | Unreachable cancellation observes configurable wait, at least two attempts and a reason; no automatic cancellation or confirmed-order expiry occurs. | HTTP with controlled time |
| A17 | Offline completion survives browser restart with original price, employee/branch attribution and visible unsent count; reconnect sends it once. | Real browser and database |
| A18 | Lost response, repeated sync, acknowledgement plus snapshot refresh, and multiple tabs cannot repeat a deduction or resurrect a locally sold unit. | Browser and concurrent HTTP |
| A19 | Local-storage write failure is not shown as a saved sale; logout, account switch and update preserve pending records without cross-account disclosure. | Real browser failure/recovery |
| A20 | Late completed sales and coupon overuse preserve the accepted sale/price, protect confirmed allocations and expose the reviewed manager discrepancy outcome. | HTTP plus browser replay |
| A21 | Revocation/reconnect blocks new connected work but retains earlier completed sales; expiry supports reauthentication/manager recovery without data loss. | HTTP and browser |
| A22 | Coordinated quantity correction excludes reserved units; late movement already counted is reconciled without a second deduction; receiving corrections preserve history/cost traceability. | HTTP with controlled ordering |
| A23 | Dedicated Returns selects a real original transaction from either branch or Delivered online purchase; partial/cumulative quantity and 14-day cutoff checks hold. | HTTP and Returns browser flow |
| A24 | 850 paid suggests 850; partial 275/175 values are retained; manager can choose a different nonnegative refund without an unrequested cap/reason requirement; Owed/Paid do not restore stock twice. | HTTP |
| A25 | Sellable returns restore original batches; cross-batch partial returns follow reviewed allocation; unsellable returns do not become available. After an explicit linked cost correction from 100 to 140, a sellable return restores/reverses effective 140 while retaining original 100 and the correction history; a new-cost receipt alone cannot reprice the sale. | HTTP with real database |
| A26 | Exchange credit 280 with replacement 320 collects 40; replacement 200 owes/pays 80. Applied credit is not a cash payout or outstanding cash debt. Replacement quantity three against available two fails, including duplicate lines and reserved-stock exclusions; only actually restored sellable units may increase availability. Allocate replacement FIFO and restore returns to original batches separately; retain originals and prevent repeated settlement. | HTTP |
| A27 | Employee/manager expenses appear immediately with correct visibility; manager correction from 500 to 50 preserves history and yields effective expense 50 once. | HTTP |
| A28 | Cairo day/month, branch/channel, actual refund processing, merchandise profit and inventory valuation match reviewed examples; unknown costs are visibly incomplete. | HTTP reports |
| A29 | Final online order value includes configured checkout charge while merchandise profit excludes courier-margin assumptions; refunds use the reviewed charge breakdown. | HTTP |
| A30 | PDF/Excel exports agree with permitted report results; aggregate events count accepted business operations once without individual visitor profiles. | HTTP and export/browser smoke flow |
| A31 | Protected data-only export/restore preserves records, allocations, actor mappings and deduplication; wrong password/corruption/newer activity cannot silently replace valid data. | HTTP with independent restore database |
| A32 | Opening CSV validation and retry do not duplicate batches; offline old-generation records after restore are retained for reconciliation. | HTTP and browser recovery |
| A33 | Arabic RTL critical flows work on actual desktop/tablet POS and phone management/storefront browsers; customer navigation contains no internal screens. | Browser and device verification |
| A34 | Manager can maintain/activate offers, bundles, Buy-X-Get-Y rules, coupons and combination settings; ordinary employees cannot. Cashier/customer coupon application exposes the permitted basket result and preserves accepted transaction prices after later rule changes. | HTTP and focused promotion/coupon browser flow |
| A35 | Manager edits supported Fayoum areas and fees without a release; checkout uses configured areas/charges and rejects unsupported areas. Alternate phone, landmark and notes can be omitted from actual API requests. | HTTP and checkout browser flow |
| A36 | Under the proposed coupon/reward defaults, a finally cancelled undelivered failed order releases consumed usage once; failure/receipt alone and a Delivered customer return do not. Returning a free reward suggests zero without repricing retained items or disabling the manager's refund edit. | HTTP with original transaction and coupon records |

Use automated import/cycle checks and production bundle inspection as architecture checks alongside behavior tests. They enforce accepted boundaries and code separation; they do not substitute for authorization tests. Exact test libraries and dependency versions are ordinary foundation choices after the proposed boundaries are confirmed.

## Out of Scope

- Separate branch/website inventories, stock transfers, full stock-count session/comparison screens and dedicated damaged/missing-stock workflows.
- Barcode/scanner workflows, receipt/invoice printing, shift/cash-drawer systems, wholesale and delivery outside the configured Fayoum scope.
- Card/wallet/payment-gateway integration, supplier accounts/balances, external accounting integration, accountant role, tax/VAT and shipping-company receivables/remittances/settlements/fee ledgers.
- Customer accounts, full customer purchase-history tools, segmentation/loyalty/spending analytics, wishlists, reviews, product likes, advanced product filters, customer order-tracking or self-service cancellation portals.
- Average-order-value and least-selling-product reports, persistent individual visitor profiles and additional advertising integrations.
- Automated customer email/SMS/promotional messaging, newsletters, courier APIs, native mobile applications and a full enterprise audit-log UI.
- A separate 30-day in-app defect-return path; cases beyond the agreed 14 days are handled externally through WhatsApp.
- Image binaries as a mandatory backup component, scheduled automatic backups and importing historical paper sales.
- Module Federation and independently deployed microservices at the initial stage; domain/hosting purchases before website completion.

## Further Notes

This is the parent specification for the full version-one effort. Split it into complete, independently verifiable workflow tickets with real dependencies before implementation; do not treat the entire specification as one context-sized coding ticket. GitHub is the configured source for the published specification and implementation tickets.

The user approved proceeding on 2026-09-08 after the independent Grok review and the documented corrections. This includes the reviewed stack, operational/calculation extensions and testing boundaries. Publish this specification with ready-for-agent and enhancement labels; track implementation through dependent workflow tickets. Acceptance is not evidence that dependencies or application tests have passed.

The source material is the BRAVOS business brief, discovery decisions D01-D51, the dedicated Returns agreement, and the architecture decisions on offline-completed physical sales, protected confirmed orders and separate FIFO cost batches. Later explicit user corrections take precedence over earlier recommendations. The architecture blueprint supplies proposals, not evidence that dependencies, a running database or application tests have passed.

Configuration still to collect together before launch includes real products/categories/variants, opening batch costs/quantities/order, staff and branch assignments, representative/hours, delivery areas/fees, expense categories, offers/coupons, contact/social links, branding and actual devices. Hosting provider, domain and operating budget are selected at the agreed later stage without blocking local development.

Final Arabic labels for the accepted order-stage meanings are a UI design detail; they do not reopen the agreed lifecycle or stock effects. The existing blueprint contains proposed labels for that design review.
