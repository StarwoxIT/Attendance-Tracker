import { prisma } from "@/lib/db/prisma";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentUser } from "@/lib/auth/session";
import { NewAdminForm } from "./NewAdminForm";
import { AdminRow, AdminActiveToggle, DeleteAdminButton } from "./AdminRow";
import { PageHeader } from "@/components/admin/PageHeader";

export const dynamic = "force-dynamic";

export default async function AdminsPage() {
  const [admins, self] = await Promise.all([
    prisma.user.findMany({ orderBy: { createdAt: "asc" } }),
    getCurrentUser(),
  ]);

  return (
    <>
      <PageHeader>
        <h1 className="text-2xl font-bold">Administrators</h1>
      </PageHeader>
      <div className="space-y-6 px-4 py-6 sm:px-6 md:px-8">
      <Card>
        <CardHeader>
          <CardTitle>Add administrator</CardTitle>
        </CardHeader>
        <CardContent>
          <NewAdminForm />
        </CardContent>
      </Card>

      {/* Mobile: card list */}
      <div className="space-y-2 md:hidden">
        {admins.map((a) => (
          <div key={a.id} className="rounded-lg border bg-card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">{a.fullName}</p>
                <p className="truncate text-xs text-muted-foreground">{a.email}</p>
              </div>
              <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${a.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-700"}`}>
                {a.isActive ? "Active" : "Disabled"}
              </span>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {a.role.replace("_", " ")} · Last login: {a.lastLoginAt ? new Date(a.lastLoginAt).toLocaleString() : "Never"}
            </p>
            {a.id !== self?.id ? (
              <div className="mt-3 flex gap-2">
                <AdminActiveToggle admin={a} />
                {a.role !== "SUPER_ADMIN" ? <DeleteAdminButton admin={a} /> : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      {/* Desktop: table */}
      <div className="hidden overflow-x-auto rounded-lg border bg-card md:block">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Role</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Last login</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody>
            {admins.map((a) => (
              <AdminRow key={a.id} admin={a} isSelf={a.id === self?.id} />
            ))}
          </tbody>
        </table>
      </div>
      </div>
    </>
  );
}
