/**
 * One-time data migration: exports every real (non-ephemeral) row from the
 * source database to a single JSON file, for a full-fidelity copy into a
 * different Postgres instance (e.g. Neon -> a self-hosted server) without
 * depending on pg_dump/pg_restore binaries matching the server's major
 * version. Pair with scripts/import-data.ts.
 *
 * Deliberately skips `Session` (live login tokens — meaningless on a new
 * server, and copying them would let an old session cookie work against
 * the new deployment) and `RateLimitBucket` (transient counters, not data).
 *
 * Usage:
 *   DATABASE_URL="postgresql://...source..." npx tsx scripts/export-data.ts <output.json>
 */
import { writeFileSync } from "node:fs";
import { prisma } from "../src/lib/db/prisma";

async function main() {
  const outPath = process.argv[2];
  if (!outPath) {
    console.error("Usage: tsx scripts/export-data.ts <output.json>");
    process.exit(1);
  }

  console.log("Exporting from:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"));

  // Parents before children, matching the FK dependency graph in prisma/schema.prisma.
  const companySettings = await prisma.companySettings.findMany();
  const attendanceSettings = await prisma.attendanceSettings.findMany();
  const department = await prisma.department.findMany();
  const office = await prisma.office.findMany();
  const user = await prisma.user.findMany();
  const employee = await prisma.employee.findMany();
  const employeeDeletionRequest = await prisma.employeeDeletionRequest.findMany();
  const attendanceIdHistory = await prisma.attendanceIdHistory.findMany();
  const officeNetwork = await prisma.officeNetwork.findMany();
  const networkHeartbeat = await prisma.networkHeartbeat.findMany();
  const holiday = await prisma.holiday.findMany();
  const attendanceQrCode = await prisma.attendanceQrCode.findMany();
  const qrAttendanceSession = await prisma.qrAttendanceSession.findMany();
  const attendanceRecord = await prisma.attendanceRecord.findMany();
  const attendanceDeviceFlag = await prisma.attendanceDeviceFlag.findMany();
  const attendanceCorrection = await prisma.attendanceCorrection.findMany();
  const notification = await prisma.notification.findMany();
  const auditLog = await prisma.auditLog.findMany();

  const data = {
    companySettings,
    attendanceSettings,
    department,
    office,
    user,
    employee,
    employeeDeletionRequest,
    attendanceIdHistory,
    officeNetwork,
    networkHeartbeat,
    holiday,
    attendanceQrCode,
    qrAttendanceSession,
    attendanceRecord,
    attendanceDeviceFlag,
    attendanceCorrection,
    notification,
    auditLog,
  };

  for (const [table, rows] of Object.entries(data)) {
    console.log(`  ${table}: ${rows.length} row(s)`);
  }

  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\nWrote ${outPath}`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Export failed:", err);
  process.exit(1);
});
