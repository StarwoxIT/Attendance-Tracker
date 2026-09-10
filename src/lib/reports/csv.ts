function escapeCsvCell(value: unknown): string {
  const str = String(value ?? "");
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function rowsToCsv<T extends object>(rows: T[], summaryLines?: string[]): string {
  const lines: string[] = [];

  if (summaryLines?.length) {
    lines.push("Summary");
    for (const line of summaryLines) lines.push(escapeCsvCell(line));
    lines.push("");
  }

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]!);
    lines.push(headers.join(","));
    for (const row of rows) {
      lines.push(headers.map((h) => escapeCsvCell((row as Record<string, unknown>)[h])).join(","));
    }
  }

  return lines.join("\n");
}
