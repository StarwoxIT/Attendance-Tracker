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
    for (const row of rows) sheet.addRow(Object.values(row as Record<string, unknown>));
    headers.forEach((_, i) => {
      sheet.getColumn(i + 1).width = 18;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
