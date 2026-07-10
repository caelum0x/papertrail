// AUTO-SYNTHESIS FROM CACHED SOURCES — the bridge between PaperTrail's deterministic
// moat and its real cached data. Given a claim plus a set of cached sources, this
// DETERMINISTICALLY extracts each source's primary effect estimate (with a CI) and
// pools them into a full composite evidence report via buildEvidenceReport — instead
// of a user hand-typing point estimates and confidence intervals.
//
// The extraction is rule-based and traceable, NOT model-guessed:
//   - ClinicalTrials.gov sources: take the source's registered PRIMARY ratio analysis
//     (paramValue + CI) straight from `registered_results` — sponsor-reported ground
//     truth. Same selection shape as synthesisVerification / evidenceCertainty.
//   - PubMed sources: parse the reported effect sizes out of `raw_text` with the same
//     regex layer as lib/effectSize.ts and take the primary ratio effect that carries
//     a confidence interval.
//
// When a source yields no usable ratio-with-CI effect we DROP it into `skipped` with a
// captured reason and never fabricate a number. Pooling itself, the publication-bias
// test, GRADE, and the claim reconciliation all happen inside buildEvidenceReport — so
// there is NO LLM anywhere in the numeric path. This file is pure orchestration over
// data the caller supplies; it performs no DB access and no network I/O.

import { z } from "zod";
import type { TrialResultAnalysis } from "./sources/clinicaltrials";
import type { RatioMeasure } from "./metaAnalysis";
import { parseEffectSizes, type ParsedEffect } from "./effectSize";
import {
  buildEvidenceReport,
  type BuildEvidenceReportResult,
  type EvidenceReportStudy,
} from "./evidenceReport";

// ---------------------------------------------------------------------------
// Input shape. One cached source row as loaded from the `sources` table. Kept
// structural (not coupled to a DB row type) so the route can pass plain rows.
// `registered_results` is the jsonb column: TrialResultAnalysis[] for CT.gov.
// ---------------------------------------------------------------------------
export const AutoSynthesisSourceSchema = z.object({
  id: z.string().min(1),
  source_type: z.string().min(1),
  title: z.string().nullable().optional(),
  raw_text: z.string().default(""),
  registered_results: z.array(z.unknown()).nullable().optional(),
});
export type AutoSynthesisSource = z.infer<typeof AutoSynthesisSourceSchema>;

export const AutoSynthesizeInputSchema = z.object({
  claim: z.string().trim().min(10).max(2000),
  sources: z.array(AutoSynthesisSourceSchema).min(1).max(100),
});
export type AutoSynthesizeInput = z.infer<typeof AutoSynthesizeInputSchema>;

// A study extracted from one source, carrying the source id it traces back to and a
// human label. The numeric fields are exactly what buildEvidenceReport pools.
export interface ExtractedStudy {
  source_id: string;
  label: string;
  measure: RatioMeasure;
  point: number;
  ci_lower: number;
  ci_upper: number;
}

export interface SkippedSource {
  id: string;
  reason: string;
}

export interface AutoSynthesisResult {
  studies: ExtractedStudy[];
  skipped: SkippedSource[];
  report: BuildEvidenceReportResult;
}

// The point at which extraction either succeeded (a poolable study) or failed with a
// captured reason. A discriminated result so the orchestrator never has to guess.
export type ExtractionOutcome =
  | { ok: true; study: ExtractedStudy }
  | { ok: false; reason: string };

// Map a registered analysis's free-text paramType ("Hazard Ratio (HR)", "Odds Ratio
// (OR)", "Risk Ratio (RR)", "Relative Risk"...) to the meta-analysis ratio-measure
// enum. Returns null for anything that is not a poolable ratio. Same mapping shape as
// synthesisVerification.measureOf / evidenceCertainty.toRatioMeasure.
function measureOf(paramType: string | null | undefined): RatioMeasure | null {
  if (!paramType) return null;
  const p = paramType.toLowerCase();
  if (p.includes("hazard ratio") || /\bhr\b/.test(p)) return "HR";
  if (p.includes("odds ratio") || /\bor\b/.test(p)) return "OR";
  if (
    p.includes("risk ratio") ||
    p.includes("rate ratio") ||
    p.includes("relative risk") ||
    /\brr\b/.test(p)
  ) {
    return "RR";
  }
  return null;
}

function isTrialResultAnalysisArray(v: unknown): v is TrialResultAnalysis[] {
  return Array.isArray(v);
}

function sourceLabel(source: AutoSynthesisSource): string {
  const title = source.title?.trim();
  if (title) return title;
  return `Source ${source.id}`;
}

// Choose a CT.gov source's most citable registered analysis: a PRIMARY ratio outcome
// with a positive point estimate AND both CI bounds (needed to weight by variance),
// falling back to any usable ratio analysis. Returns null when none is poolable.
type EffectFields = Pick<ExtractedStudy, "measure" | "point" | "ci_lower" | "ci_upper">;

function primaryRegisteredEffect(analyses: TrialResultAnalysis[]): EffectFields | null {
  const usable = analyses.filter(
    (a) =>
      a.paramValue !== null &&
      a.paramValue > 0 &&
      a.ciLower !== null &&
      a.ciLower > 0 &&
      a.ciUpper !== null &&
      a.ciUpper > 0 &&
      measureOf(a.paramType) !== null
  );
  if (usable.length === 0) return null;

  const chosen = usable.find((a) => a.outcomeType === "PRIMARY") ?? usable[0];
  const measure = measureOf(chosen.paramType);
  if (measure === null) return null;

  return {
    measure,
    point: chosen.paramValue as number,
    ci_lower: chosen.ciLower as number,
    ci_upper: chosen.ciUpper as number,
  };
}

