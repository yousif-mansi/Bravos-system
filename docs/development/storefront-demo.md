# Isolated development storefront demo

This tool is for local development and testing only. All merchandise, prices, stock, delivery areas, customers and orders are fictional samples. Product artwork is owned vector illustration with a visible `DEVELOPMENT SAMPLE · ILLUSTRATION` label; it is not a photograph of BRAVOS merchandise. No business delivery promise, customer testimonial or fabricated social account is seeded.

From the repository root, run:

```powershell
pnpm exec tsx scripts/storefront-demo.ts start
```

The command stays running with its own PostgreSQL cluster and API. In another terminal:

```powershell
pnpm exec tsx scripts/storefront-demo.ts status
pnpm exec tsx scripts/storefront-demo.ts verify
pnpm exec tsx scripts/storefront-demo.ts stop
```

The named target is fixed: PostgreSQL `127.0.0.1:55434`, database `bravos_storefront_demo`, API `http://127.0.0.1:3012`, and every generated file under the ignored `.local/storefront-demo/` directory. The script refuses production execution, redirected directories, unmarked nonempty targets and occupied ports. It does not accept a database URL, arbitrary output root or operational database override. It does not read or replace `.local/dev.env` or the Phase 1 database. There is no purge/reset command.

The script creates `dev.env` for inspection, `storefront.env` for frontend settings, private `credentials.json` for the isolated demo owner, and `manifest.json` with sample product/variant identifiers. Do not publish those local files or credentials. Initialization uses the existing API composition/bootstrap; catalog, taxonomy, receiving, delivery configuration and guest checkout use their real HTTP feature APIs. No business tables are written directly by this tool.

Restart after `stop` by running `start` again. Products are found by fixed `DEMO-*` codes and taxonomy by name. Receipts have fixed operation IDs and immutable request facts, so restarts replay the original receiving operations rather than adding stock again. Existing owner passwords are verified and retained. Interrupted setup can resume. Restart preserves subsequent demo sales, stock changes and orders; it does not refill consumed units. If a previous process crashed leaving a PostgreSQL listener, investigate its exact named directory and process before retrying; the script deliberately refuses to take over an unknown listener.

The tool starts neither the storefront nor the internal app. To preview the storefront on port 3000, its runtime must receive these settings **before it starts**:

```powershell
$env:NODE_ENV = 'development'
$env:BRAVOS_API_ORIGIN = 'http://127.0.0.1:3012'
$env:BRAVOS_STOREFRONT_DEMO = '1'
pnpm --filter @bravos/storefront dev
```

The storefront uses `BRAVOS_STOREFRONT_DEMO=1` to display an external development banner. The frontend owner integrates that banner; this tool cannot make a production frontend claim to be a demo. Optional internal preview uses port 5175 and an API proxy to 3012; it must have a separate frontend runtime from the operational app. Use the demo owner credentials only with that isolated API.

For a background launch on Windows, use `Start-Process -WindowStyle Hidden` with the Node executable and `node_modules/tsx/dist/cli.mjs scripts/storefront-demo.ts start`, redirecting output/error logs into the demo directory. Use the script's authenticated `stop` command for graceful API and PostgreSQL shutdown. Never stop all Node/PostgreSQL processes or remove arbitrary directories.

The seed has 16 products across four categories, including one hidden product (15 publicly browsable), one coming-soon product and one fully out-of-stock product. Each product has four explicitly created pairs: M/cream, L/cream, L/navy and XL/olive. M/cream has zero stock; some pairs override the product's default selling price. These pairs are intentional samples rather than a Cartesian product of independent size/color lists. DEMO-001 and DEMO-004 have two illustration views for gallery verification. All images are 600 × 750 PNGs.

Whole-basket scenarios:

| Basket | Expected result |
| --- | --- |
| DEMO-001 L/navy + DEMO-003 L/navy | Accepted quote; Abshway can supply both |
| DEMO-001 L/navy + DEMO-002 L/navy | Rejected quote; no single branch can supply both |
| DEMO-013 any variant | Out of stock and not orderable |
| DEMO-015 any variant | Coming soon and not orderable |

Startup verification checks real public browse/detail/media responses, restricted-cost secrecy, a valid quote, cross-branch rejection, repeated-line quantity limits, zero-stock/coming-soon rejection, guest order submission, duplicate-safe replay and unchanged stock for a pending request. It creates one clearly labeled pending test order, stores the exact request before submission and replays that same request on repeated verification. It does not confirm or deliver an order or contact anyone. `verification.json` contains the latest evidence. Manual interactions can change demo data; verification assumes the documented sample stock remains sufficient.
