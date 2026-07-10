"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner } from "@/components/console/StateBanners";
import { EvidenceHeader } from "./_components/EvidenceHeader";
import { SentenceView } from "./_components/SentenceView";
import {
  DRAFT_SECTION_TYPES,
  type DraftAssistResult,
  type DraftSectionType,
} from "./_components/types";

// DRAFT ASSISTANT console — "the AI research assistant that proves it." Enter a topic
// or claim; Claude drafts a manuscript/grant section grounded in the engine's VERIFIED
// pooled evidence, and the engine self-corrects: every efficacy sentence is reconciled
// against the pooled number and every supporting quote is grounded to an exact source
// span. Overstated sentences are auto-corrected (amber) and flagged; consistent ones
// are marked grounded (green). Numbers come from the engine, never from Claude.

const EXAMPLES = [
  "Statin therapy reduces major cardiovascular events in older adults.",
  "The drug lowered the risk of the primary composite endpoint versus placebo.",
  "Intensive glucose control cut microvascular complications in type 2 diabetes.",
];

const SECTION_LABELS: Record<DraftSectionType, string> = {
  abstract: "Abstract",
  results: "Results",
  discussion: "Discussion",
  significance: "Significance (grant)",
  background: "Background",
};

export default function DraftPage() {
  const [topic, setTopic] = useState("");
  const [section, setSection] = useState<DraftSectionType>("results");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DraftAssistResult | null>(null);

  const submit = useCallback(
    async (t: string, s: DraftSectionType) => {
      const trimmed = t.trim();
      if (trimmed.length < 10) {
        setError("Enter a topic or claim of at least 10 characters.");
        setResult(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/drafting", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic: trimmed, section: s }),
        });
        const body = (await res.json().catch(() => null)) as ApiResponse<DraftAssistResult> | null;
        if (!body) {
          throw new Error("Unexpected server response.");
        }
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body.error ?? "Drafting failed.");
        }
        setResult(body.data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to draft the section.");
        setResult(null);
      } finally {
        setLoading(false);
      }
    },
    []
  );

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Draft Assistant"
        subtitle="Claude drafts a manuscript or grant section grounded in verified evidence — and the engine self-corrects every efficacy claim."
      />

      <form
        className="space-y-3 rounded-lg border border-ink/15 bg-white p-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(topic, section);
        }}
      >
        <label htmlFor="draft-topic" className="block text-sm font-medium text-ink/70">
          Topic or claim
        </label>
        <textarea
          id="draft-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Enter a claim or topic to draft a section about…"
          rows={3}
          className="w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="draft-section" className="sr-only">
            Section type
          </label>
          <select
            id="draft-section"
            value={section}
            onChange={(e) => setSection(e.target.value as DraftSectionType)}
            className="rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink/70 focus:border-accent focus:outline-none"
          >
            {DRAFT_SECTION_TYPES.map((s) => (
              <option key={s} value={s}>
                {SECTION_LABELS[s]}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Drafting…" : "Draft & verify"}
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => {
                setTopic(ex);
                void submit(ex, section);
              }}
              className="rounded-full border border-ink/15 px-3 py-1 text-xs text-ink/50 hover:border-accent/40 hover:text-accent"
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      {error ? <ErrorBanner message={error} /> : null}

      {result ? (
        <div className="space-y-4">
          <EvidenceHeader
            evidence={result.evidence}
            summary={result.summary}
            section={result.section}
          />

          <div className="space-y-4 rounded-lg border border-ink/15 bg-white p-5">
            {result.sentences.map((s, i) => (
              <SentenceView key={i} sentence={s} index={i} />
            ))}
          </div>

          {result.sources.length > 0 ? (
            <div className="rounded-lg border border-ink/15 bg-white p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink/40">
                Cited sources ({result.sources.length})
              </div>
              <ul className="mt-2 space-y-1.5">
                {result.sources.map((src) => (
                  <li key={src.id} className="text-sm text-ink/70">
                    <span className="mr-2 rounded bg-ink/5 px-1.5 py-0.5 text-[11px] uppercase text-ink/40">
                      {src.source_type}
                    </span>
                    {src.title ?? src.id}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
