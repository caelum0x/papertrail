"use client";

import { useCallback, useState } from "react";

// Mixture of Agents — the unified verifier with REAL COMPOSITION. One claim + its sources are
// routed to backend engines as agents that pass typed artifacts to each other on a shared
// blackboard: enrichers produce (entities, effect sizes, quality, relevance), verifiers consume
// and vote (MiniCheck labels sources -> MultiVerS aggregates those labels; the extractor's effect
// sizes -> PyMARE pools them; Valsci's contested set -> STORM debates it). A deterministic
// aggregator mixes the votes into one verdict + trust. This page visualizes the whole DAG:
// router -> layered composition -> mix. Public route, no org header. See lib/moa/* .

interface RoutingDecision {
  agentId: string;
  name: string;
  category: string;
  description: string;
  produces: string[];
  consumes: string[];
  baseGate: number;
  boost: number;
  finalGate: number;
  selected: boolean;
}

interface GroundedSpan {
  sourceId: string;
  text: string;
  start: number;
  end: number;
}

interface Contribution {
  agentId: string;
  ran: boolean;
  signal: "supports" | "refutes" | "mixed" | "insufficient" | "neutral";
  confidence: number;
  summary: string;
  detail: Record<string, unknown>;
  groundedSpans: GroundedSpan[];
  usedClaude: boolean;
  produced: Record<string, unknown>;
  error?: string;
}

interface AgentRunTrace {
  agentId: string;
  name: string;
  category: string;
  layer: number;
  finalGate: number;
  contribution: Contribution;
}

interface MoaResult {
  claim: string;
  sourceCount: number;
  routing: RoutingDecision[];
  planner: { usedClaude: boolean; rationale: Array<{ expertId: string; emphasis: number; reason: string }> };
  layers: Array<{ index: number; agentIds: string[] }>;
  provenance: Array<{ kind: string; agentId: string }>;
  agents: AgentRunTrace[];
  aggregate: {
    verdict: "supported" | "refuted" | "mixed" | "insufficient";
    trust: number;
    mass: { supports: number; refutes: number; mixed: number };
    agreement: number;
    counts: { voted: number; ran: number; total: number };
    weights: Array<{ agentId: string; signal: string; weight: number }>;
  };
  narrative: string;
  narrativeUsedClaude: boolean;
  citations: GroundedSpan[];
  usedClaude: boolean;
}

const SAMPLE_CLAIM =
  "Empagliflozin reduced the risk of cardiovascular death by 38% in patients with type 2 diabetes.";
const SAMPLE_SOURCE =
  "In the EMPA-REG OUTCOME trial, empagliflozin reduced the risk of cardiovascular death (hazard ratio 0.62, 95% CI 0.49 to 0.77; p<0.001) compared with placebo among 7020 patients with type 2 diabetes and established cardiovascular disease over a median 3.1 years of follow-up.";

const VERDICT_STYLES: Record<string, { label: string; cls: string }> = {
  supported: { label: "Supported", cls: "bg-emerald-50 border-emerald-300 text-emerald-700" },
  refuted: { label: "Refuted", cls: "bg-red-50 border-red-300 text-red-700" },
  mixed: { label: "Mixed / contested", cls: "bg-amber-50 border-amber-300 text-amber-700" },
  insufficient: { label: "Insufficient evidence", cls: "bg-ink/5 border-ink/20 text-ink/60" },
};

const SIGNAL_STYLES: Record<string, string> = {
  supports: "bg-emerald-100 text-emerald-700",
  refutes: "bg-red-100 text-red-700",
  mixed: "bg-amber-100 text-amber-700",
  insufficient: "bg-ink/10 text-ink/50",
  neutral: "bg-sky-100 text-sky-700",
};

const LAYER_TITLES: Record<number, string> = {
  0: "Layer 1 · Enrichers (produce artifacts)",
  1: "Layer 2 · Verifiers (consume + vote)",
  2: "Layer 3 · Deliberation",
  3: "Layer 4 · Deliberation",
};

interface SourceDraft {
  id: string;
  text: string;
}

