import { describe, it, expect } from "vitest";
import { MAX_TASKS_PER_REPORT, parseDailyReport, taskReportSchema } from "@/lib/attendance/taskReport";

describe("taskReportSchema", () => {
  it("accepts multiple tasks with independent statuses and trims descriptions", () => {
    const parsed = taskReportSchema.parse([
      { description: "  Fixed login bug  ", status: "COMPLETED" },
      { description: "Wrote release notes", status: "PARTIALLY_COMPLETED" },
      { description: "Migrate reports", status: "CARRIED_OVER" },
    ]);
    expect(parsed.map((t) => t.status)).toEqual(["COMPLETED", "PARTIALLY_COMPLETED", "CARRIED_OVER"]);
    expect(parsed[0]!.description).toBe("Fixed login bug");
  });

  it.each([
    ["no tasks", []],
    ["a blank description", [{ description: " ", status: "COMPLETED" }]],
    ["a 501-character description", [{ description: "a".repeat(501), status: "COMPLETED" }]],
    ["an unknown status", [{ description: "x", status: "IN_PROGRESS" }]],
    ["a missing status", [{ description: "x" }]],
    ["not an array", { description: "x", status: "COMPLETED" }],
    [
      "too many tasks",
      Array.from({ length: MAX_TASKS_PER_REPORT + 1 }, () => ({ description: "x", status: "COMPLETED" })),
    ],
  ])("rejects %s", (_label, input) => {
    expect(taskReportSchema.safeParse(input).success).toBe(false);
  });
});

describe("parseDailyReport", () => {
  const TASKS = [{ description: "Fixed login bug", status: "COMPLETED" }];

  it("accepts a task list", () => {
    expect(parseDailyReport(TASKS, undefined)).toEqual({ tasks: TASKS, noTasksReason: null });
  });

  it("accepts a trimmed no-tasks reason in place of tasks", () => {
    expect(parseDailyReport(undefined, "  No tasks assigned today ")).toEqual({
      tasks: [],
      noTasksReason: "No tasks assigned today",
    });
  });

  it.each([
    ["both tasks and a reason", TASKS, "No tasks"],
    ["a blank reason", undefined, "   "],
    ["a 501-character reason", undefined, "a".repeat(501)],
    ["a non-string reason", undefined, 42],
    ["an invalid task list", [], undefined],
  ])("rejects %s", (_label, tasks, reason) => {
    expect(parseDailyReport(tasks, reason)).toBeNull();
  });
});
