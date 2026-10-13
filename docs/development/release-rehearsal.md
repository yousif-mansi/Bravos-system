# Portable local release rehearsal

This procedure exercises the built API, staff app and storefront on one machine with normal `NODE_ENV=production` library behavior. The explicit `BRAVOS_LOOPBACK_REHEARSAL=true` exception permits insecure cookies only when every application origin is the fixed `127.0.0.1` rehearsal URL. It records artifact, migration, startup, shutdown and internal-before-public behavior. It is not a hosted production launch and provides no reverse-proxy, TLS, secure-cookie, domain, monitoring or external-device evidence.

Use Node 22 and pnpm 10.34.5 from the local setup guide. Supply an external PostgreSQL database plus two separate absolute directories disjoint from the repository and from each other: one for product media and one for owner-recovery messages. Do not use `.local`, the repository, a repository ancestor, or a filesystem root. Parent symlinks and junctions are resolved before either directory is created. Production startup requires the explicit media directory. It restricts and verifies the recovery directory as owner-only (`0700`/`0600` and owner checks on Linux/macOS; protected current-user-only ACLs on Windows). Startup fails closed if those permissions cannot be enforced on the current OS. `local-outbox` remains rejected in `NODE_ENV=production`.

Copy the names from `.env.rehearsal.example` into the operator's process environment and replace every placeholder. The example file is not loaded automatically. Keep `BRAVOS_PUBLIC_ORDERING_ENABLED=false` for the internal rollout. The API exposes the current gate through `GET /api/public/runtime`; while closed it returns `503 PUBLIC_ORDERING_DISABLED` before either public quote or order creation, and checkout explains the closure in Arabic while leaving the cart intact.

## Database and owner

Before changing an existing database, download a protected business-data backup from **نسخة احتياطية** and take and verify an external PostgreSQL backup. Product image binaries are not in either business-data archive; copy the media directory separately.

Inspect the exact migration history, then apply only forward migrations:

```powershell
pnpm release:migrate status
pnpm release:migrate apply
pnpm release:migrate status
```

