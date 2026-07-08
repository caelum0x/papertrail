"use client";

import { SourceMatch } from "@/components/SourceMatch";
import { TrustScoreCard } from "@/components/TrustScoreCard";
import { CitationTrail } from "@/components/CitationTrail";
import { SourceHighlight } from "@/components/SourceHighlight";
import { DownloadReport } from "@/components/DownloadReport";
import { CitationExport } from "@/components/CitationExport";
import { FindingCard } from "@/components/FindingCard";
import { GroundedSpan, locateSpan } from "@/lib/grounding";
import { ReportInput } from "@/lib/reportExport";
import { ExtractedFinding } from "@/lib/schemas";

export interface EffectSizeCheck {
  verdict: "magnitude_overstated" | "caveat_dropped" | "consistent" | "cannot_reconcile";
  rationale: string;
}

export type CrossSourceAgreement = "single_source" | "corroborated" | "conflicting";

export type RegistryVerdict =
  | "matches_registry"
  | "overstates_registry"
  | "understates_registry"
  | "significance_mismatch"
  | "secondary_endpoint_match"
  | "no_registered_results"
  | "not_comparable";

export interface RegistryCheck {
  verdict: RegistryVerdict;
  rationale: string;
  registeredReductionPercent: number | null;
  claimedReductionPercent: number | null;
  absoluteRiskReduction: number | null;
  numberNeededToTreat: number | null;
  primaryAnalysis: {
    outcomeTitle: string;
    paramType: string | null;
    paramValue: number | null;
    ciPct: number | null;
    ciLower: number | null;
    ciUpper: number | null;
    pValue: string | null;
  } | null;
}

export interface CorroboratingSource {
  id?: string;
  title: string | null;
  url: string;
  source_type: string;
  external_id?: string;
}

export interface VerificationViewData {
  claim: string;
  source: {
    title: string | null;
    url: string;
    source_type: string;
    external_id?: string;
    phase?: string | null;
    enrollment_count?: number | null;
    raw_text: string;
  } | null;
  verification: {
    discrepancy_type: string;
    trust_score: number;
    explanation: string;
    flagged_spans: GroundedSpan[];
  };
  effectSizeCheck?: EffectSizeCheck;
  /** The structured finding extracted from the source, when available (not stored
   *  on permalinks). Rendered as the "what the source reports" panel. */
  finding?: ExtractedFinding;
  /** Cross-source agreement indicator shown on the trust card. */
  crossSourceAgreement?: CrossSourceAgreement;
  /** Deterministic check against the trial's registered ClinicalTrials.gov results. */
  registryCheck?: RegistryCheck | null;
  /** Other confident sources retrieved for this claim, shown below the primary match. */
  corroboratingSources?: CorroboratingSource[];
  /** Unique DOM-id namespace for this instance's highlights, so multiple
   *  VerificationViews on one page (e.g. batch results) don't collide and so the
   *  citation trail can scroll-link to the right source spans. */
  idNamespace?: string;
}

/**
 * Locate each flagged claim_span inside the claim text (offsets into the claim),
 * reusing the same grounding logic as the source side. Unlocatable spans are skipped.
 */
function claimSpans(claim: string, flagged: GroundedSpan[]): GroundedSpan[] {
  const spans: GroundedSpan[] = [];
  for (const f of flagged) {
    const located = locateSpan(claim, f.claim_span);
    if (!located) continue;
    spans.push({
      claim_span: f.claim_span,
      source_span: located.text,
      issue: f.issue,
      grounding: { status: located.status, start: located.start, end: located.end },
    });
  }
  return spans;
}

const EFFECT_STYLE: Record<EffectSizeCheck["verdict"], string> = {
  magnitude_overstated: "border-rose-300 bg-rose-50 text-rose-900",
  caveat_dropped: "border-amber-300 bg-amber-50 text-amber-900",
  consistent: "border-green-300 bg-green-50 text-green-900",
  cannot_reconcile: "border-ink/15 bg-ink/5 text-ink/60",
};

const EFFECT_LABEL: Record<EffectSizeCheck["verdict"], string> = {
  magnitude_overstated: "Numeric check: magnitude overstated",
  caveat_dropped: "Numeric check: significance caveat dropped",
  consistent: "Numeric check: consistent with source",
  cannot_reconcile: "Numeric check: deferred (not rule-decidable)",
};

const REGISTRY_STYLE: Record<RegistryVerdict, string> = {
  overstates_registry: "border-rose-300 bg-rose-50 text-rose-900",
  understates_registry: "border-amber-300 bg-amber-50 text-amber-900",
  significance_mismatch: "border-amber-300 bg-amber-50 text-amber-900",
  secondary_endpoint_match: "border-rose-300 bg-rose-50 text-rose-900",
  matches_registry: "border-green-300 bg-green-50 text-green-900",
  no_registered_results: "border-ink/15 bg-ink/5 text-ink/60",
  not_comparable: "border-ink/15 bg-ink/5 text-ink/60",
};

const REGISTRY_LABEL: Record<RegistryVerdict, string> = {
  overstates_registry: "Overstates the trial's registered result",
  understates_registry: "Understates the trial's registered result",
  significance_mismatch: "Registered result was not statistically significant",
  secondary_endpoint_match: "Matches a secondary endpoint, not the primary result",
  matches_registry: "Matches the trial's registered result",
  no_registered_results: "No registered results posted for this trial",
  not_comparable: "Registered result not numerically comparable",
};

