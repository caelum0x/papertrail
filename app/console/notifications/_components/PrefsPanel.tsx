"use client";

import { useState } from "react";
import { usePrefs } from "./usePrefs";
import { PrefsList } from "./PrefsList";

// Collapsible "Delivery preferences" card used inline on the notifications feed.
// Wraps the shared usePrefs hook + PrefsList so the main page stays declarative.
export function PrefsPanel() {
  const [showPrefs, setShowPrefs] = useState(false);
  const { prefsError, savingPref, isEnabled, onTogglePref } = usePrefs();

  return (
    <div className="mt-6 bg-white border border-ink/15 rounded-lg overflow-hidden">
      <button
        onClick={() => setShowPrefs((v) => !v)}
        className="w-full px-5 py-3 border-b border-ink/10 text-sm font-medium text-ink/70 flex items-center justify-between"
        aria-expanded={showPrefs}
      >
        <span>Delivery preferences</span>
        <span className="text-xs text-ink/40">{showPrefs ? "Hide" : "Show"}</span>
      </button>
      {showPrefs ? (
        <PrefsList
          prefsError={prefsError}
          savingPref={savingPref}
          isEnabled={isEnabled}
          onTogglePref={onTogglePref}
        />
      ) : null}
    </div>
  );
}
