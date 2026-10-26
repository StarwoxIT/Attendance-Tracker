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
import { parseDailyReport } from "./taskReport";
import { notifyRole } from "@/lib/notifications/create";
import { checkOfficeLocation, locationReadingSchema } from "./location";
import { getQrBackupState } from "./qrBackup";
import type { AttendanceRecord, AttendanceSettings, Employee, VerificationMethod } from "@prisma/client";

/** How long after clocking in a repeat attempt without a task report is treated as
 * the same clock-in (a retry) rather than the start of a clock-out. */
export const CLOCK_IN_REPEAT_WINDOW_MINUTES = 5;

export type AttendanceDenialReason =
  | "RATE_LIMITED"
  | "INVALID_EMPLOYEE"
  | "QR_REQUIRED"
  | "QR_SESSION_INVALID"
  | "QR_WRONG_OFFICE"
  | "NETWORK_DENIED"
  | "USE_QR_BACKUP"
  | "QR_BACKUP_INACTIVE"
  | "LOCATION_REQUIRED"
  | "LOCATION_INACCURATE"
  | "LOCATION_OUT_OF_RANGE"
  | "LOCATION_NOT_CONFIGURED"
  | "ALREADY_COMPLETE"
  | "TASK_REPORT_REQUIRED"
  | "TASK_REPORT_INVALID"
  | "EARLY_CLOCKOUT_REASON_REQUIRED";

export type AttendanceActionResult =
  | {
      ok: true;
      action: "CLOCK_IN";
      record: AttendanceRecord;
      firstName: string;
      /** True when this was a repeat of a clock-in that had already been recorded. */
      alreadyClockedIn?: boolean;
    }
  | {
      ok: true;
      action: "CLOCK_OUT";
      record: AttendanceRecord;
      firstName: string;
      tasksReported: number;
    }
  | AttendanceDenial;

export interface AttendanceDenial {
  ok: false;
  reason: AttendanceDenialReason;
  retryAfterSeconds?: number;
  /** LOCATION_OUT_OF_RANGE: how far from the office the phone said it was. */
  distanceMeters?: number;
}

