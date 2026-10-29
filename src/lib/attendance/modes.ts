import type { AttendanceMode } from "@prisma/client";

/** What admins see for each attendance mode. */
export const ATTENDANCE_MODE_LABELS: Record<AttendanceMode, string> = {
  NETWORK_ONLY: "Network mode",
  QR_ONLY: "QR + location mode",
};

export const ATTENDANCE_MODE_DESCRIPTIONS: Record<AttendanceMode, string> = {
  NETWORK_ONLY: "Staff clock in on the office Wi-Fi.",
  QR_ONLY:
    "For when the office network is down: staff scan the printed office QR code on mobile data, and their phone's location must be inside the office radius.",
};
