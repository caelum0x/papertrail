"use client";

import { useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import type { RankedRecord } from "@/lib/screening/schemas";

// AI active-learning screening panel (ASReview-style). A reviewer clicks "AI-rank
// pending" to have Claude score every pending record by relevance to the review's
// inclusion criteria, then screens the ranked worklist most-relevant-first. Each
// row shows the relevance score, the include/exclude/uncertain verdict, and a
// one-line rationale — plus a trust badge when that rationale was verified against
// the record's own abstract (grounding). Self-contained: it owns its own fetch and
// reads the active org id the same way the rest of the console does, so it can be
// dropped onto the screening detail page without touching the page itself.

const ORG_STORAGE_KEY = "pt_active_org";

function orgHeaders(): Record<string, string> {
  if (typeof window === "undefined") return {};
  const orgId = window.localStorage.getItem(ORG_STORAGE_KEY);
  return orgId ? { "x-org-id": orgId } : {};
}

interface AiRankResponseData {
  ranked: RankedRecord[];
  rankedCount: number;
  unrankedCount: number;
}

interface AiRankPanelProps {
  projectId: string;
  /** Optional: cap how many pending records to rank in one pass (token budget). */
  limit?: number;
}

const VERDICT_STYLE: Record<RankedRecord["verdict"], string> = {
  include: "bg-emerald-50 text-emerald-700 border-emerald-600/30",
  exclude: "bg-red-50 text-red-700 border-red-600/30",
  uncertain: "bg-amber-50 text-amber-700 border-amber-600/30",
};

function relevancePct(relevance: number): string {
  return `${Math.round(relevance * 100)}%`;
}

export function AiRankPanel({ projectId, limit }: AiRankPanelProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AiRankResponseData | null>(null);

  async function runRanking() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/screening/ai-rank", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...orgHeaders() },
        body: JSON.stringify(limit ? { projectId, limit } : { projectId }),
      });
      const body: ApiResponse<AiRankResponseData> = await res.json();
      if (!res.ok || !body.success || !body.data) {
        setError(body.error ?? "AI ranking failed. Please try again.");
        return;
      }
      setResult(body.data);
    } catch {
      setError("Network error while ranking. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-sm font-medium text-ink/80">AI relevance ranking</h3>
          <p className="mt-0.5 text-xs text-ink/50">
            Claude scores each pending record against the inclusion criteria so you
            screen the most-likely-relevant first.
          </p>
        </div>
        <button
          onClick={runRanking}
          disabled={loading}
          className="shrink-0 rounded-md bg-accent px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {loading ? "Ranking…" : "AI-rank pending"}
        </button>
      </div>

      {error ? (
        <p className="mt-3 rounded-md border border-red-600/30 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-ink/40">
            {result.rankedCount} ranked
            {result.unrankedCount > 0
              ? ` · ${result.unrankedCount} could not be ranked`
              : ""}
          </p>

          {result.ranked.length === 0 ? (
            <p className="mt-2 text-sm text-ink/50">
              No pending records to rank.
            </p>
          ) : (
            <ol className="mt-2 space-y-2">
              {result.ranked.map((r) => (
                <li
                  key={r.id}
                  className="rounded-md border border-ink/10 bg-white px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 flex-1 text-sm font-medium text-ink/80">
                      {r.title}
                    </p>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-ink/70">
                      {relevancePct(r.relevance)}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded-full border px-2 py-0.5 text-xs font-medium ${VERDICT_STYLE[r.verdict]}`}
                    >
                      {r.verdict}
                    </span>
                    {r.groundingOk ? (
                      <span
                        className="rounded-full border border-ink/15 px-2 py-0.5 text-xs text-ink/50"
                        title="This rationale was verified against the record's abstract."
                      >
                        grounded
                      </span>
                    ) : (
                      <span
                        className="rounded-full border border-amber-600/30 bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
                        title="This rationale could not be verified against the abstract — read the record before trusting it."
                      >
                        unverified
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink/60">{r.rationale}</p>
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}
    </div>
  );
}
