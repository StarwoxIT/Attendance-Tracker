"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { setAdminActiveAction, deleteAdminAction } from "@/lib/actions/admins";
import { toast, toastError } from "@/hooks/use-toast";
import type { User } from "@prisma/client";

export function AdminActiveToggle({ admin }: { admin: User }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await setAdminActiveAction(admin.id, !admin.isActive);
            toast({ title: admin.isActive ? "Administrator disabled" : "Administrator enabled", variant: "success" });
          } catch (err) {
            toastError(err, "Couldn't update administrator");
          }
        })
      }
    >
      {admin.isActive ? "Disable" : "Enable"}
    </Button>
  );
}

export function DeleteAdminButton({ admin }: { admin: User }) {
  const [pending, startTransition] = useTransition();

  function submit() {
    if (!window.confirm(`Permanently delete ${admin.fullName}'s administrator account? This cannot be undone.`)) return;
    startTransition(async () => {
      try {
        await deleteAdminAction(admin.id);
        toast({ title: "Administrator deleted", variant: "success" });
      } catch (err) {
        toastError(err, "Couldn't delete administrator");
      }
    });
  }

  return (
    <Button size="sm" variant="outline" disabled={pending} onClick={submit} className="text-red-600 hover:bg-red-50">
      Delete
    </Button>
  );
}

export function AdminRow({ admin, isSelf }: { admin: User; isSelf: boolean }) {
  return (
    <tr className="border-b last:border-0">
      <td className="px-4 py-2">{admin.fullName}</td>
      <td className="px-4 py-2">{admin.email}</td>
      <td className="px-4 py-2">{admin.role.replace("_", " ")}</td>
      <td className="px-4 py-2">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${admin.isActive ? "bg-green-100 text-green-700" : "bg-gray-200 text-gray-700"}`}>
          {admin.isActive ? "Active" : "Disabled"}
        </span>
      </td>
      <td className="px-4 py-2">{admin.lastLoginAt ? new Date(admin.lastLoginAt).toLocaleString() : "Never"}</td>
      <td className="px-4 py-2 text-right">
        {!isSelf ? (
          <div className="flex justify-end gap-2">
            <AdminActiveToggle admin={admin} />
            {admin.role !== "SUPER_ADMIN" ? <DeleteAdminButton admin={admin} /> : null}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">You</span>
        )}
      </td>
    </tr>
  );
}
