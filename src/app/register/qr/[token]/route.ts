import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/lib/network/getClientIp";
import { validateQrToken, startQrSession } from "@/lib/qr/session";
import { QR_SESSION_COOKIE } from "@/lib/attendance/clockHandler";
import { checkRateLimit, RATE_LIMITS } from "@/lib/security/rateLimit";
import { SECURE_COOKIES } from "@/lib/security/secureCookies";

export const runtime = "nodejs";

/**
 * Redirects with a relative Location, so the phone stays on whatever address it
 * scanned. Not `new URL(path, request.url)`: in the self-hosted Docker image
 * request.url carries the container's bind address (HOSTNAME=0.0.0.0:3000), not
 * the public one, and phones were sent to http://0.0.0.0:3000/register.
 */
function redirectTo(path: string): NextResponse {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}

/**
 * Landing point for a scanned QR code. Validates the token, opens a short-lived
 * QR session bound to this device (httpOnly cookie), and redirects into the
 * normal register screen. The employee still has to enter their Attendance ID and
 * share a location inside the office radius (checked at clock-in time) — the scan
 * alone never records attendance.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sourceIp = getClientIp(request);

  const rate = await checkRateLimit(sourceIp ?? "unknown", RATE_LIMITS.qrLookup);
  if (!rate.allowed) {
    return redirectTo("/register?error=rate_limited");
  }

  const validation = await validateQrToken(token);

  if (!validation.ok) {
    return redirectTo(`/register?error=qr_${validation.reason.toLowerCase()}`);
  }

  const session = await startQrSession({
    qrCode: validation.qrCode,
    sourceIp: sourceIp ?? "unknown",
    userAgent: request.headers.get("user-agent"),
  });

  const response = redirectTo("/register?qr=1");
  response.cookies.set(QR_SESSION_COOKIE, session.sessionToken, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
    expires: session.expiresAt,
  });
  return response;
}
