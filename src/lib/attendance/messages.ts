import type { AttendanceDenial, AttendanceDenialReason } from "./engine";
import { formatDistance } from "./location";

export const DENIAL_MESSAGES: Record<AttendanceDenialReason, string> = {
  RATE_LIMITED: "Too many attempts. Please wait a moment and try again.",
  INVALID_EMPLOYEE: "Attendance ID not recognized.\nPlease contact HR if you believe this is an error.",
  QR_REQUIRED:
    "Today's attendance requires QR verification.\nPlease scan the attendance QR code displayed at the office.",
  QR_SESSION_INVALID: "This QR code is invalid or has expired.\nPlease scan the attendance QR code at the office again.",
  QR_WRONG_OFFICE: "This QR code is not valid for your assigned office.",
  NETWORK_DENIED:
    "Attendance unavailable.\nYou must be connected to the company's authorized office network to clock attendance.",
  USE_QR_BACKUP:
    "You're not on the office Wi-Fi, and it looks like it's down.\nScan the attendance QR code poster at the office with your phone to clock in or out.",
  QR_BACKUP_INACTIVE:
    "The office Wi-Fi is working, so the QR code backup isn't open right now.\nConnect to the office Wi-Fi and try again.",
  LOCATION_REQUIRED:
    "We need your location to confirm you're at the office.\nAllow location access when your phone asks, then try again.",
  LOCATION_INACCURATE:
    "Your phone's location reading isn't precise enough to confirm you're at the office.\nMake sure Location/GPS is on, move near a window, and try again.",
  LOCATION_OUT_OF_RANGE:
    "Your location is outside the office area, so attendance wasn't recorded.\nIf you are at the office, move near a window and try again.",
  LOCATION_NOT_CONFIGURED:
    "QR attendance isn't set up for this office yet (its location hasn't been saved).\nPlease let your admin know.",
  ALREADY_COMPLETE: "You have already clocked in and out today.",
  TASK_REPORT_REQUIRED: "Before you clock out, please tell us what you worked on today.",
  TASK_REPORT_INVALID:
    "Your task report couldn't be saved.\nEach task needs a description (max 500 characters) and a status, or if you had no tasks, a short explanation — please check and try again.",
  EARLY_CLOCKOUT_REASON_REQUIRED:
    "You're clocking out before the end of your scheduled work day.\nPlease briefly state why (max 50 words) to continue.",
};

export function denialMessage(denial: AttendanceDenial): string {
  if (denial.reason === "LOCATION_OUT_OF_RANGE" && denial.distanceMeters != null) {
    return `Your phone places you ${formatDistance(denial.distanceMeters)} from the office, so attendance wasn't recorded.\nIf you are at the office, move near a window and try again.`;
  }
  return DENIAL_MESSAGES[denial.reason];
}
