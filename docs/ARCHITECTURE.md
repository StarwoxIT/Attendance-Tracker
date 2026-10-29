# Architecture

## Why this shape

The app runs on Netlify's serverless platform (Next.js via `@netlify/plugin-nextjs`), which
rules out a long-running Express process, in-memory state, and local-filesystem persistence.
Every design decision below follows from that constraint plus the core requirement:
attendance can only be recorded when the server itself can prove presence, time, and
identity — never by trusting anything the client sends.

## Components

```
                    EMPLOYEE
                       |
             Phone / Tablet / PC
                       |
                  OFFICE WI-FI
                       |
                    STARLINK  (dynamic public IP)
                       |
                       v
                ┌─────────────┐
                │   NETLIFY   │
                │  Next.js    │  App Router pages + Route Handlers + Server Actions
                │ Frontend/API│  (+ Scheduled Functions in netlify/functions/)
                └──────┬──────┘
                       |
                 PostgreSQL (Neon/Supabase/any standard provider)
                       |
                       v
               Attendance Data

                OFFICE NETWORK (separate, always-on machine)
                       |
               Network Agent (Python, network-agent/)
                       |
                Signed heartbeat (HMAC, timestamped, replay-protected)
                       |
                       v
                POST /api/network/heartbeat  →  Netlify  →  PostgreSQL
```

The Network Agent is deliberately **not** part of the Next.js app. It has to run
continuously inside the physical office to observe Starlink's current IP — something
a serverless function cannot do — so it's a standalone Python process (`network-agent/agent.py`)
with its own setup docs.

## Request flow: employee clock-in

1. Employee opens `/register` (direct link) or scans the office QR, which redirects
   through `/register/qr/[token]` first. This is a deliberately different URL from
   `/admin/login` — staff never need to see or guess an admin path, and vice versa.
2. In QR + location mode (`QR_ONLY`), the QR
   landing route validates the token server-side (`lib/qr/session.ts`), opens a short-lived
   `QrAttendanceSession` bound to an httpOnly cookie, and redirects into the register screen.
   Visiting `/register` directly without that cookie shows "QR verification required" instead
   of a working form — there's no way to skip the check by hitting a different URL.
3. Employee types their Attendance ID and submits. The register screen POSTs `{ attendanceId }` to
   `/api/attendance/clock-in` (or `/clock-out` — both routes call the same handler, see below).
4. `lib/attendance/clockHandler.ts` resolves the request's real source IP via
   `getClientIp()` (never a client-supplied value), reads the QR session token from the
   httpOnly cookie (never trusts a client-supplied token in the body except as a fallback
   for API testing), and calls `lib/attendance/engine.ts#recordAttendance`.
5. `recordAttendance` is the single authority for the whole decision:
   - rate-limits by source IP,
   - looks up the employee by a keyed hash of the Attendance ID (never a plaintext lookup),
   - enforces the configured attendance mode (QR session validity + office match, and/or
     office network IP match),
   - determines clock-in vs. clock-out purely from whether an `AttendanceRecord` already
     exists for today (the employee never chooses — see `docs/QR_ATTENDANCE.md` and the
     state machine below),
   - classifies EARLY/ON_TIME/LATE and REGULAR/WEEKEND_OVERTIME/HOLIDAY_OVERTIME using the
     server's clock and the office's configured timezone (`lib/attendance/rules.ts`),
   - writes the `AttendanceRecord` inside a transaction protected by a
     `(employeeId, attendanceDate)` unique constraint, so concurrent duplicate requests
     can't create two rows.
6. The response never includes anything about *why* an ID was rejected beyond the fixed,
   generic messages in `lib/attendance/messages.ts` — no "employee found but wrong network"
   vs. "employee not found" distinction is exposed.

## State machine

```
NOT_CLOCKED_IN → CLOCKED_IN → CLOCKED_OUT
```

`recordAttendance` re-derives this from the database on every request: no record for today
means clock-in; a record with `clockOut IS NULL` means clock-out; a record with `clockOut`
already set is rejected as `ALREADY_COMPLETE`. Admins can force a transition out of this
(e.g. adding a missed clock-out) only through `lib/actions/attendance.ts#correctAttendanceAction`,
which requires a reason and is fully audited.

## Why Server Actions *and* Route Handlers

- **Route Handlers** (`app/api/**/route.ts`) are used for anything a non-browser client calls:
  the register screen's fetch requests, the Network Agent's heartbeat/registration, report downloads,
  and the `/api/cron/*` targets that Netlify's Scheduled Functions trigger.
- **Server Actions** (`lib/actions/**`) back every admin form (employees, offices, QR,
  settings, holidays, admins). They get CSRF protection and same-origin enforcement from the
  framework for free, and they let admin pages stay server components with progressive
  enhancement instead of hand-rolled fetch+state boilerplate.

## Rendering strategy

Admin pages are server components that query Prisma directly (`export const dynamic =
"force-dynamic"` where the data must always be fresh — dashboards, lists). The public register
screen and QR landing route are also dynamic, since attendance decisions must never be served from
a cache. The root layout caches company branding for 60 seconds (`revalidate = 60`) since a
brand color change doesn't need to be instant.

## Multi-office support

`Office` → has many `Employee`, `OfficeNetwork`, `AttendanceQrCode`. Every attendance-time
check (network match, QR match) is scoped to the employee's own office unless
`AttendanceSettings.crossOfficeAttendance` is explicitly enabled by a SUPER_ADMIN/ADMIN.

## What's intentionally NOT built yet

Per the brief, biometrics/GPS/facial recognition/camera tracking are out of scope. The schema
and `lib/` boundaries (`lib/attendance`, `lib/network`, `lib/qr`) are structured so that a
future shift-scheduling, payroll, or HRIS-integration module could be added without touching
the core attendance engine — see the "Future extensibility" note in `docs/SECURITY.md`.
