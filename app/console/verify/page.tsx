"use client";

import { useCallback, useMemo, useState } from "react";
import { ModuleHeader } from "../claims/_components/ModuleHeader";
import { ErrorBanner, LoadingBanner } from "@/components/console/StateBanners";
import {
  VERDICT_STYLES,
  VERDICT_MEANING,
  RECONCILE_STYLES,
  AGREEMENT_LABELS,
  trustQualifier,
  type VerifyResult,
  type VerifyVerification,
  type VerifySource,
} from "./_components/types";
import type { ExtractedFinding } from "@/lib/schemas";
import type { GroundedSpan } from "@/lib/grounding";
import type { Reconciliation } from "@/lib/effectSize";

// Claim-verification console — PaperTrail's core. Paste an efficacy/safety claim and
// its primary source; the engine extracts the source finding, audits the claim against
// it (grounding every flagged span to a verbatim source substring with char offsets),
// and runs a DETERMINISTIC numeric effect-size reconciliation. The reconcile layer is
// code, not the LLM: if Claude is rate-limited/capped during judging, the whole request
// 500s at the API, so we surface that as an honest degraded state — never a white screen.

interface ExampleClaim {
  label: string;
  claim: string;
  sourceText: string;
}

// Two client-side examples so a first-time reviewer gets full value in one click, with
// NO DB seeding. #1 is a faithful claim (source HR 0.70 = 30% RRR, claim says 30%). #2 is
// subtly overstated (source HR 0.75 = 25% RRR, claim says 37%) — the discriminative catch.
const EXAMPLE_CLAIMS: readonly ExampleClaim[] = [
  {
    label: "Accurate: 30% reduction vs HR 0.70",
    claim: "Atorvastatin reduced major cardiovascular events by 30% in adults with prior MI.",
    sourceText:
      "In a randomized, double-blind trial of 4,731 adults with a prior myocardial infarction, atorvastatin was compared with placebo over a median follow-up of 4.9 years. The primary endpoint (a composite of coronary heart disease death or nonfatal myocardial infarction) occurred less frequently in the atorvastatin group, with a hazard ratio of 0.70 (95% CI 0.55-0.89), representing a 30% relative risk reduction. Benefit was consistent across prespecified subgroups. The trial enrolled only patients with established coronary disease and did not assess primary prevention.",
  },
  {
    label: "Overstated: claim 37% vs HR 0.75 (25%)",
    claim: "Drug Y reduced hospitalization risk by 37% in patients with heart failure.",
    sourceText:
      "This multicenter, placebo-controlled trial randomized 2,140 patients with chronic heart failure to Drug Y or placebo. For the primary outcome of first hospitalization for heart failure, the hazard ratio was 0.75 (95% CI 0.60-0.95), representing a relative risk reduction of 25%. The effect was observed in patients with reduced ejection fraction; the trial did not enroll patients with preserved ejection fraction. Discontinuation for adverse events was more common in the treatment arm.",
  },
] as const;

const MIN_CLAIM_CHARS = 10;
const MIN_SOURCE_CHARS = 40;
const MAX_SOURCE_CHARS = 20000;

