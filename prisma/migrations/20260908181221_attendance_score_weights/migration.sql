-- AlterTable
ALTER TABLE "attendance_settings" ADD COLUMN     "earlyPoints" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "latePoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "onTimePoints" INTEGER NOT NULL DEFAULT 3;
