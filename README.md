# BRAVOS System

Arabic retail management and online ordering for BRAVOS, a men's clothing business with branches in Abshway and Fayoum, Egypt.

[bravos.md](bravos.md) is the authoritative business-requirements brief. The approved local implementation specification is [docs/planning/bravos-v1-spec.md](docs/planning/bravos-v1-spec.md).

## Current slice

Ticket 04 adds connected cash sales on top of staff access, catalog and receiving. Offline POS, promotions, returns and the public storefront remain later tickets. See [local setup](docs/development/local-setup.md) for verified commands. Do not treat this README as proof that every gate has passed; the implementation report for the current run records actual check results.

## Local setup

See [docs/development/local-setup.md](docs/development/local-setup.md) for the complete clean-clone sequence, including the checksum-verified portable Node download. A fresh checkout does not include `.local/tools`. Use Node 22.23.3 (`>=22.23.3 <23`), then install the pinned pnpm **locally** with npm (not globally), prepend those directories to PATH, and disable Corepack auto-pin so nested scripts keep the same runtime:

```powershell
$node = (Resolve-Path ".local\tools\node-v22.23.3-win-x64\node.exe").Path
$nodeDir = Split-Path $node
$env:COREPACK_ENABLE_AUTO_PIN = "0"
New-Item -ItemType Directory -Force .local\tools | Out-Null
& $node (Join-Path $nodeDir "node_modules\npm\bin\npm-cli.js") install pnpm@10.34.5 --prefix .local\tools
$env:PATH = "$(Resolve-Path .\.local\tools\node_modules\.bin);$nodeDir;$env:PATH"
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm setup:local
pnpm postgres:dev
```

In another terminal with the same PATH:

```powershell
pnpm dev
```

- Staff app: http://127.0.0.1:5173
- Public entry: http://127.0.0.1:3000
- API: http://127.0.0.1:3010

Disposable local credentials are written to `.local/demo-credentials.txt`. Do not use them in production.

The [portable release rehearsal](docs/development/release-rehearsal.md) covers built artifacts, locked forward migrations, one-owner bootstrap, protected operator recovery, and the internal-before-public ordering gate. It is explicitly not a hosted production launch.

For a shared-Caddy Ubuntu VPS layout and operator scripts, see [deploy/README.md](deploy/README.md).

## Checks

```powershell
pnpm typecheck
pnpm check:architecture
pnpm test:http
pnpm test:browser
pnpm build
pnpm migrate:scratch
```

## Architecture

- `apps/api` — Fastify modular API
- `apps/internal` — React/Vite authenticated staff app
- `apps/storefront` — Next.js public entry
- `packages/identity` — staff identity domain, application and server adapters
- `packages/catalog` — product, variant and taxonomy maintenance with cashier lookup
- `packages/contracts` — role-safe shared DTOs
- `packages/sales` — attributed cash sales, employee deductions and retained paid values
- `packages/persistence` — versioned PostgreSQL migrations
