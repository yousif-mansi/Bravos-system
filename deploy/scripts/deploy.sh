#!/usr/bin/env bash
source "$(dirname -- "$0")/lib.sh"
require_env
if [[ -n "$(git -C "$ROOT_DIR" status --porcelain)" ]]; then
  echo "Deploy a reviewed, clean Git checkout; working tree changes are present." >&2
  exit 1
fi
export BRAVOS_IMAGE_TAG="$(git -C "$ROOT_DIR" rev-parse --short=12 HEAD)"
"$DEPLOY_DIR/scripts/prepare.sh"
if [[ "${BRAVOS_PREBUILT_IMAGES:-false}" == true ]]; then
  for image in "bravos-app:$BRAVOS_IMAGE_TAG" "bravos-staff:$BRAVOS_IMAGE_TAG"; do
    docker image inspect "$image" >/dev/null || {
      echo "Missing prebuilt image $image; deployment stopped before changing services." >&2
      exit 1
    }
  done
else
  compose build api staff
fi
compose up -d db
if ! migration_table="$(compose exec -T db psql -U bravos -d bravos -Atqc "SELECT to_regclass('public.schema_migrations') IS NOT NULL")"; then
  echo "Could not inspect the migration table; deployment stopped before migration." >&2
  exit 1
fi
if [[ "$migration_table" == t ]]; then
  echo "Taking database and media checkpoint before migration."
  "$DEPLOY_DIR/scripts/backup.sh"
elif [[ "$migration_table" != f ]]; then
  echo "Unexpected migration table inspection result; deployment stopped." >&2
  exit 1
fi
compose run --rm --no-deps api node --import tsx scripts/migrate-release.ts status
compose run --rm --no-deps api node --import tsx scripts/migrate-release.ts apply
compose up -d --wait --wait-timeout 180 --no-build api staff storefront
for attempt in {1..30}; do
  if compose exec -T api node -e 'fetch("http://127.0.0.1:3010/api/public/health").then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))'; then
    echo "API is live. Check both HTTPS hosts through the shared edge proxy."
    exit 0
  fi
  sleep 2
done
compose logs --tail=80 api
echo "API health check failed. Inspect logs before retrying." >&2
exit 1
