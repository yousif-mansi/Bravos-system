# Grok review of the original BRAVOS v1 specification

Date: 2026-09-08. This is Grok's original report against the pre-correction draft, preserved for traceability. Its line references and 107-story/33-scenario counts refer to that reviewed version, not the subsequently revised document. See [review disposition](bravos-v1-grok-review.md) for the orchestrator's verification, corrections and remaining proposals.

Audited specification SHA-256: `6C9467E189BF4463F5223319C1A8864EEDBE89465813AEC089B50A1135E956D1`.

Grok CLI: 1.0.13; session `01a081d2-d043-71d3-91ff-e150c849f68b`; resumed run ended with `end_turn`, exit 0 and `readOnlyViolation=false`. The original attempt's shell request was cancelled before its report; the resumed review used no shell calls. The orchestrator independently ran document checks and verified the original specification hash remained unchanged. No application tests exist yet.

The report below is preserved as reviewer output, including its judgments and limitations; it is not itself an accepted specification or proof of correctness.

---

The specification is a faithful review draft of the 63 answered questions. It is not ready to publish as `ready-for-agent`. Confirmed inventory, offline-sale, confirmation-deduction, FIFO, refund, expense, exclusion, and architecture rules are present and consistent with discovery and the ADRs. The gaps below are incomplete or mis-labelled accepted behavior, not a complaint that pending proposals are still pending.

No P1 false invariant was found. Actionable work is P2 completeness and labelling. Intentional exclusions (tax, courier ledgers, average cost, 30-day in-app returns, Module Federation, hosting now) are preserved.

---

## 1. Verdict and coverage reviewed

**Verdict:** Correct as a review draft; **not publication-ready** until the P2 items are fixed. After those corrections, remaining stack, rounding, recovery, failed-parcel posting permission, and delivery-fee-on-refund details can stay explicitly pending.

**Actually read (full bodies, not headings):** `AGENTS.md`, `bravos.md`, `CONTEXT.md`, `docs/planning/bravos-v1-spec.md`, `discovery.md` (D01–D51), `returns.md`, `kickoff.md`, `implementation-blueprint.md`, `questionnaire.md` (current outcomes and Q34–Q63 history), `docs/architecture/principles.md`, ADRs 0001–0003, `.agents/skills/to-spec/SKILL.md`. `docs/architecture/options.md` was used only as stack-research context.

**Format (orchestrator checks, not re-executed here):** seven required headings; stories 1–107 sequential; A01–A33 sequential; local links/UTF-8/whitespace; body under 65,536 characters; `git diff --check` clean. No application or tests exist. This run made no Git-visible changes.

---

## 2. Numbered findings

### P2-1. Sale-recording cancellation vs physical stock is underspecified

**Severity:** P2
**Kind:** source-backed correction

**Source:** D20 (`discovery.md` 139–144): only a manager may correct/cancel an erroneous completed sale; preserve the original; apply stock and totals **according to what actually happened**; **cancelling a record does not imply merchandise physically returned**. Same rule in `principles.md` 31 and `bravos.md` via later correction.

**Spec:** Story 41 (`bravos-v1-spec.md` 70) and the correction row (`202`) say “actual money/stock effects” / “only the actual stock/money/reporting effects”. They never state the D20 prohibition.

**Failure:** A cashier records a sale that never happened. The manager chooses Cancel. An implementer restores stock automatically. If the goods actually left, available stock is inflated and the next POS/online confirmation can sell reserved or missing units.

**Smallest correction:** In story 41 and the “Correct a saved record” row, add: a recording correction/cancellation does not restore stock or cash by itself; the manager records whether merchandise and cash actually moved; customer returns stay in Returns.

---

### P2-2. Accepted till-sync/pause is filed as a proposal

**Severity:** P2
**Kind:** source-backed correction

**Source:** D37 (`discovery.md` 220–224) **accepted** Q47: synchronize known tills and briefly pause stock-changing work while the manager finalizes a quantity correction; preserve late sales and flag discrepancies.

