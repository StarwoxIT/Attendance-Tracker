import { cookies } from "next/headers";
import { getCompanySettings } from "@/lib/company/settings";
import { getAttendanceSettings } from "@/lib/attendance/settings";
import { getActiveQrSession } from "@/lib/qr/session";
import { QR_SESSION_COOKIE } from "@/lib/attendance/clockHandler";
import { AttendanceRegister } from "@/components/attendance/AttendanceRegister";

export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; qr?: string }>;
}) {
  const { error } = await searchParams;
  const [company, settings] = await Promise.all([getCompanySettings(), getAttendanceSettings()]);

  // QR + location mode: a scan of the office QR, backed by the phone's location.
  const requiresQr = settings.attendanceMode === "QR_ONLY";

  let hasValidQrSession = false;
  if (requiresQr) {
    const store = await cookies();
    const token = store.get(QR_SESSION_COOKIE)?.value;
    if (token) {
      const session = await getActiveQrSession(token);
      hasValidQrSession = session.ok;
    }
  }

  if (requiresQr && !hasValidQrSession && !error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-8 text-center sm:px-6 sm:py-12">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
          {company.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={company.logoUrl}
              alt={company.companyName}
              className="mx-auto mb-4 h-16 w-16 object-contain sm:h-20 sm:w-20"
            />
          ) : null}
          <h1 className="text-xl font-bold sm:text-2xl">{company.companyName}</h1>
          <p className="mt-6 text-lg font-medium">Today&apos;s attendance requires QR verification.</p>
          <p className="mt-2 text-muted-foreground">
            Please scan the attendance QR code displayed at the office.
          </p>
        </div>
      </div>
    );
  }

  return (
    <AttendanceRegister
      companyName={company.companyName}
      logoUrl={company.logoUrl}
      resetSeconds={settings.kioskResetSeconds}
      initialError={error ?? null}
      hasQrSession={hasValidQrSession}
      checkLocation={hasValidQrSession}
    />
  );
}
