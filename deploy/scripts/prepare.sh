#!/usr/bin/env bash
source "$(dirname -- "$0")/lib.sh"
require_env
docker network inspect "${BRAVOS_EDGE_NETWORK:-edge}" >/dev/null || {
  echo "Shared edge network ${BRAVOS_EDGE_NETWORK:-edge} is absent. Start the existing edge stack first." >&2
  exit 1
}
mkdir -p "$BRAVOS_DATA_DIR/media" "$BRAVOS_DATA_DIR/recovery" "$BRAVOS_DATA_DIR/backups"
chmod 700 "$BRAVOS_DATA_DIR/recovery" "$BRAVOS_DATA_DIR/backups"
for directory in media recovery; do
  if [[ "$(stat -c %u "$BRAVOS_DATA_DIR/$directory")" != "1000" ]]; then
    echo "$BRAVOS_DATA_DIR/$directory must belong to UID 1000 (container node user)." >&2
    echo "Run: sudo chown -R 1000:1000 '$BRAVOS_DATA_DIR/$directory'" >&2
    exit 1
  fi
done
compose config --quiet
echo "Configuration, durable directories and edge network are ready."
