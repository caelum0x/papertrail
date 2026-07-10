"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import { VerdictCard } from "./_components/VerdictCard";
import { SourceHighlight } from "./_components/SourceHighlight";
import { VERDICT_STYLES, type FindingResult } from "./_components/types";

// Bioinformatics-finding verification console. Paste a finding (and optionally
// the source passage it came from); PaperTrail runs deterministic per-check
// verification and grounds every quoted effect size to a VERBATIM substring of
// the source. No LLM sits in the verdict/numeric path; ungroundable spans are
// dropped and counted, never invented. These are PUBLIC compute routes — the
// fetch carries no auth/org header.

const EXAMPLE_FINDING =
  "Knockdown of MALAT1 reduced cell migration by 42% (p<0.001) in the invasion assay.";
const EXAMPLE_SOURCE =
  "In transwell migration assays, MALAT1 knockdown reduced migration by 42% relative to scrambled control (p<0.001), with no change in viability.";

export default function BioFindingPage() {
  const [finding, setFinding] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [result, setResult] = useState<FindingResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async () => {
    const trimmed = finding.trim();
    if (trimmed.length === 0 || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const body: { finding: string; source_text?: string } = { finding: trimmed };
      const src = sourceText.trim();
      if (src.length > 0) body.source_text = src;

      // Public route: no x-org-id / auth header.
      const res = await fetch("/api/bio/verify-finding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as ApiResponse<FindingResult> | null;
      if (!json) throw new Error("Unexpected server response.");
      if (!res.ok || !json.success || !json.data) {
        throw new Error(json.error ?? "The finding-verification request failed.");
      }
      setResult(json.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify the finding.");
    } finally {
      setLoading(false);
    }
  }, [finding, sourceText, loading]);

  const loadExample = useCallback(() => {
    setFinding(EXAMPLE_FINDING);
    setSourceText(EXAMPLE_SOURCE);
  }, []);

  return (
    <div>
      <ModuleHeader
        title="Verify Finding"
        subtitle="Check the quoted numbers in a bioinformatics finding against its source — per-check verdicts, every effect size grounded verbatim."
      />

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <label className="block text-xs font-medium text-ink/60" htmlFor="finding">
          Finding
        </label>
        <textarea
          id="finding"
          value={finding}
          onChange={(e) => setFinding(e.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Paste a finding, e.g. “Knockdown of MALAT1 reduced migration by 42% (p<0.001).”"
          className="mt-1 w-full resize-y rounded-lg border border-ink/15 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
        />

        <label className="mt-4 block text-xs font-medium text-ink/60" htmlFor="source">
          Source text <span className="text-ink/40">(optional — enables verbatim grounding)</span>
        </label>
        <textarea
          id="source"
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          rows={4}
          maxLength={40000}
          placeholder="Paste the results paragraph the finding is drawn from…"
          className="mt-1 w-full resize-y rounded-lg border border-ink/15 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={loading || finding.trim().length === 0}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Verifying…" : "Verify finding"}
          </button>
          <button
            type="button"
            onClick={loadExample}
            className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-xs text-ink/60 hover:text-ink"
          >
            Load example
          </button>
        </div>
      </form>

      <div className="mt-6 space-y-4">
        {loading ? (
          <LoadingBanner message="Running deterministic per-check verification and grounding each effect size…" />
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        {result ? <ResultView result={result} /> : null}
      </div>
    </div>
  );
}

function ResultView({ result }: { result: FindingResult }) {
  const style = VERDICT_STYLES[result.overallVerdict];
  const spans = result.groundedSpans ?? [];
  const checks = result.checks ?? [];
  const dropped = result.groundingDroppedCount ?? 0;

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Overall verdict</h2>
          <span
            className={`rounded-full border px-3 py-0.5 text-sm font-medium ${style.className}`}
          >
            {style.label}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink/70">{result.rationale}</p>
        <p className="mt-2 text-xs text-ink/40">
          {checks.length} check{checks.length === 1 ? "" : "s"} ·{" "}
          {spans.length} grounded span{spans.length === 1 ? "" : "s"} ·{" "}
          {dropped} dropped as ungroundable
        </p>
      </div>

      {checks.length > 0 ? (
        <div className="space-y-3">
          {checks.map((check, i) => (
            <VerdictCard key={`${check.kind}-${i}`} check={check} />
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-ink/15 bg-paper px-4 py-3 text-xs text-ink/50">
          No runnable check applied to this finding — reported honestly rather than guessed.
        </p>
      )}

      {result.sourceText && spans.length > 0 ? (
        <SourceHighlight source={result.sourceText} spans={spans} />
      ) : spans.length > 0 ? (
        <div className="rounded-lg border border-ink/15 bg-white p-4">
          <h3 className="text-sm font-semibold text-ink">Grounded effect sizes</h3>
          <ul className="mt-2 space-y-2">
            {spans.map((span, i) => (
              <li key={i} className="text-sm text-ink/70">
                <span className="rounded bg-accent/15 px-1 text-ink">{span.text}</span>
                {span.label ? <span className="ml-2 text-xs text-ink/40">{span.label}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
