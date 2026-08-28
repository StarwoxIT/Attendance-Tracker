"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { addDays, addMonths, subDays } from "date-fns";
import { requirePermission } from "@/lib/auth/guard";
import { generateDailyQr, deactivateQr } from "@/lib/qr/manage";
import { getAttendanceDateKey } from "@/lib/attendance/rules";
import { prisma } from "@/lib/db/prisma";

async function actorIp(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const genSchema = z.object({
  officeId: z.string().min(1),
  date: z.string().min(1),
  duration: z.enum(["DAY", "WEEK", "MONTH"]).default("DAY"),
});

function endDateFor(startDateKey: Date, duration: "DAY" | "WEEK" | "MONTH"): Date {
  switch (duration) {
    case "WEEK":
      return addDays(startDateKey, 6);
    case "MONTH":
      return subDays(addMonths(startDateKey, 1), 1);
    case "DAY":
    default:
      return startDateKey;
  }
}

export interface GenerateQrActionResult {
  artifactsFailed: boolean;
}

export async function generateQrAction(formData: FormData): Promise<GenerateQrActionResult> {
  const user = await requirePermission("qr", "manage");
  const parsed = genSchema.parse(Object.fromEntries(formData));

  const office = await prisma.office.findUniqueOrThrow({ where: { id: parsed.officeId } });
  const dateKey = getAttendanceDateKey(new Date(`${parsed.date}T12:00:00Z`), office.timezone);
  const validUntilDate = endDateFor(dateKey, parsed.duration);

  const result = await generateDailyQr({
    officeId: parsed.officeId,
    attendanceDate: dateKey,
    validUntilDate,
    timezone: office.timezone,
    generatedById: user.id,
    actorIp: await actorIp(),
  });

  revalidatePath("/admin/qr");
  return { artifactsFailed: result.artifactsFailed ?? false };
}

export async function deactivateQrAction(qrId: string): Promise<void> {
  const user = await requirePermission("qr", "manage");
  await deactivateQr(qrId, user.id, await actorIp());
  revalidatePath("/admin/qr");
}
