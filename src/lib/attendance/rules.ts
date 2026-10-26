import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import type { AttendanceSettings, ClockInStatus, ClockOutStatus, AttendanceType } from "@prisma/client";

/** The employee's calendar date in the office timezone, as a UTC-midnight Date (for the `@db.Date` column). */
export function getAttendanceDateKey(instant: Date, timezone: string): Date {
  const ymd = formatInTimeZone(instant, timezone, "yyyy-MM-dd");
  return new Date(`${ymd}T00:00:00.000Z`);
}

/** `instant` as an `<input type="datetime-local">` value ("2026-10-26T09:00"), in the office timezone. */
export function toDateTimeLocalValue(instant: Date | null, timezone: string): string {
  return instant ? formatInTimeZone(instant, timezone, "yyyy-MM-dd'T'HH:mm") : "";
}

/**it
 * Parses an `<input type="datetime-local">` value as wall-clock time in the office
 * timezone. The value carries no offset, so `new Date(value)` would read it in
 * whatever zone the parsing machine happens to be in — UTC on the server, which
 * stored an admin's 09:00 (Lagos) as 10:00. Returns null if the value is malformed.
 */
export function fromDateTimeLocalValue(value: string, timezone: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null;
  const instant = fromZonedTime(value, timezone);
  return Number.isNaN(instant.getTime()) ? null : instant;
}

export function isWeekend(instant: Date, timezone: string): boolean {
  const dow = Number(formatInTimeZone(instant, timezone, "i")); // 1=Mon..7=Sun (ISO)
  return dow === 6 || dow === 7;
}

/** Scheduled start time, expressed as an absolute instant on the given calendar day. */
function scheduledInstant(dateKey: Date, hhmm: string, timezone: string): Date {
  const ymd = formatInTimeZone(dateKey, "UTC", "yyyy-MM-dd");
  return fromZonedTime(`${ymd}T${hhmm}:00`, timezone);
}

export interface ClockInClassification {
  status: ClockInStatus;
  minutesLate: number;
  attendanceType: AttendanceType;
}

export function classifyClockIn(
  clockInInstant: Date,
  settings: Pick<AttendanceSettings, "timezone" | "workStart" | "gracePeriodMinutes">,
  opts: { isWeekendDay: boolean; isHoliday: boolean }
): ClockInClassification {
  const dateKey = getAttendanceDateKey(clockInInstant, settings.timezone);
  const scheduledStart = scheduledInstant(dateKey, settings.workStart, settings.timezone);
  const graceEnd = new Date(scheduledStart.getTime() + settings.gracePeriodMinutes * 60_000);

  const diffMinutes = Math.round((clockInInstant.getTime() - scheduledStart.getTime()) / 60_000);

  let status: ClockInStatus;
  let minutesLate = 0;
  if (clockInInstant.getTime() < scheduledStart.getTime()) {
    status = "EARLY";
  } else if (clockInInstant.getTime() <= graceEnd.getTime()) {
    status = "ON_TIME";
  } else {
    status = "LATE";
    minutesLate = diffMinutes;
  }

  const attendanceType: AttendanceType = opts.isHoliday
    ? "HOLIDAY_OVERTIME"
    : opts.isWeekendDay
      ? "WEEKEND_OVERTIME"
      : "REGULAR";

  return { status, minutesLate, attendanceType };
}

export function calculateMinutesWorked(clockIn: Date, clockOut: Date): number {
  return Math.max(0, Math.round((clockOut.getTime() - clockIn.getTime()) / 60_000));
}

/** Clocking out before the scheduled end of day is EARLY (and requires a reason —
 * see engine.ts); anything at/after workEnd is ON_TIME regardless of how late it is. */
export function classifyClockOut(
  clockOutInstant: Date,
  settings: Pick<AttendanceSettings, "timezone" | "workEnd">
): ClockOutStatus {
  const dateKey = getAttendanceDateKey(clockOutInstant, settings.timezone);
  const scheduledEnd = scheduledInstant(dateKey, settings.workEnd, settings.timezone);
  return clockOutInstant.getTime() < scheduledEnd.getTime() ? "EARLY" : "ON_TIME";
}

export const MAX_EARLY_CLOCKOUT_REASON_WORDS = 50;

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}
