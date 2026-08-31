import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatInTimeZone } from "date-fns-tz";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination, ADMIN_PAGE_SIZE } from "@/components/admin/Pagination";
import type { Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  EARLY: "bg-blue-100 text-blue-700",
  ON_TIME: "bg-green-100 text-green-700",
  LATE: "bg-red-100 text-red-700",
  MISSED_CLOCK_OUT: "bg-amber-100 text-amber-800",
  ABSENT: "bg-gray-200 text-gray-700",
  MANUALLY_ADJUSTED: "bg-purple-100 text-purple-700",
};

export default async function AttendanceListPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; q?: string; status?: string; flagged?: string; page?: string }>;
}) {
  const { from, to, q, status, flagged, page } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = ADMIN_PAGE_SIZE;

  const where: Prisma.AttendanceRecordWhereInput = {};
  if (from || to) {
    where.attendanceDate = {};
    if (from) where.attendanceDate.gte = new Date(`${from}T00:00:00Z`);
    if (to) where.attendanceDate.lte = new Date(`${to}T00:00:00Z`);
  }
  if (status) where.clockInStatus = status as never;
  if (q) {
    where.employee = {
      OR: [
        { firstName: { contains: q, mode: "insensitive" } },
        { lastName: { contains: q, mode: "insensitive" } },
        { employeeNumber: { contains: q, mode: "insensitive" } },
      ],
    };
  }
  if (flagged === "unreviewed") where.deviceFlags = { some: { reviewed: false } };
  else if (flagged === "any") where.deviceFlags = { some: {} };

  const [records, total] = await Promise.all([
    prisma.attendanceRecord.findMany({
      where,
      include: { employee: true, office: true, deviceFlags: { select: { reviewed: true } } },
      orderBy: [{ attendanceDate: "desc" }, { clockIn: "desc" }],
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
    prisma.attendanceRecord.count({ where }),
  ]);

  return (
    <>
      <PageHeader>
        <h1 className="text-2xl font-bold">Attendance</h1>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      <form className="flex flex-wrap gap-2">
        <Input type="date" name="from" defaultValue={from} className="w-[calc(50%-0.25rem)] sm:w-40" />
        <Input type="date" name="to" defaultValue={to} className="w-[calc(50%-0.25rem)] sm:w-40" />
        <Input name="q" defaultValue={q} placeholder="Search employee…" className="w-full sm:w-56" />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-10 w-[calc(50%-0.25rem)] rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
        >
          <option value="">All statuses</option>
          <option value="EARLY">Early</option>
          <option value="ON_TIME">On time</option>
          <option value="LATE">Late</option>
          <option value="MISSED_CLOCK_OUT">Missed clock-out</option>
          <option value="MANUALLY_ADJUSTED">Manually adjusted</option>
        </select>
        <select
          name="flagged"
          defaultValue={flagged ?? ""}
          className="h-10 w-[calc(50%-0.25rem)] rounded-md border border-input bg-background px-3 text-sm sm:w-auto"
        >
          <option value="">All records</option>
          <option value="unreviewed">🚩 Flagged, needs review</option>
          <option value="any">🚩 Flagged (any)</option>
        </select>
        <Button type="submit" variant="outline" className="flex-1 sm:flex-none">
          Filter
        </Button>
        <Button asChild variant="outline" className="flex-1 sm:flex-none">
          <a href={`/api/reports/daily?format=csv&from=${from ?? ""}&to=${to ?? ""}`}>Export CSV</a>
        </Button>
      </form>

      {/* Mobile: card list */}
      <div className="space-y-2 md:hidden">
        {records.map((r) => {
          const unreviewedFlag = r.deviceFlags.some((f) => !f.reviewed);
          const anyFlag = r.deviceFlags.length > 0;
          return (
            <Link
              key={r.id}
              href={`/admin/attendance/${r.id}`}
              className={`block rounded-lg border p-4 active:bg-muted/30 ${unreviewedFlag ? "border-red-300 bg-red-50/60" : "bg-card"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">
                    {r.employee.firstName} {r.employee.lastName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.attendanceDate.toISOString().slice(0, 10)} · {r.office.name}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.clockInStatus ?? ""] ?? ""}`}>
                  {r.clockInStatus ?? "—"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span>In: {r.clockIn ? formatInTimeZone(r.clockIn, "Africa/Lagos", "h:mm a") : "—"}</span>
                <span>
                  Out: {r.clockOut ? formatInTimeZone(r.clockOut, "Africa/Lagos", "h:mm a") : r.clockIn ? "Missing" : "—"}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {r.clockOutStatus === "EARLY" ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                    Early clock-out
                  </span>
                ) : null}
                {unreviewedFlag ? (
                  <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                    🚩 Needs review
                  </span>
                ) : anyFlag ? (
                  <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                    🚩 Reviewed
                  </span>
                ) : null}
              </div>
            </Link>
          );
        })}
        {records.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No attendance records found.
          </p>
        ) : null}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Employee</th>
              <th className="px-4 py-2">Office</th>
              <th className="px-4 py-2">Clock In</th>
              <th className="px-4 py-2">Clock Out</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Type</th>
              <th className="px-4 py-2">Method</th>
              <th className="px-4 py-2">Flag</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {records.map((r) => {
              const unreviewedFlag = r.deviceFlags.some((f) => !f.reviewed);
              const anyFlag = r.deviceFlags.length > 0;
              return (
              <tr key={r.id} className={`border-b last:border-0 ${unreviewedFlag ? "bg-red-50/60" : ""}`}>
                <td className="px-4 py-2">{r.attendanceDate.toISOString().slice(0, 10)}</td>
                <td className="px-4 py-2">
                  {r.employee.firstName} {r.employee.lastName}
                </td>
                <td className="px-4 py-2">{r.office.name}</td>
                <td className="px-4 py-2">{r.clockIn ? formatInTimeZone(r.clockIn, "Africa/Lagos", "h:mm a") : "—"}</td>
                <td className="px-4 py-2">
                  {r.clockOut ? formatInTimeZone(r.clockOut, "Africa/Lagos", "h:mm a") : r.clockIn ? "Missing" : "—"}
                  {r.clockOutStatus === "EARLY" ? (
                    <span
                      className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
                      title={r.earlyClockOutReason ?? undefined}
                    >
                      Early
                    </span>
                  ) : null}
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.clockInStatus ?? ""] ?? ""}`}>
                    {r.clockInStatus ?? "—"}
                  </span>
                </td>
                <td className="px-4 py-2">{r.attendanceType}</td>
                <td className="px-4 py-2">{r.verificationMethod ?? "—"}</td>
                <td className="px-4 py-2">
                  {unreviewedFlag ? (
                    <Link
                      href="/admin/device-flags"
                      className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 hover:bg-red-200"
                      title="Device clocked in as a different employee than last seen — needs review"
                    >
                      🚩 Needs review
                    </Link>
                  ) : anyFlag ? (
                    <span className="rounded-full bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                      🚩 Reviewed
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/attendance/${r.id}`} className="text-primary hover:underline">
                    Correct
                  </Link>
                </td>
              </tr>
              );
            })}
            {records.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                  No attendance records found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Pagination
        basePath="/admin/attendance"
        searchParams={{ from, to, q, status, flagged }}
        page={pageNum}
        pageSize={pageSize}
        total={total}
      />
      </div>
    </>
  );
}
