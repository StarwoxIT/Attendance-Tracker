"use client";

import { useActionState } from "react";
import { createFirstAdminAction, type SetupState } from "@/lib/actions/auth";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Button } from "@/components/ui/button";

const initialState: SetupState = {};

export function SetupForm() {
  const [state, formAction, pending] = useActionState(createFirstAdminAction, initialState);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div>
        <label htmlFor="fullName" className="mb-1 block text-sm font-medium">
          Full name
        </label>
        <Input id="fullName" name="fullName" required autoComplete="name" />
      </div>
      <div>
        <label htmlFor="email" className="mb-1 block text-sm font-medium">
          Email
        </label>
        <Input id="email" name="email" type="email" required autoComplete="username" />
      </div>
      <div>
        <label htmlFor="password" className="mb-1 block text-sm font-medium">
          Password
        </label>
        <PasswordInput id="password" name="password" required minLength={10} autoComplete="new-password" />
        <p className="mt-1 text-xs text-muted-foreground">At least 10 characters.</p>
      </div>
      <div>
        <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium">
          Confirm password
        </label>
        <PasswordInput id="confirmPassword" name="confirmPassword" required minLength={10} autoComplete="new-password" />
      </div>
      {state.error ? <p className="text-sm text-red-600">{state.error}</p> : null}
      <Button type="submit" disabled={pending} className="mt-2">
        {pending ? "Creating account…" : "Create Super Admin"}
      </Button>
    </form>
  );
}
