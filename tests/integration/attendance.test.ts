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
          ipv4VerifiedAt: new Date(),
          currentPublicIpv6: "2a0d:3344:1a2b:5c00:1111:2222:3333:4444",
          ipv6VerifiedAt: new Date(),
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

    it("accepts browsers on the office Wi-Fi whether they connect over IPv4 or IPv6", async () => {
      // Same office, different browsers: one connects over IPv4 (the shared NAT
      // address), another over IPv6 with its own device address in the office /64.
      const viaIpv4 = await recordAttendance({
        attendanceIdRaw: (await makeEmployee()).attendanceId,
        sourceIp: "102.89.0.1",
        userAgent: "Chrome",
      });
      expect(viaIpv4.ok).toBe(true);

      const viaIpv6 = await recordAttendance({
        attendanceIdRaw: (await makeEmployee()).attendanceId,
        sourceIp: "2a0d:3344:1a2b:5c00:9f3:abcd:12:7", // a different device in the same /64
        userAgent: "Safari",
      });
      expect(viaIpv6.ok).toBe(true);

      const otherIpv6Network = await recordAttendance({
        attendanceIdRaw: (await makeEmployee()).attendanceId,
        sourceIp: "2a0d:3344:1a2b:5d00::7", // a neighbouring /64 — someone else's network
        userAgent: "Firefox",
      });
      expect(otherIpv6Network.ok).toBe(false);
      if (!otherIpv6Network.ok) expect(otherIpv6Network.reason).toBe("NETWORK_DENIED");
    });

    it("judges staleness per address family, so a fresh IPv6 sighting can't keep a stale IPv4 alive", async () => {
      await prisma.officeNetwork.updateMany({
        where: { officeId },
        data: { ipv4VerifiedAt: new Date(Date.now() - 24 * 60 * 60_000) },
      });

      const viaStaleIpv4 = await recordAttendance({
        attendanceIdRaw: (await makeEmployee()).attendanceId,
        sourceIp: "102.89.0.1",
        userAgent: "vitest",
      });
      expect(viaStaleIpv4.ok).toBe(false);

      const viaFreshIpv6 = await recordAttendance({
        attendanceIdRaw: (await makeEmployee()).attendanceId,
        sourceIp: "2a0d:3344:1a2b:5c00::42",
        userAgent: "vitest",
      });
      expect(viaFreshIpv6.ok).toBe(true);
    });

    it("answers a retried clock-in as the clock-in it already was, instead of starting a clock-out", async () => {
      const { employee, attendanceId } = await makeEmployee();
      const input = { attendanceIdRaw: attendanceId, sourceIp: "102.89.0.1", userAgent: "vitest" };

      const first = await recordAttendance(input);
      expect(first.ok && first.action).toBe("CLOCK_IN");

      // The first response never reached the phone; the employee taps again (or tries another browser).
      const retry = await recordAttendance({ ...input, userAgent: "another browser" });
      expect(retry.ok).toBe(true);
      if (retry.ok && retry.action === "CLOCK_IN") {
        expect(retry.alreadyClockedIn).toBe(true);
        if (first.ok) expect(retry.record.clockIn).toEqual(first.record.clockIn);
      } else {
        throw new Error(`expected a repeat CLOCK_IN, got ${JSON.stringify(retry)}`);
      }

      const records = await prisma.attendanceRecord.findMany({ where: { employeeId: employee.id } });
      expect(records).toHaveLength(1);
      expect(records[0]!.clockOut).toBeNull();
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

      // Both requests are the same clock-in: exactly one records it, the other is
      // told it was already recorded — never a second record, and never mistaken
      // for a clock-out or "already clocked in and out today".
      for (const r of [a, b]) {
        expect(r.ok && r.action).toBe("CLOCK_IN");
      }
      const fresh = [a, b].filter((r) => r.ok && r.action === "CLOCK_IN" && !r.alreadyClockedIn);
      expect(fresh).toHaveLength(1);

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
        // Arrived an hour ago, so a repeat now is a real clock-out, not a retried clock-in.
        await prisma.attendanceRecord.updateMany({
          where: { employeeId: made.employee.id },
          data: { clockIn: new Date(Date.now() - 60 * 60 * 1000) },
        });
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

  describeIfDb("QR + location", () => {
    // The test office's location; 0.001° of latitude is ~111 m.
    const OFFICE_LOCATION = { latitude: 6.4281, longitude: 3.4219 };
    const AT_DESK = { latitude: 6.4285, longitude: 3.4219, accuracy: 25 }; // ~45 m away
    const DOWN_THE_ROAD = { latitude: 6.4381, longitude: 3.4219, accuracy: 15 }; // ~1.1 km away
    const MOBILE_IP = "41.58.0.99"; // mobile data — nowhere near any office network

    async function setMode(attendanceMode: "QR_ONLY" | "NETWORK_ONLY") {
      await updateAttendanceSettings({ timezone: TZ, workStart: "09:00", gracePeriodMinutes: 15, workEnd: "17:00", attendanceMode });
    }

    async function scanQr() {
      const { generateDailyQr } = await import("@/lib/qr/manage");
      const { startQrSession } = await import("@/lib/qr/session");
      const { getAttendanceDateKey } = await import("@/lib/attendance/rules");
      const { qrCode } = await generateDailyQr({
        officeId,
        attendanceDate: getAttendanceDateKey(new Date(), TZ),
        permanent: true,
        timezone: TZ,
        generatedById: userId,
      });
      const session = await startQrSession({ qrCode, sourceIp: MOBILE_IP, userAgent: "vitest" });
      return session.sessionToken;
    }

    beforeAll(async () => {
      await prisma.office.update({ where: { id: officeId }, data: { ...OFFICE_LOCATION, locationRadiusMeters: 150 } });
    });

    afterAll(async () => {
      await prisma.office.update({
        where: { id: officeId },
        data: { latitude: null, longitude: null },
      });
      await setMode("NETWORK_ONLY");
    });

    describeIfDb("QR_ONLY mode", () => {
      beforeAll(async () => {
        await prisma.officeNetwork.deleteMany({ where: { officeId } });
        await setMode("QR_ONLY");
      });

      it("clocks in on mobile data with a scan and a location inside the office radius", async () => {
        // Deliberately no OfficeNetwork row exists for this office — QR_ONLY must
        // never fall back to requiring one.
        const { attendanceId } = await makeEmployee();
        const result = await recordAttendance({
          attendanceIdRaw: attendanceId,
          sourceIp: MOBILE_IP,
          userAgent: "vitest",
          qrSessionToken: await scanQr(),
          location: AT_DESK,
        });

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.action).toBe("CLOCK_IN");
          expect(result.record.verificationMethod).toBe("QR_LOCATION");
          expect(result.record.clockInDistanceMeters).toBeCloseTo(44, -1);
          expect(result.record.clockInLocationAccuracyMeters).toBe(25);
        }
      });

      it("denies clock-in without a QR session even though no network is required", async () => {
        const { attendanceId } = await makeEmployee();
        const result = await recordAttendance({ attendanceIdRaw: attendanceId, sourceIp: MOBILE_IP, userAgent: "vitest", location: AT_DESK });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.reason).toBe("QR_REQUIRED");
      });

      it("refuses a scan from outside the radius, then lets the same scan retry without a duplicate", async () => {
        const { employee, attendanceId } = await makeEmployee();
        const input = { attendanceIdRaw: attendanceId, sourceIp: MOBILE_IP, userAgent: "vitest", qrSessionToken: await scanQr() };

        const away = await recordAttendance({ ...input, location: DOWN_THE_ROAD });
        expect(away.ok).toBe(false);
        if (!away.ok) {
          expect(away.reason).toBe("LOCATION_OUT_OF_RANGE");
          expect(away.distanceMeters).toBeCloseTo(1112, -1);
        }

        const vague = await recordAttendance({ ...input, location: { ...AT_DESK, accuracy: 900 } });
        expect(!vague.ok && vague.reason).toBe("LOCATION_INACCURATE");

        const noLocation = await recordAttendance(input);
        expect(!noLocation.ok && noLocation.reason).toBe("LOCATION_REQUIRED");

        const forged = await recordAttendance({ ...input, location: { latitude: "6.4281", longitude: 3.4219, accuracy: 5 } });
        expect(!forged.ok && forged.reason).toBe("LOCATION_REQUIRED");

        expect(await prisma.attendanceRecord.count({ where: { employeeId: employee.id } })).toBe(0);

        // Failed checks don't use up the scan — the retry goes straight through.
        const retry = await recordAttendance({ ...input, location: AT_DESK });
        expect(retry.ok && retry.action).toBe("CLOCK_IN");
        expect(await prisma.attendanceRecord.count({ where: { employeeId: employee.id } })).toBe(1);
      });

      it("refuses every scan while the office has no location saved", async () => {
        await prisma.office.update({ where: { id: officeId }, data: { latitude: null, longitude: null } });
        try {
          const { attendanceId } = await makeEmployee();
          const result = await recordAttendance({
            attendanceIdRaw: attendanceId,
            sourceIp: MOBILE_IP,
            userAgent: "vitest",
            qrSessionToken: await scanQr(),
            location: AT_DESK,
          });
          expect(!result.ok && result.reason).toBe("LOCATION_NOT_CONFIGURED");
        } finally {
          await prisma.office.update({ where: { id: officeId }, data: OFFICE_LOCATION });
        }
      });
    });

    it("records the clock-out's distance too", async () => {
      await prisma.officeNetwork.deleteMany({ where: { officeId } });
      await setMode("QR_ONLY");
      const { attendanceId } = await makeEmployee();
      const input = { attendanceIdRaw: attendanceId, sourceIp: MOBILE_IP, userAgent: "vitest" };

      const clockIn = await recordAttendance({ ...input, qrSessionToken: await scanQr(), location: AT_DESK });
      expect(clockIn.ok).toBe(true);
      if (!clockIn.ok) return;
      // Past the retry window, so the next request is a clock-out.
      await prisma.attendanceRecord.update({
        where: { id: clockIn.record.id },
        data: { clockIn: new Date(Date.now() - 60 * 60_000) },
      });

      const clockOut = await recordAttendance({
        ...input,
        qrSessionToken: await scanQr(),
        location: { ...OFFICE_LOCATION, accuracy: 12 },
        tasks: TASKS,
        earlyClockOutReason: "Leaving early",
      });
      expect(clockOut.ok && clockOut.action).toBe("CLOCK_OUT");
      if (clockOut.ok) {
        expect(clockOut.record.clockOutDistanceMeters).toBe(0);
        expect(clockOut.record.clockOutLocationAccuracyMeters).toBe(12);
      }
    });

    it("ignores a QR scan in Network mode — mobile data stays locked out", async () => {
      await setMode("NETWORK_ONLY");
      const { attendanceId } = await makeEmployee();
      const result = await recordAttendance({
        attendanceIdRaw: attendanceId,
        sourceIp: MOBILE_IP,
        userAgent: "vitest",
        qrSessionToken: await scanQr(),
        location: AT_DESK,
      });
      expect(!result.ok && result.reason).toBe("NETWORK_DENIED");
    });
  });
});
