import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { fetchMonthlyReportRows } from "@/lib/reports/query";
import { rowsToCsv } from "@/lib/reports/csv";
import { rowsToExcelBuffer } from "@/lib/reports/excel";
import { generateReportPdf } from "@/lib/reports/pdf";
import { getCompanySettings } from "@/lib/company/settings";
import { getAttendanceSettings } from "@/lib/attendance/settings";
import { formatInTimeZone } from "date-fns-tz";
import { fetchAttendanceScores } from "@/lib/analytics/query";
import { monthRange } from "@/lib/analytics/dateRanges";
import { buildReportSummary, summaryToLines } from "@/lib/reports/summary";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await requirePermission("reports", "view");
  } catch (err) {
    return NextResponse.json({ ok: false }, { status: (err as { status?: number }).status ?? 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "csv";
  const month = searchParams.get("month") ?? formatInTimeZone(new Date(), "Africa/Lagos", "yyyy-MM");
  const officeId = searchParams.get("officeId") ?? undefined;

  const rows = await fetchMonthlyReportRows(month, officeId);

  const settings = await getAttendanceSettings();
  const range = monthRange(month);
  const scores = await fetchAttendanceScores({
    from: new Date(`${range.from}T00:00:00Z`),
    to: new Date(`${range.to}T00:00:00Z`),
    officeId,
    weights: { earlyPoints: settings.earlyPoints, onTimePoints: settings.onTimePoints, latePoints: settings.latePoints },
  });
  const summaryLines = summaryToLines(buildReportSummary(scores));

  if (format === "xlsx") {
    const buffer = await rowsToExcelBuffer(rows, "Monthly Attendance", summaryLines);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=monthly-attendance.xlsx",
      },
    });
  }

  if (format === "pdf") {
    const company = await getCompanySettings();
    const buffer = await generateReportPdf({
      companyName: company.companyName,
      logoUrl: company.logoUrl,
      title: "Monthly Attendance Report",
      subtitle: month,
      generatedBy: user.fullName,
      summaryLines,
      headers: rows.length ? Object.keys(rows[0]!) : [],
      rows: rows.map((r) => Object.values(r).map(String)),
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=monthly-attendance.pdf" },
    });
  }

  const csv = rowsToCsv(rows, summaryLines);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=monthly-attendance.csv" },
  });
}
