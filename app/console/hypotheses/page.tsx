"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { LoadingBanner } from "@/components/console/StateBanners";
import { GapCard } from "./_components/GapCard";
import { HypothesisCard } from "./_components/HypothesisCard";
import type { EvidenceSignal, HypothesesResponse } from "./_components/types";

// Research-gap + hypothesis console: enter a topic/claim, and the deterministic evidence
// pipeline grounds it (retrieve cached primary sources → pool → meta-analysis / GRADE),
// then Claude reasons over ONLY the engine's derived signals to surface where the
// evidence is thin/absent/conflicting and propose testable hypotheses. Every gap card
// shows the concrete engine signal it rests on — nothing is ungrounded speculation.

export default function HypothesesPage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<HypothesesResponse | null>(null);

  const submit = useCallback(async () => {
    if (topic.trim().length < 10) {
      setError("Enter a topic of at least 10 characters.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/hypotheses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: topic.trim() }),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<HypothesesResponse> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Gap analysis failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run gap analysis.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [topic]);

  // Index signals by id so cards can render the exact engine fact behind each gap.
  const signalById = useMemo(() => {
    const map = new Map<string, EvidenceSignal>();
    for (const s of result?.signals ?? []) {
      map.set(s.id, s);
    }
    return map;
  }, [result]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Research gaps & hypotheses"
        subtitle="Ground a topic in the pooled evidence, then surface where it's thin, absent, or conflicting — with testable hypotheses tied to each engine signal."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <label className="block text-sm font-medium text-ink/70" htmlFor="topic">
          Topic or claim
        </label>
        <textarea
          id="topic"
          rows={2}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="e.g. SGLT2 inhibitors reduce heart-failure hospitalisation in type 2 diabetes."
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Analysing…" : "Analyse gaps"}
          </button>
        </div>

        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <LoadingBanner message="Grounding the topic and reasoning over the evidence base…" />
      ) : result ? (
        <div className="space-y-6">
          {/* Overview + grounding status */}
          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-ink/70">Synthesis</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  result.evidenceGrounded
                    ? "bg-emerald-50 text-emerald-800"
                    : "bg-amber-50 text-amber-800"
                }`}
              >
                {result.evidenceGrounded
                  ? "Grounded in pooled evidence"
                  : "No poolable evidence found"}
              </span>
            </div>
            <p className="mt-2 text-sm text-ink/70">{result.synthesis}</p>

            <p className="mt-3 text-xs text-ink/40">
              {result.signals.length} engine{" "}
              {result.signals.length === 1 ? "signal" : "signals"} · {result.usedSources.length}{" "}
              source{result.usedSources.length === 1 ? "" : "s"} used
              {result.droppedUngrounded > 0
                ? ` · ${result.droppedUngrounded} ungrounded item${
                    result.droppedUngrounded === 1 ? "" : "s"
                  } dropped`
                : ""}
            </p>
          </div>

          {/* Research gaps */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink/70">
              Research gaps ({result.gaps.length})
            </h3>
            {result.gaps.length === 0 ? (
              <div className="rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
                No grounded gaps were surfaced for this topic.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {result.gaps.map((gap, i) => (
                  <GapCard key={`${gap.signal_id}-${i}`} gap={gap} signal={signalById.get(gap.signal_id)} />
                ))}
              </div>
            )}
          </section>

          {/* Testable hypotheses */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink/70">
              Testable hypotheses ({result.hypotheses.length})
            </h3>
            {result.hypotheses.length === 0 ? (
              <div className="rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
                No grounded hypotheses were surfaced for this topic.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {result.hypotheses.map((h, i) => (
                  <HypothesisCard
                    key={`${h.signal_id}-${i}`}
                    hypothesis={h}
                    signal={signalById.get(h.signal_id)}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
