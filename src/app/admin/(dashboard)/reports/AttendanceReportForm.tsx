"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ExportButtons, Field } from "./reportFields";

type ReportType = "daily" | "monthly";

/** Daily and monthly attendance exports share one form — the type picks the date
 * fields and which export endpoint the form submits to. */
export function AttendanceReportForm({
  offices,
  currentMonth,
}: {
  offices: { id: string; name: string }[];
  currentMonth: string;
}) {
  const [type, setType] = useState<ReportType>("daily");

  return (
    <form action={`/api/reports/${type}`} className="flex flex-wrap items-end gap-2">
      <Field label="Type">
        <select
          value={type}
          onChange={(e) => setType(e.target.value as ReportType)}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
        >
          <option value="daily">Daily</option>
          <option value="monthly">Monthly</option>
        </select>
      </Field>
      {type === "daily" ? (
        <>
          <Field label="From"><Input type="date" name="from" /></Field>
          <Field label="To"><Input type="date" name="to" /></Field>
        </>
      ) : (
        <Field label="Month">
          <Input type="month" name="month" defaultValue={currentMonth} />
        </Field>
      )}
      <Field label="Office">
        <select name="officeId" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">All</option>
          {offices.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </Field>
      <ExportButtons />
    </form>
  );
}
