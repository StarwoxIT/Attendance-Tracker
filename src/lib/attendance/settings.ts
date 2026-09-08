import { prisma } from "@/lib/db/prisma";
import type { AttendanceSettings } from "@prisma/client";

const SINGLETON_ID = "singleton";

const DEFAULTS: Omit<AttendanceSettings, "id" | "updatedAt"> = {
  timezone: "Africa/Lagos",
  workStart: "09:00",
  gracePeriodMinutes: 15,
  workEnd: "17:00",
  attendanceMode: "QR_AND_NETWORK",
  weekendIsOvertime: true,
  holidayIsOvertime: true,
  qrSessionMinutes: 10,
  networkHeartbeatIntervalMinutes: 10,
  networkStaleThresholdMinutes: 30,
  kioskResetSeconds: 5,
  crossOfficeAttendance: false,
  earlyPoints: 5,
  onTimePoints: 3,
  latePoints: 0,
};

export async function getAttendanceSettings(): Promise<AttendanceSettings> {
  const existing = await prisma.attendanceSettings.findUnique({ where: { id: SINGLETON_ID } });
  if (existing) return existing;
  return prisma.attendanceSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...DEFAULTS },
    update: {},
  });
}

export async function updateAttendanceSettings(
  data: Partial<Omit<AttendanceSettings, "id" | "updatedAt">>
): Promise<AttendanceSettings> {
  return prisma.attendanceSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, ...DEFAULTS, ...data },
    update: data,
  });
}
