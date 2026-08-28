import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getAttendanceSettings } from "./settings";
import {
  classifyClockIn,
  classifyClockOut,
  calculateMinutesWorked,
  getAttendanceDateKey,
  isWeekend,
  MAX_EARLY_CLOCKOUT_REASON_WORDS,
} from "./rules";
import { verifyOfficeNetwork } from "@/lib/network/verifyOfficeNetwork";
import { hashAttendanceId, normalizeAttendanceId } from "@/lib/security/attendanceId";
import { checkRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { getActiveQrSession, consumeQrSession } from "@/lib/qr/session";
import { flagDeviceReuseIfNeeded } from "./deviceFlags";
import { notifyRole } from "@/lib/notifications/create";
import type { AttendanceRecord, VerificationMethod } from "@prisma/client";

export type AttendanceDenialReason =
  | "RATE_LIMITED"
  | "INVALID_EMPLOYEE"
  | "QR_REQUIRED"
  | "QR_SESSION_INVALID"
  | "QR_WRONG_OFFICE"
  | "NETWORK_DENIED"
  | "ALREADY_COMPLETE"
  | "EARLY_CLOCKOUT_REASON_REQUIRED";

export type AttendanceActionResult =
  | {
      ok: true;
      action: "CLOCK_IN";
      record: AttendanceRecord;
      firstName: string;
    }
  | {
      ok: true;
      action: "CLOCK_OUT";
      record: AttendanceRecord;
      firstName: string;
    }
  | { ok: false; reason: AttendanceDenialReason; retryAfterSeconds?: number };

export interface RecordAttendanceInput {
  attendanceIdRaw: string;
  sourceIp: string;
  userAgent: string | null;
  qrSessionToken?: string | null;
  /** Persistent per-browser cookie ID, not a network identity — see lib/security/deviceId.ts. */
  deviceId?: string | null;
  /** Required when clocking out before the scheduled end of day; ignored otherwise. */
  earlyClockOutReason?: string | null;
}

/** Alerts Super Admins the first time an office's clock-in is blocked because its
 * previously-authorized IP no longer matches (changed Wi-Fi IP, or gone stale past
 * the grace window) — i.e. exactly the "employees can't log in" scenario, not a
 * simple missing-config case. Deduped per office for an hour so one flaky network
 * doesn't spam an alert per failed clock-in attempt. */
async function alertSuperAdminsOfNetworkDenial(
  officeId: string,
  reason: "STALE_FAIL_CLOSED" | "IP_NOT_AUTHORIZED"
): Promise<void> {
  const office = await prisma.office.findUnique({ where: { id: officeId }, select: { name: true } });
  const officeName = office?.name ?? "an office";
  const detail =
    reason === "STALE_FAIL_CLOSED"
      ? "its authorized network hasn't re-verified recently and is being treated as no longer active"
      : "the request's IP no longer matches any authorized network";
  await notifyRole({
    type: "NETWORK_IP_CHANGED",
    targetRole: "SUPER_ADMIN",
    officeId,
    title: `${officeName}: employees can't clock in — network IP changed`,
    message: `An employee at ${officeName} was just blocked from clocking in because ${detail}. Re-authorize the current network from Offices & Network, or check the network agent.`,
    dedupeWindowMinutes: 60,
  });
}

/**
 * Single entry point for the kiosk/QR flow. Determines clock-in vs clock-out,
 * enforces the configured attendance mode, and derives every security-sensitive
 * value (time, IP, office, status) server-side — nothing from the client is trusted
 * except the Attendance ID and the opaque QR session token.
 */
export async function recordAttendance(input: RecordAttendanceInput): Promise<AttendanceActionResult> {
  const lookup = hashAttendanceId(normalizeAttendanceId(input.attendanceIdRaw));
  const employee = await prisma.employee.findUnique({ where: { attendanceIdLookup: lookup } });
  if (!employee || employee.isDeleted || employee.employmentStatus !== "ACTIVE") {
    // Rate limiting is keyed by source IP, and every device on an office's Wi-Fi
    // shares one public IP via NAT — so it must only ever throttle *invalid* ID
    // guesses (the actual brute-force attack this defends against), never valid
    // ones. Checking it here, only on the invalid-employee path, means a whole
    // office clocking in concurrently with correct IDs can never trip it; only
    // repeated wrong guesses from the same IP can. Attendance IDs are also
    // high-entropy random tokens (see lib/security/attendanceId.ts), so a
    // legitimate match here was never realistically reachable by guessing —
    // this rate limit is defense-in-depth, not the primary protection.
    const rateLimit = await checkRateLimit(input.sourceIp, RATE_LIMITS.attendanceId);
    if (!rateLimit.allowed) {
      return { ok: false, reason: "RATE_LIMITED", retryAfterSeconds: rateLimit.retryAfterSeconds };
    }
    return { ok: false, reason: "INVALID_EMPLOYEE" };
  }

  const settings = await getAttendanceSettings();
  const requiresQr = settings.attendanceMode === "QR_AND_NETWORK" || settings.attendanceMode === "QR_ONLY";
  const requiresNetwork = settings.attendanceMode === "QR_AND_NETWORK" || settings.attendanceMode === "NETWORK_ONLY";

  let qrCodeId: string | null = null;
  let qrSessionId: string | null = null;

  if (requiresQr) {
    if (!input.qrSessionToken) {
      return { ok: false, reason: "QR_REQUIRED" };
    }
    const sessionResult = await getActiveQrSession(input.qrSessionToken);
    if (!sessionResult.ok) {
      return { ok: false, reason: "QR_SESSION_INVALID" };
    }
    if (
      sessionResult.session.officeId !== employee.officeId &&
      !settings.crossOfficeAttendance
    ) {
      return { ok: false, reason: "QR_WRONG_OFFICE" };
    }
    qrCodeId = sessionResult.session.qrCodeId;
    qrSessionId = sessionResult.session.id;
  }

  let officeNetworkId: string | null = null;
  if (requiresNetwork) {
    const netResult = await verifyOfficeNetwork(employee.officeId, input.sourceIp);
    if (!netResult.allowed) {
      if (netResult.reason === "STALE_FAIL_CLOSED" || netResult.reason === "IP_NOT_AUTHORIZED") {
        await alertSuperAdminsOfNetworkDenial(employee.officeId, netResult.reason);
      }
      return { ok: false, reason: "NETWORK_DENIED" };
    }
    officeNetworkId = netResult.officeNetworkId;
  }

  const verificationMethod: VerificationMethod =
    settings.attendanceMode === "NETWORK_ONLY"
      ? "NETWORK"
      : settings.attendanceMode === "QR_ONLY"
        ? "QR_ONLY"
        : "QR_NETWORK";

  const now = new Date();
  const attendanceDate = getAttendanceDateKey(now, settings.timezone);

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate } },
  });

  if (existing?.clockOut) {
    return { ok: false, reason: "ALREADY_COMPLETE" };
  }

  try {
    if (!existing) {
      const holiday = await prisma.holiday.findUnique({ where: { date: attendanceDate } });
      const classification = classifyClockIn(
        now,
        { ...settings, workStart: employee.workStart ?? settings.workStart },
        { isWeekendDay: isWeekend(now, settings.timezone), isHoliday: !!holiday && holiday.isActive }
      );

      const record = await prisma.attendanceRecord.create({
        data: {
          employeeId: employee.id,
          officeId: employee.officeId,
          attendanceDate,
          clockIn: now,
          clockInStatus: classification.status,
          attendanceType: classification.attendanceType,
          minutesLate: classification.minutesLate,
          clockInIp: input.sourceIp,
          clockInUserAgent: input.userAgent,
          clockInNetworkId: officeNetworkId,
          clockInQrId: qrCodeId,
          clockInDeviceId: input.deviceId ?? null,
          verificationMethod,
        },
      });

      if (qrSessionId) await consumeQrSession(qrSessionId);
      await flagDeviceReuseIfNeeded({
        deviceId: input.deviceId ?? null,
        employeeId: employee.id,
        attendanceRecordId: record.id,
      });
      return { ok: true, action: "CLOCK_IN", record, firstName: employee.firstName };
    }

    const clockOutStatus = classifyClockOut(now, { ...settings, workEnd: employee.workEnd ?? settings.workEnd });
    let earlyClockOutReason: string | null = null;
    if (clockOutStatus === "EARLY") {
      const reason = input.earlyClockOutReason?.trim() ?? "";
      if (!reason) {
        return { ok: false, reason: "EARLY_CLOCKOUT_REASON_REQUIRED" };
      }
      // The client already enforces this live; re-checked here since nothing from
      // the client is trusted. Truncate rather than reject — the client-visible
      // reason was already within limits, this is just defense-in-depth.
      earlyClockOutReason = reason.split(/\s+/).slice(0, MAX_EARLY_CLOCKOUT_REASON_WORDS).join(" ");
    }

    const totalMinutesWorked = calculateMinutesWorked(existing.clockIn!, now);
    const record = await prisma.attendanceRecord.update({
      where: { id: existing.id },
      data: {
        clockOut: now,
        clockOutStatus,
        earlyClockOutReason,
        clockOutIp: input.sourceIp,
        clockOutUserAgent: input.userAgent,
        clockOutNetworkId: officeNetworkId,
        clockOutQrId: qrCodeId,
        clockOutDeviceId: input.deviceId ?? null,
        totalMinutesWorked,
      },
    });

    if (qrSessionId) await consumeQrSession(qrSessionId);
    return { ok: true, action: "CLOCK_OUT", record, firstName: employee.firstName };
  } catch (err) {
    // A concurrent duplicate clock-in/out lost the race against our unique constraint.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "ALREADY_COMPLETE" };
    }
    throw err;
  }
}
