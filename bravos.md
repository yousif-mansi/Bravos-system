# BRAVOS — Complete Business & Product Requirements

> **Latest correction — 2026-09-29:** The user explicitly replaced the central-inventory and cash-only branch-sale rules after testing. [Phase 1 operational updates](docs/planning/phase-1-operational-updates.md) records the new branch inventory, inventory-first workflow, payment allocation, online recognition, references, returns lookup, and UI requirements, plus pending follow-up decisions. It takes precedence over conflicting historical text below.

> **Document purpose:** This file is the authoritative business requirements brief for the BRAVOS system and online store.  
> It merges the original discovery questionnaire, the client's answers, and the latest client correction.  
> It is intended to be given to Codex before architecture, technology selection, database design, or implementation begins.

---

## 1. Project Summary

BRAVOS is a men's clothing retail business in Fayoum, Egypt.

The business currently operates through **two physical branches**:

1. **Abshway Branch** — the main branch.
2. **Fayoum Branch**.

There are currently **no plans to open additional branches**.

The current business workflow is almost entirely **paper-based**. The new project should replace that paper workflow with one connected electronic system covering:

- Product management.
- Central inventory management.
- Physical branch sales / POS.
- Branch management.
- Employee accounts and permissions.
- Online store.
- Online orders.
- Expenses.
- Purchases / stock intake.
- Promotions and discounts.
- Business dashboard.
- Reports.
- Basic customer data.
- Website analytics.
- Important action attribution / control.

The core business goal is to move BRAVOS from manual paper-based management to a complete electronic operation that gives the owner clear control over the business.

---

# 2. Authoritative Correction — Inventory Model

This section **overrides any older answer** that says each branch has a separate inventory.

## Correct inventory rule

BRAVOS will use **one unified / central inventory for both branches**.

There will NOT be a separate stock balance for Abshway and Fayoum.

The following three sales channels all consume from the same inventory source:

- Abshway physical branch.
- Fayoum physical branch.
- BRAVOS online store.

### Required behavior

- A physical sale in Abshway decreases the central stock.
- A physical sale in Fayoum decreases the same central stock.
- A confirmed online sale/order that reserves or completes a sale must affect the same central stock according to the final order workflow.
- Receiving new merchandise increases the central stock.
- The website must display availability based on the central stock.
- No stock transfer between branches is required because there are no separate branch inventories.
- No branch-to-branch transfer history is required.

### Important separation

Although inventory is shared, the system must still distinguish between branches for:

- Sales.
- Employees.
- Expenses.
- Performance reports.
- Daily and monthly totals.
- Any other branch-specific operational data.

The inventory is shared; the sales and operational reporting are not.

---

# 3. Business Structure

## 3.1 Branches

Current branches:

- Abshway — main branch.
- Fayoum.

No new branches are currently planned.

The two branches do not necessarily sell exactly the same visible assortment at all times, but **product pricing is the same across both branches**.

Because inventory is now unified, product availability is based on the shared central stock rather than independent branch stock.

## 3.2 Management

- **Khaled Saeed** is responsible for both branches.
- He is the main business decision maker.
- Full administrator access belongs to the owner / main manager.

## 3.3 Employees

- Current total employees: approximately **4 employees**.
- Typical maximum per branch: approximately **2–3 employees**.
- Future growth may add approximately **3–5 additional employees maximum**.
- Users are normal retail employees, so the system must be simple and easy to use.

---

# 4. Main Problems the System Must Solve

The most important current problems are:

1. Managing the complete business electronically instead of on paper.
2. Organizing products, stock, sales, and purchases.
3. Connecting both branches with one management system.
4. Building an online ordering website connected to the same system.
5. Monitoring inventory accurately.
6. Recording expenses.
7. Knowing who performed important changes or operations.
8. Seeing useful business information that is currently difficult to track.

The owner currently finds it difficult to know or measure things such as:

- Best-selling products.
- Customer preferences.
- Product views.
- Product engagement / likes where applicable.
- Useful customer or website behavior data.
- Live and historical business performance.

---

# 5. Product Management

BRAVOS mainly sells **men's clothing** for summer and winter seasons.

Examples include:

