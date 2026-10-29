# Admin Guide

This guide is for whoever manages the attendance system day-to-day — no coding knowledge
needed.

## Signing in

Go to `https://<your-domain>/admin/login`. Use the email/password you (or your IT person)
set up. If you forget your password, another SUPER_ADMIN can reset it by creating you a new
account or a developer can reset it directly in the database — there's no self-service
"forgot password" flow yet.

## First-time setup, in order

1. **Settings → Company branding**: upload your logo, set your brand colors, fill in address/
   phone/email/website. This appears everywhere — the attendance screen, reports, QR posters.
2. **Settings → Attendance rules**: confirm timezone (`Africa/Lagos`), work start time
   (default 9:00 AM), grace period (default 15 minutes — arriving up to 15 minutes late still
   counts as ON TIME), work end time, and attendance mode (QR + Network is recommended and is
   the default).
3. **Offices & Network**: add your office (name, address), then click **Register Network** for
   it. Two ways to verify it from here, pick whichever fits:
   - **No spare machine for an agent**: while your own phone/laptop is on the office Wi-Fi,
     click **Authorize This Network Now** and confirm. Done — re-click it whenever Starlink's
     IP changes (or once a day is fine too, just raise the stale threshold in Settings →
     Attendance rules if you're not re-clicking often).
   - **Have a spare always-on machine**: use the `AGENT_ID`/`REGISTRATION_TOKEN` shown once to
     set up the Network Agent instead — it heartbeats automatically every few minutes with no
     ongoing admin action (see [OFFICE_NETWORK_AGENT_SETUP.md](OFFICE_NETWORK_AGENT_SETUP.md) —
     this part does need someone comfortable with a terminal).
4. Either way, the office should now show **Network Status: VERIFIED**.
5. **Employees → Add Employee**: fill in name, office, department, job title. On save, you'll
   see their **Attendance ID once** — write it down / print it / share it with them securely
   right away. It cannot be viewed again later, only regenerated (which invalidates the old
   one).
6. **QR Codes → Generate**: pick the office and today's date, click Generate. Download the
   PDF and print it — put it up somewhere visible at the office entrance/reception.
7. Test it yourself: stand at the office, scan the QR, enter your Attendance ID, confirm you
   see a success screen with the right time and status.

## Day-to-day

- **Dashboard** shows today's numbers at a glance (present, late, currently in office,
  overtime) and a 7-day trend.
- **Attendance** lists every record; filter by date/employee/status. Click **Correct** on any
  row to fix a clock-in/out time, status, or type — you must give a reason, and every
  correction is logged.
- **Employees**: search, view/edit a profile, see their recent attendance, deactivate someone
  who's left (deactivated employees can't clock in), or regenerate their Attendance ID if
  they lost it.
- **QR Codes**: used in QR + location mode (for when the office network is down). Generate
  a **No expiry** code per office and print it; deactivate or regenerate one if it's been
  compromised (e.g. posted publicly online by mistake).
- **Device Flags**: shows whenever a phone/laptop clocks in as a different employee than it
  was last used by — a possible sign someone clocked in for an absent colleague. It never
  blocks the clock-in itself (a shared device, like a reception tablet, is normal and will
  flag every time it switches employees). Open each flag, confirm it's expected or worth
  following up on, optionally leave a note, and mark it reviewed.
- **Reports**: Daily, Monthly, or per-Employee, exportable as CSV, Excel, or a branded PDF.
- **Holidays**: add public holidays; attendance on those days is automatically marked as
  holiday overtime.
- **Administrators**: add other admin accounts with an appropriate role:
  - **Viewer** — read-only, for someone who just needs to see reports.
  - **HR** — employees + attendance + reports.
  - **Admin** — the above plus QR, offices/network, and normal settings.
  - **Super Admin** — everything, including managing other admins.
- **Audit Log**: a searchable record of every sensitive action taken in the system, by whom,
  and when.

## Understanding attendance statuses

| Status | Meaning |
|---|---|
| EARLY | Clocked in before the work start time |
| ON TIME | Clocked in at or within the grace period after work start |
| LATE | Clocked in after the grace period — the exact minutes late is recorded |
| WEEKEND_OVERTIME / HOLIDAY_OVERTIME | Attendance on a Saturday/Sunday/configured holiday |
| MISSED_CLOCK_OUT | Clocked in but never clocked out that day — needs a correction |
| MANUALLY_ADJUSTED | An admin corrected this record |

## If an employee can't clock in

The screen tells them why in plain language:

- *"Attendance ID not recognized"* — check they typed it correctly, or that their account is
  Active (Employees page).
- *"Attendance unavailable... authorized office network"* — they're not on office Wi-Fi (or
  the Network Agent is offline — check Offices & Network for a stale/unverified warning).
- *"This QR code is invalid or has expired"* — they scanned yesterday's printout, or the QR
  was regenerated/deactivated. Print the current one.
- *"Today's attendance requires QR verification"* — they went straight to the attendance page
  without scanning the QR first (only relevant in QR + location mode).
