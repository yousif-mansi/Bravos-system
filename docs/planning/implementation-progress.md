# BRAVOS implementation progress

Updated: 2026-09-08. The user approved the reviewed specification and asked to start implementation through Grok. The agreed delivery order is receiving-to-cash-sale first, then offline and internal workflows, then storefront/orders and release verification. No hosting or domain purchase is authorized now.

## Source and delivery status

- Specification: [approved v1 specification](bravos-v1-spec.md), 114 stories and 36 acceptance scenarios.
- Independent review: [review disposition](../reviews/bravos-v1-grok-review.md).
- GitHub source of truth: publication pending; GitHub API access failed twice with TLS/connection errors, including outside the sandbox. Local prepared issue bodies must not be mistaken for published issues.
- Implementation: preparing the first Grok brief; no application code or passing application tests yet.
- Testing: authenticated public HTTP business operations against real PostgreSQL; focused real-browser recovery/interface tests; automated architecture checks.

## Delivery queue

Each item includes its necessary schema, business behavior, API, usable UI and behavior verification. Shared infrastructure is introduced only as needed by these workflows. References identify the owning ticket; later tickets may extend the same scenario.

| ID | End-to-end deliverable | Blocked by | Stories / acceptance scenarios | Status |
| --- | --- | --- | --- | --- |
| 01 | Personal staff sign-in, manager provisioning and authorized branch selection | None | 2–6, 9–10, 62, 104–107 / A01, A02, A33 | Prepared |
| 02 | Manager product/variant/price maintenance and cashier code lookup | 01 | 11–15, 20, 25, 31 / A01, A03 | Queued |
| 03 | Receive merchandise into separate FIFO cost batches and view central stock | 02 | 21–24, 29–30 / A03–A05 | Queued |
| 04 | Complete attributed cash sales with employee deductions and retained paid values | 03 | 7–8, 32–40, 42 / A06–A09, A12 | Queued |
| 05 | Cached POS and durable offline completed sales | 04 | 43–47 / A17–A19 | Queued |
| 06 | Reconnect, acknowledge/rebase, multi-tab safety and restricted-account recovery | 05 | 48–50 / A12, A17–A20 | Queued |
| 07 | Employee expenses with manager corrections and immediate totals | 01 | 7–8, 89–92 / A27 | Queued |
| 08 | Manager automatic offers and greatest-saving basket pricing | 04 | 36–39, 108, 112 / A08–A09, A34 | Queued |
| 09 | Fixed bundles and Buy-X-Get-Y with retained reward paid values | 08 | 109 / A09, A34, A36 | Queued |
| 10 | Manager coupons, cashier application and duplicate-safe usage limits | 08 | 110–113 / A08, A10, A34 | Queued |
| 11 | Offline promotions and coupon discrepancy reconciliation | 06, 09, 10 | 44, 48, 113 / A10, A20 | Queued |
| 12 | Dedicated physical Returns, original lookup, inspection and editable refunds | 04 | 75–87 / A21–A25 | Queued |
| 13 | Exchanges with replacement availability and actual cash differences | 12, 09, 10 | 88 / A26, A36 | Queued |
| 14 | Manager sale/return recording corrections with actual stock/cash effects | 12 | 41, 79, 87 / A16, A21, A24 | Queued |
| 15 | Receiving quantity/cost corrections carried through sales and returns | 03, 12 | 26, 83, 95 / A16, A25 | Queued |
| 16 | Coordinated quantity corrections and late-sale reconciliation | 06, 15 | 27–28, 48 / A20, A32 | Queued |
| 17 | Product images, size guides, publication controls and safe public catalog | 03 | 11, 16–19, 50 / A02, A04 | Queued |
| 18 | Arabic storefront browsing, search, variants and persistent guest cart | 17 | 51–54, 60, 62, 105–106 / A02, A04, A33 | Queued |
| 19 | Delivery-area administration and valid guest COD requests | 18, 09, 10 | 55–59, 61, 64, 111, 114 / A06, A10, A13, A29, A35 | Queued |
| 20 | Representative WhatsApp workflow, basket revisions and atomic confirmation | 19, 06 | 63, 65–67, 71–73 / A01, A11, A13–A14 | Queued |
| 21 | Shipment, delivery, cancellation and inspected failed-parcel closure | 20 | 68–70, 74, 113 / A14–A16, A36 | Queued |
| 22 | Delivered online Returns/exchanges with delivery-charge breakdown | 12, 13, 21 | 76–88, 97 / A21–A26, A29, A36 | Queued |
| 23 | Manager branch/channel dashboards, profit, stock value and operational reports | 07, 11, 14, 15, 16, 22 | 1, 8–10, 39–40, 74, 93–97 / A05, A28–A29 | Queued |
| 24 | Permitted PDF/Excel exports and aggregate storefront analytics | 23, 18 | 98–99 / A02, A30 | Queued |
| 25 | Validated opening CSV import of products, cost batches and configuration | 03, 10, 19 | 103 / A31 | Queued |
| 26 | Coherent password-protected data-only backup download | 23, 25 | 100–101 / A31 | Queued |
| 27 | Staged restore, preview and recovery of newer/queued work | 26, 16 | 4, 49, 102 / A19–A20, A31–A32 | Queued |
| 28 | Full local release rehearsal, Arabic/device checks and portable deployment guide | 24, 27 | 104–107 / A01–A36 | Queued |

## First implementation contract

Ticket 01 supplies a working local staff application, real authentication and branch authorization. It must demonstrate a manager creating an employee without requiring employee email, the employee signing in and selecting an assigned branch, and server rejection of unassigned branch and manager-only operations. Manager reset/disable and separate owner recovery must work through the identity adapter. The public application has a separate entry/build with no staff interface. Stock, POS and storefront selling arrive in later tickets; the first slice must not present invented sales or inventory as working data.

Grok writes application code; the orchestrator reviews the actual diff, reruns gates and commits only verified work. A ticket remains incomplete if the database, authentication, browser behavior or required checks cannot be verified. No production readiness claim follows from a scaffold alone.

## Review notes

- Approval accepts the reviewed coupon/reward defaults, exchange-credit/cash separation and historical-cost correction behavior. See the review disposition and full spec for exact rules.
- All existing planning files predate application delegation and must be preserved.
- Current environment has Node, pnpm, Git and Grok. PostgreSQL, psql and Docker were not found on PATH. The foundation must establish a real isolated local PostgreSQL test target without touching another database or installing a machine-wide service without permission.
- Domain/hosting, real staff credentials, product photos and opening business data remain launch configuration.
