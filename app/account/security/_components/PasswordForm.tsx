"use client";

import { useState } from "react";
import { updatePasswordSchema } from "@/lib/account/schemas";
import { Card } from "@/components/account/Card";
import { Field, TextInput, Button } from "@/components/account/fields";
import { changePassword } from "../../_components/api";

interface FormState {
  current: string;
  next: string;
  confirm: string;
}

const EMPTY: FormState = { current: "", next: "", confirm: "" };

// Change-password form. Validates against the shared zod schema client-side
// (length, match, difference) before calling the API, then clears the fields on
// success so the plaintext passwords don't linger in component state.
export function PasswordForm() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const patch = (next: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...next }));
    setDone(false);
    setError(null);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);

    const payload = {
      current_password: form.current,
      new_password: form.next,
      confirm_password: form.confirm,
    };
    const parsed = updatePasswordSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    setSaving(true);
    const res = await changePassword(parsed.data);
    setSaving(false);
    if (res.error || !res.data?.changed) {
      setError(res.error ?? "Couldn't change your password.");
      return;
    }
    setForm(EMPTY);
    setDone(true);
  };

  return (
    <Card
      title="Password"
      description="Use at least 8 characters. You'll need your current password to make a change."
      footer={
        <div className="flex items-center gap-3">
          <Button type="submit" form="password-form" disabled={saving}>
            {saving ? "Updating…" : "Update password"}
          </Button>
          {done ? (
            <span className="text-xs font-medium text-green-600">
              Password updated.
            </span>
          ) : null}
          {error ? (
            <span className="text-xs font-medium text-red-600">{error}</span>
          ) : null}
        </div>
      }
    >
      <form id="password-form" onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
        <Field label="Current password" htmlFor="current_password">
          <TextInput
            id="current_password"
            type="password"
            autoComplete="current-password"
            value={form.current}
            disabled={saving}
            onChange={(e) => patch({ current: e.target.value })}
          />
        </Field>
        <Field
          label="New password"
          htmlFor="new_password"
          hint="At least 8 characters."
        >
          <TextInput
            id="new_password"
            type="password"
            autoComplete="new-password"
            value={form.next}
            disabled={saving}
            onChange={(e) => patch({ next: e.target.value })}
          />
        </Field>
        <Field label="Confirm new password" htmlFor="confirm_password">
          <TextInput
            id="confirm_password"
            type="password"
            autoComplete="new-password"
            value={form.confirm}
            disabled={saving}
            onChange={(e) => patch({ confirm: e.target.value })}
          />
        </Field>
      </form>
    </Card>
  );
}
