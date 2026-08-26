import type { NextRequest } from "next/server";
import { SECURE_COOKIES } from "@/lib/security/secureCookies";

/**
 * Persistent per-browser device identifier — a random ID in a long-lived
 * cookie, not a fingerprint (no canvas/font probing). It's deliberately NOT
 * the network IP: every device on office Wi-Fi shares one public IP via NAT
 * (see docs/SECURITY.md), so IP can't distinguish individual phones/laptops
 * the way this cookie can. Only used for the buddy-punching flag — never a
 * security gate on its own, since it's trivially cleared or spoofed by
 * clearing cookies or switching browsers. See AttendanceDeviceFlag.
 */
export const DEVICE_ID_COOKIE = "attendance_device_id";
const DEVICE_ID_MAX_AGE_SECONDS = 60 * 60 * 24 * 365 * 2; // 2 years

export function readDeviceId(request: NextRequest | Request): string | null {
  const cookie = "cookies" in request ? request.cookies.get(DEVICE_ID_COOKIE)?.value : undefined;
  return cookie ?? null;
}

/** Uses the Web Crypto API (globalThis.crypto), not Node's `crypto` module — this
 * needs to run in proxy.ts, which executes on the Edge runtime. */
export function generateDeviceId(): string {
  return crypto.randomUUID();
}

export const DEVICE_ID_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: SECURE_COOKIES,
  sameSite: "lax" as const,
  path: "/",
  maxAge: DEVICE_ID_MAX_AGE_SECONDS,
};
