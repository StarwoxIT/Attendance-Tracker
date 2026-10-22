-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('COMPLETED', 'PARTIALLY_COMPLETED', 'CARRIED_OVER');

-- CreateTable
CREATE TABLE "daily_task_reports" (
    "id" TEXT NOT NULL,
    "attendanceRecordId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "attendanceDate" DATE NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_task_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_tasks" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "status" "TaskStatus" NOT NULL,

    CONSTRAINT "daily_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_task_reports_attendanceRecordId_key" ON "daily_task_reports"("attendanceRecordId");

-- CreateIndex
CREATE INDEX "daily_task_reports_attendanceDate_idx" ON "daily_task_reports"("attendanceDate");

-- CreateIndex
CREATE INDEX "daily_task_reports_employeeId_attendanceDate_idx" ON "daily_task_reports"("employeeId", "attendanceDate");

-- CreateIndex
CREATE INDEX "daily_tasks_reportId_idx" ON "daily_tasks"("reportId");

-- CreateIndex
CREATE INDEX "daily_tasks_status_idx" ON "daily_tasks"("status");

-- AddForeignKey
ALTER TABLE "daily_task_reports" ADD CONSTRAINT "daily_task_reports_attendanceRecordId_fkey" FOREIGN KEY ("attendanceRecordId") REFERENCES "attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_task_reports" ADD CONSTRAINT "daily_task_reports_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_tasks" ADD CONSTRAINT "daily_tasks_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "daily_task_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
