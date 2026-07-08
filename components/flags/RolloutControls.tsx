"use client";

import { useState } from "react";
import type { FeatureFlag } from "@/lib/flags/types";
import { updateFlag } from "@/components/flags/api";
import { Toggle } from "@/components/flags/ui";

// Enabled toggle + percentage rollout slider. Saves via PATCH and reports the
// updated flag to the parent so sibling panels stay in sync.
export function RolloutControls({
  flag,
  onUpdated,
}: {
  flag: FeatureFlag;
  onUpdated: (next: FeatureFlag) => void;
}) {
  const [enabled, setEnabled] = useState(flag.enabled);
  const [percent, setPercent] = useState(flag.rolloutPercent);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = enabled !== flag.enabled || percent !== flag.rolloutPercent;

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    const res = await updateFlag(flag.id, {
      enabled,
      rolloutPercent: percent,
    });
    setSaving(false);
    if (!res.success || !res.data) {
      setError(res.error ?? "Failed to save.");
      return;
    }
    setSaved(true);
    onUpdated(res.data);
  }

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 className="text-sm font-semibold text-ink">Rollout</h2>
      <p className="mt-1 text-xs text-ink/50">
        Controls whether the flag is on and, if enabled, what share of subjects
        fall into the rollout. Evaluation is deterministic per subject.
      </p>

      <div className="mt-4 flex items-center gap-3">
        <Toggle
          checked={enabled}
          onChange={(v) => {
            setEnabled(v);
            setSaved(false);
          }}
          label="Flag enabled"
        />
        <span className="text-sm text-ink/70">
          {enabled ? "Flag is enabled" : "Flag is disabled"}
        </span>
      </div>

      <div className="mt-5">
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs font-medium text-ink/60">
            Rollout percentage
          </label>
          <span className="tabular-nums text-sm font-medium text-ink">
            {percent}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          value={percent}
          disabled={!enabled}
          onChange={(e) => {
            setPercent(Number(e.target.value));
            setSaved(false);
          }}
          className="w-full accent-accent disabled:opacity-40"
        />
        <p className="mt-1 text-[11px] text-ink/40">
          {enabled
            ? `Roughly ${percent}% of subjects will resolve to enabled (targeting rules override this).`
            : "Enable the flag to configure its rollout."}
        </p>
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40"
        >
          {saving ? "Saving…" : "Save rollout"}
        </button>
        {saved && !dirty && (
          <span className="text-xs text-emerald-600">Saved.</span>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </section>
  );
}
