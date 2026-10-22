import { z } from "zod";
import type { TaskStatus } from "@prisma/client";

// Shared by the register screen (live validation) and the engine (authoritative
// re-check) — like rules.ts, this must stay free of server-only imports.

export const TASK_STATUSES = ["COMPLETED", "PARTIALLY_COMPLETED", "CARRIED_OVER"] as const satisfies readonly TaskStatus[];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  COMPLETED: "Completed",
  PARTIALLY_COMPLETED: "Partially completed",
  CARRIED_OVER: "Carried over to tomorrow",
};

export const MAX_TASKS_PER_REPORT = 20;
export const MAX_TASK_DESCRIPTION_LENGTH = 500;

export const taskReportSchema = z
  .array(
    z.object({
      description: z.string().trim().min(1).max(MAX_TASK_DESCRIPTION_LENGTH),
      status: z.enum(TASK_STATUSES),
    })
  )
  .min(1)
  .max(MAX_TASKS_PER_REPORT);

export type TaskReportInput = z.infer<typeof taskReportSchema>;

export const MAX_NO_TASKS_REASON_LENGTH = 500;

export const noTasksReasonSchema = z.string().trim().min(1).max(MAX_NO_TASKS_REASON_LENGTH);

export type DailyReport = { tasks: TaskReportInput; noTasksReason: null } | { tasks: []; noTasksReason: string };

/** A daily report either lists tasks or explains why there were none — exactly one
 * of the two. Returns null for anything else (both, malformed, or out of limits). */
export function parseDailyReport(tasks: unknown, noTasksReason: unknown): DailyReport | null {
  if (tasks != null && noTasksReason != null) return null;
  if (noTasksReason != null) {
    const reason = noTasksReasonSchema.safeParse(noTasksReason);
    return reason.success ? { tasks: [], noTasksReason: reason.data } : null;
  }
  const parsed = taskReportSchema.safeParse(tasks);
  return parsed.success ? { tasks: parsed.data, noTasksReason: null } : null;
}
