import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/lib/network/getClientIp";
import { recordAttendance } from "./engine";
import { DENIAL_MESSAGES } from "./messages";
import { formatInTimeZone } from "date-fns-tz";
import { getAttendanceSettings } from "./settings";
import { DEVICE_ID_COOKIE, DEVICE_ID_COOKIE_OPTIONS, generateDeviceId } from "@/lib/security/deviceId";

const bodySchema = z.object({
  attendanceId: z.string().min(3).max(40),
  qrSessionToken: z.string().min(10).max(200).optional(),
  earlyClockOutReason: z.string().max(400).optional(),
  // Shape and limits are enforced by the engine (taskReportSchema) so a bad
  // report gets a specific TASK_REPORT_INVALID rather than a generic 400.
  tasks: z.array(z.unknown()).optional(),
  noTasksReason: z.unknown().optional(),
});

// Fits a full daily task report (20 tasks x 500 characters) plus the rest of the body.
const MAX_BODY_BYTES = 16_384;
export const QR_SESSION_COOKIE = "attendance_qr_session";

export async function handleClockRequest(request: NextRequest): Promise<NextResponse> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, message: "Request too large." }, { status: 413 });
  }

  let parsed;
  try {
    parsed = bodySchema.parse(JSON.parse(raw));
  } catch {
    return NextResponse.json({ ok: false, message: "Invalid request." }, { status: 400 });
  }

  const sourceIp = getClientIp(request);
  if (!sourceIp) {
    return NextResponse.json({ ok: false, message: "Could not determine request origin." }, { status: 400 });
  }

  // The QR session token normally arrives as an httpOnly cookie set when the
  // employee's phone opened the /register/qr/[token] link — it never has to
  // pass through client-side JS. A body field is also accepted for API clients.
  const cookieToken = request.cookies.get(QR_SESSION_COOKIE)?.value ?? null;

  // proxy.ts assigns this on the first /register page load, so it's normally
  // already present; generate one here too as a fallback (e.g. a direct API
  // call that skipped the page) so device tracking never silently no-ops.
  let deviceId = request.cookies.get(DEVICE_ID_COOKIE)?.value ?? null;
  let setDeviceIdCookie = false;
  if (!deviceId) {
    deviceId = generateDeviceId();
    setDeviceIdCookie = true;
  }

  const result = await recordAttendance({
    attendanceIdRaw: parsed.attendanceId,
    sourceIp,
    userAgent: request.headers.get("user-agent"),
    qrSessionToken: cookieToken ?? parsed.qrSessionToken ?? null,
    deviceId,
    earlyClockOutReason: parsed.earlyClockOutReason ?? null,
    tasks: parsed.tasks,
    noTasksReason: parsed.noTasksReason,
  });

  if (!result.ok) {
    const status = result.reason === "RATE_LIMITED" ? 429 : 403;
    const response = NextResponse.json(
      { ok: false, reason: result.reason, message: DENIAL_MESSAGES[result.reason] },
      { status, headers: result.retryAfterSeconds ? { "Retry-After": String(result.retryAfterSeconds) } : {} }
    );
    if (setDeviceIdCookie) response.cookies.set(DEVICE_ID_COOKIE, deviceId, DEVICE_ID_COOKIE_OPTIONS);
    return response;
  }

  const settings = await getAttendanceSettings();
  const tz = settings.timezone;

  const response = NextResponse.json(
    result.action === "CLOCK_IN"
      ? {
          ok: true,
          action: "CLOCK_IN",
          firstName: result.firstName,
          time: formatInTimeZone(result.record.clockIn!, tz, "h:mm a"),
          status: result.record.clockInStatus,
          attendanceType: result.record.attendanceType,
          minutesLate: result.record.minutesLate,
        }
      : {
          ok: true,
          action: "CLOCK_OUT",
          firstName: result.firstName,
          time: formatInTimeZone(result.record.clockOut!, tz, "h:mm a"),
          clockInTime: formatInTimeZone(result.record.clockIn!, tz, "h:mm a"),
          totalMinutesWorked: result.record.totalMinutesWorked,
          clockOutStatus: result.record.clockOutStatus,
          tasksReported: result.tasksReported,
        }
  );
  if (setDeviceIdCookie) response.cookies.set(DEVICE_ID_COOKIE, deviceId, DEVICE_ID_COOKIE_OPTIONS);
  return response;
}
