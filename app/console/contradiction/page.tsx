"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { LoadingBanner } from "@/components/console/StateBanners";
import { SourceVerdictCard } from "./_components/SourceVerdictCard";
import { AttributionTable } from "./_components/AttributionTable";
import {
  DIMENSION_LABELS,
  RESOLUTION_LABELS,
  type ContradictionAtlasResponse,
  type SourceDraft,
} from "./_components/types";

// Quantitative Contradiction Atlas console: enter a claim + two-or-more sources that
// disagree, and the deterministic pipeline scores each side (Valsci), then — when the set
// is "mixed" — attributes the reversal to a study-design dimension (population / dose /
// tissue / follow-up) using grounded design-feature differences. The conflict map shows
// supporting vs refuting sources side by side with the attributed dimension + grounded
// quotes; every number is rule-decided, every quote verbatim.

function emptyDraft(): SourceDraft {
  return { source_type: "pubmed", external_id: "", title: "", url: "", raw_text: "" };
}

const RESOLUTION_TONE: Record<string, string> = {
  attributed_reversal: "bg-accent/10 text-accent",
  unattributed_conflict: "bg-amber-50 text-amber-800",
  no_conflict: "bg-ink/5 text-ink/60",
  insufficient: "bg-ink/5 text-ink/60",
};

