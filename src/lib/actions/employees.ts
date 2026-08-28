"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { requirePermission } from "@/lib/auth/guard";
import { recordAuditLog } from "@/lib/audit/log";
import { notifyRole } from "@/lib/notifications/create";
import { createAttendanceIdCandidate, hashAttendanceId, normalizeAttendanceId } from "@/lib/security/attendanceId";
import { Prisma } from "@prisma/client";

async function actorIp(): Promise<string> {
  const hdrs = await headers();
  return hdrs.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

async function nextEmployeeNumber(): Promise<string> {
  const count = await prisma.employee.count();
  return `EMP-${String(count + 1).padStart(4, "0")}`;
}

const workTime = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm").optional().or(z.literal(""));

const employeeSchema = z.object({
  firstName: z.string().min(1).max(80),
  middleName: z.string().max(80).optional().or(z.literal("")),
  lastName: z.string().min(1).max(80),
  email: z.string().email().optional().or(z.literal("")),
  phone: z.string().max(30).optional().or(z.literal("")),
  departmentId: z.string().optional().or(z.literal("")),
  jobTitle: z.string().max(120).optional().or(z.literal("")),
  officeId: z.string().min(1),
  dateEmployed: z.string().optional().or(z.literal("")),
  // Optional per-employee schedule override — left blank, the employee follows the
  // general attendance settings' workStart/workEnd.
  workStart: workTime,
  workEnd: workTime,
});

export interface EmployeeFormState {
  error?: string;
  generatedAttendanceId?: string;
}

export async function createEmployeeAction(
  _prev: EmployeeFormState,
  formData: FormData
): Promise<EmployeeFormState> {
  const user = await requirePermission("employees", "manage");

  const parsed = employeeSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };

  const employeeNumber = await nextEmployeeNumber();

  // Astronomically unlikely to collide, but retry once just in case.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { plaintext, lookup } = createAttendanceIdCandidate();
    try {
      const employee = await prisma.employee.create({
        data: {
          employeeNumber,
          attendanceIdLookup: lookup,
          firstName: parsed.data.firstName,
          middleName: parsed.data.middleName || null,
          lastName: parsed.data.lastName,
          email: parsed.data.email || null,
          phone: parsed.data.phone || null,
          departmentId: parsed.data.departmentId || null,
          jobTitle: parsed.data.jobTitle || null,
          officeId: parsed.data.officeId,
          dateEmployed: parsed.data.dateEmployed ? new Date(parsed.data.dateEmployed) : null,
          workStart: parsed.data.workStart || null,
          workEnd: parsed.data.workEnd || null,
        },
      });

      await recordAuditLog({
        userId: user.id,
        action: "employee.created",
        resource: "employee",
        resourceId: employee.id,
        newValue: { employeeNumber, firstName: parsed.data.firstName, lastName: parsed.data.lastName },
        ipAddress: await actorIp(),
      });

      revalidatePath("/admin/employees");
      return { generatedAttendanceId: plaintext };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }

  return { error: "Could not generate a unique Attendance ID. Please try again." };
}

export async function updateEmployeeAction(employeeId: string, formData: FormData): Promise<void> {
  const user = await requirePermission("employees", "manage");
  const parsed = employeeSchema.partial({ officeId: true }).safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  const before = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

  await prisma.employee.update({
    where: { id: employeeId },
    data: {
      firstName: parsed.data.firstName,
      middleName: parsed.data.middleName || null,
      lastName: parsed.data.lastName,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      departmentId: parsed.data.departmentId || null,
      jobTitle: parsed.data.jobTitle || null,
      officeId: parsed.data.officeId || before.officeId,
      dateEmployed: parsed.data.dateEmployed ? new Date(parsed.data.dateEmployed) : null,
      workStart: parsed.data.workStart || null,
      workEnd: parsed.data.workEnd || null,
    },
  });

  await recordAuditLog({
    userId: user.id,
    action: "employee.updated",
    resource: "employee",
    resourceId: employeeId,
    oldValue: { firstName: before.firstName, lastName: before.lastName, email: before.email },
    newValue: { firstName: parsed.data.firstName, lastName: parsed.data.lastName, email: parsed.data.email },
    ipAddress: await actorIp(),
  });

  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${employeeId}`);
}

export async function setEmploymentStatusAction(
  employeeId: string,
  status: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "EXITED"
): Promise<void> {
  const user = await requirePermission("employees", "manage");
  const before = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

  await prisma.employee.update({ where: { id: employeeId }, data: { employmentStatus: status } });

  await recordAuditLog({
    userId: user.id,
    action: "employee.status_changed",
    resource: "employee",
    resourceId: employeeId,
    oldValue: { employmentStatus: before.employmentStatus },
    newValue: { employmentStatus: status },
    ipAddress: await actorIp(),
  });

  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${employeeId}`);
}

export interface RegenerateResult {
  attendanceId: string;
}

