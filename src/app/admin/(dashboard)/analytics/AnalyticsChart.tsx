"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import type { EmployeeAttendanceScore } from "@/lib/analytics/query";

const BAR_WIDTH_PX = 70;
const MIN_CHART_WIDTH_PX = 600;

function scoreColor(percentage: number): string {
  if (percentage >= 80) return "#16a34a";
  if (percentage >= 50) return "#f59e0b";
  return "#dc2626";
}

function ScoreTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: EmployeeAttendanceScore }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]!.payload;
  return (
    <div className="rounded-md border bg-card p-3 text-xs shadow-md">
      <p className="font-medium">{d.employeeName}</p>
      <p className="mt-1">Score: {d.percentage.toFixed(0)}%</p>
      <p className="mt-1 text-muted-foreground">
        Early: {d.early} · On time: {d.onTime} · Late: {d.late}
      </p>
    </div>
  );
}

/** Employee-per-bar performance chart. Horizontally scrollable at a fixed
 * per-bar width so names stay readable no matter how many employees there are,
 * rather than squeezing bars to fit a fixed container width. */
export function AnalyticsChart({ data }: { data: EmployeeAttendanceScore[] }) {
  const width = Math.max(MIN_CHART_WIDTH_PX, data.length * BAR_WIDTH_PX);

  return (
    <div className="overflow-x-auto">
      <div style={{ width, height: 360 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, bottom: 64, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis
              dataKey="employeeName"
              angle={-35}
              textAnchor="end"
              interval={0}
              height={70}
              fontSize={11}
              stroke="var(--muted-foreground)"
            />
            <YAxis domain={[0, 100]} unit="%" fontSize={12} stroke="var(--muted-foreground)" />
            <Tooltip content={<ScoreTooltip />} />
            <Bar dataKey="percentage" radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.employeeId} fill={scoreColor(d.percentage)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