export default function ContradictionPage() {
  const [claim, setClaim] = useState("");
  const [drafts, setDrafts] = useState<SourceDraft[]>([emptyDraft(), emptyDraft()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ContradictionAtlasResponse | null>(null);

  const updateDraft = useCallback((index: number, patch: Partial<SourceDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)));
  }, []);

  const addDraft = useCallback(() => {
    setDrafts((prev) => (prev.length >= 24 ? prev : [...prev, emptyDraft()]));
  }, []);

  const removeDraft = useCallback((index: number) => {
    setDrafts((prev) => (prev.length <= 2 ? prev : prev.filter((_, i) => i !== index)));
  }, []);

  const submit = useCallback(async () => {
    if (claim.trim().length < 10) {
      setError("Enter a claim of at least 10 characters.");
      setResult(null);
      return;
    }
    const sources = drafts
      .filter((d) => d.raw_text.trim().length >= 40)
      .map((d, i) => ({
        source_type: d.source_type.trim() || "source",
        external_id: d.external_id.trim() || `src-${i + 1}`,
        raw_text: d.raw_text.trim(),
        title: d.title.trim() || null,
        url: d.url.trim() || null,
      }));

    if (sources.length < 2) {
      setError("Provide at least two sources with 40+ characters of text each.");
      setResult(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/verify/contradiction-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: claim.trim(), sources }),
      });
      const body = (await res.json().catch(() => null)) as
        | ApiResponse<ContradictionAtlasResponse>
        | null;
      if (!body) throw new Error("Unexpected server response.");
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Contradiction resolution failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resolve the contradiction.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, [claim, drafts]);

  const primaryDimension = result?.primary_hypothesis?.dimension ?? null;

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Contradiction Atlas"
        subtitle="When sources disagree, attribute the reversal to a study-design dimension — population, dose, tissue, or follow-up — with grounded quotes and rule-decided strength."
      />

      {/* Claim + source editor */}
      <div className="space-y-4 rounded-lg border border-ink/15 bg-white p-4">
        <div>
          <label className="block text-sm font-medium text-ink/70" htmlFor="claim">
            Claim
          </label>
          <textarea
            id="claim"
            rows={2}
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            placeholder="e.g. Drug X reduces thrombosis risk in JAK2 V617F carriers."
            className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
          />
        </div>

        <div className="space-y-4">
          {drafts.map((draft, index) => (
            <div key={index} className="rounded-md border border-ink/15 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                  Source {index + 1}
                </span>
                {drafts.length > 2 ? (
                  <button
                    type="button"
                    onClick={() => removeDraft(index)}
                    className="text-xs text-ink/40 hover:text-red-700"
                  >
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input
                  value={draft.source_type}
                  onChange={(e) => updateDraft(index, { source_type: e.target.value })}
                  placeholder="source type (e.g. pubmed)"
                  className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                />
                <input
                  value={draft.external_id}
                  onChange={(e) => updateDraft(index, { external_id: e.target.value })}
                  placeholder="external id (e.g. PMID)"
                  className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                />
                <input
                  value={draft.title}
                  onChange={(e) => updateDraft(index, { title: e.target.value })}
                  placeholder="title (optional)"
                  className="rounded-md border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink focus:border-accent focus:outline-none"
                />
              </div>
              <textarea
                rows={4}
                value={draft.raw_text}
                onChange={(e) => updateDraft(index, { raw_text: e.target.value })}
                placeholder="Paste the source abstract / trial record text (40+ characters)…"
                className="mt-2 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
              />
            </div>
          ))}
        </div>

        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={addDraft}
            disabled={drafts.length >= 24}
            className="rounded-md border border-ink/15 px-3 py-1.5 text-sm text-ink/70 hover:border-accent disabled:opacity-50"
          >
            + Add source
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Resolving…" : "Resolve contradiction"}
          </button>
        </div>

        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <LoadingBanner message="Scoring each side and attributing the reversal to a design dimension…" />
      ) : result ? (
        <div className="space-y-6">
          {/* Resolution summary */}
          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-ink/70">Resolution</h3>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  RESOLUTION_TONE[result.resolution_category] ?? "bg-ink/5 text-ink/60"
                }`}
              >
                {RESOLUTION_LABELS[result.resolution_category]}
              </span>
              <span className="rounded-full bg-ink/5 px-2 py-0.5 text-xs font-medium text-ink/60">
                set verdict: {result.claim_verdict}
              </span>
            </div>

            {result.primary_hypothesis ? (
              <div className="mt-3 rounded-md border border-accent/30 bg-accent/5 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-accent">
                  Primary hypothesis · {DIMENSION_LABELS[result.primary_hypothesis.dimension]} ·
                  strength {Math.round(result.primary_hypothesis.strength * 100)}%
                </p>
                <p className="mt-1 text-sm text-ink/70">{result.primary_hypothesis.statement}</p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-ink/60">
                {result.resolution_category === "unattributed_conflict"
                  ? "The sources conflict, but no single design dimension cleanly explains the reversal. Reported honestly rather than forced onto a dimension."
                  : result.resolution_category === "no_conflict"
                    ? "The sources do not straddle both sides — there is no reversal to attribute."
                    : "Too few grounded, directional sources to resolve a contradiction."}
              </p>
            )}

            <p className="mt-3 text-xs text-ink/40">
              {result.supporting_count} supporting · {result.refuting_count} refuting ·{" "}
              {result.considered_count} considered
              {result.below_floor_count > 0 ? ` · ${result.below_floor_count} below relevance floor` : ""}
              {result.grounding_dropped_count > 0
                ? ` · ${result.grounding_dropped_count} ungroundable span${
                    result.grounding_dropped_count === 1 ? "" : "s"
                  } dropped`
                : ""}
              {result.feature_grounding_dropped_count > 0
                ? ` · ${result.feature_grounding_dropped_count} ungroundable feature${
                    result.feature_grounding_dropped_count === 1 ? "" : "s"
                  } dropped`
                : ""}
            </p>
          </div>

          {/* Deterministic attribution table */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink/70">Dimension attribution</h3>
            <AttributionTable attributions={result.attributions} primaryDimension={primaryDimension} />
          </section>

          {/* Conflict map: supporting vs refuting */}
          <section>
            <h3 className="mb-3 text-sm font-semibold text-ink/70">Conflict map</h3>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  Supporting ({result.supporting_count})
                </p>
                {result.supporting.length === 0 ? (
                  <div className="rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
                    No supporting sources.
                  </div>
                ) : (
                  result.supporting.map((v, i) => (
                    <SourceVerdictCard
                      key={`${v.source_type}-${v.external_id}-${i}`}
                      verdict={v}
                      attributedDimension={primaryDimension}
                    />
                  ))
                )}
              </div>
              <div className="space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-red-700">
                  Refuting ({result.refuting_count})
                </p>
                {result.refuting.length === 0 ? (
                  <div className="rounded-lg border border-ink/15 bg-white p-6 text-center text-sm text-ink/40">
                    No refuting sources.
                  </div>
                ) : (
                  result.refuting.map((v, i) => (
                    <SourceVerdictCard
                      key={`${v.source_type}-${v.external_id}-${i}`}
                      verdict={v}
                      attributedDimension={primaryDimension}
                    />
                  ))
                )}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
