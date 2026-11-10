#!/usr/bin/env bash
source "$(dirname -- "$0")/lib.sh"
require_env
sites_dir="${BRAVOS_CADDY_SITES_DIR:-}"
container="${BRAVOS_CADDY_CONTAINER:-}"
[[ -d "$sites_dir" && -n "$container" ]] || {
  echo "Set BRAVOS_CADDY_SITES_DIR to the mounted sites directory and BRAVOS_CADDY_CONTAINER to the running shared Caddy container." >&2
  exit 1
}
staff_host="${BRAVOS_INTERNAL_ORIGIN#https://}"
public_host="${BRAVOS_PUBLIC_ORIGIN#https://}"
for host in "$staff_host" "$public_host"; do
  [[ "$host" =~ ^[a-zA-Z0-9.-]+$ && "$host" != -* ]] || { echo "Invalid HTTPS hostname: $host" >&2; exit 1; }
done
[[ "$staff_host" != "$public_host" ]] || { echo "Staff and shop need distinct hosts." >&2; exit 1; }
target="$sites_dir/bravos.caddy"
tmp="$(mktemp "$sites_dir/.bravos.XXXXXX")"
previous="$(mktemp "$sites_dir/.bravos.previous.XXXXXX")"
had_previous=false
if [[ -f "$target" ]]; then
  cp -p -- "$target" "$previous"
  had_previous=true
fi
trap 'rm -f -- "$tmp" "$previous"' EXIT
cat > "$tmp" <<EOF
$staff_host {
    handle /api/* { reverse_proxy bravos-api:3010 }
    handle { reverse_proxy bravos-staff:8080 }
}
$public_host {
    handle /api/public/* { reverse_proxy bravos-api:3010 }
    handle { reverse_proxy bravos-storefront:3000 }
}
EOF
chmod 644 "$tmp"
mv -- "$tmp" "$target"
if ! docker exec "$container" test -f /etc/caddy/sites/bravos.caddy \
  || ! docker exec "$container" caddy validate --config /etc/caddy/Caddyfile; then
  if $had_previous; then
    mv -- "$previous" "$target"
  else
    rm -f -- "$target"
  fi
  echo "Caddy validation failed; previous site file restored." >&2
  exit 1
fi
if ! docker exec "$container" caddy reload --config /etc/caddy/Caddyfile; then
  if $had_previous; then
    mv -- "$previous" "$target"
  else
    rm -f -- "$target"
  fi
  echo "Caddy reload failed; previous site file restored." >&2
  exit 1
fi
echo "Shared Caddy now routes $staff_host and $public_host."
