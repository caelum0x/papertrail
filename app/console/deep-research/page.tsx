"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner } from "@/components/console/StateBanners";
import { PlanView } from "./_components/PlanView";
import { EvidencePanel } from "./_components/EvidencePanel";
import { ReportView } from "./_components/ReportView";
import type { DeepResearchResponse } from "./_components/types";

// Multi-agent DEEP RESEARCH console (gpt-researcher / open_deep_research-style,
// but grounded). Ask a research question; Claude PLANS 3-6 focused sub-questions,
// the deterministic evidence pipeline gathers verified pooled evidence for each,
// and Claude SYNTHESISES a structured, cited report — every number engine-computed,
// every claim grounded to an exact source span (ungroundable claims are dropped).

const EXAMPLES = [
  "How effective are SGLT2 inhibitors at reducing cardiovascular events in type 2 diabetes?",
  "Does statin therapy reduce major cardiovascular events across trials in older adults?",
  "What is the pooled efficacy of the intervention on the primary endpoint versus placebo?",
];

// Deep research is a long fan-out (plan + N pipelines + synthesis), so the request
// can take a while. Give it a generous client timeout with a clear failure state.
const REQUEST_TIMEOUT_MS = 120_000;

export default function DeepResearchPage() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DeepResearchResponse | null>(null);

  const submit = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 10) {
      setError("Ask a research question of at least 10 characters.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch("/api/deep-research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
        signal: controller.signal,
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<DeepResearchResponse> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Deep research failed.");
      }
      setResult(body.data);
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") {
        setError("Deep research timed out. Try a narrower question.");
      } else {
        setError(err instanceof Error ? err.message : "Failed to run deep research.");
      }
      setResult(null);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Deep research"
        subtitle="Claude plans sub-questions, the evidence engine pools verified effects for each, and Claude synthesises a cited report — every number engine-computed, every claim grounded."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-5">
        <label htmlFor="dr-question" className="text-sm font-medium text-ink/70">
          Research question
        </label>
        <textarea
          id="dr-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(question);
          }}
          rows={3}
          placeholder="e.g. How effective is the drug class at reducing the primary endpoint across trials?"
          className="mt-2 w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => submit(question)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Researching…" : "Run deep research"}
          </button>
          <span className="text-xs text-ink/30">⌘/Ctrl + Enter</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={loading}
              onClick={() => {
                setQuestion(ex);
                submit(ex);
              }}
              className="rounded-full border border-ink/15 px-3 py-1 text-xs text-ink/50 hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {loading ? (
        <div
          role="status"
          aria-live="polite"
          className="space-y-2 rounded-lg border border-ink/15 bg-white p-6 text-sm text-ink/50"
        >
          <p>Planning sub-questions with Claude…</p>
          <p className="text-ink/35">
            Then pooling verified evidence for each and synthesising a cited report. This
            fans out several Claude and pipeline calls, so it can take up to a minute.
          </p>
        </div>
      ) : null}

      {result && !loading ? (
        <div className="space-y-6">
          <PlanView plan={result.plan} supported={result.supported_sub_questions} />
          <EvidencePanel evidence={result.evidence} />
          <ReportView report={result} />
        </div>
      ) : null}
    </div>
  );
}
