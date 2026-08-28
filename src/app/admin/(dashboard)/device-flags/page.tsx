import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { reviewDeviceFlagAction } from "@/lib/actions/deviceFlags";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination, ADMIN_PAGE_SIZE } from "@/components/admin/Pagination";

export const dynamic = "force-dynamic";

export default async function DeviceFlagsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; page?: string }>;
}) {
  const { show, page } = await searchParams;
  const showReviewed = show === "reviewed";
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = ADMIN_PAGE_SIZE;
  const where = { reviewed: showReviewed };

  const [flags, total] = await Promise.all([
    prisma.attendanceDeviceFlag.findMany({
      where,
      include: {
        employee: true,
        previousEmployee: true,
        attendanceRecord: { include: { office: true } },
        reviewedBy: true,
      },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
    prisma.attendanceDeviceFlag.count({ where }),
  ]);

  return (
    <>
      <PageHeader>
        <h1 className="text-2xl font-bold">Device Flags</h1>
        <p className="text-sm text-muted-foreground">
          Raised when the same device (phone/laptop, tracked by a persistent browser cookie — never by
          network IP, since every device on office Wi-Fi shares one public IP) clocks in as a different
          employee than it was last seen with. Clock-ins are never blocked for this — review each flag and
          confirm it&apos;s expected (e.g. a shared device) or a genuine concern.
        </p>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      <div className="flex gap-2 text-sm">
        <a
          href="/admin/device-flags"
          className={`rounded-full px-3 py-1 font-medium ${!showReviewed ? "bg-primary text-primary-foreground" : "bg-muted"}`}
        >
          Needs review
        </a>
        <a
          href="/admin/device-flags?show=reviewed"
          className={`rounded-full px-3 py-1 font-medium ${showReviewed ? "bg-primary text-primary-foreground" : "bg-muted"}`}
        >
          Reviewed
        </a>
      </div>

      <div className="space-y-3">
        {flags.map((flag) => (
          <Card key={flag.id}>
            <CardContent className="flex flex-wrap items-start justify-between gap-4 pt-6">
              <div>
                <p className="font-medium">
                  {flag.employee.firstName} {flag.employee.lastName}{" "}
                  <span className="font-normal text-muted-foreground">clocked in on a device last used by</span>{" "}
                  {flag.previousEmployee.firstName} {flag.previousEmployee.lastName}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {flag.attendanceRecord.office.name} · {flag.createdAt.toLocaleString()} · device{" "}
                  <span className="font-mono">{flag.deviceId.slice(0, 8)}…</span>
                </p>
                {flag.reviewed ? (
                  <p className="mt-2 text-xs text-green-700">
                    Reviewed by {flag.reviewedBy?.fullName ?? "—"} on {flag.reviewedAt?.toLocaleString()}
                    {flag.reviewNote ? ` — "${flag.reviewNote}"` : ""}
                  </p>
                ) : null}
              </div>

              {!flag.reviewed ? (
                <form action={reviewDeviceFlagAction.bind(null, flag.id)} className="flex items-end gap-2">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">Note (optional)</label>
                    <input
                      name="note"
                      className="h-9 w-56 rounded-md border border-input bg-background px-2 text-sm"
                      placeholder="e.g. shared reception tablet"
                    />
                  </div>
                  <button type="submit" className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">
                    Mark reviewed
                  </button>
                </form>
              ) : null}
            </CardContent>
          </Card>
        ))}
        {flags.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base font-normal text-muted-foreground">
                {showReviewed ? "No reviewed flags yet." : "Nothing needs review right now."}
              </CardTitle>
            </CardHeader>
          </Card>
        ) : null}
      </div>

      <Pagination
        basePath="/admin/device-flags"
        searchParams={{ show }}
        page={pageNum}
        pageSize={pageSize}
        total={total}
      />
      </div>
    </>
  );
}
