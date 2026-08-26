import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "crypto";
import { prisma } from "@/lib/db/prisma";
import { SECURE_COOKIES } from "@/lib/security/secureCookies";
import type { User } from "@prisma/client";

const SESSION_COOKIE = "attendance_admin_session";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(userId: string, ip: string | null, userAgent: string | null) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      ipAddress: ip,
      userAgent,
      expiresAt,
    },
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<User | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) return null;
  if (!session.user.isActive) return null;
  return session.user;
}
