"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateQrAction, deactivateQrAction } from "@/lib/actions/qr";
import { toast, toastError } from "@/hooks/use-toast";
import type { Office } from "@prisma/client";

export function GenerateQrForm({
  offices,
  todayStr,
  defaultDuration = "DAY",
}: {
  offices: Office[];
  todayStr: string;
  defaultDuration?: "DAY" | "PERMANENT";
}) {
  const [pending, startTransition] = useTransition();
  const [generated, setGenerated] = useState<{ pngDataUrl: string; officeName: string } | null>(null);

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await generateQrAction(formData);
        const officeName = offices.find((o) => o.id === formData.get("officeId"))?.name ?? "office";
        setGenerated({ pngDataUrl: result.pngDataUrl, officeName });
        if (result.artifactsFailed) {
          toast({
            title: "QR code generated, but PDF/PNG couldn't be created",
            description:
              "The QR is still valid for clock-in — use the Download PNG button below to save it now. Ask whoever manages the server to check the storage configuration.",
            variant: "warning",
          });
        } else {
          toast({ title: "QR code generated", variant: "success" });
        }
      } catch (err) {
        toastError(err, "Couldn't generate QR code");
      }
    });
  }

  return (
    <div className="space-y-4">
      <form action={submit} className="flex flex-wrap items-end gap-2">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Office</label>
          <select name="officeId" required className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            {offices.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Start date</label>
          <Input type="date" name="date" defaultValue={todayStr} className="h-9 w-40" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Valid for</label>
          <select name="duration" defaultValue={defaultDuration} className="h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="DAY">1 day</option>
            <option value="WEEK">1 week</option>
            <option value="MONTH">1 month</option>
            <option value="PERMANENT">No expiry (printed poster)</option>
          </select>
        </div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Generating…" : "Generate / Regenerate"}
        </Button>
      </form>
      {generated ? (
        <div className="flex flex-wrap items-center gap-4 rounded-md border p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL, nothing for next/image to optimize */}
          <img src={generated.pngDataUrl} alt={`Attendance QR code for ${generated.officeName}`} className="h-40 w-40 rounded border bg-white p-1" />
          <div className="space-y-2 text-sm">
            <p className="font-medium">New QR code for {generated.officeName}</p>
            <p className="max-w-md text-muted-foreground">
              Print it and put it up where staff can see it. Any older code for this office has stopped working. For
              security the code can&apos;t be shown again here, so save it now if there&apos;s no PDF/PNG link below.
            </p>
            <a
              href={generated.pngDataUrl}
              download={`attendance-qr-${generated.officeName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.png`}
              className="inline-block text-primary hover:underline"
            >
              Download PNG
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function DeactivateQrButton({ qrId, className }: { qrId: string; className?: string }) {
  const [pending, startTransition] = useTransition();

  function submit() {
    startTransition(async () => {
      try {
        await deactivateQrAction(qrId);
        toast({ title: "QR code deactivated", variant: "success" });
      } catch (err) {
        toastError(err, "Couldn't deactivate QR code");
      }
    });
  }

  return (
    <button type="button" disabled={pending} onClick={submit} className={className ?? "text-sm text-red-600 hover:underline"}>
      Deactivate
    </button>
  );
}
