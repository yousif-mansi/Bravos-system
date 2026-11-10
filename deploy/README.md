# Bravos on one Ubuntu VPS

This stack runs PostgreSQL, the Fastify API, the built staff app, and Next.js storefront. It joins an **existing** shared Docker `edge` network and uses the existing Caddy on that network. It publishes no host ports. The database is reachable only on the private Compose network. Do not run the local `release:rehearse` command on the VPS.

The examples use `staff.example.com` and `shop.example.com`; replace them with two real DNS names. Internal operations launch before public ordering. This does not by itself certify a production launch; use the gates in [release rehearsal](../docs/development/release-rehearsal.md) and test the actual POS devices.

## Server setup

1. Install Docker Engine with Compose plugin on Ubuntu. Run a single shared Caddy edge stack, with its own persistent certificate storage and external network named `edge`. The Kings edge stack uses that arrangement. Confirm that Caddy imports `sites/*.caddy` and has the sites directory mounted read-only.
2. Clone Bravos into an operator-owned directory such as `/opt/bravos`. Copy `deploy/.env.example` to `.env` at the repository root, replace all placeholders, and `chmod 600 .env`. Use distinct URL-safe random secrets; URL-encode the database password in `DATABASE_URL`. Keep `.env` outside backups and version control. The env file is parsed as shell assignments by the scripts, so avoid spaces and shell metacharacters in values. `BETTER_AUTH_URL` must equal the staff origin, which serves `/api/*` to the API.
3. Set `BRAVOS_DATA_DIR` to an absolute persistent path outside the checkout, e.g. `/srv/bravos`. Create `media`, `recovery`, and `backups` there, owned by UID 1000 for media/recovery, with recovery mode 0700. `deploy/scripts/prepare.sh` checks this and prints the required ownership command if it is wrong. Keep recovery files limited to the operator and service account. Product media is separate from database backups.
4. Set `BRAVOS_CADDY_SITES_DIR` and `BRAVOS_CADDY_CONTAINER` in `.env` if using `configure-edge.sh`; the directory must be the one mounted into Caddy as `/etc/caddy/sites`. Verify the actual names on the VPS. On `teq-tests`, the active directory is `/opt/hitops/edge-sites` and the container is `kings-edge-caddy-1`; the directory is root-owned, so its current route installation needs `sudo`. The planned shared-edge move makes that path a link to `/opt/edge/sites`; after the move, use `sudo edge-site install bravos FILE` to validate and install a Bravos route file. It is not the Kings `docker/caddy/sites` directory. The Caddy snippet is generated only when you run the edge script; `deploy/Caddyfile.example` shows the intended routes.

## First deployment

```bash
deploy/scripts/prepare.sh
deploy/scripts/deploy.sh
deploy/scripts/configure-edge.sh
deploy/scripts/status.sh
```

`deploy.sh` builds pinned Node/pnpm artifacts, starts PostgreSQL, checks and applies forward migrations, starts the three app services, and checks API liveness. On later deployments it takes a PostgreSQL dump and media archive before migrations. It leaves the existing stack running if migration inspection fails. The API also checks migrations at startup. Do not deploy new code while shop tills have unsynchronized sales or while a restore is in progress.

On a capacity-constrained VPS, build both image targets on another trusted machine, tag and transfer them with the current 12-character commit ID, then run `BRAVOS_PREBUILT_IMAGES=true deploy/scripts/deploy.sh`. This mode verifies both exact image tags before starting PostgreSQL and skips the on-server build. The operator remains responsible for confirming that the transferred images were built from the reviewed checkout.

Create the first owner only after the first deployment, using a password file with mode 0600 kept outside the repository. The API image includes the release bootstrap script:

```bash
BRAVOS_IMAGE_TAG="$(git rev-parse --short=12 HEAD)" \
docker compose --env-file .env -f deploy/compose.yml run --rm --pull never \
  -v /srv/bravos/operator/owner-password:/run/secrets/owner-password api \
  node --import tsx scripts/bootstrap-owner.ts \
  --login OWNER_LOGIN --display-name 'OWNER_NAME' \
  --password-file /run/secrets/owner-password
```

Create `/srv/bravos/operator/owner-password` beforehand, owned by UID 1000 with mode 0600; adjust the host path if needed. The bootstrap verifies ownership and applies mode 0600, so this one file mount must be writable. Do not put the password on the command line or in `.env`. The bootstrap refuses if an owner already exists. The manager can then create staff accounts in the app.

## Updates and operations

Update the checkout to a reviewed commit, then run `deploy/scripts/deploy.sh`. It requires a clean working tree and tags the built images with that commit ID. This script does not pull, push, merge or change branches. Check `deploy/scripts/status.sh`, `deploy/scripts/logs.sh api`, the staff URL, and the storefront URL. Run `deploy/scripts/configure-edge.sh` after host or Caddy route changes. The shared Caddy must be able to resolve `bravos-api`, `bravos-staff`, and `bravos-storefront` on `edge`. Do not expose the API or database directly to the Internet.

`deploy/scripts/backup.sh` creates a timestamped custom-format `pg_dump`, a separate product-media tarball, and SHA-256 checksums under `$BRAVOS_DATA_DIR/backups`. These are local checkpoints; copy them encrypted to an independent destination, set retention, and rehearse database plus media restore on an isolated VPS. The in-app password-protected business backup is a separate facility and does not contain image binaries. There is no automatic destructive restore script.

`deploy/systemd/bravos-backup.service` and `.timer` are optional nightly scheduling templates for a checkout at `/opt/bravos` owned by the `bravos` account. Adjust paths/account if different, copy both to `/etc/systemd/system`, run `sudo systemctl daemon-reload`, then `sudo systemctl enable --now bravos-backup.timer`. Review the first `journalctl -u bravos-backup.service` result and arrange encrypted offsite copy plus retention separately. Membership in the Docker group grants broad host control, so use a dedicated trusted operator account.

To enable public ordering, finish the internal rollout and stock/device checks first, set `BRAVOS_PUBLIC_ORDERING_ENABLED=true` in `.env`, then rerun `deploy.sh`. The public runtime endpoint must report the new state. Receipt phone and paper width are baked into the staff image at build time from `VITE_POS_RECEIPT_*`; set those before `deploy.sh` when they change.

The API currently counts sign-in attempts by the reverse proxy's connection address, so all clients behind this edge share its sign-in rate limit. This needs a narrowly trusted proxy configuration and hosted verification before relying on it with multiple shop devices. API liveness and successful image builds do not prove TLS, PostgreSQL recovery, offline sync, physical printing, or completed business flows.

USB scanner and receipt/label printer setup remains on the Windows shop devices; the VPS stack does not attach to those peripherals. Use labeled dummy transactions for their physical verification after Phase 1 review.
