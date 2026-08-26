# Deploying to Netlify

> Planning to move off Netlify to your own server instead? See
> [docs/SELF_HOSTING.md](SELF_HOSTING.md) — the app has no hard Netlify
> dependency; storage, cron, and IP verification are all swappable via env vars.

## 1. Provision the database

Create a Neon (or Supabase) Postgres project. Copy the pooled connection string into
`DATABASE_URL` and the direct/non-pooled one into `DIRECT_URL`. See
[docs/DATABASE.md](DATABASE.md). Netlify does not host Postgres itself, so this step is
the same regardless of deploy target.

## 2. Create the Netlify site

```bash
npm i -g netlify-cli   # if you don't already have it
netlify login
netlify init            # links this repo to a new or existing Netlify site
```

Or connect the GitHub repo directly from the Netlify dashboard (Add new site → Import an
existing project). Netlify auto-detects Next.js and installs `@netlify/plugin-nextjs`
(also declared explicitly in `netlify.toml`), which handles SSR, Route Handlers, Server
Actions, and Middleware — no extra configuration needed for the app itself.

## 3. Set environment variables

In Netlify → Site configuration → Environment variables, set:

| Variable | Notes |
|---|---|
| `DATABASE_URL` | pooled connection string |
| `DIRECT_URL` | direct connection string (for migrations) |
| `APP_URL` / `NEXT_PUBLIC_APP_URL` | your production URL, e.g. `https://attendance.yourcompany.com` |
| `AUTH_SECRET` | `openssl rand -base64 48` — also used to derive Attendance ID hashes, so **do not rotate casually**; rotating it invalidates every existing Attendance ID |
| `QR_SECRET` | `openssl rand -base64 48` |
| `NETWORK_AGENT_SECRET` | reserved for future agent-side config signing; generate the same way |
| `CRON_SECRET` | random value — the scheduled functions in `netlify/functions/` send this as `Authorization: Bearer <value>` when they call `/api/cron/*` |

`NETLIFY_SITE_ID` / `NETLIFY_BLOBS_TOKEN` are **not** needed in production — Netlify
injects blob storage credentials into the runtime automatically (see
[docs/SECURITY.md](SECURITY.md) and `lib/storage/blob.ts`). Those two vars only matter for
local development without the Netlify CLI.

Use **different** `AUTH_SECRET`/`QR_SECRET` values for branch/deploy-preview contexts vs.
production so preview deployments can't forge production Attendance IDs or QR tokens —
set them per-context under Netlify's environment variable scopes.

## 4. Run migrations against production

Migrations are not run automatically on deploy (deliberately — see
[docs/DATABASE.md](DATABASE.md) on never auto-dropping production data). From your
machine, with production `DATABASE_URL`/`DIRECT_URL` in your shell:

```bash
npm run db:deploy
```

Then visit the deployed site — with zero admins in the database, `/admin/login` automatically
redirects to `/admin/setup`, a one-time page for creating the first Super Admin (name, email,
password) with no shell/DB access needed. It stops being reachable once that admin exists.

Prefer scripting the whole deploy end-to-end instead? The old CLI path still works too:

```bash
SEED_ADMIN_EMAIL=you@company.com SEED_ADMIN_PASSWORD='a-strong-password' npm run db:seed
```

Re-run `db:deploy` after every future schema change, before or right after the app deploys.

## 5. Scheduled Functions (Netlify's Cron equivalent)

Netlify can't schedule a Next.js App Router route handler directly — only functions living
in `netlify/functions/`. So `netlify/functions/sweep-qr.ts`,
`netlify/functions/stale-networks.ts`, and `netlify/functions/daily-housekeeping.ts` are
thin scheduled triggers (declared via `export const config = { schedule: "..." }` in each
file) that simply call the real logic at `/api/cron/*`, authenticated with `CRON_SECRET`.
As long as `CRON_SECRET` is set as an environment variable (step 3), these work with no
further setup — Netlify picks up the schedules automatically on deploy. Scheduled functions
**only run on published production deploys**, not deploy previews, and use UTC.

QR validity itself is still always enforced correctly at clock-in/scan time regardless of
whether these have run recently (`lib/qr/session.ts#validateQrToken` recomputes it live) —
the scheduled sweeps only keep the *displayed* status (and stale-network flag) fresh. See
`docs/QR_ATTENDANCE.md`.

## 6. Object storage (logo, employee photos, QR PDFs/PNGs)

Uses [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), which
is available automatically to any site on Netlify — no separate provisioning step, and no
token to configure in production. Unlike Vercel Blob, Netlify Blobs has no public CDN URL
of its own, so uploaded/generated files are served back through the app's own
`app/api/blob/[...key]/route.ts` (see `docs/SECURITY.md` for why this is safe to leave
unauthenticated).

## 7. Deploy

```bash
git push origin main
```

Netlify builds and deploys automatically on push to the configured production branch.
Deploy previews are created for every PR/branch automatically; give the preview environment
its own database (a Neon branch is ideal) so preview testing never touches production
attendance data, and its own `AUTH_SECRET`/`QR_SECRET`.

## 8. First-run checklist

After the first successful deploy:

1. Log into `/admin/login` with the seeded SUPER_ADMIN.
2. Settings → upload the company logo, set brand colors, confirm timezone (`Africa/Lagos`)
   and work hours.
3. Offices & Network → create the office, register a network, copy the `AGENT_ID` +
   `REGISTRATION_TOKEN` shown once.
4. Set up the Network Agent on an always-on office machine —
   [docs/OFFICE_NETWORK_AGENT_SETUP.md](OFFICE_NETWORK_AGENT_SETUP.md).
5. Confirm the office shows `VERIFIED` with a recent heartbeat.
6. Add employees, note each generated Attendance ID (shown once).
7. QR Codes → generate today's QR, download the PDF, print it.
8. Test the full flow from a phone on the office Wi-Fi.

## Local development with the Netlify CLI (optional but recommended)

`netlify dev` wraps `next dev` and additionally injects Netlify Blobs credentials and
emulates Scheduled Functions locally, so you don't need `NETLIFY_SITE_ID`/`NETLIFY_BLOBS_TOKEN`
in `.env` for local testing:

```bash
netlify link      # once, to associate this checkout with your Netlify site
netlify dev
```

Without the Netlify CLI (plain `npm run dev`), logo/QR-artifact uploads fail gracefully —
QR codes still work for attendance, just without a downloadable PDF/PNG until deployed or
until you set `NETLIFY_SITE_ID`/`NETLIFY_BLOBS_TOKEN` locally (see `.env.example`).

## Environments

- **Development**: local Postgres or a dev Neon branch, `npm run dev` (or `netlify dev`).
- **Deploy previews**: one per PR, ideally its own Neon branch/database so test data never
  mixes with production, plus its own `AUTH_SECRET`/`QR_SECRET`.
- **Production**: the configured production branch, protected env vars, migrations run
  manually via `db:deploy` (see step 4) rather than automatically on build.
