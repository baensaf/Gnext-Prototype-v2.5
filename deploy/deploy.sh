#!/usr/bin/env bash
# Gnext deploy entry point, installed on the VPS as ~/gnext-deploy/deploy.sh.
# The GitHub Actions deploy key may run only this script (forced command in
# ~/.ssh/authorized_keys):
#   ssh ... ping                         checks the connection, changes nothing
#   ssh ... deploy <sha> < source.tar.gz unpacks that commit and rebuilds the stack
# On the VPS itself: ~/gnext-deploy/deploy.sh ping
set -euo pipefail

BASE=/home/baensaf/gnext-deploy
KEEP=5

read -r action sha _ <<< "${SSH_ORIGINAL_COMMAND:-${*:-}}"

case "${action:-}" in
  ping)
    echo "ok: $(hostname), running $(cat "$BASE/CURRENT" 2>/dev/null || echo 'no pipeline release yet')"
    exit 0
    ;;
  deploy)
    [[ "${sha:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "deploy needs a full commit sha" >&2; exit 2; }
    ;;
  *)
    echo "usage: ping | deploy <sha>" >&2
    exit 2
    ;;
esac

exec 9>"$BASE/.lock"
flock -n 9 || { echo "another deploy is running" >&2; exit 3; }

release="$BASE/releases/$sha"
rm -rf "$release.partial" && mkdir -p "$release.partial"
tar -xz -C "$release.partial"
rm -rf "$release" && mv "$release.partial" "$release"
ln -sfn "$BASE/.env" "$release/.env"

cd "$release"
echo "==> building and starting $sha"
# The running stack keeps serving while images build; containers are replaced after.
if ! docker compose -f docker-compose.prod.yml up -d --build --remove-orphans --wait --wait-timeout 420; then
  docker compose -f docker-compose.prod.yml ps
  docker compose -f docker-compose.prod.yml logs --tail=80 backend frontend
  exit 1
fi
curl -fsS -o /dev/null http://127.0.0.1/health/ready

echo "$sha" > "$BASE/CURRENT"
ln -sfn "$release" "$BASE/current"
echo "==> healthy: $sha"

# Keep the newest releases for inspection; never remove the one now running.
ls -1dt "$BASE"/releases/*/ | tail -n +$((KEEP + 1)) | grep -v "/$sha/$" | xargs -r rm -rf
docker image prune -f > /dev/null
