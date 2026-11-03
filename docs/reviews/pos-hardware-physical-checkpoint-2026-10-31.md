# Physical hardware checkpoint — 31 October 2026

This records hardware observations, separately from the completed software checks. It is not a production or all-device acceptance.

- **Receipt printer XP-80TS:** the owner confirmed a clear sample on 29 October, and confirmed an actual sale receipt printed after USB reconnection. Four duplicate queued attempts were cancelled at the owner's request; one was released. No extra sale was created.
- **Label printer XP-236B:** recognized by Windows with the exact registered model driver on USB004. Owner reports that reseating the roll/lid cleared the flashing error and restored FEED. Actual adhesive label size: **38 × 25 mm**.
- **Existing product tested:** `BRV-SAMPLE-001`, Tapered Twill Pants, read from the existing local database without modification.
- **Compact hardware proof:** separate scratch diagnostic, native 203 dpi, one-dot CODE128, full saved identifier, ten-module quiet zones each side, one copy. The PNG independently decoded the exact SKU on 80 scanlines. The standard application remains on its existing two-dot/minimum-40-mm layout; the proof does not claim that app-based 38 × 25 mm printing is integrated.
- **Physical result:** the first proof fed a blank label. After the owner requested a retry, the same code and driver/job settings produced barcode and product text, confirmed by the owner. The exact reason for the earlier blank output is unconfirmed. Windows then reported Normal with an empty queue.
- **Scanner UP-600:** subsequently connected by the owner. Windows enumerated `USB\VID_34EB&PID_1502\00000000011C` as HIDKeyBoard and a matching HID Keyboard Device, both OK, with Microsoft's existing `HidUsb`/`kbdhid` services. The physical UP-600 model comes from the owner's box; Windows reports a generic keyboard identity. No extra driver was installed. The owner returned exact text `BRV-SAMPLE-001` in response to the scan check. Raw text matches; automatic physical scanning into the Bravos product-code field still awaits owner confirmation.

The per-job paper request was 38.100 × 24.892 mm after Windows hundredths-inch rounding, at 203 × 203 dpi. Global printer defaults, receipt routing, drivers, application code, catalog records, and stock were not changed by these label tests.

Grok prepared the scratch helper and later reviewed its blank-output path without changes. No full-blank rendering defect was confirmed. Its review noted fractional hard-margin compensation as a potential one-dot quality concern, not an explanation of missing large text. The successful unchanged retry does not settle compact barcode readability. Investigate that concern if the physical scan fails; do not weaken the normal app safeguards based only on a PNG decode or spooler success.

Evidence: `.scratch/xp236b-20261031/`, including `compact-proof-decode.json`, `compact-physical-evidence.json`, `compact-retry-1-evidence.json`, both print logs, preview PNG, USB baseline and Grok reports. No commit/push or issue closure was performed.

The local API and staff built preview were restarted using the existing database and credentials. The independent lookup check returned HTTP 200, Tapered Twill Pants, and four variants. Its first API attempt omitted active-branch selection and returned 403; the corrected verification selected the existing authorized Abshway branch in its separate session before lookup. This was a harness setup correction, not an application change. No sale or stock operation was sent. Browser control was unavailable, so this API check is not claimed as an observed physical UI scan.

Next: confirm automatic product lookup when the owner physically scans in Bravos, then decide whether the tested compact 38 × 25 mm profile is suitable for application integration. The ordinary app's minimum-40-mm/two-dot label layout has not yet been changed.

## Subsequent owner feedback and authorized revisions

The owner subsequently confirmed that the scanner reads the physical label, but reported poor centering and insufficient visual size. The supplied photograph also shows content at the upper edge with unused space below. The cause of the physical vertical offset is not established; layout changes alone are not yet accepted as its solution.

The owner also demonstrated that browser label printing selects the receipt destination. A web page cannot restrict the destination in the normal browser print dialog. The owner approved a restricted Windows connector with explicit label and receipt printer routes. Implementation is in progress and is not claimed as installed, paired, or end-to-end verified.

The compact application layout now has preliminary source verification: 12 label script tests and the staff application typecheck passed. Browser rendering, the final connector, and a new physical alignment check remain pending. Existing receipt-numbering work remains uncommitted and untouched by these checks.

The label driver's saved user paper size was 50.8 × 101.6 mm. A dry-run Windows PrintTicket validation accepts 38 × 25 mm, but also normalizes darkness from 7 to 6. No ticket was committed, avoiding an unrequested darkness change. The before/validated tickets and dry-run helper are retained in scratch evidence. This finding does not establish the cause of the physical offset.

### Compact label source verification

- The XP-236B compact profile is an explicit saved device choice; valid custom settings retain their independent values. Generic labels retain their two-dot behavior. The label itself, barcode and text are centered; the preview iframe now uses the actual paper height rather than the browser's default blank canvas.
- Twelve script tests passed, followed by the staff typecheck and staff/PWA build.
- The first focused browser run was **6 passed / 1 failed**. Its offline case misclassified receipt `span.label` text as a barcode page. The harness now counts actual `section.label` pages, keeping the receipt-content and synchronization assertions intact.
- A separate post-repair run passed **3/3**: offline label/receipt synchronization, compact wide/narrow preview, and mixed-script fit/overflow. This is not claimed as a fresh seven-case pass. Evidence: `label-browser-review.log`, `label-browser-review-repair.log`, screenshots and traces under the same scratch folder.
- The connector remains under review and is not connected to these browser-print tests. No new physical print job or business-data change was performed by this verification.

