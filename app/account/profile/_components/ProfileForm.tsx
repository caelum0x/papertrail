"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountProfile } from "@/lib/account/types";
import { updateProfileSchema } from "@/lib/account/schemas";
import { Card } from "@/components/account/Card";
import { Field, TextInput, Button } from "@/components/account/fields";
import { LoadingRows, ErrorState } from "@/components/account/states";
import { fetchProfile, saveProfile } from "../../_components/api";
import { AvatarPanel } from "./AvatarPanel";

// Editable form state. All strings; empty string is normalized to null on submit
// (clearing a field) so the API can distinguish "unset" from "unchanged".
interface FormState {
  name: string;
  displayName: string;
  title: string;
  avatarUrl: string;
}

function toForm(p: AccountProfile): FormState {
  return {
    name: p.name ?? "",
    displayName: p.displayName ?? "",
    title: p.title ?? "",
    avatarUrl: p.avatarUrl ?? "",
  };
}

function emptyToNull(v: string): string | null {
  const t = v.trim();
  return t === "" ? null : t;
}

// Profile editor (ProfileForm + AvatarPanel). Loads the current profile, tracks a
// local editable copy, validates client-side against the shared zod schema before
// PATCHing, and surfaces field-level + form-level errors and a saved confirmation.
export function ProfileForm() {
  const [form, setForm] = useState<FormState | null>(null);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await fetchProfile();
    if (res.error || !res.data) {
      setLoadError(res.error ?? "Couldn't load your profile.");
    } else {
      setForm(toForm(res.data));
      setEmail(res.data.email);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (next: Partial<FormState>) => {
    setForm((prev) => (prev ? { ...prev, ...next } : prev));
    setSaved(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setFormError(null);
    setSaved(false);

    const payload = {
      name: emptyToNull(form.name),
      display_name: emptyToNull(form.displayName),
      title: emptyToNull(form.title),
      avatar_url: emptyToNull(form.avatarUrl),
    };
    const parsed = updateProfileSchema.safeParse(payload);
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? "Please check the form.");
      return;
    }

    setSaving(true);
    const res = await saveProfile(parsed.data);
    setSaving(false);
    if (res.error || !res.data) {
      setFormError(res.error ?? "Couldn't save your profile.");
      return;
    }
    setForm(toForm(res.data));
    setSaved(true);
  };

  if (loading) return <LoadingRows rows={4} />;
  if (loadError || !form) {
    return <ErrorState message={loadError ?? "Couldn't load your profile."} onRetry={load} />;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Card
        title="Profile"
        description="Your identity within this organization. Name is shared across the app; display name and title are per-organization."
        footer={
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            {saved ? (
              <span className="text-xs font-medium text-green-600">Saved.</span>
            ) : null}
            {formError ? (
              <span className="text-xs font-medium text-red-600">{formError}</span>
            ) : null}
          </div>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Full name" htmlFor="name" hint="Shown across the workspace.">
            <TextInput
              id="name"
              value={form.name}
              maxLength={120}
              disabled={saving}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </Field>
          <Field
            label="Display name"
            htmlFor="display_name"
            hint="Optional short name for this org."
          >
            <TextInput
              id="display_name"
              value={form.displayName}
              maxLength={120}
              disabled={saving}
              onChange={(e) => patch({ displayName: e.target.value })}
            />
          </Field>
          <Field label="Title" htmlFor="title" hint="e.g. Principal Investigator.">
            <TextInput
              id="title"
              value={form.title}
              maxLength={120}
              disabled={saving}
              onChange={(e) => patch({ title: e.target.value })}
            />
          </Field>
        </div>
      </Card>

      <AvatarPanel
        name={emptyToNull(form.name)}
        email={email}
        avatarUrl={form.avatarUrl}
        disabled={saving}
        onAvatarChange={(v) => patch({ avatarUrl: v })}
      />
    </form>
  );
}
