"use client";

import { useState } from "react";

const DAYS = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 7, label: "Sun" },
];

export type WorkArrangementValue = "ON_SITE" | "HYBRID" | "REMOTE";

/**
 * Renders as plain fields inside whatever <form> contains it (a server action form),
 * not a form of its own — the day checkboxes only need local state to decide whether
 * to show themselves, not to control submission.
 */
export function WorkArrangementFields({
  defaultArrangement = "ON_SITE",
  defaultOnSiteDays = [],
}: {
  defaultArrangement?: WorkArrangementValue;
  defaultOnSiteDays?: number[];
}) {
  const [arrangement, setArrangement] = useState<WorkArrangementValue>(defaultArrangement);

  return (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium">Work arrangement</label>
        <select
          name="workArrangement"
          defaultValue={defaultArrangement}
          onChange={(e) => setArrangement(e.target.value as WorkArrangementValue)}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="ON_SITE">On-site (Mon–Fri)</option>
          <option value="HYBRID">Hybrid</option>
          <option value="REMOTE">Remote</option>
        </select>
      </div>
      {arrangement === "HYBRID" ? (
        <div className="sm:col-span-2">
          <label className="mb-1 block text-sm font-medium">On-site days</label>
          <div className="flex flex-wrap gap-4">
            {DAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  name="onSiteDays"
                  value={d.value}
                  defaultChecked={defaultOnSiteDays.includes(d.value)}
                />
                {d.label}
              </label>
            ))}
          </div>
        </div>
      ) : arrangement === "REMOTE" ? (
        <p className="text-xs text-muted-foreground sm:col-span-2">
          Remote employees can still clock in if needed, but are excluded from Analytics performance scoring.
        </p>
      ) : null}
    </>
  );
}