export default function OrchestratorPage() {
  const [claim, setClaim] = useState(SAMPLE_CLAIM);
  const [sources, setSources] = useState<SourceDraft[]>([{ id: "s1", text: SAMPLE_SOURCE }]);
  const [llm, setLlm] = useState(true);
  const [result, setResult] = useState<MoaResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const updateSource = useCallback((idx: number, text: string) => {
    setSources((prev) => prev.map((s, i) => (i === idx ? { ...s, text } : s)));
  }, []);
  const addSource = useCallback(() => {
    setSources((prev) => [...prev, { id: `s${prev.length + 1}`, text: "" }]);
  }, []);
  const removeSource = useCallback((idx: number) => {
    setSources((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const cleanSources = sources.filter((s) => s.text.trim().length > 0).map((s) => ({ id: s.id, text: s.text }));
      if (cleanSources.length === 0) {
        setError("Add at least one source with text.");
        return;
      }
      const res = await fetch("/api/moa/orchestrate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ claim, sources: cleanSources, options: { llm } }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.success) {
        setError(body?.error ?? "Request failed.");
        return;
      }
      setResult(body.data as MoaResult);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }, [claim, sources, llm]);

  const verdict = result ? VERDICT_STYLES[result.aggregate.verdict] : null;
  const byId = new Map((result?.agents ?? []).map((a) => [a.agentId, a]));
  const notSelected = result?.routing.filter((d) => !d.selected) ?? [];

  return (
    <main className="mx-auto max-w-5xl">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-ink/80">Mixture of Agents</h1>
        <p className="mt-1 text-sm text-ink/50">
          One claim, composed across the backend engines as agents. Enrichers produce typed artifacts
          (entities, effect sizes, quality, relevance); verifiers consume them and vote — MiniCheck
          labels the sources, MultiVerS aggregates those labels, the extractor&apos;s effect sizes feed
          PyMARE, Valsci&apos;s contested set feeds STORM. A deterministic aggregator mixes the votes;
          Claude only plans routing and writes the grounded narrative — never the verdict.
        </p>
      </header>

      <section className="rounded-xl border border-ink/15 bg-white p-5">
        <label className="text-sm font-medium text-ink/70">Claim</label>
        <textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          rows={2}
          className="mt-2 w-full rounded-lg border border-ink/15 p-3 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <div className="mt-4 flex items-center justify-between">
          <label className="text-sm font-medium text-ink/70">Sources</label>
          <button onClick={addSource} className="text-xs text-accent hover:underline">
            + Add source
          </button>
        </div>
        <div className="mt-2 space-y-2">
          {sources.map((s, i) => (
            <div key={i} className="rounded-lg border border-ink/10 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-ink/40">{s.id}</span>
                {sources.length > 1 ? (
                  <button onClick={() => removeSource(i)} className="text-xs text-ink/30 hover:text-accent">
                    remove
                  </button>
                ) : null}
              </div>
              <textarea
                value={s.text}
                onChange={(e) => updateSource(i, e.target.value)}
                rows={3}
                placeholder="Paste the cached source text (abstract / results paragraph)…"
                className="w-full rounded border border-ink/10 p-2 text-sm focus:border-accent focus:outline-none"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-4">
          <button
            onClick={run}
            disabled={loading || claim.trim().length < 3}
            className="rounded-lg bg-accent px-5 py-2 text-sm font-medium text-white disabled:opacity-40"
          >
            {loading ? "Composing agents…" : "Run mixture of agents"}
          </button>
          <label className="flex items-center gap-2 text-xs text-ink/50">
            <input type="checkbox" checked={llm} onChange={(e) => setLlm(e.target.checked)} />
            Use Claude (planner + agent language steps + narrative)
          </label>
        </div>
        {error ? <p className="mt-3 text-sm text-accent">{error}</p> : null}
      </section>

      {result ? (
        <>
          {/* Unified verdict */}
          {verdict ? (
            <section className={`mt-6 rounded-xl border p-5 ${verdict.cls}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">{verdict.label}</h2>
                <span className="text-sm font-medium">Trust {result.aggregate.trust}/100</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-ink/70">{result.narrative}</p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink/50">
                <span>agreement {(result.aggregate.agreement * 100).toFixed(0)}%</span>
                <span>voted {result.aggregate.counts.voted}</span>
                <span>ran {result.aggregate.counts.ran}</span>
                <span>
                  mass ▲{result.aggregate.mass.supports} ▼{result.aggregate.mass.refutes} ~
                  {result.aggregate.mass.mixed}
                </span>
                <span>{result.usedClaude ? "Claude: used" : "Claude: off"}</span>
              </div>
            </section>
          ) : null}

          {/* Composition provenance — who produced what for whom */}
          {result.provenance.length > 0 ? (
            <section className="mt-6 rounded-xl border border-ink/15 bg-white p-5">
              <h2 className="text-base font-semibold text-ink">Artifacts passed between agents</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {result.provenance.map((p) => (
                  <span
                    key={p.kind}
                    className="rounded-md border border-accent/20 bg-accent/5 px-2 py-1 text-xs text-ink/60"
                  >
                    <span className="font-medium text-accent">{p.agentId}</span> → {p.kind}
                  </span>
                ))}
              </div>
            </section>
          ) : null}

          {/* Composition DAG — layers */}
          <section className="mt-6 rounded-xl border border-ink/15 bg-white p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink">Composition ({result.agents.length} agents ran)</h2>
              {result.planner.usedClaude && result.planner.rationale.length > 0 ? (
                <span className="text-xs text-sky-700">
                  planner emphasized {result.planner.rationale.map((r) => r.expertId).join(", ")}
                </span>
              ) : null}
            </div>
            <div className="mt-3 space-y-4">
              {result.layers.map((layer) => (
                <div key={layer.index}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink/35">
                    {LAYER_TITLES[layer.index] ?? `Layer ${layer.index + 1}`}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {layer.agentIds.map((id) => {
                      const a = byId.get(id);
                      if (!a) return null;
                      const c = a.contribution;
                      return (
                        <div key={id} className="rounded-lg border border-ink/10 p-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-sm font-medium text-ink/80">{a.name}</span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                                SIGNAL_STYLES[c.signal] ?? "bg-ink/10 text-ink/50"
                              }`}
                            >
                              {c.signal}
                            </span>
                          </div>
                          {c.summary ? (
                            <p className="mt-1 text-xs leading-snug text-ink/55">{c.summary}</p>
                          ) : null}
                          <div className="mt-1.5 flex flex-wrap items-center gap-1 text-[10px] text-ink/40">
                            {Object.keys(c.produced ?? {}).map((k) => (
                              <span key={`p-${k}`} className="rounded bg-emerald-50 px-1 py-0.5 text-emerald-600">
                                ↑{k}
                              </span>
                            ))}
                            {(result.routing.find((d) => d.agentId === id)?.consumes ?? []).map((k) => (
                              <span key={`c-${k}`} className="rounded bg-sky-50 px-1 py-0.5 text-sky-600">
                                ↓{k}
                              </span>
                            ))}
                            {c.usedClaude ? (
                              <span className="rounded bg-violet-100 px-1 py-0.5 text-violet-700">Claude</span>
                            ) : null}
                            <span className="ml-auto">conf {(c.confidence * 100).toFixed(0)}%</span>
                          </div>
                          {c.groundedSpans.length > 0 ? (
                            <blockquote className="mt-1.5 border-l-2 border-accent/40 pl-2 text-[11px] italic text-ink/50">
                              “{c.groundedSpans[0].text.slice(0, 160)}
                              {c.groundedSpans[0].text.length > 160 ? "…" : ""}”
                            </blockquote>
                          ) : null}
                          {c.error ? <p className="mt-1 text-[11px] text-red-500">error: {c.error}</p> : null}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {notSelected.length > 0 ? (
              <p className="mt-3 text-xs text-ink/35">
                {notSelected.length} agents gated out (input not applicable) — mixture-of-experts sparsity.
              </p>
            ) : null}
          </section>
        </>
      ) : null}
    </main>
  );
}