**Spec:** That pause appears only under “Recommended reconciliation details for final review” (`242–243`), together with still-proposed count-boundary/device-ack mechanics. Story 28 (`67`) only says “account for synchronized or late sales”.

**Failure:** Reviewers treat the pause as optional blueprint. Quantity correction is posted while a till still has an unsent sale; the late sale then deducts again or fights the new balance, which D37 was meant to prevent.

**Smallest correction:** Move “synchronize known tills and pause stock-changing work before finalizing a quantity correction; retain late sales and flag discrepancies” into the confirmed inventory rules (near `233–236` or story 28). Keep count-boundary records, device acks, and “server cannot stop a disconnected cashier” as proposed.

---

### P2-3. Accepted exchange money rules are filed as proposals; cheaper replacement is untested

**Severity:** P2
**Kind:** source-backed correction

**Source:** D43 (`discovery.md` 256): exchange credit is the manager’s **final** refund toward the replacement’s current price after offers, with **cash collected or refunded** for the difference. D50: manager-editable refund, no new cap or mandatory override reason.

**Spec:** Story 88 (`127`) only says “replacement and cash difference”. The D43 credit rule and the 280/320/40 collect example sit under “Recommended operational details” (`282`). A26 (`355`) tests only collecting 40, not refunding when the replacement is cheaper.

**Failure:** Suggested value 275, manager authorizes 280, replacement after offers is 200. An implementer collects nothing, keeps 80 as undeclared store credit, or credits 275 instead of 280. D43 forbids a standing credit balance and requires the manager’s final value.

**Smallest correction:** Promote to accepted Returns rules: credit = manager’s authorized refund; collect if replacement is higher; cash-refund the difference if lower; no store-credit balance. Add an A26 sibling: credit 280, replacement 200, cash 80 Owed/Paid, original sale unchanged. Leave the 280/320/40 numbers as an example.

---

### P2-4. Promotions and coupons are missing from user stories

**Severity:** P2
**Kind:** source-backed correction

**Source:** `bravos.md` §21 and §29.16 require percentage/fixed/bundle/Buy-X-Get-Y, product/category/seasonal campaigns, and coupons, manager-administered. D34/D45 (`discovery.md` 207–210, 264–266) accept one automatic offer plus one eligible coupon, greatest-saving selection, fixed bundle contents/prices, cheapest Buy-X-Get-Y rewards, coupon count at POS completion or online confirmation, release once for cancelled undelivered orders, Cairo dates, preserved accepted prices.

**Spec:** No story for manager create/activate/configure offers or coupons, cashier/customer apply a coupon, or automatic offer application. Coverage is only implementation (`215–230`) and A10 (`339`). Stories 36–39 are the employee EGP deduction only; story 44 is cached offers while offline.

**Failure:** Tickets split from the numbered stories omit promotion admin and coupon application. POS ships employee discounts without coupons; checkout has no code field; stacking/release rules exist only in a proposal section.

**Smallest correction:** Add stories for: manager-maintained offers/coupons/bundles/Buy-X-Get-Y and combination settings; automatic greatest-saving offer then one eligible coupon then employee POS deduction; coupon consume at POS completion/online confirmation and single release on cancelled undelivered orders. Do not move the piaster/multi-unit examples out of “recommended”.

---

### P2-5. Delivery-area administration has no story

**Severity:** P2
**Kind:** source-backed correction

**Source:** D33 (`discovery.md` 202–204): required checkout includes delivery area; fees come from **manager-configured** areas; the area/price list is launch data, not a reason to hard-code. `bravos.md` §19: areas and prices configurable.

**Spec:** Story 59 (`91`) is the customer seeing a fee. Configuration is only a one-line editable-data note (`163`) and launch list (`386`).

**Failure:** Fees are hard-coded or only editable in a database seed. Checkout cannot add a Fayoum area without a release.

