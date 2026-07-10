// Shared client-side types for the synthesis console. The API response mirrors
// the deterministic engine's output (see lib/metaAnalysis.ts) plus a verdict.

export type RatioMeasure = "RR" | "HR" | "OR";

// A study row in the form. Kept as strings while editing so partial/empty input
// doesn't fight the number inputs; parsed to numbers only at submit time.
export interface StudyForm {
  id: string;
  label: string;
  measure: RatioMeasure;
  point: string;
  ciLower: string;
  ciUpper: string;
  ciPct: string;
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

export interface SynthesisVerdict {
  verdict: string;
  rationale: string;
  claimedReductionPercent: number | null;
  pooledReductionPercent: number | null;
  measure: RatioMeasure | null;
}

export interface SynthesisResponse {
  pooled: MetaAnalysisResult | null;
  verdict: SynthesisVerdict;
}
