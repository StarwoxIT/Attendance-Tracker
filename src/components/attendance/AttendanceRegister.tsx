"use client";

import { useState, useRef, useEffect, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { countWords, MAX_EARLY_CLOCKOUT_REASON_WORDS } from "@/lib/attendance/rules";
import {
  MAX_NO_TASKS_REASON_LENGTH,
  MAX_TASK_DESCRIPTION_LENGTH,
  MAX_TASKS_PER_REPORT,
  TASK_STATUS_LABELS,
  TASK_STATUSES,
  type TaskReportInput,
} from "@/lib/attendance/taskReport";

interface AttendanceRegisterProps {
  companyName: string;
  logoUrl: string | null;
  resetSeconds: number;
  initialError?: string | null;
  hasQrSession: boolean;
  /** QR + location mode: the scan has to be backed by the phone's location. */
  checkLocation: boolean;
}

type ClockResult =
  | {
      ok: true;
      action: "CLOCK_IN" | "CLOCK_OUT";
      firstName: string;
      time: string;
      status?: string;
      clockInTime?: string;
      totalMinutesWorked?: number;
      clockOutStatus?: "EARLY" | "ON_TIME";
      tasksReported?: number;
      alreadyClockedIn?: boolean;
    }
  | { ok: false; message: string };

/** Clock-out is a short wizard: ID → task report → (only if leaving early) reason. */
type Step = "id" | "tasks" | "earlyReason";

/** "none" = the employee had no tasks today and explains why instead. */
type ReportMode = "tasks" | "none";

type ReportPayload = { tasks: TaskReportInput; noTasksReason?: never } | { noTasksReason: string; tasks?: never };

interface TaskDraft {
  key: number;
  description: string;
  status: TaskReportInput[number]["status"] | "";
}

const ERROR_MESSAGES: Record<string, string> = {
  rate_limited: "Too many attempts. Please wait a moment and try again.",
  qr_not_found: "This QR code is invalid or has expired.\nPlease scan today's attendance QR code.",
  qr_deactivated: "This QR code is invalid or has expired.\nPlease scan today's attendance QR code.",
  qr_expired: "This QR code has expired.\nPlease scan today's attendance QR code.",
  qr_not_yet_active: "This QR code is not active yet.",
};

// Denials that end the attempt outright. Anything else hit mid clock-out (network
// blip, server error, rate limit) keeps the report on screen so the employee can retry.
const FINAL_DENIALS = new Set(["ALREADY_COMPLETE", "INVALID_EMPLOYEE"]);

const REQUEST_TIMEOUT_MS = 20_000;

// Denials an employee fixes by trying again where they stand (allow location, move
// near a window) — kept on the ID screen with their ID still filled in.
const LOCATION_DENIALS = new Set(["LOCATION_REQUIRED", "LOCATION_INACCURATE", "LOCATION_OUT_OF_RANGE"]);

const LOCATION_TIMEOUT_MS = 15_000;
/** A good reading is reused across the clock-out steps rather than re-fetched for each. */
const LOCATION_REUSE_MS = 60_000;

const LOCATION_ERRORS = {
  denied:
    "Location access is blocked, so we can't confirm you're at the office.\niPhone: Settings › Privacy & Security › Location Services › Safari Websites › While Using the App.\nAndroid: tap the icon left of the web address › Permissions › Location › Allow.\nThen try again.",
  unavailable: "Your phone couldn't work out where you are.\nMake sure Location/GPS is turned on, then try again.",
  timeout: "Finding your location took too long.\nMake sure Location/GPS is on, move near a window, and try again.",
  unsupported: "This browser can't share your location.\nPlease open the QR link in Chrome or Safari and try again.",
  // Browsers only hand out location on https pages — no setting on the phone fixes this.
  insecure:
    "Your location can't be checked because this attendance page isn't on a secure (https) connection.\nPlease let your admin know.",
};

interface LocationReading {
  latitude: number;
  longitude: number;
  accuracy: number;
}

/** The phone's position, or why we couldn't get it. The server makes the actual decision. */
function readLocation(): Promise<{ reading: LocationReading } | { error: string }> {
  if (typeof window !== "undefined" && !window.isSecureContext) {
    return Promise.resolve({ error: LOCATION_ERRORS.insecure });
  }
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ error: LOCATION_ERRORS.unsupported });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ reading: { latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy } }),
      (err) =>
        resolve({
          error:
            err.code === err.PERMISSION_DENIED
              ? LOCATION_ERRORS.denied
              : err.code === err.TIMEOUT
                ? LOCATION_ERRORS.timeout
                : LOCATION_ERRORS.unavailable,
        }),
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 0 }
    );
  });
}

