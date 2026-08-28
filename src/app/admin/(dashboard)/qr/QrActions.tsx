"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { generateQrAction, deactivateQrAction } from "@/lib/actions/qr";
import { toast, toastError } from "@/hooks/use-toast";
import type { Office } from "@prisma/client";

export function GenerateQrForm({ offices, todayStr }: { offices: Office[]; todayStr: string }) {
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        const result = await generateQrAction(formData);
        if (result.artifactsFailed) {
          toast({
            title: "QR code generated, but PDF/PNG couldn't be created",
            description:
              "The QR is still valid for clock-in. Ask whoever manages the server to check the storage configuration.",
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
        <select name="duration" defaultValue="DAY" className="h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="DAY">1 day</option>
          <option value="WEEK">1 week</option>
          <option value="MONTH">1 month</option>
        </select>
      </div>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? "Generating…" : "Generate / Regenerate"}
      </Button>
    </form>
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