export async function regenerateAttendanceIdAction(employeeId: string): Promise<RegenerateResult> {
  const user = await requirePermission("employees", "manage");
  const before = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });

  for (let attempt = 0; attempt < 3; attempt++) {
    const { plaintext, lookup } = createAttendanceIdCandidate();
    try {
      await prisma.$transaction([
        prisma.employee.update({ where: { id: employeeId }, data: { attendanceIdLookup: lookup } }),
        prisma.attendanceIdHistory.create({
          data: { employeeId, oldIdHash: before.attendanceIdLookup, changedById: user.id },
        }),
      ]);

      await recordAuditLog({
        userId: user.id,
        action: "employee.attendance_id_regenerated",
        resource: "employee",
        resourceId: employeeId,
        ipAddress: await actorIp(),
      });

      revalidatePath(`/admin/employees/${employeeId}`);
      return { attendanceId: plaintext };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") continue;
      throw err;
    }
  }

  throw new Error("Could not generate a unique Attendance ID. Please try again.");
}

const deletionReasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });

/**
 * SUPER_ADMIN: soft-deletes the employee immediately. ADMIN/HR: files a PENDING
 * request instead — the employee stays fully active and clock-in keeps working
 * until a SUPER_ADMIN approves it via reviewDeletionRequestAction.
 */
export async function requestDeleteEmployeeAction(employeeId: string, formData: FormData): Promise<void> {
  const actor = await requirePermission("employees", "delete");
  const parsed = deletionReasonSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "A reason is required.");

  const employee = await prisma.employee.findUniqueOrThrow({ where: { id: employeeId } });
  if (employee.isDeleted) throw new Error("This employee has already been deleted.");

  const existingPending = await prisma.employeeDeletionRequest.findFirst({
    where: { employeeId, status: "PENDING" },
  });
  if (existingPending) throw new Error("A deletion request is already pending for this employee.");

  if (actor.role === "SUPER_ADMIN") {
    await prisma.$transaction([
      prisma.employee.update({ where: { id: employeeId }, data: { isDeleted: true, deletedAt: new Date() } }),
      prisma.employeeDeletionRequest.create({
        data: {
          employeeId,
          requestedById: actor.id,
          reason: parsed.data.reason,
          status: "APPROVED",
          reviewedById: actor.id,
          reviewedAt: new Date(),
        },
      }),
    ]);
    await recordAuditLog({
      userId: actor.id,
      action: "employee.deleted",
      resource: "employee",
      resourceId: employeeId,
      reason: parsed.data.reason,
      ipAddress: await actorIp(),
    });
  } else {
    await prisma.employeeDeletionRequest.create({
      data: { employeeId, requestedById: actor.id, reason: parsed.data.reason },
    });
    await recordAuditLog({
      userId: actor.id,
      action: "employee.deletion_requested",
      resource: "employee",
      resourceId: employeeId,
      reason: parsed.data.reason,
      ipAddress: await actorIp(),
    });
    await notifyRole({
      type: "EMPLOYEE_DELETION_REQUESTED",
      targetRole: "SUPER_ADMIN",
      title: `Deletion requested: ${employee.firstName} ${employee.lastName}`,
      message: `${actor.fullName} (${actor.role}) requested to delete ${employee.firstName} ${employee.lastName} (${employee.employeeNumber}). Reason: "${parsed.data.reason}". Review it from the employee's profile.`,
    });
  }

  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${employeeId}`);
  revalidatePath("/admin/deletion-requests");
}

const reviewSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  note: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function reviewDeletionRequestAction(requestId: string, formData: FormData): Promise<void> {
  const actor = await requirePermission("employees", "approveDeletion");
  const parsed = reviewSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid input.");

  const request = await prisma.employeeDeletionRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { employee: true },
  });
  if (request.status !== "PENDING") throw new Error("This request has already been reviewed.");

  const approved = parsed.data.decision === "APPROVE";
  const note = parsed.data.note || null;

  await prisma.$transaction([
    prisma.employeeDeletionRequest.update({
      where: { id: requestId },
      data: { status: approved ? "APPROVED" : "REJECTED", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note },
    }),
    ...(approved
      ? [prisma.employee.update({ where: { id: request.employeeId }, data: { isDeleted: true, deletedAt: new Date() } })]
      : []),
  ]);

  await recordAuditLog({
    userId: actor.id,
    action: approved ? "employee.deletion_approved" : "employee.deletion_rejected",
    resource: "employee",
    resourceId: request.employeeId,
    reason: note,
    ipAddress: await actorIp(),
  });

  revalidatePath("/admin/employees");
  revalidatePath(`/admin/employees/${request.employeeId}`);
  revalidatePath("/admin/deletion-requests");
}

export async function findEmployeeByAttendanceId(raw: string) {
  await requirePermission("employees", "view");
  const lookup = hashAttendanceId(normalizeAttendanceId(raw));
  return prisma.employee.findUnique({ where: { attendanceIdLookup: lookup }, include: { office: true, department: true } });
}

export async function redirectToEmployees() {
  redirect("/admin/employees");
}
