import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db/prisma";
import { recordAttendance } from "@/lib/attendance/engine";
import { updateAttendanceSettings } from "@/lib/attendance/settings";
import { updateCompanySettings } from "@/lib/company/settings";
import { createAttendanceIdCandidate } from "@/lib/security/attendanceId";

const hasDb = !!process.env.DATABASE_URL;
const describeIfDb = hasDb ? describe : describe.skip;

const TZ = "Africa/Lagos";

const TASKS = [
  { description: "Reconciled vendor invoices", status: "COMPLETED" },
  { description: "Drafted Q4 budget report", status: "PARTIALLY_COMPLETED" },
  { description: "Supplier follow-up calls", status: "CARRIED_OVER" },
];

describeIfDb("recordAttendance — integration", () => {
  let officeId: string;
  let userId: string;

  beforeAll(async () => {
    process.env.AUTH_SECRET ??= "test-secret";
    process.env.QR_SECRET ??= "test-qr-secret";
    await updateCompanySettings({ companyName: "Test Co" });
    await updateAttendanceSettings({
      timezone: TZ,
      workStart: "09:00",
      gracePeriodMinutes: 15,
      workEnd: "17:00",
      attendanceMode: "NETWORK_ONLY",
    });

    const office = await prisma.office.create({ data: { name: "Test Office", timezone: TZ } });
    officeId = office.id;

    const admin = await prisma.user.create({
      data: { email: "test-admin@example.com", passwordHash: "x", fullName: "Test Admin", role: "SUPER_ADMIN" },
    });
    userId = admin.id;
  });

  afterAll(async () => {
    await prisma.attendanceDeviceFlag.deleteMany({ where: { attendanceRecord: { officeId } } });
    await prisma.attendanceRecord.deleteMany({ where: { officeId } });
    await prisma.qrAttendanceSession.deleteMany({ where: { officeId } });
    await prisma.attendanceQrCode.deleteMany({ where: { officeId } });
    await prisma.employee.deleteMany({ where: { officeId } });
    await prisma.officeNetwork.deleteMany({ where: { officeId } });
    await prisma.office.delete({ where: { id: officeId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  beforeEach(async () => {
    await prisma.attendanceDeviceFlag.deleteMany({ where: { attendanceRecord: { officeId } } });
    await prisma.attendanceRecord.deleteMany({ where: { officeId } });
    await prisma.rateLimitBucket.deleteMany();
  });

  async function makeEmployee(overrides: { workStart?: string; workEnd?: string } = {}) {
    const { plaintext, lookup } = createAttendanceIdCandidate();
    const employee = await prisma.employee.create({
      data: {
        employeeNumber: `EMP-TEST-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        attendanceIdLookup: lookup,
        firstName: "Test",
        lastName: "Employee",
        officeId,
        ...overrides,
      },
    });
    return { employee, attendanceId: plaintext };
  }

  it("denies attendance when no office network is configured", async () => {
    const { attendanceId } = await makeEmployee();
    const result = await recordAttendance({
      attendanceIdRaw: attendanceId,
      sourceIp: "102.89.0.1",
      userAgent: "vitest",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("NETWORK_DENIED");
  });

  it("rejects an invalid Attendance ID without revealing whether an employee exists", async () => {
    const result = await recordAttendance({
      attendanceIdRaw: "NOTAREALID",
      sourceIp: "102.89.0.1",
      userAgent: "vitest",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_EMPLOYEE");
  });

  describeIfDb("with a verified office network", () => {
    beforeEach(async () => {
      await prisma.officeNetwork.deleteMany({ where: { officeId } });
      await prisma.officeNetwork.create({
        data: {
          officeId,
          name: "Test Network",
          currentPublicIp: "102.89.0.1",
          status: "VERIFIED",
          lastVerifiedAt: new Date(),
          failMode: "FAIL_CLOSED",
        },
      });
    });

    it("allows clock-in from the authorized IP and denies from an unauthorized one", async () => {
      const { attendanceId } = await makeEmployee();

      const denied = await recordAttendance({
        attendanceIdRaw: attendanceId,
        sourceIp: "41.58.0.99", // employee "at home" on mobile data
        userAgent: "vitest",
      });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.reason).toBe("NETWORK_DENIED");

      const allowed = await recordAttendance({
        attendanceIdRaw: attendanceId,
        sourceIp: "102.89.0.1", // employee on office Wi-Fi
        userAgent: "vitest",
      });
      expect(allowed.ok).toBe(true);
      if (allowed.ok) expect(allowed.action).toBe("CLOCK_IN");
    });

    it("prevents duplicate clock-ins and then allows clock-out, completing the state machine", async () => {
      const { attendanceId } = await makeEmployee();
      const input = { attendanceIdRaw: attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" };

      const first = await recordAttendance(input);
      expect(first.ok).toBe(true);
      if (first.ok) expect(first.action).toBe("CLOCK_IN");

      // The test clocks out seconds after clocking in, i.e. before workEnd (17:00) —
      // a reason is required, same as the real early-clock-out flow.
      const second = await recordAttendance({
        ...input,
        tasks: TASKS,
        earlyClockOutReason: "Leaving early for a doctor's appointment",
      });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.action).toBe("CLOCK_OUT");

      const third = await recordAttendance(input);
      expect(third.ok).toBe(false);
      if (!third.ok) expect(third.reason).toBe("ALREADY_COMPLETE");
    });

    it("never rate-limits distinct employees clocking in concurrently from the same office IP", async () => {
      // Every device on an office's Wi-Fi shares one public IP via NAT. The
      // attendance-id rate limit (8 per 5 min) must only ever throttle *invalid*
      // ID guesses from that IP, never a whole office's worth of legitimate,
      // correctly-identified employees clocking in at once (e.g. the morning rush).
      const employees = await Promise.all(Array.from({ length: 12 }, () => makeEmployee()));
      const officeIp = "102.89.0.1";

      for (const { attendanceId } of employees) {
        const result = await recordAttendance({ attendanceIdRaw: attendanceId, sourceIp: officeIp, userAgent: "vitest" });
        expect(result.ok).toBe(true);
        if (result.ok) expect(result.action).toBe("CLOCK_IN");
      }
    });

    it("still rate-limits repeated invalid Attendance ID guesses from the same IP", async () => {
      const officeIp = "102.89.0.1";
      let lastResult;
      for (let i = 0; i < 9; i++) {
        lastResult = await recordAttendance({ attendanceIdRaw: "NOTAREALID", sourceIp: officeIp, userAgent: "vitest" });
      }
      expect(lastResult!.ok).toBe(false);
      if (!lastResult!.ok) expect(lastResult!.reason).toBe("RATE_LIMITED");
    });

    it("requires a reason to clock out before the scheduled end of day, then accepts it", async () => {
      // workEnd must be after "now" for this test to exercise the EARLY path — the
      // suite's default 17:00 stops being in the future once run later in the day,
      // making this flaky by wall-clock time. Push it an hour past "now" instead.
      const futureWorkEnd = formatInTimeZone(new Date(Date.now() + 60 * 60 * 1000), TZ, "HH:mm");
      await updateAttendanceSettings({
        timezone: TZ,
        workStart: "09:00",
        gracePeriodMinutes: 15,
        workEnd: futureWorkEnd,
        attendanceMode: "NETWORK_ONLY",
      });

      const { attendanceId } = await makeEmployee();
      const input = { attendanceIdRaw: attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" };

      const clockIn = await recordAttendance(input);
      expect(clockIn.ok).toBe(true);

      const withoutReason = await recordAttendance({ ...input, tasks: TASKS });
      expect(withoutReason.ok).toBe(false);
      if (!withoutReason.ok) expect(withoutReason.reason).toBe("EARLY_CLOCKOUT_REASON_REQUIRED");

      const withReason = await recordAttendance({ ...input, tasks: TASKS, earlyClockOutReason: "Feeling unwell" });
      expect(withReason.ok).toBe(true);
      if (withReason.ok && withReason.action === "CLOCK_OUT") {
        expect(withReason.record.clockOutStatus).toBe("EARLY");
        expect(withReason.record.earlyClockOutReason).toBe("Feeling unwell");
      }
    });

    it("does not create two records for concurrent simultaneous clock-in requests", async () => {
      const { attendanceId } = await makeEmployee();
      const input = { attendanceIdRaw: attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" };

      const [a, b] = await Promise.all([recordAttendance(input), recordAttendance(input)]);
      const outcomes = [a, b].map((r) => (r.ok ? r.action : r.reason));

      // Exactly one of the two concurrent requests should win as CLOCK_IN; the
      // other resolves as CLOCK_OUT or ALREADY_COMPLETE depending on timing —
      // either way, never two CLOCK_INs.
      expect(outcomes.filter((o) => o === "CLOCK_IN").length).toBe(1);

      const records = await prisma.attendanceRecord.count({
        where: { employeeId: (await prisma.employee.findFirst({ where: { officeId }, orderBy: { createdAt: "desc" } }))!.id },
      });
      expect(records).toBe(1);
    });

    it("flags a device clocking in as a different employee than it was last seen with", async () => {
      const a = await makeEmployee();
      const b = await makeEmployee();
      const sharedDeviceId = "device-shared-1";

      const firstResult = await recordAttendance({
        attendanceIdRaw: a.attendanceId,
        sourceIp: "102.89.0.1",
        userAgent: "vitest",
        deviceId: sharedDeviceId,
      });
      expect(firstResult.ok).toBe(true);

      const secondResult = await recordAttendance({
        attendanceIdRaw: b.attendanceId,
        sourceIp: "102.89.0.1",
        userAgent: "vitest",
        deviceId: sharedDeviceId,
      });
      expect(secondResult.ok).toBe(true); // never blocked, only flagged

      const flags = await prisma.attendanceDeviceFlag.findMany({ where: { deviceId: sharedDeviceId } });
      expect(flags).toHaveLength(1);
      expect(flags[0]!.employeeId).toBe(b.employee.id);
      expect(flags[0]!.previousEmployeeId).toBe(a.employee.id);
      expect(flags[0]!.reviewed).toBe(false);
    });

    it("does not flag the same employee reusing their own device", async () => {
      const a = await makeEmployee();
      const deviceId = "device-own-1";

      const clockIn = await recordAttendance({
        attendanceIdRaw: a.attendanceId,
        sourceIp: "102.89.0.1",
        userAgent: "vitest",
        deviceId,
      });
      expect(clockIn.ok).toBe(true);

      const clockOut = await recordAttendance({
        attendanceIdRaw: a.attendanceId,
        sourceIp: "102.89.0.1",
        userAgent: "vitest",
        deviceId,
        tasks: TASKS,
        earlyClockOutReason: "Personal errand",
      });
      expect(clockOut.ok).toBe(true);

      const flags = await prisma.attendanceDeviceFlag.findMany({ where: { deviceId } });
      expect(flags).toHaveLength(0);
    });

    it("does not flag when no deviceId is supplied", async () => {
      const a = await makeEmployee();
      const b = await makeEmployee();

      await recordAttendance({ attendanceIdRaw: a.attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" });
      await recordAttendance({ attendanceIdRaw: b.attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" });

      const flags = await prisma.attendanceDeviceFlag.count({
        where: { OR: [{ employeeId: a.employee.id }, { employeeId: b.employee.id }] },
      });
      expect(flags).toBe(0);
    });

    it("classifies clock-in against the employee's own workStart override, not the general settings", async () => {
      // General settings workStart is 09:00 (already passed most days); this
      // employee's own override is an hour from now, so clocking in "now" must
      // register as EARLY relative to their schedule, not ON_TIME/LATE relative
      // to the general one.
      const futureStart = formatInTimeZone(new Date(Date.now() + 60 * 60 * 1000), TZ, "HH:mm");
      const { attendanceId } = await makeEmployee({ workStart: futureStart });

      const result = await recordAttendance({ attendanceIdRaw: attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" });
      expect(result.ok).toBe(true);
      if (result.ok && result.action === "CLOCK_IN") {
        expect(result.record.clockInStatus).toBe("EARLY");
      }
    });

    it("classifies clock-out against the employee's own workEnd override, not the general settings", async () => {
      // This employee's own scheduled end was an hour ago, so clocking out now is
      // ON_TIME for them even though the general workEnd (17:00) may still be ahead.
      const pastEnd = formatInTimeZone(new Date(Date.now() - 60 * 60 * 1000), TZ, "HH:mm");
      const { attendanceId } = await makeEmployee({ workEnd: pastEnd });
      const input = { attendanceIdRaw: attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" };

      const clockIn = await recordAttendance(input);
      expect(clockIn.ok).toBe(true);

      const clockOut = await recordAttendance({ ...input, tasks: TASKS });
      expect(clockOut.ok).toBe(true);
      if (clockOut.ok && clockOut.action === "CLOCK_OUT") {
        expect(clockOut.record.clockOutStatus).toBe("ON_TIME");
      }
    });

    describe("daily task report", () => {
      // An employee whose scheduled end was an hour ago, so clock-out is ON_TIME and
      // only the task report (not an early-departure reason) is in play.
      async function clockedInEmployee() {
        const pastEnd = formatInTimeZone(new Date(Date.now() - 60 * 60 * 1000), TZ, "HH:mm");
        const made = await makeEmployee({ workEnd: pastEnd });
        const input = { attendanceIdRaw: made.attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" };
        const clockIn = await recordAttendance(input);
        expect(clockIn.ok).toBe(true);
        return { ...made, input };
      }

      async function recordFor(employeeId: string) {
        return prisma.attendanceRecord.findFirstOrThrow({ where: { employeeId }, include: { taskReport: true } });
      }

      it("does not ask for a report on clock-in, and requires one before clock-out completes", async () => {
        const { employee, input } = await clockedInEmployee();
        expect((await recordFor(employee.id)).taskReport).toBeNull();

        const withoutReport = await recordAttendance(input);
        expect(withoutReport.ok).toBe(false);
        if (!withoutReport.ok) expect(withoutReport.reason).toBe("TASK_REPORT_REQUIRED");

        const record = await recordFor(employee.id);
        expect(record.clockOut).toBeNull();
        expect(record.taskReport).toBeNull();
      });

      it("saves multiple tasks with different statuses against the correct employee and attendance record", async () => {
        const { employee, input } = await clockedInEmployee();

        const result = await recordAttendance({ ...input, tasks: TASKS });
        expect(result.ok).toBe(true);
        if (result.ok && result.action === "CLOCK_OUT") expect(result.tasksReported).toBe(3);

        const record = await recordFor(employee.id);
        expect(record.clockOut).not.toBeNull();
        const report = await prisma.dailyTaskReport.findUniqueOrThrow({
          where: { attendanceRecordId: record.id },
          include: { tasks: { orderBy: { position: "asc" } } },
        });
        expect(report.employeeId).toBe(employee.id);
        expect(report.attendanceDate).toEqual(record.attendanceDate);
        expect(report.tasks.map((t) => [t.description, t.status])).toEqual(TASKS.map((t) => [t.description, t.status]));
        expect(report.noTasksReason).toBeNull();
      });

      it("lets an employee with no tasks clock out by explaining why", async () => {
        const { employee, input } = await clockedInEmployee();

        const result = await recordAttendance({ ...input, noTasksReason: "  No tasks were assigned to me today.  " });
        expect(result.ok).toBe(true);
        if (result.ok && result.action === "CLOCK_OUT") expect(result.tasksReported).toBe(0);

        const record = await recordFor(employee.id);
        expect(record.clockOut).not.toBeNull();
        const report = await prisma.dailyTaskReport.findUniqueOrThrow({
          where: { attendanceRecordId: record.id },
          include: { tasks: true },
        });
        expect(report.employeeId).toBe(employee.id);
        expect(report.noTasksReason).toBe("No tasks were assigned to me today.");
        expect(report.tasks).toEqual([]);
      });

      it.each([
        ["a blank no-tasks reason", { noTasksReason: "   " }],
        ["an over-long no-tasks reason", { noTasksReason: "x".repeat(501) }],
        ["both tasks and a no-tasks reason", { tasks: TASKS, noTasksReason: "Nothing today" }],
      ])("rejects %s and leaves the employee clocked in to retry", async (_label, report) => {
        const { employee, input } = await clockedInEmployee();

        const invalid = await recordAttendance({ ...input, ...report });
        expect(invalid.ok).toBe(false);
        if (!invalid.ok) expect(invalid.reason).toBe("TASK_REPORT_INVALID");
        expect((await recordFor(employee.id)).clockOut).toBeNull();

        const retry = await recordAttendance({ ...input, noTasksReason: "No tasks were assigned to me today." });
        expect(retry.ok).toBe(true);
      });

      it.each([
        ["an empty list", []],
        ["a blank description", [{ description: "   ", status: "COMPLETED" }]],
        ["an unknown status", [{ description: "Did things", status: "DONE" }]],
        ["a missing status", [{ description: "Did things" }]],
        ["an over-long description", [{ description: "x".repeat(501), status: "COMPLETED" }]],
      ])("rejects a report with %s and leaves the employee clocked in to retry", async (_label, tasks) => {
        const { employee, input } = await clockedInEmployee();

        const invalid = await recordAttendance({ ...input, tasks });
        expect(invalid.ok).toBe(false);
        if (!invalid.ok) expect(invalid.reason).toBe("TASK_REPORT_INVALID");
        expect((await recordFor(employee.id)).clockOut).toBeNull();

        const retry = await recordAttendance({ ...input, tasks: TASKS });
        expect(retry.ok).toBe(true);
        if (retry.ok) expect(retry.action).toBe("CLOCK_OUT");
      });

      it("does not save the report until an early clock-out's reason is also given", async () => {
        const futureEnd = formatInTimeZone(new Date(Date.now() + 60 * 60 * 1000), TZ, "HH:mm");
        const { employee, attendanceId } = await makeEmployee({ workEnd: futureEnd });
        const input = { attendanceIdRaw: attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" };
        await recordAttendance(input);

        const needsReason = await recordAttendance({ ...input, tasks: TASKS });
        expect(needsReason.ok).toBe(false);
        if (!needsReason.ok) expect(needsReason.reason).toBe("EARLY_CLOCKOUT_REASON_REQUIRED");
        expect((await recordFor(employee.id)).taskReport).toBeNull();

        const done = await recordAttendance({ ...input, tasks: TASKS, earlyClockOutReason: "Feeling unwell" });
        expect(done.ok).toBe(true);
        const record = await recordFor(employee.id);
        expect(record.earlyClockOutReason).toBe("Feeling unwell");
        expect(record.taskReport).not.toBeNull();
      });

      it("rolls back the clock-out when the report fails to save", async () => {
        const { employee, input } = await clockedInEmployee();
        const record = await recordFor(employee.id);
        // A report already attached to this record makes the engine's insert hit the
        // unique constraint inside the transaction — standing in for any save failure.
        await prisma.dailyTaskReport.create({
          data: { attendanceRecordId: record.id, employeeId: employee.id, attendanceDate: record.attendanceDate },
        });

        const result = await recordAttendance({ ...input, tasks: TASKS });
        expect(result.ok).toBe(false);
        expect((await recordFor(employee.id)).clockOut).toBeNull();
      });
    });
  });

  describeIfDb("QR_ONLY mode", () => {
    beforeAll(async () => {
      await updateAttendanceSettings({
        timezone: TZ,
        workStart: "09:00",
        gracePeriodMinutes: 15,
        workEnd: "17:00",
        attendanceMode: "QR_ONLY",
      });
    });

    afterAll(async () => {
      await updateAttendanceSettings({
        timezone: TZ,
        workStart: "09:00",
        gracePeriodMinutes: 15,
        workEnd: "17:00",
        attendanceMode: "NETWORK_ONLY",
      });
    });

    it("clocks in with a valid QR session and no office network configured at all", async () => {
      // Deliberately no OfficeNetwork row exists for this office — QR_ONLY must
      // never fall back to requiring one.
      const { attendanceId } = await makeEmployee();
      const { generateDailyQr } = await import("@/lib/qr/manage");
      const { startQrSession } = await import("@/lib/qr/session");
      const { getAttendanceDateKey } = await import("@/lib/attendance/rules");

      const today = getAttendanceDateKey(new Date(), TZ);
      const { qrCode } = await generateDailyQr({ officeId, attendanceDate: today, timezone: TZ, generatedById: userId });
      const session = await startQrSession({ qrCode, sourceIp: "41.58.0.99", userAgent: "vitest" });

      const result = await recordAttendance({
        attendanceIdRaw: attendanceId,
        sourceIp: "41.58.0.99", // an IP nowhere near any office network — must not matter
        userAgent: "vitest",
        qrSessionToken: session.sessionToken,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.action).toBe("CLOCK_IN");
        expect(result.record.verificationMethod).toBe("QR_ONLY");
      }
    });

    it("denies clock-in without a QR session even though no network is required", async () => {
      const { attendanceId } = await makeEmployee();
      const result = await recordAttendance({
        attendanceIdRaw: attendanceId,
        sourceIp: "41.58.0.99",
        userAgent: "vitest",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("QR_REQUIRED");
    });
  });
});