**Smallest correction:** Add a manager story to maintain Fayoum delivery areas and fees used by checkout validation and the customer-facing total. Keep actual names/prices as launch configuration.

---

### P2-6. Who may confirm an online order is not an authorization rule

**Severity:** P2
**Kind:** source-backed correction

**Source:** D04 (`discovery.md` 31) accepted assigned representative with manager backup. D34 (`207–208`): representative handles routine stages; manager is backup and handles corrections. Blueprint permission table (not accepted by itself) matches that split.

**Spec:** Stories 63/73 name those actors. The command table (`197`) says “Representative/manager confirms” without forbidding other signed-in cashiers. A01 (`330`) covers manager-only operations and colleagues’ records, not representative grants.

**Failure:** Every cashier can mark Confirmed, deducting stock and consuming a coupon without the assigned WhatsApp/set-aside path.

**Smallest correction:** State that confirmation and routine stage changes require the assigned representative grant (or manager backup); ordinary cashier/expense permissions do not include them. Actual names/hours stay launch configuration.

---

### P2-7. Exchange replacements are not bound to the quantity-2-not-3 rule

**Severity:** P2
**Kind:** source-backed correction

**Source:** D09 (`discovery.md` 80–86): known available 2 cannot accept 3, including repeated lines, in POS and online. Returns/exchanges still hand out merchandise from the same central available stock (D24/D32, ADR-0003 FIFO on new allocations).

**Spec:** A06 (`335`) is POS/checkout only. Returns stories 80–88 and A26 (`355`) do not revalidate replacement quantities. Inventory ops (`193–203`) do not list exchange allocation.

**Failure:** Available 2, manager exchanges for 3 of that variant. Spec does not require rejection, so confirmed set-aside or the last sellable units can be given away.

**Smallest correction:** In Returns/exchange rules and A26: replacement quantities use the same per-variant available check (including reserved exclusions); allocate FIFO as a new linked sale; restore returned sellable units to original batches separately (no netting that skips validation).

---

### P2-8. Coupon after failed delivery or a delivered return is unspecified

**Severity:** P2
**Kind:** **NEW decision proposal** (not a silent spec fix)

**Source:** D45 (`discovery.md` 266) only: count at POS completion or online confirmation; **release once for cancelled undelivered orders**. D10 failed-parcel restore is stock-only. D32 delivered customer returns do not mention coupons.

**Spec:** `219` and cancel row `199` copy D45. Failed-parcel (`200`) and posted return (`201`) never mention coupon usage.

**Failure:** Order confirmed with a single-use coupon, then delivery fails and sellable stock is restored, or the customer returns the delivered goods. The coupon stays consumed, so a replacement order cannot use it — or an implementer releases it a second time and exceeds the limit.

**Smallest correction (decision, not a hidden requirement):** Ask and record one of:

| Option | Effect |
| --- | --- |
| A (recommended) | Release once if the customer never received a completed Delivered sale (pending cancel, confirmed pre-shipment cancel, failed parcel closed without delivery). Do not release on a Delivered customer return. |
| B | Never release except confirmed pre-shipment cancel (literal D45). |
| C | Also release on full Delivered return. |

Until answered, keep A as a labelled proposal, not accepted text.

---

### P2-9. Paid value of Buy-X-Get-Y reward units on return is unspecified

**Severity:** P2
**Kind:** **NEW decision proposal**

**Source:** D45 accepts cheapest eligible reward units. D50/Q62 only settled 300/200 with 50 off → 275/175, and said that example does **not** settle every promotion type (`discovery.md` 293).

**Spec:** `217` and A10 cover cheapest rewards. Proposed allocation (`223–229`) never says what a free/reward unit’s stored paid value is, or what a partial return of only the reward unit suggests.

**Failure:** Buy 2 get 1 free; customer returns only the free unit. Suggestion 0 looks correct under equal/capped allocation, but an implementer might re-spread the basket discount and change the paid items’ refunds, or refuse the return because paid value is 0.

