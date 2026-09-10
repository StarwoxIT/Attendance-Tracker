"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, CartesianGrid, Cell } from "recharts";
import type { EmployeeAttendanceScore } from "@/lib/analytics/query";

const BAR_WIDTH_PX = 36;
const MIN_CHART_WIDTH_PX = 500;
const TOOLTIP_WIDTH_PX = 200;
const TOOLTIP_OFFSET_PX = 14;

function scoreColor(percentage: number): string {
  if (percentage >= 80) return "#16a34a";
  if (percentage >= 50) return "#f59e0b";
  return "#dc2626";
}

interface HoverState {
  data: EmployeeAttendanceScore;
  clientX: number;
  clientY: number;
}

/**
 * Bars respond to both hover (desktop mouse) and tap (touch): a tap fires
 * onClick reliably on every mobile browser, unlike relying on the legacy
 * mouseover/mousemove compatibility events browsers sometimes synthesize after
 * a touch — those are inconsistent and, worse, never followed by a matching
 * mouseleave, so a tapped bar's tooltip would otherwise stay stuck on screen
 * forever. Tapping the same bar again, or anywhere outside the chart, closes it.
 *
 * The tooltip itself is portaled to <body> and positioned from the raw
 * viewport coordinates (not chart-relative), so it can never be clipped by
 * this chart's horizontally-scrolling container the way recharts' built-in
 * <Tooltip> would be for bars near either edge.
 */
export function AnalyticsChart({ data }: { data: EmployeeAttendanceScore[] }) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);
  const width = Math.max(MIN_CHART_WIDTH_PX, data.length * BAR_WIDTH_PX);

  function trackHover(rowData: EmployeeAttendanceScore, event: React.MouseEvent) {
    setHover({ data: rowData, clientX: event.clientX, clientY: event.clientY });
  }

  function handleTap(rowData: EmployeeAttendanceScore, event: React.MouseEvent) {
    setHover((current) => (current?.data.employeeId === rowData.employeeId ? null : { data: rowData, clientX: event.clientX, clientY: event.clientY }));
  }

  // Tapping anywhere outside the chart dismisses an open (tapped) tooltip. Clicks
  // inside the chart are left alone — a different bar's own onClick handles that.
  useEffect(() => {
    if (!hover) return;
    function handleOutside(event: MouseEvent | TouchEvent) {
      if (chartRef.current?.contains(event.target as Node)) return;
      setHover(null);
    }
    document.addEventListener("click", handleOutside);
    document.addEventListener("touchstart", handleOutside);
    return () => {
      document.removeEventListener("click", handleOutside);
      document.removeEventListener("touchstart", handleOutside);
    };
  }, [hover]);

  const flipLeft = hover ? hover.clientX + TOOLTIP_OFFSET_PX + TOOLTIP_WIDTH_PX > window.innerWidth : false;
  const flipUp = hover ? hover.clientY + TOOLTIP_OFFSET_PX + 90 > window.innerHeight : false;

  return (
    <div ref={chartRef} className="overflow-x-auto">
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
              fontSize={10}
              stroke="var(--muted-foreground)"
            />
            <YAxis domain={[0, 100]} unit="%" fontSize={12} stroke="var(--muted-foreground)" />
            <Bar dataKey="percentage" radius={[3, 3, 0, 0]} onMouseLeave={() => setHover(null)}>
              {data.map((d) => (
                <Cell
                  key={d.employeeId}
                  fill={scoreColor(d.percentage)}
                  onMouseEnter={(e: React.MouseEvent) => trackHover(d, e)}
                  onMouseMove={(e: React.MouseEvent) => trackHover(d, e)}
                  onClick={(e: React.MouseEvent) => handleTap(d, e)}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {hover && typeof document !== "undefined"
        ? createPortal(
            <div
              className="pointer-events-none fixed z-50 rounded-md border bg-card p-3 text-xs shadow-md"
              style={{
                width: TOOLTIP_WIDTH_PX,
                left: flipLeft ? hover.clientX - TOOLTIP_OFFSET_PX - TOOLTIP_WIDTH_PX : hover.clientX + TOOLTIP_OFFSET_PX,
                top: flipUp ? hover.clientY - TOOLTIP_OFFSET_PX - 90 : hover.clientY + TOOLTIP_OFFSET_PX,
              }}
            >
              <p className="font-medium">{hover.data.employeeName}</p>
              <p className="mt-1">Score: {hover.data.percentage.toFixed(0)}%</p>
              <p className="mt-1 text-muted-foreground">
                Early: {hover.data.early} · On time: {hover.data.onTime} · Late: {hover.data.late}
              </p>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
