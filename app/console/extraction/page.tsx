"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import { PicoCard } from "./_components/PicoCard";
import { EffectsTable } from "./_components/EffectsTable";
import type { PaperExtractResult } from "./_components/types";

// Structured paper extraction console (RobotReviewer / LlamaExtract-style). Paste
// a paper's text (or pin a cached source_id); Claude READS the full text and
// extracts PICO + endpoints + every reported effect size. The deterministic trust
// layer grounds each effect's quote to an exact source span and reconciles its
// number — so every row you see is backed by a real, quotable span.

const SAMPLE_TEXT = `In a randomized, double-blind, placebo-controlled trial, 4,744 adults aged 50 years or older with established atherosclerotic cardiovascular disease were assigned to receive the study drug 10 mg once daily or matching placebo, in addition to standard care. The primary endpoint was a composite of cardiovascular death, nonfatal myocardial infarction, or nonfatal stroke at a median follow-up of 33 months.

The primary endpoint occurred in 9.4% of the treatment group and 12.5% of the placebo group (hazard ratio 0.74; 95% CI, 0.63 to 0.87; P<0.001), corresponding to a 26% relative risk reduction. Cardiovascular death, a secondary endpoint, occurred less often with treatment (HR 0.80; 95% CI, 0.66 to 0.97). All-cause mortality did not differ significantly between groups (HR 0.92; 95% CI, 0.79 to 1.08). The benefit was not statistically significant in the prespecified subgroup of patients with diabetes.`;

export default function ExtractionPage() {
  const [text, setText] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaperExtractResult | null>(null);

  const submit = useCallback(async (payload: { text?: string; source_id?: string }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/extraction/paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<PaperExtractResult> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Extraction failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract the paper.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const onExtractText = useCallback(() => {
    const trimmed = text.trim();
    if (trimmed.length < 100) {
      setError("Paste at least 100 characters of paper text.");
      setResult(null);
      return;
    }
    submit({ text: trimmed });
  }, [text, submit]);

  const onExtractSource = useCallback(() => {
    const trimmed = sourceId.trim();
    if (trimmed.length === 0) {
      setError("Enter a cached source id.");
      setResult(null);
      return;
    }
    submit({ source_id: trimmed });
  }, [sourceId, submit]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Extract a paper"
        subtitle="Claude reads the full paper and extracts PICO + every reported effect size — each number grounded to an exact source span and reconciled deterministically."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-5">
        <label htmlFor="ex-text" className="text-sm font-medium text-ink/70">
          Paper text
        </label>
        <textarea
          id="ex-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          placeholder="Paste the abstract + results section of a trial or paper…"
          className="mt-2 w-full resize-y rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={onExtractText}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Reading paper…" : "Extract from text"}
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => setText(SAMPLE_TEXT)}
            className="rounded-full border border-ink/15 px-3 py-1 text-xs text-ink/50 hover:border-accent/40 hover:text-accent disabled:opacity-50"
          >
            Load sample paper
          </button>
        </div>

        <div className="mt-5 border-t border-ink/10 pt-4">
          <label htmlFor="ex-source" className="text-sm font-medium text-ink/70">
            …or extract a cached source
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id="ex-source"
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              placeholder="Cached source UUID"
              className="min-w-[22rem] flex-1 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              disabled={loading}
              onClick={onExtractSource}
              className="rounded-md border border-accent/40 px-4 py-2 text-sm font-medium text-accent hover:bg-accent/5 disabled:opacity-50"
            >
              Extract source
            </button>
          </div>
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {loading ? (
        <LoadingBanner message="Reading the full paper with Claude and grounding each reported effect to a source span…" />
      ) : null}

      {result && !loading ? (
        <div className="space-y-4">
          {result.source.title ? (
            <p className="text-sm text-ink/50">
              <span className="font-medium text-ink/70">{result.source.title}</span>
              {result.source.external_id ? ` · ${result.source.external_id}` : ""}
            </p>
          ) : null}
          <div className="grid gap-6 lg:grid-cols-[1fr_1.4fr]">
            <PicoCard pico={result.pico} endpoints={result.endpoints} />
            <EffectsTable
              effects={result.effects}
              droppedCount={result.ungrounded_dropped_count}
              totalExtracted={result.total_effects_extracted}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
