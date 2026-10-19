#!/usr/bin/env bash
# Loads a backup into the gnext namespace: the database and both backend volumes.
# Run on the VPS: deploy/k8s/restore-from-backup.sh ~/backups/<folder>
# The folder holds db.dump (pg_dump -Fc), backend_data.tgz and backend_uploads.tgz.
# The backend is stopped while it runs, so it starts on the restored data and never
# seeds an empty database first.
set -euo pipefail

dir=${1:?usage: restore-from-backup.sh <backup folder>}
for f in db.dump backend_data.tgz backend_uploads.tgz; do
  [ -f "$dir/$f" ] || { echo "missing $dir/$f" >&2; exit 2; }
done

k() { kubectl -n gnext "$@"; }
secret() { k get secret gnext-env -o "jsonpath={.data.$1}" | base64 -d; }
db_user=$(secret DB_USER)
db_name=$(secret DB_NAME)

echo "==> stopping the backend"
k scale deploy/backend --replicas=0
k wait --for=delete pod -l app=backend --timeout=120s || true

echo "==> restoring the database"
k rollout status statefulset/postgres --timeout=180s
k exec postgres-0 -- psql -U "$db_user" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS \"$db_name\" WITH (FORCE)" \
  -c "CREATE DATABASE \"$db_name\" OWNER \"$db_user\""
k exec -i postgres-0 -- pg_restore -U "$db_user" -d "$db_name" --no-owner --role="$db_user" < "$dir/db.dump"

echo "==> restoring uploads and data"
k delete pod restore-files --ignore-not-found --wait=true
k apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: restore-files
spec:
  restartPolicy: Never
  containers:
    - name: files
      image: alpine:3.20
      command: ["sleep", "3600"]
      volumeMounts:
        - { name: uploads, mountPath: /uploads }
        - { name: data, mountPath: /data }
  volumes:
    - name: uploads
      persistentVolumeClaim: { claimName: backend-uploads }
    - name: data
      persistentVolumeClaim: { claimName: backend-data }
EOF
k wait --for=condition=Ready pod/restore-files --timeout=180s
k exec -i restore-files -- sh -c 'find /uploads -mindepth 1 -delete && tar xz -C /uploads' < "$dir/backend_uploads.tgz"
k exec -i restore-files -- sh -c 'find /data -mindepth 1 -delete && tar xz -C /data' < "$dir/backend_data.tgz"
k delete pod restore-files --wait=true

echo "==> starting the backend"
k scale deploy/backend --replicas=1
k rollout status deploy/backend --timeout=480s

echo "==> row counts"
k exec postgres-0 -- psql -U "$db_user" -d "$db_name" -At -F' ' -c "ANALYZE" \
  -c "select relname, n_live_tup from pg_stat_user_tables where n_live_tup > 0 order by 1"
