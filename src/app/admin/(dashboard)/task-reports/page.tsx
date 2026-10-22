import Link from "next/link";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/guard";
import { getAttendanceSettings } from "@/lib/attendance/settings";
import { TASK_STATUS_LABELS, TASK_STATUSES } from "@/lib/attendance/taskReport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination } from "@/components/admin/Pagination";
import { PageSizeSelect } from "@/components/admin/PageSizeSelect";
import { TaskReportTasks } from "@/components/admin/TaskReportTasks";
import { resolvePage, resolvePageSize } from "@/lib/pagination";
import type { Prisma, TaskStatus } from "@prisma/client";

export const dynamic = "force-dynamic";

export default async function TaskReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    q?: string;
    officeId?: string;
    status?: string;
    page?: string;
    pageSize?: string;
  }>;
}) {
  await requirePermission("taskReports", "view");

  const { from, to, q, officeId, status, page, pageSize: pageSizeParam } = await searchParams;
  const pageNum = resolvePage(page);
  const pageSize = resolvePageSize(pageSizeParam);
  const taskStatus = TASK_STATUSES.includes(status as TaskStatus) ? (status as TaskStatus) : undefined;

  const where: Prisma.DailyTaskReportWhereInput = {};
  if (from || to) {
    where.attendanceDate = {};
    if (from) where.attendanceDate.gte = new Date(`${from}T00:00:00Z`);
    if (to) where.attendanceDate.lte = new Date(`${to}T00:00:00Z`);
  }
  if (officeId) where.attendanceRecord = { officeId };
  if (taskStatus) where.tasks = { some: { status: taskStatus } };
  if (status === "NONE") where.noTasksReason = { not: null };
  if (q) {
    where.employee = {
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { employeeNumber: { contains: q, mode: "insensitive" } },
      ],
    };
  }

  const [settings, offices, reports, total] = await Promise.all([
    getAttendanceSettings(),
    prisma.office.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.dailyTaskReport.findMany({
      where,
      include: {
        employee: { include: { department: true } },
        attendanceRecord: { include: { office: true } },
        tasks: { orderBy: { position: "asc" } },
      },
      orderBy: [{ attendanceDate: "desc" }, { submittedAt: "desc" }],
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
    prisma.dailyTaskReport.count({ where }),
  ]);

  return (
    <>
      <PageHeader>
        <h1 className="text-2xl font-bold">Task Reports</h1>
        <p className="text-sm text-muted-foreground">
          What each employee reported working on, submitted as part of clocking out.
        </p>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
        <form className="flex flex-wrap gap-2">
          <Input type="date" name="from" defaultValue={from} className="w-[calc(50%-0.25rem)] sm:w-40" />
          <Input type="date" name="to" defaultValue={to} className="w-[calc(50%-0.25rem)] sm:w-40" />
          <Input name="q" defaultValue={q} placeholder="Search employee…" className="w-full sm:w-56" />
          <select
            name="officeId"
            defaultValue={officeId ?? ""}
            className="h-10 w-[calc(50%-0.25rem)] rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
          >
            <option value="">All offices</option>
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={taskStatus ?? (status === "NONE" ? "NONE" : "")}
            className="h-10 w-[calc(50%-0.25rem)] rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
          >
            <option value="">Any task status</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                Has: {TASK_STATUS_LABELS[s]}
              </option>
            ))}
            <option value="NONE">No tasks reported</option>
          </select>
          <Button type="submit" variant="outline" className="flex-1 sm:flex-none">
            Filter
          </Button>
          <div className="ml-auto">
            <PageSizeSelect pageSize={pageSize} />
          </div>
        </form>

        <div className="space-y-3">
          {reports.map((report) => (
            <Card key={report.id}>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <CardTitle className="text-base">
                      {report.employee.firstName} {report.employee.lastName}{" "}
                      <span className="font-normal text-muted-foreground">· {report.employee.employeeNumber}</span>
                    </CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {report.attendanceDate.toISOString().slice(0, 10)} · {report.attendanceRecord.office.name}
                      {report.employee.department ? ` · ${report.employee.department.name}` : ""} · submitted{" "}
                      {formatInTimeZone(report.submittedAt, settings.timezone, "h:mm a")}
                    </p>
                  </div>
                  <Link
                    href={`/admin/attendance/${report.attendanceRecordId}`}
                    className="shrink-0 text-sm text-primary hover:underline"
                  >
                    Attendance record
                  </Link>
                </div>
              </CardHeader>
              <CardContent>
                <TaskReportTasks tasks={report.tasks} noTasksReason={report.noTasksReason} />
              </CardContent>
            </Card>
          ))}
          {reports.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-normal text-muted-foreground">No task reports found.</CardTitle>
              </CardHeader>
            </Card>
          ) : null}
        </div>

        <Pagination
          basePath="/admin/task-reports"
          searchParams={{ from, to, q, officeId, status, pageSize: pageSizeParam }}
          page={pageNum}
          pageSize={pageSize}
          total={total}
        />
      </div>
    </>
  );
}
