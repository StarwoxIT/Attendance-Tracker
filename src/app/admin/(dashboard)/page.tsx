import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/PageHeader";
import { getTodaySummary, getWeeklyTrend } from "@/lib/dashboard/summary";
import { WeeklyTrendChart } from "./WeeklyTrendChart";
import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/lib/db/prisma";
import { ATTENDANCE_MODE_LABELS } from "@/lib/attendance/modes";

export const dynamic = "force-dynamic";

const STAT_LABELS: { key: keyof Awaited<ReturnType<typeof getTodaySummary>>["summary"]; label: string }[] = [
  { key: "totalEmployees", label: "Total Employees" },
  { key: "present", label: "Present" },
  { key: "notClockedIn", label: "Not Clocked In" },
  { key: "early", label: "Early" },
  { key: "onTime", label: "On Time" },
  { key: "late", label: "Late" },
  { key: "currentlyInOffice", label: "Currently In Office" },
  { key: "clockedOut", label: "Clocked Out" },
  { key: "overtime", label: "Overtime" },
];

export default async function AdminDashboardPage() {
  const [{ settings, summary }, trend, networks, unreviewedDeviceFlags] = await Promise.all([
    getTodaySummary(),
    getWeeklyTrend(),
    prisma.officeNetwork.findMany({ where: { status: { not: "DISABLED" } } }),
    prisma.attendanceDeviceFlag.count({ where: { reviewed: false } }),
  ]);

  const now = new Date();
  const staleNetworks = networks.filter((n) => {
    const last = n.lastVerifiedAt?.getTime() ?? 0;
    return now.getTime() - last > settings.networkStaleThresholdMinutes * 60_000;
  });

  return (
    <>
      <PageHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Dashboard</h1>
            <p className="text-sm text-muted-foreground">
              {formatInTimeZone(now, settings.timezone, "EEEE, d MMMM yyyy — h:mm a")} ({settings.timezone})
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            <span className="rounded-full bg-primary/10 px-3 py-1 font-medium text-primary">
              {ATTENDANCE_MODE_LABELS[settings.attendanceMode]}
            </span>
          </div>
        </div>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      {staleNetworks.length > 0 ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800">
          ⚠ {staleNetworks.length} office network{staleNetworks.length > 1 ? "s" : ""} have not sent a heartbeat
          recently and may be treated as STALE. Check Offices &amp; Network.
        </div>
      ) : null}

      {unreviewedDeviceFlags > 0 ? (
        <Link
          href="/admin/device-flags"
          className="block rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-800 hover:bg-amber-100"
        >
          ⚠ {unreviewedDeviceFlags} device flag{unreviewedDeviceFlags > 1 ? "s" : ""} need review — a device
          clocked in as an employee it wasn&apos;t previously used by. Review now →
        </Link>
      ) : null}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
        {STAT_LABELS.map(({ key, label }) => (
          <Card key={key}>
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{summary[key]}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Attendance — last 7 days</CardTitle>
        </CardHeader>
        <CardContent>
          <WeeklyTrendChart data={trend} />
        </CardContent>
      </Card>
      </div>
    </>
  );
}
