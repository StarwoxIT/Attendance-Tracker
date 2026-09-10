import { formatInTimeZone } from "date-fns-tz";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface DateRangeStrings {
  from: string;
  to: string;
}

function dateKeyFromYmd(ymd: string): Date {
  return new Date(`${ymd}T00:00:00.000Z`);
}

function toYmd(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function todayRange(timezone: string): DateRangeStrings {
  const today = formatInTimeZone(new Date(), timezone, "yyyy-MM-dd");
  return { from: today, to: today };
}

/** Monday-to-Sunday week containing "today" in the given timezone. Uses plain
 * millisecond arithmetic on UTC-midnight date keys (matching getAttendanceDateKey's
 * convention) so it stays correct regardless of the server process's own timezone. */
export function thisWeekRange(timezone: string): DateRangeStrings {
  const todayKey = dateKeyFromYmd(formatInTimeZone(new Date(), timezone, "yyyy-MM-dd"));
  const isoDay = Number(formatInTimeZone(todayKey, "UTC", "i")); // 1=Mon..7=Sun
  const start = new Date(todayKey.getTime() - (isoDay - 1) * DAY_MS);
  const end = new Date(todayKey.getTime() + (7 - isoDay) * DAY_MS);
  return { from: toYmd(start), to: toYmd(end) };
}

export function monthRange(monthStr: string): DateRangeStrings {
  const [year, month] = monthStr.split("-").map(Number);
  const start = new Date(Date.UTC(year!, month! - 1, 1));
  const end = new Date(Date.UTC(year!, month!, 0)); // day 0 of next month = last day of this month
  return { from: toYmd(start), to: toYmd(end) };
}

export function thisMonthRange(timezone: string): DateRangeStrings {
  return monthRange(formatInTimeZone(new Date(), timezone, "yyyy-MM"));
}