- Trousers.
- Shirts.
- T-shirts.
- Jackets.
- Other men's fashion items.

## 5.1 Product information

Each product may include:

- Product name.
- Unique SKU / internal product code.
- Category.
- Subcategory.
- Description.
- Images.
- Purchase / cost price.
- Selling price.
- Status.
- One or more colors.
- One or more sizes.

The same product may have multiple combinations of:

- Size.
- Color.

## 5.2 SKU and barcode rules

- Every product must have a unique SKU / code.
- BRAVOS does **not currently use barcodes**.
- Employees will search products using the unique product code.
- Barcode scanning is not required in version 1.

## 5.3 Pricing

- Cost price must be stored in the management system.
- Cost price is private business information.
- Cost price must **never appear on the public customer website**.
- Selling price must appear on the website.
- Product prices change frequently.
- Selling prices are the same across physical branches.

## 5.4 Categories

Categories and subcategories are required.

The exact category tree has not yet been provided.

## 5.5 Product statuses

Required product statuses are:

- Available.
- Out of Stock.
- Coming Soon.
- Hidden.

Expected meaning:

- **Available:** can be shown and sold if stock is available.
- **Out of Stock:** currently unavailable for sale.
- **Coming Soon:** may be displayed before being available.
- **Hidden:** should not be visible to customers.

The exact interaction between manual status and actual stock quantity should be defined during implementation.

---

# 6. Inventory / Stock

## 6.1 Inventory source

There is one **central inventory** shared by:

- Abshway branch sales.
- Fayoum branch sales.
- Online sales/orders.

## 6.2 Current process

Current inventory tracking is manual using:

- Physical counting.
- Paper records.

The new system should replace this process electronically.

## 6.3 Automatic stock changes

Required:

- Physical sales automatically decrease stock.
- Receiving purchased merchandise automatically increases stock.
- Online orders must be connected to the same stock source.

## 6.4 Low-stock alerts

Low-stock alerts are required.

The exact threshold logic has not yet been specified.

Possible implementations such as one threshold per product, per variant, or a global threshold must be decided before coding this feature.

## 6.5 Stocktaking

Current stocktaking is manual.

The questionnaire asked whether the new system should support:

- Physical stock counts.
- Comparing counted stock with system stock.

A final explicit answer for these two system functions was **not provided**.

Do not assume a full stocktaking/reconciliation module unless confirmed.

## 6.6 Damaged / missing products

Damaged or missing products will currently be handled **outside the system**.

No dedicated damaged-stock or shrinkage workflow is required in the confirmed version.

## 6.7 Stock transfers

Not required.

Because inventory is unified, there is no separate branch stock to transfer between locations.

---

# 7. Physical Sales / POS

A POS-style screen is required for employees working in the physical branches.

## 7.1 POS requirements

Employees must be able to:

- Create a physical sale.
- Search for a product using its unique code / SKU.
- Select the correct product / size / color variant where applicable.
- Enter the quantity.
- Complete the sale.
- Have the stock automatically reduced.

## 7.2 Sale attribution

Every physical sale must record:

- Branch.
- Employee who performed the sale.
- Date and time.
- Sold items.
- Quantities.
- Selling prices.
- Applied discounts if any.
- Final sale total.

## 7.3 Physical branch payment method

Physical branch payments are currently:

- **Cash only.**

No card or wallet payment handling is required for the current version.

## 7.4 Receipts and invoices

Not required:

- Printed receipts.
- Receipt printer integration.
- Formal invoice printing.

## 7.5 Discounts and sale deletion

Regular employees must not have unrestricted access to critical sale actions.

Only the manager / authorized admin may:

- Apply restricted discounts where applicable.
- Cancel a sale.
- Delete a sale.
- Perform other critical operations defined as admin-only.

Important operations should be attributable to the user who performed them.

---

# 8. Returns & Exchanges

This area is important but **requirements are not finalized yet**.

The original discovery raised the following questions, but the client has not yet provided final answers:

- Are returns allowed?
- Are exchanges allowed?
- Is the customer refunded in cash, store credit, or another method?
- What is the allowed return/exchange period?
- Can a return or exchange happen at a different branch?
- Should the return reason be recorded?
- Should returned sellable items automatically go back into stock?

