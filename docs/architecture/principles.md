# BRAVOS architecture principles

> **2026-09-29:** Preserve the module/layer boundaries in this document, but follow [Phase 1 operational updates](../planning/phase-1-operational-updates.md) where the latest user requirements supersede central stock, cash-only POS, or delivered-only online sales recognition. The new branch inventory remains owned by the inventory feature; screen workflow changes do not authorize cross-feature table access.

Recorded from the user's architecture requirements on 2026-09-07. These rules apply before feature implementation. They do not select a framework, database, hosting provider, or finalized deployment topology.

Business decisions are tracked in [discovery.md](../planning/discovery.md); established business terms belong in [CONTEXT.md](../../CONTEXT.md). The [implementation blueprint](../planning/implementation-blueprint.md) proposes the concrete stack, boundaries, operating mechanics, and verification plan for final review; references below to technical details needing specification are addressed there as proposals.

## 1. Clean Architecture

Keep business rules and application use cases independent of UI frameworks, database SDKs, browser persistence, and delivery protocols. Define external-service and persistence interfaces at the application boundary; implement them in adapters. Wire concrete dependencies at an application entry point.

Use the layers required by real responsibilities. Framework request objects and database records must not become the domain model by default. This follows the inward dependency direction described in [Microsoft's Clean Architecture guidance](https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures); the reference does not imply choosing .NET.

## 2. Feature-Based Modules

Organize code around business capabilities. Candidate capabilities include catalog, inventory, physical sales, online orders, receiving, expenses, and reporting; the blueprint proposes their ownership and public boundaries.

Within a module, separate domain rules, application use cases, external adapters, and UI as needed. A module exposes an intentional public interface. Other modules must not reach into its private implementation or mutate its owned data directly.

The stock module must provide the shared stock operations used by POS, orders, and receiving. Maintain one logical central inventory with durable local sale records and duplicate-safe synchronized movements. Atomic processing applies within a local commit or central transaction; it does not imply a global transaction across disconnected browsers.

Retain distinct purchase-cost batches within each variant; new receipt costs must not average or overwrite old batch costs. Aggregate available batch quantities into the variant's central availability while keeping cost data manager-only. Sale/order allocations and sellable returns must preserve batch traceability. Q63 accepts oldest available batch first (FIFO), with sellable returns restored to their original allocated batches; see [ADR-0003](../adr/0003-preserve-purchase-cost-batches.md).

Online confirmation deducts available stock as part of the same accepted operation that records the confirmed order. Shipment and delivery do not repeat this deduction. Confirmed merchandise physically awaiting shipment remains attributable to its order and unavailable for another sale. Completed-order reporting uses delivered orders and final values; delivery-provider payment/settlement tracking is excluded.

Enforce each variant's quantity limit across the whole basket, including repeated lines. Online submission and representative confirmation use current server-known availability; changing a browser quantity control must not bypass validation. POS applies the known balance and local unsynchronized sale effects alongside the employee's physical availability check. A pending order's requested quantity is not a deduction or reservation: a later physical sale can legitimately reduce stock before staff confirm that request.

The user accepted online, manager-only stock adjustment with previous/corrected available quantities, reason, actor, and time. Synchronize known tills and briefly pause stock-changing work while finalizing a quantity correction; preserve late-arriving sales and flag discrepancies. Protect against stale/duplicate effects and account for allocations and synchronization state. Do not count confirmed set-aside merchandise as available or expose a cashier quantity-limit bypass. Full stock-count sessions/comparison screens are deferred; the blueprint proposes concrete coordination and reconciliation mechanics.

Low-stock alerts use available quantity after confirmed-order deductions. The accepted default threshold is 3 units, globally configurable with an optional manager override per variant.

Completed-sale and receiving corrections retain the original record and a linked manager-authorized correction with reason, actor, and time. Coordinate actual stock/total effects so retries cannot apply them twice and account for intervening sales. A recording correction must not automatically imply physical receipt of merchandise.

Returns is a dedicated internal section with its own list/details and original-transaction picker; see [returns.md](../planning/returns.md). Preserve original branch/channel attribution, handling branch, returned quantities, inspection/sellability, and cash refund Owed/Paid. Enforce cumulative unreturned quantities and duplicate-safe stock restoration. Apply the accepted 14-day app window from receipt; later defect cases are handled externally via WhatsApp, not a second in-app return route. Q62 confirms 850 paid means 850, and equal sharing of 50 across items priced 300/200 gives 275/175. Suggest these paid values and let the manager edit the final refund, retaining both amounts; do not add an unrequested manager cap or mandatory override reason. Q63 accepts FIFO and original-batch restoration.

Physical cash sales must support omission of customer name and phone without requiring a fabricated customer record. Online checkout requires name, primary mobile, delivery area, and detailed address; alternate phone, landmark, and notes are optional in both UI and server validation. Return lookup supports the original reference or manager-verified date/branch/items/amount matching rather than requiring a customer phone.

Catalog prices default per product with optional variant overrides, consistent across both branches and the website; size guides are optional. Choose the eligible automatic offer with the greatest saving under manager combination settings, then eligible coupon, then employee POS deduction. Fixed bundles specify contents/quantities and total price; Buy-X-Get-Y uses the cheapest eligible reward units. Count coupon usage at POS completion/online confirmation and release once for cancelled undelivered orders. Preserve accepted transaction prices; general allocation/rounding examples are proposed in the blueprint for final review.

## 3. Clean imports

- Use clear module entry points and configured aliases where supported by the chosen stack.
- Permit cross-module imports only through declared public interfaces.
- Keep the module dependency graph free of cycles.
- Prevent domain/application code from importing UI, database SDKs, or browser-specific implementations.
- Keep public storefront dependencies separate from privileged management modules and private business data.
- Use focused exports; avoid a project-wide entry point that pulls every feature into every application.

Once the stack is chosen, configure automated boundary and cycle checks in the starter project's normal checks. Folder names and import aliases alone do not enforce these rules.

Enforce the accepted access rules in application authorization and server responses: cost prices, profit figures, and inventory value are owner/manager-only; ordinary employees can read their own sales, while the manager can read all employees and branches. An employee's account may have multiple manager-assigned branches, but a sale's branch must be one they are authorized to use. The submitted employee/branch fields alone are not proof of authorization.

Use role-appropriate data and account-scoped local storage. Cashier and ordinary order-representative responses/caches must not contain restricted cost or profit data. Switching an account on a shared device must not expose the previous account's privileged data. Account disablement is applied on reconnection without losing earlier completed sales; the blueprint proposes session, permission-change, and recovery mechanics for final review.

The manager creates personal staff login-name/password accounts and handles staff resets; the owner has separate recovery. The application preserves queued sales through logout/update flows, exposes unsynchronized counts, and retries on reconnection. Concrete identity/session and secure recovery adapters remain part of stack selection, without adding fresh offline login.

Enforce manager-only online stock receiving and manager-only completed-sale corrections at the application boundary. Expense creation is authorized for both managers and employees, with creator attribution. An employee's new expense belongs to their active authorized branch; employee reads are limited to their own entries in their authorized branch context. Only managers may read all employees' expenses or correct/cancel saved entries. Retain original expense details and each correction's reason, actor, and time.

Saved expenses enter reports immediately without an approval queue. Corrections and cancellations change the effective expense amount once rather than creating duplicate expense totals or deleting history. The blueprint proposes the financial formulas and examples for review. Expense creation is not part of the accepted first offline rollout.

Employees may choose an EGP deduction after offers for physical sales in progress without a manager-configured cap or amount-based approval, including on promotional items. Accept a zero total and reject a negative one. Preserve configured-offer effects separately from the employee discount and show employee attribution plus original/discount/final amounts in sale details and manager reports. The reason is optional in validation/storage. Keep this permission separate from catalog-price updates, promotion administration, and completed-sale corrections. Equal sharing is accepted for the two-item example; the blueprint proposes general unit allocation/rounding. Do not add a hidden margin floor or privilege threshold.

Serve the public store and authenticated internal application through separate entry URLs. Dashboard, POS, Returns, and other staff sections are not part of public customer navigation. Keep their entry bundles and privileged data separate while sharing the same backend business rules and central inventory. URL separation supplements server authorization; it does not require Federation, independently owned stock, or a selected hosting provider.

## 4. Local-First Architecture and future offline operation

The user's concrete goal is to retain useful local data/work and synchronize after reconnection. The confirmed end-state includes immediately completed physical cash sales while offline; the earlier permission to phase in offline support remains, since the subsequent question concerned future offline behavior. "Local-first" covers broader ownership and collaboration principles in the [original Ink & Switch paper](https://www.inkandswitch.com/essay/local-first/); BRAVOS uses the specific sale policy in [ADR-0001](../adr/0001-complete-physical-sales-offline.md).

Prepare persistence interfaces that can accommodate local data and synchronization. Recommended mechanisms to evaluate with the stack include a structured browser store such as IndexedDB, a durable queue of business commands, stable operation identifiers, and server-side duplicate detection.

Retries must have at most one accepted effect for each operation. Synchronize sale/stock movements rather than overwriting central balances with cached totals. Authorization and discrepancies need explicit outcomes, but a completed physical sale must not disappear merely because the central balance or an online commitment conflicts with it. Preserve the business fact and expose any discrepancy; the blueprint proposes a manager reconciliation workflow for final review.

Goods and cash may change hands while disconnected: this is decided. The sale is final locally; synchronization status is separate from business completion. Persist the sale and the operation to synchronize durably, retaining employee/branch attribution and a stable identifier. The shared-inventory rule remains in force; per-branch stock balances are not authorized.

The first offline rollout supports cached product lookup, cart editing, and completed cash sales. Stock receiving, price changes, permission changes, and online-order confirmation require a connection initially. The user accepted this operation scope in Q10.

Q46 adds the operating policy: existing signed-in employees can complete sales with cached prices, still-valid cached offers, and manual discounts; fresh offline login is not supported initially. Apply account disablement when the device reconnects while preserving completed sales. The blueprint proposes offline continuation, reconnect revalidation and recovery rules for final review. A later price update must not silently reprice a completed transaction during synchronization.

Physical sales outrank pending online requests, which a representative can decline after checking availability through the agreed WhatsApp workflow. Before confirming, the representative physically sets aside the items; confirmed items are then protected from both physical and online sales. See [ADR-0002](../adr/0002-protect-confirmed-online-items.md). A stale browser view does not authorize selling merchandise physically reserved for another customer.

The website can only react to stock information it has received. It caps a size/color quantity at known availability and disables a variant with none available. A product marked Available becomes Out of Stock automatically when all its sellable variants are unavailable; keep it listed and its product page viewable with an Out of Stock label, while blocking ordering. Restore its effective availability when stock returns. Managers may instead choose Coming Soon for public preview without ordering or Hidden to exclude it from the public store; those website visibility choices alone do not block POS sales with sufficient available stock.

Revalidate an existing cart when submitted: a previously valid selection does not authorize ordering more than currently known stock. During a branch outage, an uncommunicated sale may leave the public view temporarily stale; shortages discovered after a valid submission are handled through WhatsApp before confirmation.

Browser Background Sync is an optional synchronization aid: [MDN documents limited availability](https://developer.mozilla.org/en-US/docs/Web/API/Background_Synchronization_API). Provide a supported foreground/reconnection synchronization path and visible pending/failure states instead of relying solely on a background event.

## 5. Module Federation

Module Federation is deferred by the user's explicit agreement to the Q7 recommendation. Use strong feature boundaries and code splitting initially. No independently released runtime modules have been identified as a current requirement.

Federation composes modules from separate builds at runtime, as described by [webpack's official documentation](https://webpack.js.org/concepts/module-federation/). It is distinct from organizing source code into feature modules.

Revisit federation when a concrete requirement arises for independently released modules within one composed application. At that point, identify the host and release boundaries and define how shared dependencies, unavailable remote modules, and compatible versions are handled.

If federation is used in an offline-capable POS, essential modules must be available locally with a compatible version set. A disconnected checkout cannot depend on downloading a previously unloaded remote module.

Do not add federation runtime configuration or select a bundler solely to satisfy the original request; this later deferral is the current decision.

## 6. Code splitting and dynamic imports

Split code at useful application/route/feature boundaries, and load heavy optional features only when needed. For example, report-export functionality should not be part of the cashier's initial screen load. Evaluate dynamic imports using the chosen bundler; [webpack's code-splitting guide](https://webpack.js.org/guides/code-splitting/) illustrates the mechanism without committing BRAVOS to webpack.

Keep the critical POS path available for the intended connectivity mode. Before enabling offline work, ensure its required code and assets have been cached; arbitrary lazy loading is not an offline guarantee.

Check the resulting production bundles to verify intended separation. Code splitting and hiding UI controls do not replace server-enforced authorization or public-data filtering.

## Before the first feature is implemented

Support desktop/tablet POS and phone-friendly management/storefront views. Completed-order reports show completed orders and final values; keep pending/confirmed orders in their operational workflow. Do not build courier receivables, remittance, settlement, or fee-reconciliation models. Checkout area fees and generic delivery statuses remain. Merchandise management profit uses retained batch costs and branch expenses; tax/VAT handling and courier-margin accounting are excluded. Use Cairo dates/calendar months and show returns in their processing period with original-sale links. Analytics remain aggregate visits/views/cart additions/orders/completed sales without individual profiles.

Manual backups are password-protected business-data downloads, saved outside the browser, without image binaries. Preserve image references without claiming to recover deleted images. Reconcile queued/newer sales and pause writes before manager-only preview/confirmed restoration; never silently overwrite newer activity. Exact portable format and identity recovery depend on selected services. Initial CSV import preserves opening cost batches and configuration without old paper sales history; launch internal operations before the public store after verification.

The user will book the domain and hosting after website completion. Local development, feature verification, and portable deployment preparation must not require purchasing either first. Research options now, but leave reservations and production deployment to that later stage.

- Resolve the current order, connectivity, and deployment decisions that affect the first slice.
- Select the runtime, data store, identity approach, and deployment target with explicit rationale.
- Define feature ownership, public interfaces, and permitted dependencies.
- Add automated import-boundary/cycle checks and verify the domain layer can be exercised independently of infrastructure.
- Define atomic stock-changing operations and duplicate-submission handling.
- Establish application boundaries for public and privileged code and verify the initial bundle split.

These are preparation requirements. They have been documented; no runtime architecture, sync engine, federation setup, or application checks have been implemented yet.
