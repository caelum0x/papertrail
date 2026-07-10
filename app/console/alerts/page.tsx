"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import { ImpactBadge } from "./_components/ImpactBadge";
import { GroundedEvidence } from "./_components/GroundedEvidence";
import type { AlertsAssessResponse } from "./_components/types";

// Evidence Alerts console (Trialstreamer-style). Describe a WATCHED TOPIC (and,
// optionally, the topic's CURRENT pooled verdict), paste a NEW source's abstract /
// registered finding, and Claude reads the source and assesses whether it MATTERS —
// is it relevant, and would it confirm / weaken / overturn the current verdict? The
// trust layer grounds Claude's supporting quote back to the source; an ungroundable
// quote is withheld rather than asserted.

interface Example {
  label: string;
  topic: string;
  current_verdict: string;
  source_text: string;
}

const EXAMPLES: Example[] = [
  {
    label: "Overturns",
    topic: "Does drug X reduce major adverse cardiovascular events (MACE) versus placebo?",
    current_verdict:
      "Pooled across two earlier trials, drug X reduced MACE by roughly 25% versus placebo (HR ~0.75).",
    source_text:
      "In this large, well-powered phase 3 trial of 9,412 patients, drug X did not significantly reduce major adverse cardiovascular events compared with placebo (HR 1.02, 95% CI 0.91-1.14, p=0.78). The previously reported benefit was not replicated in this broader population.",
  },
  {
    label: "Confirms",
    topic: "Does lecanemab slow cognitive decline in early Alzheimer's disease?",
    current_verdict:
      "CLARITY-AD reported lecanemab slowed decline on the CDR-SB versus placebo at 18 months.",
    source_text:
      "In this independent open-label extension, lecanemab-treated participants continued to show slower decline on the CDR-SB than a matched placebo-derived cohort, consistent with the pivotal trial's amyloid-lowering benefit. No new safety signal emerged.",
  },
  {
    label: "Not relevant",
    topic: "Does drug X reduce major adverse cardiovascular events versus placebo?",
    current_verdict:
      "Pooled evidence suggests drug X reduces MACE by roughly 25% versus placebo.",
    source_text:
      "This pharmacokinetic study characterized the absorption and hepatic metabolism of drug X in 24 healthy volunteers, reporting a mean half-life of 11.3 hours. No cardiovascular outcomes were assessed.",
  },
];

export default function AlertsPage() {
  const [topic, setTopic] = useState("");
  const [currentVerdict, setCurrentVerdict] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AlertsAssessResponse | null>(null);
  // Keep the source text that PRODUCED the current result so the highlight offsets
  // always line up, even if the user edits the textarea afterward.
  const [assessedText, setAssessedText] = useState("");

  const submit = useCallback(
    async (t: string, v: string, s: string) => {
      const topicT = t.trim();
      const sourceT = s.trim();
      if (topicT.length < 5) {
        setError("Describe the watched topic in at least 5 characters.");
        setResult(null);
        return;
      }
      if (sourceT.length < 40) {
        setError("Paste the new source's abstract / finding (at least 40 characters).");
        setResult(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const orgId =
          typeof window !== "undefined" ? window.localStorage.getItem("pt_active_org") : null;
        const res = await fetch("/api/alerts/assess", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(orgId ? { "x-org-id": orgId } : {}),
          },
          body: JSON.stringify({
            topic: topicT,
            current_verdict: v.trim().length > 0 ? v.trim() : null,
            source_text: sourceT,
          }),
        });
        const body = (await res
          .json()
          .catch(() => null)) as ApiResponse<AlertsAssessResponse> | null;
        if (!body) {
          throw new Error("Unexpected server response.");
        }
        if (!res.ok || !body.success || !body.data) {
          throw new Error(body?.error ?? "Alert assessment failed.");
        }
        setResult(body.data);
        setAssessedText(sourceT);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to assess the source.");
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
        title="Evidence alerts"
        subtitle="Claude reads a newly appearing source and judges whether it matters to a watched topic — confirming, weakening, or overturning the current verdict — with its reasoning grounded to the source text."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-5">
        <label htmlFor="alert-topic" className="text-sm font-medium text-ink/70">
          Watched topic
        </label>
        <textarea
          id="alert-topic"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          rows={2}
          placeholder="e.g. Does drug X reduce major adverse cardiovascular events versus placebo?"
          className="mt-2 w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <label
          htmlFor="alert-verdict"
          className="mt-4 block text-sm font-medium text-ink/70"
        >
          Current verdict <span className="font-normal text-ink/40">(optional)</span>
        </label>
        <textarea
          id="alert-verdict"
          value={currentVerdict}
          onChange={(e) => setCurrentVerdict(e.target.value)}
          rows={2}
          placeholder="The topic's current pooled conclusion, if any — e.g. Pooled evidence suggests a ~25% reduction in MACE."
          className="mt-2 w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <label
          htmlFor="alert-source"
          className="mt-4 block text-sm font-medium text-ink/70"
        >
          New source (abstract / registered finding)
        </label>
        <textarea
          id="alert-source"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter")
              submit(topic, currentVerdict, sourceText);
          }}
          rows={6}
          placeholder="Paste the abstract or registered result of the newly appearing source…"
          className="mt-2 w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => submit(topic, currentVerdict, sourceText)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Assessing…" : "Assess impact"}
          </button>
          <span className="text-xs text-ink/30">⌘/Ctrl + Enter</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              disabled={loading}
              onClick={() => {
                setTopic(ex.topic);
                setCurrentVerdict(ex.current_verdict);
                setSourceText(ex.source_text);
                submit(ex.topic, ex.current_verdict, ex.source_text);
              }}
              className="rounded-full border border-ink/15 px-3 py-1 text-xs text-ink/50 hover:border-accent/40 hover:text-accent disabled:opacity-50"
            >
              Try: {ex.label}
            </button>
          ))}
        </div>
      </div>

      {error ? <ErrorBanner message={error} /> : null}

      {loading ? (
        <LoadingBanner message="Claude is reading the source and assessing its impact on the watched verdict…" />
      ) : null}

      {result && !loading ? (
        result.status === "ungroundable" ? (
          <div className="rounded-lg border border-ink/15 bg-white p-5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink/40">
              Withheld — not grounded
            </p>
            <p className="mt-2 text-sm text-ink/70">{result.message}</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <ImpactBadge
                impact={result.assessment.likely_impact}
                confidence={result.assessment.confidence}
              />
              <span className="text-xs text-ink/40">
                Impact assessed by Claude, supporting quote grounded to your source.
              </span>
            </div>
            <GroundedEvidence sourceText={assessedText} assessment={result.assessment} />
          </div>
        )
      ) : null}
    </div>
  );
}
