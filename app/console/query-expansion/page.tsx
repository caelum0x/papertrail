"use client";

import { useCallback, useState } from "react";

// Query-expansion + evidence-sufficiency console — over the deterministic
// /api/research/expand-query endpoint (RAG-fusion: decompose into biomedical facets,
// fuse per-facet hybrid retrieval with RRF, then a deterministic sufficiency gate).
// Public route, so no org header is sent.

interface FusedSource {
  id: string;
  source_type: string;
  external_id: string;
  title: string | null;
  url: string | null;
  phase: string | null;
  enrollment_count: number | null;
  rrfScore: number;
  // Object keyed by facet name -> the rank that facet gave this source.
  facetRanks: Record<string, number>;
}

interface Sufficiency {
  sufficient: boolean;
  reasons: string[];
  criteria?: Record<string, unknown>;
}

interface ExpandResult {
  facets: string[];
  sources: FusedSource[];
  sufficiency: Sufficiency;
}

export default function QueryExpansionPage() {
  const [query, setQuery] = useState(
    "Does an SGLT2 inhibitor reduce heart-failure hospitalization in reduced ejection fraction?"
  );
  const [result, setResult] = useState<ExpandResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/research/expand-query", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? "Request failed.");
        return;
      }
      setResult(body.data as ExpandResult);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }, [query]);

  return (
    <main className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-ink/80">Query expansion &amp; sufficiency</h1>
        <p className="mt-1 text-sm text-ink/50">
          RAG-fusion decomposes a claim into efficacy / safety / mechanism / subgroup facets, fuses
          per-facet retrieval with reciprocal-rank fusion, and applies a deterministic
          evidence-sufficiency gate — no LLM in the ranking or the gate.
        </p>
      </header>

      <section className="rounded-xl border border-ink/15 bg-white p-5">
        <label className="text-sm font-medium text-ink/70">Research question / claim</label>
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={3}
          className="mt-2 w-full rounded-lg border border-ink/15 p-3 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="mt-3">
          <button
            onClick={run}
            disabled={loading || query.trim().length < 10}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {loading ? "Expanding…" : "Expand & assess"}
          </button>
        </div>
        {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
      </section>

      {result ? (
        <>
          <section className="mt-6 rounded-xl border border-ink/15 bg-white p-5">
            <h2 className="text-base font-semibold text-ink">Facets</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {result.facets.map((f, i) => (
                <span key={i} className="rounded-md bg-ink/5 px-2.5 py-1 text-xs text-ink/70">
                  {f}
                </span>
              ))}
            </div>
          </section>

          <section
            className={`mt-6 rounded-xl border p-5 ${
              result.sufficiency.sufficient
                ? "border-accent/30 bg-accent/5"
                : "border-ink/15 bg-white"
            }`}
          >
            <h2 className="text-base font-semibold text-ink">
              Evidence sufficiency:{" "}
              <span className={result.sufficiency.sufficient ? "text-accent" : "text-ink/60"}>
                {result.sufficiency.sufficient ? "sufficient to conclude" : "insufficient"}
              </span>
            </h2>
            {result.sufficiency.reasons.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-sm text-ink/60">
                {result.sufficiency.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="mt-6 rounded-xl border border-ink/15 bg-white p-5">
            <h2 className="text-base font-semibold text-ink">
              Fused sources ({result.sources.length})
            </h2>
            {result.sources.length === 0 ? (
              <p className="mt-2 text-sm text-ink/50">
                No cached sources matched. Ingest sources for this topic (Source Ingest) and retry.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {result.sources.map((s) => (
                  <div key={s.id} className="rounded-lg border border-ink/10 p-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="text-sm font-medium text-ink/80">
                        {s.title ?? s.external_id}
                      </span>
                      <span className="shrink-0 text-xs text-ink/40">
                        RRF {s.rrfScore.toFixed(4)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-xs text-ink/50">
                      <span className="rounded bg-ink/5 px-1.5 py-0.5">{s.source_type}</span>
                      {s.phase ? <span className="rounded bg-ink/5 px-1.5 py-0.5">{s.phase}</span> : null}
                      {Object.entries(s.facetRanks).map(([facet, rank]) => (
                        <span key={facet} className="rounded bg-accent/10 px-1.5 py-0.5 text-accent">
                          {facet}#{rank}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
