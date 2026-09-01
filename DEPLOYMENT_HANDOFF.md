# Gnext Prototype v2 — Fresh VPS Deployment Handoff

This handoff is for a disposable demo deployment. It intentionally creates a fresh database from the 44 TypeORM migrations and the deterministic demo seed; no data migration is required.

## Deployment topology

- Arvan remains the public CDN and TLS edge.
- The VPS exposes only the frontend/origin HTTP port (`80`) plus the operator's SSH port.
- Nginx serves the React build and proxies `/api`, `/uploads`, and `/health` to the private backend container.
- PostgreSQL and the NestJS port are Docker-internal and are not published on the VPS.

## Required deployment `.env`

Create a `.env` next to `docker-compose.prod.yml` on the VPS. Do not commit it.

```dotenv
DB_USER=gnext
DB_PASSWORD=replace-with-a-long-random-database-password
DB_NAME=appdb
ADMIN_USERNAME=admin@gnext.local
ADMIN_PASSWORD=replace-with-a-demo-admin-password
APPROVER_DEMO_PIN=2468
```

## Fresh start

If this VPS has never hosted this Compose project:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

If an older disposable Gnext stack and its sample database volume must be replaced, first confirm that its data may be discarded, then run:

```bash
docker compose -f docker-compose.prod.yml down -v
docker compose -f docker-compose.prod.yml up -d --build
```

The backend container runs migrations and the idempotent seed before starting the API.

## Verification

```bash
docker compose -f docker-compose.prod.yml ps
curl --fail http://127.0.0.1/health/ready
docker compose -f docker-compose.prod.yml logs --tail=200 backend frontend
```

Expected result: PostgreSQL, backend, and frontend are healthy; `/health/ready` returns HTTP 200; the admin can sign in and the seeded branches, catalog, tables, courier, and customers are visible.

## Arvan origin

Point the Arvan origin to the VPS over HTTP port 80. Preserve forwarding of `Host`, `X-Forwarded-For`, and `X-Forwarded-Proto`. Do not expose PostgreSQL (`5432`) or the backend (`3100`) publicly.

## Rollback

Keep the prior image/commit reference until validation is complete. A code rollback is performed by checking out that reference and rebuilding the Compose stack without deleting volumes. Because this is a disposable prototype, a complete clean rollback may instead recreate the sample database only after explicit confirmation.
