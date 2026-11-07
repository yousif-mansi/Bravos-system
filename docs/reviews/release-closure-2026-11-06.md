# Release closure — 6 November 2026

## Acceptance and scope

The owner states that the client has approved the final version and authorizes finishing the remaining release-readiness work. This supersedes the earlier request for client visual acceptance. It is owner-reported business acceptance, not an invented operator signature, a security waiver, or evidence of a deployment.

The starting published commit is `e5d03d72d19e0eff85dff121e537e90f94437e3e`. Its Windows CI run `42166740823` failed the production dependency audit; the HTTP/browser jobs were skipped. Local passes recorded in the staff UI review remain valid within their stated scope, not as a substitute for a successful candidate CI run.

No redesign, schema change, business-data mutation or deployment is authorized by this closure report. Preserve accepted historical prices, queued sales, FIFO costs, permissions and feature ownership.

## Repair scope and evidence

| Item | Action / result |
| --- | --- |
| Production dependency advisories | Scoped `archiver-utils@5.0.2>glob` to `14.0.3`; the installed glob resolves patched minimatch `11.0.5`. No global minimatch override. |
| Build dependency advisories | Scoped `workbox-build@7.4.1>glob` to the same patched version. Actual PWA build verification remains required. |
| Compatibility | Two archive compatibility tests passed after correcting a Windows-native path expectation against the installed pre-change glob baseline. ZIP entry assertions still require forward slashes. Real archives and a streaming Excel workbook are decoded and checked. |
| Production audit | Final JSON audit exits 0 with zero advisories. |
| Full audit | Zero moderate/high/critical; one low development-only deepmerge advisory remains, with no published patched version. It is not ignored or suppressed. See risk note below. |
| Configuration, migrations, recovery and exports | Six selected HTTP/configuration suites passed 35/35 tests on disposable PostgreSQL, including backup/restore and rollback safeguards. This is not a restore of the owner's data or an external backup drill. |
| Catalog tests | Removed obsolete per-variant pricing setup in favor of one accepted product price and warehouse-to-branch product stock. Media-access/revocation and shared-quantity assertions remain. Both updated catalog/media and system visual cases passed in the initial release selection. |
| Legacy POS test setup | Older tests still selected size/color in POS after the approved product-level change. Fixtures/navigation are being aligned while preserving amount, offline, identity, permission and stock assertions. The first recovery browser run stopped at the obsolete helper; it did not demonstrate recovery failure. |
| Fixed-bundle integration defect | Offer editor omitted the operational product IDs now used by POS. It now exposes branch-sale products alongside the existing exact website-option IDs. Existing offers and the pricing engine are unchanged; no automatic cross-channel remapping is performed. The bundle browser case passed its 260/350 pricing assertions. |
| Product-level receipt integration defect | Both the TypeScript transport validator and native Windows renderer required nonempty size/color labels, rejecting the approved product-level receipt. Empty option labels are now accepted; nonempty text keeps its existing validation. The native output omits an empty option row. Printer allowlists, exact keys, amounts, job identity and sale persistence remain unchanged. |

Evidence root: `.scratch/release-closure-20261106/`. Failed runs remain beside corrected runs; result counts must not be added together as one fresh suite.

### Local verification checkpoint before publication

