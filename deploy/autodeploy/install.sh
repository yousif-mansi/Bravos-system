#!/usr/bin/env bash
# Install Bravos's automatic deploys on the VPS, once, with sudo (README, "Automatic deploys"):
#
#   sudo deploy/autodeploy/install.sh [OPERATOR]     OPERATOR: the account owning the checkout (default: who ran sudo)
#
# Installs bravos-autodeploy to /usr/local/bin (root-owned: a deploy can't rewrite it), its service
# and timer to /etc/systemd/system for OPERATOR's checkout at ~OPERATOR/bravos, and starts the timer.
# Running it again updates them. Stop deploys with: sudo systemctl disable --now bravos-autodeploy.timer
set -euo pipefail
here="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
[[ $EUID -eq 0 ]] || { echo "Run it with sudo." >&2; exit 1; }
operator="${1:-${SUDO_USER:-}}"
[[ -n "$operator" && "$operator" != root ]] || { echo "Name the operator account: sudo $0 OPERATOR" >&2; exit 1; }
home="$(getent passwd "$operator" | cut -d: -f6)"
[[ -d "$home/bravos/.git" ]] || { echo "No checkout at $home/bravos." >&2; exit 1; }
id -nG "$operator" | tr ' ' '\n' | grep -qx docker || { echo "$operator isn't in the docker group." >&2; exit 1; }

install -m 755 -o root -g root "$here/bravos-autodeploy" /usr/local/bin/bravos-autodeploy
sed -e "s/^User=.*/User=$operator/" -e "s/^Group=.*/Group=$(id -gn "$operator")/" \
  -e "s|^Environment=BRAVOS_DIR=.*|Environment=BRAVOS_DIR=$home/bravos|" \
  "$here/bravos-autodeploy.service" >/etc/systemd/system/bravos-autodeploy.service
install -m 644 "$here/bravos-autodeploy.timer" /etc/systemd/system/bravos-autodeploy.timer
systemctl daemon-reload
systemctl enable --now bravos-autodeploy.timer
echo "✓ Automatic deploys on for $home/bravos, every 3 minutes. Logs: journalctl -u bravos-autodeploy"
systemctl list-timers bravos-autodeploy.timer --no-pager | head -2
