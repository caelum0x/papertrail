"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, sendJson } from "@/components/notifications/apiClient";

interface Prefs {
  prefs: Record<string, boolean>;
  updatedAt: string | null;
}

interface PrefsState {
  prefs: Record<string, boolean>;
  prefsError: string | null;
  savingPref: string | null;
  isEnabled: (type: string) => boolean;
  onTogglePref: (type: string) => Promise<void>;
}

// Loads and mutates the recipient's per-type delivery preferences against the
// existing /api/notification-prefs endpoint. A type is enabled unless explicitly
// set to false. Shared by the inline panel and the preferences sub-page.
export function usePrefs(): PrefsState {
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [prefsError, setPrefsError] = useState<string | null>(null);
  const [savingPref, setSavingPref] = useState<string | null>(null);

  const loadPrefs = useCallback(async () => {
    const res = await getJson<Prefs>("/api/notification-prefs");
    if (res.success && res.data) {
      setPrefs(res.data.prefs ?? {});
    }
  }, []);

  useEffect(() => {
    loadPrefs();
  }, [loadPrefs]);

  const isEnabled = useCallback(
    (type: string) => prefs[type] !== false,
    [prefs]
  );

  const onTogglePref = useCallback(
    async (type: string) => {
      setSavingPref(type);
      setPrefsError(null);
      const next = { ...prefs, [type]: !isEnabled(type) };
      const res = await sendJson<Prefs>("/api/notification-prefs", "PATCH", {
        prefs: next,
      });
      setSavingPref(null);
      if (!res.success || !res.data) {
        setPrefsError(res.error ?? "Failed to update preferences.");
        return;
      }
      setPrefs(res.data.prefs ?? next);
    },
    [prefs, isEnabled]
  );

  return { prefs, prefsError, savingPref, isEnabled, onTogglePref };
}
