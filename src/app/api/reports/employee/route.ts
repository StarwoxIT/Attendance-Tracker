import { NextRequest, NextResponse } from "next/server";
import { requirePermission } from "@/lib/auth/guard";
import { hasPermission } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db/prisma";
import { fetchEmployeeAttendanceRows } from "@/lib/reports/query";
import { rowsToCsv } from "@/lib/reports/csv";
import { rowsToExcelBuffer } from "@/lib/reports/excel";
import { generateReportPdf } from "@/lib/reports/pdf";
import { getCompanySettings } from "@/lib/company/settings";
import { getAttendanceSettings } from "@/lib/attendance/settings";

export const runtime = "nodejs";

/** Relative PDF column widths — the task list gets most of the page. */
const PDF_COLUMN_FLEX: Record<string, number> = { Tasks: 4, Status: 1.6 };

export async function GET(request: NextRequest) {
  let user;
  try {
    user = await requirePermission("reports", "view");
  } catch (err) {
    return NextResponse.json({ ok: false }, { status: (err as { status?: number }).status ?? 401 });
  }

  const { searchParams } = new URL(request.url);
  const format = searchParams.get("format") ?? "csv";
  const employeeId = searchParams.get("employeeId");
  if (!employeeId) return NextResponse.json({ ok: false, message: "Choose an employee." }, { status: 400 });
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) return NextResponse.json({ ok: false, message: "Employee not found." }, { status: 404 });

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const settings = await getAttendanceSettings();
  const rows = await fetchEmployeeAttendanceRows(
    {
      employeeId,
      from: from ?? undefined,
      to: to ?? undefined,
      // HR/Viewer can export attendance but not what people worked on.
      includeTasks: hasPermission(user.role, "taskReports", "view"),
    },
    settings.timezone
  );

  const name = `${employee.firstName} ${employee.lastName}`;
  const fileName = `attendance-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  if (format === "xlsx") {
    const buffer = await rowsToExcelBuffer(rows, "Employee Attendance");
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename=${fileName}.xlsx`,
      },
    });
  }

  if (format === "pdf") {
    const company = await getCompanySettings();
    const headers = rows.length ? Object.keys(rows[0]!) : [];
    const buffer = await generateReportPdf({
      companyName: company.companyName,
      logoUrl: company.logoUrl,
      title: `Employee Attendance Report — ${name}`,
      subtitle: `${from ?? "All dates"} to ${to ?? "present"}`,
      generatedBy: user.fullName,
      headers,
      rows: rows.map((r) => Object.values(r)),
      columnFlex: headers.map((h) => PDF_COLUMN_FLEX[h] ?? 1),
    });
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename=${fileName}.pdf` },
    });
  }

  const csv = rowsToCsv(rows);
  return new NextResponse(csv, {
    headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename=${fileName}.csv` },
  });
}
