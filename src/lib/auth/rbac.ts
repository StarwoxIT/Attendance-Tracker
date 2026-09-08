import type { AdminRole } from "@prisma/client";

/**
 * Coarse-grained permission map. SUPER_ADMIN implicitly has everything;
 * network security config is deliberately restricted to SUPER_ADMIN/ADMIN,
 * per the requirement that it "require elevated permission".
 */
export const PERMISSIONS = {
  employees: {
    view: ["SUPER_ADMIN", "ADMIN", "HR", "VIEWER"],
    manage: ["SUPER_ADMIN", "ADMIN", "HR"],
    // "delete" only ever takes immediate effect for SUPER_ADMIN — see
    // requestDeleteEmployeeAction. ADMIN/HR calling it merely files a request.
    delete: ["SUPER_ADMIN", "ADMIN", "HR"],
    approveDeletion: ["SUPER_ADMIN"],
  },
  attendance: { view: ["SUPER_ADMIN", "ADMIN", "HR", "VIEWER"], manage: ["SUPER_ADMIN", "ADMIN", "HR"] },
  deviceFlags: { view: ["SUPER_ADMIN", "ADMIN", "HR"], manage: ["SUPER_ADMIN", "ADMIN", "HR"] },
  reports: { view: ["SUPER_ADMIN", "ADMIN", "HR", "VIEWER"] },
  analytics: { view: ["SUPER_ADMIN", "ADMIN"] },
  qr: { view: ["SUPER_ADMIN", "ADMIN", "HR", "VIEWER"], manage: ["SUPER_ADMIN", "ADMIN"] },
  offices: { view: ["SUPER_ADMIN", "ADMIN", "HR", "VIEWER"], manage: ["SUPER_ADMIN", "ADMIN"] },
  network: { view: ["SUPER_ADMIN", "ADMIN"], manage: ["SUPER_ADMIN", "ADMIN"] },
  settings: { view: ["SUPER_ADMIN", "ADMIN"], manage: ["SUPER_ADMIN"] },
  admins: { view: ["SUPER_ADMIN"], manage: ["SUPER_ADMIN"] },
  auditLog: { view: ["SUPER_ADMIN", "ADMIN"] },
  notifications: { view: ["SUPER_ADMIN"], manage: ["SUPER_ADMIN"] },
  deletionRequests: { view: ["SUPER_ADMIN"] },
} as const satisfies Record<string, Record<string, readonly AdminRole[]>>;

export function hasPermission(
  role: AdminRole,
  resource: keyof typeof PERMISSIONS,
  action: string
): boolean {
  const allowed = (PERMISSIONS[resource] as Record<string, readonly AdminRole[]>)[action];
  if (!allowed) return false;
  return (allowed as readonly AdminRole[]).includes(role);
}
