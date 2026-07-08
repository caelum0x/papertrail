"use client";

import { useCallback, useEffect, useState } from "react";
import type { AccountPreferences } from "@/lib/account/types";
import { updatePreferencesSchema } from "@/lib/account/schemas";
import { Card } from "@/components/account/Card";
import { Field, SelectInput, Toggle, Button } from "@/components/account/fields";
import { LoadingRows, ErrorState } from "@/components/account/states";
import { fetchPreferences, savePreferences } from "../../_components/api";

// Preferences editor. Loads the user's typed UI preferences, edits a local copy,
// and PATCHes the whole set on save (the API merges, so unrelated jsonb keys are
// preserved). Validates client-side against the shared zod schema before sending.
export function PrefsForm() {
  const [prefs, setPrefs] = useState<AccountPreferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const res = await fetchPreferences();
    if (res.error || !res.data) {
      setLoadError(res.error ?? "Couldn't load your preferences.");
    } else {
      setPrefs(res.data);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const patch = (next: Partial<AccountPreferences>) => {
    setPrefs((prev) => (prev ? { ...prev, ...next } : prev));
    setSaved(false);
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prefs) return;
    setError(null);
    setSaved(false);

    const payload = {
      theme: prefs.theme,
      density: prefs.density,
      landing_view: prefs.landingView,
      email_digest: prefs.emailDigest,
      reduced_motion: prefs.reducedMotion,
    };
    const parsed = updatePreferencesSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check your selections.");
      return;
    }

    setSaving(true);
    const res = await savePreferences(parsed.data);
    setSaving(false);
    if (res.error || !res.data) {
      setError(res.error ?? "Couldn't save your preferences.");
      return;
    }
    setPrefs(res.data);
    setSaved(true);
  };

  if (loading) return <LoadingRows rows={4} />;
  if (loadError || !prefs) {
    return (
      <ErrorState message={loadError ?? "Couldn't load your preferences."} onRetry={load} />
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <Card
        title="Preferences"
        description="Personal defaults for how the app looks and where it lands."
        footer={
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save preferences"}
            </Button>
            {saved ? (
              <span className="text-xs font-medium text-green-600">Saved.</span>
            ) : null}
            {error ? (
              <span className="text-xs font-medium text-red-600">{error}</span>
            ) : null}
          </div>
        }
      >
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Theme" htmlFor="theme">
              <SelectInput
                id="theme"
                value={prefs.theme}
                disabled={saving}
                onChange={(e) =>
                  patch({ theme: e.target.value as AccountPreferences["theme"] })
                }
              >
                <option value="system">System</option>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </SelectInput>
            </Field>
            <Field label="Density" htmlFor="density">
              <SelectInput
                id="density"
                value={prefs.density}
                disabled={saving}
                onChange={(e) =>
                  patch({ density: e.target.value as AccountPreferences["density"] })
                }
              >
                <option value="comfortable">Comfortable</option>
                <option value="compact">Compact</option>
              </SelectInput>
            </Field>
            <Field label="Landing view" htmlFor="landing_view">
              <SelectInput
                id="landing_view"
                value={prefs.landingView}
                disabled={saving}
                onChange={(e) =>
                  patch({
                    landingView: e.target.value as AccountPreferences["landingView"],
                  })
                }
              >
                <option value="dashboard">Dashboard</option>
                <option value="claims">Claims</option>
                <option value="reports">Reports</option>
              </SelectInput>
            </Field>
          </div>

          <div className="space-y-3 border-t border-ink/10 pt-4">
            <Toggle
              id="email_digest"
              label="Email digest"
              hint="Receive a periodic summary email of workspace activity."
              checked={prefs.emailDigest}
              disabled={saving}
              onChange={(v) => patch({ emailDigest: v })}
            />
            <Toggle
              id="reduced_motion"
              label="Reduce motion"
              hint="Minimize animations and transitions across the app."
              checked={prefs.reducedMotion}
              disabled={saving}
              onChange={(v) => patch({ reducedMotion: v })}
            />
          </div>
        </div>
      </Card>
    </form>
  );
}
