import Link from "next/link";
import { prisma } from "@/lib/db/prisma";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/admin/PageHeader";
import { Pagination, ADMIN_PAGE_SIZE } from "@/components/admin/Pagination";
import type { EmploymentStatus, Prisma } from "@prisma/client";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<EmploymentStatus, string> = {
  ACTIVE: "bg-green-100 text-green-700",
  INACTIVE: "bg-gray-200 text-gray-700",
  SUSPENDED: "bg-amber-100 text-amber-800",
  EXITED: "bg-red-100 text-red-700",
};

export default async function EmployeesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const { q, status, page } = await searchParams;
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = ADMIN_PAGE_SIZE;

  const where: Prisma.EmployeeWhereInput = { isDeleted: false };
  if (status) where.employmentStatus = status as EmploymentStatus;
  if (q) {
    where.OR = [
      { firstName: { contains: q, mode: "insensitive" } },
      { lastName: { contains: q, mode: "insensitive" } },
      { employeeNumber: { contains: q, mode: "insensitive" } },
      { email: { contains: q, mode: "insensitive" } },
    ];
  }

  const [employees, total] = await Promise.all([
    prisma.employee.findMany({
      where,
      include: { office: true, department: true },
      orderBy: { createdAt: "desc" },
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
    }),
    prisma.employee.count({ where }),
  ]);

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
                <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">
                  No employees found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <Pagination
        basePath="/admin/employees"
        searchParams={{ q, status }}
        page={pageNum}
        pageSize={pageSize}
        total={total}
      />
      </div>
    </>
  );
}