**Smallest correction:** Propose (do not accept): persist per-unit paid value at confirmation/POS completion; a returned reward unit suggests its stored paid value (often 0); the manager may still edit; do not recompute siblings. Confirm in the same pass as P2-8 if desired.

---

### P3-1. Arabic order-stage labels still open, not listed as remainder

**Severity:** P3
**Kind:** source-backed

D04 (`discovery.md` 29): final Arabic labels remain to be chosen. Spec `269` uses English accepted meanings only. Further Notes (`386`) omit this. **Correction:** one Further Notes bullet: Arabic labels for the accepted stages are design/launch data, not reopened lifecycle.

---

### P3-2. Story 36 says “after offers”, omitting the coupon step

**Severity:** P3
**Kind:** source-backed

D45 order is automatic offer, then coupon, then employee deduction. Story 36 (`65`) is “EGP deduction after offers”. Implementation `216` is correct. **Correction:** story 36 “after configured offers and any eligible coupon”.

---

### P3-3. Optional checkout fields are not restated as server-optional

**Severity:** P3
**Kind:** source-backed

D33 emphasized alternate phone, landmark, and notes optional. `principles.md` 35 requires that in UI **and** server validation. Story 58 (`90`) is customer-facing; submit row `197` only says “required checkout data”. **Correction:** one clause that those three fields must remain optional in API validation.

---

### P3-4. Expenses and Returns are online-first only in the offline-scope paragraph

**Severity:** P3
**Kind:** source-backed

D19/D37 and `returns.md` 47: expenses and returns are outside the first offline rollout. Spec `249` states that; stories 75–92 do not. **Correction:** a clause on stories 75 and 89, or a single offline-scope story, that those workflows require a connection initially.

---

### P3-5. Connected POS vs confirmation race is not an acceptance row

**Severity:** P3
**Kind:** source-backed (test completeness)

A11 (`340`) is two confirmations. Complete physical sale and confirm are both stock-changing commands (`194–197`) with locking (`205`). **Correction:** extend A11 so one connected cash sale and one confirmation competing for the last unit yield exactly one allocation. Offline late-sale vs confirmation stays A20.

---

Not findings: tax/VAT, courier receivables, average cost, 30-day in-app defect path, Module Federation, hosting/domain purchase, full stock-count screens, barcodes, receipts, customer accounts. Pending text that is clearly labelled “recommended” / “pending final review” is not a bug for being unapproved.

---

## 3. Coverage matrix

Legend: **C** covered in stories + implementation + tests; **P** partial; **M** missing; **S** superseded (later answer replaces the brief); **X** excluded on purpose; **N/A** process-only.

### Original brief (`bravos.md`)

