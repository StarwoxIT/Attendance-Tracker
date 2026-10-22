import ExcelJS from "exceljs";

export async function rowsToExcelBuffer<T extends object>(
  rows: T[],
  sheetName: string,
  summaryLines?: string[]
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);

  if (summaryLines?.length) {
    const titleRow = sheet.addRow(["Summary"]);
    titleRow.font = { bold: true };
    for (const line of summaryLines) sheet.addRow([line]);
    sheet.addRow([]);
  }

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]!);
    const headerRow = sheet.addRow(headers);
    headerRow.font = { bold: true };
    const wrappedColumns = new Set<number>();
    for (const row of rows) {
      const added = sheet.addRow(Object.values(row as Record<string, unknown>));
      // Multi-line cells (e.g. a day's task list) only show their line breaks with wrapping on.
      added.eachCell((cell, colNumber) => {
        if (typeof cell.value === "string" && cell.value.includes("\n")) {
          cell.alignment = { wrapText: true, vertical: "top" };
          wrappedColumns.add(colNumber);
        }
      });
    }
    headers.forEach((_, i) => {
      sheet.getColumn(i + 1).width = wrappedColumns.has(i + 1) ? 60 : 18;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
