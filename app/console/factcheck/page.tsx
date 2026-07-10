"use client";

import { useCallback, useState } from "react";
import type { ApiResponse } from "@/lib/api/response";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import {
  VERDICT_STYLES,
  RELATIONSHIP_STYLES,
  formatFactuality,
  type FactCheckResult,
  type FactCheckClaim,
  type FactCheckEvidence,
} from "./_components/types";

// Multi-step fact-verification console (Loki / OpenFactVerification, ported native).
// Paste a passage; Claude decomposes it into atomic claims, marks which are
// checkworthy, retrieves evidence from OUR cached sources, and judges each claim
// supported / refuted / unverified — every verdict grounded to a real quoted
// span of the source. No claim about a source appears without that source.

const EXAMPLES = [
  "Drug X reduced major cardiovascular events by 30% in all patients.",
  "Statins prevent stroke and are safe for everyone over 40.",
  "This vaccine is 100% effective at preventing infection.",
];

export default function FactCheckPage() {
  const [text, setText] = useState("");
  const [result, setResult] = useState<FactCheckResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (trimmed.length === 0 || loading) return;

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/factcheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      });
      const body = (await res.json().catch(() => null)) as ApiResponse<FactCheckResult> | null;
      if (!body) throw new Error("Unexpected server response.");
      if (!res.ok || !body.success || !body.data) {
        throw new Error(body.error ?? "The fact-check request failed.");
      }
      setResult(body.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fact-check text.");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return (
    <div>
      <ModuleHeader
        title="Fact Check"
        subtitle="Decompose a passage into atomic claims and verify each against cached sources — grounded, per-claim verdicts."
      />

      <form
        className="mt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void run(text);
        }}
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={4}
          maxLength={4000}
          placeholder="Paste a claim or passage to fact-check…"
          className="w-full resize-y rounded-lg border border-ink/15 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={loading || text.trim().length === 0}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Checking…" : "Fact-check"}
          </button>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => setText(ex)}
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-xs text-ink/60 hover:text-ink"
            >
              {ex.length > 44 ? `${ex.slice(0, 44)}…` : ex}
            </button>
          ))}
        </div>
      </form>

      <div className="mt-6 space-y-4">
        {loading ? (
          <LoadingBanner message="Decomposing claims, retrieving sources, and grounding each verdict…" />
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        {result ? <ResultView result={result} /> : null}
      </div>
    </div>
  );
}

function ResultView({ result }: { result: FactCheckResult }) {
  const { summary, claims } = result;
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-ink/15 bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Overall factuality</h2>
          <span className="text-2xl font-semibold text-ink">
            {formatFactuality(summary.factuality)}
          </span>
        </div>
        <p className="mt-1 text-xs text-ink/50">
          {summary.num_claims} claim{summary.num_claims === 1 ? "" : "s"} ·{" "}
          {summary.num_checkworthy} checkworthy · {summary.num_verified} verified ·{" "}
          {summary.num_supported} supported · {summary.num_refuted} refuted ·{" "}
          {summary.num_controversial} controversial
        </p>
      </div>

      {claims.map((claim, i) => (
        <ClaimCard key={i} claim={claim} />
      ))}
    </div>
  );
}

function ClaimCard({ claim }: { claim: FactCheckClaim }) {
  const style = VERDICT_STYLES[claim.verdict];
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="max-w-[80%] text-sm font-medium text-ink">{claim.claim}</p>
        <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${style.className}`}>
          {style.label}
          {claim.factuality !== null ? ` · ${formatFactuality(claim.factuality)}` : ""}
        </span>
      </div>

      <p className="mt-1 text-xs text-ink/50">{claim.checkworthy_reason}</p>

      {claim.evidence.length > 0 ? (
        <ul className="mt-3 space-y-3 border-t border-ink/15 pt-3">
          {claim.evidence.map((ev, i) => (
            <EvidenceItem key={i} evidence={ev} />
          ))}
        </ul>
      ) : claim.checkworthy ? (
        <p className="mt-3 border-t border-ink/15 pt-3 text-xs text-ink/50">
          No confident matching source in the cache — reported as unverified rather than guessed.
        </p>
      ) : null}

      {claim.grounding_dropped_count > 0 ? (
        <p className="mt-2 text-xs text-ink/40">
          {claim.grounding_dropped_count} ungroundable span
          {claim.grounding_dropped_count === 1 ? "" : "s"} dropped.
        </p>
      ) : null}
    </div>
  );
}

function EvidenceItem({ evidence }: { evidence: FactCheckEvidence }) {
  const rel = RELATIONSHIP_STYLES[evidence.relationship];
  return (
    <li className="text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <a
          href={evidence.url}
          target="_blank"
          rel="noreferrer"
          className="font-medium text-accent hover:underline"
        >
          {evidence.title ?? evidence.external_id}
        </a>
        <span className="text-ink/40">
          {evidence.source_type} · {evidence.external_id}
        </span>
        <span className={`font-medium ${rel.className}`}>{rel.label}</span>
      </div>
      <p className="mt-1 text-ink/60">{evidence.reasoning}</p>
      {evidence.source_span ? (
        <blockquote className="mt-1 border-l-2 border-ink/15 pl-2 text-ink/70">
          “{evidence.source_span}”
        </blockquote>
      ) : null}
    </li>
  );
}
