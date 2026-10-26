import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CorrectionForm } from "./CorrectionForm";
import { reviewDeviceFlagAction } from "@/lib/actions/deviceFlags";
import { PageHeader } from "@/components/admin/PageHeader";
import { TaskReportTasks } from "@/components/admin/TaskReportTasks";
import { requireUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { getAttendanceSettings } from "@/lib/attendance/settings";
import { formatInTimeZone } from "date-fns-tz";

/** Correction history stores times as ISO instants — show them as office time. */
function formatCorrectionValue(field: string, value: string | null, timezone: string): string {
  if (!value) return "—";
  if (field !== "clockIn" && field !== "clockOut") return value;
  const instant = new Date(value);
  return Number.isNaN(instant.getTime()) ? value : formatInTimeZone(instant, timezone, "d MMM yyyy, h:mm a");
}

/** "42 m from the office (±15 m)" for a QR + location clock-in/out, else null. */
function locationNote(distance: number | null, accuracy: number | null): string | null {
  if (distance == null) return null;
  return `${distance} m from the office${accuracy != null ? ` (±${accuracy} m)` : ""}`;
}

export const dynamic = "force-dynamic";

export default async function AttendanceCorrectionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  // HR/Viewer can see attendance but not task reports — only load it for roles that may.
  const canViewTaskReport = hasPermission(user.role, "taskReports", "view");
  const record = await prisma.attendanceRecord.findUnique({
    where: { id },
    include: {
      employee: true,
      office: true,
      corrections: { include: { changedBy: true }, orderBy: { changedAt: "desc" } },
      deviceFlags: { include: { previousEmployee: true, reviewedBy: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!record) notFound();
  const { timezone } = await getAttendanceSettings();
  const taskReport = canViewTaskReport
    ? await prisma.dailyTaskReport.findUnique({
        where: { attendanceRecordId: record.id },
        include: { tasks: { orderBy: { position: "asc" } } },
      })
    : null;

  return (
    <>
      <PageHeader backHref="/admin/attendance" backLabel="Back to attendance">
        <h1 className="text-2xl font-bold">
          {record.employee.firstName} {record.employee.lastName} — {record.attendanceDate.toISOString().slice(0, 10)}
        </h1>
        <p className="text-sm text-muted-foreground">{record.office.name}</p>
        {record.clockInDistanceMeters != null || record.clockOutDistanceMeters != null ? (
          <p className="text-sm text-muted-foreground">
            QR + location —{" "}
            {[
              locationNote(record.clockInDistanceMeters, record.clockInLocationAccuracyMeters) &&
                `clock-in ${locationNote(record.clockInDistanceMeters, record.clockInLocationAccuracyMeters)}`,
              locationNote(record.clockOutDistanceMeters, record.clockOutLocationAccuracyMeters) &&
                `clock-out ${locationNote(record.clockOutDistanceMeters, record.clockOutLocationAccuracyMeters)}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        ) : null}
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      {record.clockOutStatus === "EARLY" ? (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardHeader>
            <CardTitle className="text-amber-800">Clocked out early</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            <p>&ldquo;{record.earlyClockOutReason}&rdquo;</p>
          </CardContent>
        </Card>
      ) : null}
      {canViewTaskReport && record.clockIn ? (
        <Card>
          <CardHeader>
            <CardTitle>What they worked on</CardTitle>
          </CardHeader>
          <CardContent>
            {taskReport ? (
              <TaskReportTasks tasks={taskReport.tasks} noTasksReason={taskReport.noTasksReason} />
            ) : (
              <p className="text-sm text-muted-foreground">
                {record.clockOut
                  ? "No task report — this clock-out was recorded without one (before reports were required, or added by an admin)."
                  : "Not submitted yet — the report is filled in when the employee clocks out."}
              </p>
            )}
          </CardContent>
        </Card>
      ) : null}
      {record.deviceFlags.length > 0 ? (
        <Card className="border-red-300 bg-red-50/60">
          <CardHeader>
            <CardTitle className="text-red-800">🚩 Device flag</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {record.deviceFlags.map((flag) => (
              <div key={flag.id} className="space-y-1 text-sm">
                <p>
                  This device was last used to clock in as{" "}
                  <strong>
                    {flag.previousEmployee.firstName} {flag.previousEmployee.lastName}
                  </strong>{" "}
                  before clocking in here as <strong>{record.employee.firstName}</strong>.
                </p>
                <p className="text-xs text-muted-foreground">{flag.createdAt.toLocaleString()}</p>
                {flag.reviewed ? (
                  <p className="text-xs text-green-700">
                    Reviewed by {flag.reviewedBy?.fullName ?? "—"} on {flag.reviewedAt?.toLocaleString()}
                    {flag.reviewNote ? ` — "${flag.reviewNote}"` : ""}
                  </p>
                ) : (
                  <form action={reviewDeviceFlagAction.bind(null, flag.id)} className="flex items-end gap-2 pt-1">
                    <input
                      name="note"
                      className="h-9 w-64 rounded-md border border-input bg-background px-2 text-sm"
                      placeholder="Note (optional)"
                    />
                    <button
                      type="submit"
                      className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground"
                    >
                      Mark reviewed
                    </button>
                    <Link href="/admin/device-flags" className="text-xs text-primary hover:underline">
                      View all flags
                    </Link>
                  </form>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Correct record</CardTitle>
        </CardHeader>
        <CardContent>
          <CorrectionForm record={record} timezone={timezone} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Correction history</CardTitle>
        </CardHeader>
        <CardContent>
          {record.corrections.length === 0 ? (
            <p className="text-sm text-muted-foreground">No corrections yet.</p>
          ) : (
            <ul className="space-y-3 text-sm">
              {record.corrections.map((c) => (
                <li key={c.id} className="border-b pb-2 last:border-0">
                  <p>
                    <strong>{c.field}</strong>: {formatCorrectionValue(c.field, c.originalValue, timezone)} →{" "}
                    {formatCorrectionValue(c.field, c.newValue, timezone)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {c.changedBy.fullName} · {formatInTimeZone(c.changedAt, timezone, "d MMM yyyy, h:mm a")} · {c.reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      </div>
    </>
  );
}
