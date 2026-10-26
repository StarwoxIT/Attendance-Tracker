"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/guard";
import { recordAuditLog } from "@/lib/audit/log";
import { calculateMinutesWorked, fromDateTimeLocalValue } from "@/lib/attendance/rules";
import { getAttendanceSettings } from "@/lib/attendance/settings";

async function actorIp(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const correctionSchema = z.object({
  clockIn: z.string().optional().or(z.literal("")),
  clockOut: z.string().optional().or(z.literal("")),
  clockInStatus: z.string().optional().or(z.literal("")),
  attendanceType: z.string().optional().or(z.literal("")),
  reason: z.string().min(5, "Please provide a reason of at least 5 characters."),
});

export interface CorrectionState {
  error?: string;
  success?: boolean;
}

export async function correctAttendanceAction(
  recordId: string,
  _prev: CorrectionState,
  formData: FormData
): Promise<CorrectionState> {
  const user = await requirePermission("attendance", "manage");
  const parsed = correctionSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const [before, settings] = await Promise.all([
    prisma.attendanceRecord.findUniqueOrThrow({ where: { id: recordId } }),
    getAttendanceSettings(),
  ]);
  const ip = await actorIp();

  // The admin types office wall-clock times — read them in the office timezone,
  // not the server's (UTC in production).
  const enteredClockIn = parsed.data.clockIn ? fromDateTimeLocalValue(parsed.data.clockIn, settings.timezone) : null;
  const enteredClockOut = parsed.data.clockOut ? fromDateTimeLocalValue(parsed.data.clockOut, settings.timezone) : null;
  if ((parsed.data.clockIn && !enteredClockIn) || (parsed.data.clockOut && !enteredClockOut)) {
    return { error: "Enter a valid date and time." };
  }
  const newClockIn = enteredClockIn ?? before.clockIn;
  const newClockOut = enteredClockOut ?? before.clockOut;
  if (newClockIn && newClockOut && newClockOut <= newClockIn) {
    return { error: "Clock-out must be after clock-in." };
  }

  const changes: { field: string; oldValue: string | null; newValue: string | null }[] = [];
  if (parsed.data.clockIn && before.clockIn?.toISOString() !== newClockIn?.toISOString()) {
    changes.push({ field: "clockIn", oldValue: before.clockIn?.toISOString() ?? null, newValue: newClockIn?.toISOString() ?? null });
  }
  if (parsed.data.clockOut && before.clockOut?.toISOString() !== newClockOut?.toISOString()) {
    changes.push({ field: "clockOut", oldValue: before.clockOut?.toISOString() ?? null, newValue: newClockOut?.toISOString() ?? null });
  }
  if (parsed.data.clockInStatus && parsed.data.clockInStatus !== before.clockInStatus) {
    changes.push({ field: "clockInStatus", oldValue: before.clockInStatus, newValue: parsed.data.clockInStatus });
  }
  if (parsed.data.attendanceType && parsed.data.attendanceType !== before.attendanceType) {
    changes.push({ field: "attendanceType", oldValue: before.attendanceType, newValue: parsed.data.attendanceType });
  }

  if (changes.length === 0) return { error: "No changes were made." };

  const totalMinutesWorked =
    newClockIn && newClockOut ? calculateMinutesWorked(newClockIn, newClockOut) : before.totalMinutesWorked;

  await prisma.$transaction(async (tx) => {
    await tx.attendanceRecord.update({
      where: { id: recordId },
      data: {
        clockIn: newClockIn,
        clockOut: newClockOut,
        clockInStatus: (parsed.data.clockInStatus || before.clockInStatus) as never,
        attendanceType: (parsed.data.attendanceType || before.attendanceType) as never,
        totalMinutesWorked,
        manualAdjustment: true,
        verificationMethod: "MANUAL_ADMIN",
      },
    });

    for (const change of changes) {
      await tx.attendanceCorrection.create({
        data: {
          attendanceRecordId: recordId,
          changedById: user.id,
          field: change.field,
          originalValue: change.oldValue,
          newValue: change.newValue,
          reason: parsed.data.reason,
          ipAddress: ip,
        },
      });
    }
  });

  await recordAuditLog({
    userId: user.id,
    action: "attendance.corrected",
    resource: "attendance_record",
    resourceId: recordId,
    oldValue: changes.map((c) => ({ field: c.field, value: c.oldValue })),
    newValue: changes.map((c) => ({ field: c.field, value: c.newValue })),
    reason: parsed.data.reason,
    ipAddress: ip,
  });

  revalidatePath("/admin/attendance");
  revalidatePath(`/admin/attendance/${recordId}`);
  return { success: true };
}
