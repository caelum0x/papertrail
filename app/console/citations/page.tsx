"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import { StanceBadge } from "./_components/StanceBadge";
import { GroundedContext } from "./_components/GroundedContext";
import type { CitationsClassifyResponse } from "./_components/types";

// Smart Citations console (Scite-style). Paste a CITING passage and the CITED
// work's claim; Claude reasons about the citation SEMANTICS and classifies the
// stance (supporting / contrasting / mentioning), then the trust layer grounds the
// citation-context sentence back to the citing text — an ungroundable sentence is
// withheld rather than asserted.

interface Example {
  label: string;
  citing_text: string;
  cited_claim: string;
}

const EXAMPLES: Example[] = [
  {
    label: "Supporting",
    citing_text:
      "Amyloid-lowering therapies have shown clinical benefit in early Alzheimer's disease. Consistent with this, the CLARITY-AD trial reported that lecanemab slowed cognitive decline on the CDR-SB versus placebo, reinforcing the amyloid hypothesis. We therefore selected an amyloid-targeting agent for the present study.",
    cited_claim:
      "In CLARITY-AD, lecanemab reduced clinical decline on the CDR-SB by 0.45 points versus placebo at 18 months.",
  },
  {
    label: "Contrasting",
    citing_text:
      "Earlier work suggested a large mortality benefit from the intervention. In contrast, our multi-center cohort found no significant reduction in all-cause mortality, and we were unable to replicate the previously reported 30% effect. This discrepancy may reflect differences in baseline risk.",
    cited_claim: "The intervention reduced all-cause mortality by 30% relative to standard care.",
  },
];

export default function CitationsPage() {
  const [citingText, setCitingText] = useState("");
  const [citedClaim, setCitedClaim] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CitationsClassifyResponse | null>(null);
  // Keep the passage that PRODUCED the current result so the highlight offsets
  // always match, even if the user edits the textarea afterward.
  const [gradedText, setGradedText] = useState("");

  const submit = useCallback(async (citing: string, cited: string) => {
    const c = citing.trim();
    const q = cited.trim();
    if (c.length < 20) {
      setError("Paste a citing passage of at least 20 characters.");
      setResult(null);
      return;
    }
    if (q.length < 10) {
      setError("Provide a cited claim of at least 10 characters.");
      setResult(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/citations/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ citing_text: c, cited_claim: q }),
      });
      const body = (await res
        .json()
        .catch(() => null)) as ApiResponse<CitationsClassifyResponse> | null;
      if (!body) {
        throw new Error("Unexpected server response.");
      }
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body?.error ?? "Citation classification failed.");
      }
      setResult(body.data);
      setGradedText(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to classify the citation.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }, []);

  return (
    <div className="space-y-6">
      <ModuleHeader
        title="Smart citations"
        subtitle="Claude classifies how one paper cites another — supporting, contrasting, or mentioning — with the citation-context sentence grounded to the citing text."
      />

      <div className="rounded-lg border border-ink/15 bg-white p-5">
        <label htmlFor="cite-citing" className="text-sm font-medium text-ink/70">
          Citing passage
        </label>
        <textarea
          id="cite-citing"
          value={citingText}
          onChange={(e) => setCitingText(e.target.value)}
          rows={5}
          placeholder="Paste the paragraph from the citing paper that references the other work…"
          className="mt-2 w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <label htmlFor="cite-claim" className="mt-4 block text-sm font-medium text-ink/70">
          Cited work's claim / finding
        </label>
        <textarea
          id="cite-claim"
          value={citedClaim}
          onChange={(e) => setCitedClaim(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit(citingText, citedClaim);
          }}
          rows={2}
          placeholder="e.g. Drug X reduced major cardiovascular events by 30% versus placebo."
          className="mt-2 w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={loading}
            onClick={() => submit(citingText, citedClaim)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {loading ? "Classifying…" : "Classify citation"}
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
                setCitingText(ex.citing_text);
                setCitedClaim(ex.cited_claim);
                submit(ex.citing_text, ex.cited_claim);
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
        <LoadingBanner message="Claude is reasoning about the citation stance and locating the context sentence…" />
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
              <StanceBadge
                stance={result.classification.stance}
                confidence={result.classification.confidence}
              />
              <span className="text-xs text-ink/40">
                Stance classified by Claude, context sentence grounded to your passage.
              </span>
            </div>
            <GroundedContext citingText={gradedText} classification={result.classification} />
          </div>
        )
      ) : null}
    </div>
  );
}
