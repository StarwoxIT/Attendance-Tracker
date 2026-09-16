import type { EmployeeAttendanceScore } from "./query";

export interface ScoreExportRow {
  employee: string;
  early: number;
  onTime: number;
  late: number;
  missedClockOut: number;
  score: string;
}

/** Flattens per-employee scores into plain rows for CSV/Excel export — the same
 * cumulative, ranked data behind the Analytics chart and the Reports "Performance
 * report", just as a table instead of bars. */
export function scoresToExportRows(scores: EmployeeAttendanceScore[]): ScoreExportRow[] {
  return scores.map((s) => ({
    employee: s.employeeName,
    early: s.early,
    onTime: s.onTime,
    late: s.late,
    missedClockOut: s.missedClockOut,
    score: `${Math.round(s.percentage)}%`,
  }));
}