## Implementation rule

Do **not** make irreversible assumptions about returns or exchanges.

This module should be treated as an **open requirement** until the business rules are confirmed.

---

# 9. Customers

The system should store basic customer information.

## Required now

- Customer information.
- Customer phone number.

## Not required in version 1

- Customer account system on the website.
- Full customer purchase-history feature as a dedicated requirement.
- Customer spending analytics.
- Bronze / Silver / Gold segmentation.
- Loyalty points.
- Customer classification.
- Advanced customer value analysis.

Customer spending analysis may be added in a future version.

---

# 10. Users, Roles & Permissions

## 10.1 User types

Confirmed system users:

- Owner / Manager / Administrator.
- Employees / Cashiers.

An accountant will not use the system.

## 10.2 Accounts

- Every employee should have a personal account.
- Access must depend on the user's role.
- Full administrator access belongs to the owner.
- Permissions must differ between manager and employees.

## 10.3 Critical actions

Important operations should require elevated permissions.

Examples include:

- Price changes.
- Deleting records.
- Cancelling sales.
- Sensitive discount actions.
- Other critical business changes.

Some critical actions may require manager / owner approval.

## 10.4 User attribution

The system should know which user performed important actions.

However, there is a requirements conflict that must be understood:

- Earlier answers say it is important to know who performed changes.
- The permissions section says important actions should identify the responsible user.
- The security section says a full activity log is not currently required.

### Safe interpretation for planning purposes

The confirmed business need is **action attribution for important records and operations**.

A separate, full audit-log screen with every system event should be considered **not confirmed** unless the client later requests it.

Codex should not silently turn this into a large enterprise audit subsystem.

---

# 11. Branch Access Rules

The owner must be able to view both branches from one dashboard while clearly separating branch-specific data.

Employees should operate within their authorized branch context.

The old answer that employees should not see another branch's inventory is **superseded by the unified inventory correction**, because there is no separate inventory per branch.

What still remains separate is branch operational data such as:

- Branch sales.
- Branch employees.
- Branch expenses.
- Branch reports.

Exact employee visibility into reports or other branches' sales should follow role permissions.

---

# 12. Dashboard

The dashboard should give the owner useful business information immediately after login.

Required information includes:

- Live / current-day sales.
- Daily sales.
- Monthly sales.
- Sales by branch.
- Purchases.
- Best-selling products.
- Net profit.
- Inventory value.
- Low-stock information.

The dashboard should allow the owner to see combined business performance and easily separate information by branch.

## Not currently required

- Least-selling product analysis.
- Average order value.
- Advanced customer statistics.

---

# 13. Reports

Required reports include:

- Daily sales.
- Monthly sales.
- Sales by branch.
- Best-selling products.
- Inventory value.
- Low-stock products.
- Profit / net profit information.
- Relevant purchase and expense reporting required to support those calculations.

Monthly reports must follow **calendar months**.

Reports should be exportable to:

- PDF.
- Excel.

---

# 14. Profit & Financial Logic

The system must support:

- Cost price recording.
- Selling price recording.
- Sales totals.
- Expenses.
- Profit calculation.
- Net profit calculation.

## Expenses

Branch expenses should be recorded.

The client does **not** currently require a complex accounting system.

Detailed dedicated tracking for items such as:

- Rent.
- Electricity.
- Resource consumption.

is not required as a specialized accounting module.

A practical expense-recording workflow is still required because expenses are needed for net-profit calculations.

## Accountant

- No accountant will use the system.
- No external accounting system is currently used.

---

# 15. Purchases / Receiving Stock

BRAVOS buys merchandise that needs to be added to stock.

Required:

- Record purchased / received quantities.
- Receiving merchandise should increase central stock.
- Purchase information should be available to the dashboard where required.
- Product cost is stored by the system.

Not required:

- Supplier account management.
- Supplier balance tracking.
- Complex supplier payment ledgers.

The exact purchase record fields beyond product, quantity, cost, date, and related stock effect have not been fully specified.

---

# 16. Online Store

BRAVOS requires a **branded commercial website**, not only a catalog.

Customers must be able to:

