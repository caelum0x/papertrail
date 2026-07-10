"use client";

// Prior match runs for the org. Each row shows the non-identifying summary label, when it
// ran, and its match count; clicking loads that run's persisted profile + matches back into
// the page. Presentational — the parent owns loading/selection.

import type { TrialMatchRunRow } from "./types";

interface RunHistoryProps {
  runs: TrialMatchRunRow[];
  loading: boolean;
  error: string | null;
  activeRunId: string | null;
  onSelect: (id: string) => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

export function RunHistory({ runs, loading, error, activeRunId, onSelect }: RunHistoryProps) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h3 className="text-sm font-semibold text-ink/70">Run history</h3>

      {loading ? (
        <p className="mt-3 text-sm text-ink/40">Loading history…</p>
      ) : error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : runs.length === 0 ? (
        <p className="mt-3 text-sm text-ink/40">No prior runs yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-ink/10">
          {runs.map((run) => {
            const active = run.id === activeRunId;
            return (
              <li key={run.id}>
                <button
                  type="button"
                  onClick={() => onSelect(run.id)}
                  className={`flex w-full items-center justify-between gap-2 py-2 text-left ${
                    active ? "text-accent" : "text-ink/70 hover:text-ink/80"
                  }`}
                >
                  <span className="min-w-0 truncate text-sm font-medium">
                    {run.patient_summary || "Unlabeled run"}
                  </span>
                  <span className="shrink-0 text-xs text-ink/40">
                    {run.match_count} match{run.match_count === 1 ? "" : "es"} ·{" "}
                    {formatDate(run.created_at)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