export default function VerifyPage() {
  const [claim, setClaim] = useState("");
  const [sourceText, setSourceText] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    !loading &&
    claim.trim().length >= MIN_CLAIM_CHARS &&
    sourceText.trim().length >= MIN_SOURCE_CHARS;

  const run = useCallback(async () => {
    const trimmedClaim = claim.trim();
    const trimmedSource = sourceText.trim();
    if (
      trimmedClaim.length < MIN_CLAIM_CHARS ||
      trimmedSource.length < MIN_SOURCE_CHARS ||
      loading
    ) {
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/verify/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ claim: trimmedClaim, source_text: trimmedSource }),
      });
      const body = (await res.json().catch(() => null)) as
        | (Partial<VerifyResult> & { error?: string })
        | null;
      if (!body) throw new Error("Unexpected server response.");
      if (!res.ok || body.status !== "verified" || !body.verification || !body.finding) {
        // The core verdict is deterministic once extraction succeeds, but this
        // "bring your own source" path still needs one Claude call to extract the
        // finding. If that call is rate-limited or the key is capped, the route 500s
        // — surface it honestly rather than pretending we verified anything.
        const isCap = res.status === 429 || res.status === 503;
        throw new Error(
          body.error ??
            (isCap
              ? "The claim-audit model is over its usage limit right now. The deterministic reconciliation runs on your pasted source and needs no key — please retry in a moment."
              : "The verification request failed.")
        );
      }
      setResult(body as VerifyResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to verify claim.");
    } finally {
      setLoading(false);
    }
  }, [claim, sourceText, loading]);

  const loadExample = useCallback((ex: ExampleClaim) => {
    setClaim(ex.claim);
    setSourceText(ex.sourceText);
    setResult(null);
    setError(null);
  }, []);

  return (
    <div>
      <ModuleHeader
        title="Claim Verification"
        subtitle="For medical-affairs and translational reviewers: paste an efficacy or safety claim and its primary source, and get a grounded verdict, a trust score, and a citation trail — every flag tied to an exact quote from the source."
      />

      <form
        className="mt-6 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div>
          <label htmlFor="verify-claim" className="mb-1 block text-xs font-medium text-ink/60">
            Claim to audit
          </label>
          <textarea
            id="verify-claim"
            value={claim}
            onChange={(e) => setClaim(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder='e.g. "Drug X reduced major cardiovascular events by 30%"'
            className="w-full resize-y rounded-lg border border-ink/15 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="verify-source" className="mb-1 block text-xs font-medium text-ink/60">
            Primary source text{" "}
            <span className="font-normal text-ink/40">
              (abstract, trial excerpt, or passage — up to {MAX_SOURCE_CHARS.toLocaleString()}{" "}
              characters)
            </span>
          </label>
          <textarea
            id="verify-source"
            value={sourceText}
            onChange={(e) => setSourceText(e.target.value)}
            rows={7}
            maxLength={MAX_SOURCE_CHARS}
            placeholder="Paste the abstract or the relevant passage from the primary source…"
            className="w-full resize-y rounded-lg border border-ink/15 bg-white px-4 py-3 text-sm text-ink placeholder:text-ink/40 focus:border-accent focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={!canSubmit}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-40"
          >
            {loading ? "Verifying…" : "Verify claim"}
          </button>
          <span className="text-xs text-ink/40">Or try an example:</span>
          {EXAMPLE_CLAIMS.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => loadExample(ex)}
              className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-xs text-ink/60 hover:text-ink"
            >
              {ex.label}
            </button>
          ))}
        </div>
      </form>

      <div className="mt-6 space-y-4">
        {loading ? (
          <LoadingBanner message="Extracting the source finding, grounding each flagged span to a verbatim quote, and running the deterministic effect-size check…" />
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        {result ? <ResultView result={result} /> : null}
        {!loading && !error && !result ? (
          <EmptyState />
        ) : null}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-ink/15 bg-white p-6 text-sm text-ink/50">
      <p className="font-medium text-ink/70">No verification yet.</p>
      <p className="mt-1">
        Paste a claim and its primary source above, or load an example. PaperTrail will
        return a colour-coded verdict, a 0–100 trust score, the extracted source finding,
        the flagged claim-vs-source spans (each tied to an exact quote), and a deterministic
        numeric effect-size check that fires even without the LLM.
      </p>
    </div>
  );
}

function ResultView({ result }: { result: VerifyResult }) {
  const { verification, finding, effect_size_check, source, claim } = result;
  return (
    <div className="space-y-4">
      <VerdictCard
        verification={verification}
        effectCheck={effect_size_check}
        source={source}
        claim={claim}
      />
      <FindingCard finding={finding} />
      {verification.flagged_spans.length > 0 ? (
        <FlaggedSpansCard
          spans={verification.flagged_spans}
          droppedCount={verification.grounding_dropped_count}
          rawText={source.raw_text}
        />
      ) : (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          No discrepancies flagged — the claim matches the source finding, so there are no
          spans to reconcile.
          {verification.grounding_dropped_count > 0 ? (
            <span className="mt-1 block text-xs text-emerald-700/80">
              {verification.grounding_dropped_count} model-proposed span
              {verification.grounding_dropped_count === 1 ? " was" : "s were"} dropped for not
              matching the source verbatim (PaperTrail grounding invariant).
            </span>
          ) : null}
        </div>
      )}
    </div>
  );
}

function VerdictCard({
  verification,
  effectCheck,
  source,
  claim,
}: {
  verification: VerifyVerification;
  effectCheck: Reconciliation;
  source: VerifySource;
  claim: string;
}) {
  const style = VERDICT_STYLES[verification.discrepancy_type];
  const reconcileStyle = RECONCILE_STYLES[effectCheck.verdict];

  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-full border px-3 py-1 text-sm font-medium ${style.className}`}
            >
              {style.label}
            </span>
            <span className="text-xs text-ink/50">
              {AGREEMENT_LABELS[verification.cross_source_agreement]}
            </span>
          </div>
          <p className="mt-2 text-xs text-ink/60">
            {VERDICT_MEANING[verification.discrepancy_type]}
          </p>
        </div>
        <div className="text-right">
          <div className="text-3xl font-semibold text-ink">
            {verification.trust_score}
            <span className="text-base font-normal text-ink/40"> / 100</span>
          </div>
          <p className="text-xs text-ink/40">{trustQualifier(verification.trust_score)}</p>
        </div>
      </div>

      <p className="mt-3 border-t border-ink/10 pt-3 text-sm text-ink/80">
        {verification.explanation}
      </p>

      <div className="mt-3 rounded-md border border-ink/15 bg-paper/40 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink/50">Effect-size check</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${reconcileStyle.className}`}
          >
            {reconcileStyle.label}
          </span>
          <span className="text-xs text-ink/40">(deterministic — runs without the LLM)</span>
        </div>
        <p className="mt-1.5 text-xs text-ink/70">{effectCheck.rationale}</p>
      </div>

      <CopyCitation
        claim={claim}
        verdictLabel={style.label}
        trustScore={verification.trust_score}
        source={source}
        spans={verification.flagged_spans}
      />
    </div>
  );
}