function RegistryPanel({ check }: { check: RegistryCheck }) {
  const a = check.primaryAnalysis;
  return (
    <div className={`rounded-lg border p-3 text-sm ${REGISTRY_STYLE[check.verdict]}`}>
      <div className="mb-1 flex items-center gap-2">
        <span className="rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
          Registry check
        </span>
        <span className="font-medium">{REGISTRY_LABEL[check.verdict]}</span>
      </div>
      <p>{check.rationale}</p>
      {a && a.paramValue !== null && (
        <p className="mt-1 font-mono text-xs opacity-80">
          Registered {a.outcomeTitle ? `“${a.outcomeTitle.slice(0, 60)}”: ` : ""}
          {a.paramType} {a.paramValue}
          {a.ciLower !== null && a.ciUpper !== null ? ` (${a.ciPct ?? 95}% CI ${a.ciLower}–${a.ciUpper})` : ""}
          {a.pValue ? `, p=${a.pValue}` : ""}
        </p>
      )}
      {check.absoluteRiskReduction !== null && (
        <p className="mt-1 font-mono text-xs opacity-80">
          Absolute risk reduction {check.absoluteRiskReduction} pts
          {check.numberNeededToTreat !== null ? ` · NNT ${Math.round(check.numberNeededToTreat)}` : ""}
          {check.registeredReductionPercent !== null ? ` · relative ≈${check.registeredReductionPercent}%` : ""}
        </p>
      )}
    </div>
  );
}

/**
 * Shared render for a verification result — used by the live tool (/) and by the
 * read-only permalink (/v/[id]). Renders without a source column when the cached
 * source is unavailable (e.g. an old permalink whose source record was removed).
 */
export function VerificationView({
  claim,
  source,
  verification,
  effectSizeCheck,
  finding,
  crossSourceAgreement,
  corroboratingSources,
  registryCheck,
  idNamespace = "v",
}: VerificationViewData) {
  const sourcePrefix = `${idNamespace}-src`;
  const claimPrefix = `${idNamespace}-claim`;
  const reportInput: ReportInput | null = source
    ? {
        claim,
        source: {
          title: source.title,
          url: source.url,
          source_type: source.source_type,
          external_id: source.external_id,
        },
        verification: {
          discrepancy_type: verification.discrepancy_type,
          trust_score: verification.trust_score,
          explanation: verification.explanation,
          flagged_spans: verification.flagged_spans,
        },
        effectSizeCheck,
      }
    : null;

  return (
    <div className="flex flex-col gap-4">
      <TrustScoreCard
        trustScore={verification.trust_score}
        discrepancyType={verification.discrepancy_type}
        explanation={verification.explanation}
        crossSourceAgreement={crossSourceAgreement}
      />

      {(reportInput || source) && (
        <div className="flex flex-wrap items-center gap-2">
          {reportInput && <DownloadReport input={reportInput} />}
          {source && (
            <CitationExport
              source={{
                title: source.title,
                url: source.url,
                source_type: source.source_type,
                external_id: source.external_id,
              }}
            />
          )}
        </div>
      )}

      {registryCheck && registryCheck.verdict !== "no_registered_results" && (
        <RegistryPanel check={registryCheck} />
      )}

      {effectSizeCheck && (
        <div className={`rounded-lg border p-3 text-sm ${EFFECT_STYLE[effectSizeCheck.verdict]}`}>
          <span className="font-medium">{EFFECT_LABEL[effectSizeCheck.verdict]}.</span>{" "}
          {effectSizeCheck.rationale}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/40">Your claim</div>
          <SourceHighlight
            rawText={claim}
            spans={claimSpans(claim, verification.flagged_spans)}
            idPrefix={claimPrefix}
          />
        </div>

        {source && (
          <SourceMatch source={source}>
            <SourceHighlight rawText={source.raw_text} spans={verification.flagged_spans} idPrefix={sourcePrefix} />
          </SourceMatch>
        )}
      </div>

      {corroboratingSources && corroboratingSources.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-ink/70">
            Corroborating sources ({corroboratingSources.length})
          </h2>
          <ul className="flex flex-col gap-2">
            {corroboratingSources.map((s, i) => (
              <li
                key={s.id ?? i}
                className="rounded-lg border border-ink/10 bg-white p-3 text-sm"
              >
                <div className="mb-0.5 text-xs font-medium uppercase tracking-wide text-ink/40">
                  {s.source_type === "pubmed" ? "PubMed" : "ClinicalTrials.gov"}
                  {s.external_id ? ` · ${s.external_id}` : ""}
                </div>
                <a
                  href={s.url}
                  target="_blank"
                  rel="noreferrer"
                  className="font-medium text-accent hover:underline"
                >
                  {s.title || s.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {finding && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-ink/70">What the source reports</h2>
          <FindingCard finding={finding} />
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-medium text-ink/70">Citation trail</h2>
        <CitationTrail flaggedSpans={verification.flagged_spans} spanIdPrefix={source ? sourcePrefix : undefined} />
      </div>
    </div>
  );
}
