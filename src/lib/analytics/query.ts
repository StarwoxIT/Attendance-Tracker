import { prisma } from "@/lib/db/prisma";
import { computeAttendanceScore, type AttendanceScore, type ScoreWeights } from "./score";

export interface EmployeeAttendanceScore extends AttendanceScore {
  employeeId: string;
  employeeName: string;
  early: number;
  onTime: number;
  late: number;
}

export interface AttendanceScoreRangeParams {
  /** Omit either bound for an open-ended range (e.g. a report with no date filter). */
  from?: Date;
  to?: Date;
  officeId?: string;
  departmentId?: string;
  weights: ScoreWeights;
}

/**
 * Per-employee performance scores for a date range. Only EARLY/ON_TIME/LATE days
 * count toward the score — a day later flagged MISSED_CLOCK_OUT, ABSENT, or
 * MANUALLY_ADJUSTED has no recoverable arrival classification (housekeeping
 * overwrites clockInStatus in place), so it's excluded rather than guessed at.
 */
export async function fetchAttendanceScores(params: AttendanceScoreRangeParams): Promise<EmployeeAttendanceScore[]> {
  const { from, to, officeId, departmentId, weights } = params;

  const records = await prisma.attendanceRecord.findMany({
    where: {
      ...((from || to) && { attendanceDate: { ...(from && { gte: from }), ...(to && { lte: to }) } }),
      ...(officeId ? { officeId } : {}),
      // REMOTE employees are never expected to clock in, so there's nothing
      // meaningful to score — excluded from Analytics entirely rather than just
      // scoring 0%. Fully remote staff can still clock in if they want to; this
      // only affects ranking/scoring, not who's allowed to use the kiosk.
      employee: { isDeleted: false, workArrangement: { not: "REMOTE" }, ...(departmentId ? { departmentId } : {}) },
    },
    select: {
      employeeId: true,
      clockInStatus: true,
      employee: { select: { firstName: true, lastName: true } },
    },
  });

  const byEmployee = new Map<string, { name: string; early: number; onTime: number; late: number }>();
  for (const r of records) {
    if (r.clockInStatus !== "EARLY" && r.clockInStatus !== "ON_TIME" && r.clockInStatus !== "LATE") continue;

    const entry = byEmployee.get(r.employeeId) ?? {
      name: `${r.employee.firstName} ${r.employee.lastName}`,
      early: 0,
      onTime: 0,
      late: 0,
    };
    if (r.clockInStatus === "EARLY") entry.early += 1;
    else if (r.clockInStatus === "ON_TIME") entry.onTime += 1;
    else entry.late += 1;
    byEmployee.set(r.employeeId, entry);
  }

  const results: EmployeeAttendanceScore[] = [];
  for (const [employeeId, { name, early, onTime, late }] of byEmployee) {
    results.push({ employeeId, employeeName: name, early, onTime, late, ...computeAttendanceScore({ early, onTime, late }, weights) });
  }

  return results.sort((a, b) => b.percentage - a.percentage || a.employeeName.localeCompare(b.employeeName));
}
