/**
 * Companion to scripts/export-data.ts — loads its JSON output into the
 * database at DATABASE_URL, preserving original row IDs so every
 * relationship (Employee -> Office, AttendanceRecord -> Employee, etc.)
 * stays intact.
 *
 * Refuses to run against a database that already has any admin users,
 * unless --force is passed — this is a one-time migration into a fresh
 * deployment, not something that should silently duplicate data.
 *
 * Usage:
 *   DATABASE_URL="postgresql://...destination..." npx tsx scripts/import-data.ts <input.json> [--force]
 */
import { readFileSync } from "node:fs";
import { prisma } from "../src/lib/db/prisma";
import type { Prisma } from "@prisma/client";

interface ExportedData {
  companySettings: Prisma.CompanySettingsCreateManyInput[];
  attendanceSettings: Prisma.AttendanceSettingsCreateManyInput[];
  department: Prisma.DepartmentCreateManyInput[];
  office: Prisma.OfficeCreateManyInput[];
  user: Prisma.UserCreateManyInput[];
  employee: Prisma.EmployeeCreateManyInput[];
  employeeDeletionRequest: Prisma.EmployeeDeletionRequestCreateManyInput[];
  attendanceIdHistory: Prisma.AttendanceIdHistoryCreateManyInput[];
  officeNetwork: Prisma.OfficeNetworkCreateManyInput[];
  networkHeartbeat: Prisma.NetworkHeartbeatCreateManyInput[];
  holiday: Prisma.HolidayCreateManyInput[];
  attendanceQrCode: Prisma.AttendanceQrCodeCreateManyInput[];
  qrAttendanceSession: Prisma.QrAttendanceSessionCreateManyInput[];
  attendanceRecord: Prisma.AttendanceRecordCreateManyInput[];
  attendanceDeviceFlag: Prisma.AttendanceDeviceFlagCreateManyInput[];
  attendanceCorrection: Prisma.AttendanceCorrectionCreateManyInput[];
  notification: Prisma.NotificationCreateManyInput[];
  auditLog: Prisma.AuditLogCreateManyInput[];
}

async function main() {
  const inPath = process.argv[2];
  if (!inPath) {
    console.error("Usage: tsx scripts/import-data.ts <input.json> [--force]");
    process.exit(1);
  }
  const force = process.argv.includes("--force");

  const existingUsers = await prisma.user.count();
  if (existingUsers > 0 && !force) {
    console.error(
      `Target database already has ${existingUsers} user(s) — refusing to import to avoid duplicating/corrupting ` +
        `an existing deployment. Pass --force to override.`
    );
    process.exit(1);
  }

  console.log("Importing into:", process.env.DATABASE_URL?.replace(/:[^:@]+@/, ":***@"));
  const data = JSON.parse(readFileSync(inPath, "utf8")) as ExportedData;

  // CompanySettings/AttendanceSettings are fixed-id("singleton") rows the app
  // auto-creates with defaults on first-ever page load — which typically already
  // happened on the target before this script ever runs. createMany+skipDuplicates
  // would silently keep that default instead of the real imported values, so these
  // two use upsert instead, same as every other table stays createMany below.
  for (const row of data.companySettings) {
    await prisma.companySettings.upsert({ where: { id: row.id }, create: row, update: row });
  }
  for (const row of data.attendanceSettings) {
    await prisma.attendanceSettings.upsert({ where: { id: row.id }, create: row, update: row });
  }

  // Parent-before-child order, matching export-data.ts.
  await prisma.department.createMany({ data: data.department, skipDuplicates: true });
  await prisma.office.createMany({ data: data.office, skipDuplicates: true });
  await prisma.user.createMany({ data: data.user, skipDuplicates: true });
  await prisma.employee.createMany({ data: data.employee, skipDuplicates: true });
  await prisma.employeeDeletionRequest.createMany({ data: data.employeeDeletionRequest, skipDuplicates: true });
  await prisma.attendanceIdHistory.createMany({ data: data.attendanceIdHistory, skipDuplicates: true });
  await prisma.officeNetwork.createMany({ data: data.officeNetwork, skipDuplicates: true });
  await prisma.networkHeartbeat.createMany({ data: data.networkHeartbeat, skipDuplicates: true });
  await prisma.holiday.createMany({ data: data.holiday, skipDuplicates: true });
  await prisma.attendanceQrCode.createMany({ data: data.attendanceQrCode, skipDuplicates: true });
  await prisma.qrAttendanceSession.createMany({ data: data.qrAttendanceSession, skipDuplicates: true });
  await prisma.attendanceRecord.createMany({ data: data.attendanceRecord, skipDuplicates: true });
  await prisma.attendanceDeviceFlag.createMany({ data: data.attendanceDeviceFlag, skipDuplicates: true });
  await prisma.attendanceCorrection.createMany({ data: data.attendanceCorrection, skipDuplicates: true });
  await prisma.notification.createMany({ data: data.notification, skipDuplicates: true });
  await prisma.auditLog.createMany({ data: data.auditLog, skipDuplicates: true });

  for (const [table, rows] of Object.entries(data)) {
    console.log(`  ${table}: ${rows.length} row(s)`);
  }

  console.log("\nImport complete. Sessions were not migrated — everyone (including you) needs to log in fresh.");
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Import failed:", err);
  process.exit(1);
});