### Connector foundation review and verification

The foundation review found and repaired Windows helper argument quoting, case-sensitive Windows-directory handling, overly restrictive display-text validation, internal receipt references in the transport, restart-unsafe in-memory job tracking, and the 200-job lifetime limit. The new journal retains sanitized job metadata for 30 days with a 50,000-record cap; writes are flushed before rename and before submission. Restarted outstanding jobs become unknown and are not replayed.

Verification history is retained separately: the initial baseline was 17/19, the journal increment 18/19, and the first expanded suite 27/28. The final corrected foundation suite is **28/28 passed**, including a real Windows CurrentUser DPAPI fixture round-trip through the fixed helper path containing spaces. No ordinary pairing record was read or written by that fixture. The shared contracts typecheck and a scoped foundation typecheck passed; the latter excludes the concurrently unfinished native renderer files and is not a full connector-build claim.

Evidence is under the same scratch folder: `connector-foundation-baseline.log`, `connector-journal-increment.log`, `connector-finalization-tests.log`, `connector-case-corrected-tests.log`, `print-contracts-typecheck.log`, and `connector-foundation-typecheck.log`. Offline workspace linking downloaded no packages; the lockfile registers only the two new local workspaces at this checkpoint.

Native rendering, staff pairing/dispatch integration, full integrated checks, and a new physical alignment/routing confirmation remain pending. The ordinary application database, printer configuration, protected review file and git index were not changed by these foundation tests.

### Assembled connector verification and physical label acceptance

This later checkpoint supersedes the pending software and label-alignment statements above; historical runs remain recorded.

- Grok implemented the native renderer, staff pairing and dispatch, fixed queue routing, and manual composition. Main reviewed the source and ran the checks. The connector has no business database access. Paired printing does not use the browser/default-printer fallback.
- Native previews used bundled Cairo and the official Bravos logo. The 304 × 200 dot label preserves full saved SKU/name and ten-module quiet zones. Receipt previews include Arabic, saved customer/receipt details, and totals without currency symbols or internal identifiers; a 40-line receipt paginates into four pages. Preview rendering did not print.
- The first assembled browser regression run was **12 passed / 1 failed**. The compact-label fixture lacked health/status responses. A separate paired-browser run failed before pairing; it exposed unbound browser `fetch` being called on the dependency object. Grok bound the default fetch to the global receiver and added a regression test; injected transports remain supported. The fixture was corrected without weakening assertions.
- The separate corrected browser run is **2/2 passed**, not a claimed fresh 14-case run. It covers the compact wide/narrow label preview and pairing/routing, offline durable Save-and-Print, offline reprint, permanent receipt reference, accepted price, no browser-print fallback or internal-cost/reference leakage, then exactly one synchronized sale and one stock deduction. Unknown print outcomes do not resubmit automatically. Browser tests use isolated data and a fake print connector; they do not print.
- Final focused script suite: **80/80 passed, no skips**. All three affected workspaces passed typecheck. Architecture checks passed (418 modules / 1259 dependencies; private-import check 357 files). Staff/PWA build passed. An initial final-gate command used the nonexistent `architecture` script; it was corrected to `check:architecture`, which passed. Red/harness logs remain beside reruns.
- Lazy barcode loading is preserved: the staff entry bundle does not contain JsBarcode. The pairing action loads the label module only when needed. Offline installation reused cached packages, without downloads.
- Read-only native device probe returned **label ready / receipt offline**. The XP-236B is the exact registered driver on USB004. No printer defaults, driver, service, registry, startup or firewall settings were changed.
- Main manually started the loopback connector for staff origin `http://127.0.0.1:5177`. With no pre-existing ordinary pairing record, a temporary authenticated verification session submitted **one** existing-product label (`BRV-SAMPLE-001`, copies 1, 38 × 25 mm) through the actual HTTP queue/journal/native renderer. Job `14fc9d16-f03c-4782-bfc7-d77fedca8d96` reached `submitted` at `2026-10-31T13:32:08.630Z`. The temporary pairing was explicitly removed afterward, preserving the journal and issuing a fresh browser pairing code. No token or customer payload was saved in the evidence.
- **Owner physical confirmation:** “Yes—centered, clear, and scans correctly.” This confirms the new label output physically, beyond spooler submission. No sale or stock movement was created by that print.

Remaining hardware acceptance: pair the owner's staff browser; reconnect the XP-80TS and verify one receipt through the new connector path; explicitly confirm a physical scanner opens the expected product in Bravos POS, with size/color still chosen manually. Earlier receipt success remains valid evidence for the prior browser path, not proof of the newly composed receipt connector path.