The commands take a PostgreSQL advisory lock. API startup and `release:bootstrap-owner` also apply pending migrations under the same lock and refuse the same drift, so run `status` first and start only one API process during a release. They compare the ordered migration identifiers in `schema_migrations` with this artifact and reject unknown, missing or out-of-order identifiers. They do not claim to verify SQL file-content checksums. There is intentionally no release rollback command. After a failed release decision, follow the [failed-release recovery checklist](backups/restore.md#failed-release-recovery): an externally verified PostgreSQL backup and the application's merge restore are different procedures. Do not run development down migrations against business data.

For a fresh database, create one owner exactly once. Put the password alone in an absolute temporary file. The command restricts and verifies the file before reading it, refuses if any owner already exists, and does not print the password:

```powershell
pnpm release:bootstrap-owner --login owner --display-name "مالك برافوس" --password-file "C:\BravosPrivate\owner-password.txt"
Remove-Item -LiteralPath "C:\BravosPrivate\owner-password.txt"
```

Owner recovery writes short-lived token records into the protected recovery directory. Read `latest.json` only as the operator account, complete recovery through the staff screen, then delete token files after the recovery decision and retain them only when incident evidence requires it. A recovery token is never returned by the HTTP request.

## Build, start and stop

Build with the loopback API origin used by the storefront artifact, then start the foreground supervisor:

```powershell
$env:BRAVOS_API_ORIGIN = "http://127.0.0.1:3010"
pnpm build
pnpm release:rehearse
```

Readiness requires successful responses from the API on port 3010, the staff app on 5173, and the storefront on 3000. The storefront may log one refused connection to port 3010 while the API is still starting; readiness still has to succeed. `Ctrl+C` sends a coordinated shutdown to all three processes. An early child exit or readiness timeout stops the other processes and fails the command. The supervisor never starts embedded PostgreSQL, creates demo accounts, or reads `.local/dev.env`.

With public ordering still closed, sign in through the staff app, verify imported stock, costs, permissions, configuration, recovery ownership and essential internal workflows. After the explicit internal-launch sign-off, stop the supervisor, set `BRAVOS_PUBLIC_ORDERING_ENABLED=true`, restart it, and verify a real guest quote and order. Do not toggle the gate while an order response is unresolved; checkout preserves the operation identity and retries the same request when service returns.

For an actual hosted launch, run the built services under an operator-owned service manager with the release root as its working directory, `NODE_ENV=production`, HTTPS at the public and internal origins, secure cookies, a reverse proxy, durable external PostgreSQL/media paths, retained logs and verified backup/restore. Leave `BRAVOS_LOOPBACK_REHEARSAL` unset. Do not use `release:rehearse` for that launch. Domain and hosting selection remain deferred.

## Availability checks

`GET /api/public/health` returns `{ ok: true, application: "bravos-public" }` when the API process can answer. That is API liveness. It does not query PostgreSQL, and it does not prove staff or storefront availability, the protected recovery path, media, backups, or that a quote, order, sale, or stock movement works. The three-port check in this loopback rehearsal is a separate local process check. Neither check is a hosted monitor.

An unexpected feature failure still returns the generic Arabic 500, `CONFLICT` / «تعذر إكمال العملية.». The API writes one local `api.unexpected_failure` line with the static category `unexpected_operation_failure`, the generated request id (`req-…`), and the static route template. It does not write the raw URL, query, exception message, stack, body, headers, cookies, or customer data. Known client errors stay out of that line. Fastify request logging stays off. Pool and process-lifecycle errors are separate existing logs. This line is not a hosted alert.

Future checks below are host-neutral and not implemented. Intervals, retention, alert destinations, and the hosting topology are deferred owner inputs. This guide does not choose a provider, network layout, port map, or alert channel.

| Check | What the operator confirms | Deferred owner input |
| --- | --- | --- |
| API availability | The API process answers its liveness check | Host, interval, alert destination |
| Staff availability | The staff entry URL answers | Host, interval, alert destination |
| Public availability | The public store entry URL answers | Host, interval, alert destination |
| PostgreSQL | The database accepts the agreed operator check | Host, credential owner, interval |
| Protected recovery path | The recovery directory exists, stays restricted to the operator account, and does not overlap media | Path and accountable owner |
| Disk and media | The media volume has free space and the media directory can be read | Path and free-space threshold |
| Retained service and proxy logs | Service and proxy logs remain available for an incident | Retention period and location |
| Backup and media age | The newest verified business backup and the separate media copy are within the agreed age | Age limit and storage destination |
| Incident ownership | A named primary and a named backup owner respond to incidents | Names, assigned before launch |

Record a real pilot in the blank [operator acceptance record](operator-pilot-acceptance.md). Empty fields are not a pass.

## Configuration reference

Every value comes from the operator's process environment or secret store, never from a committed file or `.local/dev.env`. `loadConfig` fail-fasts in `NODE_ENV=production` before `buildApp`, connection pools, or migrations: the authentication secret must be at least 32 characters, not whitespace-only, not the installed Better Auth public default, and not the exact committed example placeholders `replace-with-a-long-local-secret` / `replace-with-a-long-random-secret`. Those checks do not prove cryptographic randomness; the operator still generates and manages the real secret. Error messages name the variable and requirement and do not print the secret value. The accepted secret is stored verbatim.

Outside this production-only loopback rehearsal, hosted production requires explicit `BRAVOS_INTERNAL_ORIGIN`, `BRAVOS_PUBLIC_ORIGIN`, and an auth origin selected through existing `BETTER_AUTH_URL` then `BRAVOS_API_ORIGIN` precedence. Each must be a canonical literal HTTPS origin: `https` scheme, no userinfo, no path, query or fragment, no wildcard hostname, and the configured string must equal the URL origin. Absent, empty, malformed, non-HTTPS, and noncanonical strings are rejected rather than defaulted or normalized. Hostname and port remain operator-owned. The explicit rehearsal flag still allows only the fixed `127.0.0.1` HTTP origins below; secret validation still applies. `BRAVOS_TRUSTED_ORIGINS` parsing is unchanged. This is source hardening of the startup boundary, not hosted acceptance, secret-randomness proof, or launch approval.

| Setting | Rehearsal | Hosted launch |
| --- | --- | --- |
| `NODE_ENV` | `production` | `production` |
| `DATABASE_URL` | Dedicated database; the role needs `CREATEDB` and access to the `postgres` maintenance database for restore staging | Same, with TLS and a backup owner |
| `BETTER_AUTH_SECRET` | Cryptographically generated value, at least 32 characters; placeholders and the Better Auth default are rejected at startup | Same, kept outside backups; rotating it signs everyone out |
| `BETTER_AUTH_URL`, `BRAVOS_INTERNAL_ORIGIN`, `BRAVOS_PUBLIC_ORIGIN` | Exact fixed `http://127.0.0.1:3010`, `http://127.0.0.1:5173`, `http://127.0.0.1:3000` | Explicit canonical HTTPS origins; `BETTER_AUTH_URL` then `BRAVOS_API_ORIGIN` for the auth origin |
| `BRAVOS_TRUSTED_ORIGINS` | Empty | Only extra origins that must call the API |
| `BRAVOS_LOOPBACK_REHEARSAL`, `BRAVOS_SECURE_COOKIES=false` | `true` / `false` | Unset; cookies are secure |
| `BRAVOS_OWNER_RECOVERY_ADAPTER`, `BRAVOS_OWNER_RECOVERY_OUTBOX_DIR` | `operator-file`, protected external directory | Same; only the operator account can read it |
| `BRAVOS_PRODUCT_MEDIA_DIR` | External directory | Durable volume (see below) |
| `BRAVOS_PUBLIC_ORDERING_ENABLED` | `false`, then `true` after internal sign-off | Same sequence |
| `BRAVOS_API_ORIGIN` | `http://127.0.0.1:3010` at build and start | The API origin the storefront and staff host proxy to |
| `PORT` | `3010` | Assigned API port behind the proxy |

Sign-in attempts are limited to three per ten seconds for each client address. The API uses the connection address and ignores client-supplied forwarding headers, so every device behind one address, including a reverse proxy that is not trusted by the API, shares that limit. A blocked attempt shows «محاولات دخول كثيرة. انتظر قليلاً ثم أعد المحاولة.». Trusting a reverse proxy's client address is not configured yet and must be decided with the hosting choice.

## Durable product images

`BRAVOS_PRODUCT_MEDIA_DIR` is business state. Put it on a durable volume outside the release folder, give only the API service account write access, and monitor free space. Business-data backups keep image references but not image files, so copy this directory on the same schedule as backups and check a restored copy opens. One API host can use a local directory; several API hosts need shared storage, which is not implemented.

## Restore procedure

Follow [staged restore](backups/restore.md). In short: keep the pre-restore checkpoint password separate from the archive password, pause at a quiet time, make every known till synchronize and confirm the pause, download and verify the checkpoint, review conflicts and newer activity, then activate with the fingerprint. After activation every staff member signs in again; after a restore into a fresh database the owner uses owner recovery and then resets staff passwords. Recover retained sales from the restore page. Restore product images from the separate media copy. A failed release uses the [failed-release recovery checklist](backups/restore.md#failed-release-recovery). The application merge cannot undo an activation in place.

## Internal-before-public rollout

1. Start with `BRAVOS_PUBLIC_ORDERING_ENABLED=false`. The storefront can be browsed; quotes and orders return `503 PUBLIC_ORDERING_DISABLED` and checkout says ordering is not available yet.
2. Import opening data, receive stock, and rehearse cash sales, offline sale and reconnect, expenses, Returns, reports, exports and one backup download with labeled data.
3. Reconcile every till queue and stock discrepancy and record the internal sign-off.
4. Stop, set `BRAVOS_PUBLIC_ORDERING_ENABLED=true`, start, and place one labeled online order through confirmation and delivery before announcing the store.

## Launch data checklist

These are operator inputs, not application defects. Collect them together before cutover and import or enter them through the application:

- products, Arabic names and descriptions, categories, sizes, colors, prices, publication state and approved images;
- opening batch quantities, true unit costs, receipt dates and FIFO order;
- staff accounts, branch grants, cashier and order-representative roles, and the owner recovery operator;
- expense categories, low-stock thresholds, automatic offers, bundles and coupons;
- delivery areas and fees, shop addresses, WhatsApp and social links, hours and branding;
- the actual shop desktops, tablets and phones with browser versions, and who performs daily backups and media copies.

## Device verification

Automated checks ran in Chromium emulation only: desktop 1366×768 with keyboard, tablet and two phone profiles with touch. See the [release review](../reviews/release-review.md) for results. Before a store relies on offline selling, repeat on each real device: Safari on iPad and iPhone and Chrome on an Android tablet or phone for sign-in, a cash sale, going offline, an offline sale, reconnect and sync, the on-screen keyboard over POS and checkout fields, native select pickers, swiping wide report tables, and the Arabic fonts shown. Record device, OS and browser versions and any problem found.
