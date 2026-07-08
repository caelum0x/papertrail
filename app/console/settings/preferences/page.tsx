"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getJson, sendJson } from "@/components/org-team/apiClient";

// Personal UI preferences editor (theme, density, default landing view, digest).
// Preferences are stored per (org, user); the API validates the typed subset.

type Theme = "system" | "light" | "dark";
type Density = "comfortable" | "compact";
type LandingView = "dashboard" | "claims" | "reports";

interface Preferences {
  theme: Theme;
  density: Density;
  landingView: LandingView;
  emailDigest: boolean;
  onboardingComplete: boolean;
}

const THEME_OPTIONS: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

const DENSITY_OPTIONS: { value: Density; label: string }[] = [
  { value: "comfortable", label: "Comfortable" },
  { value: "compact", label: "Compact" },
];

const LANDING_OPTIONS: { value: LandingView; label: string }[] = [
  { value: "dashboard", label: "Dashboard" },
  { value: "claims", label: "Claims" },
  { value: "reports", label: "Reports" },
];

export default function PreferencesSettingsPage() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [theme, setTheme] = useState<Theme>("system");
  const [density, setDensity] = useState<Density>("comfortable");
  const [landingView, setLandingView] = useState<LandingView>("dashboard");
  const [emailDigest, setEmailDigest] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getJson<Preferences>("/api/preferences");
    setLoading(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to load preferences.");
      return;
    }
    setPrefs(res.data);
    setTheme(res.data.theme);
    setDensity(res.data.density);
    setLandingView(res.data.landingView);
    setEmailDigest(res.data.emailDigest);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onSave = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setSaving(true);
      setSaveError(null);
      setNotice(null);
      const res = await sendJson<Preferences>("/api/preferences", "PATCH", {
        theme,
        density,
        landing_view: landingView,
        email_digest: emailDigest,
      });
      setSaving(false);
      if (!res.success || !res.data) {
        setSaveError(res.error ?? "Failed to save preferences.");
        return;
      }
      setPrefs(res.data);
      setNotice("Preferences saved.");
    },
    [theme, density, landingView, emailDigest]
  );

  return (
    <div className="max-w-2xl">
      <Link
        href="/console/settings"
        className="text-sm text-accent hover:underline"
      >
        &larr; Settings
      </Link>
      <div className="mt-3">
        <h1 className="text-2xl font-semibold text-ink/80">Preferences</h1>
        <p className="mt-1 text-sm text-ink/60">
          Personal display and notification preferences for this organization.
        </p>
      </div>

      {loading ? (
        <p className="mt-6 text-sm text-ink/60">Loading preferences...</p>
      ) : error ? (
        <div className="mt-6 rounded-lg border border-ink/10 bg-white p-5">
          <p className="text-sm text-red-600">{error}</p>
          <button
            onClick={load}
            className="mt-3 text-sm text-accent hover:underline"
          >
            Try again
          </button>
        </div>
      ) : prefs ? (
        <form
          onSubmit={onSave}
          className="mt-6 bg-white border border-ink/10 rounded-lg p-5 space-y-4"
        >
          <div>
            <label className="block text-sm text-ink/60">Theme</label>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="mt-1 text-sm border border-ink/10 rounded px-2 py-2 focus:outline-none focus:border-accent"
            >
              {THEME_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-ink/60">Density</label>
            <select
              value={density}
              onChange={(e) => setDensity(e.target.value as Density)}
              className="mt-1 text-sm border border-ink/10 rounded px-2 py-2 focus:outline-none focus:border-accent"
            >
              {DENSITY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-ink/60">
              Default landing view
            </label>
            <select
              value={landingView}
              onChange={(e) => setLandingView(e.target.value as LandingView)}
              className="mt-1 text-sm border border-ink/10 rounded px-2 py-2 focus:outline-none focus:border-accent"
            >
              {LANDING_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              id="email-digest"
              type="checkbox"
              checked={emailDigest}
              onChange={(e) => setEmailDigest(e.target.checked)}
              className="rounded border-ink/30"
            />
            <label htmlFor="email-digest" className="text-sm text-ink/60">
              Send me a weekly email digest of verification activity
            </label>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <button
              type="submit"
              disabled={saving}
              className="text-sm bg-accent text-white rounded px-4 py-2 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save changes"}
            </button>
            {notice ? (
              <span className="text-sm text-ink/60">{notice}</span>
            ) : null}
          </div>
          {saveError ? (
            <p className="text-sm text-red-600">{saveError}</p>
          ) : null}
        </form>
      ) : null}
    </div>
  );
}
