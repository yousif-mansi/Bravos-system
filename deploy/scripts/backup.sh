#!/usr/bin/env bash
source "$(dirname -- "$0")/lib.sh"
require_env
backup_dir="$BRAVOS_DATA_DIR/backups"
[[ -d "$backup_dir" ]] || { echo "Run prepare.sh first." >&2; exit 1; }
stamp="$(date -u +%Y%m%dT%H%M%SZ)-$$"
prefix="$backup_dir/bravos-$stamp"
tmp_db="$prefix.dump.part"
tmp_media="$prefix-media.tar.gz.part"
trap 'rm -f -- "$tmp_db" "$tmp_media"' EXIT
compose exec -T db pg_dump -U bravos -d bravos -Fc > "$tmp_db"
[[ -s "$tmp_db" ]] || { echo "Database backup was empty." >&2; exit 1; }
tar -C "$BRAVOS_DATA_DIR" -czf "$tmp_media" media
mv -- "$tmp_db" "$prefix.dump"
mv -- "$tmp_media" "$prefix-media.tar.gz"
chmod 600 "$prefix.dump" "$prefix-media.tar.gz"
sha256sum "$prefix.dump" "$prefix-media.tar.gz" > "$prefix.sha256"
chmod 600 "$prefix.sha256"
echo "Created $prefix.dump and media archive; copy encrypted off the VPS and rehearse restore."
