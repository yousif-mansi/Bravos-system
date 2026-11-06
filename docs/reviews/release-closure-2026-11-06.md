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