| Area | Status | Spec |
| --- | --- | --- |
| Two branches, shared ops reporting, no extra branches planned | C | 1, 5–8, 21, 93 |
| One central inventory, no branch stock/transfers | C | 21, 209–210, OS 368 |
| Product fields, unique product code, no barcodes | C | 11–16, A03; OS 369 |
| Selling price shared; cost never public | C | 9, 14–15, 25, A02 |
| Categories/subcategories editable; tree is launch data | C | 12, 386 |
| Statuses: Available / derived Out of Stock / Coming Soon / Hidden | C / **S** vs brief §5.5 manual Out of Stock | 17–20, A04; D14 |
| Auto stock on sale/receive; online same source | C | 22, 34, 67, A07, A14 |
| Low-stock threshold | C / **S** vs brief “unspecified” | 29–30; D13 |
| Full stocktaking sessions | X | OS 368; D36 |
| Damaged/missing module | X | OS 368; unsellable stays unavailable 82, A25 |
| POS lookup, variant, qty, cash complete | C | 31–35, A07 |
| Sale attribution | C | 40, 93 |
| Physical cash only; no receipts/invoices/cards | C / X | 34; OS 369–370 |
| Manager-only restricted discounts / delete sale | **S** | D26–D27 employee EGP discount; D20 linked correction not delete — 36–41 |
| Returns (brief §8 / §31.1 open) | **S** → in scope | 75–88; D24+ |
| Customers: no accounts/loyalty/spend analytics | C / X | 35, 56–58; OS 371 |
| Roles, personal accounts, attribution not full audit UI | C | 2–10, A01; OS 373 |
| Dashboard: day/month/branch, purchases, best sellers, profit, inventory value, low stock | C | 1, 93–96, A28 |
| Not AOV / least-sellers / advanced customer stats | X | OS 372 |
| Reports PDF/Excel, calendar months | C | 93, 98, A30 |
| Expenses practical, no accounting suite/accountant | C | 89–92, 96, A27; OS 370 |
| Receiving qty/cost/date; no supplier ledgers | C | 22, 26, A05, A22; OS 370 |
| Branded store, search, details, cart, guest COD | C | 51–61, A04 |
| No wishlist/reviews/accounts/advanced filters/tracking portal | X | OS 371 |
| Website uses central stock; stale while offline unsynced | C | 50, 54–55, A13; D06 |
| Online orders in staff app; WhatsApp confirm; no self-cancel | C | 63–73; OS 371 |
| Delivery Fayoum, configurable area fees, no carrier API, no free-delivery rule invented | P | customer fee 59; **manager CRUD missing (P2-5)**; OS 369, 373 |
| Promotions/coupons/bundles/BOGO/seasonal | P | impl 215–230, A10; **stories missing (P2-4)** |
| WhatsApp + social links; no email/SMS/newsletter | C | 60; OS 373 |
| Analytics views/visits/sales; likes unconfirmed | C / X | 99, A30; OS 372 |
| Manual backup; roles; standard security | C | 2–4, 100–102, A31 |
| No native app; browser devices | C / X | 104–105, A33; OS 373 |
| Arabic primary; no bilingual mandate | C | 51, 105, A33 |
| Branding later; photography + high-contrast | C | 51, 104, 386; D40 |
| Internal before public store; CSV opening, no paper history | C | 103, 107, A32 |
| Domain/hosting after website | C | 106; OS 376 |
| §30 exclusion list | C | OS 368–376 |

### D01–D51

