import { describe, it, expect } from "vitest";
import { computeAttendanceScore } from "@/lib/analytics/score";

const WEIGHTS = { earlyPoints: 5, onTimePoints: 3, latePoints: 0, missedClockOutPoints: 2 };

describe("computeAttendanceScore", () => {
  it("scores 100% for an employee who was early every day", () => {
    const score = computeAttendanceScore({ early: 23, onTime: 0, late: 0, missedClockOut: 0 }, WEIGHTS);
    expect(score.markedDays).toBe(23);
    expect(score.grossPoints).toBe(115);
    expect(score.penaltyPoints).toBe(0);
    expect(score.netPoints).toBe(115);
    expect(score.averagePoints).toBe(5);
    expect(score.percentage).toBe(100);
  });

  it("scores 0% for an employee who was late every day (late worth 0 penalty points)", () => {
    const score = computeAttendanceScore({ early: 0, onTime: 0, late: 10, missedClockOut: 0 }, WEIGHTS);
    expect(score.averagePoints).toBe(0);
    expect(score.percentage).toBe(0);
  });

  it("ranks a mostly-early employee above a mostly-on-time employee", () => {
    const mostlyEarly = computeAttendanceScore({ early: 15, onTime: 10, late: 5, missedClockOut: 0 }, WEIGHTS);
    const mostlyOnTime = computeAttendanceScore({ early: 5, onTime: 15, late: 10, missedClockOut: 0 }, WEIGHTS);
    expect(mostlyEarly.percentage).toBeGreaterThan(mostlyOnTime.percentage);
  });

  it("deducts a configured penalty per late day, rather than adding a low positive value", () => {
    const weights = { earlyPoints: 5, onTimePoints: 3, latePoints: 3, missedClockOutPoints: 2 };
    const allOnTime = computeAttendanceScore({ early: 0, onTime: 20, late: 0, missedClockOut: 0 }, weights);
    const someLate = computeAttendanceScore({ early: 0, onTime: 15, late: 5, missedClockOut: 0 }, weights);
    // 15 on-time = 45 gross; 5 late = 15 penalty; net = 30 over 20 days = 1.5 avg (vs. 3 avg for all on-time).
    expect(someLate.grossPoints).toBe(45);
    expect(someLate.penaltyPoints).toBe(15);
    expect(someLate.netPoints).toBe(30);
    expect(someLate.percentage).toBeLessThan(allOnTime.percentage);
  });

  it("deducts a configured penalty per missed clock-out", () => {
    const score = computeAttendanceScore({ early: 0, onTime: 18, late: 0, missedClockOut: 2 }, WEIGHTS);
    // 18 on-time = 54 gross; 2 missed clock-outs * 2 = 4 penalty; net = 50 over 20 days.
    expect(score.grossPoints).toBe(54);
    expect(score.penaltyPoints).toBe(4);
    expect(score.netPoints).toBe(50);
    expect(score.markedDays).toBe(20);
  });

  it("floors the percentage at 0 when penalties exceed gross points, never goes negative", () => {
    const weights = { earlyPoints: 5, onTimePoints: 3, latePoints: 10, missedClockOutPoints: 10 };
    const score = computeAttendanceScore({ early: 0, onTime: 2, late: 8, missedClockOut: 0 }, weights);
    // 2 on-time = 6 gross; 8 late * 10 = 80 penalty; net deeply negative.
    expect(score.netPoints).toBeLessThan(0);
    expect(score.percentage).toBe(0);
  });

  it("returns 0 for an employee with no marked days, without dividing by zero", () => {
    const score = computeAttendanceScore({ early: 0, onTime: 0, late: 0, missedClockOut: 0 }, WEIGHTS);
    expect(score.markedDays).toBe(0);
    expect(score.averagePoints).toBe(0);
    expect(score.percentage).toBe(0);
  });

  it("counts missed clock-outs toward markedDays like any other attended day", () => {
    const score = computeAttendanceScore({ early: 5, onTime: 0, late: 0, missedClockOut: 5 }, WEIGHTS);
    expect(score.markedDays).toBe(10);
  });
});
