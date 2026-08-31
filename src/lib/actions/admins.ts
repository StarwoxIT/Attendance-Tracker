"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/guard";
import { hashPassword } from "@/lib/auth/password";
import { recordAuditLog } from "@/lib/audit/log";
import { Prisma } from "@prisma/client";

async function actorIp(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const createAdminSchema = z.object({
  fullName: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(10, "Password must be at least 10 characters."),
  role: z.enum(["SUPER_ADMIN", "ADMIN", "HR", "VIEWER"]),
});

export interface CreateAdminState {
  error?: string;
  success?: boolean;
}

export async function createAdminAction(_prev: CreateAdminState, formData: FormData): Promise<CreateAdminState> {
  const actor = await requirePermission("admins", "manage");
  const parsed = createAdminSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const admin = await prisma.user.create({
      data: {
        fullName: parsed.data.fullName,
        email: parsed.data.email.toLowerCase(),
        passwordHash,
        role: parsed.data.role,
      },
    });

    await recordAuditLog({
      userId: actor.id,
      action: "admin.created",
      resource: "user",
      resourceId: admin.id,
      newValue: { email: admin.email, role: admin.role },
      ipAddress: await actorIp(),
    });

    revalidatePath("/admin/admins");
    return { success: true };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { error: "A user with that email already exists." };
    }
    throw err;
  }
}

export async function setAdminActiveAction(userId: string, isActive: boolean): Promise<void> {
  const actor = await requirePermission("admins", "manage");
  if (actor.id === userId && !isActive) throw new Error("You cannot deactivate your own account.");

  await prisma.user.update({ where: { id: userId }, data: { isActive } });
  await recordAuditLog({
    userId: actor.id,
    action: isActive ? "admin.activated" : "admin.deactivated",
    resource: "user",
    resourceId: userId,
    ipAddress: await actorIp(),
  });
  revalidatePath("/admin/admins");
}

/**
 * Super Admin accounts can never be deleted this way (only disabled) — the app
 * always needs at least one Super Admin able to recover access, and this avoids a
 * super admin accidentally locking the org out by deleting the last one. Any other
 * admin category (ADMIN, HR, VIEWER) can be removed outright.
 */
export async function deleteAdminAction(userId: string): Promise<void> {
  const actor = await requirePermission("admins", "manage");
  if (actor.id === userId) throw new Error("You cannot delete your own account.");

  const target = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (target.role === "SUPER_ADMIN") {
    throw new Error("Super Admin accounts can't be deleted — disable the account instead.");
  }

  try {
    await prisma.user.delete({ where: { id: userId } });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new Error(
        "Can't delete — this admin has historical activity (e.g. QR codes generated or an employee deletion request) that must be kept for audit purposes. Disable the account instead to revoke access without losing history."
      );
    }
    throw err;
  }

  await recordAuditLog({
    userId: actor.id,
    action: "admin.deleted",
    resource: "user",
    resourceId: userId,
    oldValue: { email: target.email, role: target.role },
    ipAddress: await actorIp(),
  });
  revalidatePath("/admin/admins");
}