- Browse products.
- Search products.
- View product details.
- View images.
- View descriptions.
- View selling prices.
- Select relevant size/color variants.
- Add products to cart.
- Place an order.
- Checkout without creating an account.

## 16.1 Customer accounts

Not required.

There is no customer login/account requirement in version 1.

## 16.2 Guest checkout

Required.

Customer details should be collected during checkout.

At minimum, the flow will need the data required to:

- Identify the customer.
- Contact the customer.
- Deliver the order.

The exact checkout field list has not yet been finalized.

## 16.3 Shopping features

Required:

- Shopping cart.
- Product search.

Not required in version 1:

- Wishlist.
- Product reviews.
- Customer accounts.
- Advanced product filters by price / size / color / etc.
- Customer order-tracking portal.

A size guide was asked about in discovery but no final answer was provided.

Do not assume it is required.

---

# 17. Website Stock Synchronization

The website must use the **same central inventory** as the physical business.

There must not be a separate "website stock" database maintained independently.

The objective is to prevent the website and physical branches from behaving as disconnected stock systems.

The exact moment at which an online order should reserve/decrease stock must be finalized during order-flow design.

Possible moments include:

- At order placement.
- At staff confirmation.
- At fulfillment.

This timing was not explicitly confirmed and must not be silently assumed.

---

# 18. Online Orders

Online orders must appear inside the same management system.

They must remain distinguishable from physical branch sales.

## 18.1 Current process

A staff member will:

1. Receive the online order.
2. Contact / confirm the order with the customer.
3. Continue fulfillment manually according to the business process.

## 18.2 Customer cancellation

Customer cancellation will currently be handled through **WhatsApp communication**.

No self-service website cancellation workflow is required.

## 18.3 Order tracking

Customer-facing order tracking is not required.

## 18.4 Order statuses

The original questionnaire suggested statuses such as:

- Pending.
- Confirmed.
- Preparing.
- Shipped.
- Delivered.
- Cancelled.

However, the client did not explicitly confirm the final status list.

The final order lifecycle must be agreed before implementing hard-coded order statuses.

---

# 19. Delivery

Delivery is currently available **within Fayoum Governorate**.

## Delivery fee

- Delivery fee varies by area.
- No free-delivery rule is required currently.

The exact:

- Delivery areas.
- Area names.
- Delivery prices.

have not yet been provided.

These values should be configurable rather than assumed.

## Delivery company

The business already has an existing delivery-company arrangement outside the website.

A direct shipping-provider API integration is not currently confirmed as necessary.

The system should not assume that automated delivery integration is required unless later requested.

---

# 20. Payments

## Physical branches

- Cash only.

## Online store

- Cash on Delivery (COD).

## Not required

- Online card payment gateway.
- Online wallet payments.
- Payment-provider account integration.

Online payment is not required for version 1.

---

# 21. Promotions & Discounts

The business wants support for multiple promotion types.

Required promotion capabilities:

- Percentage discounts.
- Fixed-amount discounts.
- Bundle offers.
- Buy-X/Get-Y style offers where applicable.
- Discounts on selected products.
- Discounts on categories.
- Seasonal campaigns.
- Coupon / promo codes.

Regular employees must not freely create or activate promotions.

Promotion management belongs to the:

- Website / business manager.
- Authorized admin.

The exact conflict rules, stacking rules, date logic, usage limits, and eligibility rules have not yet been defined.

Do not invent advanced promotion rules without confirmation.

---

# 22. Marketing & Communication

## Required

- WhatsApp contact button.
- Social media links.
- Website visitor analytics.
- Website sales analytics.

## Not required

- Customer notification system.
- Email notifications.
- SMS notifications.
- Newsletter system.
- Automated promotional messaging.

---

# 23. Website Analytics & Customer Behavior

The business wants better visibility into online behavior and product performance.

Relevant desired insights include:

- Product views.
- Website visitors.
- Website sales.
- Best-selling products.
- Customer/product preferences where measurable.

The original answers also mention "likes" as information the owner currently finds difficult to know.

However:

- Wishlist is not required in version 1.
- No explicit product-like feature has been confirmed.

Therefore, analytics for **views and sales are confirmed**.

