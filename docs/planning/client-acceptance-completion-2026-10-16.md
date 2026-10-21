# Client acceptance completion — 16 October 2026

## Outcome

Deliver a coherent local Windows version of Bravos that the client can evaluate before paying for hosting. Success means employees can complete real business tasks with clear choices, immediate feedback and understandable outcomes. Code, screenshots and green builds are evidence, not the business outcome itself.

Owner authorizes Grok implementation; main owns product/UX decisions, bounded plans, diff review and acceptance. Preserve Clean Architecture, feature ownership, current routes/contracts/permissions and the latest approved inventory/order/return rules. Do not add features, require new hosting, redesign the brand, or reopen settled policies. No automatic merge, deployment, issue closure or new commit in this pass without the owner's commit approval.

## Status on 18 October 2026

The practice copy is running and engineering-accepted for local client evaluation. It is not client sign-off, a locked product, a production release, or a claim that every open item is finished.

| Task | Status |
| --- | --- |
| CA01 — hosted Windows native startup | Still partial. The hosted root cause is unknown. Local PostgreSQL startup is separate evidence. No all-green CI claim. This is not a blocker for the local client session. |
| CA02 — daily merchandise work | Earlier review stands. Today's practice receipt used that flow. No new defect was opened here. |
| CA03 — storefront completion | Fresh vertical homepage at 1440 and 390, plus 23 practice PNGs. The earlier 208-image review stays. Not every hidden horizontal card was reopened. No new blocking visual defect. Contact stays empty until the owner supplies a number. |
| CA04 — local client session | Running and engineering-accepted. API 3012, staff preview 5177, Next development storefront 3002, PostgreSQL 54330, database `bravos_client_acceptance_20261016`. Health 200 for all three. Leave them running. |
| CA05 — business rehearsal | Fresh assembled coverage exists as two runs on that database: a stopped first run and a continuation that finished exit 0. Not one uninterrupted full run. Client acceptance stays blank. |

The early 18 October memory refusal is closed history. Free memory was then below the 3000 MB physical and 4000 MB virtual guard. After the user freed RAM, a fresh guard passed with more than 10 GB physical and more than 15 GB virtual memory, and the stack started. The ordinary database `bravos_phase1_20260929` on 54329 / 3010 / 5173 / 3000 stayed stopped. Do not seed or reset it.

Pending work is the client's own feedback, and a contact number only when the owner provides one. No extra feature is required for this local demo. Details are in the [18 October main review](../reviews/client-acceptance-main-review-2026-10-18.md) and the [client guide](../development/client-local-acceptance.md).

## 16 October candidate evidence

Historical. These bullets described the candidate before the practice stack was running.

- Published storefront checkpoint: PR44, `6eacfa8`, branch `codex/ux-purchase-guidance`.
- Hosted Windows static/type/architecture/build job passed. Browser acceptance stopped before tests at embedded PostgreSQL startup; HTTP recorded16 passes and244 skips after database setup failures. Native startup cause is not yet known. These are not244 demonstrated product defects.
- Reviewed desktop Products/Receiving category organization, sample intake and a testkit teardown repair remain local. Preserve and evaluate them; do not overwrite them with HEAD.
- Category visual evidence covers397 images and the full home at four widths. Three tablet rail gaps, mobile category captures and selected-PDP/bag/checkout/information states require the prepared supplemental run. Original failures remain recorded.
- The existing32-product preview includes30 authorized sample products plus two preserved legacy records. Verify current state without replenishing stock or rewriting the catalog.

## Phases and bounded tasks

| Task | Business purpose and exact scope | Acceptance |
| --- | --- | --- |
| CA01 — Windows verification | Diagnose isolated embedded PostgreSQL setup on Windows from the actual failing run. Minimal harness/CI diagnostics or startup correction only after evidence. Preserve teardown safety and memory guards. | Root cause distinguished from hypotheses; representative fresh database startup/migration/stop passes; meaningful failure diagnostics; relevant Windows checks rerun without masking skipped tests. |
| CA02 — Daily merchandise work | Review existing Products and Receiving category/name/SKU organization, selected-record preservation and feedback. Keep staff Arabic and existing inventory-first rules. Fix only demonstrated workflow friction. | Manager can find a product by category/name/SKU, open/edit it with visible feedback, select valid existing variant pairs and receive stock without losing context. Cashier sees no cost/manager-only controls. |
| CA03 — Storefront completion | Finish only outstanding category/product/bag/checkout and information-page visual/interaction evidence. Preserve dark English brand direction, image-only hero, centered titles and4:5 category rows. | Whole vertical page and every horizontal product inspected at readable size; correct selected variant/price, clear stock/retry/empty states, straightforward bag/checkout, keyboard/touch consistency. No ordinary order submission or stock writes during visual capture. |
| CA04 — Local client session | Reuse existing Windows startup/setup paths, check local assets and existing sample data/configuration; provide concise operator start/stop and test instructions. Prepare business test transactions only in a clearly isolated database. | One named candidate with all three applications available locally, private demo credentials and identifiable sample merchandise. No paid infrastructure or external fonts required. No destructive reset, copied production secrets, hidden setup steps or unnecessary new launcher framework. |
| CA05 — Business rehearsal and review | Execute the important customer/employee journeys against isolated data. Report friction and repair only demonstrated defects through Grok. | Sales/payment/discount, inventory by branch, confirmation/reversal, cross-branch return/refund, expense/report/export, backup/restore and durable offline cash synchronization have recorded outcomes. Main gives technical/UX assessment; client/operator acceptance is left for the actual client. |

