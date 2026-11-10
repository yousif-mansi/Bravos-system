#!/usr/bin/env bash
set -euo pipefail
DEPLOY_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ROOT_DIR="$(cd -- "$DEPLOY_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
COMPOSE_FILE="$DEPLOY_DIR/compose.yml"

require_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Missing $ENV_FILE; copy deploy/.env.example and fill real values." >&2
    exit 1
  fi
  if [[ "$(stat -c %a "$ENV_FILE")" != "600" ]]; then
    echo "Set $ENV_FILE permissions to 600 before deployment." >&2
    exit 1
  fi
  set -a
  # The operator owns this file; use ordinary shell KEY=value entries only.
  source "$ENV_FILE"
  set +a
  for name in POSTGRES_PASSWORD DATABASE_URL BETTER_AUTH_SECRET BETTER_AUTH_URL BRAVOS_INTERNAL_ORIGIN BRAVOS_PUBLIC_ORIGIN BRAVOS_DATA_DIR; do
    value="${!name:-}"
    if [[ -z "$value" || "$value" == *replace-with* || "$value" == *example.com* ]]; then
      echo "$name needs a real value in $ENV_FILE." >&2
      exit 1
    fi
  done
  for name in POSTGRES_PASSWORD DATABASE_URL BETTER_AUTH_SECRET; do
    [[ "${!name}" =~ ^[a-zA-Z0-9_:/@.%+-]+$ ]] || { echo "$name must use URL-safe characters only in this deployment file." >&2; exit 1; }
  done
  [[ "$BRAVOS_DATA_DIR" = /* ]] || { echo "BRAVOS_DATA_DIR must be absolute." >&2; exit 1; }
  data_path="$(realpath -m "$BRAVOS_DATA_DIR")"
  root_path="$(realpath "$ROOT_DIR")"
  [[ "$data_path" != / && "$data_path" != "$root_path" && "$data_path" != "$root_path"/* && "$root_path" != "$data_path"/* ]] || {
    echo "BRAVOS_DATA_DIR must be outside and disjoint from the checkout." >&2
    exit 1
  }
  [[ "$BETTER_AUTH_URL" == "$BRAVOS_INTERNAL_ORIGIN" ]] || { echo "BETTER_AUTH_URL must equal BRAVOS_INTERNAL_ORIGIN for the staff /api proxy." >&2; exit 1; }
  [[ "$BETTER_AUTH_URL" == https://* && "$BRAVOS_PUBLIC_ORIGIN" == https://* ]] || { echo "Both application origins must use HTTPS." >&2; exit 1; }
  [[ "${BRAVOS_OWNER_RECOVERY_ADAPTER:-}" == "operator-file" ]] || { echo "Set BRAVOS_OWNER_RECOVERY_ADAPTER=operator-file." >&2; exit 1; }
  [[ "${BRAVOS_LOOPBACK_REHEARSAL:-false}" != "true" && "${BRAVOS_SECURE_COOKIES:-true}" != "false" ]] || { echo "Loopback rehearsal and insecure cookies are forbidden on the VPS." >&2; exit 1; }
  [[ "${BRAVOS_PUBLIC_ORDERING_ENABLED:-false}" == "false" || "${BRAVOS_PUBLIC_ORDERING_ENABLED:-false}" == "true" ]] || { echo "Use true or false for BRAVOS_PUBLIC_ORDERING_ENABLED." >&2; exit 1; }
  command -v docker >/dev/null || { echo "Docker is required." >&2; exit 1; }
  docker compose version >/dev/null
}

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}