export function AttendanceRegister({
  companyName,
  logoUrl,
  resetSeconds,
  initialError,
  hasQrSession,
  checkLocation,
}: AttendanceRegisterProps) {
  const [attendanceId, setAttendanceId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [step, setStep] = useState<Step>("id");
  const [tasks, setTasks] = useState<TaskDraft[]>([]);
  const [reportMode, setReportMode] = useState<ReportMode>("tasks");
  const [noTasksReason, setNoTasksReason] = useState("");
  const [showTaskErrors, setShowTaskErrors] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);
  const [earlyReason, setEarlyReason] = useState("");
  const [result, setResult] = useState<ClockResult | null>(
    initialError ? { ok: false, message: ERROR_MESSAGES[initialError] ?? "Something went wrong." } : null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const nextTaskKey = useRef(0);
  const lastLocation = useRef<{ reading: LocationReading; at: number } | null>(null);

  useEffect(() => {
    if (step === "earlyReason") {
      reasonRef.current?.focus();
    } else if (step === "id") {
      inputRef.current?.focus();
    }
  }, [result, step]);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => {
      setResult(null);
      setAttendanceId("");
    }, resetSeconds * 1000);
    return () => clearTimeout(t);
  }, [result, resetSeconds]);

  function newTask(): TaskDraft {
    nextTaskKey.current += 1;
    return { key: nextTaskKey.current, description: "", status: "" };
  }

  function resetFlow() {
    setStep("id");
    setTasks([]);
    setReportMode("tasks");
    setNoTasksReason("");
    setShowTaskErrors(false);
    setStepError(null);
    setEarlyReason("");
    setAttendanceId("");
  }

  async function submitClock(payload: Partial<ReportPayload> & { earlyClockOutReason?: string } = {}) {
    setSubmitting(true);
    setStepError(null);
    const midClockOut = step !== "id";

    let location: LocationReading | undefined;
    let locationProblem: string | null = null;
    if (checkLocation) {
      const cached = lastLocation.current;
      if (cached && Date.now() - cached.at < LOCATION_REUSE_MS) {
        location = cached.reading;
      } else {
        setLocating(true);
        const found = await readLocation();
        setLocating(false);
        if ("reading" in found) {
          location = found.reading;
          lastLocation.current = { reading: found.reading, at: Date.now() };
        } else {
          // Still sent — the server is what decides. Its "location required" answer
          // is then replaced by this more specific reason.
          locationProblem = found.error;
        }
      }
    }

    // Give up on a stalled request instead of spinning forever (which is what sent
    // people to the refresh button). Retrying is safe: a repeat of a clock-in that
    // did go through is answered as "already clocked in", never a second record.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/attendance/clock-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendanceId, ...payload, ...(location ? { location } : {}) }),
        signal: controller.signal,
      });
      // A crashed request returns an HTML error page, not JSON — report it as a server error rather than a network one.
      const data = await res.json().catch(() => ({
        ok: false,
        reason: "SERVER_ERROR",
        message: "Something went wrong on the server and nothing was saved. Please try again — if it keeps happening, tell your admin.",
      }));
      if (!data.ok && LOCATION_DENIALS.has(data.reason)) {
        // Whatever reading led here isn't worth reusing on the retry.
        lastLocation.current = null;
        if (data.reason === "LOCATION_REQUIRED" && locationProblem) data.message = locationProblem;
      }
      if (data.ok) {
        resetFlow();
        setResult(data as ClockResult);
      } else if (!midClockOut && LOCATION_DENIALS.has(data.reason)) {
        setStepError(data.message);
      } else if (data.reason === "TASK_REPORT_REQUIRED") {
        setTasks((current) => (current.length > 0 ? current : [newTask()]));
        setStep("tasks");
      } else if (data.reason === "EARLY_CLOCKOUT_REASON_REQUIRED") {
        setStep("earlyReason");
      } else if (midClockOut && !FINAL_DENIALS.has(data.reason)) {
        setStepError(data.message ?? "Your report couldn't be saved. Please try again.");
      } else {
        resetFlow();
        setResult({ ok: false, message: data.message ?? "Attendance could not be recorded." });
      }
    } catch (err) {
      // Timed out or the connection dropped: we can't tell whether the server got
      // it, so say so honestly — retrying is safe either way.
      const message =
        err instanceof DOMException && err.name === "AbortError"
          ? "This is taking too long to respond. Please try again — if it already went through, you'll see that instead of a duplicate."
          : checkLocation
            ? "Connection problem — please check your phone's internet connection and try again. If it already went through, you'll see that instead of a duplicate."
            : "Connection problem — please check you're on the office Wi-Fi and try again. If it already went through, you'll see that instead of a duplicate.";
      if (midClockOut) {
        setStepError(message);
      } else {
        resetFlow();
        setResult({ ok: false, message });
      }
    } finally {
      clearTimeout(timeout);
      setSubmitting(false);
    }
  }

  /** The report to send — the task list, or the no-tasks explanation, whichever the employee chose. */
  function completedReport(): ReportPayload | null {
    if (reportMode === "none") {
      return noTasksReason.trim() ? { noTasksReason: noTasksReason.trim() } : null;
    }
    const valid = tasks.every((t) => t.description.trim() !== "" && t.status !== "");
    if (!valid) return null;
    return {
      tasks: tasks.map((t) => ({ description: t.description.trim(), status: t.status as TaskReportInput[number]["status"] })),
    };
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!attendanceId.trim() || submitting) return;
    submitClock();
  }

  function handleSubmitTasks(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    const report = completedReport();
    if (!report) {
      setShowTaskErrors(true);
      return;
    }
    submitClock(report);
  }

  function handleConfirmEarlyClockOut(e: FormEvent) {
    e.preventDefault();
    const wordCount = countWords(earlyReason);
    const report = completedReport();
    if (wordCount === 0 || wordCount > MAX_EARLY_CLOCKOUT_REASON_WORDS || submitting || !report) return;
    submitClock({ ...report, earlyClockOutReason: earlyReason.trim() });
  }

  function updateTask(key: number, patch: Partial<Omit<TaskDraft, "key">>) {
    setTasks((current) => current.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  if (result) {
    return <ResultScreen result={result} />;
  }

  if (step === "tasks") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-xl rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
          <h2 className="text-center text-xl font-bold">What have you worked on today?</h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            Add each task you worked on and how far you got. You&apos;ll be clocked out once your report is saved.
          </p>
          <form onSubmit={handleSubmitTasks} className="mt-6 flex flex-col gap-4" noValidate>
            <div role="radiogroup" aria-label="What have you worked on today?" className="flex flex-col gap-2">
              {(
                [
                  ["tasks", "I worked on tasks today"],
                  ["none", "I have no tasks to report today"],
                ] as const
              ).map(([mode, label]) => (
                <label
                  key={mode}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-4 py-3 text-sm ${reportMode === mode ? "border-primary bg-primary/5" : "border-input"}`}
                >
                  <input
                    type="radio"
                    name="reportMode"
                    value={mode}
                    checked={reportMode === mode}
                    onChange={() => {
                      setReportMode(mode);
                      setShowTaskErrors(false);
                      setStepError(null);
                    }}
                    className="h-4 w-4 accent-primary"
                  />
                  {label}
                </label>
              ))}
            </div>

            {reportMode === "none" ? (
              <div className="flex flex-col gap-1">
                <label htmlFor="no-tasks-reason" className="text-sm font-medium">
                  Why did you have no tasks to report today? <span className="text-muted-foreground">(Required)</span>
                </label>
                <textarea
                  id="no-tasks-reason"
                  autoFocus
                  value={noTasksReason}
                  onChange={(e) => setNoTasksReason(e.target.value)}
                  rows={3}
                  maxLength={MAX_NO_TASKS_REASON_LENGTH}
                  placeholder="e.g. No tasks were assigned to me today."
                  aria-invalid={showTaskErrors && noTasksReason.trim() === ""}
                  className={`w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${showTaskErrors && noTasksReason.trim() === "" ? "border-red-500" : "border-input"}`}
                />
                <div className="flex justify-between gap-2 text-xs text-muted-foreground">
                  <span>Your explanation will be included in your daily report.</span>
                  <span className="shrink-0">
                    {noTasksReason.length}/{MAX_NO_TASKS_REASON_LENGTH}
                  </span>
                </div>
                {showTaskErrors && noTasksReason.trim() === "" ? (
                  <p className="text-xs text-red-600">Please explain why you have no tasks to report.</p>
                ) : null}
              </div>
            ) : (
              <>
                {tasks.map((task, index) => {
                  const descriptionMissing = showTaskErrors && task.description.trim() === "";
                  const statusMissing = showTaskErrors && task.status === "";
                  return (
                    <fieldset key={task.key} aria-label={`Task ${index + 1}`} className="rounded-lg border p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-semibold">Task {index + 1}</span>
                        {tasks.length > 1 ? (
                          <button
                            type="button"
                            onClick={() => setTasks((current) => current.filter((t) => t.key !== task.key))}
                            className="text-xs text-muted-foreground hover:text-red-600 hover:underline"
                          >
                            Remove
                          </button>
                        ) : null}
                      </div>
                      <label htmlFor={`task-${task.key}-description`} className="sr-only">
                        Task {index + 1} description
                      </label>
                      <textarea
                        id={`task-${task.key}-description`}
                        autoFocus={index === tasks.length - 1}
                        value={task.description}
                        onChange={(e) => updateTask(task.key, { description: e.target.value })}
                        rows={2}
                        maxLength={MAX_TASK_DESCRIPTION_LENGTH}
                        placeholder="e.g. Reconciled September vendor invoices"
                        aria-invalid={descriptionMissing}
                        className={`w-full rounded-md border bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${descriptionMissing ? "border-red-500" : "border-input"}`}
                      />
                      <div className="mt-2 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <label htmlFor={`task-${task.key}-status`} className="sr-only">
                          Task {index + 1} status
                        </label>
                        <select
                          id={`task-${task.key}-status`}
                          value={task.status}
                          onChange={(e) => updateTask(task.key, { status: e.target.value as TaskDraft["status"] })}
                          aria-invalid={statusMissing}
                          className={`h-10 rounded-md border bg-background px-3 text-sm ${statusMissing ? "border-red-500" : "border-input"}`}
                        >
                          <option value="">Select status…</option>
                          {TASK_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {TASK_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        <span className="text-right text-xs text-muted-foreground">
                          {task.description.length}/{MAX_TASK_DESCRIPTION_LENGTH}
                        </span>
                      </div>
                      {descriptionMissing || statusMissing ? (
                        <p className="mt-1 text-xs text-red-600">
                          {descriptionMissing && statusMissing
                            ? "Describe the task and choose a status."
                            : descriptionMissing
                              ? "Describe the task."
                              : "Choose a status."}
                        </p>
                      ) : null}
                    </fieldset>
                  );
                })}

                {tasks.length < MAX_TASKS_PER_REPORT ? (
                  <Button type="button" variant="outline" onClick={() => setTasks((current) => [...current, newTask()])}>
                    + Add another task
                  </Button>
                ) : (
                  <p className="text-center text-xs text-muted-foreground">Maximum of {MAX_TASKS_PER_REPORT} tasks.</p>
                )}
              </>
            )}

            {stepError ? (
              <p role="alert" className="whitespace-pre-line rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {stepError}
              </p>
            ) : null}

            <div className="mt-2 flex flex-col gap-2">
              <Button type="submit" size="xl" disabled={submitting}>
                {locating ? "Checking your location…" : submitting ? "Saving…" : "Submit Report & Clock Out"}
              </Button>
              <Button type="button" variant="outline" size="xl" onClick={resetFlow}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  if (step === "earlyReason") {
    const wordCount = countWords(earlyReason);
    const overLimit = wordCount > MAX_EARLY_CLOCKOUT_REASON_WORDS;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-8 sm:px-6 sm:py-12">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-amber-100 text-3xl text-amber-700">
            !
          </div>
          <h2 className="text-center text-xl font-bold">Clocking out early</h2>
          <p className="mt-2 text-center text-sm text-muted-foreground">
            You&apos;re clocking out before the end of your scheduled work day. Please briefly state why (max{" "}
            {MAX_EARLY_CLOCKOUT_REASON_WORDS} words) — your manager will be able to see this.
          </p>
          <form onSubmit={handleConfirmEarlyClockOut} className="mt-6 flex flex-col gap-2">
            <textarea
              ref={reasonRef}
              value={earlyReason}
              onChange={(e) => setEarlyReason(e.target.value)}
              rows={4}
              placeholder="e.g. Feeling unwell, left with manager's approval"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className={`text-right text-xs ${overLimit ? "text-red-600" : "text-muted-foreground"}`}>
              {wordCount}/{MAX_EARLY_CLOCKOUT_REASON_WORDS} words
            </p>
            {stepError ? (
              <p role="alert" className="whitespace-pre-line rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
                {stepError}
              </p>
            ) : null}
            <div className="mt-2 flex flex-col gap-2">
              <Button
                type="submit"
                size="xl"
                disabled={submitting || wordCount === 0 || overLimit}
              >
                {locating ? "Checking your location…" : submitting ? "Please wait…" : "Confirm Clock Out Early"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="xl"
                onClick={() => {
                  setStepError(null);
                  setStep("tasks");
                }}
              >
                Back to Report
              </Button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-8 sm:px-6 sm:py-12">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-10">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt={companyName} className="mx-auto mb-4 h-16 w-16 object-contain sm:h-20 sm:w-20" />
        ) : null}
        <h1 className="text-xl font-bold sm:text-2xl">{companyName}</h1>
        <p className="mt-1 text-sm font-medium tracking-wide text-muted-foreground">OFFICE ATTENDANCE</p>
        {hasQrSession ? (
          <p className="mt-3 rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">
            QR verified — enter your Attendance ID to continue.
            {checkLocation ? " Your phone will ask for your location to confirm you're at the office." : null}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-4">
          <Input
            ref={inputRef}
            autoFocus
            inputMode="text"
            autoComplete="off"
            placeholder="Enter your Attendance ID"
            value={attendanceId}
            onChange={(e) => {
              setAttendanceId(e.target.value);
              setStepError(null);
            }}
            className="h-14 text-center text-base tracking-wide uppercase sm:h-16 sm:text-xl sm:tracking-widest"
            maxLength={40}
          />
          {stepError ? (
            <p role="alert" className="whitespace-pre-line rounded-md bg-red-50 px-3 py-2 text-left text-sm text-red-700">
              {stepError}
            </p>
          ) : null}
          <Button type="submit" size="xl" disabled={submitting || !attendanceId.trim()}>
            {locating ? "Checking your location…" : submitting ? "Please wait…" : "CLOCK IN / OUT"}
          </Button>
        </form>
        <p className="mt-3 text-xs text-muted-foreground">
          Clocking out? You&apos;ll be asked what you worked on today, and for a quick reason if you&apos;re leaving
          early.
        </p>
      </div>
    </div>
  );
}

function ResultScreen({ result }: { result: ClockResult }) {
  if (!result.ok) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-8 text-center sm:px-6 sm:py-12">
        <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 text-3xl text-red-600">
            ✕
          </div>
          <h2 className="text-xl font-bold text-red-600">ATTENDANCE DENIED</h2>
          <p className="mt-3 whitespace-pre-line text-muted-foreground">{result.message}</p>
        </div>
      </div>
    );
  }

  const greeting = result.action === "CLOCK_IN" ? "Good day" : "Goodbye";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-muted px-4 py-8 text-center sm:px-6 sm:py-12">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-sm sm:p-10">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-3xl text-green-600">
          ✓
        </div>
        <h2 className="text-xl font-bold text-green-700">SUCCESS</h2>
        <p className="mt-2 text-lg">
          {greeting}, {result.firstName}.
        </p>

        {result.action === "CLOCK_IN" ? (
          <div className="mt-4 space-y-1">
            <p className="text-sm text-muted-foreground">Clock-in</p>
            <p className="text-2xl font-semibold">{result.time}</p>
            {result.status ? (
              <p className="mt-1 text-sm font-medium uppercase tracking-wide text-primary">
                Status: {result.status.replace("_", " ")}
              </p>
            ) : null}
            {result.alreadyClockedIn ? (
              <p className="mt-2 text-sm text-muted-foreground">
                You were already clocked in — nothing more to do. Come back here at the end of the day to clock out.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-1">
            <p className="text-sm text-muted-foreground">Clock-out</p>
            <p className="text-2xl font-semibold">{result.time}</p>
            {typeof result.totalMinutesWorked === "number" ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Hours worked: {(result.totalMinutesWorked / 60).toFixed(1)}h
              </p>
            ) : null}
            {typeof result.tasksReported === "number" ? (
              <p className="mt-1 text-sm text-muted-foreground">
                {result.tasksReported === 0
                  ? "Daily report saved — no tasks today"
                  : `Daily report saved — ${result.tasksReported} task${result.tasksReported === 1 ? "" : "s"}`}
              </p>
            ) : null}
            {result.clockOutStatus === "EARLY" ? (
              <p className="mt-1 text-sm font-medium uppercase tracking-wide text-amber-700">
                Clocked out early — reason recorded
              </p>
            ) : null}
          </div>
        )}

        <p className="mt-6 text-xs text-muted-foreground">Return to attendance screen…</p>
      </div>
    </div>
  );
}
