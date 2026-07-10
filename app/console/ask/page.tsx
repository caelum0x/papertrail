"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import { AnswerView } from "./_components/AnswerView";
import { SourcesPanel } from "./_components/SourcesPanel";
import type { PaperQaResponse } from "./_components/types";

// Agentic Paper QA console (PaperQA2-style). Ask a scientific question; Claude
// retrieves the relevant cached papers, READS their full text, and answers WITH
// CITATIONS — every rendered claim grounded to an exact source span. The trust
// layer (lib/grounding.ts) drops any claim it can't ground, so what you see is
// always backed by a real, quotable source span.

const EXAMPLES = [
  "Does statin therapy reduce major cardiovascular events in older adults?",
  "What effect does the drug have on the primary endpoint versus placebo?",
  "Is the treatment benefit consistent across the studied subgroups?",
];

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PaperQaResponse | null>(null);

  const submit = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 10) {
      setError("Ask a question of at least 10 characters.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/paper-qa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<PaperQaResponse> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "Paper QA failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to answer the question.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Ask the papers"
        subtitle="Claude reads the retrieved papers and answers with citations — every claim grounded to an exact source span."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-5">
        <label htmlFor="pq-question" className="text-sm font-medium text-ink/70">
          Scientific question
        </label>
        <textarea
          id="pq-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(question);
          }}
          rows={3}
          placeholder="e.g. Does the treatment reduce the primary endpoint versus placebo?"
          className="mt-2 w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => submit(question)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Reading papers…" : "Ask"}
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
        <LoadingBanner message="Retrieving cached papers and reading their full text with Claude…" />
      ) : null}

      {result && !loading ? (
        result.status === "no_support_found" ? (
          <div className="rounded-lg border border-ink/15 bg-white p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
              No grounded answer
            </p>
            <p className="mt-2 text-sm text-ink/70">{result.message}</p>
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <AnswerView
              claims={result.claims}
              sources={result.sources}
              caveat={result.caveat}
              droppedClaims={result.dropped_claims}
            />
            <SourcesPanel sources={result.sources} />
          </div>
        )
      ) : null}
    </div>
  );
}
