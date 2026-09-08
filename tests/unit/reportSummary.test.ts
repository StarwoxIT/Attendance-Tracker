import { describe, it, expect } from "vitest";
import { buildReportSummary, summaryToLines } from "@/lib/reports/summary";
import { computeAttendanceScore } from "@/lib/analytics/score";
import type { EmployeeAttendanceScore } from "@/lib/analytics/query";

const WEIGHTS = { earlyPoints: 5, onTimePoints: 3, latePoints: 0 };

function scoreRow(employeeId: string, employeeName: string, early: number, onTime: number, late: number): EmployeeAttendanceScore {
  return { employeeId, employeeName, early, onTime, late, ...computeAttendanceScore({ early, onTime, late }, WEIGHTS) };
}

describe("buildReportSummary", () => {
  const scores = [
    scoreRow("1", "Ada Early", 20, 0, 0),
    scoreRow("2", "Bola OnTime", 0, 18, 2),
    scoreRow("3", "Chidi Late", 0, 2, 18),
    scoreRow("4", "Dayo Mixed", 5, 5, 10),
  ];

  it("totals early/on-time/late counts across all employees", () => {
    const summary = buildReportSummary(scores);
    expect(summary.totalEarly).toBe(25);
    expect(summary.totalOnTime).toBe(25);
    expect(summary.totalLate).toBe(30);
  });

  it("ranks the top performers by score, best first", () => {
    const summary = buildReportSummary(scores);
    expect(summary.topPerformers[0]!.name).toBe("Ada Early");
    expect(summary.topPerformers.length).toBeLessThanOrEqual(5);
  });

  it("ranks the most-late employees by late-day count, worst first", () => {
    const summary = buildReportSummary(scores);
    expect(summary.mostLate[0]!.name).toBe("Chidi Late");
    expect(summary.mostLate[0]!.lateDays).toBe(18);
    expect(summary.mostLate.length).toBeLessThanOrEqual(3);
  });

  it("excludes employees with zero late days from the most-late list", () => {
    const summary = buildReportSummary(scores);
    expect(summary.mostLate.some((m) => m.name === "Ada Early")).toBe(false);
  });

  it("handles an empty period without crashing", () => {
    const summary = buildReportSummary([]);
    expect(summary.totalEarly).toBe(0);
    expect(summary.topPerformers).toEqual([]);
    expect(summary.mostLate).toEqual([]);
  });
});

describe("summaryToLines", () => {
  it("renders placeholder text when there are no employees to rank", () => {
    const lines = summaryToLines(buildReportSummary([]));
    expect(lines.some((l) => l.includes("—"))).toBe(true);
  });
});
