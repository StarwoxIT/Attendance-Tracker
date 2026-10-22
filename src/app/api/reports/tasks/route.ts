import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { fetchTaskReportRows, summarizeTaskReportRows } from "@/lib/reports/query";
import { rowsToCsv } from "@/lib/reports/csv";
import { rowsToExcelBuffer } from "@/lib/reports/excel";
import { generateReportPdf } from "@/lib/reports/pdf";
import { getCompanySettings } from "@/lib/company/settings";
import { getAttendanceSettings } from "@/lib/attendance/settings";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  let user;
  try {
    // Task reports are narrower than the other reports — Admin and Super Admin only.
    user = await requirePermission("taskReports", "view");
  } catch (err) {
    return NextResponse.json({ ok: false }, { status: (err as { status?: number }).status ?? 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "csv";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const settings = await getAttendanceSettings();

  const rows = await fetchTaskReportRows(
    {
      from: from ?? undefined,
      to: to ?? undefined,
      officeId: searchParams.get("officeId") ?? undefined,
      status: searchParams.get("status") ?? undefined,
    },
    settings.timezone
  );
  const summaryLines = summarizeTaskReportRows(rows);

  if (format === "xlsx") {
    const buffer = await rowsToExcelBuffer(rows, "Task Reports", summaryLines);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=task-reports.xlsx",
      },
    });
  }

  if (format === "pdf") {
    const company = await getCompanySettings();
    const buffer = await generateReportPdf({
      companyName: company.companyName,
      logoUrl: company.logoUrl,
      title: "Daily Task Report",
      subtitle: `${from ?? "All dates"} to ${to ?? "present"}`,
      generatedBy: user.fullName,
      summaryLines,
      headers: rows.length ? Object.keys(rows[0]!) : [],
      rows: rows.map((r) => Object.values(r).map(String)),
      // The task list is the last column — give it most of the page width.
      columnFlex: rows.length ? Object.keys(rows[0]!).map((key) => (key === "tasks" ? 6 : 1)) : undefined,
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": "attachment; filename=task-reports.pdf" },
    });
  }

  const csv = rowsToCsv(rows, summaryLines);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": "attachment; filename=task-reports.csv" },
  });
}
