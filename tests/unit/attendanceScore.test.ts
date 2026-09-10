import { describe, it, expect } from "vitest";
import { computeAttendanceScore } from "@/lib/analytics/score";

const WEIGHTS = { earlyPoints: 5, onTimePoints: 3, latePoints: 0 };

describe("computeAttendanceScore", () => {
  it("scores 100% for an employee who was early every day", () => {
    const score = computeAttendanceScore({ early: 23, onTime: 0, late: 0 }, WEIGHTS);
    expect(score.markedDays).toBe(23);
    expect(score.weightedSum).toBe(115);
    expect(score.averagePoints).toBe(5);
    expect(score.percentage).toBe(100);
  });

  it("scores 0% for an employee who was late every day (late worth 0 points)", () => {
    const score = computeAttendanceScore({ early: 0, onTime: 0, late: 10 }, WEIGHTS);
    expect(score.averagePoints).toBe(0);
    expect(score.percentage).toBe(0);
  });

  it("ranks a mostly-early employee above a mostly-on-time employee", () => {
    const mostlyEarly = computeAttendanceScore({ early: 15, onTime: 10, late: 5 }, WEIGHTS);
    const mostlyOnTime = computeAttendanceScore({ early: 5, onTime: 15, late: 10 }, WEIGHTS);
    expect(mostlyEarly.percentage).toBeGreaterThan(mostlyOnTime.percentage);
  });

  it("penalizes lateness even when late is assigned a non-zero point value", () => {
    const weights = { earlyPoints: 5, onTimePoints: 3, latePoints: 1 };
    const allOnTime = computeAttendanceScore({ early: 0, onTime: 20, late: 0 }, weights);
    const someLate = computeAttendanceScore({ early: 0, onTime: 15, late: 5 }, weights);
    expect(someLate.percentage).toBeLessThan(allOnTime.percentage);
  });

  it("returns 0 for an employee with no marked days, without dividing by zero", () => {
    const score = computeAttendanceScore({ early: 0, onTime: 0, late: 0 }, WEIGHTS);
    expect(score.markedDays).toBe(0);
    expect(score.averagePoints).toBe(0);
    expect(score.percentage).toBe(0);
  });

  it("caps percentage at 100 even if late is misconfigured higher than early", () => {
    const weights = { earlyPoints: 5, onTimePoints: 3, latePoints: 10 };
    const score = computeAttendanceScore({ early: 0, onTime: 0, late: 10 }, weights);
    expect(score.percentage).toBe(100);
  });
});
