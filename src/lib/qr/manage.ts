import { prisma } from "@/lib/db/prisma";
import { fromZonedTime, formatInTimeZone } from "date-fns-tz";
import { generateQrToken } from "./token";
import { generateQrPdf, generateQrPngDataUrl } from "./pdf";
import { uploadGeneratedBuffer } from "@/lib/storage/blob";
import { getCompanySettings } from "@/lib/company/settings";
import { recordAuditLog } from "@/lib/audit/log";
import type { AttendanceQrCode } from "@prisma/client";

/** validFrom = start of startDateKey; validUntil = end of endDateKey. Passing the
 * same key for both (the common case) yields the original single-day window. */
function rangeBounds(startDateKey: Date, endDateKey: Date, timezone: string) {
  const startYmd = formatInTimeZone(startDateKey, "UTC", "yyyy-MM-dd");
  const endYmd = formatInTimeZone(endDateKey, "UTC", "yyyy-MM-dd");
  const validFrom = fromZonedTime(`${startYmd}T00:00:00`, timezone);
  const validUntil = fromZonedTime(`${endYmd}T23:59:59.999`, timezone);
  return { validFrom, validUntil };
}

function computeStatus(validFrom: Date, validUntil: Date, now: Date): "SCHEDULED" | "ACTIVE" | "EXPIRED" {
  if (now < validFrom) return "SCHEDULED";
  if (now > validUntil) return "EXPIRED";
  return "ACTIVE";
}

export interface GenerateQrParams {
  officeId: string;
  attendanceDate: Date; // UTC-midnight date key — start of the validity window
  /** End of the validity window (inclusive, UTC-midnight date key). Defaults to
   * attendanceDate for a single-day QR. */
  validUntilDate?: Date;
  timezone: string;
  generatedById: string;
  actorIp?: string | null;
}

export interface GenerateQrResult {
  qrCode: AttendanceQrCode;
  rawToken: string;
  /** True when PDF/PNG rendering or upload failed — the QR itself is still valid for
   * clock-in, but there's nothing to print. Almost always an object-storage
   * misconfiguration (STORAGE_DRIVER and its related env vars); see the console.error
   * this logs for the actual cause. */
  artifactsFailed?: boolean;
}

/** Generates (or regenerates) the QR code for an office over a date range (a single day by
 * default), deactivating any prior live code whose window overlaps the new one. */
export async function generateDailyQr(params: GenerateQrParams): Promise<GenerateQrResult> {
  const { officeId, attendanceDate, generatedById, actorIp } = params;
  const timezone = params.timezone;
  const validUntilDate = params.validUntilDate ?? attendanceDate;
  const { validFrom, validUntil } = rangeBounds(attendanceDate, validUntilDate, timezone);
  const now = new Date();
  const { rawToken, tokenHash, tokenIdentifier } = generateQrToken();

  const qrCode = await prisma.$transaction(async (tx) => {
    // Overlap check, not exact-match: a new range deactivates any existing live QR
    // whose window intersects it at all (attendanceDate <= our end AND its own
    // validUntil >= our start), covering single-day and multi-day ranges alike.
    const candidates = await tx.attendanceQrCode.findMany({
      where: { officeId, status: { in: ["SCHEDULED", "ACTIVE"] }, attendanceDate: { lte: validUntilDate } },
    });
    const existingLive = candidates.filter((qr) => qr.validUntil >= validFrom);

    for (const old of existingLive) {
      await tx.attendanceQrCode.update({
        where: { id: old.id },
        data: { status: "DEACTIVATED", deactivatedById: generatedById, deactivatedAt: now },
      });
      await tx.qrAttendanceSession.updateMany({
        where: { qrCodeId: old.id, status: "ACTIVE" },
        data: { status: "EXPIRED" },
      });
    }

    return tx.attendanceQrCode.create({
      data: {
        officeId,
        attendanceDate,
        tokenHash,
        tokenIdentifier,
        validFrom,
        validUntil,
        status: computeStatus(validFrom, validUntil, now),
        generatedById,
      },
    });
  });

  await recordAuditLog({
    userId: generatedById,
    action: "qr.generate",
    resource: "attendance_qr_code",
    resourceId: qrCode.id,
    newValue: { officeId, attendanceDate: attendanceDate.toISOString(), tokenIdentifier },
    ipAddress: actorIp ?? null,
  });

  // The QR code itself (the security-critical part employees' clock-ins depend on) is
  // already durably created above. Rendering/uploading the printable PDF/PNG is a
  // supplementary convenience — if object storage is briefly unavailable, generation
  // still succeeds with pdfUrl/pngUrl left null; the admin UI already handles that
  // (no broken download links) and can retry via Regenerate.
  try {
    const withArtifacts = await renderAndStoreQrArtifacts(qrCode, rawToken);
    return { qrCode: withArtifacts, rawToken };
  } catch (err) {
    console.error(
      `QR artifact rendering/upload failed (STORAGE_DRIVER=${process.env.STORAGE_DRIVER ?? "unset"}); QR code is still valid without PDF/PNG.`,
      err
    );
    return { qrCode, rawToken, artifactsFailed: true };
  }
}