// The ratio measures we can pool. Percent RRRs / absolute effects share no common
// variance scale here, so a source that only reports those is honestly skipped.
const RATIO_MEASURES: Record<string, RatioMeasure> = { RR: "RR", HR: "HR", OR: "OR" };

function isPoolableRatio(e: ParsedEffect): boolean {
  return (
    e.measure in RATIO_MEASURES &&
    e.point !== null &&
    e.point > 0 &&
    e.ciLow !== null &&
    e.ciLow > 0 &&
    e.ciHigh !== null &&
    e.ciHigh > 0
  );
}

// Extract the primary poolable ratio effect from PubMed free text. Prefers the first
// ratio effect that carries a full CI (variance-weightable). Returns null when the
// text reports no ratio-with-CI effect — e.g. only an RRR%, only an absolute change,
// or a ratio with no interval.
function primaryTextEffect(rawText: string): EffectFields | null {
  const effects = parseEffectSizes(rawText);
  const chosen = effects.find(isPoolableRatio);
  if (!chosen) return null;
  return {
    measure: RATIO_MEASURES[chosen.measure],
    point: chosen.point as number,
    ci_lower: chosen.ciLow as number,
    ci_upper: chosen.ciHigh as number,
  };
}

/**
 * Deterministically extract a single poolable study from one cached source.
 *
 * For 'clinicaltrials' sources, take the registered PRIMARY ratio analysis (point +
 * CI) from `registered_results`. For 'pubmed' sources, parse `raw_text` and take the
 * primary ratio effect that reports a confidence interval. Any other source_type, or
 * a source with no usable ratio-with-CI effect, returns a captured skip reason instead
 * of a fabricated number. Pure: does not mutate its input.
 */
export function extractStudyFromSource(source: AutoSynthesisSource): ExtractionOutcome {
  const label = sourceLabel(source);

  if (source.source_type === "clinicaltrials") {
    if (!isTrialResultAnalysisArray(source.registered_results)) {
      return {
        ok: false,
        reason:
          "ClinicalTrials.gov source has no cached registered results to extract a primary effect from.",
      };
    }
    const effect = primaryRegisteredEffect(source.registered_results);
    if (!effect) {
      return {
        ok: false,
        reason:
          "No registered PRIMARY ratio analysis (HR/OR/RR) with a confidence interval was found in this trial's posted results.",
      };
    }
    return { ok: true, study: { source_id: source.id, label, ...effect } };
  }

  if (source.source_type === "pubmed") {
    const effect = primaryTextEffect(source.raw_text ?? "");
    if (!effect) {
      return {
        ok: false,
        reason:
          "No ratio effect (HR/OR/RR) with a parseable confidence interval was found in this source's text.",
      };
    }
    return { ok: true, study: { source_id: source.id, label, ...effect } };
  }

  return {
    ok: false,
    reason: `Unsupported source_type '${source.source_type}' — only 'clinicaltrials' and 'pubmed' can be auto-synthesised.`,
  };
}

// Adapt an extracted study into the buildEvidenceReport study payload (snake_case
// point+CI shape). Confidence intervals are treated as 95% — the convention CT.gov
// and abstract-reported ratios use, and the same default synthesisVerification applies.
function toReportStudy(study: ExtractedStudy): EvidenceReportStudy {
  return {
    label: study.label,
    measure: study.measure,
    point: study.point,
    ci_lower: study.ci_lower,
    ci_upper: study.ci_upper,
    ci_pct: 95,
  };
}

/**
 * Auto-synthesise a claim against a set of cached sources.
 *
 * Extracts one poolable study per source (skipping, with a reason, any source with no
 * usable ratio-with-CI effect), then — when at least two studies were extracted —
 * pools them into a full composite evidence report via buildEvidenceReport
 * (meta-analysis → publication-bias → GRADE → synthesis verdict). With fewer than two
 * usable studies it returns the honest InsufficientEvidenceReport that
 * buildEvidenceReport produces, carrying the per-source skip reasons — never a forced
 * low-confidence pool. NO LLM is in the numeric path. Pure: does not mutate its input.
 */
export function autoSynthesize(input: AutoSynthesizeInput): AutoSynthesisResult {
  const claim = input.claim.trim();

  const studies: ExtractedStudy[] = [];
  const skipped: SkippedSource[] = [];

  for (const source of input.sources) {
    const outcome = extractStudyFromSource(source);
    if (outcome.ok) {
      studies.push(outcome.study);
    } else {
      skipped.push({ id: source.id, reason: outcome.reason });
    }
  }

  const report = buildEvidenceReport({
    claim,
    studies: studies.map(toReportStudy),
  });

  // When the report is insufficient (< 2 usable studies), surface WHICH sources were
  // skipped and why, so the response is diagnosable rather than a bare "insufficient".
  const reportWithSkips: BuildEvidenceReportResult = report.ok
    ? report
    : {
        ...report,
        skipped: skipped.map((s) => ({ label: s.id, reason: s.reason })),
      };

  return { studies, skipped, report: reportWithSkips };
}