- `http-release.log`: 6 files, **35/35 passed**.
- `archive-compatibility-fixed.log`: **2/2 passed**. The prior red run had a Windows-native path expectation error; the pre-change glob baseline confirmed the same native separators.
- `browser-release.log`: **6 passed / 1 failed**, with the failure at obsolete POS size/color setup in the recovery test. The media, visual, export, restore-state retry, wrong-password and employee privacy cases passed.
- `browser-alignment.log`: **7 passed / 6 failed**. The passing cases cover offers, bundle arithmetic, coupons, same-operation sync, scanner lookup and offline label/receipt synchronization. The failures exposed remaining stale test setup/navigation plus the receipt connector defect noted above.
- `browser-repairs.log`: a separate **5 passed / 1 failed** run, passing POS browse/quote, permanent receipt/reprint/return identity, restore-generation recovery, connected split sale/FIFO, and logout with a queued sale. The connector case still failed and was not represented as green.
- `browser-print-final.log`: a separate **1/1 passed** after correcting the actual product-level receipt validator/native renderer and a test that navigated away before logout completed. Keeps receipt routing, no browser fallback, amount/reference/privacy, reprint, unknown-outcome and one-stock-deduction assertions.
- `print-contract-native.log`: **16 passed / 1 failed**. All native previews passed without printing, including the new product-level receipt. The newly added validator test incorrectly treated whitespace as invalid despite the pre-existing text contract permitting it; that expectation was corrected without changing the text policy.
- `print-contract-fixed.log`: separate **7/7 passed**, including the corrected optional-field validation/queue-routing regression. No physical print job was sent.
- `print-native-final.log`: subsequently **17/17 passed in one fresh run**, without skips or physical printing. The path-with-spaces assertion uses an explicit synthetic Windows path, so it also checks the intended case when the CI checkout path has no spaces.
- `typecheck.log`: all workspace typechecks passed; `print-typecheck.log` subsequently passed the three affected print/internal workspaces after the final validator change.
- `architecture.log`: passed, 544 modules / 1359 dependencies and 464 files in the private-import check.
- `internal-build.log`: scratch staff/PWA build passed with the patched Workbox dependency, 53 precached entries. The ordinary preview's `dist` was preserved.

CI now executes the archive compatibility check and the receipt/native Windows regression files explicitly. Full candidate CI, complete artifact checks and production-runtime evidence remain separate from these local selections.

### Low build-only advisory

The remaining advisory is [deepmerge prototype poisoning, GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), in `vite-plugin-pwa > workbox-build > @rollup/plugin-node-resolve > deepmerge`. No upstream patched release is currently reported. The inspected Workbox consumer invokes the resolver without supplied options, and the resolver merges its static defaults. No customer/request-data input path was identified in that bounded inspection. This is limited exposure analysis, not a claim that the dependency is vulnerability-free. Keep it visible and monitor the upstream patch; do not add an audit ignore or an arbitrary replacement.

## Open-issue reconciliation

GitHub currently has 19 open issues. Their labels and older descriptions are not an accurate remaining-feature counter. No issue is automatically closed by this report.

| Issues | Current disposition |
| --- | --- |
| #55–#61 | The system-evolution map/decision tickets predate the implemented warehouse, pooled product stock, suppliers, minimum prices, customers and transition work. Reconcile against the November implementation reports and current acceptance tests; do not reopen settled owner decisions. |
| #46–#52 | Hardware map/software tasks have implementation and test evidence plus owner-confirmed physical label and receipt output. Earlier pending clipping statements are superseded by the owner's later confirmation that all right-edge text is visible. Preserve the distinction between actual physical observations and simulated connector tests. |
| #33 | Original hero/story description is superseded by the owner's image-only hero and subsequent approved final design. Do not rebuild it to satisfy historical wording. |
| #38 | Optional factual chapters; absence of unprovided facts is not a requirement to fabricate garment claims. |
| #41 | Production performance evidence remains separate from development screenshots and timings. Use the approved sample catalog honestly; do not claim real-merchandise field performance. |
| #42 | Integrated release quality gate remains subject to current-candidate checks and documented external limitations. Client design approval is now recorded. |
| #1 | Umbrella stays open until its release conditions are evidenced; implementation progress and launch approval are distinct. |

## Remaining release boundaries

- A successful current-candidate Windows CI run is still required. Neither a local pass nor a successful push establishes it.
- Current artifacts must be built away from the staff preview's live `dist` folder. The canonical release rehearsal hardcodes its artifact paths; do not overwrite the running preview to create a rehearsal.
- The historical production storefront launch was rejected before process creation by automatic approval review, with `blocked by policy` and no precise rule. It was not a demonstrated application startup exception. Do not evade that refusal through another launcher or port; a permitted normal operator workflow must be established before runtime/performance claims.
- Hosting, TLS/reverse proxy, actual secrets, service ownership, monitoring, and verified external PostgreSQL/media recovery require the target environment. No purchase, production migration, live restore, deployment or ordering activation is performed here.
- An actual operator pilot or device/browser result can only be recorded from observed execution. Client approval does not fill blank operational test records automatically.

