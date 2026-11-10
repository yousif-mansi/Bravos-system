#!/usr/bin/env bash
# Release Bravos to the VPS in one command, from a trusted machine (the operator's laptop):
#
#   deploy/scripts/release.sh            release origin/main to the VPS
#   deploy/scripts/release.sh REF        release a pushed commit, tag or branch instead
#   deploy/scripts/release.sh --check    check everything, change nothing
#
# BRAVOS_HOST (default teq-tests) is the ssh host, BRAVOS_REMOTE_DIR (default bravos, under the
# operator's home) its checkout. The VPS is too small to build the images itself (README, "On a
# capacity-constrained VPS"), so this:
#   1. builds both images here, from a clean copy of the commit, with the receipt settings the VPS's
#      .env gives (VITE_POS_RECEIPT_*, baked in at build time), tagged with the commit's 12-character ID;
#   2. loads them on the VPS over ssh, unless it holds them already;
#   3. moves the VPS's checkout to the commit, fast-forward only, so it never loses a local change;
#   4. runs deploy/scripts/deploy.sh there with BRAVOS_PREBUILT_IMAGES=true: a database and media
#      checkpoint before migrations, the migrations, the services, the API health check;
#   5. checks both HTTPS hosts answer through the shared edge, then removes older images there,
#      keeping this release's and the previous one (to go back to).
# Each step stops the release on failure, before anything later changes. Going back: release the
# previous commit; migrations only go forward, so restore its checkpoint first if one ran (README).
set -euo pipefail

HOST="${BRAVOS_HOST:-teq-tests}"
REMOTE_DIR="${BRAVOS_REMOTE_DIR:-bravos}"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
check_only=false
ref=origin/main
for arg in "$@"; do
  case "$arg" in
    --check) check_only=true ;;
    -h | --help) sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    -*) echo "Unknown option $arg" >&2; exit 2 ;;
    *) ref="$arg" ;;
  esac
done

say() { printf '\n== %s\n' "$*"; }
fail() { printf '\n!! %s\n' "$*" >&2; exit 1; }
on_vps() { ssh -o BatchMode=yes -n "$HOST" "cd $REMOTE_DIR && $1"; }

say "The commit"
git -C "$ROOT" fetch -q origin
sha="$(git -C "$ROOT" rev-parse --verify "$ref^{commit}")" || fail "no commit $ref"
git -C "$ROOT" branch -r --contains "$sha" | grep -q . || fail "$ref ($sha) isn't on origin: push it first"
tag="${sha:0:12}"
echo "$ref is $tag: $(git -C "$ROOT" log -1 --format=%s "$sha")"

say "The VPS ($HOST:~/$REMOTE_DIR)"
on_vps 'true' || fail "can't reach $HOST, or no ~/$REMOTE_DIR there"
[[ -z "$(on_vps 'git status --porcelain')" ]] || fail "the VPS's checkout has local changes; look before releasing"
on_vps 'git fetch -q origin'
current="$(on_vps 'git rev-parse HEAD')"
on_vps "git merge-base --is-ancestor HEAD $sha" ||
  fail "the VPS is at ${current:0:12}, which $tag doesn't follow; only a fast-forward is released"
running="$(ssh -o BatchMode=yes -n "$HOST" "docker inspect -f '{{.Config.Image}}' bravos-api-1 2>/dev/null" || true)"
echo "Checkout at ${current:0:12}; running ${running:-nothing}"
receipt_args=()
while IFS='=' read -r name value; do
  [[ -n "$name" ]] && receipt_args+=(--build-arg "$name=$value")
done < <(on_vps "grep -E '^VITE_POS_RECEIPT_(PHONE|PAPER_WIDTH)=' .env || true")
has_images() { on_vps "docker image inspect bravos-app:$tag bravos-staff:$tag >/dev/null 2>&1"; }
if has_images; then
  echo "It holds bravos-app:$tag and bravos-staff:$tag already."
  need_images=false
else
  need_images=true
  free="$(ssh -o BatchMode=yes -n "$HOST" "df --output=avail -BG / | tail -1 | tr -dc 0-9")"
  (( ${free:-0} >= 5 )) || fail "the VPS has ${free:-?} GB free; loading the images needs 5"
  echo "It needs this release's images (${free} GB free)."
fi
staff_url="$(on_vps "sed -n 's/^BRAVOS_INTERNAL_ORIGIN=//p' .env")"
shop_url="$(on_vps "sed -n 's/^BRAVOS_PUBLIC_ORIGIN=//p' .env")"

if $check_only; then
  say "✓ Ready to release $tag to $HOST ($staff_url, $shop_url). Nothing was changed."
  exit 0
fi

if $need_images; then
  say "Building the images here (${#receipt_args[@]} receipt build arguments from the VPS)"
  work="$(mktemp -d)"
  trap 'git -C "$ROOT" worktree remove --force "$work" >/dev/null 2>&1 || rm -rf "$work"' EXIT
  git -C "$ROOT" worktree add -q --detach "$work" "$sha"
  for target in app staff; do
    docker build --platform linux/amd64 -f "$work/deploy/Dockerfile" --target "$target" \
      "${receipt_args[@]}" -t "bravos-$target:$tag" "$work"
  done
  say "Loading them on the VPS"
  docker save "bravos-app:$tag" "bravos-staff:$tag" | gzip -1 | ssh -o BatchMode=yes "$HOST" 'gunzip | docker load'
  has_images || fail "the VPS doesn't hold this release's images after loading them"
fi

say "Deploying $tag on the VPS"
on_vps "git merge -q --ff-only $sha && BRAVOS_PREBUILT_IMAGES=true deploy/scripts/deploy.sh" ||
  fail "deploy.sh stopped (above). The VPS's checkout may be at $tag: deploy/scripts/status.sh there"

say "Checking both hosts through the edge"
for url in "$staff_url" "$shop_url"; do
  code=""
  for _ in {1..15}; do
    code="$(curl -sS -o /dev/null -m 15 -w '%{http_code}' "$url/" 2>/dev/null || true)"
    [[ "$code" == 200 ]] && break
    sleep 4
  done
  printf '  %-36s %s\n' "$url" "$code"
  [[ "$code" == 200 ]] || fail "$url answers ${code:-nothing}; inspect deploy/scripts/logs.sh on the VPS"
done

say "Older images on the VPS"
keep="$tag ${running##*:}"
ssh -o BatchMode=yes -n "$HOST" "for image in \$(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^bravos-(app|staff):'); do
  case \" $keep \" in *\" \${image##*:} \"*) ;; *) docker rmi -f \"\$image\" >/dev/null && echo \"  removed \$image\" ;; esac
done"
for image in $(docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^bravos-(app|staff):'); do
  [[ "${image##*:}" == "$tag" ]] || docker rmi "$image" >/dev/null 2>&1 || true
done
say "✓ $HOST runs Bravos $tag"
