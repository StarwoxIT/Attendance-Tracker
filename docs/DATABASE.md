# Database

PostgreSQL via Prisma. Any standard `postgresql://` connection string works — the app has
no provider-specific code. `DIRECT_URL` is used by Prisma Migrate for schema changes when
`DATABASE_URL` is a pooled connection (Neon, Supabase, PgBouncer) — pooled connections can't
run `CREATE INDEX CONCURRENTLY`/DDL transactions reliably. If your provider gives you both a
pooled and a direct URL, set both; if it only gives you one, set both env vars to the same
value.

## Choosing a provider

| Provider | Notes |
|---|---|
| **Neon** | Recommended default. Generous free tier, branching for preview deployments, gives you both pooled and direct URLs out of the box. |
| **Supabase Postgres** | Fine alternative, also has a free tier and both connection string flavors. |
| Self-hosted / any other Postgres | Works as long as it's reachable from Netlify's serverless functions (public endpoint + TLS). |

## Local development

You need a real Postgres instance — there is no SQLite fallback (the schema uses Postgres-only
features like `@db.Date` and would need real integration testing against Postgres regardless).
Fastest options if you don't want to install Postgres locally:

1. Create a free Neon or Supabase project and point `DATABASE_URL`/`DIRECT_URL` at it.
2. Or install Postgres locally (`brew install postgresql@16` on macOS) and create a database.

Then:

```bash
npm run db:migrate   # applies prisma/migrations, creates them on first run
npm run db:seed       # creates the first SUPER_ADMIN + default settings (see prisma/seed.ts)
```

## Schema overview

See `prisma/schema.prisma` for the source of truth. Grouped by concern:

- **Auth/RBAC**: `User` (admin accounts, roles `SUPER_ADMIN|ADMIN|HR|VIEWER`), `Session`
  (hashed session tokens, not JWTs — revocable by deleting the row).
- **Organization**: `Department`, `Office`.
- **Employees**: `Employee` — note there is no plaintext Attendance ID column anywhere;
  only `attendanceIdLookup`, a keyed HMAC hash (see `docs/SECURITY.md`). `AttendanceIdHistory`
  records every regeneration for audit purposes.
- **Network verification**: `OfficeNetwork` (one row per authorized network identity per
  office — supports multiple in the future), `NetworkHeartbeat` (append-only log of every
  agent heartbeat, used for the admin's "view heartbeats" screen and troubleshooting).
- **Attendance**: `AttendanceRecord` — one row per employee per calendar day, enforced by
  `@@unique([employeeId, attendanceDate])`. `AttendanceCorrection` is an append-only audit
  trail of every admin edit to a record (old value, new value, reason, actor, IP).
- **QR**: `AttendanceQrCode` (one office+day can have many rows over time as codes get
  regenerated/deactivated, but only one `ACTIVE`/`SCHEDULED` at a time — enforced in
  application logic, see `lib/qr/manage.ts`, not a DB constraint, because DEACTIVATED rows
  legitimately repeat). `QrAttendanceSession` — the short-lived session created right after
  a scan, before the Attendance ID is entered.
- **Settings**: `CompanySettings` and `AttendanceSettings` are both singleton rows
  (`id = "singleton"`) — simplest correct representation for "the one config for this
  deployment," upserted rather than requiring a migration to seed them.
- **Audit**: `AuditLog` — append-only, covers every admin/security-relevant action listed in
  `docs/SECURITY.md`.
- **Rate limiting**: `RateLimitBucket` — a persistent, Postgres-backed limiter (see
  `lib/security/rateLimit.ts`). An in-memory limiter would reset on every cold start and
  wouldn't be shared across concurrent serverless instances, so it can't work correctly on
  Netlify's serverless functions.

## Migrations

```bash
npm run db:migrate    # dev: creates + applies a new migration from schema changes
npm run db:deploy     # production: applies existing migrations, non-interactive
```

`db:deploy` is what CI/CD (or you, manually, before/after a Netlify deploy) should run against
production — it never generates new migrations or drops data. Never run `prisma migrate reset`
against a production database; it drops the schema.

## Seeding

`prisma/seed.ts` is idempotent (safe to re-run, and safe to run on every deploy) —
there is no hard-coded default account. With `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD`
set, it creates that `SUPER_ADMIN` if it doesn't already exist, and skips it (leaving
the existing account untouched) if it does. Leaving both unset skips seeding entirely
rather than erroring. Self-hosted via Docker, this runs automatically as part of the
`migrate` container's startup (see `Dockerfile`) — no separate command needed there.
