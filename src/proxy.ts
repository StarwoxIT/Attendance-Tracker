import { NextResponse, type NextRequest } from "next/server";
import { DEVICE_ID_COOKIE, DEVICE_ID_COOKIE_OPTIONS, generateDeviceId } from "@/lib/security/deviceId";

const ADMIN_SESSION_COOKIE = "attendance_admin_session";

/**
 * Edge-safe first pass only: redirects obviously-unauthenticated requests away
 * from /admin before they reach a server component. This is NOT the source of
 * truth — Prisma can't run on the Edge runtime, so every admin page/action
 * still calls requireUser()/requirePermission() server-side (lib/auth/guard.ts),
 * which is what actually enforces auth and RBAC.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") && pathname !== "/admin/login" && pathname !== "/admin/setup") {
    const hasSession = request.cookies.has(ADMIN_SESSION_COOKIE);
    if (!hasSession) {
      return NextResponse.redirect(new URL("/admin/login", request.url));
    }
  }

  const response = NextResponse.next();
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(self), geolocation=(), microphone=()");

  // Assign the persistent device-tracking cookie on first visit to the register
  // flow, so it's already present by the time the employee submits a clock-in.
  if (pathname.startsWith("/register") && !request.cookies.has(DEVICE_ID_COOKIE)) {
    response.cookies.set(DEVICE_ID_COOKIE, generateDeviceId(), DEVICE_ID_COOKIE_OPTIONS);
  }

  return response;
}

export const config = {
  matcher: ["/admin/:path*", "/api/:path*", "/register/:path*"],
};