Evidence: `print-closure-script-tests.log`, `print-closure-typecheck.log`, `print-closure-architecture-corrected.log`, `print-closure-build.log`, `paired-corrected-browser.log`, native PNG/metadata in `native-final-previews/`, and `connector-physical-label-evidence.json`, all beneath `.scratch/xp236b-20261031/`. Nothing staged, committed, pushed or deployed at this checkpoint; protected review hash remains unchanged.

### Receipt reconnection and exact USB identity correction

The owner connected the receipt printer and disconnected the label printer. Windows reported the receipt queue on USB003 with the exact Xprinter XP-80 driver, `WorkOffline=false`, and a present OK device. The new native probe nevertheless reported receipt offline: its matcher did not recognize the device's actual `USBPRINT\PRINTERPOS-80\6&CC95D4D&0&USB003` identity. Its verified parent is `USB\VID_0483&PID_5743\18C078398A00`, matching the earlier receipt-printer serial. This was a demonstrated detection defect, not evidence that a driver reinstall was required.

Grok added that exact receipt-only USBPRINT prefix consistently in TypeScript and C#. The fixed queue/driver, present OK state, USB-port suffix and label exclusion checks remain. Main reviewed the changes. All **8/8** native-renderer tests passed, including wrong-port, wrong-driver, non-OK and never-label cases; the connector typecheck passed. A fresh read-only native probe then reported **receipt ready / label offline**, matching the actual connections.

Main restarted only the owned, unpaired connector process, preserving the job journal. One clearly marked **TEST-NO-SALE** receipt was sent through authenticated HTTP dispatch, journal and native rendering to the fixed receipt queue. Job `136b61b2-a04e-4c5f-b429-ab03b92fdba7` reached `submitted` at `2026-10-31T13:43:03.623Z`; physical clarity awaits owner confirmation. The temporary verification pairing was removed afterward. No sale, stock or other business record was created, and printer/driver defaults were not changed.

Additional evidence: `receipt-connected-usb-identity.json`, `receipt-usb-alias-tests.log`, `receipt-usb-alias-typecheck.log`, and `connector-physical-receipt-evidence.json` in the same scratch directory. These eight tests are a separate focused rerun after the prior 80-case suite, not a claim of a fresh 81-case run.

### 1 November follow-up — receipt printed, right-edge clipping remains open

The owner subsequently confirmed that the TEST-NO-SALE receipt did print, then reported clipped text and specified **the right edge**. Receipt delivery is confirmed; receipt visual acceptance is **not** complete.

Read-only measurement of an in-memory 80 mm custom page reports zero hard margins and a full-page printable width (314.77832 hundredths of an inch). No driver preferences were changed and this measurement did not print. Those reported bounds cannot establish the physical head's usable width.

Source review found conflicting right/center flags for centered Arabic receipt text, and native receipt content offset by 4 mm relative to the earlier browser receipt's 72 mm content band. Grok prepared a receipt-only correction: keep the 80 mm paper/bitmap, place the existing content inside the first 72 mm with the same inner padding, center the logo in that band, and select exactly one horizontal text alignment while retaining Arabic direction. Label layout and all business/transport logic remain unchanged. Added preview tests inspect raster ink centering and the content-band boundary rather than relying only on the constant `clipped:false` metadata.

At source-review checkpoint, rendering/tests and a controlled physical recheck are still pending the unchanged Windows memory guard (3 GiB physical / 4 GiB virtual). No additional receipt was printed during this investigation. Evidence and pre-edit source snapshots are under `.scratch/receipt-clipping-20261101/`. The exact physical clipping cause is not claimed proven until the corrected output is checked.

Memory subsequently recovered above the existing guard. The focused native renderer suite passed **9/9 with no skips**, including actual Arabic glyph-ink centering, the 72 mm content-band bound, long receipt pagination and unchanged label barcode rendering/decoding. Main inspected the corrected one-page preview: 639 × 1198 dots, ink x=12..563, entirely within the 575-dot content band. Preview rendering did not print.

With an empty receipt queue and the exact receipt device connected, main started the connector manually and sent **one** corrected TEST-NO-SALE receipt through its authenticated HTTP queue and native renderer. Job `59d394c3-dcab-4448-98a0-1d7f27eea620` reached `submitted` at `2026-11-01T17:43:14.611Z`. Temporary verification pairing was removed afterward without clearing the journal. No business data, driver or global printer preference changed. **Owner confirmation that the right edge is now fully visible remains pending.** Evidence: `native-renderer-tests.log`, `receipt-corrected.png`, `receipt-corrected.json`, `driver-geometry.json` and `physical-receipt-corrected.json` under the same scratch folder. No commit or push was made.

**Physical acceptance, 1 November:** the owner answered **“Yes—all text is visible now”** to the corrected-receipt check covering the right-edge receipt number, customer, total and payment labels. The corrected receipt's right-edge clipping issue is therefore physically verified as resolved. No further print was sent for this confirmation. The earlier label acceptance remains recorded separately. Remaining end-user setup is pairing the owner's staff browser; explicit physical scanner-to-POS lookup acceptance also remains separate from successful barcode decoding. This confirmation does not stage, commit, push or deploy changes.
