-- Attendance modes narrowed to two: Network mode (NETWORK_ONLY) and QR + location
-- mode (QR_ONLY). QR_AND_NETWORK and the network-with-QR-backup mode both relied on
-- the office network, so a deployment on either becomes Network mode.
UPDATE "attendance_settings"
SET "attendanceMode" = 'NETWORK_ONLY'
WHERE "attendanceMode" IN ('QR_AND_NETWORK', 'NETWORK_WITH_QR_BACKUP');

ALTER TYPE "AttendanceMode" RENAME TO "AttendanceMode_old";
CREATE TYPE "AttendanceMode" AS ENUM ('NETWORK_ONLY', 'QR_ONLY');
ALTER TABLE "attendance_settings" ALTER COLUMN "attendanceMode" DROP DEFAULT;
ALTER TABLE "attendance_settings"
  ALTER COLUMN "attendanceMode" TYPE "AttendanceMode" USING ("attendanceMode"::text::"AttendanceMode");
ALTER TABLE "attendance_settings" ALTER COLUMN "attendanceMode" SET DEFAULT 'NETWORK_ONLY';
DROP TYPE "AttendanceMode_old";

-- The manual "switch on QR backup for today" setting went with that mode.
ALTER TABLE "offices" DROP COLUMN "qrBackupUntil";