Serialize source writers and heavy runtime checks. Source-only harness work may run while stable storefront screenshots are captured; no storefront edits during capture. Main starts services/tests and checks source hashes. Sol may perform read-only inventories and independent reviews; Grok remains the implementer.

## Business UX criteria

- Start from the employee/customer task, not from database entities or engineering labels.
- Make the active branch, chosen variant, price, payment balance and transaction outcome obvious where relevant.
- Preserve sensible defaults and existing input; do not introduce mandatory fields, approval steps or confirmations without a real business need.
- After a click, show the resulting state, progress, success or actionable error. No silent action or indefinite loader.
- Keep operational references readable and internal identifiers out of routine customer/employee copy where they are not needed.
- Review findability, keyboard use and desktop density without redesigning working systems.
- Prefer a small fix to an evidenced obstacle over speculative refactoring or additional UI.

## Meaning of local/offline

With installed dependencies and PostgreSQL/API/apps running on the local Windows computer, the full connected workflow can be evaluated without Internet or hosting. Actual WhatsApp communication remains external. A browser disconnected from its API supports the already-approved cached POS cash-sale scope; fresh login, receiving, public checkout and order confirmation require that API. Build/cache the staff shell through the established preview path before demonstrating offline restart. Do not claim development mode registers the offline service worker.

## Evidence and completion

Record each task as accepted, blocked with an actual reason, or pending main review. Keep failing runs separate from reruns; do not rerun unaffected full suites by habit. Use focused tests for newly changed behavior and one assembled business rehearsal. No production startup approval workaround, Linux execution, ordinary-data mutation, protected review change, or claim that technical review equals client sign-off.

Protected SHA256: `docs/reviews/bravos-v1-grok-review.md` remains `3361DE3CDE70382A9AEDB602407CDA2384482ADDA395E48EAF26A561BA13345A`.

## Main review update

The next four paragraphs are the 16 October engineering record. CA04, CA05, and the closed memory block are the 18 October update.

The initial eight-case business rehearsal recorded seven passes and one selector failure. The product existed; the loose product-label locator also matched the new merchandise filter group. Grok corrected exactly two locators. A separate four-case run then passed sales, fulfillment, connected reporting and PDF/Excel exports. These are separate runs, not a fresh eight-case pass. Two selected API cases passed financial reversals and cross-branch returns; 25 unrelated cases were intentionally not selected.

Typecheck and architecture passed. Nineteen diagnostics/teardown tests and fourteen sample-intake guard tests passed. The latest staff build passed. Receiving now puts the routine receipt first, with one existing-form shortcut for new merchandise. Focus, highlight, draft preservation and toolbar clearance passed at1440/1024/390. Bag revalidation now says details were checked when nothing changed. No commerce, permission, API response or database schema change was needed.

All208 supplemental viewport PNGs were individually reviewed, alongside the original home, horizontal rails and isolated loading/error/retry evidence. Two legacy-image readiness flags in the supplemental capture remain recorded; six targeted load/decode checks passed and did not reproduce them. The original capture failures are retained. No new blocking visual defect was demonstrated.

CA01 remains partial: local isolated startup/migration/business checks pass, and failures now retain bounded native diagnostics. The hosted Windows native startup cause is still unconfirmed; publishing and rerunning that job requires the next approved checkpoint. Do not describe diagnostics as a proven hosted startup fix.

CA04 is running and engineering-accepted. The persistent practice database, API, media, and private credentials use existing composition and feature APIs: thirty approved sample garments and Fayoum EGP 50 delivery. Staff uses the built preview. The storefront stays in Next development, with `devIndicators: false` so the development badge no longer covers the mobile controls. The `nextjs-portal` element remains. This is a local session, not an installer or a new product feature. Actual client sign-off remains blank.

CA05 assembled coverage was executed by main on that same database. The first run passed roles, cost refusal, the sample 009 receipt, and the discounted cash sale, then stopped on a mobile Add to bag locator. `failure.json` stays. The script-only `--resume-after-pos` continuation rechecked that sale and completed the order, confirmation, cross-branch return, expense, PDF/Excel, encrypted backup, restore-page reachability, and one cached offline cash sync. Those two runs are the coverage. They are not one clean full run. Restore preview, upload, and activation were not done today.

### Closed memory block, same day

Before the user freed RAM, `resume-preflight-20261018.json` and `resume-final-preflight-20261018.json` were below the 3000/4000 MB guard, and no practice ports were listening. That refusal is historical. It is not still unresolved. The later guard passed above 10 GB physical and 15 GB virtual, and the practice processes are the ones left running.

CA01's hosted native failure remains unresolved and is appendix context, not a local client blocker. Nothing was staged, committed, pushed, deployed, or closed. GitHub was not refreshed. Protected SHA256 is unchanged and that file was not opened.
