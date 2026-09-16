"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateAttendanceSettingsAction } from "@/lib/actions/settings";
import { toast, toastError } from "@/hooks/use-toast";
import type { AttendanceSettings } from "@prisma/client";

export function AttendanceSettingsForm({ settings }: { settings: AttendanceSettings }) {
  const [pending, startTransition] = useTransition();

  function submit(fd: FormData) {
    startTransition(async () => {
      try {
        await updateAttendanceSettingsAction(fd);
        toast({ title: "Attendance settings saved", variant: "success" });
      } catch (err) {
        toastError(err, "Couldn't save settings");
      }
    });
  }

  return (
    <form action={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3">
      <div>
        <label className="mb-1 block text-sm font-medium">Timezone</label>
        <Input name="timezone" defaultValue={settings.timezone} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Work start</label>
        <Input type="time" name="workStart" defaultValue={settings.workStart} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Grace period (minutes)</label>
        <Input type="number" name="gracePeriodMinutes" defaultValue={settings.gracePeriodMinutes} min={0} max={180} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Work end</label>
        <Input type="time" name="workEnd" defaultValue={settings.workEnd} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Attendance mode</label>
        <select name="attendanceMode" defaultValue={settings.attendanceMode} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm">
          <option value="NETWORK_ONLY">Network only</option>
          <option value="QR_AND_NETWORK">QR + Network (recommended)</option>
          <option value="QR_ONLY">QR only</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">QR session length (minutes)</label>
        <Input type="number" name="qrSessionMinutes" defaultValue={settings.qrSessionMinutes} min={1} max={120} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Heartbeat interval (minutes)</label>
        <Input type="number" name="networkHeartbeatIntervalMinutes" defaultValue={settings.networkHeartbeatIntervalMinutes} min={1} max={120} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Stale threshold (minutes)</label>
        <Input type="number" name="networkStaleThresholdMinutes" defaultValue={settings.networkStaleThresholdMinutes} min={1} max={1440} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Register reset (seconds)</label>
        <Input type="number" name="kioskResetSeconds" defaultValue={settings.kioskResetSeconds} min={2} max={60} />
      </div>

      <div className="col-span-full flex flex-wrap gap-6 pt-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="weekendIsOvertime" defaultChecked={settings.weekendIsOvertime} /> Weekend attendance is overtime
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="holidayIsOvertime" defaultChecked={settings.holidayIsOvertime} /> Holiday attendance is overtime
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="crossOfficeAttendance" defaultChecked={settings.crossOfficeAttendance} /> Allow cross-office QR/network
        </label>
      </div>

      <div className="col-span-full border-t pt-4">
        <p className="text-sm font-medium">Performance score weights</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Early and on-time points are <strong>awarded</strong> per day on the Analytics dashboard and in report
          summaries. Late and missed clock-out points are <strong>deducted</strong> instead — a value of 3 means 3
          points subtracted from that employee&apos;s score for each occurrence, not 3 points added.
        </p>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Early (points/day)</label>
        <Input type="number" name="earlyPoints" defaultValue={settings.earlyPoints} min={0} max={100} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">On time (points/day)</label>
        <Input type="number" name="onTimePoints" defaultValue={settings.onTimePoints} min={0} max={100} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Late (penalty points/day)</label>
        <Input type="number" name="latePoints" defaultValue={settings.latePoints} min={0} max={100} />
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Missed clock-out (penalty points/day)</label>
        <Input type="number" name="missedClockOutPoints" defaultValue={settings.missedClockOutPoints} min={0} max={100} />
      </div>

      <div className="col-span-full">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save attendance settings"}
        </Button>
      </div>
    </form>
  );
}
