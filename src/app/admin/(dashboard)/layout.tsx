import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/session";
import { getCompanySettings } from "@/lib/company/settings";
import { visibleNavItems } from "@/lib/auth/nav";
import { hasPermission } from "@/lib/auth/rbac";
import { getUnreadNotificationCount } from "@/lib/notifications/query";
import { SidebarVisibilityProvider } from "./SidebarVisibilityContext";
import { DashboardShell } from "./DashboardShell";

export const dynamic = "force-dynamic";

export default async function AdminDashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/admin/login");

  const company = await getCompanySettings();
  const nav = visibleNavItems(user.role);
  const notificationCount = hasPermission(user.role, "notifications", "view")
    ? await getUnreadNotificationCount(user.role)
    : null;

  return (
    <SidebarVisibilityProvider>
      <DashboardShell
        companyName={company.companyName}
        logoUrl={company.logoUrl}
        nav={nav}
        user={user}
        notificationCount={notificationCount}
      >
        {children}
      </DashboardShell>
    </SidebarVisibilityProvider>
  );
}
