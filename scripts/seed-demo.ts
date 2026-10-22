/**
 * Local-development demo data: departments, two offices (one with a network that
 * matches localhost, so /register works under `npm run dev`), ~20 employees across
 * every work arrangement and employment status, ~5 weeks of attendance history
 * (early/on-time/late arrivals, early clock-outs with reasons, missed clock-outs,
 * absences, weekend overtime), a daily task report for every clock-out, holidays, admin users for every role, plus a few
 * corrections, a device flag, a pending deletion request and notifications so no
 * admin page is empty.
 *
 * Refuses to run against anything but a local database. Attendance IDs are only
 * stored as keyed hashes, so the plaintext IDs are printed once at the end — they
 * can't be recovered later (regenerate one from the employee's page if needed).
 *
 * Usage:
 *   npm run db:seed:demo               # into an empty database
 *   npm run db:seed:demo -- --reset    # wipe existing data first (keeps non-demo admin accounts)
 */
import bcrypt from "bcryptjs";
import { fromZonedTime } from "date-fns-tz";
import type { AdminRole, EmploymentStatus, Prisma, WorkArrangement } from "@prisma/client";
import { prisma } from "../src/lib/db/prisma";
import {
  calculateMinutesWorked,
  classifyClockIn,
  classifyClockOut,
  getAttendanceDateKey,
  isWeekend,
} from "../src/lib/attendance/rules";
import { createAttendanceIdCandidate } from "../src/lib/security/attendanceId";

const TZ = "Africa/Lagos";
const HISTORY_DAYS = 35;
const DEMO_EMAIL_DOMAIN = "demo.local";
const DEMO_ADMIN_PASSWORD = "DemoPass!2026";
const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "host.docker.internal"];

