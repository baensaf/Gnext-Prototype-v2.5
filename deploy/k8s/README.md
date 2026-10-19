# Gnext on k3s

The VPS runs k3s (single node). Gnext lives in the namespace `gnext`; another platform gets its
own namespace and an Ingress with a host rule. Traefik (bundled with k3s) owns port 80 and
sends everything without a more specific host rule to Gnext.

| File | What it is |
| --- | --- |
| `gnext/` | Postgres (StatefulSet), backend (Recreate, one replica), frontend (nginx), catch-all Ingress |
| `traefik-config.yaml` | Traefik on host port 80, no read timeout (agent uploads), keeps Arvan's X-Forwarded-For |
| `restore-from-backup.sh` | Loads `db.dump`, `backend_data.tgz`, `backend_uploads.tgz` into the namespace |
| `../deploy.sh` | CI's forced command: builds with Docker, imports into k3s, `kubectl apply -k`, health checks |

## On the VPS

- `/etc/rancher/k3s/config.yaml` disables `servicelb`; `/etc/rancher/k3s/registries.yaml`
  mirrors docker.io to `https://docker.arvancloud.ir`.
- kubectl: `export KUBECONFIG=~/.kube/config`. Ports 6443 and 10250 are dropped on `eth0`.
- Secrets: the `gnext-env` secret is made from `~/gnext-deploy/.env` on every deploy.
- Data: local-path volumes under `/var/lib/rancher/k3s/storage`.

## Backup

```bash
export KUBECONFIG=~/.kube/config
d=~/backups/$(date +%Y%m%d-%H%M); mkdir -p $d; set -a; . ~/gnext-deploy/.env; set +a
kubectl -n gnext exec postgres-0 -- pg_dump -U $DB_USER -d $DB_NAME -Fc > $d/db.dump
kubectl -n gnext exec deploy/backend -- tar cz -C /app/data . > $d/backend_data.tgz
kubectl -n gnext exec deploy/backend -- tar cz -C /app/uploads . > $d/backend_uploads.tgz
```

Restore: `deploy/k8s/restore-from-backup.sh <folder>`.
