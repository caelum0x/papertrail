// Client-side mirror of the fragility engine's result shapes. Kept in sync with
// lib/evidenceFragility.ts; the console only ever renders these fields, never
// re-derives any numbers.

export type FragilityVerdict = "fragile" | "moderate" | "robust" | "not_significant";

export interface FragilityIndexDetail {
  fragilityIndex: number | null;
  baselineP: number;
  flippedP: number | null;
  direction: "toward_significance" | "away_from_significance" | null;
  eventsAltered: number;
  smallerEventArm: 1 | 2 | null;
  verdict: FragilityVerdict;
  interpretation: string;
}

export interface RobustnessDetail {
  pooledSignificant: boolean;
  survivesLeaveOneOut: boolean;
  flippingStudy: string | null;
  k: number;
  note: string;
}

export interface InformationSizeDetail {
  informationSizeMet: boolean;
  accruedN: number;
  requiredN: number;
  informationFraction: number;
  note: string;
}

export interface FragilityTableResult {
  kind: "table";
  fragilityIndex: number | null;
  interpretation: string;
  verdict: FragilityVerdict;
  detail: FragilityIndexDetail;
}

export interface FragilityMetaResult {
  kind: "meta";
  fragilityIndex: null;
  interpretation: string;
  verdict: FragilityVerdict;
  informationSizeMet: boolean | null;
  robustness: RobustnessDetail;
  informationSize: InformationSizeDetail | null;
}

export type FragilityResult = FragilityTableResult | FragilityMetaResult;

// A study row as edited in the meta panel (all string-backed for the inputs).
export interface StudyRow {
  label: string;
  events1: string;
  total1: string;
  events2: string;
  total2: string;
}

export const VERDICT_STYLES: Record<FragilityVerdict, { label: string; className: string }> = {
  fragile: { label: "Fragile", className: "bg-red-50 text-red-800" },
  moderate: { label: "Moderately robust", className: "bg-amber-50 text-amber-800" },
  robust: { label: "Robust", className: "bg-emerald-50 text-emerald-800" },
  not_significant: { label: "Not significant", className: "bg-ink/5 text-ink/60" },
};
