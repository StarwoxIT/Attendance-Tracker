"use client";

import { useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { updateEmployeeAction } from "@/lib/actions/employees";
import { toast, toastError } from "@/hooks/use-toast";
import type { Department, Employee, Office } from "@prisma/client";

export function EditEmployeeForm({
  employee,
  offices,
  departments,
}: {
  employee: Employee;
  offices: Office[];
  departments: Department[];
}) {
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    startTransition(async () => {
      try {
        await updateEmployeeAction(employee.id, formData);
        toast({ title: "Employee updated", variant: "success" });
      } catch (err) {
        toastError(err, "Couldn't save changes");
      }
    });
  }

  return (
    <form action={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Field label="First name" name="firstName" defaultValue={employee.firstName} required />
      <Field label="Last name" name="lastName" defaultValue={employee.lastName} required />
      <Field label="Middle name" name="middleName" defaultValue={employee.middleName ?? ""} />
      <Field label="Email" name="email" defaultValue={employee.email ?? ""} type="email" />
      <Field label="Phone" name="phone" defaultValue={employee.phone ?? ""} />
      <Field label="Job title" name="jobTitle" defaultValue={employee.jobTitle ?? ""} />
      <div>
        <label className="mb-1 block text-sm font-medium">Office</label>
        <select
          name="officeId"
          defaultValue={employee.officeId}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-medium">Department</label>
        <select
          name="departmentId"
          defaultValue={employee.departmentId ?? ""}
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="">None</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <Field
        label="Date employed"
        name="dateEmployed"
        type="date"
        defaultValue={employee.dateEmployed ? employee.dateEmployed.toISOString().slice(0, 10) : ""}
      />
      <Field label="Resumption time (optional)" name="workStart" type="time" defaultValue={employee.workStart ?? ""} />
      <Field label="Closing time (optional)" name="workEnd" type="time" defaultValue={employee.workEnd ?? ""} />
      <p className="col-span-2 -mt-2 text-xs text-muted-foreground">
        Leave resumption/closing time blank to use the general attendance settings for this employee.
      </p>
      <div className="col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  type = "text",
  defaultValue,
  required,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string;
  required?: boolean;
}) {
  return (
    <div>
      <label htmlFor={name} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      <Input id={name} name={name} type={type} defaultValue={defaultValue} required={required} />
    </div>
  );
}
