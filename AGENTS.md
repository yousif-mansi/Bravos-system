# BRAVOS agent instructions

Read `bravos.md` before architecture, technology selection, database design, or implementation. It is the business-requirements baseline; follow later explicit user corrections when they change it.

## Business rules

**2026-09-29 superseding update:** Follow [Phase 1 operational updates](docs/planning/phase-1-operational-updates.md) for the latest user-requested changes. Branch stock is now separate; POS supports cash/manual online/split payment; online sales recognition moves to confirmation with cancellation/failed-delivery reversals. Inventory-first intake, readable transaction references, return phone lookup and action feedback are authorized. One branch must fulfill a whole online order; Products controls online visibility of existing variant pairs without removing POS/inventory variants; a sellable return restocks its receiving branch while retaining original cost and sale attribution. Older conflicting bullets below describe the previous v1 baseline. Existing data is disposable, but use a fresh isolated database for implementation verification rather than silently reassigning central stock.

- Both physical branches and the online store consume one shared central inventory. Keep branch sales, employees, expenses, and reporting distinct.
- Every physical sale records its branch and employee. Physical sales are cash only; online orders are cash on delivery with guest checkout.
- Customer name and phone are optional for physical cash sales. Online checkout requires name, primary mobile, area, and detailed address; alternate phone, landmark, and notes are optional. Delivery areas/fees are manager-configured.
- Employees choose an EGP deduction after offers without a manager-set cap or amount-based approval, including on promotional items. Allow a zero total, reject a negative total, and preserve employee attribution plus original/discount/final amounts in sale details and manager reports. The reason is optional. Split the shared discount equally in the accepted two-item example: 300 and 200 with 50 off gives 275 and 175. General unit allocation/rounding is proposed in the implementation blueprint. This does not grant catalog-price changes, promotion management, or edits to completed sales.
- A physical sale is final once the customer has received the items and paid, including during an outage. Synchronization records that completed sale; it must not silently discard it because an online request or stale stock balance conflicts.
- Physical sales take priority over pending online orders. Before WhatsApp confirmation, the assigned representative locates and physically sets aside the items; after confirmation, those items are protected from other physical and online sales. The manager is the representative's backup.
- Deduct available stock automatically when the responsible user marks an online order Confirmed after WhatsApp confirmation. Shipped and Delivered must not deduct it again. A failed-delivery parcel stays unavailable until staff physically receive and inspect it, restoring only sellable quantities once.
- Validate quantities per size/color in both POS and online checkout. Do not knowingly accept three units when only two are available; include all lines for the same variant in that check. Recheck online availability at submission and staff confirmation; later shortages are handled with the customer through WhatsApp.
- A representative may manually cancel an unanswered pending request after 48 hours and at least two contact attempts, recording the reason. The waiting period is configurable; pending requests hold no stock.
- The first offline rollout covers cached product lookup, cart editing, and completed cash sales. Stock receiving, price/permission changes, and online-order confirmation require a connection initially.
- Already-signed-in employees may sell with cached prices, still-valid cached offers, and manual discounts. No fresh offline login initially; account disablement takes effect on reconnection, preserving earlier completed sales. Proposed session/recovery rules are in `docs/planning/implementation-blueprint.md` for final review.
- The website disables unavailable size/color variants while allowing stocked variants. A publicly available product is Out of Stock when all its sellable variants are unavailable; it remains listed and browsable with the label on its product page, but cannot be ordered.
- Managers may choose Coming Soon (public preview, no online ordering) or Hidden (excluded from the public store). These website statuses do not by themselves prevent an authorized POS sale with sufficient available stock.
- Alert at three available units or fewer by default, with a configurable default and a manager-set threshold per variant.
- Stock adjustments are online and manager-only, with previous/corrected available quantities, reason, actor, and time recorded. Cashiers cannot bypass quantity limits. Confirmed/set-aside items are excluded from the available count being corrected.
- Before finalizing quantity corrections, synchronize known tills and briefly pause stock-changing work. Preserve late-arriving sales and flag discrepancies. Full stock-count sessions/comparison screens are deferred.
- Cost prices and internal business data must never be exposed through public pages or public APIs.
- Internally, purchase costs, profit figures, and inventory value are owner/manager-only. Ordinary cashiers and order representatives receive selling prices and available quantities, without restricted cost data in responses or offline caches.
- Employees may view their own sales; the manager may view all employees, both branches, and combined totals. One personal account may operate across the branches assigned by the manager; show the active branch clearly and attribute each sale to that branch and employee.
- Stock receiving is manager-only and finalized online; employees may assist with the physical count without access to purchase costs. Saved receiving corrections retain original values, reason, actor/time, and reconcile intervening stock movements.
- Preserve separate purchase-cost batches for a variant; never average new and old costs or overwrite older batch costs. Allocate from the oldest available batch first (FIFO), and restore sellable returns to their original allocated batches. Available quantities still sum into one central inventory; see `docs/adr/0003-preserve-purchase-cost-batches.md`.
- Both managers and employees may record branch expenses. Employees use their active authorized branch and see only their own expense records; managers see both branches and all employees. Saved expenses count in reports immediately without approval. Only the manager may correct/cancel a saved expense, retaining original details, reason, actor/time, and applying its reporting change once.
- Only a manager may correct or cancel an erroneous completed sale, retaining the original record and a linked correction with reason, actor, and time. Apply the actual stock and total corrections once; do not hard-delete completed sales. Customer returns and refunds require separate policies.
- Provide a dedicated internal Returns section with original-transaction selection and linked details, separate from POS checkout. Support either branch and delivered online purchases, partial unreturned quantities, inspection, sellable-stock restoration once, and cash refunds Owed/Paid. Use a 14-day in-system window from receipt; later defect cases are handled externally through WhatsApp. Suggest the amount actually paid without a second discount deduction (850 paid means 850); the manager can edit the final refund amount. Preserve suggested and actual amounts, use the actual recorded refund in reports, and do not introduce a new manager cap or mandatory override reason. See `docs/planning/returns.md`.
- Default to one automatic offer plus one eligible coupon with manager-controlled combination settings; employees can still add a POS discount. Catalog prices default per product with optional size/color overrides, consistent across both branches and the website. Categories/sizes/colors are editable and product size guides optional.
- Completed-order reports show completed orders and their final values. Do not add shipping-company receivables, remittances, settlements, fee reconciliation, or similar accounting. Existing delivery statuses and customer-facing checkout area fees remain. Management merchandise profit uses retained batch costs and branch expenses; tax/VAT handling is excluded.
- Select the greatest-saving eligible automatic offer under manager settings, then coupon, then employee POS deduction. Fixed bundles define contents/prices; Buy-X-Get-Y uses the cheapest eligible reward units. Count coupon use at POS completion/online confirmation and release it once for cancelled undelivered orders. Use Cairo dates and preserve accepted transaction prices.
- The required manual backup contains business data; image binaries are not required. Restore is manager-only with preview/confirmation. Keep image references without claiming a data-only backup restores missing files.
- Staff have manager-created personal login-name/password accounts with manager reset and separate owner recovery. Preserve queued sales across logout/updates, show unsynchronized counts, and retry on reconnection. Backups are password-protected data downloads saved outside the browser; reconcile queued/newer sales and pause writes before preview/confirmed restoration.
- Public storefront and internal dashboard/POS/Returns have separate entry URLs. Internal screens are absent from customer navigation and require authentication; both applications share the business backend and central inventory.
- Prioritize desktop/tablet POS and phone-friendly management/storefront views. Use a photography-led neutral storefront and light, high-contrast internal screens. Analytics are aggregate visits/views/cart additions/orders/completed sales, without individual visitor profiles.
- Start with CSV-supported product/current-stock/cost/configuration import, without importing old paper sales history. Launch internal operations before the public store after verifying stock and workflows.
- Domain and hosting will be booked after website completion. Design for local development first; do not purchase/book hosting or a domain now.
- Enforce role permissions for sensitive actions and attribute important operations to the responsible user.
- Arabic is the primary interface language. Keep employee workflows simple.
- Do not invent unresolved business policies. Consult section 31 of `bravos.md` and `docs/planning/kickoff.md` before finalizing affected features.
- Keep configurable business data, including prices, delivery fees, categories, promotion rules, and low-stock thresholds, out of hard-coded application logic.

