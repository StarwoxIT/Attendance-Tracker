import type { AttendanceDenialReason } from "./engine";

export const DENIAL_MESSAGES: Record<AttendanceDenialReason, string> = {
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  INVALID_EMPLOYEE: "Attendance ID not recognized.\nPlease contact HR if you believe this is an error.",
  QR_REQUIRED:
    "Today's attendance requires QR verification.\nPlease scan the attendance QR code displayed at the office.",
  QR_SESSION_INVALID: "This QR code is invalid or has expired.\nPlease scan today's attendance QR code.",
  QR_WRONG_OFFICE: "This QR code is not valid for your assigned office.",
  NETWORK_DENIED:
    "Attendance unavailable.\nYou must be connected to the company's authorized office network to clock attendance.",
  ALREADY_COMPLETE: "You have already clocked in and out today.",
  TASK_REPORT_REQUIRED: "Before you clock out, please tell us what you worked on today.",
  TASK_REPORT_INVALID:
    "Your task report couldn't be saved.\nEach task needs a description (max 500 characters) and a status, or if you had no tasks, a short explanation — please check and try again.",
  EARLY_CLOCKOUT_REASON_REQUIRED:
    "You're clocking out before the end of your scheduled work day.\nPlease briefly state why (max 50 words) to continue.",
};
