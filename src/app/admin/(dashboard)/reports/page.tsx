import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { formatInTimeZone } from "date-fns-tz";
import { PageHeader } from "@/components/admin/PageHeader";
import { AttendanceReportForm } from "./AttendanceReportForm";
import { ExportButtons, Field } from "./reportFields";
import { requireUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { TASK_STATUS_LABELS, TASK_STATUSES } from "@/lib/attendance/taskReport";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const user = await requireUser();
  // HR/Viewer can export attendance but not task reports (the export route enforces this too).
  const canViewTaskReports = hasPermission(user.role, "taskReports", "view");
  const [offices, employees] = await Promise.all([
    prisma.office.findMany({ orderBy: { name: "asc" } }),
    prisma.employee.findMany({
      where: { isDeleted: false },
      orderBy: { firstName: "asc" },
      select: { id: true, firstName: true, lastName: true },
    }),
  ]);
  const currentMonth = formatInTimeZone(new Date(), "Africa/Lagos", "yyyy-MM");

  return (
    <>
      <PageHeader>
        <h1 className="text-2xl font-bold">Reports</h1>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      <Card>
        <CardHeader>
          <CardTitle>Attendance report</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Daily lists every attendance record in the date range; Monthly summarises each employee&apos;s month.
          </p>
          <AttendanceReportForm offices={offices.map((o) => ({ id: o.id, name: o.name }))} currentMonth={currentMonth} />
        </CardContent>
      </Card>

      {canViewTaskReports ? (
        <Card>
          <CardHeader>
            <CardTitle>Task report</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              What employees reported working on when clocking out — one row per person per day, with that day&apos;s
              tasks and their statuses grouped together.
            </p>
            <form action="/api/reports/tasks" className="flex flex-wrap items-end gap-2">
              <Field label="From"><Input type="date" name="from" /></Field>
              <Field label="To"><Input type="date" name="to" /></Field>
              <Field label="Office">
                <select name="officeId" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="">All</option>
                  {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select name="status" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                  <option value="">All</option>
                  {TASK_STATUSES.map((s) => <option key={s} value={s}>{TASK_STATUS_LABELS[s]}</option>)}
                  <option value="NONE">No tasks to report</option>
                </select>
              </Field>
              <ExportButtons />
            </form>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Performance report</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            Cumulative attendance score per employee for the period, ranked best to worst — the same scoring behind
            the Analytics dashboard, as one row per employee instead of a chart.
          </p>
          <form action="/api/reports/performance" className="flex flex-wrap items-end gap-2">
            <Field label="From"><Input type="date" name="from" /></Field>
            <Field label="To"><Input type="date" name="to" /></Field>
            <Field label="Office">
              <select name="officeId" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                <option value="">All</option>
                {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </Field>
            <ExportButtons />
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Employee attendance report</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            One row per day for the chosen employee: clock-in and clock-out times
            {canViewTaskReports ? ", with the tasks they reported and each task's status" : ""}.
          </p>
          <form action="/api/reports/employee" className="flex flex-wrap items-end gap-2">
            <Field label="Employee">
              <select name="employeeId" required className="h-9 rounded-md border border-input bg-background px-2 text-sm">
                {employees.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.firstName} {e.lastName}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="From"><Input type="date" name="from" /></Field>
            <Field label="To"><Input type="date" name="to" /></Field>
            <ExportButtons />
          </form>
        </CardContent>
      </Card>
      </div>
    </>
  );
}
