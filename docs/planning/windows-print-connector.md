# Windows print connector

The Windows connector pairs with one staff browser origin and sends barcode labels to the dedicated label queue. The current staff app prints receipts from the same document it uses for the receipt preview. Native receipt jobs remain supported for older staff builds.

The connector has no database and does not call the business API. A job is not a sale. Reprints do not change stock.

`@bravos/print-contracts` holds the protocol and validators. `@bravos/print-connector` is the server, Windows adapters, and native renderer. The connector depends on `@bravos/print-contracts` with `workspace:*` and on `jsbarcode` `3.12.3`, which encodes the saved product code into CODE128 modules. `src/index.ts` exports `startWindowsPrintConnector` and `formatLocalNotice`. Importing that entry, or `renderers/index.ts`, does not listen, spawn, or submit. `nativeModuleEffects` records that.

## Listen and origin

- Bind only `127.0.0.1:17831`. Other hosts, `localhost`, and other production ports are refused.
- Staff origin defaults to `http://127.0.0.1:5177`.
- Set `BRAVOS_PRINT_STAFF_ORIGIN` to `https://staff.bravoswear.store` for production. Existing HTTP loopback development origins remain supported. A running connector trusts only the configured origin.
- Every request must use `Host: 127.0.0.1:17831`. Pair, status, jobs, and unpair also require the exact `Origin`.
- CORS echoes that origin only. There is no `*` and no credentialed CORS.
- `Access-Control-Allow-Private-Network: true` is set only for a trusted-origin preflight that asks for it.
- `GET /health` returns `{"ok":true}` and nothing else. It is not a status or pairing endpoint.

Manual start from the repository root, with the workspace Node pin `22.23.3` (`>=22.23.3 <23`):

```text
pnpm dev:print-connector
```

That script is `pnpm --filter @bravos/print-connector start`, which runs `node src/main.ts`. Empty arguments call `startWindowsPrintConnector`. Do not install a service, startup entry, firewall rule, driver, or kiosk policy.

## Connect a production cashier station

1. In Windows **Printers & scanners**, verify the queue names below. Select 38 × 25 mm gap labels at 203 dpi for the XP-236B. Confirm the queues point to different connected USB devices.
2. Start the updated connector under the cashier's Windows account. Set `BRAVOS_PRINT_STAFF_ORIGIN=https://staff.bravoswear.store` in the PowerShell session before running `pnpm dev:print-connector`. Use the pinned Node and pnpm tools in the updated checkout. Keep the connector running during the shift.
3. Open production staff POS in the cashier's regular Chrome profile. Allow Chrome access to apps on this device or the local network. On **الرئيسية → برنامج الطباعة**, enter the private 16-character terminal code in **رمز الربط** and click **ربط هذا الجهاز** within two minutes. Check both destination names. If Chrome denied access, grant the site permission and reload. Use the pairing reset below if a fresh code is needed.
4. Print and scan one 38 × 25 mm label for an existing product. Reprint a completed sale, select **Bravos Receipts - Xprinter XP-80TS** in the browser dialog, and check that the 75 mm portrait receipt prints with both outer table borders intact.

Production label printing requires pairing. Receipt printing is available through the browser dialog.

## Printers

| Job | Fixed queue | Driver check | Paper |
| --- | --- | --- | --- |
| `label` | `Xprinter XP-236B` | `Xprinter XP-236B` | 38×25 mm, 203 dpi, profile `xp236b-38x25` |
| `receipt` (older staff builds) | `Bravos Receipts - Xprinter XP-80TS` | `Xprinter XP-80` or `XP-80C` | 80 mm roll, 58 mm portrait layout, copies exactly 1 |

The connector routes each job to its allowlisted queue. Its job schema rejects printer names, paths, commands, HTML, and scripts. For older staff builds it accepts receipt `contentWidthMm` values 48 and 72 and centers the 58 mm design on the XP-80TS 80 mm roll. Copies for a label are an integer 1..100. An optional label `product.price` carries the saved default selling price.

