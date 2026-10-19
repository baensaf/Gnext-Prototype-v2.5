#!/usr/bin/env bash
# Gnext deploy entry point, installed on the VPS as ~/gnext-deploy/deploy.sh.
# The GitHub Actions deploy key may run only this script (forced command in
# ~/.ssh/authorized_keys):
#   ssh ... ping                         checks the connection, changes nothing
#   ssh ... deploy <sha> < source.tar.gz unpacks that commit and rolls it out on k3s
# On the VPS itself: ~/gnext-deploy/deploy.sh ping
#
# Gnext runs in the k3s namespace `gnext` (deploy/k8s/gnext). Docker only builds the images;
# they are imported into k3s's containerd, which never pulls them (imagePullPolicy: Never).
set -euo pipefail

BASE=/home/baensaf/gnext-deploy
KEEP=5
export KUBECONFIG=/home/baensaf/.kube/config

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

# The running pods keep serving while images build; they are replaced after.
echo "==> building $sha"
set -a; . "$BASE/.env"; set +a
docker build -q -t "gnext-backend:$sha" backend
docker build -q -t "gnext-frontend:$sha" \
  --build-arg VITE_MUI_X_LICENSE_KEY="${MUI_X_LICENSE_KEY:-}" starter-vite-ts
docker save "gnext-backend:$sha" "gnext-frontend:$sha" | sudo k3s ctr -n k8s.io images import - > /dev/null

echo "==> rolling out $sha"
kubectl -n gnext create secret generic gnext-env --from-env-file="$BASE/.env" \
  --dry-run=client -o yaml | kubectl apply -f - > /dev/null
sed -i "s/newTag: latest/newTag: $sha/" deploy/k8s/gnext/kustomization.yaml
kubectl apply -k deploy/k8s/gnext
if ! kubectl -n gnext rollout status deploy/backend --timeout=480s \
   || ! kubectl -n gnext rollout status deploy/frontend --timeout=120s; then
  kubectl -n gnext get pods
  kubectl -n gnext logs deploy/backend --tail=80 || true
  echo "==> rolling back" >&2
  kubectl -n gnext rollout undo deploy/backend || true
  kubectl -n gnext rollout undo deploy/frontend || true
  exit 1
fi

curl -fsS -o /dev/null --retry 5 --retry-delay 3 --retry-all-errors http://127.0.0.1/health/ready
# Branch agents connect over a WebSocket through Traefik and nginx. An upgrade without a key
# has to reach the backend and come back 401; anything else means a proxy is not passing
# upgrades, and no agent can connect even though the health check is green.
ws_status=$(curl -sS -o /dev/null -w '%{http_code}' --http1.1 --max-time 10 \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  http://127.0.0.1/api/v1/agent/ws || true)
if [ "$ws_status" != "401" ]; then
  echo "agent WebSocket check failed: HTTP $ws_status from /api/v1/agent/ws, expected 401" >&2
  exit 1
fi

echo "$sha" > "$BASE/CURRENT"
ln -sfn "$release" "$BASE/current"
echo "==> healthy: $sha"

# Keep the newest releases for inspection; never remove the one now running.
# (grep exits 1 when there is nothing to prune; that is not a failed deploy.)
ls -1dt "$BASE"/releases/*/ | tail -n +$((KEEP + 1)) | { grep -v "/$sha/$" || true; } | xargs -r rm -rf
# Docker only built the images; k3s has its own copy, and drops the ones no pod uses.
docker image ls --format '{{.Repository}}:{{.Tag}}' | grep -E '^gnext-(backend|frontend):' | xargs -r docker rmi > /dev/null || true
docker image prune -f > /dev/null
sudo k3s crictl rmi --prune > /dev/null 2>&1 || true
