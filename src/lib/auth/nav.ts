import type { AdminRole } from "@prisma/client";
import { hasPermission } from "./rbac";

export interface NavItem {
  href: string;
  label: string;
  resource: Parameters<typeof hasPermission>[1];
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "Dashboard", resource: "attendance" },
  { href: "/admin/employees", label: "Employees", resource: "employees" },
  { href: "/admin/attendance", label: "Attendance", resource: "attendance" },
  { href: "/admin/device-flags", label: "Device Flags", resource: "deviceFlags" },
  { href: "/admin/deletion-requests", label: "Deletion Requests", resource: "deletionRequests" },
  { href: "/admin/notifications", label: "Notifications", resource: "notifications" },
  { href: "/admin/qr", label: "QR Codes", resource: "qr" },
  { href: "/admin/offices", label: "Offices & Network", resource: "offices" },
  { href: "/admin/holidays", label: "Holidays", resource: "settings" },
  { href: "/admin/reports", label: "Reports", resource: "reports" },
  { href: "/admin/analytics", label: "Analytics", resource: "analytics" },
  { href: "/admin/admins", label: "Administrators", resource: "admins" },
  { href: "/admin/audit-log", label: "Audit Log", resource: "auditLog" },
  { href: "/admin/settings", label: "Settings", resource: "settings" },
];

export function visibleNavItems(role: AdminRole): NavItem[] {
  return NAV_ITEMS.filter((item) => hasPermission(role, item.resource, "view"));
}