`startWindowsPrintConnector` dynamically imports `submitNativePrint` and passes it to `createWindowsPrintPort`. The allowlist runs before that submitter. Production does not add a second printer probe; the native submitter probes the live USB queue (`USB###`, matching device id, ready status, not offline). A missing submitter still fails closed with `renderer_unavailable` after the platform and allowlist. Each job is submitted on its own, so an offline receipt does not block a later label.

If an XP-236B prints a Windows test page through its named queue but its Plug and Play instance ID ends in a different USB number, an operator can set `BRAVOS_PRINT_LABEL_USB_PORT` to that queue's verified Windows port and `BRAVOS_PRINT_LABEL_USB_DEVICE` to the exact XP-236B instance ID in the local connector launcher. Confirm the test page came out of the XP-236B before setting either value. On every label job the helper checks the queue, driver and live spooler state, requires that exact healthy device to be present, and rejects duplicate XP-236Bs or a conflicting queue or device on the verified port. With a binding configured, an unverified match fails closed. Reverify the Windows test page if the printer, queue or USB connection changes. The binding is read locally by the Windows helper and applies only to labels.

`normalizePortResult` accepts `invalid_layout` and `invalid_job` as definite failures. A throw, an extra field, or any other unrecognized result stays `unknown` and is not retried.

## Native drawing

The XP-236B label is 38 × 25 mm at 203 dpi with 2 mm side margins and 1.5 mm top and bottom margins. Its top row shows the SKU and Bravos logo, the middle row shows the CODE128 barcode, and the bottom row shows the product name and saved price. Long names end in an ellipsis so the price stays visible. The barcode keeps 10 quiet modules on each side and uses the largest fitting module width of one or two printer dots. A code that cannot fit is rejected with `invalid_layout`. The connector draws the entire label in black and white.

For legacy receipt jobs the helper draws the 58 mm portrait layout centered on the 80 mm roll at 203 dpi using its bundled `Cairo-Regular.ttf` and `bravos-receipt-logo.png`. The current 75 mm receipt is rendered by the browser and uses the same Cairo web fonts and document as the staff preview.

`submitted` means the native port reported an exact spooler handoff. It is not physical success. `queued` and `submitting` are not terminal and are not paper output.

## Jobs

`LabelJob` carries `product.code` and `product.name` unchanged, and may include `product.price` as the saved default selling price in pounds. Names are stored display text: bounded length, no C0 controls or bidi overrides, and otherwise the characters the catalog already saved. The renderer draws that text as data. There is no HTML interpreter.

`ReceiptJob.receiptView` follows the printed public fields of `ReceiptView`: brand, branch, contact phone, `printedReference`, Cairo or stored time, cashier, customer, lines, adjustments, totals, payment lines, and `contentWidthMm`. `serverReference` and `localOperationReference` are not on this transport. Amounts stay the strings the paired app already formatted. Bounds follow the producers: product, size, color, branch, and cashier names 80; customer name 120; phones 40; printed reference 256; money up to `10000000.00`; quantity 1..1000000. Purchase-cost, printer, path, command, and HTML fields are rejected keys. The product code stays the existing SKU pattern.

The client supplies a new UUID v4 for each deliberate print or reprint. The same id and the same canonical payload return the saved state and do not print again, including after a process restart. The same id with a different payload is HTTP 409. The outstanding queue is 8 and runs one submission at a time. Payloads are dropped once the job is terminal. Nothing is written to a business database.

Dedupe state is a job journal of `id`, `hash`, `kind`, `phase`, `failureCode`, and timestamps. It never stores the document, token, or customer text. Tests use an in-memory journal. Windows production writes `%LOCALAPPDATA%\Bravos\print-connector\job-journal.json`. The partial file is flushed to disk before the backup rename. There is no process-lifetime cap of 200 in-memory jobs. Queued acceptance is saved before the response, and `submitting` is saved before `printPort.submit`. A terminal state is saved after the port returns. If that save fails before the port is called, the job is not spooled. If it fails after a possible submission, the state is `unknown` and is not retried. On startup, saved terminal rows are loaded and outstanding rows (`queued` or `submitting`) become `unknown` without a payload, so they are not printed again. Unpair does not clear this file.