This is a working closure record. Append actual final verification, publication and residual blockers before giving release approval.

## Clean-runner follow-up

Candidate `ec4f544b` was published. Windows CI `42206124355` cleared the production audit and archive check, then reported 13 native/queue passes and four failed preview assertions; later jobs were skipped. Local native passes did not establish clean-machine portability.

Source inspection identified an installed-font dependency: the native helper loaded Cairo into a `PrivateFontCollection` but constructed each `Font` using its name, rather than the private `FontFamily`. The follow-up uses and retains that private family, disposing it with the other renderer resources. It does not install a font or alter system settings. This follows the private-font ownership model in [Microsoft's documentation](https://learn.microsoft.com/en-us/dotnet/api/system.drawing.text.privatefontcollection). The failure's precise runtime stage was not present in the original CI assertions; failed preview assertions now retain their bounded result code.

The follow-up native renderer file passed **10/10 locally**, `private-font-renderer.log`. A new matching CI run is required to confirm that this correction resolves the clean-runner failure; do not treat the earlier red run as green.

## Built-artifact rehearsal and candidate follow-up

Candidate `d71389e9` cleared the complete Windows static/build job in run `42206919197`, including the previously failing native previews. Its full HTTP job recorded **246 passed / 30 failed across 36 files**. The failures were confined to three older fixture files that still assigned independent size/color prices. Test data now uses distinct products for distinct prices; the existing monetary, FIFO, return, permission and replay assertions remain. The low-stock assertion uses the product's operational stock identifier, while online orders still submit their actual website-option identifier.

- `http-fixtures.log`: **16 passed / 1 failed** after the pricing setup repair; the remaining failure was the obsolete low-stock identifier expectation.
- `http-fixtures-fixed.log`: fresh **17/17 passed** across reporting edge cases and coupons after correcting that expectation.
- `http-returns-fixed.log`: separate **18/18 passed** for Returns after correcting its fixture setup.

These are affected-file reruns, not one fresh full HTTP pass. The candidate browser job was still running at this checkpoint. A later matching CI result is required before release sign-off.

### Canonical Windows production-mode startup

A separate managed checkout at `d71389e9` was installed with the pinned frozen lockfile and built successfully: API, staff/PWA and storefront, plus bundle separation. It used a new disposable PostgreSQL cluster, isolated database, external media directory and protected operator recovery directory. No business database, ordinary preview artifact, browser queue, pairing, driver or physical printer was changed.

The documented `pnpm release:rehearse` command successfully started the built artifacts on its normal ports: API **3010**, staff **5173**, storefront **3000**. All three returned HTTP 200. Fresh migrations **001–038** and owner bootstrap succeeded; anonymous staff access returned 401 and the authenticated session cookie was HttpOnly. With ordering closed, public quote returned **503 PUBLIC_ORDERING_DISABLED**. A coordinated stop closed all three application ports; the lab was then restarted with ordering enabled for synthetic checkout verification only.

This permitted canonical execution supersedes the unresolved historical startup-rejection boundary for local runtime verification. It does not establish the undocumented cause of that earlier approval refusal. The existing guide accurately anticipates the transient storefront health-probe connection refusal while the API initializes; readiness subsequently succeeded. Do not describe startup as entirely free of transient log errors, or treat loopback HTTP as hosted HTTPS evidence.

### Storefront performance and visual evidence

The approved generated sample range supplied **30 products across four categories**, with sample media uploaded and warehouse/branch quantities entered through the existing feature APIs in the disposable database. Fayoum delivery was configured at **50 EGP** in that database only. The original evaluation data remained unchanged.

The attach-only performance tool needed its product readiness selector aligned with the existing separate color and size controls. Budgets, throttling, observation period and sample count were unchanged; its **7/7 script checks** passed. The initial partial run is retained beside the corrected run. The corrected matrix completed **24 cold samples**: four routes × two viewports × three runs, at the tool's fixed 150 ms / 1.6 Mbps / 4× CPU conditions.

| Route | Phone median LCP | Desktop median LCP | Highest CLS across both viewports |
| --- | --- | --- | --- |
| Homepage | 1.440 s | 1.472 s | 0.001124 |
| Product | 0.940 s | 1.016 s | 0.009977 |
| Bag | 0.756 s | 0.784 s | 0.002974 |
| Checkout | 0.736 s | 0.768 s | 0.001285 |

These are local synthetic-catalog laboratory results. They are not field measurements, representative future merchandise-photo measurements, a matched historical-baseline comparison, or a blanket SF-11 acceptance claim.

Production captures cover full vertical homepage traversal, every horizontal category row and all **30 products** at **390 px and 1440 px**, plus product, bag and checkout. The successful traversal recorded no page exceptions, failed HTTP assets or document horizontal overflow. Natural viewport captures are retained for main visual review. The first capture harness waited for network-idle and later encountered ambiguous selectors during streamed page transitions; those harness failures remain in separate logs and were corrected without application changes. Settled vertical captures use instant scripted scrolling so screenshots do not represent an in-flight smooth scroll as a layout defect.

### Built customer-to-operations smoke

`production-business-smoke.json` records actual browser/API execution against the disposable built stack:

1. Owner login and branch selection through the built staff UI.
2. Mobile guest checkout at **1099 + 50 = 1149 EGP**, yielding `BRV-000001`; the pending request left all branch quantities unchanged.
3. Existing staff agreement and confirmation operations deducted exactly one unit from Abshway and none from Fayoum or the warehouse.
4. Reloading the saved customer acknowledgment after staff confirmation showed **Order request already received**, explicitly avoided asserting current status, and did not resubmit the order.
5. Cancellation after inspection restored exactly the deducted branch quantity.
6. Built dashboard, POS, Products, Receiving, Reports and Backup routes were opened and captured. Initial dashboard loading indicators are not proof of final dashboard data completion.

No real customer, delivery, payment, sale or print was created. This closes a local built-artifact integration check; target hosting, HTTPS/proxy configuration, retained monitoring, operator sign-off and external recovery evidence retain their separate release requirements.

### Final local UX correction

The mobile production walkthrough demonstrated that a successful checkout could retain the form's previous scroll position, leaving the acknowledgment heading and reference above the viewport. The acknowledgment heading now receives programmatic focus and an immediate reveal for new and saved results. This changes presentation only; submission identity, recovery, accepted amounts, cart persistence and stock operations are unchanged.

The affected integration file passed **4/4 browser cases** in `browser-checkout-focus.log`, including explicit mobile focus/viewport assertions and saved-result reload. A separate storefront production build passed in `rehearsal-focus-build.log`. The rebuilt disposable rehearsal repeated the customer-to-operations smoke successfully (`production-business-smoke-after-focus.log`); both acknowledgment variants received focus and were in the viewport. The earlier screenshot showing the problem remains as `checkout-received-before-focus.png` beside the corrected capture. No full performance rerun was needed for an acknowledgment-only focus effect; the original timing matrix remains labeled with its exact pre-focus candidate.

The category row's real loading, simulated 503 error with Retry, and successful recovery were also captured against the production artifact, `production-row-states-fixed.log`. The earlier capture script mistakenly used a Next step that only scrolled already loaded cards; its failed loading expectation is retained separately and is not described as an application fault.

## Windows acceptance follow-up — 7 November 2026

Published checkpoint `80ae72e7` completed Windows CI `42211729605`: static checks/builds succeeded and **36 HTTP files / 276 tests passed**, while browser acceptance recorded **181 passed / 35 failed**. The preceding run `42206919197` was cancelled by the normal workflow concurrency policy after the new publication; its partial browser results are not a complete run.

### Confirmed defects repaired

- **Snapshot stock/version race:** a deterministic PostgreSQL-backed regression captures a zero-quantity catalog response, receives two units through the feature API before the stock-lock read, and observes the issued product quantity. It failed **0 vs 2** before the fix (`snapshot-race-red.log`). The snapshot now takes product-level quantity from the same locked stock map as its stock version, instead of retaining the earlier catalog value. No stock movement, allocation, price or permission rule changes.
- **Recovery of an old cached balance:** an authoritative same-version snapshot can now refresh that branch's cached base. Local pending effects remain separate, and only matching completion proofs acknowledge sales/remove effects. The new browser regression repairs a zero base to three, preserves the pending sale/effect, and verifies **two available** with no server sale created. The complete synchronization file's ten cases subsequently passed within the affected-file run, covering acknowledgments, failed local writes, concurrent tabs, privacy and account recovery.
- **Keyboard category visibility:** the production-layout test reproduced a focused category link partly outside the viewport. Category focus now reveals vertical clipping as well as horizontal clipping, using an immediate centered scroll and accounting for the sticky header. Sorting, URLs and category data are unchanged.

The other changes align browser fixtures and actions with the already approved interface: explicit sales/online tabs, table-row details, Returns invoice selection, order-management disclosures/review dialogs, warehouse intake/transfers and the single product price/shared stock model. Differently priced financial scenarios use distinct products and retain their exact arithmetic. Publicly hidden options are tested as absent; visible options of a stocked product share its stock. Disabled purchase/quantity behavior, unavailable products and Coming Soon remain covered. Product labels and receipts retain their existing test hooks and no physical print was sent.

### Verification ledger

All logs below are separate runs under `.scratch/release-closure-20261106/`; do not add them together as one fresh suite.

| Evidence | Result / scope |
| --- | --- |
| `browser-ci-repairs.log` | **19 passed / 3 failed**; the remaining failures were a payment-status selector and order fields/disclosure selectors. |
| `browser-production-repairs.log` | **3/3 passed**, including offline restart and schema-2 upgrade/deferred-upgrade facts. Built in the separate checkout, preserving the ordinary preview's staff artifact. |
| `browser-staff-overflow.log` | **1/1 passed** at desktop/narrow widths; retained failure-only route/element diagnostics for the earlier CI overflow. No blanket overflow hiding added. |
| `browser-final-followups.log` | **8 passed / 8 failed**; further setup failures included product-ID receiving directed to a retail branch, obsolete optional-stock assumptions, and customer data moved into the order summary. |
| `browser-final-corrections.log` | **17 passed / 4 failed**; full synchronization, order confirmation, layout/contrast, analytics and reduced-motion checks passed. Three keyboard failures were a helper expecting a nonexistent hidden control; the storefront case expected old stock-warning wording. |
| `browser-keyboard-final.log` | **3 passed / 1 failed**; all three keyboard journeys passed at 320/390/768 px. The remaining failure was a raw DOM selector also matching a hidden streamed hero; the visible accessible region is now selected. |
| `snapshot-race-fixed.log` | **17/17 API synchronization tests passed**, including the forced race regression. |
| `typecheck-final-followup.log`, `architecture-final-followup.log` | All workspace typechecks passed; dependency boundaries passed (544 modules / 1359 dependencies, 464 private-import files). |
| `build-final-followup.log` | All three production builds and bundle-separation check passed in the isolated checkout (47 internal / 111 storefront files, three static entry files). |

No redesign, schema/migration, dependency upgrade, ordinary business-data edit, printer/driver operation, issue closure or deployment is part of this follow-up. The protected review file remains hash-identical. Final matching remote CI is still required; the older red or partial runs must never be relabeled green.

Final focused storefront verification: `browser-storefront-scoped.log` passed **1/1**. The preceding `browser-storefront-final.log` failed because a broad alert locator also selected Next.js's route announcer; the assertion now targets the cart line's actual warning and retains its exact one-unit limit. All three keyboard journeys remain separately recorded as passed in `browser-keyboard-final.log`. These reruns are not presented as one fresh full browser suite.
