import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { fetchAttendanceScores } from "@/lib/analytics/query";
import { scoresToExportRows } from "@/lib/analytics/exportRows";
import { rowsToCsv } from "@/lib/reports/csv";
import { rowsToExcelBuffer } from "@/lib/reports/excel";
import { generateReportPdf } from "@/lib/reports/pdf";
import { getCompanySettings } from "@/lib/company/settings";
import { getAttendanceSettings } from "@/lib/attendance/settings";
import { thisMonthRange } from "@/lib/analytics/dateRanges";

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
  const officeId = searchParams.get("officeId") ?? undefined;

  const settings = await getAttendanceSettings();
  const defaultRange = thisMonthRange(settings.timezone);
  const from = searchParams.get("from") || defaultRange.from;
  const to = searchParams.get("to") || defaultRange.to;

  const scores = await fetchAttendanceScores({
    from: new Date(`${from}T00:00:00Z`),
    to: new Date(`${to}T00:00:00Z`),
    officeId,
    weights: {
      earlyPoints: settings.earlyPoints,
      onTimePoints: settings.onTimePoints,
      latePoints: settings.latePoints,
      missedClockOutPoints: settings.missedClockOutPoints,
    },
  });
  const rows = scoresToExportRows(scores);
  const subtitle = `${from} to ${to}`;

  if (format === "xlsx") {
    const buffer = await rowsToExcelBuffer(rows, "Performance Report");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=performance-report.xlsx",
      },
    });
  }

  if (format === "pdf") {
    const company = await getCompanySettings();
    const buffer = await generateReportPdf({
      companyName: company.companyName,
      logoUrl: company.logoUrl,
      title: "Performance Report",
      subtitle,
      generatedBy: user.fullName,
      headers: rows.length ? Object.keys(rows[0]!) : [],
      rows: rows.map((r) => Object.values(r).map(String)),
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=performance-report.pdf" },
    });
  }

  const csv = rowsToCsv(rows);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=performance-report.csv" },
  });
}
