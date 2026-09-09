"use client";

import { Toaster } from "@/components/ui/toaster";
import { AdminSidebar } from "./AdminSidebar";
import { useSidebarVisibility } from "./SidebarVisibilityContext";
import type { NavItem } from "@/lib/auth/nav";
import type { User } from "@prisma/client";

interface DashboardShellProps {
  companyName: string;
  logoUrl: string | null;
  nav: NavItem[];
  user: User;
  notificationCount: number | null;
  children: React.ReactNode;
}

export function DashboardShell({ companyName, logoUrl, nav, user, notificationCount, children }: DashboardShellProps) {
  const { hidden } = useSidebarVisibility();

  return (
    <div className="flex h-screen flex-col overflow-hidden md:flex-row">
      {!hidden ? (
        <AdminSidebar companyName={companyName} logoUrl={logoUrl} nav={nav} user={user} notificationCount={notificationCount} />
      ) : null}
      {/* Only this scrolls — the sidebar (desktop) and top bar (mobile) stay put. */}
      <main className="flex-1 overflow-x-hidden overflow-y-auto bg-muted/40">
        {/* Clears the mobile fixed top bar; scrolls away with content, unlike the sticky page header below it. */}
        {!hidden ? <div className="h-14 md:hidden" /> : null}
        {children}
      </main>
      <Toaster />
    </div>
  );
}
