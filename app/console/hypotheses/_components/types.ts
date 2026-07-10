// Client-side view types for the research-gap + hypotheses console. These mirror the
// serialised shape of lib/hypotheses/schemas.HypothesesResult returned by
// /api/hypotheses inside the standard { success, data, error } envelope.

export type EvidenceSignalKind =
  | "no_support_found"
  | "few_studies"
  | "high_heterogeneity"
  | "wide_confidence_interval"
  | "crosses_null"
  | "publication_bias"
  | "low_certainty"
  | "claim_pool_mismatch";

export interface EvidenceSignal {
  id: string;
  kind: EvidenceSignalKind;
  detail: string;
  metrics: Record<string, number | string>;
}

export interface ResearchGap {
  signal_id: string;
  title: string;
  why_gap: string;
  affected_population: string | null;
}

export interface Hypothesis {
  signal_id: string;
  statement: string;
  testable_prediction: string;
  suggested_design: string;
  rationale: string;
}

export interface UsedSourceRef {
  id: string;
  title: string | null;
  source_type: string;
}

export interface HypothesesResponse {
  topic: string;
  evidenceGrounded: boolean;
  signals: EvidenceSignal[];
  gaps: ResearchGap[];
  hypotheses: Hypothesis[];
  synthesis: string;
  usedSources: UsedSourceRef[];
  droppedUngrounded: number;
}
