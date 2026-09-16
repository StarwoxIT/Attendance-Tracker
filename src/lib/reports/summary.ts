import type { EmployeeAttendanceScore } from "@/lib/analytics/query";

export interface ReportSummary {
  totalEarly: number;
  totalOnTime: number;
  totalLate: number;
  totalMissedClockOut: number;
  topPerformers: { name: string; percentage: number }[];
  mostLate: { name: string; lateDays: number }[];
}

/** Summary shown before the data table in PDF/Excel report exports — see summaryToLines. */
export function buildReportSummary(scores: EmployeeAttendanceScore[]): ReportSummary {
  const totals = scores.reduce(
    (acc, s) => ({
      totalEarly: acc.totalEarly + s.early,
      totalOnTime: acc.totalOnTime + s.onTime,
      totalLate: acc.totalLate + s.late,
      totalMissedClockOut: acc.totalMissedClockOut + s.missedClockOut,
    }),
    { totalEarly: 0, totalOnTime: 0, totalLate: 0, totalMissedClockOut: 0 }
  );

  const topPerformers = [...scores]
    .filter((s) => s.markedDays > 0)
    .sort((a, b) => b.percentage - a.percentage)
    .slice(0, 5)
    .map((s) => ({ name: s.employeeName, percentage: Math.round(s.percentage) }));

  const mostLate = [...scores]
    .filter((s) => s.late > 0)
    .sort((a, b) => b.late - a.late)
    .slice(0, 3)
    .map((s) => ({ name: s.employeeName, lateDays: s.late }));

  return { ...totals, topPerformers, mostLate };
}

export function summaryToLines(summary: ReportSummary): string[] {
  const lines: string[] = [
    `Early arrivals: ${summary.totalEarly}  ·  On-time arrivals: ${summary.totalOnTime}  ·  Late arrivals: ${summary.totalLate}  ·  Missed clock-outs: ${summary.totalMissedClockOut}`,
  ];
  lines.push(
    summary.topPerformers.length
      ? `Top performers (early/on-time): ${summary.topPerformers.map((p) => `${p.name} (${p.percentage}%)`).join(", ")}`
      : "Top performers (early/on-time): —"
  );
  lines.push(
    summary.mostLate.length
      ? `Most late: ${summary.mostLate.map((p) => `${p.name} (${p.lateDays} day${p.lateDays === 1 ? "" : "s"})`).join(", ")}`
      : "Most late: —"
  );
  return lines;
}
