import { prisma } from "@/lib/db/prisma";
import type { Prisma, TaskStatus } from "@prisma/client";
import { TASK_STATUS_LABELS, TASK_STATUSES } from "@/lib/attendance/taskReport";
import { formatInTimeZone } from "date-fns-tz";

export interface DailyReportFilters {
  from?: string;
  to?: string;
  officeId?: string;
  departmentId?: string;
  status?: string;
  attendanceType?: string;
  verificationMethod?: string;
  employeeId?: string;
}

export interface DailyReportRow {
  employee: string;
  department: string;
  office: string;
  date: string;
  clockIn: string;
  clockOut: string;
  status: string;
  minutesLate: number;
  hoursWorked: string;
  attendanceType: string;
  verificationMethod: string;
}

export async function fetchDailyReportRows(filters: DailyReportFilters, timezone = "Africa/Lagos"): Promise<DailyReportRow[]> {
  const where: Prisma.AttendanceRecordWhereInput = {};
  if (filters.from || filters.to) {
    where.attendanceDate = {};
    if (filters.from) where.attendanceDate.gte = new Date(`${filters.from}T00:00:00Z`);
    if (filters.to) where.attendanceDate.lte = new Date(`${filters.to}T00:00:00Z`);
  }
  if (filters.officeId) where.officeId = filters.officeId;
  if (filters.status) where.clockInStatus = filters.status as never;
  if (filters.attendanceType) where.attendanceType = filters.attendanceType as never;
  if (filters.verificationMethod) where.verificationMethod = filters.verificationMethod as never;
  if (filters.employeeId) where.employeeId = filters.employeeId;
  if (filters.departmentId) where.employee = { departmentId: filters.departmentId };

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: { employee: { include: { department: true } }, office: true },
    orderBy: [{ attendanceDate: "desc" }, { clockIn: "asc" }],
    take: 5000,
  });

  return records.map((r) => ({
    employee: `${r.employee.firstName} ${r.employee.lastName}`,
    department: r.employee.department?.name ?? "",
    office: r.office.name,
    date: r.attendanceDate.toISOString().slice(0, 10),
    clockIn: r.clockIn ? formatInTimeZone(r.clockIn, timezone, "HH:mm") : "",
    clockOut: r.clockOut ? formatInTimeZone(r.clockOut, timezone, "HH:mm") : "",
    status: r.clockInStatus ?? "",
    minutesLate: r.minutesLate,
    hoursWorked: r.totalMinutesWorked ? (r.totalMinutesWorked / 60).toFixed(2) : "",
    attendanceType: r.attendanceType,
    verificationMethod: r.verificationMethod ?? "",
  }));
}

export interface MonthlyReportRow {
  employee: string;
  department: string;
  daysPresent: number;
  daysLate: number;
  earlyArrivals: number;
  onTimeArrivals: number;
  overtimeDays: number;
  totalHours: string;
  totalLateMinutes: number;
  averageClockIn: string;
  averageClockOut: string;
}

export async function fetchMonthlyReportRows(month: string, officeId?: string): Promise<MonthlyReportRow[]> {
  const start = new Date(`${month}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const where: Prisma.AttendanceRecordWhereInput = { attendanceDate: { gte: start, lt: end } };
  if (officeId) where.officeId = officeId;

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: { employee: { include: { department: true } } },
  });

  const byEmployee = new Map<string, typeof records>();
  for (const r of records) {
    const list = byEmployee.get(r.employeeId) ?? [];
    list.push(r);
    byEmployee.set(r.employeeId, list);
  }

  const rows: MonthlyReportRow[] = [];
  for (const [, recs] of byEmployee) {
    const employee = recs[0]!.employee;
    const clockInMinutes = recs.filter((r) => r.clockIn).map((r) => r.clockIn!.getUTCHours() * 60 + r.clockIn!.getUTCMinutes());
    const clockOutMinutes = recs.filter((r) => r.clockOut).map((r) => r.clockOut!.getUTCHours() * 60 + r.clockOut!.getUTCMinutes());
    const avg = (arr: number[]) => (arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : null);
    const fmt = (mins: number | null) =>
      mins === null ? "" : `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

    rows.push({
      employee: `${employee.firstName} ${employee.lastName}`,
      department: employee.department?.name ?? "",
      daysPresent: recs.length,
      daysLate: recs.filter((r) => r.clockInStatus === "LATE").length,
      earlyArrivals: recs.filter((r) => r.clockInStatus === "EARLY").length,
      onTimeArrivals: recs.filter((r) => r.clockInStatus === "ON_TIME").length,
      overtimeDays: recs.filter((r) => r.attendanceType !== "REGULAR").length,
      totalHours: (recs.reduce((sum, r) => sum + (r.totalMinutesWorked ?? 0), 0) / 60).toFixed(1),
      totalLateMinutes: recs.reduce((sum, r) => sum + r.minutesLate, 0),
      averageClockIn: fmt(avg(clockInMinutes)),
      averageClockOut: fmt(avg(clockOutMinutes)),
    });
  }

  return rows.sort((a, b) => a.employee.localeCompare(b.employee));
}

export interface TaskReportFilters {
  from?: string;
  to?: string;
  officeId?: string;
  /** A TaskStatus to export only reports containing a task with that status, or "NONE" for only "no tasks today" reports. */
  status?: string;
}

/** One row per employee per day: all of that day's tasks in a single cell, one per line,
 * or the employee's explanation for a "no tasks today" report. */
export interface TaskReportRow {
  employee: string;
  employeeNumber: string;
  department: string;
  office: string;
  date: string;
  submittedAt: string;
  totalTasks: number;
  completed: number;
  partiallyCompleted: number;
  carriedOver: number;
  tasks: string;
}