A dedicated product "Like" feature should be treated as **unconfirmed** unless explicitly added later.

---

# 24. Security

Confirmed requirements:

- Managers and employees may log in.
- Every employee has a personal account.
- Role-based permissions are required.
- Critical actions require appropriate permissions.
- Standard security and privacy requirements are sufficient.

No special industry-specific compliance requirement has been provided.

## Backups

Backups are required **manually**, not as a confirmed periodic automated process.

The exact manual-backup mechanism and backup format have not been specified.

---

# 25. Mobile & Devices

No mobile application is required.

The client expects mobile usage mainly through the website/browser.

A separate native mobile app is not planned.

The original discovery also asked whether:

- The management system should work well from phones.
- The owner should monitor branches remotely.
- Tablet support is required.

These details were not fully answered.

Do not assume a native app.

A responsive browser-based experience may be desirable, but the exact supported management-device requirements should be finalized during UI planning.

---

# 26. Language

The system will be mainly **Arabic**.

Important technical terms may remain in English where useful.

Implication for design:

- Arabic is the primary user-facing language.
- RTL-friendly interface design will likely be necessary.

No full bilingual Arabic/English requirement has been confirmed.

---

# 27. Branding & Visual Design

Brand guidelines will be created together at the beginning of the project.

The client will provide visual resources.

The final visual style for:

- Public website.
- Management dashboard.
- POS.

will be discussed during the design phase.

No final design system is defined in this requirements file.

---

# 28. Future Plans

Currently NOT planned:

- Additional branches.
- Native mobile application.
- Wholesale sales.
- Selling outside Fayoum.
- Online payment gateway.

Expected possible growth:

- Approximately 3–5 additional employees maximum.

Customer spending analysis may be considered in future versions.

---

# 29. Version 1 — Confirmed Core Scope

The first version must solve the main operational problems and replace the paper-based workflow.

Confirmed core areas include:

1. Product management.
2. Central inventory management.
3. Physical sales / POS.
4. Branch management.
5. User accounts and permissions.
6. Dashboard.
7. Reports.
8. Purchases / stock receiving.
9. Expenses.
10. Profit / net profit visibility.
11. Online store.
12. Guest checkout.
13. Online orders inside the management system.
14. COD workflow.
15. Delivery fees by area.
16. Promotions / coupons.
17. WhatsApp contact.
18. Social links.
19. Website analytics.
20. Exporting relevant reports to PDF / Excel.

The project should replace the current paper system rather than operate as a small add-on to it.

---

# 30. Explicitly Not Required in Version 1

Unless later changed, the following are not required:

- Separate inventory per branch.
- Branch-to-branch stock transfers.
- Barcode system.
- Barcode scanner workflow.
- Receipt printing.
- Invoice printing.
- Card payments in branches.
- Online payment gateway.
- Wallet payments.
- Customer accounts.
- Wishlist.
- Product reviews.
- Advanced customer classification.
- Loyalty points.
- Customer spending analytics.
- Advanced customer statistics.
- Average order value reporting.
- Least-selling-products reporting.
- Customer-facing order tracking.
- Automated email notifications.
- SMS notifications.
- Newsletters.
- Full supplier-account management.
- Supplier balances.
- External accounting-system integration.
- Accountant role.
- Native mobile app.
- Wholesale.
- Selling outside Fayoum.
- Dedicated damaged/missing-stock workflow.
- Confirmed full enterprise audit-log module.
- Confirmed shipping-company API integration.

---

# 31. Important Open Questions Before Final Implementation

These are not reasons to stop overall planning, but they must be resolved before the affected feature is finalized.

## 31.1 Returns & exchanges

Entire business policy still needs confirmation.

## 31.2 Online stock timing

When exactly does an online order reserve/decrease central stock?

- On placement?
- On confirmation?
- On another status?

## 31.3 Online order statuses

Final status list is not confirmed.

## 31.4 Delivery areas and fees

Need the actual Fayoum area list and price per area.

## 31.5 Stocktaking

Need confirmation on whether the system needs:

- Count sessions.
- Count-vs-system comparison.
- Stock adjustments after reconciliation.

## 31.6 Low-stock thresholds

Need the rule for setting alert quantities.

## 31.7 Product category tree

