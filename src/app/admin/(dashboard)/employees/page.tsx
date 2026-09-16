import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/admin/PageHeader";
import type { EmploymentStatus, Prisma, WorkArrangement } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<EmploymentStatus, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  INACTIVE: "bg-gray-200 text-gray-700",
  SUSPENDED: "bg-amber-100 text-amber-800",
  EXITED: "bg-red-100 text-red-700",
};

const ARRANGEMENT_STYLES: Record<WorkArrangement, string> = {
  ON_SITE: "bg-slate-100 text-slate-700",
  HYBRID: "bg-blue-100 text-blue-700",
  REMOTE: "bg-purple-100 text-purple-700",
};

const DAY_LABELS: Record<number, string> = { 1: "Mon", 2: "Tue", 3: "Wed", 4: "Thu", 5: "Fri", 6: "Sat", 7: "Sun" };

function arrangementLabel(e: { workArrangement: WorkArrangement; onSiteDays: number[] }): string {
  if (e.workArrangement === "HYBRID") {
    const days = e.onSiteDays.map((d) => DAY_LABELS[d]).join(", ");
    return days ? `Hybrid (${days})` : "Hybrid";
  }
  return e.workArrangement === "ON_SITE" ? "On-site" : "Remote";
}

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; workArrangement?: string }>;
}) {
  const { q, status, workArrangement } = await searchParams;

  const where: Prisma.EmployeeWhereInput = { isDeleted: false };
  if (status) where.employmentStatus = status as EmploymentStatus;
  if (workArrangement) where.workArrangement = workArrangement as WorkArrangement;
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { employeeNumber: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const employees = await prisma.employee.findMany({
    where,
    include: { office: true, department: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  return (
    <>
      <PageHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Employees</h1>
          <Button asChild>
            <Link href="/admin/employees/new">Add Employee</Link>
          </Button>
        </div>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      <form className="flex flex-wrap gap-2">
        <Input name="q" defaultValue={q} placeholder="Search name, number, email…" className="w-full sm:w-64" />
        <select
          name="status"
          defaultValue={status ?? ""}
          className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm sm:flex-none"
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="INACTIVE">Inactive</option>
          <option value="SUSPENDED">Suspended</option>
          <option value="EXITED">Exited</option>
        </select>
        <select
          name="workArrangement"
          defaultValue={workArrangement ?? ""}
          className="h-10 flex-1 rounded-md border border-input bg-background px-3 text-sm sm:flex-none"
        >
          <option value="">All arrangements</option>
          <option value="ON_SITE">On-site</option>
          <option value="HYBRID">Hybrid</option>
          <option value="REMOTE">Remote</option>
        </select>
        <Button type="submit" variant="outline">
          Filter
        </Button>
      </form>

      {/* Mobile: card list */}
      <div className="space-y-2 md:hidden">
        {employees.map((e) => (
          <Link
            key={e.id}
            href={`/admin/employees/${e.id}`}
            className="block rounded-lg border bg-card p-4 active:bg-muted/30"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  {e.firstName} {e.lastName}
                </p>
                <p className="font-mono text-xs text-muted-foreground">{e.employeeNumber}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[e.employmentStatus]}`}>
                {e.employmentStatus}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {e.office.name}
              {e.department ? ` · ${e.department.name}` : ""}
            </p>
            <span className={`mt-2 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${ARRANGEMENT_STYLES[e.workArrangement]}`}>
              {arrangementLabel(e)}
            </span>
          </Link>
        ))}
        {employees.length === 0 ? (
          <p className="rounded-lg border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
            No employees found.
          </p>
        ) : null}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Employee #</th>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Department</th>
              <th className="px-4 py-2">Office</th>
              <th className="px-4 py-2">Arrangement</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {employees.map((e) => (
              <tr key={e.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-4 py-2 font-mono text-xs">{e.employeeNumber}</td>
                <td className="px-4 py-2">
                  {e.firstName} {e.lastName}
                </td>
                <td className="px-4 py-2">{e.department?.name ?? "—"}</td>
                <td className="px-4 py-2">{e.office.name}</td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ARRANGEMENT_STYLES[e.workArrangement]}`}>
                    {arrangementLabel(e)}
                  </span>
                </td>
                <td className="px-4 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[e.employmentStatus]}`}>
                    {e.employmentStatus}
                  </span>
                </td>
                <td className="px-4 py-2 text-right">
                  <Link href={`/admin/employees/${e.id}`} className="text-primary hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            ))}
            {employees.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                  No employees found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}