| ID | Decision | Status | Spec |
| --- | --- | --- | --- |
| D01 | Shared POS stock; physical coordination outside system; complete when goods+cash | C | 21, 25, 34, 209, A07 |
| D02 | Product code then size/color; per-variant qty | C | 13, 31, A03, A06 |
| D03 | Offline final cash sale; durable sync; no silent drop | C | 43–48, 247–248, A17–A20 |
| D04 | Pending ≠ reserve; physical priority; assigned rep + manager backup; Arabic labels later | P | 64–66, 73, A13; **auth gap P2-6; labels P3-1** |
| D05 | Clean Arch, features, clean imports, local-first, split; Federation deferred | C | 157–162, 364; OS 376 |
| D06 | Website OOS per variant/product; only synced qty | C | 18–19, 50, 54–55, A04, A06 |
| D07 | Physical set-aside before WhatsApp; then protect | C | 65–67, 269, A14 |
| D08 | Stages; deduct once at Confirm; ship/deliver do not; pending cancel restores 0 | C | 67–70, 193–199, A14 |
| D09 | 2 cannot accept 3 incl. duplicate lines; recheck submit+confirm; no silent substitute | P | 33, 55, 66, A06, A13; **exchange qty P2-7** |
| D10 | Failed parcel unavailable until inspect; sellable restore once; **posting permission open** | C + pending | 70, 200, A15 |
| D11 | Manual cancel after configurable wait + ≥2 attempts; no auto cancel | C | 71, 271, A16 |
| D12 | Manager online qty adjust; exclude reserved; cashiers cannot bypass | C | 27–28, 33, A06, A22 |
| D13 | Low stock default 3, global+per-variant, on available | C | 29–30 |
| D14 | OOS derived+browsable; Coming Soon/Hidden web-only; POS still allowed | C | 17–20, 211, A04 |
| D15 | Costs/profit/inventory value manager-only incl. cache/API | C | 9, 25, 259, A02 |
| D16 | Employee own sales; manager all | C | 7–8, A01 |
| D17 | One account, assigned branches, visible active branch | C | 5–6, 40, A01 |
| D18 | Manager-only online receiving; no employee cost workflow | C | 22, 193, A05 |
| D19 | Employees may add expenses; not in first offline rollout | C | 89–90, 249, A27 |
| D20 | Linked sale correction; no hard delete; actual effects; not a customer return | P | 41, 202, A12; **P2-1** |
| D21 | Expense visibility by creator/branch vs manager-all | C | 7–8, 90, 288, A27 |
| D22 | Saved expense: manager linked correction; 500→50 once | C | 92, A27 |
| D23 | Saved expense reports immediately; no approval queue | C | 91, 288 |
| D24 | v1 manager returns/exchanges | C | 75–88 |
| D25 | Physical name/phone optional | C | 35, A07 |
| D26–D29 | Employee EGP discount, no cap, optional reason, combinable | C | 36–39, A08 |
| D30 | Faster interview / remaining count | N/A | Further Notes; not product scope |
| D31 | Deduction after offers; 0 OK; negative rejected | C | 36, 38, 216, A08 |
| D32 | Dedicated Returns; either branch; partial; inspect; cash Owed/Paid | C | 75–80, 82, 87, A23–A24 |
| D33 | Guest checkout required/optional fields; manager area fees | P | 56–59, A07-style checkout; **P2-5, P3-3** |
| D34 | Rep stages; no confirmed expiry; offer+coupon default | P | 68–73, 216; **promo stories P2-4** |
| D35 | Default price + variant override; editable size/color; optional size guide | C | 14–16 |
| D36 | Defer count sessions; linked receiving corrections | C | 26, OS 368, A22 |
| D37 | Cached prices/offers/discounts; no fresh offline login; disable on reconnect; **pause+late sales** | P | 43–44, 49, A17, A21; **pause mis-labelled P2-2** |
| D38 | Completed = physical complete + Delivered; final values; **no courier accounting** | C | 74, 96, A29; OS 370 |
| D39 | Data-only backup; images not required; manager preview/confirm | C | 100–102, A31 |
| D40 | Desktop/tablet POS; phone mgmt/store; photo store; separate internal URL | C | 51, 62, 104–105, A33 |
| D41 | Aggregate analytics no profiles; CSV opening; internal then public | C | 99, 103, 107, A30, A32 |
| D42 | 14-day in-app from receipt; later defects WhatsApp; no 30-day app path | C | 81, OS 374, A23 |
| D43 | Refund amount paid (850→850); exchange credit = final refund ± cash | P | 84, 88; **P2-3** |
| D44 | Separate batches; no average | C | 23, 233, A05 |
| D45 | Best offer → coupon → POS deduction; bundles; cheapest reward; coupon timing | P | 216–219, A10; **stories P2-4; coupon after fail/return P2-8** |
| D46 | Merchandise profit from batches+expenses; no tax; Cairo periods; returns in process period | C | 93–97, 290–298, A28–A29 |
| D47 | Login/reset/owner recovery; queue preserve/retry/count; protected backup+restore safeguards | C | 2–4, 46–47, 100–102, A17, A19, A31 |
| D48 | Book domain/hosting after website; local first | C | 106, 312, OS 376 |
| D49 | Branch drop-off / WhatsApp courier arrangements; no carrier ledger | C | 78, 271, 283–284 as proposal, OS 370 |
| D50 | Equal 25/25 → 275/175; manager-editable refund; no new cap/mandatory reason | C | 85–86, 221–222, A09, A24 |
| D51 | FIFO oldest batch; sellable returns to original batches | C | 24, 83, 233–236, A05, A25 |

---

## 4. Still-unapproved technical/operational proposals

These are correctly pending. Do not treat them as accepted.

