#!/usr/bin/env bash
# Delete backup sets older than the retention window. backup.sh runs it after each new backup.
#
#   deploy/scripts/prune-backups.sh DIR [DAYS]     DAYS defaults to 30
#
# A set is the .dump, -media.tar.gz and .sha256 that backup.sh writes under one
# bravos-<UTC stamp>-<pid> prefix. Its age is the stamp in its name, not the file times, so
# copying or touching a file doesn't change it. The newest set is always kept, however old,
# so a stalled timer can never leave the folder empty. Anything else in DIR is left alone.
set -euo pipefail
dir="${1:-}"
days="${2-30}"
[[ "$days" =~ ^[1-9][0-9]*$ ]] || { echo "Backup retention must be a whole number of days, at least 1 (got '$days')." >&2; exit 1; }
[[ -n "$dir" && -d "$dir" ]] || { echo "No backup directory at '$dir'." >&2; exit 1; }
cutoff="$(date -u -d "$days days ago" +%Y%m%dT%H%M%SZ)"
set_name='^bravos-([0-9]{8}T[0-9]{6}Z)-[0-9]+(\.dump|-media\.tar\.gz|\.sha256)$'

shopt -s nullglob
newest=""
for file in "$dir"/bravos-*; do
  [[ "${file##*/}" =~ $set_name ]] || continue
  [[ "${BASH_REMATCH[1]}" > "$newest" ]] && newest="${BASH_REMATCH[1]}"
done

removed=0
for file in "$dir"/bravos-*; do
  [[ "${file##*/}" =~ $set_name ]] || continue
  stamp="${BASH_REMATCH[1]}"
  # The stamps are fixed-width UTC, so comparing them as strings compares them as times.
  if [[ "$stamp" < "$cutoff" && "$stamp" != "$newest" ]]; then
    rm -f -- "$file"
    removed=$((removed + 1))
  fi
done
echo "Removed $removed backup files older than $days days from $dir."
