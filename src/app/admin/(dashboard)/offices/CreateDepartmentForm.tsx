"use client";

import { useRef, useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createDepartmentAction } from "@/lib/actions/offices";
import { toast, toastError } from "@/hooks/use-toast";

export function CreateDepartmentForm() {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await createDepartmentAction(formData);
        toast({ title: "Department added", variant: "success" });
        formRef.current?.reset();
      } catch (err) {
        toastError(err, "Couldn't add department");
      }
    });
  }

  return (
    <form ref={formRef} action={submit} className="flex flex-wrap items-end gap-2">
      <div className="w-full sm:w-64">
        <label className="mb-1 block text-xs font-medium text-muted-foreground">Name</label>
        <Input name="name" required maxLength={80} className="h-9 w-full" placeholder="Customer Success" />
      </div>
      <Button type="submit" size="sm" disabled={pending} className="w-full sm:w-auto">
        {pending ? "Adding…" : "Add Department"}
      </Button>
    </form>
  );
}