## Architecture and ongoing decisions

Read `docs/planning/discovery.md` for confirmed user decisions and unresolved proposals. Confirmed later decisions refine the original brief; recommendations marked as pending are not approved requirements.

All 63 numbered business questions are answered. On 2026-09-08 the user approved the reviewed `docs/planning/bravos-v1-spec.md`, including the stack, operational defaults and testing boundaries, and instructed implementation through the Grok delegation skill. The spec supersedes historical pending/proposed wording in supporting planning documents. Follow `docs/planning/implementation-progress.md` for ticket and verification status. Local implementation is authorized; domain/hosting booking remains deferred. Do not reopen the numbered interview for ordinary technical choices already made explicit in the approved spec.

The complete to-spec review body is `docs/planning/bravos-v1-spec.md`. It includes confirmed business scope and clearly marked implementation/testing proposals, pending the user's final review before GitHub publication.

During the requirements interview, use larger rounds covering the currently answerable decisions and show the remaining scope/count in `docs/planning/questionnaire.md`. The user explicitly rejected the slow three-question cadence. Group related details, keep launch configuration separate, and do not reopen settled choices.

Follow `docs/architecture/principles.md` before feature implementation. The user requires Clean Architecture, feature-based modules, clean imports, planning for Local-First Architecture, and code splitting/dynamic imports. Module Federation is deferred by user agreement; revisit it when independent runtime releases are needed.

Enforce feature public interfaces and inward dependencies with automated import/cycle checks when the application stack is selected. Maintain one logical shared inventory, durable offline sale records, and atomic, duplicate-safe processing of each synchronized stock movement. Do not assume disconnected browsers can share an instantly consistent balance. See `docs/adr/0001-complete-physical-sales-offline.md`.

## Agent skills

### Issue tracker

Issues and specs live in GitHub Issues for `yousif-mansi/Bravos-system`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the five default triage labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, and `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Use a single-context layout: root `CONTEXT.md` and `docs/adr/`. See `docs/agents/domain.md`.
