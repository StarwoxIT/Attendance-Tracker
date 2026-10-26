import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/PageHeader";
import { requireUser } from "@/lib/auth/guard";
import { EditEmployeeForm } from "./EditEmployeeForm";
import { RegenerateIdButton } from "./RegenerateIdButton";
import { StatusButtons } from "./StatusButtons";
import { DeleteEmployeeForm } from "./DeleteEmployeeForm";
import { ReviewDeletionForm } from "../../deletion-requests/ReviewDeletionForm";
import { formatInTimeZone } from "date-fns-tz";
import { getAttendanceSettings } from "@/lib/attendance/settings";

export const dynamic = "force-dynamic";

export default async function EmployeeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const actor = await requireUser();

  const { timezone } = await getAttendanceSettings();
  const [employee, offices, departments, history, latestDeletionRequest] = await Promise.all([
    prisma.employee.findUnique({ where: { id }, include: { office: true, department: true } }),
    prisma.office.findMany({ orderBy: { name: "asc" } }),
    prisma.department.findMany({ orderBy: { name: "asc" } }),
    prisma.attendanceRecord.findMany({
      where: { employeeId: id },
      orderBy: { attendanceDate: "desc" },
      take: 15,
    }),
    prisma.employeeDeletionRequest.findFirst({
      where: { employeeId: id },
      orderBy: { createdAt: "desc" },
      include: { requestedBy: true, reviewedBy: true },
    }),
  ]);

  if (!employee) notFound();

  const pendingDeletion = latestDeletionRequest?.status === "PENDING" ? latestDeletionRequest : null;

  return (
    <>
      <PageHeader backHref="/admin/employees" backLabel="Back to employees">
        <h1 className="text-2xl font-bold">
          {employee.firstName} {employee.lastName}
        </h1>
        <p className="text-sm text-muted-foreground">
          {employee.employeeNumber} · {employee.office.name}
        </p>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      {employee.isDeleted ? (
        <Card className="border-red-300 bg-red-50/60">
          <CardContent className="pt-6 text-sm text-red-800">
            This employee was deleted on {employee.deletedAt?.toLocaleString()}. They can no longer clock in and
            are hidden from active lists, but their attendance history is preserved below.
          </CardContent>
        </Card>
      ) : pendingDeletion ? (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="text-sm text-amber-900">
              <p className="font-medium">Deletion requested — pending Super Admin approval</p>
              <p className="mt-1">
                By {pendingDeletion.requestedBy.fullName} on {pendingDeletion.createdAt.toLocaleString()}: &ldquo;
                {pendingDeletion.reason}&rdquo;
              </p>
            </div>
            {actor.role === "SUPER_ADMIN" ? <ReviewDeletionForm requestId={pendingDeletion.id} /> : null}
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <EditEmployeeForm employee={employee} offices={offices} departments={departments} />
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Employment status</CardTitle>
            </CardHeader>
            <CardContent>
              <StatusButtons employeeId={employee.id} current={employee.employmentStatus} disabled={employee.isDeleted} />
              {employee.employmentStatus !== "ACTIVE" ? (
                <p className="mt-2 text-xs text-amber-700">
                  Only ACTIVE employees can clock attendance.
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Attendance ID</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <p className="text-sm text-muted-foreground">
                The Attendance ID itself is never stored or displayed after creation — only a secure hash is kept.
                Regenerate it if the employee has lost their ID card.
              </p>
              <RegenerateIdButton employeeId={employee.id} disabled={employee.isDeleted} />
            </CardContent>
          </Card>

          {!employee.isDeleted && !pendingDeletion ? (
            <Card className="border-red-200">
              <CardHeader>
                <CardTitle className="text-red-700">Danger zone</CardTitle>
              </CardHeader>
              <CardContent>
                <DeleteEmployeeForm employeeId={employee.id} isSuperAdmin={actor.role === "SUPER_ADMIN"} />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent attendance</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="py-2 pr-4">Date</th>
                <th className="py-2 pr-4">Clock In</th>
                <th className="py-2 pr-4">Clock Out</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Type</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">{r.attendanceDate.toISOString().slice(0, 10)}</td>
                  <td className="py-2 pr-4">{r.clockIn ? formatInTimeZone(r.clockIn, timezone, "h:mm a") : "—"}</td>
                  <td className="py-2 pr-4">
                    {r.clockOut ? formatInTimeZone(r.clockOut, timezone, "h:mm a") : "—"}
                    {r.clockOutStatus === "EARLY" ? (
                      <span
                        className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                        title={r.earlyClockOutReason ?? undefined}
                      >
                        Early — {r.earlyClockOutReason}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-4">{r.clockInStatus ?? "—"}</td>
                  <td className="py-2 pr-4">{r.attendanceType}</td>
                </tr>
              ))}
              {history.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-muted-foreground">
                    No attendance records yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>
      </div>
    </>
  );
}
