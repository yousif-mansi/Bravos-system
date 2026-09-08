# BRAVOS implementation progress

Updated: 2026-09-08. The user approved the reviewed specification and asked to start implementation through Grok. The agreed delivery order is receiving-to-cash-sale first, then offline and internal workflows, then storefront/orders and release verification. No hosting or domain purchase is authorized now.

## Source and delivery status

- Specification: [approved v1 specification](bravos-v1-spec.md), 114 stories and 36 acceptance scenarios.
- Independent review: [review disposition](../reviews/bravos-v1-grok-review.md).
- GitHub source of truth: [approved specification #1](https://github.com/yousif-mansi/Bravos-system/issues/1) and implementation issues #2–#29, with native blocking dependencies. Initial network timeouts recovered. Local ticket bodies mirror the published work; GitHub status is authoritative.
- Implementation: Grok generated uncommitted code for [staff access #2](https://github.com/yousif-mansi/Bravos-system/issues/2), session 01a08245-a92f-7bc1-b68c-f8dd271b1e58. Repeated dependency-download failures prevented installation. The resumed session then stalled before producing any tool calls or text. Both process trees were stopped; no delegation remains running. Source review found required fixes, and no application tests have passed.
- Testing: authenticated public HTTP business operations against real PostgreSQL; focused real-browser recovery/interface tests; automated architecture checks.
- Publication verification: the specification and all 28 ticket bodies match GitHub; ready-for-agent labels and every native blocking edge were independently read back and checked. All 114 stories and all 36 acceptance scenarios are assigned before the release rehearsal.

## Delivery queue

Each item includes its necessary schema, business behavior, API, usable UI and behavior verification. Shared infrastructure is introduced only as needed by these workflows. References identify the owning ticket; later tickets may extend the same scenario.

| ID | End-to-end deliverable | Blocked by | Stories / acceptance scenarios | Status |
| --- | --- | --- | --- | --- |
| [01](https://github.com/yousif-mansi/Bravos-system/issues/2) | Personal staff access and authorized branch selection | None | 2, 3, 4, 5, 6, 9, 10, 62, 104, 105, 106, 107 / A01, A02, A21, A33 | Blocked on installation/connectivity; code needs fixes |
| [02](https://github.com/yousif-mansi/Bravos-system/issues/3) | Manage products and variants with cashier product-code lookup | 01 | 11, 12, 13, 14, 15, 20, 25, 31 / A01, A02, A03 | Queued |
| [03](https://github.com/yousif-mansi/Bravos-system/issues/4) | Receive merchandise and inspect central stock with separate FIFO batches | 02 | 21, 22, 23, 24, 29, 30 / A03, A05, A12 | Queued |
| [04](https://github.com/yousif-mansi/Bravos-system/issues/5) | Complete attributed cash sales with employee discounts and retained paid values | 03 | 7, 8, 32, 33, 34, 35, 36, 37, 38, 39, 40, 42 / A05, A06, A07, A08, A09, A12 | Queued |
| [05](https://github.com/yousif-mansi/Bravos-system/issues/6) | Keep cached POS and completed cash sales durable during outages | 04 | 43, 44, 45, 46, 47 / A17, A19 | Queued |
| [06](https://github.com/yousif-mansi/Bravos-system/issues/7) | Synchronize completed sales with safe acknowledgements and account recovery | 05 | 48, 49, 50 / A12, A17, A18, A19, A20, A21 | Queued |
| [07](https://github.com/yousif-mansi/Bravos-system/issues/8) | Record employee expenses and manager corrections with immediate totals | 01 | 7, 8, 89, 90, 91, 92 / A01, A02, A27 | Queued |
| [08](https://github.com/yousif-mansi/Bravos-system/issues/9) | Manage automatic offers and select the greatest eligible saving | 04 | 36, 37, 38, 39, 108, 112 / A08, A09, A10, A34 | Queued |
| [09](https://github.com/yousif-mansi/Bravos-system/issues/10) | Price fixed bundles and cheapest eligible Buy-X-Get-Y rewards | 08 | 109 / A09, A10, A34, A36 | Queued |
| [10](https://github.com/yousif-mansi/Bravos-system/issues/11) | Apply manager-configured coupons with atomic usage limits | 08 | 110, 111, 112, 113 / A08, A09, A10, A12, A34 | Queued |
| [11](https://github.com/yousif-mansi/Bravos-system/issues/12) | Use cached promotions and reconcile offline coupon overuse | 06, 09, 10 | 44, 48, 113 / A10, A17, A20 | Queued |
| [12](https://github.com/yousif-mansi/Bravos-system/issues/13) | Process dedicated physical Returns with inspection and editable refunds | 04 | 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87 / A23, A24, A25 | Queued |
| [13](https://github.com/yousif-mansi/Bravos-system/issues/14) | Complete exchanges with replacement stock and actual cash differences | 12, 09, 10 | 88 / A06, A25, A26, A36 | Queued |
| [14](https://github.com/yousif-mansi/Bravos-system/issues/15) | Correct erroneous saved sales and Returns while preserving actual effects | 12 | 41, 79, 87 / A12, A24, A25 | Queued |
| [15](https://github.com/yousif-mansi/Bravos-system/issues/16) | Correct receiving quantities and historical costs through linked records | 03, 12 | 26, 83, 95 / A22, A25 | Queued |
| [16](https://github.com/yousif-mansi/Bravos-system/issues/17) | Coordinate quantity corrections and reconcile late completed sales | 06, 15 | 27, 28, 48 / A20, A22 | Queued |
| [17](https://github.com/yousif-mansi/Bravos-system/issues/18) | Manage product media and publication with a safe public catalog | 03 | 11, 16, 17, 18, 19, 50 / A02, A03, A04 | Queued |
| [18](https://github.com/yousif-mansi/Bravos-system/issues/19) | Browse the Arabic storefront and maintain a valid guest cart | 17 | 51, 52, 53, 54, 60, 62, 105, 106 / A02, A04, A06, A33 | Queued |
| [19](https://github.com/yousif-mansi/Bravos-system/issues/20) | Configure delivery areas and submit validated guest COD requests | 18, 09, 10 | 55, 56, 57, 58, 59, 61, 64, 111, 114 / A06, A10, A13, A29, A35 | Queued |
| [20](https://github.com/yousif-mansi/Bravos-system/issues/21) | Confirm WhatsApp-agreed online orders with protected FIFO allocations | 19, 06 | 63, 65, 66, 67, 71, 72, 73 / A01, A10, A11, A13, A14, A16 | Queued |
| [21](https://github.com/yousif-mansi/Bravos-system/issues/22) | Fulfill online orders and close inspected failed deliveries | 20 | 68, 69, 70, 74, 113 / A10, A14, A15, A16, A36 | Queued |
| [22](https://github.com/yousif-mansi/Bravos-system/issues/23) | Handle delivered online Returns and exchanges with exact refund breakdowns | 12, 13, 21 | 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88, 97 / A23, A24, A25, A26, A29, A36 | Queued |
| [23](https://github.com/yousif-mansi/Bravos-system/issues/24) | Show manager operational reports with historical-cost profit and stock value | 07, 11, 14, 15, 16, 22 | 1, 8, 9, 10, 39, 40, 74, 93, 94, 95, 96, 97 / A02, A05, A28, A29 | Queued |
| [24](https://github.com/yousif-mansi/Bravos-system/issues/25) | Export authorized reports and show aggregate storefront analytics | 23, 18 | 98, 99 / A02, A30, A33 | Queued |
| [25](https://github.com/yousif-mansi/Bravos-system/issues/26) | Preview and import opening products, separate cost batches and configuration | 03, 10, 19 | 103 / A03, A05, A32 | Queued |
| [26](https://github.com/yousif-mansi/Bravos-system/issues/27) | Download coherent password-protected business-data backups | 23, 25 | 100, 101 / A02, A31 | Queued |
| [27](https://github.com/yousif-mansi/Bravos-system/issues/28) | Preview staged restoration and reconcile newer or queued activity | 26, 16 | 4, 49, 102 / A19, A20, A21, A31, A32 | Queued |
| [28](https://github.com/yousif-mansi/Bravos-system/issues/29) | Rehearse the full local release and document portable deployment | 24, 27 | 104, 105, 106, 107 / A01, A02, A03, A04, A05, A06, A07, A08, A09, A10, A11, A12, A13, A14, A15, A16, A17, A18, A19, A20, A21, A22, A23, A24, A25, A26, A27, A28, A29, A30, A31, A32, A33, A34, A35, A36 | Queued |

## First implementation contract

Ticket 01 supplies a working local staff application, real authentication and branch authorization. It must demonstrate a manager creating an employee without requiring employee email, the employee signing in and selecting an assigned branch, and server rejection of unassigned branch and manager-only operations. Manager reset/disable and separate owner recovery must work through the identity adapter. The public application has a separate entry/build with no staff interface. Stock, POS and storefront selling arrive in later tickets; the first slice must not present invented sales or inventory as working data.

Grok writes application code; the orchestrator reviews the actual diff, reruns gates and commits only verified work. A ticket remains incomplete if the database, authentication, browser behavior or required checks cannot be verified. No production readiness claim follows from a scaffold alone.

## Review notes

- Planning is committed and pushed at `2c8aaf2` and `3918ce5`. Application changes remain uncommitted because their required checks could not run and static review found defects.
- [Independent staff-access review](../reviews/staff-access-implementation-review.md) records separate Standards and Spec findings. Do not close issue #2 or advance its dependent tickets as if it passed.
- Resume using the preserved Grok brief and review corrections under `.scratch/grok-implementation/`; do not reuse stopped terminal-task IDs or assume a completed relay result exists after process-tree termination. No first-run red-before-green execution occurred; do not fabricate that evidence.
- A later npm lookup returned pnpm `10.34.5`. Testing a locally installed compatible pnpm 10 transport is a possible next diagnostic, not a verified fix. Preserve the approved pnpm architecture and restore portable dependency pins/workspace references before generating a reproducible lockfile.
- Checkpoint: no `node_modules`, `pnpm-lock.yaml` or `package-lock.json` exists. Some downloaded tarballs are retained under ignored `.local/`; current manifest references to them are temporary and not suitable for a clean checkout.

- Approval accepts the reviewed coupon/reward defaults, exchange-credit/cash separation and historical-cost correction behavior. See the review disposition and full spec for exact rules.
- All existing planning files predate application delegation and must be preserved.
- Current environment has Node, pnpm, Git and Grok. PostgreSQL, psql and Docker were not found on PATH. The foundation must establish a real isolated local PostgreSQL test target without touching another database or installing a machine-wide service without permission.
- Domain/hosting, real staff credentials, product photos and opening business data remain launch configuration.
