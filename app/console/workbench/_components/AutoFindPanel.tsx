"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { EvidenceReportView } from "./EvidenceReportView";
import type { EvidenceReportResult } from "./types";

// AUTO-FIND & SYNTHESISE — the product's headline promise in one panel: a reviewer types
// a claim (plus an optional search-steering query), and PaperTrail finds its OWN cached
// primary sources, deterministically extracts each source's effect, and pools them into a
// composite evidence report. POSTs to /api/evidence-pipeline; renders ONLY what the
// deterministic engines produced (via EvidenceReportView) plus the citation trail — which
// sources were used and which were skipped, with the honest skip reason.
//
// No LLM sits in the numeric loop: retrieval/embeddings only ground the claim in cached
// sources; every number comes from the deterministic synthesis engines.

// Mirrors the server's EvidencePipelineResult (lib/evidencePipeline.ts). Kept local so
// the client bundle never pulls server modules; the shapes are validated at the route
// boundary before they reach here.
interface UsedSource {
  id: string;
  title: string | null;
  source_type: string;
}

interface SkippedSource {
  id: string;
  reason: string;
}

interface PipelineResult {
  claim: string;
  usedSources: UsedSource[];
  skipped: SkippedSource[];
  report: EvidenceReportResult;
}

const MIN_CLAIM_LENGTH = 10;

function SourceTypeTag({ type }: { type: string }) {
  return (
    <span className="rounded bg-ink/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink/50">
      {type}
    </span>
  );
}

export function AutoFindPanel() {
  const [claim, setClaim] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);

  const submit = useCallback(async () => {
    const trimmedClaim = claim.trim();
    if (trimmedClaim.length < MIN_CLAIM_LENGTH) {
      setError(`Please provide a claim of at least ${MIN_CLAIM_LENGTH} characters.`);
      setResult(null);
      return;
    }
    const trimmedQuery = query.trim();

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/evidence-pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          claim: trimmedClaim,
          ...(trimmedQuery ? { query: trimmedQuery } : {}),
        }),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<PipelineResult> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Auto-find pipeline failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run the auto-find pipeline.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [claim, query]);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <p className="text-sm text-ink/50">
          Type a claim and PaperTrail will find its own cached primary sources, extract each
          source&apos;s effect, and pool them deterministically. No LLM sits in the numeric loop.
        </p>

        <label className="mt-4 block text-sm font-medium text-ink/70" htmlFor="auto-claim">
          Claim
        </label>
        <textarea
          id="auto-claim"
          rows={2}
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          placeholder="e.g. Drug X cuts major cardiovascular events by 30% across trials."
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <label className="mt-4 block text-xs font-medium uppercase tracking-wide text-ink/40" htmlFor="auto-query">
          Search query (optional)
        </label>
        <input
          id="auto-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Steer retrieval independently of the claim wording"
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <p className="mt-1 text-xs text-ink/40">
          Leave blank to search on the claim text itself.
        </p>

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Finding & synthesizing…" : "Auto-find & synthesize"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <div className="rounded-lg border border-ink/15 bg-white p-8 text-center text-sm text-ink/40">
          Retrieving cached primary sources and running the deterministic stack…
        </div>
      ) : result ? (
        <div className="space-y-6">
          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <h3 className="mb-3 text-sm font-semibold text-ink/70">
              Sources used ({result.usedSources.length})
            </h3>
            {result.usedSources.length > 0 ? (
              <ul className="space-y-2">
                {result.usedSources.map((s) => (
                  <li key={s.id} className="flex items-start gap-2 text-sm text-ink/70">
                    <SourceTypeTag type={s.source_type} />
                    <span className="min-w-0 flex-1 break-words">
                      {s.title ?? s.id}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-ink/40">
                No confident matching primary source was retrieved for this claim.
              </p>
            )}
          </div>

          {result.skipped.length > 0 ? (
            <div className="rounded-lg border border-ink/15 bg-white p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink/70">
                Sources skipped ({result.skipped.length})
              </h3>
              <ul className="space-y-2">
                {result.skipped.map((s) => (
                  <li key={s.id} className="text-sm text-ink/60">
                    <span className="font-mono text-xs text-ink/40">{s.id}</span>
                    {" — "}
                    {s.reason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <EvidenceReportView report={result.report} />
        </div>
      ) : null}
    </div>
  );
}
