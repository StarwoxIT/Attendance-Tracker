# Self-hosting (migrating off Netlify)

This app has no hard dependency on Netlify. The pieces that were Netlify-specific —
object storage, scheduled jobs, and how the server learns a request's real IP — are
all swappable via environment variables and the files in this directory, without
touching application code. See [docs/DEPLOYMENT_NETLIFY.md](DEPLOYMENT_NETLIFY.md)
for what this replaces.

## What changed to make this possible

| Netlify piece | Self-hosted replacement | File |
|---|---|---|
| Netlify Blobs | `STORAGE_DRIVER=s3` (MinIO/S3) or `local` | `src/lib/storage/blob.ts` + `drivers/` |
| Scheduled Functions | `cron` container hitting the same `/api/cron/*` routes | `deploy/cron/` |
| `x-nf-client-connection-ip` edge header | `TRUSTED_IP_HEADER` env var + nginx | `src/lib/network/getClientIp.ts`, `deploy/nginx.conf` |
| Netlify's build/CDN/TLS | Docker + your own reverse proxy | `Dockerfile`, `docker-compose.yml`, `deploy/nginx.conf` |

Nothing about the database, business logic, or UI changed. The app still runs on
Netlify exactly as before unless you actively set the new env vars.

Deploying specifically to AWS (EC2 + RDS + S3)? See
[docs/DEPLOYMENT_AWS.md](DEPLOYMENT_AWS.md) for the AWS-specific provisioning steps —
it builds on everything below.

## 1. The one security-critical setting: `TRUSTED_IP_HEADER`

Office-network attendance verification only works if the app can trust the IP it
reads for each request. On Netlify, that trust comes from
`x-nf-client-connection-ip`, a header Netlify's edge sets and no client can forge.

Self-hosted, that trust has to come from **your** reverse proxy instead. `deploy/nginx.conf`
is written to set `X-Real-IP` from `$remote_addr` (the actual TCP connection), which
nginx's `proxy_set_header` always overwrites — a client sending their own `X-Real-IP`
gets ignored, not passed through. Pair that config with:

```
TRUSTED_IP_HEADER="x-real-ip"
```

**If you use a different reverse proxy or a cloud load balancer in front of nginx**,
confirm the same guarantee holds before going live: whatever header you point
`TRUSTED_IP_HEADER` at must be a header your edge unconditionally overwrites, never
one it merely forwards. Get this wrong and either attendance verification breaks, or
— worse — it becomes spoofable from anywhere. Test it by clocking in from a device
*not* on the office network and confirming it's still denied.

## 2. Object storage

Pick one, set `STORAGE_DRIVER` accordingly (see `.env.example` for all the specific
vars each needs):

- **`s3`** (recommended) — any S3-compatible store: real AWS S3 (see
  [docs/DEPLOYMENT_AWS.md](DEPLOYMENT_AWS.md)), or a MinIO container you run
  yourself alongside this stack if you don't already have object storage.
- **`local`** — writes to disk (`STORAGE_LOCAL_DIR`). Only correct for a single
  server/replica — mount it as a persistent volume so it survives container
  restarts.

### Migrating existing files off Netlify Blobs

If you have real data already in Netlify Blobs (uploaded logos, employee photos,
generated QR PDFs/PNGs) and want to preserve them, run `scripts/migrate-blobs-to-s3.ts`
before cutover — Netlify Blobs isn't reachable once the site is gone. It's read-only
against Netlify Blobs (nothing is deleted from the source) and safe to re-run:

```bash
# Preview what would be copied, without writing anything:
NETLIFY_SITE_ID=... NETLIFY_BLOBS_TOKEN=... npm run migrate:blobs-to-s3 -- --dry-run

# Actually copy everything to S3/MinIO:
NETLIFY_SITE_ID=... NETLIFY_BLOBS_TOKEN=... \
S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... [S3_ENDPOINT=...] \
npm run migrate:blobs-to-s3
```

`NETLIFY_SITE_ID`/`NETLIFY_BLOBS_TOKEN` come from Netlify → Site settings → General
(Site ID) and a Personal Access Token (User settings → OAuth applications). Only
after spot-checking a few migrated files (the company logo is a good one) load
correctly should you flip `STORAGE_DRIVER=s3` in the running app's environment.

## 3. Scheduled jobs

`deploy/cron/` is a small Alpine + `crond` container that calls the same
`/api/cron/sweep-qr`, `/api/cron/stale-networks`, and `/api/cron/daily-housekeeping`
routes Netlify's Scheduled Functions call today, authenticated with the same
`CRON_SECRET`. Same schedules, same logic — only the trigger mechanism changes.

## 4. Database

