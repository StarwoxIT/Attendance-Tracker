import { describe, it, expect } from "vitest";
import { rowsToCsv } from "@/lib/reports/csv";

describe("rowsToCsv", () => {
  const rows = [
    { name: "Ada Early", status: "EARLY" },
    { name: "Bola OnTime", status: "ON_TIME" },
  ];

  it("renders just the table when no summary is given", () => {
    const csv = rowsToCsv(rows);
    expect(csv).toBe('name,status\nAda Early,EARLY\nBola OnTime,ON_TIME');
  });

  it("prepends a Summary block, blank line, then the table when summary lines are given", () => {
    const csv = rowsToCsv(rows, ["Early arrivals: 1 · On-time arrivals: 1"]);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Summary");
    expect(lines[1]).toContain("Early arrivals: 1");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe("name,status");
    expect(lines[4]).toBe("Ada Early,EARLY");
  });

  it("quotes a summary line containing a comma", () => {
    const csv = rowsToCsv(rows, ["Top performers: Ada, Bola"]);
    expect(csv.split("\n")[1]).toBe('"Top performers: Ada, Bola"');
  });

  it("still shows the summary even when there are no data rows", () => {
    const csv = rowsToCsv([], ["Early arrivals: 0"]);
    expect(csv).toBe("Summary\nEarly arrivals: 0\n");
  });

  it("returns an empty string when there is neither data nor a summary", () => {
    expect(rowsToCsv([])).toBe("");
  });
});
