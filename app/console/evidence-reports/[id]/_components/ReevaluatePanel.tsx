"use client";

import { useCallback, useState } from "react";
import { apiSend } from "../../api";

// LIVING-EVIDENCE re-evaluation control for a saved report. POSTs to the org-scoped
// /api/evidence-reports/[id]/reevaluate route, which re-runs the deterministic
// pipeline for the saved claim against the CURRENT cached sources and returns whether
// the conclusion has drifted. This is honesty over time: a conclusion nobody
// re-checked is a conclusion nobody can trust. Read-only on the server (it does not
// overwrite the stored report); here we render the before/after delta as a badge.
//
// Handles 401/403/404/500 via the shared apiSend envelope (statusMessage maps codes
// to user-facing text). No science is computed on the client — the engine returns the
// verdict/certainty/k diff and we only display it.

interface ReportSummary {
  verdict: string | null;
  certainty: string | null;
  k: number;
}

interface ReevalDelta {
  verdictChanged: boolean;
  certaintyChanged: boolean;
  kDelta: number;
}

interface ReevalResponse {
  id: string;
  changed: boolean;
  previous: ReportSummary;
  current: ReportSummary;
  delta: ReevalDelta;
}

interface ReevaluatePanelProps {
  reportId: string;
}

function verdictLabel(v: string | null): string {
  if (!v) return "insufficient";
  return v.replace(/_/g, " ");
}

function certaintyLabel(c: string | null): string {
  if (!c) return "—";
  return c.replace(/_/g, " ");
}

export function ReevaluatePanel({ reportId }: ReevaluatePanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReevalResponse | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiSend<ReevalResponse>(
      `/api/evidence-reports/${reportId}/reevaluate`,
      "POST"
    );
    if (!res.success || !res.data) {
      setError(res.error ?? "Couldn't re-evaluate this report.");
      setResult(null);
      setLoading(false);
      return;
    }
    setResult(res.data);
    setLoading(false);
  }, [reportId]);

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink/70">Living evidence</h3>
          <p className="mt-1 text-xs leading-relaxed text-ink/50">
            Re-run the deterministic pipeline against everything cached since this report was saved,
            and check whether its verdict or GRADE certainty still holds.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void run()}
          disabled={loading}
          className="rounded-md border border-accent px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/5 disabled:opacity-50"
        >
          {loading ? "Re-evaluating…" : "Re-evaluate"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4 space-y-3">
          <div
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium ${
              result.changed
                ? "border-amber-300 bg-amber-50 text-amber-800"
                : "border-green-300 bg-green-50 text-green-800"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${result.changed ? "bg-amber-500" : "bg-green-500"}`}
              aria-hidden
            />
            {result.changed ? "Conclusion changed" : "Still holds"}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="rounded-md border border-ink/10 bg-white p-3">
              <div className="text-xs uppercase tracking-wide text-ink/40">Verdict</div>
              <div className="mt-1 text-sm text-ink/80">
                {verdictLabel(result.previous.verdict)}
                {result.delta.verdictChanged ? (
                  <>
                    {" "}
                    <span className="text-ink/40">→</span>{" "}
                    <span className="font-medium text-amber-700">
                      {verdictLabel(result.current.verdict)}
                    </span>
                  </>
                ) : (
                  <span className="ml-1 text-xs text-ink/40">(unchanged)</span>
                )}
              </div>
            </div>

            <div className="rounded-md border border-ink/10 bg-white p-3">
              <div className="text-xs uppercase tracking-wide text-ink/40">GRADE certainty</div>
              <div className="mt-1 text-sm text-ink/80">
                {certaintyLabel(result.previous.certainty)}
                {result.delta.certaintyChanged ? (
                  <>
                    {" "}
                    <span className="text-ink/40">→</span>{" "}
                    <span className="font-medium text-amber-700">
                      {certaintyLabel(result.current.certainty)}
                    </span>
                  </>
                ) : (
                  <span className="ml-1 text-xs text-ink/40">(unchanged)</span>
                )}
              </div>
            </div>

            <div className="rounded-md border border-ink/10 bg-white p-3">
              <div className="text-xs uppercase tracking-wide text-ink/40">Pooled studies (k)</div>
              <div className="mt-1 font-mono text-sm text-ink/80">
                {result.previous.k}
                {result.delta.kDelta !== 0 ? (
                  <>
                    {" "}
                    <span className="text-ink/40">→</span>{" "}
                    <span className="font-medium text-amber-700">{result.current.k}</span>{" "}
                    <span className="text-xs text-ink/40">
                      ({result.delta.kDelta > 0 ? "+" : ""}
                      {result.delta.kDelta})
                    </span>
                  </>
                ) : (
                  <span className="ml-1 text-xs text-ink/40">(unchanged)</span>
                )}
              </div>
            </div>
          </div>

          <p className="text-xs leading-relaxed text-ink/40">
            {result.changed
              ? "The saved conclusion no longer matches a fresh run against current sources. The stored report was not modified — review and re-save if appropriate."
              : "A fresh run against current cached sources reproduces the saved conclusion."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
