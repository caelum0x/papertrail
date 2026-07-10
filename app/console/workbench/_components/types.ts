// Shared client-side types for the Evidence Workbench console. These mirror the
// deterministic EvidenceReport shape returned by /api/evidence-report (see
// lib/evidenceReport.ts) — nothing here re-derives numbers; the page only renders
// what the engines produced.

export type RatioMeasure = "RR" | "HR" | "OR";

// A study row in the workbench form. Kept as strings while editing so partial or
// empty input doesn't fight the number inputs; parsed to numbers only at submit.
export interface StudyForm {
  id: string;
  label: string;
  measure: RatioMeasure;
  point: string;
  ciLower: string;
  ciUpper: string;
}

export interface PooledEstimate {
  model: "fixed" | "random";
  point: number;
  ciLower: number;
  ciUpper: number;
  reductionPercent: number;
  significant: boolean;
}

export interface StudyEffect {
  label: string;
  measure: RatioMeasure;
  point: number;
  ciLower: number;
  ciUpper: number;
  weightFixedPct: number;
  weightRandomPct: number;
}

export interface Heterogeneity {
  q: number;
  df: number;
  pValue: number;
  iSquared: number;
  tauSquared: number;
  hSquared: number;
}

export interface MetaAnalysisResult {
  measure: RatioMeasure;
  k: number;
  studies: StudyEffect[];
  fixed: PooledEstimate;
  random: PooledEstimate;
  heterogeneity: Heterogeneity;
  predictionInterval: { lower: number; upper: number } | null;
  skipped: { label: string; reason: string }[];
}

export type Certainty = "high" | "moderate" | "low" | "very_low";

export interface Downgrade {
  domain: string;
  reason: string;
  steps: number;
}

export interface GradeResult {
  certainty: Certainty;
  startingLevel: Certainty;
  downgrades: Downgrade[];
  rationale: string;
}

export interface PublicationBiasReport {
  test: { intercept: number; pValue: number; asymmetry: boolean } | null;
  verdict: string;
  note: string;
}

export interface EvidenceReportVerdict {
  verdict: string;
  rationale: string;
  claimedReductionPercent: number | null;
  pooledReductionPercent: number | null;
  measure: RatioMeasure | null;
}

export interface AbsoluteEffect {
  riskTreated: number;
  riskControl: number;
  absoluteRiskReduction: number;
  nnt: number;
  eventsPer1000Treated: number;
  eventsPer1000Control: number;
  arrCiLower: number;
  arrCiUpper: number;
  nntCiLower: number;
  nntCiUpper: number;
  direction: "benefit" | "harm" | "null";
}

// The ok:true composite report — every deterministic engine's output at once.
export interface EvidenceReport {
  ok: true;
  claim: string;
  pooled: MetaAnalysisResult;
  publicationBias: PublicationBiasReport;
  certainty: GradeResult;
  verdict: EvidenceReportVerdict;
  claimedReductionPercent: number | null;
  rationale: string;
  absoluteEffects?: AbsoluteEffect;
}

// The honest ok:false report returned when fewer than two studies are usable.
export interface InsufficientEvidenceReport {
  ok: false;
  claim: string;
  reason: string;
  claimedReductionPercent: number | null;
  usableStudies: number;
  skipped: { label: string; reason: string }[];
}

export type EvidenceReportResult = EvidenceReport | InsufficientEvidenceReport;

// The wire study shape both /api/evidence-report and its export accept.
export interface WireStudy {
  label: string;
  measure: RatioMeasure;
  point: number;
  ci_lower: number;
  ci_upper: number;
}

export interface WorkbenchPayload {
  claim: string;
  studies: WireStudy[];
  baselineRisk?: number;
  // Optional GRADE risk-of-bias downgrade (0/1/2) for the body of evidence,
  // derived from the deterministic risk-of-bias engine via the RoB panel. This is
  // the request's snake_case wire key (EvidenceReportRequestSchema.risk_of_bias_steps).
  risk_of_bias_steps?: number;
}
