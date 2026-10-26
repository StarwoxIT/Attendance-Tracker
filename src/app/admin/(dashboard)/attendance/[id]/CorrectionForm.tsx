"use client";

import { useActionState, useEffect } from "react";
import { correctAttendanceAction, type CorrectionState } from "@/lib/actions/attendance";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/use-toast";
import { toDateTimeLocalValue } from "@/lib/attendance/rules";
import type { AttendanceRecord } from "@prisma/client";

const initialState: CorrectionState = {};

/** Times are shown and entered as office wall-clock time in `timezone` (Attendance
 * settings), whatever timezone the admin's own device is set to. */
export function CorrectionForm({ record, timezone }: { record: AttendanceRecord; timezone: string }) {
  const action = correctAttendanceAction.bind(null, record.id);
  const [state, formAction, pending] = useActionState(action, initialState);

  useEffect(() => {
    if (state.error) toast({ title: "Correction failed", description: state.error, variant: "destructive" });
    else if (state.success) toast({ title: "Correction saved", variant: "success" });
  }, [state]);

  return (
    <form action={formAction} className="space-y-4">
      <p className="text-xs text-muted-foreground">Times are in office time ({timezone}).</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-sm font-medium">Clock In</label>
          <Input type="datetime-local" name="clockIn" defaultValue={toDateTimeLocalValue(record.clockIn, timezone)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Clock Out</label>
          <Input type="datetime-local" name="clockOut" defaultValue={toDateTimeLocalValue(record.clockOut, timezone)} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Status</label>
          <select name="clockInStatus" defaultValue={record.clockInStatus ?? ""} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="">Unchanged</option>
            <option value="EARLY">Early</option>
            <option value="ON_TIME">On time</option>
            <option value="LATE">Late</option>
            <option value="MISSED_CLOCK_OUT">Missed clock-out</option>
            <option value="ABSENT">Absent</option>
            <option value="MANUALLY_ADJUSTED">Manually adjusted</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">Attendance Type</label>
          <select name="attendanceType" defaultValue={record.attendanceType} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
            <option value="REGULAR">Regular</option>
            <option value="WEEKEND_OVERTIME">Weekend overtime</option>
            <option value="HOLIDAY_OVERTIME">Holiday overtime</option>
          </select>
        </div>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Reason (required)</label>
        <textarea
          name="reason"
          required
          minLength={5}
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          placeholder="Employee forgot to clock out."
        />
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save correction"}
      </Button>
    </form>
  );
}