/** Renders the PDF/PNG once at generation time and stores them — see the pdfUrl/pngUrl schema comment for why. */
async function renderAndStoreQrArtifacts(qrCode: AttendanceQrCode, rawToken: string): Promise<AttendanceQrCode> {
  const [company, office] = await Promise.all([
    getCompanySettings(),
    prisma.office.findUniqueOrThrow({ where: { id: qrCode.officeId } }),
  ]);
  const appUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

  const [pdfBuffer, pngDataUrl] = await Promise.all([
    generateQrPdf({
      companyName: company.companyName,
      logoUrl: company.logoUrl,
      officeName: office.name,
      attendanceDate: qrCode.attendanceDate,
      validUntil: qrCode.validUntil,
      timezone: office.timezone,
      rawToken,
      appUrl,
    }),
    generateQrPngDataUrl(rawToken, appUrl),
  ]);

  const pngBuffer = Buffer.from(pngDataUrl.split(",")[1]!, "base64");
  const base = `qr-codes/${qrCode.officeId}/${qrCode.id}`;

  const [pdfUpload, pngUpload] = await Promise.all([
    uploadGeneratedBuffer(`${base}.pdf`, pdfBuffer, "application/pdf"),
    uploadGeneratedBuffer(`${base}.png`, pngBuffer, "image/png"),
  ]);

  return prisma.attendanceQrCode.update({
    where: { id: qrCode.id },
    data: { pdfUrl: pdfUpload.url, pngUrl: pngUpload.url },
  });
}

export async function deactivateQr(qrId: string, userId: string, actorIp?: string | null): Promise<void> {
  const qr = await prisma.attendanceQrCode.update({
    where: { id: qrId },
    data: { status: "DEACTIVATED", deactivatedById: userId, deactivatedAt: new Date() },
  });
  await prisma.qrAttendanceSession.updateMany({
    where: { qrCodeId: qrId, status: "ACTIVE" },
    data: { status: "EXPIRED" },
  });
  await recordAuditLog({
    userId,
    action: "qr.deactivate",
    resource: "attendance_qr_code",
    resourceId: qr.id,
    ipAddress: actorIp ?? null,
  });
}

/** Lazily refreshes SCHEDULED->ACTIVE->EXPIRED transitions; also invoked by the Vercel Cron job. */
export async function sweepQrStatuses(): Promise<number> {
  const now = new Date();
  const [activated, expired] = await prisma.$transaction([
    prisma.attendanceQrCode.updateMany({
      where: { status: "SCHEDULED", validFrom: { lte: now }, validUntil: { gte: now } },
      data: { status: "ACTIVE" },
    }),
    prisma.attendanceQrCode.updateMany({
      where: { status: { in: ["SCHEDULED", "ACTIVE"] }, validUntil: { lt: now } },
      data: { status: "EXPIRED" },
    }),
  ]);
  return activated.count + expired.count;
}