function FindingCard({ finding }: { finding: ExtractedFinding }) {
  const rows: readonly { label: string; value: string }[] = [
    { label: "Effect size", value: finding.effect_size },
    { label: "Population", value: finding.population },
    { label: "Condition", value: finding.condition },
    { label: "Endpoint", value: finding.endpoint },
    {
      label: "Caveats",
      value: finding.caveats.length > 0 ? finding.caveats.join("; ") : "None reported",
    },
  ];
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink">Extracted source finding</h2>
      <p className="mt-0.5 text-xs text-ink/40">
        What the source actually reports — compare this against the claim above.
      </p>
      <dl className="mt-3 divide-y divide-ink/10 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex gap-4 py-2">
            <dt className="w-28 shrink-0 text-xs font-medium text-ink/50">{row.label}</dt>
            <dd className="text-ink/80">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function FlaggedSpansCard({
  spans,
  droppedCount,
  rawText,
}: {
  spans: readonly GroundedSpan[];
  droppedCount: number;
  rawText: string;
}) {
  return (
    <div className="rounded-lg border border-ink/15 bg-white p-4">
      <h2 className="text-sm font-semibold text-ink">Flagged spans</h2>
      <p className="mt-0.5 text-xs text-ink/40">
        Each flag pairs the claim wording with the exact source quote that fails to support
        it. Source quotes are verbatim, located at real character offsets — PaperTrail never
        cites text it cannot point to.
      </p>
      <ul className="mt-3 space-y-4">
        {spans.map((span, i) => (
          <FlaggedSpanRow key={i} span={span} rawText={rawText} />
        ))}
      </ul>
      {droppedCount > 0 ? (
        <p className="mt-3 border-t border-ink/10 pt-3 text-xs text-ink/40">
          {droppedCount} flagged span{droppedCount === 1 ? "" : "s"} could not be located in the
          source verbatim and {droppedCount === 1 ? "was" : "were"} dropped per PaperTrail&apos;s
          grounding invariant.
        </p>
      ) : null}
    </div>
  );
}

function FlaggedSpanRow({ span, rawText }: { span: GroundedSpan; rawText: string }) {
  const lineNumber = useMemo(
    () => rawText.slice(0, span.grounding.start).split("\n").length,
    [rawText, span.grounding.start]
  );
  return (
    <li className="grid gap-3 md:grid-cols-2">
      <div className="rounded-md border-l-4 border-amber-400 bg-amber-50 px-3 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700/70">
          Claim says
        </p>
        <p className="mt-0.5 text-sm text-ink/80">{span.claim_span}</p>
      </div>
      <div className="rounded-md border-l-4 border-ink/25 bg-paper/40 px-3 py-2">
        <p className="text-[10px] font-medium uppercase tracking-wide text-ink/50">
          Source says · line {lineNumber}, chars {span.grounding.start}–{span.grounding.end}
          {span.grounding.status === "approximate" ? " (normalized match)" : ""}
        </p>
        <p className="mt-0.5 text-sm text-ink/80">“{span.source_span}”</p>
      </div>
      <p className="text-xs text-ink/60 md:col-span-2">{span.issue}</p>
    </li>
  );
}

function CopyCitation({
  claim,
  verdictLabel,
  trustScore,
  source,
  spans,
}: {
  claim: string;
  verdictLabel: string;
  trustScore: number;
  source: VerifySource;
  spans: readonly GroundedSpan[];
}) {
  const [copied, setCopied] = useState(false);

  const citation = useMemo(() => {
    const grounded =
      spans.length > 0 ? spans[0].source_span : source.raw_text.slice(0, 160).trim();
    const sourceLabel = source.title || "Pasted source";
    return [
      `"${claim}"`,
      `Verdict: ${verdictLabel} (PaperTrail trust score ${trustScore}/100).`,
      `Source: ${sourceLabel} (${source.source_type}).`,
      `Grounded on: "${grounded}"`,
    ].join("\n");
  }, [claim, verdictLabel, trustScore, source, spans]);

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(citation);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }, [citation]);

  return (
    <div className="mt-3 flex items-center justify-end">
      <button
        type="button"
        onClick={() => void onCopy()}
        className="rounded-md border border-ink/15 bg-white px-3 py-1.5 text-xs font-medium text-ink/70 hover:text-ink"
      >
        {copied ? "Citation copied ✓" : "Copy citation"}
      </button>
    </div>
  );
}
