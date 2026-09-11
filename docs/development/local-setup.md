# Local development — ticket 02

Verified local runtimes at implementation: Node 22.13.1, pnpm 10.34.5 (installed locally via npm into `.local/tools`, not globally), Git 2.54.0. PostgreSQL is not installed as a machine service. Tests and local setup start an isolated PostgreSQL cluster via the `embedded-postgres` package, which distributes real Postgres binaries.

A PATH `pnpm` wrapper may be a different major version or a different Node runtime. Nested scripts (`pnpm test:browser` webServers, `pnpm --filter …`) inherit PATH, so the session must prepend the pinned copies before any workspace command. Corepack auto-pin is disabled so those nested calls cannot switch the package manager.

Supported Node is `>=22.13.1 <23`. No global pnpm install is required.

## Clean clone (PowerShell)

Run these in the repository root. Adjust `$node` if Node 22 is not at the default Windows location.

```powershell
$node = "C:\Program Files\nodejs\node.exe"
$nodeDir = Split-Path $node
$env:COREPACK_ENABLE_AUTO_PIN = "0"

# 1. Confirm Node 22
& $node -v

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

After step 3, `pnpm` must report `10.34.5` and `node` must remain the Node 22 binary. `.local/tools` and `.local/tarballs` are local caches and must not be committed. `pnpm-lock.yaml` is the portable lockfile.

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

## Owner recovery (development only)

Owner recovery does not send email or WhatsApp. In local development the delivery adapter writes a one-time token under `.local/owner-recovery-outbox/`. After requesting recovery in the staff app, read `.local/owner-recovery-outbox/latest.json` on this machine, then submit the token on the recovery screen. The HTTP API never returns the token. Production startup fails closed until a non-local delivery adapter is configured; that configuration is a later launch gate.

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

## Limits of this slice

Managers can maintain products, taxonomy and explicit size/color variants. Cashiers can look up a product by code and select a variant. Available quantity is honestly zero until receiving/inventory (ticket 03). POS checkout, FIFO batches, media upload and the public storefront catalog are not implemented.