Terminal rows older than 30 days may be removed. The metadata cap is 50,000 records. At the cap the connector returns HTTP 429 `job_retention_full`. It does not delete an outstanding or recent id to make room. There is no history screen.

States:

- `queued` / `submitting`: not terminal, and not physical success.
- `submitted`: the port reported an exact submission. Still not physical success.
- `failed`: a definite pre-submission failure (`printer_missing`, `printer_offline`, `unsupported_driver`, `renderer_unavailable`, `unsupported_platform`, `invalid_layout`, `invalid_job`, or `journal_unavailable` when the journal rejects the record before the port is called).
- `unknown` (`submission_uncertain`): the port threw, the port returned anything other than an exact result, the journal could not be saved after a possible submission, or a restart found the id still `queued` or `submitting`. The connector does not retry it. The operator checks the printer manually before sending a reprint.

A reprint is a new UUID from the operator. There is no retry route. Restarting does not resume a payload. An id that might have reached a printer stays `unknown`.

`POST /jobs` returns `202` and the sanitized job record. `GET /jobs/:id` and `GET /status` require the bearer token. Responses do not include the document, customer text, pairing code, or token.

## Pairing

On startup, if no token is stored, the process writes one 16-character code to stdout. That code is not available from HTTP. It expires after 2 minutes. Five wrong attempts lock pairing for 1 minute. A successful code is single-use. Two concurrent submits can produce only one token.

The token is 32 random bytes, returned once in `{ "token": "..." }`, and stored only as a SHA-256 hash bound to the staff origin. Comparison uses `timingSafeEqual` on the digests. Status, jobs, and unpair require `Authorization: Bearer`. Unpair clears the pairing record and shows a new local code. It leaves the job journal in place.

On Windows the hash record is protected with DPAPI `CurrentUser` and written under `%LOCALAPPDATA%\Bravos\print-connector\pairing.dpapi`. The helper is the fixed script `apps/print-connector/helpers/dpapi-current-user.ps1`. Node spawns `System32\WindowsPowerShell\v1.0\powershell.exe` with `-NoProfile -NonInteractive -File` and that script path only (`shell: false`). Node quotes the script path; `windowsVerbatimArguments` is not set, because this workspace path contains spaces. The payload travels on stdin. User strings are not interpolated into a PowerShell command. A failed rename deletes only the owned partial file. If the stored origin does not match the configured staff origin, the pairing blob is cleared and a new code is shown. If DPAPI cannot be read, the process stops instead of pairing over an unreadable blob.

The staff workspace pairs once for the browser origin. `PrinterConnectionPanel` posts the stdout code to `POST /pair` and keeps the returned token in this browser. A later status call must report the same staff origin. After a successful pair, the panel calls `selectKnownLabelProfile`, which stores `xp236b-38x25` under `bravos.product-label.profile`. That write does not overwrite the saved generic width, height, or dpi preference. A blocked profile store does not undo the token.

With a pairing token, the 38×25 / 203 dpi label is sent only to `http://127.0.0.1:17831`. An XP-236B profile requires a token. An unpaired generic label can open the browser dialog in local development. All receipt actions open the browser print dialog, where the cashier chooses the receipt printer.

## Pairing reset

`pnpm print:reset-pairing` passes `--reset-pairing`. Any other argument is rejected. The command checks that `127.0.0.1:17831` is not already accepting connections. If it is, the process tells the operator to stop the program and does not clear storage or kill the process. If the port is free, it calls `createWindowsDpapiTokenStore().clear()` for the current Windows user and leaves `job-journal.json` in place. The next ordinary start prints a new one-time code. Reset is never automatic and does not change services or drivers.
