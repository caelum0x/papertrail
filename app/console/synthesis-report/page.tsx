"use client";

import { useCallback, useMemo, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { LoadingBanner } from "@/components/console/StateBanners";
import { FactsPanel } from "./_components/FactsPanel";
import { ReportSection, CitationTrail } from "./_components/ReportSection";
import { synthesisReportToText, downloadText } from "./_components/exportReport";
import type { SynthesisReportView } from "./_components/types";

// Long-form CITED SYNTHESIS console (STORM-style). Enter a topic or claim; PaperTrail
// finds its own primary sources, pools them deterministically, and Claude drafts a
// structured, fully-cited evidence review whose every number comes from the engine and
// whose every factual sentence is grounded to a source span. GRADE badge + Export button.

const EXAMPLE =
  "SGLT2 inhibitors reduce hospitalization for heart failure in patients with type 2 diabetes.";

export default function SynthesisReportPage() {
  const [topic, setTopic] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SynthesisReportView | null>(null);

  const sourceIndex = useMemo(() => {
    const m = new Map<string, number>();
    report?.usedSources.forEach((s, i) => m.set(s.id, i + 1));
    return m;
  }, [report]);

  const submit = useCallback(async () => {
    const trimmed = topic.trim();
    if (trimmed.length < 10) {
      setError("Enter a topic or claim of at least 10 characters.");
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/synthesis-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as
        | ApiResponse<SynthesisReportView>
        | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Report generation failed.");
      }
      setReport(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate the review.");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [topic]);

  const onExport = useCallback(() => {
    if (!report) return;
    downloadText("synthesis-review.txt", synthesisReportToText(report));
  }, [report]);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Evidence review"
        subtitle="Enter a topic or claim — PaperTrail finds the primary trials, pools them deterministically, and drafts a fully-cited, GRADE-rated review. Every number comes from the engine; every claim is grounded to a source."
        action={
          report ? (
            <button
              type="button"
              onClick={onExport}
              className="rounded-md border border-ink/20 px-3 py-1.5 text-sm font-medium text-ink/70 hover:bg-ink/5"
            >
              Export
            </button>
          ) : null
        }
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
          placeholder={`e.g. ${EXAMPLE}`}
          className="mt-1 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="mt-3 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setTopic(EXAMPLE)}
            className="text-sm font-medium text-accent hover:underline"
          >
            Try an example
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={loading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Generating…" : "Generate review"}
          </button>
        </div>
        {error ? (
          <p className="mt-3 text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {loading ? (
        <LoadingBanner message="Finding sources, pooling evidence, and drafting the review…" />
      ) : report ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-ink/15 bg-white p-4">
            <h2 className="text-xl font-semibold text-ink/80">{report.title}</h2>
            <p className="mt-1 text-sm text-ink/40">Topic: {report.topic}</p>
          </div>

          <FactsPanel facts={report.facts} />

          {report.sections.map((section) => (
            <ReportSection
              key={section.id}
              section={section}
              sourceIndex={sourceIndex}
            />
          ))}

          <CitationTrail sources={report.usedSources} sourceIndex={sourceIndex} />

          {report.droppedSentenceCount > 0 ? (
            <p className="text-xs text-ink/40">
              {report.droppedSentenceCount} draft sentence
              {report.droppedSentenceCount === 1 ? " was" : "s were"} dropped because
              their quoted source text could not be located — PaperTrail never keeps an
              unsourced claim about a source.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
