import { prisma } from "@/lib/db/prisma";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { Prisma } from "@prisma/client";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination, ADMIN_PAGE_SIZE } from "@/components/admin/Pagination";

export const dynamic = "force-dynamic";

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; resource?: string; page?: string }>;
}) {
  const { action, resource, page } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = ADMIN_PAGE_SIZE;

  const where: Prisma.AuditLogWhereInput = {};
  if (action) where.action = { contains: action, mode: "insensitive" };
  if (resource) where.resource = { contains: resource, mode: "insensitive" };

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { user: true },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
    prisma.auditLog.count({ where }),
  ]);

  return (
    <>
      <PageHeader>
        <h1 className="text-2xl font-bold">Audit Log</h1>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      <form className="flex flex-wrap gap-2">
        <Input name="action" defaultValue={action} placeholder="Filter by action…" className="w-full sm:w-56" />
        <Input name="resource" defaultValue={resource} placeholder="Filter by resource…" className="w-full sm:w-56" />
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {/* Mobile: card list */}
      <div className="space-y-2 md:hidden">
        {logs.map((log) => (
          <div key={log.id} className="rounded-lg border bg-card p-4 text-sm">
            <div className="flex items-start justify-between gap-2">
              <p className="font-mono text-xs">{log.action}</p>
              <p className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{log.createdAt.toLocaleString()}</p>
            </div>
            <p className="mt-1 text-muted-foreground">{log.user?.fullName ?? "System"}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {log.resource}
              {log.resourceId ? `:${log.resourceId.slice(0, 8)}` : ""} · {log.ipAddress ?? "—"}
            </p>
            {log.reason ? <p className="mt-1 text-xs">{log.reason}</p> : null}
          </div>
        ))}
        {logs.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No audit log entries found.
          </p>
        ) : null}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">When</th>
              <th className="px-4 py-2">Actor</th>
              <th className="px-4 py-2">Action</th>
              <th className="px-4 py-2">Resource</th>
              <th className="px-4 py-2">IP</th>
              <th className="px-4 py-2">Reason</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr key={log.id} className="border-b last:border-0 align-top">
                <td className="whitespace-nowrap px-4 py-2">{log.createdAt.toLocaleString()}</td>
                <td className="px-4 py-2">{log.user?.fullName ?? "System"}</td>
                <td className="px-4 py-2 font-mono text-xs">{log.action}</td>
                <td className="px-4 py-2 font-mono text-xs">
                  {log.resource}
                  {log.resourceId ? `:${log.resourceId.slice(0, 8)}` : ""}
                </td>
                <td className="px-4 py-2 font-mono text-xs">{log.ipAddress ?? "—"}</td>
                <td className="px-4 py-2 text-xs">{log.reason ?? "—"}</td>
              </tr>
            ))}
            {logs.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No audit log entries found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <Pagination
        basePath="/admin/audit-log"
        searchParams={{ action, resource }}
        page={pageNum}
        pageSize={pageSize}
        total={total}
      />
      </div>
    </>
  );
}
