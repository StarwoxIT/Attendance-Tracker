import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db/prisma";
import { fetchEmployeeAttendanceRows } from "@/lib/reports/query";
import { createAttendanceIdCandidate } from "@/lib/security/attendanceId";

const hasDb = !!process.env.DATABASE_URL;
const describeIfDb = hasDb ? describe : describe.skip;

const TZ = "Africa/Lagos";

describeIfDb("employee attendance report", () => {
  let officeId: string;
  let employeeId: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    const office = await prisma.office.create({ data: { name: "Report Test Office", timezone: TZ } });
    officeId = office.id;
    const department = await prisma.department.upsert({ where: { name: "Data Team" }, create: { name: "Data Team" }, update: {} });
    const { lookup } = createAttendanceIdCandidate();
    const employee = await prisma.employee.create({
      data: {
        employeeNumber: `EMP-REPORT-${Date.now()}`,
        attendanceIdLookup: lookup,
        firstName: "Ngozi",
        lastName: "Okafor",
        officeId,
        departmentId: department.id,
      },
    });
    employeeId = employee.id;

    const day = (ymd: string, clockIn: string, clockOut: string | null) =>
      prisma.attendanceRecord.create({
        data: {
          employeeId,
          officeId,
          attendanceDate: new Date(`${ymd}T00:00:00Z`),
          clockIn: new Date(clockIn),
          clockOut: clockOut ? new Date(clockOut) : null,
          clockInStatus: "ON_TIME",
        },
      });

    // 09:02 and 17:30 Lagos (UTC+1).
    const withTasks = await day("2026-10-26", "2026-10-26T08:02:00Z", "2026-10-26T16:30:00Z");
    await prisma.dailyTaskReport.create({
      data: {
        attendanceRecordId: withTasks.id,
        employeeId,
        attendanceDate: withTasks.attendanceDate,
        tasks: {
          create: [
            { position: 0, description: "Cleaned the sales dataset", status: "COMPLETED" },
            { position: 1, description: "Built the churn dashboard", status: "CARRIED_OVER" },
          ],
        },
      },
    });
    const noTasks = await day("2026-10-27", "2026-10-27T08:00:00Z", "2026-10-27T16:00:00Z");
    await prisma.dailyTaskReport.create({
      data: { attendanceRecordId: noTasks.id, employeeId, attendanceDate: noTasks.attendanceDate, noTasksReason: "Training day" },
    });
    await day("2026-10-28", "2026-10-28T08:15:00Z", null);
  });

  afterAll(async () => {
    await prisma.dailyTaskReport.deleteMany({ where: { employeeId } });
    await prisma.attendanceRecord.deleteMany({ where: { employeeId } });
    await prisma.employee.delete({ where: { id: employeeId } });
    await prisma.office.delete({ where: { id: officeId } });
  });

  it("has just the six columns, one row per day, with each task's status on the matching line", async () => {
    const rows = await fetchEmployeeAttendanceRows({ employeeId, includeTasks: true }, TZ);

    expect(rows.map((r) => Object.keys(r))).toEqual(
      Array(3).fill(["Employee Name", "Department", "Clock In", "Clock Out", "Tasks", "Status"])
    );
    expect(rows).toEqual([
      {
        "Employee Name": "Ngozi Okafor",
        Department: "Data Team",
        "Clock In": "28 Oct 2026, 9:15 AM",
        "Clock Out": "Not clocked out",
        Tasks: "",
        Status: "",
      },
      {
        "Employee Name": "Ngozi Okafor",
        Department: "Data Team",
        "Clock In": "27 Oct 2026, 9:00 AM",
        "Clock Out": "27 Oct 2026, 5:00 PM",
        Tasks: "No tasks to report: Training day",
        Status: "",
      },
      {
        "Employee Name": "Ngozi Okafor",
        Department: "Data Team",
        "Clock In": "26 Oct 2026, 9:02 AM",
        "Clock Out": "26 Oct 2026, 5:30 PM",
        Tasks: "1. Cleaned the sales dataset\n2. Built the churn dashboard",
        Status: "1. Completed\n2. Carried over to tomorrow",
      },
    ]);
  });

  it("filters by date and leaves out tasks for roles that can't see them", async () => {
    const rows = await fetchEmployeeAttendanceRows({ employeeId, from: "2026-10-26", to: "2026-10-26", includeTasks: false }, TZ);
    expect(rows).toEqual([
      {
        "Employee Name": "Ngozi Okafor",
        Department: "Data Team",
        "Clock In": "26 Oct 2026, 9:02 AM",
        "Clock Out": "26 Oct 2026, 5:30 PM",
      },
    ]);
  });
});