export interface RecordAttendanceInput {
  attendanceIdRaw: string;
  sourceIp: string;
  userAgent: string | null;
  qrSessionToken?: string | null;
  /** Persistent per-browser cookie ID, not a network identity — see lib/security/deviceId.ts. */
  deviceId?: string | null;
  /** Required when clocking out before the scheduled end of day; ignored otherwise. */
  earlyClockOutReason?: string | null;
  /** The "What have you worked on today?" report — required to clock out, ignored on clock-in.
   * Untrusted client input, validated here against taskReportSchema. */
  tasks?: unknown;
  /** Sent instead of `tasks` when the employee had nothing to report — validated like `tasks`. */
  noTasksReason?: unknown;
  /** The phone's reported position, for QR + location attendance. Untrusted client
   * input, validated here against locationReadingSchema; only used where the mode calls for it. */
  location?: unknown;
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

type PresenceResult =
  | {
      ok: true;
      verificationMethod: VerificationMethod;
      qrCodeId: string | null;
      qrSessionId: string | null;
      officeNetworkId: string | null;
      location: { distanceMeters: number; accuracyMeters: number } | null;
    }
  | AttendanceDenial;

/** The scan that opened this register session, if it's still valid for this employee. */
async function verifyQrScan(
  qrSessionToken: string | null | undefined,
  employee: Employee,
  settings: AttendanceSettings
): Promise<{ ok: true; qrCodeId: string; qrSessionId: string; officeId: string } | AttendanceDenial> {
  if (!qrSessionToken) return { ok: false, reason: "QR_REQUIRED" };
  const sessionResult = await getActiveQrSession(qrSessionToken);
  if (!sessionResult.ok) return { ok: false, reason: "QR_SESSION_INVALID" };
  const { session } = sessionResult;
  if (session.officeId !== employee.officeId && !settings.crossOfficeAttendance) {
    return { ok: false, reason: "QR_WRONG_OFFICE" };
  }
  return { ok: true, qrCodeId: session.qrCodeId, qrSessionId: session.id, officeId: session.officeId };
}

/** Checks the phone's reported position against the office the scanned QR belongs to. */
async function verifyLocation(officeId: string, rawLocation: unknown) {
  const office = await prisma.office.findUniqueOrThrow({
    where: { id: officeId },
    select: { latitude: true, longitude: true, locationRadiusMeters: true },
  });
  const reading = locationReadingSchema.safeParse(rawLocation);
  return checkOfficeLocation(office, reading.success ? reading.data : null);
}

async function verifyNetwork(employee: Employee, sourceIp: string) {
  const netResult = await verifyOfficeNetwork(employee.officeId, sourceIp);
  if (!netResult.allowed && (netResult.reason === "STALE_FAIL_CLOSED" || netResult.reason === "IP_NOT_AUTHORIZED")) {
    await alertSuperAdminsOfNetworkDenial(employee.officeId, netResult.reason);
  }
  return netResult;
}

/**
 * Proves the employee is at the office, the way the attendance mode says to:
 *  - NETWORK_ONLY: on the office network.
 *  - QR_AND_NETWORK: a fresh QR scan and the office network.
 *  - QR_ONLY: a QR scan and a phone location inside the office radius.
 *  - NETWORK_WITH_QR_BACKUP: the office network; failing that, while the backup is
 *    on (network agent offline, or switched on by an admin), a QR scan and location.
 * Nothing is written here, so any denial — including a vague location reading — can
 * simply be retried, and the QR session stays usable until a record is saved.
 */
async function verifyPresence(
  employee: Employee,
  settings: AttendanceSettings,
  input: RecordAttendanceInput
): Promise<PresenceResult> {
  const none = { qrCodeId: null, qrSessionId: null, officeNetworkId: null, location: null };

  switch (settings.attendanceMode) {
    case "NETWORK_ONLY": {
      const net = await verifyNetwork(employee, input.sourceIp);
      if (!net.allowed) return { ok: false, reason: "NETWORK_DENIED" };
      return { ok: true, verificationMethod: "NETWORK", ...none, officeNetworkId: net.officeNetworkId };
    }

    case "QR_AND_NETWORK": {
      const qr = await verifyQrScan(input.qrSessionToken, employee, settings);
      if (!qr.ok) return qr;
      const net = await verifyNetwork(employee, input.sourceIp);
      if (!net.allowed) return { ok: false, reason: "NETWORK_DENIED" };
      return {
        ok: true,
        verificationMethod: "QR_NETWORK",
        ...none,
        qrCodeId: qr.qrCodeId,
        qrSessionId: qr.qrSessionId,
        officeNetworkId: net.officeNetworkId,
      };
    }

    case "QR_ONLY": {
      const qr = await verifyQrScan(input.qrSessionToken, employee, settings);
      if (!qr.ok) return qr;
      const location = await verifyLocation(qr.officeId, input.location);
      if (!location.ok) return { ...location };
      return { ok: true, verificationMethod: "QR_LOCATION", ...none, qrCodeId: qr.qrCodeId, qrSessionId: qr.qrSessionId, location };
    }

    case "NETWORK_WITH_QR_BACKUP": {
      // Not verifyNetwork(): failing the network check is the normal way into the
      // backup, so Super Admins are only alerted if the backup can't help either.
      const net = await verifyOfficeNetwork(employee.officeId, input.sourceIp);
      if (net.allowed) {
        return { ok: true, verificationMethod: "NETWORK", ...none, officeNetworkId: net.officeNetworkId };
      }

      if (!input.qrSessionToken) {
        const backup = await getQrBackupState(employee.officeId, settings.networkStaleThresholdMinutes);
        if (backup.active) return { ok: false, reason: "USE_QR_BACKUP" };
        if (net.reason === "STALE_FAIL_CLOSED" || net.reason === "IP_NOT_AUTHORIZED") {
          await alertSuperAdminsOfNetworkDenial(employee.officeId, net.reason);
        }
        return { ok: false, reason: "NETWORK_DENIED" };
      }

      const qr = await verifyQrScan(input.qrSessionToken, employee, settings);
      if (!qr.ok) return qr;
      // The backup that matters is the one for the office the poster hangs in.
      const backup = await getQrBackupState(qr.officeId, settings.networkStaleThresholdMinutes);
      if (!backup.active) return { ok: false, reason: "QR_BACKUP_INACTIVE" };
      const location = await verifyLocation(qr.officeId, input.location);
      if (!location.ok) return { ...location };
      return { ok: true, verificationMethod: "QR_LOCATION", ...none, qrCodeId: qr.qrCodeId, qrSessionId: qr.qrSessionId, location };
    }
  }
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
  const presence = await verifyPresence(employee, settings, input);
  if (!presence.ok) return presence;
  const { verificationMethod, qrCodeId, qrSessionId, officeNetworkId, location } = presence;

  const now = new Date();
  const attendanceDate = getAttendanceDateKey(now, settings.timezone);

  const existing = await prisma.attendanceRecord.findUnique({
    where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate } },
  });

  if (existing?.clockOut) {
    return { ok: false, reason: "ALREADY_COMPLETE" };
  }

  // A clock-out always carries the task report, so a bare repeat moments after
  // clocking in is a retried clock-in (the first response was lost on a weak
  // connection, a double tap, a second browser) — answer it as the clock-in it
  // already was rather than starting a clock-out the employee never asked for.
  if (
    existing?.clockIn &&
    input.tasks == null &&
    input.noTasksReason == null &&
    now.getTime() - existing.clockIn.getTime() < CLOCK_IN_REPEAT_WINDOW_MINUTES * 60_000
  ) {
    return { ok: true, action: "CLOCK_IN", record: existing, firstName: employee.firstName, alreadyClockedIn: true };
  }

  try {
    if (!existing) {
      const holiday = await prisma.holiday.findUnique({ where: { date: attendanceDate } });
      const classification = classifyClockIn(
        now,
        { ...settings, workStart: employee.workStart ?? settings.workStart },
        { isWeekendDay: isWeekend(now, settings.timezone), isHoliday: !!holiday && holiday.isActive }
      );

      let record: AttendanceRecord;
      try {
        record = await prisma.attendanceRecord.create({
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
          clockInDistanceMeters: location?.distanceMeters ?? null,
          clockInLocationAccuracyMeters: location?.accuracyMeters ?? null,
        },
      });
      } catch (err) {
        // Two clock-ins raced (double tap, two tabs/browsers) and the other one won —
        // it's already recorded, so this is the same clock-in, not a new one.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          const winner = await prisma.attendanceRecord.findUnique({
            where: { employeeId_attendanceDate: { employeeId: employee.id, attendanceDate } },
          });
          if (winner && !winner.clockOut) {
            return { ok: true, action: "CLOCK_IN", record: winner, firstName: employee.firstName, alreadyClockedIn: true };
          }
        }
        throw err;
      }

      if (qrSessionId) await consumeQrSession(qrSessionId);
      await flagDeviceReuseIfNeeded({
        deviceId: input.deviceId ?? null,
        employeeId: employee.id,
        attendanceRecordId: record.id,
      });
      return { ok: true, action: "CLOCK_IN", record, firstName: employee.firstName };
    }

    // The daily task report is checked before the early-departure reason, so the
    // employee fills it in first; the reason (if needed) is a separate follow-up step.
    if (input.tasks == null && input.noTasksReason == null) {
      return { ok: false, reason: "TASK_REPORT_REQUIRED" };
    }
    const report = parseDailyReport(input.tasks, input.noTasksReason);
    if (!report) {
      return { ok: false, reason: "TASK_REPORT_INVALID" };
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
    // One transaction: the clock-out only commits if the task report saved, and a
    // failed report leaves the record clocked-in so the employee can simply retry.
    const record = await prisma.$transaction(async (tx) => {
      await tx.dailyTaskReport.create({
        data: {
          attendanceRecordId: existing.id,
          employeeId: employee.id,
          attendanceDate: existing.attendanceDate,
          noTasksReason: report.noTasksReason,
          tasks: {
            create: report.tasks.map((task, position) => ({ position, description: task.description, status: task.status })),
          },
        },
      });
      return tx.attendanceRecord.update({
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
          clockOutDistanceMeters: location?.distanceMeters ?? null,
          clockOutLocationAccuracyMeters: location?.accuracyMeters ?? null,
          totalMinutesWorked,
        },
      });
    });

    if (qrSessionId) await consumeQrSession(qrSessionId);
    return { ok: true, action: "CLOCK_OUT", record, firstName: employee.firstName, tasksReported: report.tasks.length };
  } catch (err) {
    // A concurrent duplicate clock-out lost the race against the report's unique constraint
    // (or a raced clock-in found the day already finished).
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { ok: false, reason: "ALREADY_COMPLETE" };
    }
    throw err;
  }
}