// Seeded PRNG so every run produces the same shape of data.
let rngState = 20261021;
function rand(): number {
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
const pick = <T>(items: readonly T[]): T => items[Math.floor(rand() * items.length)]!;
const pad = (n: number) => String(n).padStart(2, "0");
const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const ymd = (dateKey: Date) => dateKey.toISOString().slice(0, 10);

/** An absolute instant at `minutes` past local midnight on the given attendance date. */
function at(dateKey: Date, minutes: number, seconds = 0): Date {
  return fromZonedTime(`${ymd(dateKey)}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}:${pad(seconds)}`, TZ);
}

type Punctuality = "star" | "good" | "average" | "poor";
const PUNCTUALITY: Record<Punctuality, { early: number; late: number }> = {
  star: { early: 0.7, late: 0.03 },
  good: { early: 0.35, late: 0.08 },
  average: { early: 0.15, late: 0.25 },
  poor: { early: 0.05, late: 0.55 },
};

interface DemoEmployee {
  firstName: string;
  lastName: string;
  department: string;
  office: "lagos" | "abuja";
  jobTitle: string;
  punctuality: Punctuality;
  workArrangement?: WorkArrangement;
  onSiteDays?: number[];
  employmentStatus?: EmploymentStatus;
  isDeleted?: boolean;
  workStart?: string;
  workEnd?: string;
  /** Stops generating attendance this many days before today (left / suspended staff). */
  lastSeenDaysAgo?: number;
}

const DEPARTMENTS = ["Engineering", "Finance", "Human Resources", "Operations", "Sales", "Customer Support"];

const EMPLOYEES: DemoEmployee[] = [
  { firstName: "Adaeze", lastName: "Okonkwo", department: "Engineering", office: "lagos", jobTitle: "Engineering Manager", punctuality: "star" },
  { firstName: "Tunde", lastName: "Bakare", department: "Engineering", office: "lagos", jobTitle: "Backend Engineer", punctuality: "good" },
  { firstName: "Chiamaka", lastName: "Eze", department: "Engineering", office: "lagos", jobTitle: "Frontend Engineer", punctuality: "average", workArrangement: "HYBRID", onSiteDays: [1, 3, 5] },
  { firstName: "Ibrahim", lastName: "Musa", department: "Engineering", office: "abuja", jobTitle: "DevOps Engineer", punctuality: "good" },
  { firstName: "Funmilayo", lastName: "Adeyemi", department: "Engineering", office: "lagos", jobTitle: "QA Engineer", punctuality: "poor" },
  { firstName: "Emeka", lastName: "Nwosu", department: "Engineering", office: "lagos", jobTitle: "Mobile Engineer", punctuality: "average", workArrangement: "REMOTE" },
  { firstName: "Ngozi", lastName: "Obi", department: "Finance", office: "lagos", jobTitle: "Finance Lead", punctuality: "star" },
  { firstName: "Segun", lastName: "Afolabi", department: "Finance", office: "lagos", jobTitle: "Accountant", punctuality: "good", workStart: "08:00", workEnd: "16:00" },
  { firstName: "Halima", lastName: "Bello", department: "Finance", office: "abuja", jobTitle: "Accounts Officer", punctuality: "average" },
  { firstName: "Kemi", lastName: "Ogunleye", department: "Human Resources", office: "lagos", jobTitle: "HR Manager", punctuality: "star" },
  { firstName: "Yusuf", lastName: "Abdullahi", department: "Human Resources", office: "abuja", jobTitle: "HR Officer", punctuality: "good", workArrangement: "HYBRID", onSiteDays: [2, 4] },
  { firstName: "Blessing", lastName: "Etim", department: "Operations", office: "lagos", jobTitle: "Operations Manager", punctuality: "good" },
  { firstName: "Olumide", lastName: "Fashola", department: "Operations", office: "lagos", jobTitle: "Logistics Coordinator", punctuality: "poor", workStart: "07:30", workEnd: "15:30" },
  { firstName: "Amina", lastName: "Garba", department: "Operations", office: "abuja", jobTitle: "Office Administrator", punctuality: "average" },
  { firstName: "Chinedu", lastName: "Igwe", department: "Sales", office: "lagos", jobTitle: "Sales Lead", punctuality: "average" },
  { firstName: "Folake", lastName: "Adebayo", department: "Sales", office: "lagos", jobTitle: "Account Executive", punctuality: "poor" },
  { firstName: "Usman", lastName: "Danjuma", department: "Sales", office: "abuja", jobTitle: "Sales Representative", punctuality: "good" },
  { firstName: "Grace", lastName: "Udoh", department: "Customer Support", office: "lagos", jobTitle: "Support Lead", punctuality: "star", workArrangement: "HYBRID", onSiteDays: [1, 2, 3] },
  { firstName: "Daniel", lastName: "Okafor", department: "Customer Support", office: "lagos", jobTitle: "Support Agent", punctuality: "average" },
  { firstName: "Zainab", lastName: "Lawal", department: "Customer Support", office: "lagos", jobTitle: "Support Agent", punctuality: "poor", employmentStatus: "SUSPENDED", lastSeenDaysAgo: 9 },
  { firstName: "Peter", lastName: "Akpan", department: "Sales", office: "lagos", jobTitle: "Sales Representative", punctuality: "average", employmentStatus: "INACTIVE", lastSeenDaysAgo: 15 },
  { firstName: "Bisi", lastName: "Oladipo", department: "Operations", office: "lagos", jobTitle: "Driver", punctuality: "good", employmentStatus: "EXITED", lastSeenDaysAgo: 22 },
  { firstName: "Sola", lastName: "Martins", department: "Finance", office: "lagos", jobTitle: "Intern", punctuality: "average", isDeleted: true, lastSeenDaysAgo: 18 },
];

const EARLY_CLOCKOUT_REASONS = [
  "Hospital appointment, approved by my manager",
  "Child's school called, had to pick them up",
  "Feeling unwell",
  "Client meeting off-site for the rest of the day",
  "Bank visit for company documents",
  "Family emergency",
];

const NO_TASKS_REASONS = [
  "No tasks were assigned to me today.",
  "Spent the day in onboarding and compliance training.",
  "Waiting on access to the new system before I can start my assigned work.",
  "Covered the front desk all day while the receptionist was out.",
];

const DEMO_TASKS: Record<string, string[]> = {
  Engineering: [
    "Fixed the attendance export timeout on large date ranges",
    "Code review for the payroll integration pull request",
    "Wrote unit tests for the leave balance calculator",
    "Investigated slow dashboard queries and added an index",
    "Sprint planning and ticket grooming",
    "Upgraded staging server dependencies",
    "Paired with QA on the mobile login regression",
  ],
  Finance: [
    "Reconciled September vendor invoices",
    "Prepared the weekly cash flow summary",
    "Processed staff expense claims",
    "Followed up on overdue client payments",
    "Drafted the Q4 budget variance report",
    "Filed monthly VAT returns",
  ],
  "Human Resources": [
    "Screened applicants for the support agent role",
    "Onboarded two new staff members",
    "Updated the leave policy document",
    "Scheduled quarterly performance reviews",
    "Processed exit paperwork",
    "Answered staff questions on HMO coverage",
  ],
  Operations: [
    "Coordinated diesel delivery for the generator",
    "Audited office inventory and supplies",
    "Arranged vehicle servicing for the fleet",
    "Followed up with the facility manager on AC repairs",
    "Planned delivery routes for the week",
    "Renewed the internet service contract",
  ],
  Sales: [
    "Called 15 leads from the trade fair list",
    "Prepared a proposal for the Ikeja retail client",
    "Client demo with a prospective logistics customer",
    "Updated the CRM pipeline",
    "Negotiated renewal terms with an existing client",
    "Drafted the monthly sales report",
  ],
  "Customer Support": [
    "Resolved 23 support tickets",
    "Escalated a billing dispute to Finance",
    "Updated FAQ articles on password resets",
    "Called back customers from the weekend queue",
    "Trained a new agent on the ticketing system",
    "Reviewed customer satisfaction survey results",
  ],
};

const DEMO_ADMINS:{ email: string; fullName: string; role: AdminRole }[] = [
  { email: `super@${DEMO_EMAIL_DOMAIN}`, fullName: "Demo Super Admin", role: "SUPER_ADMIN" },
  { email: `admin@${DEMO_EMAIL_DOMAIN}`, fullName: "Demo Admin", role: "ADMIN" },
  { email: `hr@${DEMO_EMAIL_DOMAIN}`, fullName: "Demo HR", role: "HR" },
  { email: `viewer@${DEMO_EMAIL_DOMAIN}`, fullName: "Demo Viewer", role: "VIEWER" },
];

function assertLocalDatabase() {
  let host = "";
  try {
    host = new URL(process.env.DATABASE_URL ?? "").hostname.replace(/^\[|\]$/g, "");
  } catch {
    // fall through to the refusal below
  }
  if (!LOCAL_HOSTS.includes(host)) {
    console.error(`Refusing to seed demo data: DATABASE_URL host is "${host || "(unset)"}", not a local database.`);
    process.exit(1);
  }
}

async function resetDatabase() {
  console.log("Resetting database (keeping non-demo admin accounts)...");
  await prisma.attendanceDeviceFlag.deleteMany();
  await prisma.attendanceCorrection.deleteMany();
  await prisma.attendanceRecord.deleteMany();
  await prisma.qrAttendanceSession.deleteMany();
  await prisma.attendanceQrCode.deleteMany();
  await prisma.networkHeartbeat.deleteMany();
  await prisma.officeNetwork.deleteMany();
  await prisma.employeeDeletionRequest.deleteMany();
  await prisma.attendanceIdHistory.deleteMany();
  await prisma.employee.deleteMany();
  await prisma.department.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.holiday.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.office.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.user.deleteMany({ where: { email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` } } });
}

async function main() {
  assertLocalDatabase();

  if (process.argv.includes("--reset")) {
    await resetDatabase();
  } else if ((await prisma.employee.count()) > 0) {
    console.error("Database already has employees. Re-run with --reset to wipe it and reseed: npm run db:seed:demo -- --reset");
    process.exit(1);
  }

  // --- Settings ---------------------------------------------------------------
  await prisma.companySettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", companyName: "Demo Company Ltd" },
    update: { companyName: "Demo Company Ltd" },
  });
  // NETWORK_ONLY so /register works locally without scanning a QR; switch it back
  // under Settings to test the QR flow.
  const settings = await prisma.attendanceSettings.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", timezone: TZ, attendanceMode: "NETWORK_ONLY" },
    update: { timezone: TZ, attendanceMode: "NETWORK_ONLY" },
  });

  // --- Admin users ------------------------------------------------------------
  const passwordHash = await bcrypt.hash(DEMO_ADMIN_PASSWORD, 12);
  const admins: Record<AdminRole, string> = {} as Record<AdminRole, string>;
  for (const a of DEMO_ADMINS) {
    const user = await prisma.user.create({ data: { ...a, passwordHash } });
    admins[a.role] = user.id;
  }

  // --- Organization -----------------------------------------------------------
  const departments = new Map<string, string>();
  for (const name of DEPARTMENTS) {
    departments.set(name, (await prisma.department.create({ data: { name } })).id);
  }

  const lagos = await prisma.office.create({
    data: { name: "Lagos HQ", address: "12 Admiralty Way, Lekki Phase 1, Lagos", timezone: TZ },
  });
  const abuja = await prisma.office.create({
    data: { name: "Abuja Branch", address: "Plot 45 Aminu Kano Crescent, Wuse 2, Abuja", timezone: TZ },
  });
  const offices = { lagos: lagos.id, abuja: abuja.id };

  const now = new Date();
  // Lagos matches localhost (how `npm run dev` sees your browser), so clock-ins
  // there succeed locally. Abuja is deliberately stale + fail-closed, so its staff
  // are denied — useful for testing the denial path and the Super Admin alert.
  const lagosNetwork = await prisma.officeNetwork.create({
    data: {
      officeId: lagos.id,
      name: "Lagos HQ Starlink (local dev)",
      currentPublicIp: "::1",
      cidr: "127.0.0.0/8",
      status: "VERIFIED",
      lastVerifiedAt: now,
      failMode: "FAIL_OPEN",
    },
  });
  await prisma.officeNetwork.create({
    data: {
      officeId: abuja.id,
      name: "Abuja Starlink",
      currentPublicIp: "102.88.14.201",
      status: "STALE",
      lastVerifiedAt: new Date(now.getTime() - 3 * 60 * 60_000),
      failMode: "FAIL_CLOSED",
    },
  });
  await prisma.networkHeartbeat.createMany({
    data: Array.from({ length: 6 }, (_, i) => ({
      officeNetworkId: lagosNetwork.id,
      agentId: "demo-agent-lagos",
      sourceIp: "102.89.34.12",
      reportedIp: "102.89.34.12",
      timestamp: new Date(now.getTime() - i * 10 * 60_000),
      status: "OK",
    })),
  });

  // --- Holidays ---------------------------------------------------------------
  const holidays = [
    { name: "Independence Day", date: "2026-10-01" },
    { name: "Christmas Day", date: "2026-12-25" },
    { name: "Boxing Day", date: "2026-12-26" },
    { name: "New Year's Day", date: "2027-01-01" },
  ];
  await prisma.holiday.createMany({
    data: holidays.map((h) => ({ name: h.name, date: new Date(`${h.date}T00:00:00.000Z`) })),
  });
  const holidayDates = new Set(holidays.map((h) => h.date));

  // --- Employees --------------------------------------------------------------
  const created: { id: string; spec: DemoEmployee; attendanceId: string; deviceId: string }[] = [];
  for (const [i, spec] of EMPLOYEES.entries()) {
    const { plaintext, lookup } = createAttendanceIdCandidate();
    const employee = await prisma.employee.create({
      data: {
        employeeNumber: `EMP-${String(i + 1).padStart(4, "0")}`,
        attendanceIdLookup: lookup,
        firstName: spec.firstName,
        lastName: spec.lastName,
        email: `${spec.firstName}.${spec.lastName}@${DEMO_EMAIL_DOMAIN}`.toLowerCase(),
        phone: `+234 80${between(1, 9)} ${between(100, 999)} ${between(1000, 9999)}`,
        departmentId: departments.get(spec.department)!,
        jobTitle: spec.jobTitle,
        employmentStatus: spec.employmentStatus ?? "ACTIVE",
        dateEmployed: new Date(`${between(2019, 2025)}-${pad(between(1, 12))}-${pad(between(1, 28))}T00:00:00.000Z`),
        officeId: offices[spec.office],
        workStart: spec.workStart ?? null,
        workEnd: spec.workEnd ?? null,
        workArrangement: spec.workArrangement ?? "ON_SITE",
        onSiteDays: spec.onSiteDays ?? [],
        isDeleted: spec.isDeleted ?? false,
        deletedAt: spec.isDeleted ? new Date(now.getTime() - (spec.lastSeenDaysAgo ?? 0) * 86_400_000) : null,
      },
    });
    created.push({ id: employee.id, spec, attendanceId: plaintext, deviceId: `demo-device-${i + 1}` });
  }

  // --- Attendance history -------------------------------------------------------
  const todayKey = getAttendanceDateKey(now, TZ);
  const records: Prisma.AttendanceRecordCreateManyInput[] = [];

  for (let daysAgo = HISTORY_DAYS; daysAgo >= 0; daysAgo--) {
    const dateKey = new Date(todayKey.getTime() - daysAgo * 86_400_000);
    const midday = at(dateKey, 12 * 60);
    const weekend = isWeekend(midday, TZ);
    const holiday = holidayDates.has(ymd(dateKey));
    const isoWeekday = ((dateKey.getUTCDay() + 6) % 7) + 1;

    for (const emp of created) {
      const { spec } = emp;
      if (spec.workArrangement === "REMOTE") continue;
      if (spec.lastSeenDaysAgo !== undefined && daysAgo < spec.lastSeenDaysAgo) continue;
      if (weekend || holiday) {
        if (spec.workArrangement === "HYBRID" || rand() > 0.04) continue; // occasional overtime
      } else {
        if (spec.workArrangement === "HYBRID" && !spec.onSiteDays?.includes(isoWeekday)) continue;
        if (rand() < 0.05) continue; // absent
      }

      const workStart = spec.workStart ?? settings.workStart;
      const workEnd = spec.workEnd ?? settings.workEnd;
      const startMin = toMinutes(workStart);
      const { early, late } = PUNCTUALITY[spec.punctuality];
      const roll = rand();
      const arrivalMin =
        roll < early
          ? startMin - between(5, 45)
          : roll < early + late
            ? startMin + settings.gracePeriodMinutes + between(1, 75)
            : startMin + between(0, settings.gracePeriodMinutes - 1);
      const clockIn = at(dateKey, arrivalMin, between(0, 59));
      if (clockIn > now) continue; // hasn't arrived yet today

      const classification = classifyClockIn(
        clockIn,
        { ...settings, workStart },
        { isWeekendDay: weekend, isHoliday: holiday }
      );
      const base: Prisma.AttendanceRecordCreateManyInput = {
        employeeId: emp.id,
        officeId: offices[spec.office],
        attendanceDate: dateKey,
        clockIn,
        clockInStatus: classification.status,
        attendanceType: classification.attendanceType,
        minutesLate: classification.minutesLate,
        clockInIp: "102.89.34.12",
        clockInUserAgent: "Mozilla/5.0 (Linux; Android 14) Demo",
        clockInNetworkId: spec.office === "lagos" ? lagosNetwork.id : null,
        clockInDeviceId: emp.deviceId,
        verificationMethod: "QR_NETWORK",
      };

      if (daysAgo === 0) {
        records.push(base); // still at work today
        continue;
      }

      const outRoll = rand();
      if (outRoll < 0.06) {
        // Mirrors what the nightly housekeeping job does to a dangling record.
        records.push({ ...base, clockInStatus: "MISSED_CLOCK_OUT" });
        continue;
      }
      const endMin = toMinutes(workEnd);
      const leftEarly = outRoll < 0.14;
      const clockOut = at(dateKey, leftEarly ? endMin - between(20, 150) : endMin + between(0, 75), between(0, 59));
      const clockOutStatus = classifyClockOut(clockOut, { timezone: TZ, workEnd });
      records.push({
        ...base,
        clockOut,
        clockOutStatus,
        earlyClockOutReason: clockOutStatus === "EARLY" ? pick(EARLY_CLOCKOUT_REASONS) : null,
        clockOutIp: "102.89.34.12",
        clockOutUserAgent: "Mozilla/5.0 (Linux; Android 14) Demo",
        clockOutNetworkId: base.clockInNetworkId,
        clockOutDeviceId: emp.deviceId,
        totalMinutesWorked: calculateMinutesWorked(clockIn, clockOut),
      });
    }
  }
  const saved = await prisma.attendanceRecord.createManyAndReturn({ data: records });

  // --- Daily task reports (every completed clock-out has one) ---------------------
  const clockedOut = saved.filter((r) => r.clockOut);
  const reports = await prisma.dailyTaskReport.createManyAndReturn({
    data: clockedOut.map((r) => ({
      attendanceRecordId: r.id,
      employeeId: r.employeeId,
      attendanceDate: r.attendanceDate,
      submittedAt: r.clockOut!,
      // A few days where the employee had nothing to report and said why instead.
      noTasksReason: rand() < 0.05 ? pick(NO_TASKS_REASONS) : null,
    })),
  });
  const tasks: Prisma.DailyTaskCreateManyInput[] = [];
  for (const report of reports) {
    if (report.noTasksReason) continue;
    const department = created.find((e) => e.id === report.employeeId)!.spec.department;
    const pool = [...DEMO_TASKS[department]!];
    const count = between(1, 4);
    for (let position = 0; position < count && pool.length > 0; position++) {
      const description = pool.splice(Math.floor(rand() * pool.length), 1)[0]!;
      const roll = rand();
      const status = roll < 0.65 ? "COMPLETED" : roll < 0.88 ? "PARTIALLY_COMPLETED" : "CARRIED_OVER";
      tasks.push({ reportId: report.id, position, description, status });
    }
  }
  await prisma.dailyTask.createMany({ data: tasks });

  // --- Admin corrections on a few missed clock-outs -----------------------------
  const missed = saved.filter((r) => r.clockInStatus === "MISSED_CLOCK_OUT").slice(0, 3);
  for (const record of missed) {
    const emp = created.find((e) => e.id === record.employeeId)!;
    const clockOut = at(record.attendanceDate, toMinutes(emp.spec.workEnd ?? settings.workEnd) + 10);
    const reason = "Employee forgot to clock out; departure time confirmed with line manager.";
    // Admin-added clock-outs carry no task report, same as a real correction.
    await prisma.attendanceRecord.update({
      where: { id: record.id },
      data: {
        clockOut,
        clockOutStatus: "ON_TIME",
        totalMinutesWorked: calculateMinutesWorked(record.clockIn!, clockOut),
        manualAdjustment: true,
        verificationMethod: "MANUAL_ADMIN",
      },
    });
    await prisma.attendanceCorrection.create({
      data: {
        attendanceRecordId: record.id,
        changedById: admins.HR,
        field: "clockOut",
        originalValue: null,
        newValue: clockOut.toISOString(),
        reason,
        ipAddress: "127.0.0.1",
      },
    });
    await prisma.auditLog.create({
      data: {
        userId: admins.HR,
        action: "attendance.corrected",
        resource: "attendance_record",
        resourceId: record.id,
        newValue: JSON.stringify([{ field: "clockOut", value: clockOut.toISOString() }]),
        reason,
        ipAddress: "127.0.0.1",
      },
    });
  }

  // --- Device flags: two Lagos employees sharing one phone ------------------------
  const [owner, borrower] = created.filter((e) => e.spec.office === "lagos" && !e.spec.workArrangement);
  const sharedDays = saved
    .filter((r) => r.employeeId === borrower!.id && r.attendanceDate < todayKey)
    .slice(-2);
  for (const record of sharedDays) {
    await prisma.attendanceRecord.update({ where: { id: record.id }, data: { clockInDeviceId: owner!.deviceId } });
    await prisma.attendanceDeviceFlag.create({
      data: {
        deviceId: owner!.deviceId,
        attendanceRecordId: record.id,
        employeeId: borrower!.id,
        previousEmployeeId: owner!.id,
      },
    });
  }

  // --- Pending deletion request + notifications ---------------------------------
  const exited = created.find((e) => e.spec.employmentStatus === "EXITED")!;
  await prisma.employeeDeletionRequest.create({
    data: {
      employeeId: exited.id,
      requestedById: admins.HR,
      reason: "Left the company three weeks ago; exit process completed.",
    },
  });
  await prisma.notification.createMany({
    data: [
      {
        type: "EMPLOYEE_DELETION_REQUESTED",
        targetRole: "SUPER_ADMIN",
        title: `Deletion requested: ${exited.spec.firstName} ${exited.spec.lastName}`,
        message: `Demo HR (HR) requested to delete ${exited.spec.firstName} ${exited.spec.lastName}. Reason: "Left the company three weeks ago; exit process completed."`,
      },
      {
        type: "NETWORK_IP_CHANGED",
        targetRole: "SUPER_ADMIN",
        officeId: abuja.id,
        title: "Abuja Branch: employees can't clock in — network IP changed",
        message:
          "An employee at Abuja Branch was just blocked from clocking in because its authorized network hasn't re-verified recently and is being treated as no longer active. Re-authorize the current network from Offices & Network, or check the network agent.",
      },
    ],
  });

  // --- Summary ---------------------------------------------------------------
  console.log(
    `\nSeeded ${created.length} employees, ${saved.length} attendance records and ${reports.length} daily task reports.\n`
  );
  console.log(`Admin logins (password for all: ${DEMO_ADMIN_PASSWORD}):`);
  for (const a of DEMO_ADMINS) console.log(`  ${a.role.padEnd(12)} ${a.email}`);
  console.log("\nAttendance IDs (shown once — only hashes are stored):");
  console.table(
    created.map((e) => ({
      name: `${e.spec.firstName} ${e.spec.lastName}`,
      attendanceId: e.attendanceId,
      office: e.spec.office === "lagos" ? "Lagos HQ" : "Abuja Branch",
      arrangement: e.spec.workArrangement ?? "ON_SITE",
      status: e.spec.isDeleted ? "DELETED" : (e.spec.employmentStatus ?? "ACTIVE"),
    }))
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
