import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination, ADMIN_PAGE_SIZE } from "@/components/admin/Pagination";
import { ReviewDeletionForm } from "./ReviewDeletionForm";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<string, string> = {
  PENDING: "bg-amber-100 text-amber-800",
  APPROVED: "bg-red-100 text-red-700",
  REJECTED: "bg-gray-200 text-gray-700",
};

export default async function DeletionRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ show?: string; page?: string }>;
}) {
  await requirePermission("deletionRequests", "view");
  const { show, page } = await searchParams;
  const showResolved = show === "resolved";
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = ADMIN_PAGE_SIZE;
  const where = { status: showResolved ? { not: "PENDING" as const } : "PENDING" as const };

  const [requests, total] = await Promise.all([
    prisma.employeeDeletionRequest.findMany({
      where,
      include: { employee: true, requestedBy: true, reviewedBy: true },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
    prisma.employeeDeletionRequest.count({ where }),
  ]);

  return (
    <>
      <PageHeader>
        <h1 className="text-2xl font-bold">Deletion Requests</h1>
        <p className="text-sm text-muted-foreground">
          Only a Super Admin can delete an employee outright. When an Admin or HR user requests a deletion, it
          stays here — pending, employee unaffected — until you approve or reject it.
        </p>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
        <div className="flex gap-2 text-sm">
          <Link
            href="/admin/deletion-requests"
            className={`rounded-full px-3 py-1 font-medium ${!showResolved ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            Pending
          </Link>
          <Link
            href="/admin/deletion-requests?show=resolved"
            className={`rounded-full px-3 py-1 font-medium ${showResolved ? "bg-primary text-primary-foreground" : "bg-muted"}`}
          >
            Resolved
          </Link>
        </div>

        <div className="space-y-3">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="font-medium">
                    <Link href={`/admin/employees/${r.employeeId}`} className="hover:underline">
                      {r.employee.firstName} {r.employee.lastName}
                    </Link>{" "}
                    <span className="font-mono text-xs text-muted-foreground">({r.employee.employeeNumber})</span>
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requested by {r.requestedBy.fullName} ({r.requestedBy.role.replace("_", " ")}) ·{" "}
                    {r.createdAt.toLocaleString()}
                  </p>
                  <p className="mt-2 text-sm">&ldquo;{r.reason}&rdquo;</p>
                  {r.status !== "PENDING" ? (
                    <p className="mt-2 text-xs text-muted-foreground">
                      <span className={`mr-2 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>
                        {r.status}
                      </span>
                      by {r.reviewedBy?.fullName ?? "—"} on {r.reviewedAt?.toLocaleString()}
                      {r.reviewNote ? ` — "${r.reviewNote}"` : ""}
                    </p>
                  ) : null}
                </div>
                {r.status === "PENDING" ? <ReviewDeletionForm requestId={r.id} /> : null}
              </CardContent>
            </Card>
          ))}
          {requests.length === 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base font-normal text-muted-foreground">
                  {showResolved ? "No resolved requests yet." : "No pending deletion requests."}
                </CardTitle>
              </CardHeader>
            </Card>
          ) : null}
        </div>

        <Pagination
          basePath="/admin/deletion-requests"
          searchParams={{ show }}
          page={pageNum}
          pageSize={pageSize}
          total={total}
        />
      </div>
    </>
  );
}