export async function fetchTaskReportRows(filters: TaskReportFilters, timezone = "Africa/Lagos"): Promise<TaskReportRow[]> {
  const taskStatus = TASK_STATUSES.includes(filters.status as TaskStatus) ? (filters.status as TaskStatus) : undefined;
  const where: Prisma.DailyTaskReportWhereInput = {};
  if (filters.from || filters.to) {
    where.attendanceDate = {};
    if (filters.from) where.attendanceDate.gte = new Date(`${filters.from}T00:00:00Z`);
    if (filters.to) where.attendanceDate.lte = new Date(`${filters.to}T00:00:00Z`);
  }
  if (filters.officeId) where.attendanceRecord = { officeId: filters.officeId };
  if (taskStatus) where.tasks = { some: { status: taskStatus } };
  if (filters.status === "NONE") where.noTasksReason = { not: null };

  const reports = await prisma.dailyTaskReport.findMany({
    where,
    include: {
      employee: { include: { department: true } },
      attendanceRecord: { include: { office: true } },
      tasks: { orderBy: { position: "asc" } },
    },
    orderBy: [{ attendanceDate: "desc" }, { submittedAt: "asc" }],
    take: 5000,
  });

  return reports.map((r) => {
    const count = (status: TaskStatus) => r.tasks.filter((t) => t.status === status).length;
    return {
      employee: `${r.employee.firstName} ${r.employee.lastName}`,
      employeeNumber: r.employee.employeeNumber,
      department: r.employee.department?.name ?? "",
      office: r.attendanceRecord.office.name,
      date: r.attendanceDate.toISOString().slice(0, 10),
      submittedAt: formatInTimeZone(r.submittedAt, timezone, "HH:mm"),
      totalTasks: r.tasks.length,
      completed: count("COMPLETED"),
      partiallyCompleted: count("PARTIALLY_COMPLETED"),
      carriedOver: count("CARRIED_OVER"),
      tasks:
        r.noTasksReason !== null
          ? `No tasks to report: ${r.noTasksReason}`
          : r.tasks.map((t, i) => `${i + 1}. ${t.description} (${TASK_STATUS_LABELS[t.status]})`).join("\n"),
    };
  });
}

/** Headline counts for the top of a task report export. */
export function summarizeTaskReportRows(rows: TaskReportRow[]): string[] {
  const sum = (pick: (r: TaskReportRow) => number) => rows.reduce((total, r) => total + pick(r), 0);
  const counts: Record<TaskStatus, number> = {
    COMPLETED: sum((r) => r.completed),
    PARTIALLY_COMPLETED: sum((r) => r.partiallyCompleted),
    CARRIED_OVER: sum((r) => r.carriedOver),
  };
  return [
    `Reports: ${rows.length}`,
    `Tasks: ${sum((r) => r.totalTasks)} (${TASK_STATUSES.map((s) => `${TASK_STATUS_LABELS[s]}: ${counts[s]}`).join(", ")})`,
    `No tasks to report: ${rows.filter((r) => r.tasks.startsWith("No tasks to report:")).length}`,
  ];
}

export interface EmployeeAttendanceFilters {
  employeeId: string;
  from?: string;
  to?: string;
  /** Tasks are Admin/Super Admin only — without this the Tasks/Status columns are left out. */
  includeTasks: boolean;
}

/** One row per day for one employee. Tasks and their statuses sit in two cells, one
 * numbered line each, so line N of Status belongs to task N. */
export type EmployeeAttendanceRow = Record<string, string>;

export async function fetchEmployeeAttendanceRows(
  filters: EmployeeAttendanceFilters,
  timezone = "Africa/Lagos"
): Promise<EmployeeAttendanceRow[]> {
  const where: Prisma.AttendanceRecordWhereInput = { employeeId: filters.employeeId };
  if (filters.from || filters.to) {
    where.attendanceDate = {};
    if (filters.from) where.attendanceDate.gte = new Date(`${filters.from}T00:00:00Z`);
    if (filters.to) where.attendanceDate.lte = new Date(`${filters.to}T00:00:00Z`);
  }

  const records = await prisma.attendanceRecord.findMany({
    where,
    include: {
      employee: { include: { department: true } },
      taskReport: { include: { tasks: { orderBy: { position: "asc" } } } },
    },
    orderBy: { attendanceDate: "desc" },
    take: 5000,
  });

  const time = (instant: Date | null, missing: string) =>
    instant ? formatInTimeZone(instant, timezone, "d MMM yyyy, h:mm a") : missing;

  return records.map((r) => {
    const row: EmployeeAttendanceRow = {
      "Employee Name": `${r.employee.firstName} ${r.employee.lastName}`,
      Department: r.employee.department?.name ?? "",
      "Clock In": time(r.clockIn, ""),
      "Clock Out": time(r.clockOut, r.clockIn ? "Not clocked out" : ""),
    };
    if (!filters.includeTasks) return row;

    const report = r.taskReport;
    if (report?.noTasksReason != null) {
      row.Tasks = `No tasks to report: ${report.noTasksReason}`;
      row.Status = "";
    } else if (report) {
      row.Tasks = report.tasks.map((t, i) => `${i + 1}. ${t.description}`).join("\n");
      row.Status = report.tasks.map((t, i) => `${i + 1}. ${TASK_STATUS_LABELS[t.status]}`).join("\n");
    } else {
      // The report is filled in at clock-out; older clock-outs (or admin-added ones) have none.
      row.Tasks = r.clockOut ? "No report submitted" : "";
      row.Status = "";
    }
    return row;
  });
}