No change required. Keep using Neon (it's just Postgres — nothing about it is
Netlify-specific), or point `DATABASE_URL`/`DIRECT_URL` at Postgres you run
yourself. `docker-compose.yml` has no bundled Postgres container — deliberately, so
the exact same compose file works unchanged from a laptop to production (see its own
header comment): bring a real, already-running Postgres and just point `DATABASE_URL`
at it, whether that's a native local install, a managed instance (e.g. RDS — see
[docs/DEPLOYMENT_AWS.md](DEPLOYMENT_AWS.md)), or a Postgres container you run and
manage yourself outside this compose file. See [docs/DATABASE.md](DATABASE.md).

### Migrating existing production data to a new database

If you're moving off Neon to your own Postgres and want the real data (employees,
attendance history, settings, audit log) rather than starting fresh, use
`scripts/export-data.ts` / `scripts/import-data.ts` instead of `pg_dump`/`pg_restore` —
those two tools need to be within one major version of the server they're talking to,
which frequently isn't true when going from a managed Postgres like Neon to whatever
your new box happens to ship. These scripts go through Prisma instead, so any Postgres
version works on either end.

```bash
# From a machine that can reach the OLD database:
DATABASE_URL="<old DATABASE_URL>" npx tsx scripts/export-data.ts production_data.json

# From a machine that can reach the NEW database (after it's migrated — step 5 below):
DATABASE_URL="<new DATABASE_URL>" npx tsx scripts/import-data.ts production_data.json
```

`import-data.ts` refuses to run (without `--force`) if the target already has any admin
users, so it can't silently duplicate data into a deployment someone's already started
using. It skips `Session` (old login cookies wouldn't be valid against a new server
anyway) and `RateLimitBucket` (transient counters, not data) — every admin will need to
log in fresh afterward. `production_data.json` contains real employee PII and password
hashes; delete it once the import is confirmed working, and never commit it.

## 5. Running it

Have a real Postgres reachable first (§4) — create the database if it doesn't exist yet
(`createdb attendance`), then:

```bash
cp .env.example .env
# fill in: DATABASE_URL (§4 — use "host.docker.internal" instead of "localhost" if
# Postgres runs on this same host, since the app runs inside a container), AUTH_SECRET,
# QR_SECRET, NETWORK_AGENT_SECRET, CRON_SECRET, APP_URL/NEXT_PUBLIC_APP_URL,
# STORAGE_DRIVER + its vars, TRUSTED_IP_HEADER, RESEND_API_KEY/RESEND_FROM_EMAIL,
# SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD (see below)

docker compose build
docker compose up -d migrate   # applies prisma/migrations (creates the schema from
                                 # scratch on an empty DB, or just the new migrations
                                 # on an existing one), then ensures the SEED_ADMIN_*
                                 # super admin exists — both steps are safe to re-run
docker compose up -d           # starts app, cron, nginx
```

Setting `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` in `.env` is enough — the `migrate`
container creates that `SUPER_ADMIN` automatically every time it runs (`prisma/seed.ts`),
and just as automatically skips it once the account already exists. No separate seed
command needed. Leave both unset to skip seeding entirely (e.g. once the admin exists
and you'd rather not keep the password in `.env`).

`nginx` is one of the services `docker compose up -d` just started — no separate
install needed. `deploy/nginx.conf` (the config it loads by default) is plain HTTP with
no domain required, so `http://<server-ip>/` works immediately. Once you have a domain,
copy `deploy/nginx.https.conf.example` over `deploy/nginx.conf`, fill in `server_name`
and the TLS certificate paths, and run `certbot --nginx` against it for Let's Encrypt —
a bare IP address can't get a Let's Encrypt cert, which is why this is a later step, not
day one.

Re-run `docker compose up -d migrate` after every future schema change, same as
`npm run db:deploy` was run manually against Netlify.

## 6. Cutover checklist

1. Provision the server, install Docker + Docker Compose.
2. Fill in `.env` per step 5 — reuse the **same** `AUTH_SECRET`/`QR_SECRET` as
   production if you want existing Attendance IDs and admin sessions to keep
   working; rotating them invalidates every issued Attendance ID (see
   [docs/DEPLOYMENT_NETLIFY.md](DEPLOYMENT_NETLIFY.md)).
3. Point `DATABASE_URL` at production data (same Neon database, or a restored copy —
   your call on whether to keep Neon or migrate the database too; they're independent
   decisions).
4. Migrate object storage contents if needed (§2).
5. Build and start the stack; verify `docker compose logs app` is healthy.
6. Confirm `TRUSTED_IP_HEADER` is actually working (§1) before relying on it.
7. Point DNS at the new server. Keep the Netlify site up (unpublished/paused rather
   than deleted) until you've confirmed a full day of clock-ins on the new
   infrastructure — trivial to roll back by re-pointing DNS if something's wrong.
8. Once confident, decommission the Netlify site and its scheduled functions.
