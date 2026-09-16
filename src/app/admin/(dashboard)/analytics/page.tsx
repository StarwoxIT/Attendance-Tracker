import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/guard";
import { PageHeader } from "@/components/admin/PageHeader";
import { getAttendanceSettings } from "@/lib/attendance/settings";
import { fetchAttendanceScores } from "@/lib/analytics/query";
import { todayRange, thisWeekRange, thisMonthRange, type DateRangeStrings } from "@/lib/analytics/dateRanges";
import { AnalyticsChart } from "./AnalyticsChart";
import { FullScreenToggle } from "./FullScreenToggle";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; officeId?: string }>;
}) {
  await requirePermission("analytics", "view");

  const [settings, offices] = await Promise.all([
    getAttendanceSettings(),
    prisma.office.findMany({ orderBy: { name: "asc" } }),
  ]);
  const { from: paramFrom, to: paramTo, officeId } = await searchParams;
  const defaultRange = thisMonthRange(settings.timezone);
  const from = paramFrom || defaultRange.from;
  const to = paramTo || defaultRange.to;

  const scores = await fetchAttendanceScores({
    from: new Date(`${from}T00:00:00Z`),
    to: new Date(`${to}T00:00:00Z`),
    officeId: officeId || undefined,
    weights: {
      earlyPoints: settings.earlyPoints,
      onTimePoints: settings.onTimePoints,
      latePoints: settings.latePoints,
      missedClockOutPoints: settings.missedClockOutPoints,
    },
  });

  const totals = scores.reduce(
    (acc, s) => ({
      early: acc.early + s.early,
      onTime: acc.onTime + s.onTime,
      late: acc.late + s.late,
      missedClockOut: acc.missedClockOut + s.missedClockOut,
    }),
    { early: 0, onTime: 0, late: 0, missedClockOut: 0 }
  );

  const quickRanges = {
    Today: todayRange(settings.timezone),
    "This week": thisWeekRange(settings.timezone),
    "This month": thisMonthRange(settings.timezone),
  };

  function quickHref(range: DateRangeStrings): string {
    const params = new URLSearchParams({ from: range.from, to: range.to });
    if (officeId) params.set("officeId", officeId);
    return `/admin/analytics?${params.toString()}`;
  }

  function exportHref(format: "xlsx" | "pdf"): string {
    const params = new URLSearchParams({ from, to, format });
    if (officeId) params.set("officeId", officeId);
    return `/api/analytics/export?${params.toString()}`;
  }

  return (
    <>
      <PageHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-sm text-muted-foreground">
              Attendance performance by employee for the selected period. Score weights are set in Settings.
            </p>
          </div>
          <FullScreenToggle />
        </div>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex gap-2 text-sm">
            {Object.entries(quickRanges).map(([label, range]) => (
              <Link
                key={label}
                href={quickHref(range)}
                className={`rounded-full px-3 py-1 font-medium ${
                  range.from === from && range.to === to ? "bg-primary text-primary-foreground" : "bg-muted"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>

          <form className="flex flex-wrap items-end gap-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">From</label>
              <input
                type="date"
                name="from"
                defaultValue={from}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">To</label>
              <input
                type="date"
                name="to"
                defaultValue={to}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Office</label>
              <select
                name="officeId"
                defaultValue={officeId ?? ""}
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              >
                <option value="">All offices</option>
                {offices.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </div>
            <button
              type="submit"
              className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium hover:bg-muted"
            >
              Apply
            </button>
          </form>

          <div className="flex gap-2">
            <a
              href={exportHref("xlsx")}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium leading-9 hover:bg-muted"
            >
              Export Excel
            </a>
            <a
              href={exportHref("pdf")}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm font-medium leading-9 hover:bg-muted"
            >
              Export PDF
            </a>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Early arrivals" value={totals.early} className="border-blue-200 bg-blue-50 text-blue-800" />
          <SummaryCard label="On-time arrivals" value={totals.onTime} className="border-green-200 bg-green-50 text-green-800" />
          <SummaryCard label="Late arrivals" value={totals.late} className="border-red-200 bg-red-50 text-red-800" />
          <SummaryCard label="Missed clock-outs" value={totals.missedClockOut} className="border-amber-200 bg-amber-50 text-amber-800" />
        </div>

        <div className="rounded-lg border bg-card p-4">
          {scores.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">No attendance records for this period.</p>
          ) : (
            <AnalyticsChart data={scores} />
          )}
        </div>
      </div>
    </>
  );
}

function SummaryCard({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <div className={`rounded-lg border p-4 ${className}`}>
      <p className="text-sm font-medium">{label}</p>
      <p className="mt-1 text-2xl font-bold">{value}</p>
    </div>
  );
}
