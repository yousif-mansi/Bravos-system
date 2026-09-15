# BRAVOS implementation progress

Updated: 2026-09-15 (Cairo). The user authorized the full 28-ticket queue and now requests parallel native GPT-5.6 Sol agents at HIGH effort. Root guides, reviews, independently verifies and commits accepted slices. Internal operations launch before the public store. No hosting or domain purchase is authorized now.

Current work: Twenty of 28 tickets are independently accepted: 01–20. Ticket 20 adds WhatsApp-agreed order revisions, protected FIFO confirmation, contact attempts and manual unreachable cancellation through the Arabic staff interface. Three Sol HIGH implementers delivered Inventory, backend and UI slices; root integrated them and resolved both review axes. Verification passed 170 HTTP tests, 85 existing browser regressions plus the repaired ticket-20 browser recheck, typecheck, production builds/bundle separation, architecture, migrations and audit. See the [order confirmation review](../reviews/order-confirmation-review.md). Ticket 21 (fulfillment/failed-delivery handling) and ticket 25 (opening import) are queued. No important features have been removed.

## Source and delivery status

- Specification: [approved v1 specification](bravos-v1-spec.md), 114 stories and 36 acceptance scenarios.
- Independent review: [review disposition](../reviews/bravos-v1-grok-review.md).
- GitHub source of truth: [approved specification #1](https://github.com/yousif-mansi/Bravos-system/issues/1) and implementation issues #2–#29, with native blocking dependencies. Initial network timeouts recovered. Local ticket bodies mirror the published work; GitHub status is authoritative.
- Implementation: Twenty of 28 tickets (01–20) are independently verified. Native GPT-5.6 Sol agents at HIGH effort write application code and tests; root guides, reviews, verifies and commits. The accepted slices include offline cash sales, promotions/coupons, Returns/exchanges, corrections, storefront browsing, guest checkout and protected online confirmation. The remaining queue covers fulfillment, online Returns, reporting/export, opening import, backup/restore and release rehearsal. This is a local development milestone, not a production release.
- Testing: authenticated public HTTP business operations against real PostgreSQL; focused real-browser recovery/interface tests; automated architecture checks.
- Publication verification: the specification and all 28 ticket bodies match GitHub; ready-for-agent labels and every native blocking edge were independently read back and checked. All 114 stories and all 36 acceptance scenarios are assigned before the release rehearsal.

## Delivery queue

Each item includes its necessary schema, business behavior, API, usable UI and behavior verification. Shared infrastructure is introduced only as needed by these workflows. References identify the owning ticket; later tickets may extend the same scenario.

| ID | End-to-end deliverable | Blocked by | Stories / acceptance scenarios | Status |
| --- | --- | --- | --- | --- |
| [01](https://github.com/yousif-mansi/Bravos-system/issues/2) | Personal staff access and authorized branch selection | None | 2, 3, 4, 5, 6, 9, 10, 62, 104, 105, 106, 107 / A01, A02, A21, A33 | Independently verified |
| [02](https://github.com/yousif-mansi/Bravos-system/issues/3) | Manage products and variants with cashier product-code lookup | 01 | 11, 12, 13, 14, 15, 20, 25, 31 / A01, A02, A03 | Independently verified |
| [03](https://github.com/yousif-mansi/Bravos-system/issues/4) | Receive merchandise and inspect central stock with separate FIFO batches | 02 | 21, 22, 23, 24, 29, 30 / A03, A05, A12 | Independently verified |
| [04](https://github.com/yousif-mansi/Bravos-system/issues/5) | Complete attributed cash sales with employee discounts and retained paid values | 03 | 7, 8, 32, 33, 34, 35, 36, 37, 38, 39, 40, 42 / A05, A06, A07, A08, A09, A12 | Independently verified |
| [05](https://github.com/yousif-mansi/Bravos-system/issues/6) | Keep cached POS and completed cash sales durable during outages | 04 | 43, 44, 45, 46, 47 / A17, A19 | Independently verified |
| [06](https://github.com/yousif-mansi/Bravos-system/issues/7) | Synchronize completed sales with safe acknowledgements and account recovery | 05 | 48, 49, 50 / A12, A17, A18, A19, A20, A21 | Independently verified |
| [07](https://github.com/yousif-mansi/Bravos-system/issues/8) | Record employee expenses and manager corrections with immediate totals | 01 | 7, 8, 89, 90, 91, 92 / A01, A02, A27 | Independently verified |
| [08](https://github.com/yousif-mansi/Bravos-system/issues/9) | Manage automatic offers and select the greatest eligible saving | 04 | 36, 37, 38, 39, 108, 112 / A08, A09, A10, A34 | Independently verified |
| [09](https://github.com/yousif-mansi/Bravos-system/issues/10) | Price fixed bundles and cheapest eligible Buy-X-Get-Y rewards | 08 | 109 / A09, A10, A34, A36 | Independently verified |
| [10](https://github.com/yousif-mansi/Bravos-system/issues/11) | Apply manager-configured coupons with atomic usage limits | 08 | 110, 111, 112, 113 / A08, A09, A10, A12, A34 | Independently verified |
| [11](https://github.com/yousif-mansi/Bravos-system/issues/12) | Use cached promotions and reconcile offline coupon overuse | 06, 09, 10 | 44, 48, 113 / A10, A17, A20 | Independently verified |
| [12](https://github.com/yousif-mansi/Bravos-system/issues/13) | Process dedicated physical Returns with inspection and editable refunds | 04 | 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87 / A23, A24, A25 | Independently verified |
| [13](https://github.com/yousif-mansi/Bravos-system/issues/14) | Complete exchanges with replacement stock and actual cash differences | 12, 09, 10 | 88 / A06, A25, A26, A36 | Independently verified |
| [14](https://github.com/yousif-mansi/Bravos-system/issues/15) | Correct erroneous saved sales and Returns while preserving actual effects | 12 | 41, 79, 87 / A12, A24, A25 | Independently verified |
| [15](https://github.com/yousif-mansi/Bravos-system/issues/16) | Correct receiving quantities and historical costs through linked records | 03, 12 | 26, 83, 95 / A22, A25 | Independently verified |
| [16](https://github.com/yousif-mansi/Bravos-system/issues/17) | Coordinate quantity corrections and reconcile late completed sales | 06, 15 | 27, 28, 48 / A20, A22 | Independently verified |
| [17](https://github.com/yousif-mansi/Bravos-system/issues/18) | Manage product media and publication with a safe public catalog | 03 | 11, 16, 17, 18, 19, 50 / A02, A03, A04 | Independently verified |
| [18](https://github.com/yousif-mansi/Bravos-system/issues/19) | Browse the Arabic storefront and maintain a valid guest cart | 17 | 51, 52, 53, 54, 60, 62, 105, 106 / A02, A04, A06, A33 | Independently verified |
| [19](https://github.com/yousif-mansi/Bravos-system/issues/20) | Configure delivery areas and submit validated guest COD requests | 18, 09, 10 | 55, 56, 57, 58, 59, 61, 64, 111, 114 / A06, A10, A13, A29, A35 | Independently verified |
| [20](https://github.com/yousif-mansi/Bravos-system/issues/21) | Confirm WhatsApp-agreed online orders with protected FIFO allocations | 19, 06 | 63, 65, 66, 67, 71, 72, 73 / A01, A10, A11, A13, A14, A16 | Independently verified |
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

Native GPT-5.6 Sol agents write application code; the orchestrator reviews the actual diff, reruns relevant gates and commits only verified work. A ticket remains incomplete if the database, authentication, browser behavior or required checks cannot be verified. No production readiness claim follows from a scaffold alone.

## Verification and review

- Completed ticket02 recovery: .scratch/grok-implementation/2026-09-11-catalog-run-3, scope brief .scratch/grok-implementation/02-catalog.md and six findings in .scratch/grok-implementation/02-review-corrections.md, baseline 78c5ad463baced46a37cf8d8ab321fcc150a75f1. The original run ended without a result; a resume stalled while loading damaged session history and was stopped before a fresh recovery dispatch. Existing working files are preserved. Staff issue #2 is closed after its verified commit was pushed; catalog issue #3 is closed after commit477b4f8 was pushed. Grok wrote the catalog implementation; independent review and gates passed before acceptance.

- Independent final checks passed on 2026-09-10 (Cairo): typecheck;26 HTTP tests against real PostgreSQL; all builds; architecture after build; migration apply/down/reapply and failing-runner rollback;4 browser flows; dependency audit with zero advisories.
- Browser coverage verifies employee login/branch selection, manager-created two-branch employee login, public/staff separation, and production staff-route code loading only when visited.
- Standards and Spec reviews are recorded in [staff-access repair review](../reviews/staff-access-repair-review.md). All actionable ticket01 findings were corrected and rechecked, including fresh-clone setup and generated-output exclusions that retain SDK import checks.
- Grok additionally verified fresh/repeated isolated setup and the compiled API health endpoint. Default development setup and first-time pnpm/browser installation are documented in [local setup](../development/local-setup.md).
- No initial red-before-green run occurred before the original scaffold; later regression repairs have executed red/green evidence. No retrospective TDD claim is made.
- Early network failures and timed-out delegation runs are retained under ignored `.scratch/grok-implementation`. The successful final application/verification sessions were run6, run7 and run8; no delegated process remains active at this checkpoint.
- The existing unrelated user edit in `docs/reviews/bravos-v1-grok-review.md` is preserved and excluded from the implementation commit. Credentials, databases, logs, downloads and generated outputs remain ignored.
- Central stock, POS/offline operations, returns, orders and reporting remain queued as shown above. Domain/hosting, real staff credentials, product photos and opening business data remain launch configuration. Production owner recovery remains a later configured delivery-adapter gate.

- Ticket02 independently passed on 2026-09-11: typecheck;38 HTTP tests in4 files; production builds; architecture after build; multi-migration apply/down/reapply and actual failed-runner rollback;6 browser flows; audit with zero advisories. Evidence: .scratch/grok-implementation/root-catalog-final-results.json. Review: [catalog review](../reviews/catalog-review.md).

- Ticket03 independently passed on 2026-09-11: typecheck;45 HTTP tests in5 files; production builds; architecture after build; migrations001–004 apply/down/reapply/full down/full reapply and actual failed-runner rollback;15 browser tests; audit with zero advisories. A supplemental real-browser diagnostic verified two same-staff submissions in separate tabs with lost responses, retained identities and exactly-once effects. Evidence: .scratch/grok-implementation/root-receiving-final-results.json and root-receiving-cross-tab.log. Review: [receiving review](../reviews/receiving-review.md).

- Delegation checkpoint: receiving run5 saved its final repair then exited1 with HTTP402, Grok Build usage balance exhausted. Root independently verified the saved code before acceptance. No Grok process remains active, and no substitute implementer was used. The user subsequently restored Grok availability; a fresh focused run is promoting the verified supplemental regression into the permanent suite before ticket04. Its draft brief and current GitHub snapshot are .scratch/grok-implementation/04-cash-sale-draft.md and 04-github-issue.json. A test-only brief (03-valid-marker-test.md) is also prepared to preserve the supplemental same-staff regression in the permanent suite. Do not claim the remaining25 tickets are implemented.


- Receiving regression follow-up: Grok promoted the supplemental same-staff two-operation browser diagnostic into the permanent suite. Root independently passed typecheck and all10 receiving browser tests; both review axes found no blocker. Application code is unchanged. Logs: .scratch/grok-implementation/root-receiving-regression-typecheck.log and root-receiving-regression-browser.log. Cash-sale brief .scratch/grok-implementation/04-cash-sale.md includes final pre-completion/retained-price/branch/retry clarifications.


- Active ticket04: .scratch/grok-implementation/2026-09-11-cash-sale-run-1; brief04-cash-sale.md; baseline 63ec02345cf3c0c12c3385729b6341c63fb30365. Grok is the sole code writer; root reviews and independently verifies before commit. Receiving regression commit63ec023 is pushed.

- Ticket04 initial Grok run completed and reported56 HTTP/18 browser tests plus other gates. Root did not accept that result: independent Standards/Spec source reviews found replay authorization, held-pool/concurrent-prepare, prevalidation resource use, shortage availability, unpaid cart state, completion time, recovery and submit-latch defects, plus incomplete stock-rollback evidence. See [cash-sale review](../reviews/cash-sale-review.md). Repair run2 is active in .scratch/grok-implementation/2026-09-11-cash-sale-run-2, brief04-review-corrections.md, session01a090ee-a148-7500-a0db-ea41d2881ae5. Ticket04 remains uncommitted and has not passed root final verification.

- Ticket04 run2 completed with Grok-reported65 HTTP/21 browser tests and other gates. Independent source review found remaining operation-ID/conflicting-transaction races, premature prepared-sale acceptance, invalid-draft freezing, cross-tab marker overwrite, edit/completion races, and availability released before shortage reconciliation. Root has not accepted or run final full gates on this state. Run3 is active in .scratch/grok-implementation/2026-09-11-cash-sale-run-3, brief04-final-race-corrections.md, same Grok session. Source/test adequacy notes:04-run2-test-review.md. Full offline ticket05 remains queued; its draft now requires production-build/service-worker and real same-profile restart verification.

- Ticket04 run3 completed with Grok-reported68 HTTP/25 browser tests and other gates. Read-only Standards recheck found no remaining backend blocker: identity locks precede state/stock work, operation conflicts stay transaction-safe, and shortage availability remains0. Spec recheck found two remaining UI paths: editing during preparation can accept stale values, and a foreign-operation blocked tab lacks an actionable recovery reference. Run4 is active in .scratch/grok-implementation/2026-09-11-cash-sale-run-4, brief04-browser-final-delta.md, same Grok session. Root final full gates and acceptance remain pending. Run3 does not establish fresh red for every HTTP race (scheduling allowed tests to pass before the lock); no broader TDD claim is made.

- Ticket04 run4 fixed the final two UI findings with actual failing-then-passing browser regressions; source review is clear. Grok reported68 HTTP/27 browser checks. Run5 removed one trailing blank line only. Root independent verification passed typecheck,68 HTTP tests/6files, production builds, architecture and migrations; browser26passed/1failed because the second concurrent Playwright click waited for an already-disabled button. This is a test actionability failure, not an accepted application failure or a passing test. Run6 is active at .scratch/grok-implementation/2026-09-11-cash-sale-run-6, brief04-double-submit-regression-fix.md, restricted to making the double-event regression deterministic and checking exact stock effects. Root must rerun browser/audit after that test-only change before acceptance. Initial evidence:root-cash-sale-final-results.json and root-cash-sale-final-test-browser.log.

- Ticket04 accepted after all root gates passed: typecheck;68 HTTP tests/6files; production builds; architecture; migrations001–006 apply/down/reapply/full rollback and failing-runner rollback;27 browser tests; audit zero advisories. Root exposed and Grok repaired two test-only timing defects before the final27-test pass (double-event actionability and active-branch readiness). Final evidence: .scratch/grok-implementation/root-cash-sale-final-results.json. Review: [cash-sale implementation review](../reviews/cash-sale-review.md). No delegated writer remains active at acceptance; ticket05 is next.

- Ticket04 commit0c2f56b0649280d3639a9138dc0e9a645a9017b6 is pushed; GitHub issue#5 read back CLOSED. Ticket05 run1 is active at .scratch/grok-implementation/2026-09-11-offline-pos-run-1, brief05-offline-pos.md, baseline0c2f56b. Grok remains sole application/test writer; root guides and reviews. Required verification includes real IndexedDB, account/queue privacy, durable local stock/sale/outbox transactions, production SW readiness and offline restart. Full synchronization/revocation recovery follows in06.

- Ticket05 accepted on 2026-09-14 after final independent Standards and Spec reviews and all gates: 77 HTTP tests in 6 files, 56 browser tests, typecheck, production builds, architecture, migrations 001-008 and audit with zero vulnerabilities. Evidence: .scratch/grok-implementation/root-offline-pos-final-results.json. Review: [offline POS review](../reviews/offline-pos-review.md). Coherent stock acknowledgement/rebase and revoked-account manager recovery extend this work in ticket06.

- Ticket06 accepted on 2026-09-15: root typecheck, 90 HTTP tests, builds, architecture, migrations 001-009 and zero-vulnerability audit passed. Full browser run: 64/66 passed; after two test-only timing/retry repairs, root reran the entire sales browser file with 11/11 passing. All nine synchronization cases and production offline restart/reconnect passed in the full run. See [synchronization review](../reviews/sync-recovery-review.md) for exact evidence and limits.

- Ticket07 accepted on 2026-09-15 after independent Standards and Spec repairs/recheck. Integrated onto2650a40 with migration010 preserving009. Root passed typecheck, eight expense/migration HTTP tests, scratch001-010 roundtrip/rollback, expense browser1/1, production builds, bundle separation and architecture. See [expense review](../reviews/expenses-review.md).

- Ticket17 accepted on 2026-09-15 after independent Standards/Spec findings were repaired and root integrated onto844c4e0. Root passed typecheck,14catalog HTTP tests, production builds, architecture, zero-vulnerability audit and the complete expanded browser suite68/68 in3.1minutes. No new migration. See [catalog/media review](../reviews/catalog-media-review.md).

## Active parallel implementation lanes — 2026-09-15

| Ticket | Agent | Worktree | Starting commit |
| --- | --- | --- | --- |
| 08 automatic offers | sol08_offers_high | .scratch/worktrees/08-automatic-offers | 2650a40 |
| 12 physical Returns | sol12_returns_high | .scratch/worktrees/12-physical-returns | 2650a40 |
| 18 storefront browsing/cart | sol18_storefront_high | .scratch/worktrees/18-storefront-cart | 06aa67b |

Each lane uses GPT-5.6 Sol at HIGH effort. Reserved migration numbers are 011 for offers, 012 for Returns, and 013 for storefront configuration if required. Implementers own only their worktree and do not commit; root reviews and verifies integrated code before acceptance. Returns reached runtime verification first and owns the shared test slot, followed by offers and storefront. No approval is needed for routine local checks within the assigned scope.


- Tickets08,12,18 accepted on2026-09-15 after independent Standards/Spec review and Sol HIGH repairs. Root verified full typecheck,108 HTTP assertions (plus clean4/4 teardown recheck), all production application builds, corrected bundle separation, architecture, migrations001–013 including rollback, zero-vulnerability audit and browser71/73 followed by20/20 across both repaired test files. See [offers, Returns and storefront review](../reviews/offers-returns-storefront-review.md). The next requested lanes are09,10 and14.

## Accepted batch 09, 10, 14 — 2026-09-15

Prerequisite commit6004d52 is pushed; issues9,13,19 are confirmed CLOSED. All three new worktrees have their own dependencies installed with pnpm10.34.5. Each native agent uses GPT-5.6 Sol at HIGH effort.

| Ticket | Worktree | Migration | Feature HTTP port |
| --- | --- | --- | --- |
|09 fixed bundles and Buy-X-Get-Y|.scratch/worktrees/09-bundles|014|55449|
|10 coupons and atomic usage|.scratch/worktrees/10-coupons|015|55450|
|14 linked sale/Returns corrections|.scratch/worktrees/14-corrections|016|55451|

Root owns commits, integration and final verification. Agents coordinate shared browser/migration ports and public pricing contracts;09 retains counted automatic ranges while10 overlays separate coupon effects.14 preserves original/effective/actual facts and rejects invalid online corrections atomically. All three tickets are independently accepted. The implementation, repair decisions and exact verification results are recorded in [bundles, coupons and corrections review](../reviews/bundles-coupons-corrections-review.md). Later ticket scope remains queued as listed above.

## Accepted batch 11, 13, 15 — 2026-09-15

The user instructed continuation after accepted commit `1caace4`. All prerequisite issues were read back as closed. Three new GPT-5.6 Sol HIGH agents work from this baseline with separately installed dependencies:

| Ticket | Worktree | Migration | HTTP port |
| --- | --- | --- | --- |
| 11 cached promotions and coupon discrepancies | .scratch/worktrees/11-offline-promotions | 017 | 55452 |
| 13 exchanges and actual cash differences | .scratch/worktrees/13-exchanges | 018 | 55453 |
| 15 receiving quantity/cost corrections | .scratch/worktrees/15-receiving-corrections | 019 | 55454 |

Root coordinated public interfaces, independent reviews and integration. Read/edit work ran in parallel; tests/builds used one runtime slot to avoid Windows memory contention. These three tickets are accepted, bringing the count to 17/28. Root verified all 16 workspace projects, 145 distinct HTTP tests (141/145 full run plus repaired 4/4 recheck), 81 distinct browser tests (80/81 full run plus repaired 1/1 recheck), production builds and bundle separation, architecture boundaries, migrations 001–019 with rollback and zero-advisory audit. All actionable findings on both review axes are resolved. See [the batch review](../reviews/offline-promotions-exchanges-receiving-review.md) for repairs, exact evidence and migration downgrade constraints. Tickets 16 and 19 are unblocked; later work remains queued.

## Accepted batch 16 and 19 — 2026-09-15

All three GPT-5.6 Sol HIGH lanes start from accepted `8993585`. Ticket 16 uses migration 020; ticket 19 uses migration 021. Checkout API and UI agents agree a public contract before dependent implementation. Each lane has separate dependencies; heavy runtime checks use one slot to avoid memory contention.

| Scope | Worktree | Agent |
| --- | --- | --- |
| 16 coordinated quantity correction and late-sale reconciliation | .scratch/worktrees/16-stock-corrections | sol16_stock_corrections |
| 19 guest request API and manager delivery areas | .scratch/worktrees/19-checkout-api | sol19_checkout_api |
| 19 storefront checkout and browser acceptance | .scratch/worktrees/19-checkout-ui | sol19_checkout_ui |

Root integrated and accepted both tickets after independent Standards and Spec repairs/rechecks. Checkout preserves uncertain request identities and newer cross-tab cart work; pending requests hold no stock or coupon use. Stock corrections require explicit synchronized till acknowledgement, retain a separate physical-count cutoff, and reconcile late FIFO allocations once across corrections. The checkout API agent also completed the stock-correction UI and browser story in a disjoint scope.

Root passed all 159 HTTP tests in 17 files and all 85 browser tests, typechecking across 17 packages, production builds and bundle separation, architecture checks, migrations 001–021 with full rollback/reapply and failure rollback, and a zero-vulnerability dependency audit. After the final feature-owned-reader repair, typecheck/API build/architecture and seven stock HTTP tests passed again before the full browser run. Windows orphan test workers required verified, targeted cleanup; no active database was stopped. Exact evidence and operational boundaries are in [the batch review](../reviews/stock-corrections-checkout-review.md). Ticket 20 (WhatsApp confirmation) and ticket 25 (opening import) are now unblocked.

- Ticket 20 independently passed on 2026-09-15: 170 HTTP tests in 19 files; the full browser run passed all 85 prior regressions, followed by a passing ticket-20 recheck after test-only branch-selection and delayed-response synchronization repairs; typecheck, production builds/bundle separation, architecture, migration 001–023 roundtrip/failure rollback and audit (zero advisories). Both review axes are clear. Evidence: .scratch/sol-implementation/root-ticket-20-results.json. Review: [order confirmation review](../reviews/order-confirmation-review.md). Ticket 21 retains shipment/delivery and explicit cancellation/release scope.
