"use client";

import { useCallback, useState } from "react";
import type { GuidelineAuditResult } from "@/lib/guidelineAudit/schemas";
import { AuditSummary } from "./_components/AuditSummary";
import { AuditTable } from "./_components/AuditTable";

// GUIDELINE / PRESS-RELEASE AUDIT — paste a document, get a claim-by-claim audit.
//
// The user pastes a clinical guideline or press release; PaperTrail (Claude) extracts
// every efficacy claim, verifies each against primary sources, and renders a table with
// a per-claim verdict badge, the grounded source sentence, and the primary-source
// finding. All heavy lifting is server-side (/api/guideline-audit); this page only
// posts the text and renders the envelope.

const EXAMPLE = [
  "Our once-daily therapy DrugX transformed outcomes in the landmark trial: it slashed",
  "major cardiovascular events by 40% versus placebo and dramatically improved survival",
  "across all patient subgroups. DrugX was generally well tolerated.",
].join(" ");

const MAX_LENGTH = 24000;

export default function GuidelineAuditPage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<GuidelineAuditResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runAudit = useCallback(async () => {
    const trimmed = text.trim();
    if (trimmed.length < 40) {
      setError("Please paste a longer passage (at least 40 characters).");
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const res = await fetch("/api/guideline-audit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const body = await res.json().catch(() => null);

      if (!res.ok || !body?.success) {
        setError(
          body?.error ??
            "Something went wrong while auditing this document. Please try again."
        );
        return;
      }
      setResult(body.data as GuidelineAuditResult);
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [text]);

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-2">
      <div>
        <h1 className="text-2xl font-semibold text-ink/80">Guideline &amp; press-release audit</h1>
        <p className="mt-1 text-sm text-ink/40">
          Paste a clinical guideline or press release. PaperTrail extracts every efficacy
          claim it makes and verifies each against primary sources — flagging
          overstatements, with the exact source sentence and the primary finding beside
          each claim.
        </p>
      </div>

      <div className="space-y-3">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, MAX_LENGTH))}
          rows={8}
          placeholder="Paste the guideline or press-release text here…"
          className="w-full resize-y rounded-lg border border-ink/15 bg-white/60 p-4 text-sm text-ink/80 outline-none focus:border-ink/30 focus:ring-1 focus:ring-ink/20"
        />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 text-xs text-ink/40">
            <button
              type="button"
              onClick={() => setText(EXAMPLE)}
              className="underline underline-offset-2 hover:text-ink/60"
            >
              Try an example
            </button>
            <span>
              {text.length.toLocaleString()} / {MAX_LENGTH.toLocaleString()}
            </span>
          </div>
          <button
            type="button"
            onClick={runAudit}
            disabled={loading}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {loading ? "Auditing…" : "Audit document"}
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      ) : null}

      {result ? (
        <div className="space-y-4">
          <AuditSummary summary={result.summary} />
          {result.claims.length > 0 ? (
            <AuditTable claims={result.claims} />
          ) : (
            <div className="rounded-lg border border-ink/10 bg-white/40 px-4 py-6 text-center text-sm text-ink/50">
              No verifiable efficacy claims were found in this passage. Try pasting the
              results or efficacy section of the document.
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
