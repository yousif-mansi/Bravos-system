# Local development — ticket 02

Verified local runtimes at implementation: Node 22.13.1, pnpm 10.34.5 (installed locally via npm into `.local/tools`, not globally), Git 2.54.0. PostgreSQL is not installed as a machine service. Tests and local setup start an isolated PostgreSQL cluster via the `embedded-postgres` package, which distributes real Postgres binaries.

A PATH `pnpm` wrapper may be a different major version or a different Node runtime. Nested scripts (`pnpm test:browser` webServers, `pnpm --filter …`) inherit PATH, so the session must prepend the pinned copies before any workspace command. Corepack auto-pin is disabled so those nested calls cannot switch the package manager.

The October 9, 2026 security refresh selects Node 22.23.3 and raises supported Node to `>=22.23.3 <23`. The earlier Node 22.13.1 observation above remains historical evidence. Node 22.23.3 includes the [July Node 22 security fixes](https://nodejs.org/en/blog/release/v22.23.2) and the subsequent [September patch](https://nodejs.org/en/blog/release/v22.23.3). No global Node replacement or pnpm install is required.

## Clean clone (PowerShell)

Run these in the repository root. First download the official Windows x64 portable Node archive, verify its SHA-256 from the [Node 22.23.3 release checksums](https://nodejs.org/en/blog/release/v22.23.3), and extract it into the ignored local tools directory. For another operating system, use its official archive and checksum, then adjust `$node` below.

```powershell
New-Item -ItemType Directory -Force .local\tools\downloads | Out-Null
$nodeArchive = ".local\tools\downloads\node-v22.23.3-win-x64.zip"
Invoke-WebRequest "https://nodejs.org/dist/v22.23.3/node-v22.23.3-win-x64.zip" -OutFile $nodeArchive
$expectedNodeHash = "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71"
if ((Get-FileHash -LiteralPath $nodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expectedNodeHash) {
  throw "Portable Node archive checksum mismatch."
}
Expand-Archive -LiteralPath $nodeArchive -DestinationPath .local\tools
```

```powershell
$node = (Resolve-Path ".local\tools\node-v22.23.3-win-x64\node.exe").Path
$nodeDir = Split-Path $node
$env:COREPACK_ENABLE_AUTO_PIN = "0"

# 1. Confirm the selected Node 22 patch
& $node -v
if ((& $node -v) -ne "v22.23.3") { throw "Expected Node 22.23.3." }

# 2. Install the pinned pnpm into the ignored local prefix (not globally)
New-Item -ItemType Directory -Force .local\tools | Out-Null
& $node (Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js") install pnpm@10.34.5 --prefix .local\tools

# 3. Prepend Node and the local pnpm for this session and nested scripts
$env:PATH = "$(Resolve-Path .\.local\tools\node_modules\.bin);$nodeDir;$env:PATH"
pnpm --version

# 4. Install workspace dependencies from the committed lockfile
pnpm install --frozen-lockfile

# 5. First-time Playwright Chromium (skip if this machine already has that Playwright version's browser)
pnpm exec playwright install chromium

# 6. Labeled local data and demo accounts
pnpm setup:local
```

Step 6 is only for a clean clone. It labels accounts on the database named by `BRAVOS_SETUP_DATABASE_NAME`, which defaults to `bravos`, and it rewrites that setup root's `dev.env`. It does not load the sample catalog or product images. On the existing evaluation machine, skip step 6 and follow [Existing evaluation instance](#existing-evaluation-instance).

After step 3, `pnpm` must report `10.34.5` and `node` must report `v22.23.3`. `scripts/pinned-env.ts` keeps child processes on the running Node executable's directory. `.local/tools` and `.local/tarballs` are local caches and must not be committed. `pnpm-lock.yaml` is the portable lockfile.

## Start the three processes

Keep the same PATH and `COREPACK_ENABLE_AUTO_PIN=0` in every terminal.

Terminal 1:

```powershell
pnpm postgres:dev
```

Terminal 2:

```powershell
pnpm dev
```

This starts:

- staff app: http://127.0.0.1:5173
- public entry: http://127.0.0.1:3000
- API: http://127.0.0.1:3010

`setup:local` writes `.local/postgres`, `.local/dev.env`, `.local/demo-credentials.txt`, and `.local/owner-recovery-outbox/`. `postgres:dev` uses `.local/postgres`. The API loads `.local/dev.env` for any variables not already in the environment. Demo login names and passwords are only in `.local/demo-credentials.txt`. Do not commit that file.

Repeated `setup:local` preserves existing accounts, verifies recorded demo passwords by signing in, and does not rotate them. A supplied password that does not match is rejected; a verification failure that is not an authentication rejection leaves the credentials file unchanged. Setup refuses to run when `NODE_ENV=production`. Production fixtures are never created silently. Credentials are not printed to setup logs.

The API production start path is `apps/api` `pnpm start` after `pnpm build`, which emits `apps/api/dist/main.js`.

## Isolated setup verification (not the ordinary flow)

`BRAVOS_SETUP_ROOT` is only an override for `setup:local` during isolated verification. It does not change `postgres:dev` or the API env file. Ordinary work stays on `.local`.

To point PostgreSQL at another data directory, set `BRAVOS_PG_DATA_DIR` and `BRAVOS_PG_PORT` for `postgres:dev`. To start the API against that database, export `DATABASE_URL` and the other values from that environment (process env wins over `.local/dev.env`).

## Owner recovery

Owner recovery does not send email or WhatsApp. In local development the delivery adapter writes a one-time token under `.local/owner-recovery-outbox/`. After requesting recovery in the staff app, read `.local/owner-recovery-outbox/latest.json` on this machine, then submit the token on the recovery screen. The HTTP API never returns the token. Production rejects this local adapter. The operator-file recovery contract and its OS permission checks are documented in [release-rehearsal.md](release-rehearsal.md).

## Checks

Use the same Node 22 + pinned pnpm PATH as above.

```powershell
pnpm typecheck
pnpm check:architecture
pnpm test:http
pnpm test:browser
pnpm build
pnpm migrate:scratch
```

`check:architecture` enforces source import and cycle rules and ignores generated `dist` / `.next` output. Production staff-chunk separation is checked by `pnpm build` (`scripts/check-bundles.mjs`) and the production-login browser test.

## Existing evaluation instance

On 2026-10-16 the ordinary evaluation instance is PostgreSQL port 54329, database `bravos_phase1_20260929`, API `http://127.0.0.1:3010`, staff `http://127.0.0.1:5173`, and store `http://127.0.0.1:3000`. Main had these processes running. When they are down, start the same identity again with the pinned PATH from above:

```powershell
pnpm postgres:dev
pnpm dev
```

`postgres:dev` uses `.local/postgres` unless `BRAVOS_PG_DATA_DIR` is set, and port 54329 unless `BRAVOS_PG_PORT` is set. The API reads `.local/dev.env` only for variables that are absent from the process environment. Leave that file and `bravos_phase1_20260929` as they are. Do not export a different `DATABASE_URL` for this ordinary start, and do not run `pnpm setup:local` here: its default database name is `bravos`, and a setup aimed at `.local` rewrites `.local/dev.env`.

`setup:local` is not sample intake. A fresh clone has neither the populated database nor the sample media. Intake is documented in [sample-catalog.md](sample-catalog.md) and applies only to the already-running development API. Applying it again does not refill stock consumed by a sale.

A persistent client-training database was not created. Automated checks keep their own temporary databases. `BRAVOS_SETUP_ROOT` affects only `setup:local` and does not retarget `postgres:dev` or `.local/dev.env`. The browse session is [client-local-acceptance.md](client-local-acceptance.md).

18 October follow-up: the owner freed memory, the unchanged startup guard passed, and the isolated practice instance was initialized and verified on PostgreSQL 54330 / API 3012 / staff 5177 / storefront 3002. The ordinary instance stayed stopped. See the [client guide](client-local-acceptance.md) and [completed UX review](../reviews/business-ux-windows-ci-2026-10-18.md). These are dated observations, not a current health check or an instruction to recreate the database.

## What this local stack includes

Staff routes in `apps/internal/src/App.tsx` include نقطة البيع (`/lookup`), استلام المخزون (`/receiving`), المنتجات (`/catalog`), الطلبات الأونلاين (`/online-orders`), المرتجعات (`/returns`), المصروفات (`/expenses`), التقارير (`/reports`, with PDF and Excel download), نسخة احتياطية (`/backup`), and استعادة البيانات (`/restore`). The public store serves the home, a product page, `/cart`, and `/checkout`. Receiving shows each branch balance and the remaining quantity on a cost batch. The old ticket-02 note that POS checkout, FIFO batches, media upload, and the public catalog were unimplemented is historical.

The staff service worker registers from a production build. `apps/internal/src/offline-ready.ts` returns immediately unless `import.meta.env.PROD` is set, and `devOptions.enabled` is false in `apps/internal/vite.config.ts`, so `pnpm dev` does not register it. `tests/browser/offline-production.spec.ts` starts the built staff preview on port 5176 against the isolated API on 3011 and does not start production Next. Hosting and a public domain remain outside this local session.