Need actual categories / subcategories.

## 31.8 Checkout fields

Need final customer information fields.

Phone number is definitely important.

## 31.9 Size guide

Not confirmed.

## 31.10 Promotions

Need detailed rules for:

- Bundle structure.
- Coupon limits.
- Date ranges.
- Discount stacking.
- Product/category eligibility.

## 31.11 Activity tracking

Need final decision between:

- Basic created-by / updated-by / action attribution.
- A full browsable audit log.

The business need to know who performed important actions is confirmed; a full activity-log module is not.

## 31.12 Backup workflow

Manual backup is required, but the final method is not specified.

## 31.13 Management dashboard on mobile

No mobile app is required, but management browser/device support should be confirmed.

---

# 32. Key Business Rules

These should be treated as high-priority rules when the system is eventually designed.

1. **There is one shared central inventory.**
2. **Both physical branches and the online store use that inventory.**
3. **Every physical sale belongs to one branch and one employee.**
4. **Branch reports must remain separable even though inventory is shared.**
5. **Cost prices are private and must never appear on the public website.**
6. **Selling prices are shared across both branches.**
7. **Regular employees must not have unrestricted access to destructive or sensitive actions.**
8. **The owner/admin can see the whole business from one dashboard.**
9. **Physical payments are currently cash only.**
10. **Online payments are currently COD only.**
11. **Online customers do not need accounts.**
12. **Online orders must appear inside the same back-office system.**
13. **The online store must not operate with a disconnected stock balance.**
14. **The system's primary interface language is Arabic.**
15. **The new system is intended to replace the paper workflow.**

---

# 33. Conceptual Business Areas

This is not a database schema and does not force an implementation, but Codex should understand that the business logically contains the following areas:

- Branches.
- Users.
- Roles / permissions.
- Products.
- Product variants.
- Categories.
- Central stock.
- Stock receiving / purchases.
- Physical sales.
- Sale items.
- Online orders.
- Order items.
- Customers / checkout contacts.
- Expenses.
- Promotions.
- Coupons.
- Delivery areas / delivery fees.
- Dashboard metrics.
- Reports.
- Website analytics.
- Important user/action attribution.

Returns/exchanges should remain provisional until the business rules are confirmed.

---

# 34. Source-of-Truth Priority

If any earlier questionnaire answer conflicts with this document, use the following priority:

1. **Latest explicit client correction in this document.**
2. Client answers.
3. Original discovery questionnaire.
4. Implementation assumptions only where clearly marked as assumptions.

The most important known override is:

> **Inventory is unified/central for both branches. It is not separated by branch.**

Do not reintroduce branch-specific stock balances unless the client explicitly changes this requirement later.

---

# 35. Guidance to Codex

Before writing production code:

- Treat this document as the business-requirements source of truth.
- Do not choose a technology stack solely from assumptions hidden in this document.
- Do not invent missing business rules.
- Keep unresolved requirements isolated/configurable where possible.
- Do not hard-code values that the business is expected to change frequently, especially:
  - Prices.
  - Delivery areas.
  - Delivery fees.
  - Promotion rules.
  - Low-stock thresholds.
  - Categories.
- Preserve the distinction between:
  - Shared central inventory.
  - Branch-specific sales and expenses.
  - Online orders.
- Keep the owner/admin experience different from the normal employee experience.
- Keep the employee-facing workflow simple.
- Do not expose cost or internal business data on the public website.
- Remember that the final product includes both:
  - Internal management / POS.
  - Public online store.

---

# 36. Final Project Goal

A successful BRAVOS system should allow the owner to stop relying on paper and manage the entire retail operation electronically.

From one connected system, BRAVOS should be able to:

- Manage products.
- Know central stock.
- Sell from either physical branch.
- Receive online orders.
- Know which employee made each physical sale.
- Separate sales performance by branch.
- Record purchases and expenses.
- Apply controlled promotions.
- Monitor important business metrics.
- Export useful reports.
- Run a branded public online store.
- Keep physical and online selling connected to the same inventory source.

That is the required business foundation. Architecture, technologies, database structure, deployment, and implementation decisions should be designed **after** this requirements document is accepted as the project baseline.
