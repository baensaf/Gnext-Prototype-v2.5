#!/usr/bin/env bash
# Gnext deploy entry point, installed on the VPS as ~/gnext-deploy/deploy.sh.
# The GitHub Actions deploy key may run only this script (forced command in
# ~/.ssh/authorized_keys):
#   ssh ... ping                          checks the connection, changes nothing
#   ssh ... base                          prints "<source held> <running>": the commit whose
#                                         source the VPS keeps, and the one it runs ("none" if not)
#   ssh ... patch <sha> <tree> < diff     applies a git diff from the source held, checks the
#                                         result is <tree>, and rolls <sha> out on k3s
#   ssh ... deploy <sha> < source.tar.gz  unpacks that commit and rolls it out on k3s
# On the VPS itself: ~/gnext-deploy/deploy.sh ping
#
# The link from GitHub to the VPS carries about 10 KB/s, so a deploy sends only the changes since
# the source held (a few KB) and the whole source only when they don't apply (exit code 4).
#
# Gnext runs in the k3s namespace `gnext` (deploy/k8s/gnext). Docker only builds the images;
# they are imported into k3s's containerd, which never pulls them (imagePullPolicy: Never).
# The database is dumped before every rollout: a rollback brings the old code back, not the old
# data, and the new code's migrations may already have run.
set -euo pipefail

BASE=/home/baensaf/gnext-deploy
SRC="$BASE/src"
KEEP=5
KEEP_DUMPS=10
export KUBECONFIG=/home/baensaf/.kube/config

read -r action sha tree _ <<< "${SSH_ORIGINAL_COMMAND:-${*:-}}"

# The git tree id of a folder's files, to prove a patched folder is exactly that commit.
tree_of() {
  local idx
  idx=$(mktemp -d)
  git init -q "$idx"
  git --git-dir="$idx/.git" --work-tree="$1" -c core.autocrlf=false add -A -f .
  git --git-dir="$idx/.git" write-tree
  rm -rf "$idx"
}

# Before the first patch deploy the source held is made from the running release: it is that
# commit's files plus the .env link and the image tags deploy writes. A patch checks the tree
# anyway, so a copy that is not exact only means the whole source is sent once.
hold_running_source() {
  [ -f "$BASE/src.sha" ] && return 0
  [ -f "$BASE/CURRENT" ] && [ -d "$BASE/current/" ] || return 0
  local cur
  cur=$(cat "$BASE/CURRENT")
  rm -rf "$SRC.tmp" && cp -a "$BASE/current/." "$SRC.tmp" && rm -f "$SRC.tmp/.env"
  sed -i "s/newTag: $cur/newTag: latest/" "$SRC.tmp/deploy/k8s/gnext/kustomization.yaml"
  rm -rf "$SRC" && mv "$SRC.tmp" "$SRC" && echo "$cur" > "$BASE/src.sha"
}

case "${action:-}" in
  ping)
    echo "ok: $(hostname), running $(cat "$BASE/CURRENT" 2>/dev/null || echo 'no pipeline release yet')"
    exit 0
    ;;
  base)
    exec 9>"$BASE/.lock"
    flock -n 9 || { echo "another deploy is running" >&2; exit 3; }
    hold_running_source
    echo "$(cat "$BASE/src.sha" 2>/dev/null || echo none) $(cat "$BASE/CURRENT" 2>/dev/null || echo none)"
    exit 0
    ;;
  deploy)
    [[ "${sha:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "deploy needs a full commit sha" >&2; exit 2; }
    ;;
  patch)
    [[ "${sha:-}" =~ ^[0-9a-f]{40}$ && "${tree:-}" =~ ^[0-9a-f]{40}$ ]] || { echo "patch needs a commit sha and its tree" >&2; exit 2; }
    ;;
  *)
    echo "usage: ping | base | patch <sha> <tree> | deploy <sha>" >&2
    exit 2
    ;;
esac

exec 9>"$BASE/.lock"
flock -n 9 || { echo "another deploy is running" >&2; exit 3; }

release="$BASE/releases/$sha"
rm -rf "$release.partial" && mkdir -p "$release.partial"
if [ "$action" = patch ]; then
  [ -d "$SRC" ] || { echo "no source held; send the whole source" >&2; exit 4; }
  changes=$(mktemp)
  cat > "$changes"
  cp -a "$SRC/." "$release.partial"
  if [ -s "$changes" ] && ! (cd "$release.partial" && git apply --binary --whitespace=nowarn "$changes"); then
    rm -f "$changes"; echo "the changes did not apply; send the whole source" >&2; exit 4
  fi
  rm -f "$changes"
  if [ "$(tree_of "$release.partial")" != "$tree" ]; then
    echo "the patched source is not $sha; send the whole source" >&2; exit 4
  fi
else
  tar -xz -C "$release.partial"
fi
# The source as it came, before deploy adds the .env link and the image tags, for the next patch.
rm -rf "$SRC.tmp" && cp -a "$release.partial" "$SRC.tmp" && rm -rf "$SRC" && mv "$SRC.tmp" "$SRC"
echo "$sha" > "$BASE/src.sha"

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

if kubectl -n gnext get pod postgres-0 > /dev/null 2>&1; then
  echo "==> backing up the database"
  mkdir -p "$BASE/backups"
  dump="$BASE/backups/db-$(date -u +%Y%m%dT%H%M%SZ)-${sha:0:7}.dump"
  kubectl -n gnext exec postgres-0 -- sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$dump.partial"
  mv "$dump.partial" "$dump"
  echo "$(du -h "$dump" | cut -f1) in $dump"
  ls -1t "$BASE"/backups/db-*.dump | tail -n +$((KEEP_DUMPS + 1)) | xargs -r rm -f
fi

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
  echo "The database as it was before this deploy: ${dump:-no dump taken}" >&2
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
