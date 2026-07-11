// Client-facing view types for the living-evidence console. These mirror the API
// result shapes from lib/livingEvidence/* but stay decoupled so the page never
// imports server modules.

export type FlipVerdict =
  | "would_flip"
  | "strengthens"
  | "weakens"
  | "no_change"
  | "insufficient_evidence";

export type EffectDirection = "protective" | "harmful" | "null";

export type RatioMeasure = "RR" | "HR" | "OR";

export interface StudyInput {
  label: string;
  measure: RatioMeasure;
  year: number;
  point?: number | null;
  ciLower?: number | null;
  ciUpper?: number | null;
}

export interface PooledEstimateView {
  point: number;
  ciLower: number;
  ciUpper: number;
  reductionPercent: number;
  significant: boolean;
}

export interface CumulativeStepView {
  order: number;
  addedLabel: string;
  year: number;
  k: number;
  pooled: PooledEstimateView | null;
  significant: boolean;
  direction: EffectDirection;
  flippedDirection: boolean;
  flippedSignificance: boolean;
}

export interface CumulativeMetaView {
  steps: CumulativeStepView[];
  firstSignificantAtOrder: number | null;
  finalPooled: PooledEstimateView | null;
  finalDirection: EffectDirection;
  finalSignificant: boolean;
  usableCount: number;
  skippedCount: number;
}

export interface AssessmentView {
  verdict: FlipVerdict;
  baseline: PooledEstimateView | null;
  baselineDirection: EffectDirection;
  baselineSignificant: boolean;
  updated: PooledEstimateView | null;
  updatedDirection: EffectDirection;
  updatedSignificant: boolean;
  flippedDirection: boolean;
  flippedSignificance: boolean;
  cumulative: CumulativeMetaView;
  rationale: string;
}

export interface MonitorView {
  id: string;
  orgId: string;
  topic: string;
  query: string | null;
  baseline: StudyInput[] | null;
  lastCheckedAt: string | null;
  createdBy: string | null;
  createdAt: string;
}
