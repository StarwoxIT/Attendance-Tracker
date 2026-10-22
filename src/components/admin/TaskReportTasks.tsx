import type { DailyTask, TaskStatus } from "@prisma/client";
import { TASK_STATUS_LABELS } from "@/lib/attendance/taskReport";

export const TASK_STATUS_STYLES: Record<TaskStatus, string> = {
  COMPLETED: "bg-green-100 text-green-700",
  PARTIALLY_COMPLETED: "bg-amber-100 text-amber-800",
  CARRIED_OVER: "bg-blue-100 text-blue-700",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TASK_STATUS_STYLES[status]}`}>
      {TASK_STATUS_LABELS[status]}
    </span>
  );
}

/** The tasks of one daily report, in the order the employee listed them — or, for a
 * "no tasks today" report, the employee's explanation. */
export function TaskReportTasks({
  tasks,
  noTasksReason,
}: {
  tasks: Pick<DailyTask, "id" | "description" | "status">[];
  noTasksReason: string | null;
}) {
  if (noTasksReason !== null) {
    return (
      <div className="space-y-1 text-sm">
        <span className="inline-block rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          No tasks to report
        </span>
        <p className="whitespace-pre-line break-words">&ldquo;{noTasksReason}&rdquo;</p>
      </div>
    );
  }
  return (
    <ol className="space-y-2">
      {tasks.map((task, index) => (
        <li key={task.id} className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:justify-between sm:gap-4">
          <p className="min-w-0 whitespace-pre-line break-words">
            <span className="mr-1 text-muted-foreground">{index + 1}.</span>
            {task.description}
          </p>
          <TaskStatusBadge status={task.status} />
        </li>
      ))}
    </ol>
  );
}
