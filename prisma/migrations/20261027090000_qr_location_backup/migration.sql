-- QR + location attendance: office location/radius, a manual backup switch,
-- the new mode and verification method, and per-record distance/accuracy.
ALTER TYPE "AttendanceMode" ADD VALUE 'NETWORK_WITH_QR_BACKUP';
ALTER TYPE "VerificationMethod" ADD VALUE 'QR_LOCATION';

ALTER TABLE "offices"
  ADD COLUMN "latitude" DOUBLE PRECISION,
  ADD COLUMN "longitude" DOUBLE PRECISION,
  ADD COLUMN "locationRadiusMeters" INTEGER NOT NULL DEFAULT 150,
  ADD COLUMN "qrBackupUntil" TIMESTAMP(3);

ALTER TABLE "attendance_records"
  ADD COLUMN "clockInDistanceMeters" INTEGER,
  ADD COLUMN "clockInLocationAccuracyMeters" INTEGER,
  ADD COLUMN "clockOutDistanceMeters" INTEGER,
  ADD COLUMN "clockOutLocationAccuracyMeters" INTEGER;