- Stack: TypeScript/pnpm, Next.js storefront, React/Vite internal PWA, Fastify, PostgreSQL/`pg`, Dexie, Better Auth + `.invalid` identifier adapter, same-origin gateways/CSRF (`166–169`, `261–265`).
- Money: integer piasters; equal/capped per-unit allocation; leftover order; 280/280/180 and 0/60 and 0.34/0.33/0.33 examples (`223–229`).
- FIFO tie-break: receipt time then stable batch id (`233`).
- Indistinguishable cross-batch returns: earliest remaining unreturned allocation of that purchase (`239`).
- Receiving: linked effective-cost on remaining/allocated units (`240–241`).
- Late offline sale: allocate leftover FIFO without taking reserved units; incomplete cost/profit; do not invent zero/average cost (`243–245`).
- Offline: local sale+outbox transaction, snapshot rebase, tab coordination, session continue until sign-out, restore-generation routing (`251–259`, `305–308`).
- Failed-parcel **posting permission** (D10 still open): manager posts; staff may record receipt/inspection (`200`, A15).
- Returns draft→posted; 14 **Cairo calendar days inclusive**; post-save return corrections (`277–281`).
- Full vs partial **online delivery-charge** in suggested refund (`283–284`, A29) — Q62 examples were merchandise-only.
- Report formulas/examples (`292–300`).
- Backup archive/encryption/staging drill (`305–308`).
- Browser matrix (blueprint Chrome/Edge POS, Safari/Chrome phones) — A33 does not freeze vendors.
- **P2-8 / P2-9** above.

**Non-blocking suggestions:** add the POS-vs-confirm race to A11 (P3-5); restated server-optional checkout fields (P3-3); Arabic labels in Further Notes (P3-1).

**Residual risks (do not silently encode):** manager refund with no cap can exceed amount paid (D50); disconnected cashier cannot be paused (stated `243`); website stale during branch outage (D06); physical set-aside before Confirm is operational, not a system hold (ADR-0002); same-variant exchange restore-old-batch + FIFO-new-batch can change cost; data-only restore cannot recreate images or unsent till queues; Better Auth proof may fail and force another adapter.

---

## 5. Architecture, to-spec format, verification, limits

**Architecture at spec level:** Feature public contracts (`171–182`), inward adapters, automated import/cycle checks, one logical inventory, durable local sales, duplicate-safe stock commands (`157–163`, `187–205`) match `principles.md` and ADRs 0001–0003. Atomicity is a DB transaction plus local IndexedDB transaction, not a cross-browser global transaction — correctly stated. Role filtering in responses/caches (`161`, A02), auth provisioning proof (`263–265`), cookie/CSRF/same-origin (`169`), backup restore-generation and unsent-till warning (`305–308`) are enough for this stage. Exact library versions and production hosts are correctly not required now.

**to-spec:** All seven headings exist. Stories are extensive and numbered in the required shape, but not complete for promotions or delivery-area admin (P2-4, P2-5). Implementation avoids file paths/code dumps. Testing seam is public HTTP + real DB, plus focused real-browser offline/URL/privacy — appropriate with no existing seams. Explicit that no tests have been run (`322`). Out of scope matches later exclusions. No claim that the blueprint is approved (`3–5`, `384`).

**Verification:** Orchestrator reported `git diff --check` pass; stories 1–107; A01–A33; seven headings; links/whitespace; body &lt; 65,536 characters; no app tests. This review did not re-run shell. **Files touched: none.** Git-visible tree should still be the pre-existing dirty planning set (`AGENTS.md`, `kickoff.md` modified; spec/discovery/ADRs untracked).

**Limits:** Independent character/story recount was not run (shell denied). Q1–Q33 original questionnaire prose is not in the current `questionnaire.md` body; confirmed outcomes were taken from `discovery.md`, which is the right current source. This is not a guarantee that no future edge exists; it is a review of material omissions and mis-statements against the cited sources.
