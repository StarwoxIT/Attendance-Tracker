import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateNetworkForm, NetworkRow } from "./NetworkAgentPanel";
import { CreateOfficeForm } from "./CreateOfficeForm";
import { CreateDepartmentForm } from "./CreateDepartmentForm";
import { PageHeader } from "@/components/admin/PageHeader";
import { requireUser } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { OfficeLocationPanel } from "./OfficeLocationPanel";

export const dynamic = "force-dynamic";

export default async function OfficesPage() {
  const user = await requireUser();
  // Departments are an employee attribute, so whoever can manage employees (incl. HR) can add them.
  const canManageDepartments = hasPermission(user.role, "employees", "manage");
  const canManageOffices = hasPermission(user.role, "offices", "manage");
  const [offices, departments] = await Promise.all([
    prisma.office.findMany({
      include: { officeNetworks: true, _count: { select: { employees: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.department.findMany({
      include: { _count: { select: { employees: { where: { isDeleted: false } } } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <>
      <PageHeader>
        <h1 className="text-2xl font-bold">Offices &amp; Network</h1>
        <p className="text-sm text-muted-foreground">
          Each office needs at least one verified network for network-based attendance checks to pass. Two ways to
          verify: run the Python Network Agent on an always-on office machine (auto-updates every few minutes — see
          docs/OFFICE_NETWORK_AGENT_SETUP.md), or, if you don&apos;t have one, click{" "}
          <strong>Authorize This Network Now</strong> below while connected to office Wi-Fi — no dedicated machine
          needed, just re-click it whenever Starlink&apos;s IP changes.
        </p>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      <Card>
        <CardHeader>
          <CardTitle>Add office</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateOfficeForm />
        </CardContent>
      </Card>

      <div className="space-y-4">
        {offices.map((office) => (
          <Card key={office.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>
                  {office.name}{" "}
                  <span className="text-sm font-normal text-muted-foreground">
                    · {office._count.employees} employees · {office.timezone}
                  </span>
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {office.officeNetworks.length === 0 ? (
                <p className="text-sm text-muted-foreground">No network registered yet.</p>
              ) : (
                <div className="space-y-2">
                  {office.officeNetworks.map((n) => (
                    <NetworkRow key={n.id} network={n} />
                  ))}
                </div>
              )}
              <CreateNetworkForm officeId={office.id} />
              <OfficeLocationPanel
                officeId={office.id}
                latitude={office.latitude}
                longitude={office.longitude}
                radiusMeters={office.locationRadiusMeters}
                canManage={canManageOffices}
              />
            </CardContent>
          </Card>
        ))}
        {offices.length === 0 ? <p className="text-sm text-muted-foreground">No offices yet.</p> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Departments</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            These appear in the Department dropdown when adding or editing an employee.
          </p>
          {departments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No departments yet.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {departments.map((d) => (
                <li key={d.id} className="rounded-full border px-3 py-1 text-sm">
                  {d.name}{" "}
                  <span className="text-muted-foreground">
                    · {d._count.employees} employee{d._count.employees === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {canManageDepartments ? <CreateDepartmentForm /> : null}
        </CardContent>
      </Card>
      </div>
    </>
  );
}
